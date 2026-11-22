/**
 * 网页预加载报来的「读到哪」（preload/webview-readpos.ts）转给右栏网页面板（WebPanel 登记自己）：
 * cn:readpos 读到的地方（人滚的、网页载完的、要的），cn:readpos:touch 人在网页里按了键、按了鼠标，cn:readpos:went 回到那段的结果。
 */
import type { PagePos } from '../../shared/read-along'

export type PosKind = 'scroll' | 'land' | 'now'
export type Went = { id: number; how: 'exact' | 'fuzzy' | 'ratio' | 'top' }

export interface ReadPosHost {
  pos(wcId: number, pos: PagePos, kind: PosKind): void
  touch(wcId: number): void
  went(wcId: number, r: Went): void
}

let host: ReadPosHost | null = null
export const setReadPosHost = (h: ReadPosHost | null) => void (host = h)

export function readPosIpc(wcId: number, channel: string, args: unknown[]) {
  if (!host) return
  if (channel === 'cn:readpos:touch') return host.touch(wcId)
  const a = args[0] as Record<string, unknown> | undefined
  if (!a || typeof a !== 'object') return
  if (channel === 'cn:readpos:went') {
    if (typeof a.id === 'number' && typeof a.how === 'string') host.went(wcId, { id: a.id, how: a.how as Went['how'] })
    return
  }
  if (channel !== 'cn:readpos' || typeof a.url !== 'string' || !/^https?:/.test(a.url) || typeof a.text !== 'string') return
  const kind = a.kind === 'land' || a.kind === 'now' ? a.kind : 'scroll'
  const pos: PagePos = {
    url: a.url,
    text: a.text.slice(0, 400),
    before: String(a.before ?? '').slice(0, 200),
    after: String(a.after ?? '').slice(0, 200),
    ratio: Math.min(1, Math.max(0, Number(a.ratio) || 0)),
    ...(typeof a.head === 'string' && a.head ? { head: a.head.slice(0, 200) } : {}),
    ...(typeof a.title === 'string' ? { title: a.title.slice(0, 300) } : {}),
  }
  host.pos(wcId, pos, kind)
}

/** 网页里亮一下用的颜色：主题强调色 24%（深色主题 30%，同原型 --hl），量出真的颜色交给网页 */
export function flashColor(): string {
  const probe = document.createElement('span')
  const dark = document.querySelector('[data-tone="dark"]') !== null
  probe.style.cssText = `position:absolute;visibility:hidden;background:color-mix(in srgb, var(--acc) ${dark ? 30 : 24}%, transparent)`
  document.body.append(probe)
  const c = getComputedStyle(probe).backgroundColor
  probe.remove()
  return c || 'rgba(10, 126, 164, 0.24)'
}
