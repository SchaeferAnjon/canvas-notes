import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import type { ActionState } from '../../shared/web-api'

/** 地址栏右边最多固定几个 Chrome 插件按钮；默认一个也不放，在「⋯ › 插件」里点图钉固定 */
export const MAX_PINNED = 2
const PIN_KEY = 'cn.pinnedActions'

let pinned: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_PINNED) : []
  } catch {
    // 记不住固定了哪些：当一个也没固定
    return []
  }
})()
const pinSubs = new Set<() => void>()

/** 固定了哪些插件按钮（插件的 runtime id）；记在本机 */
export function usePinned(): string[] {
  return useSyncExternalStore(
    (f) => {
      pinSubs.add(f)
      return () => pinSubs.delete(f)
    },
    () => pinned,
  )
}

export function togglePin(id: string) {
  pinned = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id].slice(-MAX_PINNED)
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(pinned))
  } catch {
    // 存不下只是下次不记得
  }
  pinSubs.forEach((f) => f())
}

export function useActions(): ActionState[] {
  const [actions, setActions] = useState<ActionState[]>([])
  useEffect(() => {
    let alive = true
    const load = () => void window.cnWeb.actions().then((s) => alive && setActions(s.actions))
    load()
    const off = window.cnWeb.onActionsChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return actions
}

/** 点插件按钮：有弹窗的贴着按钮开弹窗，没有的通知插件「被点了」 */
export function activateAction(a: ActionState, el: HTMLElement, tabId: number) {
  const r = el.getBoundingClientRect()
  void window.cnWeb.activateAction(a.id, { x: r.left, y: r.top, width: r.width, height: r.height }, tabId)
}

export function ActionIcon({ a }: { a: ActionState }) {
  return (
    <>
      <img src={a.icon} alt="" draggable={false} />
      {a.text && (
        <i className="badge" style={a.color ? { background: a.color } : undefined}>
          {a.text}
        </i>
      )}
    </>
  )
}

/** 地址栏右边的插件按钮：固定了的 Chrome 插件（最多 2 个）；children 是内置插件放在这里的按钮，排在前面 */
export function ActionButtons({ tabId, children }: { tabId: number; children?: ReactNode }) {
  const actions = useActions()
  const pins = usePinned()
  return (
    <div className="wactions" role="toolbar" aria-label="插件按钮">
      {children}
      {actions.filter((a) => pins.includes(a.id)).map((a) => (
        <button key={a.id} className="iconbtn wact" aria-label={a.title} title={a.title} onClick={(e) => activateAction(a, e.currentTarget, tabId)}>
          <ActionIcon a={a} />
        </button>
      ))}
    </div>
  )
}
