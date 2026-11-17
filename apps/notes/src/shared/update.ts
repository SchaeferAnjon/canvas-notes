/**
 * 检查更新的文案（设置页状态行、底栏、菜单都用这里的），照 MeetCaption 的 updateError 改写。
 * 设计规格：设置 › 更新、底栏最右端「● 重启更新到 x」、装不上时「● 更新没装上」。
 */
import { when } from './when'
import type { UpdateState } from './api'

export interface UpdateError {
  text: string
  /** 找到了新版本却装不上（签名不对、只读位置、安装包下载不到）：底栏出「更新没装上」 */
  blocking: boolean
  /** 额外按钮 */
  action?: 'site' | 'move'
  /** 不算真的出错（GitHub 上还没有能自动更新的版本）：状态点用灰色 */
  soft?: boolean
}

/** electron-updater / Squirrel 的原文报错换成看得懂的话；认不出的给原文第一行（最多 80 字） */
export function updateError(msg: string, version = ''): UpdateError {
  const v = version
  if (/code signature|code requirement|did not pass validation|designated requirement/i.test(msg))
    return { text: '新版本的签名和装着的这一版对不上，没有装；去官网重新下载安装一次就好', blocking: true, action: 'site' }
  if (/read-only|EROFS/i.test(msg)) return { text: 'Canvas Notes在只读的位置（比如直接从安装盘里打开），装不上新版本；挪到「应用程序」再打开', blocking: true, action: 'move' }
  const dl = /Cannot download "[^"]*", status (\d+)/.exec(msg)
  if (dl) return { text: `新版本${v}的安装包下载不到（${dl[1]}），过一会儿再试`, blocking: true }
  if (/Cannot find channel/i.test(msg)) return { text: 'GitHub上还没有能自动更新的新版本', blocking: false, soft: true }
  if (/403/.test(msg) && /rate limit/i.test(msg)) return { text: 'GitHub暂时不让查（查得太频繁），一小时后会自动再查', blocking: false }
  if (/net::|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|getaddrinfo|socket hang up/i.test(msg))
    return { text: '连不上GitHub，检查一下网络；过一会儿会自动再查', blocking: false }
  if (/ENOSPC/.test(msg)) return { text: '磁盘空间不够，新版本没下完；腾出一些空间再查', blocking: false }
  const first = msg.split('\n')[0]!.trim()
  return { text: first.length > 80 ? first.slice(0, 80) + '…' : first, blocking: false }
}

/** 时间：今天 18:02 / 昨天 21:05 / 11月12日 09:30（全软件同一种写法） */
export const checkedLabel = (ms: number, now = new Date()) => when(ms, { now: now.getTime(), time: true })

/** 设置页的状态行 */
export function updateLine(s: UpdateState, autoOn: boolean): string {
  switch (s.phase) {
    case 'off':
      return '开发版，不自动更新'
    case 'checking':
      return '正在查GitHub上有没有新版本…'
    case 'downloading':
      return `正在下载新版本${s.version} · ${s.percent}%`
    case 'ready':
      return `新版本${s.version}已下好，重启就能用`
    case 'latest':
      return `已是最新 · ${checkedLabel(s.checkedAt)}查过`
    case 'error': {
      const e = updateError(s.error, s.version)
      return `${e.blocking ? '没装上' : '没查成'}：${e.text}`
    }
    default:
      if (!autoOn) return '自动检查已关，点右边查一次'
      return s.checkedAt ? `上次${checkedLabel(s.checkedAt)}查过，是最新的` : '还没查过；打开30秒后会自动查一次'
  }
}

/** 应用菜单里那一项的字；ready 时由调用方换成「重启并更新到 x」 */
export function menuLabel(s: UpdateState): string {
  if (s.phase === 'checking') return '正在检查更新…'
  if (s.phase === 'downloading') return '正在下载新版本…'
  return '检查更新…'
}

/** 这一版在 GitHub 上的发布页 */
export const releaseUrl = (repo: string, version: string) => `https://github.com/${repo}/releases/tag/v${version}`
