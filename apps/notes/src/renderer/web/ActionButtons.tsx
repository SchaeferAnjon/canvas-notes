import { type ReactNode, useEffect, useState } from 'react'
import type { ActionState } from '../../shared/web-api'

/** 工具栏上最多摆几个插件按钮；多的在「插件」面板里点 */
const MAX = 3

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

/** 工具栏上的插件按钮（像 Chrome 地址栏右边那排）；children 是内置插件的按钮，排在前面 */
export function ActionButtons({ tabId, children }: { tabId: number; children?: ReactNode }) {
  const actions = useActions()
  return (
    <div className="wactions" role="toolbar" aria-label="插件按钮">
      {children}
      {actions.slice(0, MAX).map((a) => (
        <button key={a.id} className="iconbtn wact" aria-label={a.title} title={a.title} onClick={(e) => activateAction(a, e.currentTarget, tabId)}>
          <ActionIcon a={a} />
        </button>
      ))}
    </div>
  )
}
