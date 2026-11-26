/**
 * 收件箱「速记抓不到内容」（用户：有时抓不到）：按 ⌥⌘N 时拿前台软件选中的字。假的剪贴板和假的前台软件演几种偶发的情形：
 * 软件拷得慢（长的一大段、忙着的浏览器）、按键还没松（⌥ 还按着时发的 ⌘C 到前台是 ⌥⌘C，不拷贝）、连按两下、还原剪贴板出错。
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { grabSelection, type GrabDeps } from '../src/main/quick-grab'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 一台假的 Mac：clip 是系统剪贴板；前台软件收到 ⌘C 后 copyMs 毫秒才把选中的字放进剪贴板；keysUpMs 之前 ⌥ 还按着 */
function mac(o: { selection: string; copyMs?: number; keysUpMs?: number; restoreFails?: boolean }) {
  const t0 = Date.now()
  const s = { clip: '原来剪贴板里的东西', copies: 0 }
  const held = () => Date.now() - t0 < (o.keysUpMs ?? 0)
  const deps: GrabDeps<string> = {
    save: async () => s.clip,
    restore: async (v) => {
      if (o.restoreFails) throw new Error('剪贴板写不进去')
      s.clip = v
    },
    writeText: async (t) => void (s.clip = t),
    readText: async () => s.clip,
    keysUp: async (max) => {
      const until = Date.now() + max
      while (held() && Date.now() < until) await sleep(10)
    },
    pressCopy: async () => {
      // 按下那一刻 ⌥ 还按着：前台软件收到的是 ⌥⌘C，什么都不拷
      if (held()) return
      s.copies++
      setTimeout(() => void (s.clip = o.selection), o.copyMs ?? 20)
    },
    sleep,
  }
  return { deps, s }
}

describe('grabSelection：速记拿前台软件选中的字', () => {
  it('前台软件拷得慢（700 毫秒才进剪贴板）：照样拿到，剪贴板还原成原来的', async () => {
    const m = mac({ selection: '很长的一大段', copyMs: 700 })
    expect(await grabSelection(m.deps)).toBe('很长的一大段')
    await sleep(50)
    expect(m.s.clip).toBe('原来剪贴板里的东西')
  })

  it('按下快捷键的手还没松（⌥ 还按着 300 毫秒）：等松开再按 ⌘C，拿得到', async () => {
    const m = mac({ selection: '选中的一句', keysUpMs: 300 })
    expect(await grabSelection(m.deps)).toBe('选中的一句')
    expect(m.s.clip).toBe('原来剪贴板里的东西')
  })

  it('连按两下：两次都拿到选中的字，不会拿到对方放的记号；剪贴板最后是原来的，不是记号', async () => {
    const m = mac({ selection: '选中的一句', copyMs: 120 })
    const [a, b] = await Promise.all([grabSelection(m.deps), grabSelection(m.deps)])
    expect([a, b]).toEqual(['选中的一句', '选中的一句'])
    await sleep(200)
    expect(m.s.clip).toBe('原来剪贴板里的东西')
  })

  it('还原剪贴板出错：拿到的字照样交回（错写进日志）', async () => {
    const m = mac({ selection: '选中的一句', restoreFails: true })
    expect(await grabSelection(m.deps)).toBe('选中的一句')
  })

  it('什么都没选（软件不动剪贴板）：交回空串，剪贴板还原', async () => {
    const m = mac({ selection: '' })
    m.deps.pressCopy = async () => undefined
    expect(await grabSelection(m.deps)).toBe('')
    expect(m.s.clip).toBe('原来剪贴板里的东西')
  })
})

describe.runIf(process.platform === 'darwin')('真的 JXA（只读按键状态，不发按键）', () => {
  it('等松开那一段在这台 Mac 上跑得通：没按着键时马上回来', async () => {
    const { KEYS_UP_JXA } = await import('../src/main/quick-grab')
    const t = Date.now()
    const out = execFileSync('osascript', ['-l', 'JavaScript', '-e', KEYS_UP_JXA, '500'], { encoding: 'utf8', timeout: 5000 }).trim()
    expect(Number(out)).toBeGreaterThanOrEqual(0)
    expect(Date.now() - t).toBeLessThan(3000)
  })
})
