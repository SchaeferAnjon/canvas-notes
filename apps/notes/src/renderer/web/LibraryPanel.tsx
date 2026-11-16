import { Codicon } from '@cn/design'
import { useEffect, useMemo, useState } from 'react'
import type { Bookmark, HistoryEntry } from '../../shared/web-api'
import { decodeUrl } from '../url'
import { errText } from '../WebPanel'
import { ProfileMenu } from './ProfileMenu'

/** 书签和历史：书签按文件夹看、删、从 Chrome 导入；历史能搜、从 Chrome 导入 */
export function LibraryPanel(props: {
  bookmarks: Bookmark[]
  onBookmarks(b: Bookmark[]): void
  onOpen(url: string, newTab: boolean): void
  onNotice(t: string): void
  onClose(): void
}) {
  const [tab, setTab] = useState<'bookmarks' | 'history'>('bookmarks')
  const [q, setQ] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (tab !== 'history') return
    let alive = true
    const t = setTimeout(() => void window.cnWeb.history(q, 200).then((h) => alive && setHistory(h)), 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [tab, q])

  const folders = useMemo(() => [...new Set(props.bookmarks.map((b) => b.folder))].sort((a, b) => a.localeCompare(b, 'zh')), [props.bookmarks])
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = props.bookmarks.filter(
    (b) => (!folder || b.folder === folder || b.folder.startsWith(folder + ' / ')) && words.every((w) => (b.title + ' ' + b.url).toLowerCase().includes(w)),
  )

  async function importFrom(id: string) {
    setPicking(false)
    setBusy(true)
    try {
      if (tab === 'bookmarks') {
        const r = await window.cnWeb.importBookmarks(id)
        props.onBookmarks(await window.cnWeb.bookmarks())
        props.onNotice(r.total ? `从 Chrome 导入了 ${r.added} 个书签${r.total > r.added ? `，${r.total - r.added} 个已经有了` : ''}` : '这个 Chrome 用户没有书签')
      } else {
        const r = await window.cnWeb.importHistory(id)
        setHistory(await window.cnWeb.history(q, 200))
        props.onNotice(`从 Chrome 导入了 ${r.added} 条历史`)
      }
    } catch (e) {
      props.onNotice(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wpop wlib" role="dialog" aria-label="书签和历史">
      <div className="wlib-head">
        <div className="seg" role="tablist" aria-label="书签或历史">
          <button role="tab" className={tab === 'bookmarks' ? 'on' : ''} aria-selected={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>
            书签
          </button>
          <button role="tab" className={tab === 'history' ? 'on' : ''} aria-selected={tab === 'history'} onClick={() => setTab('history')}>
            历史
          </button>
        </div>
        <span className="sp" />
        <div className="imp">
          <button className="btn btn-sm" disabled={busy} onClick={() => setPicking((v) => !v)}>
            <Codicon name="desktop-download" size={12} />
            从 Chrome 导入
          </button>
          {picking && (
            <ProfileMenu
              label="选 Chrome 用户"
              title={tab === 'bookmarks' ? '导入哪个 Chrome 用户的书签？' : '导入哪个 Chrome 用户的历史？'}
              onPick={(id) => void importFrom(id)}
              onNotice={props.onNotice}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      </div>
      <label className="wsearch">
        <Codicon name="search" size={13} />
        <input aria-label={tab === 'bookmarks' ? '搜书签' : '搜历史'} placeholder={tab === 'bookmarks' ? '搜书签' : '搜历史：标题或网址'} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      {tab === 'bookmarks' ? (
        <>
          {folders.length > 1 && (
            <div className="wfolders" role="list" aria-label="书签文件夹">
              <button className={'chip' + (folder === null ? ' on' : '')} onClick={() => setFolder(null)}>
                全部
              </button>
              {folders.map((f) => (
                <button key={f} className={'chip' + (folder === f ? ' on' : '')} title={f} onClick={() => setFolder(folder === f ? null : f)}>
                  <Codicon name="folder" size={11} />
                  {f.split(' / ').pop()}
                </button>
              ))}
            </div>
          )}
          <div className="wlist" role="list" aria-label="书签">
            {shown.length === 0 && <p className="hint">{props.bookmarks.length ? '没有搜到。' : '还没有书签。点地址栏里的星星加一个，或者从 Chrome 导入。'}</p>}
            {shown.map((b) => (
              <div key={b.id} className="wrow" role="listitem">
                <button className="wmain" title={b.url} onClick={(e) => (props.onOpen(b.url, e.metaKey), props.onClose())}>
                  <b className="truncate">{b.title}</b>
                  <span className="truncate">{folder ? decodeUrl(b.url) : b.folder}</span>
                </button>
                <button
                  className="iconbtn"
                  aria-label={`删掉书签 ${b.title}`}
                  title="删掉书签"
                  onClick={async () => {
                    try {
                      props.onBookmarks(await window.cnWeb.removeBookmark(b.id))
                    } catch (e) {
                      props.onNotice(errText(e))
                    }
                  }}
                >
                  <Codicon name="trash" size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="wlist" role="list" aria-label="历史">
          {history.length === 0 && <p className="hint">{q ? '没有搜到。' : '还没有浏览记录。'}</p>}
          {history.map((h) => (
            <div key={h.url} className="wrow" role="listitem">
              <button className="wmain" title={h.url} onClick={(e) => (props.onOpen(h.url, e.metaKey), props.onClose())}>
                <b className="truncate">{h.title || decodeUrl(h.url)}</b>
                <span className="truncate">{decodeUrl(h.url)}</span>
              </button>
              <span className="when num">{when(h.lastVisit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function when(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}-${d.getDate()}` : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
