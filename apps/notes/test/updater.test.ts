import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { Updater, type UpdaterEngine } from '../src/main/updater'
import { checkedLabel, updateError, updateLine } from '../src/shared/update'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/appearance'

function fakeEngine() {
  const e = new EventEmitter() as UpdaterEngine & { feeds: unknown[]; installed: boolean }
  Object.assign(e, { autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: true, logger: null, feeds: [], installed: false })
  e.setFeedURL = (o) => void e.feeds.push(o)
  e.checkForUpdates = async () => {
    e.emit('checking-for-update')
    return null
  }
  e.quitAndInstall = () => void (e.installed = true)
  return e
}

const base = { enabled: () => true, inApps: true, version: '0.2.0' }

describe('检查更新', () => {
  it('开发版、本机打的包：off，查也不查、装也不装', async () => {
    const e = fakeEngine()
    const u = new Updater({ ...base, supported: false, engine: e })
    expect(u.status().phase).toBe('off')
    expect(u.status().current).toBe('0.2.0')
    expect((await u.check()).phase).toBe('off')
    expect(u.install()).toBe(false)
  })

  it('有新版：后台下载，Mac 上 Squirrel 验过签才算 ready；ready 后再出的错不盖掉；装 = quitAndInstall', async () => {
    const e = fakeEngine()
    const native = new EventEmitter()
    const u = new Updater({ ...base, supported: true, engine: e, native, feedUrl: 'http://127.0.0.1:9/' })
    expect(e.autoDownload).toBe(true)
    expect(e.autoInstallOnAppQuit).toBe(true)
    expect(e.allowPrerelease).toBe(false)
    expect(e.feeds).toEqual([{ provider: 'generic', url: 'http://127.0.0.1:9/' }])
    const phases: string[] = []
    u.on('state', (s) => phases.push(s.phase))
    await u.check()
    e.emit('update-available', { version: '0.2.1' })
    e.emit('download-progress', { percent: 42.7 })
    expect(u.status()).toMatchObject({ phase: 'downloading', version: '0.2.1', percent: 42 })
    e.emit('update-downloaded', { version: '0.2.1' })
    expect(u.status().phase).toBe('downloading') // electron-updater 下完了，Squirrel 还没验签
    expect(u.install()).toBe(false)
    native.emit('update-downloaded')
    expect(u.status()).toMatchObject({ phase: 'ready', version: '0.2.1', percent: 100 })
    e.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(u.status().phase).toBe('ready')
    expect((await u.check()).phase).toBe('ready') // 下好了不再查
    expect(u.install()).toBe(true)
    expect(e.installed).toBe(true)
    expect(phases).toEqual(['checking', 'downloading', 'downloading', 'downloading', 'ready'])
  })

  it('没有新版是 latest，记下时间；出错是 error，原文第一行', async () => {
    const e = fakeEngine()
    const u = new Updater({ ...base, supported: true, engine: e })
    await u.check()
    e.emit('update-not-available')
    expect(u.status().phase).toBe('latest')
    expect(u.status().checkedAt).toBeGreaterThan(0)
    e.emit('error', new Error('第一行\n堆栈'))
    expect(u.status()).toMatchObject({ phase: 'error', error: '第一行' })
  })

  it('自动检查：30 秒后第一次，之后每 6 小时；设置里关了就不查', () => {
    vi.useFakeTimers()
    try {
      let on = true
      const e = fakeEngine()
      const spy = vi.spyOn(e, 'checkForUpdates')
      const u = new Updater({ ...base, supported: true, engine: e, enabled: () => on })
      u.start()
      vi.advanceTimersByTime(29_000)
      expect(spy).toHaveBeenCalledTimes(0)
      vi.advanceTimersByTime(1_000)
      expect(spy).toHaveBeenCalledTimes(1)
      e.emit('update-not-available')
      on = false
      vi.advanceTimersByTime(6 * 3600_000)
      expect(spy).toHaveBeenCalledTimes(1)
      on = true
      vi.advanceTimersByTime(6 * 3600_000)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('报错换成看得懂的话；签名不对、只读、安装包下载不到算「装不上」（底栏出提示），网络这类只写在设置页', () => {
    expect(updateError('Cannot download "http://x/CanvasNotes-0.2.1-mac-arm64.zip", status 404: Not Found', '0.2.1')).toEqual({ text: '新版本0.2.1的安装包下载不到（404），过一会儿再试', blocking: true })
    expect(updateError('Cannot find channel "latest-mac.yml" update info: HttpError: 404')).toMatchObject({ text: 'GitHub上还没有能自动更新的新版本', blocking: false, soft: true })
    expect(updateError('net::ERR_INTERNET_DISCONNECTED').text).toBe('连不上GitHub，检查一下网络；过一会儿会自动再查')
    expect(updateError('Code signature at URL file:///x did not pass validation')).toMatchObject({ blocking: true, action: 'site' })
    expect(updateError('EROFS: read-only file system')).toMatchObject({ blocking: true, action: 'move' })
    expect(updateError('HttpError: 403 rate limit exceeded').blocking).toBe(false)
    expect(updateError('别的错\n堆栈').text).toBe('别的错')
  })

  it('设置页状态行', () => {
    const s = { phase: 'idle', current: '0.2.0', version: '', percent: 0, error: '', checkedAt: 0, inApps: true } as const
    expect(updateLine(s, true)).toBe('还没查过；打开30秒后会自动查一次')
    expect(updateLine(s, false)).toBe('自动检查已关，点右边查一次')
    expect(updateLine({ ...s, phase: 'downloading', version: '0.2.1', percent: 42 }, true)).toBe('正在下载新版本0.2.1 · 42%')
    expect(updateLine({ ...s, phase: 'ready', version: '0.2.1' }, true)).toBe('新版本0.2.1已下好，重启就能用')
    expect(updateLine({ ...s, phase: 'error', error: 'net::ERR_X' }, true)).toBe('没查成：连不上GitHub，检查一下网络；过一会儿会自动再查')
    expect(updateLine({ ...s, phase: 'off' }, true)).toBe('开发版，不自动更新')
    expect(checkedLabel(new Date(2026, 10, 12, 9, 30).getTime(), new Date(2026, 10, 15))).toBe('周四 09:30')
  })

  it('设置：默认自动检查更新，乱写的值回到默认', () => {
    expect(DEFAULT_SETTINGS.autoUpdate).toBe(true)
    expect(normalizeSettings({ autoUpdate: false }).autoUpdate).toBe(false)
    expect(normalizeSettings({ autoUpdate: 'no' }).autoUpdate).toBe(true)
  })
})
