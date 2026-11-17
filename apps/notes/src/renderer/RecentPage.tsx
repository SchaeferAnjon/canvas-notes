/**
 * 中间的「最近」整页（2026-11-17 左栏重组，替掉原来的「全部笔记」）：顶上写个标题回车新建一篇（先放进「收件箱」），
 * 下面筛选框（标题、文件夹、正文）和类型筛选，按时间分组：今天、这周，更早的按月收起；每篇两行（名字 + 一行预览）。
 * 每组先列 100 篇，多的点「再显示」（别把上万条全铺开）；筛选时各组都展开。
 */
import { when } from '../shared/when'
import { Codicon } from '@cn/design'
import { useMemo, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { folderOfPath } from '../shared/files'
import { INBOX, titleOf } from '../shared/layout'
import { RECENT_PAGE, recentOf } from '../shared/recent'
import type { ArchiveDays } from '../shared/sidebar'
import { onFileMenu } from './ctx/file-menu'
import { noteType, type TypeFilter, TypeChips } from './files/type-filter'
import { PageNote, TabActs } from './shell/TabActs'
import './recent-page.css'

export function RecentPage(props: {
  notes: NoteFile[]
  pins: string[]
  archiveDays: ArchiveDays
  activePath: string | null
  onOpen(path: string): void
  /** 写了标题回车：在收件箱里新建这一篇并打开 */
  onCreate(title: string): Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState<Record<string, number>>({})
  const now = Date.now()
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const m = useMemo(
    () =>
      recentOf(props.notes, {
        pins: [],
        now,
        archiveDays: props.archiveDays,
        withArchived: true,
        keep: (n) => (type === 'all' || noteType(n) === type) && (!words.length || words.every((w) => (n.path + '\n' + (n.excerpt ?? '')).toLowerCase().includes(w))),
      }),
    // now 每次渲染都变，只在笔记、筛选变了时重算
    [props.notes, props.archiveDays, type, q],
  )
  const create = async () => {
    const t = title.trim()
    if (!t) return
    await props.onCreate(t)
    setTitle('')
  }

  return (
    <section className="pane recentp" data-testid="recent-page">
      <TabActs active>
        <PageNote>
          <span className="num">{m.total}</span>篇 · 按修改时间
        </PageNote>
      </TabActs>
      <div className="body">
        <div className="rp-in">
          <form
            className="rp-new"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <Codicon name="new-file" size={16} />
            <input aria-label="新建一篇的标题" placeholder={`写个标题，回车新建一篇 · 放进「${INBOX}」`} value={title} onChange={(e) => setTitle(e.target.value)} />
            <button className="go" type="submit" aria-label="新建" disabled={!title.trim()}>
              <Codicon name="arrow-right" size={14} />
            </button>
          </form>
          <div className="rp-bar">
            <label className="rp-find">
              <Codicon name="search" size={14} />
              <input aria-label="筛选" placeholder="筛选标题、文件夹、正文" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <TypeChips value={type} onChange={setType} />
          </div>
          <div role="list" aria-label="最近的笔记">
            {m.groups.map((g) => {
              const folded = g.key !== 'today' && g.key !== 'week' && !words.length
              const isOpen = !folded || open.has(g.key)
              const limit = shown[g.key] ?? RECENT_PAGE
              return (
                <div key={g.key} className="rp-group" role="group" aria-label={g.label}>
                  {folded ? (
                    <button className="rp-fold" aria-expanded={isOpen} onClick={() => setOpen((s) => (s.has(g.key) ? new Set([...s].filter((x) => x !== g.key)) : new Set([...s, g.key])))}>
                      <Codicon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
                      {g.label}
                      <span className="c num">{`${g.items.length}篇`}</span>
                    </button>
                  ) : (
                    <div className="rp-g">{g.label}</div>
                  )}
                  {isOpen &&
                    g.items.slice(0, limit).map((n) => (
                      <div key={n.path} role="listitem">
                        <button className={'rp-row' + (props.activePath === n.path ? ' on' : '')} onClick={() => props.onOpen(n.path)} onContextMenu={(e) => onFileMenu(e, n.path)} title={n.path}>
                          <span className="ic">{n.board ? <i className="sw" style={{ background: n.board.color }} /> : <Codicon name={noteType(n) === 'clip' ? 'quote' : /(^|\/)我的疑惑\.md$/.test(n.path) ? 'question' : 'file-text'} />}</span>
                          <span className="ti t">{titleOf(n.path)}</span>
                          <span className="rt">
                            {folderOfPath(n.path) || '库的最外层'} · <span className="num">{when(n.mtimeMs, { now })}</span>
                          </span>
                          <span className="pv">{n.board ? `${n.board.cards}张卡片` : n.excerpt || '空的'}</span>
                        </button>
                      </div>
                    ))}
                  {isOpen && g.items.length > limit && (
                    <button className="rp-fold rp-more" onClick={() => setShown((s) => ({ ...s, [g.key]: limit + RECENT_PAGE }))}>
                      <Codicon name="chevron-down" size={12} />
                      <span className="num">{`再显示${Math.min(RECENT_PAGE, g.items.length - limit)}篇`}</span>
                      <span className="c num">{`还有${g.items.length - limit}篇`}</span>
                    </button>
                  )}
                </div>
              )
            })}
            {!m.groups.length && <p className="rp-none">{words.length || type !== 'all' ? '没有对得上的笔记' : '还没有笔记。上面写个标题，回车就有第一篇'}</p>}
          </div>
        </div>
      </div>
    </section>
  )
}
