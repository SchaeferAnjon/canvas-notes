import { useEffect, useRef, useState } from 'react'
import { useDismiss } from '@cn/design/dismiss'
import type { ChromeProfileInfo } from '../../shared/web-api'
import { errText } from '../WebPanel'

/** 选一个 Chrome 用户（导入登录、书签、历史、插件都用它）。只有一个用户时直接选它 */
export function ProfileMenu(props: { label: string; title: string; onPick(id: string, name: string): void; onNotice(t: string): void; onClose(): void }) {
  const [list, setList] = useState<ChromeProfileInfo[] | null>(null)
  useEffect(() => {
    let alive = true
    window.cnWeb.chromeProfiles().then(
      (l) => {
        if (!alive) return
        if (!l.length) {
          props.onNotice('这台Mac上没找到Chrome的用户资料')
          props.onClose()
        } else if (l.length === 1) props.onPick(l[0]!.id, l[0]!.name)
        else setList(l)
      },
      (e) => {
        props.onNotice(errText(e))
        props.onClose()
      },
    )
    return () => {
      alive = false
    }
  }, [])
  // 点外面（网页里也算）、Esc、窗口失焦收起（公共的 useDismiss）；外面那一层 .imp 里有开它的按钮，算里面（按钮自己开关）
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(!!list, [ref, { get current() { return ref.current?.parentElement ?? null } }], () => props.onClose(), { esc: 'late' })
  if (!list) return null
  return (
    <div ref={ref} className="menu" role="menu" aria-label={props.label}>
      <div className="mh">{props.title}</div>
      {list.map((p) => (
        <button key={p.id} role="menuitem" onClick={() => props.onPick(p.id, p.name)}>
          <b>{p.name}</b>
          {p.account && <span>{p.account}</span>}
        </button>
      ))}
    </div>
  )
}
