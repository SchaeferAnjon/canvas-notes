import { when } from '../shared/when'
import { PageNote, TabActs } from './shell/TabActs'
import { Codicon } from '@cn/design'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { type ArchiveDays, isArchived } from '../shared/sidebar'
import { RenameInput } from './note-menu'
import { onFileMenu } from './ctx/file-menu'
import { fileIcon } from './Palette'
import './note-index.css'
import { rich, useT } from './i18n'

type Kind = 'any' | 'work' | 'board' | 'clip' | 'inbox'
// 不翻：键，画的地方翻
const KINDS: [Kind, string][] = [
  ['any', '全部'], // 不翻
  ['work', '文档'], // 不翻
  ['board', '白板'], // 不翻
  ['clip', '剪藏'], // 不翻
  ['inbox', '收件箱'], // 不翻
]
const kindOf = (n: NoteFile): Kind => (n.board ? 'board' : n.kind)

/** 一行 36 高；只画看得见的那几十行，几千篇也不卡 */
export const ROW_H = 36
const OVERSCAN = 10

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
  onOpenSettings(): void
}) {
  const t = useT()
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
      <TabActs active>
        <PageNote>
          {rich(archive ? (off ? t('{count} · 没开自动归档') : t('{count} · {n}天没改过的，左栏不显示', { n: props.archiveDays })) : t('{count} · 按修改时间排'), {
            count: <span className="num">{t('{n}篇', { n: pool.length })}</span>,
          })}
        </PageNote>
      </TabActs>
      <div className="ix-bar">
        <label className="ix-find">
          <Codicon name="search" size={14} />
          <input aria-label={t('筛选')} placeholder={t('筛选标题或文件夹')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
          {q && (
            <button className="ix-clear" aria-label={t('清空筛选')} onClick={() => setQ('')}>
              <Codicon name="close" size={12} />
            </button>
          )}
        </label>
        <div className="seg" role="tablist" aria-label={t('类型')}>
          {kinds.map(([k, name]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {t(name)}
            </button>
          ))}
        </div>
        <span className="sp" />
        <div className="seg" role="tablist" aria-label={t('排序')}>
          <button role="tab" aria-selected={!oldFirst} className={!oldFirst ? 'on' : ''} onClick={() => setOldFirst(false)}>
            {t('新的在前')}
          </button>
          <button role="tab" aria-selected={oldFirst} className={oldFirst ? 'on' : ''} onClick={() => setOldFirst(true)}>
            {t('旧的在前')}
          </button>
        </div>
      </div>
      <div className="body" ref={body} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {off ? (
          <div className="ix-empty">
            <p>{t('没开自动归档，所有笔记都按「这周动过」进左栏。')}</p>
            <button className="btn btn-sm" onClick={props.onOpenSettings}>
              <Codicon name="settings-gear" size={14} />
              {t('在设置里打开')}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="ix-empty">
            <p>{q || kind !== 'any' ? t('没有符合「{what}」的笔记', { what: [q.trim(), kind !== 'any' ? t(kinds.find(([k]) => k === kind)![1]) : ''].filter(Boolean).join(' · ') }) : archive ? t('还没有归档的笔记。') : t('库里还没有笔记。')}</p>
          </div>
        ) : (
          <div className="ix-list" role="list" aria-label={archive ? t('归档的笔记') : t('全部笔记')} aria-rowcount={rows.length} style={{ height: rows.length * ROW_H }}>
            {rows.slice(first, last).map((n, i) => {
              const folder = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''
              return (
                <div key={n.path} role="listitem" className="ix-row" style={{ top: (first + i) * ROW_H }}>
                  <button
                    className="ix-open"
                    title={n.path}
                    onClick={() => props.onOpen(n.path)}
                    onContextMenu={(e) => onFileMenu(e, n.path, { rename: () => setRenaming(n.path) })}
                  >
                    {n.board ? <i className="sw" style={{ background: n.board.color }} /> : <Codicon name={fileIcon(n.path, false, n.digest)} size={16} />}
                    {renaming === n.path ? (
                      <RenameInput path={n.path} onDone={() => setRenaming(null)} onRename={props.onRename} />
                    ) : (
                      <span className="t truncate">{titleOf(n.path)}</span>
                    )}
                    {folder && <span className="f truncate">{folder}</span>}
                    {pinSet.has(n.path) && (
                      <span className="pin" title={t('置顶的')}>
                        <Codicon name="pin" size={12} />
                      </span>
                    )}
                    {!archive && isArchived(n, now, props.archiveDays, pinSet) && <span className="tag">{t('归档')}</span>}
                    <span className="d num">{when(n.mtimeMs)}</span>
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
