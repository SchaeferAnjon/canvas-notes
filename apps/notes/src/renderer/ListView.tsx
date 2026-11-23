import { PageNote, TabActs } from './shell/TabActs'
import { onFileMenu } from './ctx/file-menu'
import { Codicon } from '@cn/design'
import { useState } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { when } from '../shared/when'
import { useT } from './i18n'

const PAGE = 60

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
  const t = useT()
  const [text, setText] = useState('')
  /** 导入几百条旧笔记后收件箱很长：先画最新的 PAGE 条，往下点一次多画一页 */
  const [shown, setShown] = useState(PAGE)
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
      <TabActs active>
        <PageNote>
          <span className="num">{t('{n}条', { n: items.length })}</span> · {props.hint}
        </PageNote>
      </TabActs>
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
              <Codicon name="inbox" size={14} />
              <input
                aria-label={t('速记')}
                placeholder={t('随手记一句，回车放进收件箱')}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="send" type="submit" aria-label={t('放进收件箱')} disabled={!text.trim()}>
                <Codicon name="arrow-up" size={14} />
              </button>
            </form>
          )}
          {items.length === 0 && <p className="list-empty">{t('这里还没有东西。')}</p>}
          <div className="cards">
            {items.slice(0, shown).map((n) => (
              <button key={n.path} className={'lcard' + (n.kind !== 'work' && n.source ? ' clip' : '')} onClick={() => props.onOpen(n.path)} onContextMenu={(e) => onFileMenu(e, n.path)}>
                <span className="q">{n.preview || titleOf(n.path)}</span>
                <span className="src">
                  {n.source && <span className="dom">{domainOf(n.source)}</span>}
                  <span className="t">{when(n.createdMs)}</span>
                </span>
              </button>
            ))}
          </div>
          {items.length > shown && (
            <button className="btn btn-ghost btn-sm list-more" onClick={() => setShown((s) => s + PAGE)}>
              <span className="num">{t('再显示{more}条 · 还有{n}条', { more: Math.min(PAGE, items.length - shown), n: items.length - shown })}</span>
            </button>
          )}
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
