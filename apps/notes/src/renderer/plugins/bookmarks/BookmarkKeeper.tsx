import { Codicon, type CodiconName } from '@cn/design'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ago, allTags, type BookmarkRow, matchBookmark, SORTS, type SortKey, sortBookmarks, splitTags } from '../../../shared/plugins/bookmarks'
import { decodeUrl } from '../../url'
import { errText, webHost } from '../host'
import type { WebPage } from '../types'
import { ID, removeBookmark, saveBookmark, useBookmarkRows } from './store'

const BAR = '书签栏'

interface Draft {
  title: string
  folder: string
  tags: string[]
  note: string
}

const draftOf = (b: { title: string; folder?: string; tags?: string[]; note?: string }): Draft => ({ title: b.title, folder: b.folder ?? BAR, tags: b.tags ?? [], note: b.note ?? '' })

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const save = saveBookmark
const remove = removeBookmark

/** 标签输入：已有的是小胶囊，回车或逗号加一个，退格删最后一个 */
function TagInput(props: { tags: string[]; suggest: string[]; onChange(t: string[]): void; label: string }) {
  const [text, setText] = useState('')
  const listId = useRef(`bk-tags-${Math.random().toString(36).slice(2, 8)}`).current
  const commit = (value = text) => {
    const add = splitTags(value)
    if (add.length) props.onChange([...props.tags, ...add.filter((t) => !props.tags.includes(t))])
    setText('')
  }
  return (
    <div className="bk-tags-in">
      {props.tags.map((t) => (
        <span key={t} className="bk-tag">
          #{t}
          <button type="button" aria-label={`去掉标签 ${t}`} onClick={() => props.onChange(props.tags.filter((x) => x !== t))}>
            <Codicon name="close" size={10} />
          </button>
        </span>
      ))}
      <input
        aria-label={props.label}
        placeholder={props.tags.length ? '' : '加标签，回车'}
        list={listId}
        value={text}
        onChange={(e) => (/[,，、]$/.test(e.target.value) ? commit(e.target.value) : setText(e.target.value))}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault()
            e.stopPropagation()
            commit()
          } else if (e.key === 'Backspace' && !text && props.tags.length) props.onChange(props.tags.slice(0, -1))
        }}
      />
      <datalist id={listId}>
        {props.suggest
          .filter((t) => !props.tags.includes(t))
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </div>
  )
}

