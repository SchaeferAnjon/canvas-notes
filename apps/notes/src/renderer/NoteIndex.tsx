import { Icon } from '@cn/design'
import { FileText, Inbox, Pin, Quote, Search, Settings, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { type ArchiveDays, isArchived } from '../shared/sidebar'
import { noteMenu, RenameInput } from './note-menu'
import './note-index.css'

type Kind = 'any' | 'work' | 'board' | 'clip' | 'inbox'
const KINDS: [Kind, string][] = [
  ['any', '全部'],
  ['work', '文档'],
  ['board', '白板'],
  ['clip', '素材'],
  ['inbox', '收件箱'],
]
const kindOf = (n: NoteFile): Kind => (n.board ? 'board' : n.kind)

/** 一行 36 高；只画看得见的那几十行，几千篇也不卡 */
export const ROW_H = 36
const OVERSCAN = 10

/** 2026-11-15 的说法：今天 14:03、昨天 14:03、今年 11-03、往年 2024-11-03 */
export function dateOf(ms: number, now = new Date()): string {
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `昨天 ${p(d.getHours())}:${p(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 筛选：每个词都要出现在标题或文件夹里（不分大小写） */
export function filterNotes(notes: NoteFile[], q: string, kind: Kind, oldFirst: boolean): NoteFile[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const out = notes.filter((n) => {
    if (kind !== 'any' && kindOf(n) !== kind) return false
    if (!words.length) return true
    const hay = n.path.toLowerCase().replace(/\.md$/, '')
    return words.every((w) => hay.includes(w))
  })
  return out.sort((a, b) => (oldFirst ? a.mtimeMs - b.mtimeMs : b.mtimeMs - a.mtimeMs))
}

/**
 * 「全部笔记」和「归档」：可筛选、按修改时间排、虚拟滚动的长列表。
 * 归档 = 设置里那么多天没改过的（不挪文件、不改内容）；置顶的和收件箱不归档；改一下就回到左栏。
 */
export function NoteIndex(props: {
  which: 'all' | 'archive'
  notes: NoteFile[]
  pins: string[]
  archiveDays: ArchiveDays
  onOpen(path: string): void
  onRename(path: string, name: string): void
  onTrash(path: string): void
  onPinsChanged(): void
  onOpenSettings(): void
}) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('any')
  const [oldFirst, setOldFirst] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(800)
  const body = useRef<HTMLDivElement>(null)
  const archive = props.which === 'archive'
  const pinSet = useMemo(() => new Set(props.pins), [props.pins])
  const now = Date.now()

  const pool = useMemo(
    () => (archive ? props.notes.filter((n) => isArchived(n, now, props.archiveDays, pinSet)) : props.notes),
    // now 每次渲染都变，只在笔记、置顶、天数变了时重算
    [archive, props.notes, props.archiveDays, pinSet],
  )
  const rows = useMemo(() => filterNotes(pool, q, kind, oldFirst), [pool, q, kind, oldFirst])

  useLayoutEffect(() => {
    const el = body.current!
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // 换筛选条件回到顶上
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0
    setScrollTop(0)
  }, [q, kind, oldFirst])

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN)
  const kinds = archive ? KINDS.filter(([k]) => k !== 'inbox') : KINDS
  const off = archive && props.archiveDays === 0

  return (
    <section className="pane ix" data-testid={archive ? 'archive-view' : 'all-view'}>
      <div className="tool">
        <h1>{archive ? '归档' : '全部笔记'}</h1>
        <span className="meta">
          <span className="num">{pool.length}</span> 篇 ·{' '}
          {archive ? (off ? '没开自动归档' : `${props.archiveDays} 天没改过的，左栏不显示；文件没挪，改一下就回到左栏`) : '按修改时间排，左栏只放这周动过的'}
        </span>
        <span className="sp" />
      </div>
      <div className="ix-bar">
        <label className="ix-find">
          <Icon of={Search} size={14} />
          <input aria-label="筛选" placeholder="筛选标题或文件夹" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
          {q && (
            <button className="ix-clear" aria-label="清空筛选" onClick={() => setQ('')}>
              <Icon of={X} size={12} />
            </button>
          )}
        </label>
        <div className="seg" role="tablist" aria-label="类型">
          {kinds.map(([k, name]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {name}
            </button>
          ))}
        </div>
        <span className="sp" />
        <div className="seg" role="tablist" aria-label="排序">
          <button role="tab" aria-selected={!oldFirst} className={!oldFirst ? 'on' : ''} onClick={() => setOldFirst(false)}>
            新的在前
          </button>
          <button role="tab" aria-selected={oldFirst} className={oldFirst ? 'on' : ''} onClick={() => setOldFirst(true)}>
            旧的在前
          </button>
        </div>
      </div>
      <div className="body" ref={body} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {off ? (
          <div className="ix-empty">
            <p>没开自动归档，所有笔记都按「这周动过」进左栏。</p>
            <button className="btn btn-sm" onClick={props.onOpenSettings}>
              <Icon of={Settings} size={14} />
              在设置里打开
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="ix-empty">
            <p>{q || kind !== 'any' ? `没有符合「${[q.trim(), kind !== 'any' ? kinds.find(([k]) => k === kind)![1] : ''].filter(Boolean).join(' · ')}」的笔记` : archive ? '还没有归档的笔记。' : '库里还没有笔记。'}</p>
          </div>
        ) : (
          <div className="ix-list" role="list" aria-label={archive ? '归档的笔记' : '全部笔记'} aria-rowcount={rows.length} style={{ height: rows.length * ROW_H }}>
            {rows.slice(first, last).map((n, i) => {
              const folder = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''
              return (
                <div key={n.path} role="listitem" className="ix-row" style={{ top: (first + i) * ROW_H }}>
                  <button
                    className="ix-open"
                    title={n.path}
                    onClick={() => props.onOpen(n.path)}
                    onContextMenu={(e) => void noteMenu(e, n.path, { rename: setRenaming, trash: props.onTrash, pinned: props.onPinsChanged })}
                  >
                    {n.board ? <i className="sw" style={{ background: n.board.color }} /> : <Icon of={n.kind === 'inbox' ? Inbox : n.kind === 'clip' ? Quote : FileText} size={16} />}
                    {renaming === n.path ? (
                      <RenameInput path={n.path} onDone={() => setRenaming(null)} onRename={props.onRename} />
                    ) : (
                      <span className="t truncate">{titleOf(n.path)}</span>
                    )}
                    {folder && <span className="f truncate">{folder}</span>}
                    {pinSet.has(n.path) && (
                      <span className="pin" title="置顶的">
                        <Icon of={Pin} size={12} />
                      </span>
                    )}
                    {!archive && isArchived(n, now, props.archiveDays, pinSet) && <span className="tag">归档</span>}
                    <span className="d num">{dateOf(n.mtimeMs)}</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
