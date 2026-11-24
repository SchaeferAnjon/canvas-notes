/**
 * 出卡（task-tz7y3）在界面这边的一份：出卡弹窗开着哪个范围、问题条上「做成卡」的小卡、「只看我问的」的请求、
 * 每个范围问过的几问（送过没有）。入口（笔记栏、课程首页、⌘K、设置）都只调这里，App 里只放一个 CardsHost。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CardScope, CardsView } from '../../shared/reading'
import { ipcOn } from '../crash/ipc'

const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const sub = (f: () => void) => (subs.add(f), () => void subs.delete(f))

/** 开着的出卡弹窗：范围；seq 每开一次加一 */
let open: { scope: CardScope; seq: number } | null = null
export function openCards(scope: CardScope) {
  open = { scope, seq: (open?.seq ?? 0) + 1 }
  emit()
}
export function closeCards() {
  open = null
  emit()
}
export const useCardsOpen = () => useSyncExternalStore(sub, () => open)

/** 问题条上「做成卡」：这份 PDF 的这一问，小卡贴在问题条下面（at 是问题条在窗口里的位置） */
type Box = { left: number; right: number; top: number; bottom: number }
const box = (r: DOMRect): Box => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
/** pane：笔记栏在窗口里的位置（小卡收在栏里，不压到 PDF 上） */
let spot: { pdf: string; id: string; at: Box; pane: Box; seq: number } | null = null
export function openSpot(pdf: string, id: string, at: DOMRect, pane: DOMRect) {
  spot = { pdf, id, at: box(at), pane: box(pane), seq: (spot?.seq ?? 0) + 1 }
  emit()
}
export function closeSpot() {
  spot = null
  emit()
}
export const useSpot = () => useSyncExternalStore(sub, () => spot)

/** 「只看我问的」：课程首页点「第5讲 6问」、⌘K 打「我的疑惑」时，笔记栏换到它 */
let asked: { pdf: string; seq: number } | null = null
export function showAsked(pdf: string) {
  asked = { pdf, seq: (asked?.seq ?? 0) + 1 }
  emit()
}
export const useAskedRequest = () => useSyncExternalStore(sub, () => asked)

/** 送了、撤回了：各处问过的几问重读 */
let version = 0
export function cardsChanged() {
  version++
  emit()
}

/** 这个范围里问过的每一问（送过没有、上次改好的）；库里的文件变了、送了、撤回了重读 */
export function useCardsView(scope: CardScope | null): CardsView | null {
  const key = scope ? JSON.stringify(scope) : ''
  const v = useSyncExternalStore(sub, () => version)
  const [view, setView] = useState<CardsView | null>(null)
  useEffect(() => {
    if (!scope) return setView(null)
    let stale = false
    const load = () =>
      void window.cnReading.cards(scope).then(
        (x) => !stale && setView(x),
        (e) => console.error('读问过的几问没成功', e),
      )
    load()
    const off = ipcOn(window.cn.onFilesChanged, 'cn.onFilesChanged')(load)
    return () => {
      stale = true
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v])
  return view
}

/** 「出卡 · N问」里的 N：没送过的（旁支里问的设置关着时不算） */
export const unsentOf = (view: CardsView | null, sides: boolean) => (view?.items ?? []).filter((it) => !it.sent && (sides || it.quote === undefined))
