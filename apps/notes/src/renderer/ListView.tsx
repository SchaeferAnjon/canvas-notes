import { Icon } from '@cn/design'
import { ArrowUp, Inbox } from 'lucide-react'
import { useState } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'

/** 收件箱或一个素材主题：卡片列表，新的在前 */
export function ListView(props: {
  title: string
  hint: string
  items: NoteFile[]
  capture: boolean
  onOpen(path: string): void
  onCaptured(path: string): void
  onNotice(t: string): void
}) {
  const [text, setText] = useState('')
  const items = [...props.items].sort((a, b) => b.createdMs - a.createdMs)

  async function submit() {
    const t = text.trim()
    if (!t) return
    try {
      const p = await window.cn.capture(t)
      setText('')
      props.onCaptured(p)
    } catch (e) {
      props.onNotice(String((e as Error).message))
    }
  }

  return (
    <section className="pane">
      <div className="tool">
        <h1>{props.title}</h1>
        <span className="meta">
          <span className="num">{items.length}</span> 条 · {props.hint}
        </span>
        <span className="sp" />
      </div>
      <div className="body">
        <div className="list">
          {props.capture && (
            <form
              className="capture"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <Icon of={Inbox} size={14} />
              <input
                aria-label="速记"
                placeholder="随手记一句，回车放进收件箱"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="send" type="submit" aria-label="放进收件箱" disabled={!text.trim()}>
                <Icon of={ArrowUp} size={14} />
              </button>
            </form>
          )}
          {items.length === 0 && <p className="list-empty">这里还没有东西。</p>}
          <div className="cards">
            {items.map((n) => (
              <button key={n.path} className={'lcard' + (n.kind !== 'work' && n.source ? ' clip' : '')} onClick={() => props.onOpen(n.path)}>
                <span className="q">{n.preview || titleOf(n.path)}</span>
                <span className="src">
                  {n.source && <span className="dom">{domainOf(n.source)}</span>}
                  <span className="t">{when(n.createdMs)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function when(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`
  return `${d.getMonth() + 1}-${p(d.getDate())} ${hm}`
}