/** 标题、标签、备注、文件夹（收藏这页和改一个书签共用） */
function Fields(props: { d: Draft; onChange(d: Draft): void; folders: string[]; tags: string[]; onEnter(): void; autoFocus?: boolean }) {
  const { d } = props
  const enter = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      props.onEnter()
    }
  }
  const folders = props.folders.includes(d.folder) ? props.folders : [d.folder, ...props.folders]
  return (
    <div className="bk-fields">
      <label>
        <span>标题</span>
        <input aria-label="书签标题" value={d.title} autoFocus={props.autoFocus} onChange={(e) => props.onChange({ ...d, title: e.target.value })} onKeyDown={enter} />
      </label>
      <label>
        <span>标签</span>
        <TagInput label="书签标签" tags={d.tags} suggest={props.tags} onChange={(tags) => props.onChange({ ...d, tags })} />
      </label>
      <label>
        <span>备注</span>
        <input aria-label="书签备注" placeholder="一句话：为什么存它" value={d.note} onChange={(e) => props.onChange({ ...d, note: e.target.value })} onKeyDown={enter} />
      </label>
      <label>
        <span>文件夹</span>
        <select aria-label="书签文件夹" value={d.folder} onChange={(e) => props.onChange({ ...d, folder: e.target.value })}>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

/** 书签管家的弹窗：上面是这一页（收藏 / 改），下面是全部书签（搜、排、按标签筛、改、删、存进库） */
/**
 * mode：this-page 是地址栏星星开的小卡（只管这一页：标题、标签、备注、文件夹，删掉 / 完成，底下一个「整理全部书签」）；
 * all 是整理全部（上面这一页，下面全部书签）
 */
export function BookmarkKeeper(props: { page: WebPage | null; mode?: 'this-page' | 'all'; onClose(): void }) {
  const rows = useBookmarkRows()
  const page = props.page?.url && /^https?:/.test(props.page.url) ? props.page : null
  const mine = page ? rows.find((b) => b.url === page.url) : undefined
  const folders = useMemo(() => [...new Set([BAR, ...rows.map((b) => b.folder)])], [rows])
  const tags = useMemo(() => allTags(rows), [rows])
  const [draft, setDraft] = useState<Draft>(() => draftOf(mine ?? { title: page?.title || page?.url || '' }))
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('added')
  const [tag, setTag] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ id: string; d: Draft } | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const notice = (t: string) => webHost()?.notice(t)
  const root = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState(props.mode === 'this-page' && page ? 'this-page' : 'all')

  // 换了网页、或这一页刚被收藏 / 删掉：表单跟着换
  useEffect(() => setDraft(draftOf(mine ?? { title: page?.title || page?.url || '' })), [page?.url, mine?.id])
  // 点了「改」：那一行露出来
  useEffect(() => {
    if (editing) root.current?.querySelector('.bk-edit')?.scrollIntoView({ block: 'nearest' })
  }, [editing?.id])
  // esc 收起（右键菜单开着时先收菜单）
  const menuRef = useRef(menu)
  menuRef.current = menu
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (menuRef.current) setMenu(null)
      else props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const shown = useMemo(() => sortBookmarks(rows.filter((b) => (!tag || b.tags?.includes(tag)) && matchBookmark(b, q)), sort), [rows, q, sort, tag])
  const dirty = !!mine && JSON.stringify(draftOf(mine)) !== JSON.stringify({ ...draft, title: draft.title.trim() || mine.title })

  async function run(f: () => Promise<void>) {
    setBusy(true)
    try {
      await f()
    } catch (e) {
      notice(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const saveThis = () =>
    page &&
    run(async () => {
      await save({ ...(mine ? { id: mine.id } : {}), url: page.url, ...draft, title: draft.title.trim() || page.title || page.url })
      if (mine) notice('书签改好了')
    })

  const open = (b: BookmarkRow, newTab: boolean) => {
    webHost()?.open(b.url, newTab)
    if (!newTab) props.onClose()
  }

  async function toVault(ids: string[]) {
    await run(async () => {
      const r = await window.cnPlugins.call<{ paths: string[]; commit: string | null }>(ID, 'toVault', ids)
      setPicked(new Set())
      notice(`存进收件箱${r.paths.length}篇${r.commit ? `，一次提交${r.commit.slice(0, 7)}` : ''}`)
    })
  }

  const togglePick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  if (mode === 'this-page' && page)
    return (
      <div ref={root} className="wpop bk bk-card" role="dialog" aria-label="书签管家">
        <section className="bk-this" aria-label="这一页">
          <div className="bk-this-h">
            <Codicon name="bookmark" size={13} className={mine ? 'bk-filled' : ''} />
            <span className="truncate" title={decodeUrl(page.url)}>
              {mine ? `已收藏 · ${ago(mine.addedMs)}` : '收藏这一页'} · {hostOf(page.url)}
            </span>
          </div>
          <Fields d={draft} onChange={setDraft} folders={folders} tags={tags} autoFocus onEnter={() => void saveThis()?.then(props.onClose)} />
          <div className="bk-acts">
            {mine ? (
              <>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run(() => remove(mine.id)).then(props.onClose)}>
                  <Codicon name="trash" size={12} />
                  删掉书签
                </button>
                <span className="sp" />
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void (dirty ? saveThis() : Promise.resolve())?.then(props.onClose)}>
                  <Codicon name="check" size={12} />
                  完成
                </button>
              </>
            ) : (
              <>
                <span className="sp" />
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void saveThis()}>
                  <Codicon name="bookmark" size={12} />
                  收藏这页
                </button>
              </>
            )}
          </div>
        </section>
        <button className="bk-more" onClick={() => setMode('all')}>
          整理全部书签 →
        </button>
      </div>
    )

  return (
    <div ref={root} className="wpop bk" role="dialog" aria-label="书签管家">
      <div className="wlib-head">
        <b>书签管家</b>
        <span className="bk-count num">{`${rows.length}个`}</span>
        <span className="sp" />
        <button className="iconbtn" aria-label="关上书签管家" onClick={props.onClose}>
          <Codicon name="close" size={13} />
        </button>
      </div>

      {page ? (
        <section className="bk-this" aria-label="这一页">
          <div className="bk-this-h">
            <Codicon name="bookmark" size={13} className={mine ? 'bk-filled' : ''} />
            <span className="truncate" title={decodeUrl(page.url)}>
              {mine ? `已收藏 · ${ago(mine.addedMs)}` : '收藏这一页'} · {hostOf(page.url)}
            </span>
          </div>
          <Fields d={draft} onChange={setDraft} folders={folders} tags={tags} onEnter={() => void saveThis()} />
          <div className="bk-acts">
            {mine ? (
              <>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run(() => remove(mine.id))}>
                  <Codicon name="trash" size={12} />
                  删掉书签
                </button>
                <span className="sp" />
                <button className="btn btn-sm btn-primary" disabled={busy || !dirty} onClick={() => void saveThis()}>
                  <Codicon name="check" size={12} />
                  保存
                </button>
              </>
            ) : (
              <>
                <span className="sp" />
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void saveThis()}>
                  <Codicon name="bookmark" size={12} />
                  收藏这页
                </button>
              </>
            )}
          </div>
        </section>
      ) : (
        <p className="hint">右栏开着网页时，这里能一键收藏它。</p>
      )}

      <div className="bk-find">
        <label className="wsearch">
          <Codicon name="search" size={13} />
          <input aria-label="搜书签" placeholder="搜标题、网址、标签、备注" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select aria-label="书签排序" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {tags.length > 0 && (
        <div className="wfolders" role="list" aria-label="按标签筛">
          <button className={'chip' + (tag === null ? ' on' : '')} onClick={() => setTag(null)}>
            全部
          </button>
          {tags.map((t) => (
            <button key={t} className={'chip' + (tag === t ? ' on' : '')} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      <div className="wlist bk-list" role="list" aria-label="书签管家列表">
        {shown.length === 0 && <p className="hint">{rows.length ? '没有搜到。' : '还没有书签。'}</p>}
        {shown.map((b) =>
          editing?.id === b.id ? (
            <div key={b.id} className="bk-edit" role="listitem" aria-label={`改 ${b.title}`}>
              <Fields d={editing.d} onChange={(d) => setEditing({ id: b.id, d })} folders={folders} tags={tags} autoFocus onEnter={() => void run(async () => (await save({ id: b.id, url: b.url, ...editing.d }), setEditing(null)))} />
              <div className="bk-acts">
                <span className="sp" />
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
                  取消
                </button>
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(async () => (await save({ id: b.id, url: b.url, ...editing.d }), setEditing(null)))}>
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div
              key={b.id}
              className={'wrow bk-row' + (picked.has(b.id) ? ' picked' : '')}
              role="listitem"
              aria-label={b.title}
              onContextMenu={(e) => {
                e.preventDefault()
                // 弹窗有毛玻璃（backdrop-filter），里面的 fixed 按弹窗定位：换成相对弹窗的坐标
                const r = root.current!.getBoundingClientRect()
                setMenu({ id: b.id, x: Math.max(8, Math.min(e.clientX - r.left, r.width - 208)), y: Math.min(e.clientY - r.top, r.height - 180) })
              }}
            >
              <input type="checkbox" className="bk-pick" aria-label={`选中 ${b.title}`} checked={picked.has(b.id)} onChange={() => togglePick(b.id)} />
              <button className="wmain" title={decodeUrl(b.url)} onClick={(e) => open(b, e.metaKey)}>
                <b className="truncate">{b.title}</b>
                <span className="truncate">
                  {hostOf(b.url)}
                  {b.tags?.map((t) => (
                    <em key={t} className="bk-t">
                      #{t}
                    </em>
                  ))}
                  {sort === 'visited' ? ` · ${b.lastVisit ? '上次' + ago(b.lastVisit) : '没打开过'}` : ''}
                </span>
                {b.note && <span className="bk-note truncate">{b.note}</span>}
              </button>
              <button className="iconbtn" aria-label={`改书签 ${b.title}`} title="改" onClick={() => setEditing({ id: b.id, d: draftOf(b) })}>
                <Codicon name="edit" size={13} />
              </button>
              <button className="iconbtn" aria-label={`删掉书签 ${b.title}`} title="删掉" onClick={() => void run(() => remove(b.id))}>
                <Codicon name="trash" size={13} />
              </button>
            </div>
          ),
        )}
      </div>

      {picked.size > 0 && (
        <div className="bk-foot">
          <span>{`选了${picked.size}个`}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set())}>
            不选了
          </button>
          <span className="sp" />
          <button className="btn btn-sm" disabled={busy} onClick={() => void toVault([...picked])}>
            <Codicon name="inbox" size={12} />
            存进库
          </button>
        </div>
      )}

      {menu &&
        (() => {
          const b = rows.find((x) => x.id === menu.id)
          if (!b) return null
          const item = (label: string, icon: CodiconName, f: () => void) => (
            <button role="menuitem" onPointerDown={(e) => e.stopPropagation()} onClick={() => (setMenu(null), f())}>
              <Codicon name={icon} size={13} />
              {label}
            </button>
          )
          return (
            <div className="menu bk-menu" role="menu" aria-label="书签菜单" style={{ left: menu.x, top: menu.y }}>
              {item('打开', 'link-external', () => open(b, false))}
              {item('在新标签打开', 'link-external', () => open(b, true))}
              {item('改', 'edit', () => setEditing({ id: b.id, d: draftOf(b) }))}
              {item('存进库', 'inbox', () => void toVault([b.id]))}
              {item('删掉', 'trash', () => void run(() => remove(b.id)))}
            </div>
          )
        })()}
    </div>
  )
}
