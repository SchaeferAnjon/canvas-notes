/**
 * 白板右边一格「收件箱」（2026-11-21 方向 A3，原来右上的「N未整理」「收件箱 N ⌄」）：
 * 只放收件箱；靠右、画布让出这一格，不盖住卡；每一条是干净的卡（标题、两行、出处），不露原文（偏好「剪藏卡片别露原文」）；
 * 按「今天 / 更早」分组，超过 20 条顶上多一个搜索框（偏好「别把上万条全铺开」）。
 * 开关在标签条右端「收件箱 N」（InboxButton），开着还是收着记在本机（几块白板共用一个）。拖一条到白板上交给白板（onItemDown）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { NoteFile } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import { when } from '../../shared/when'
import { domainOf } from '../CardBody'
import { imageSrc } from '../md-widgets'

// ---------- 开着还是收着：记在本机 ----------

const KEY = 'cn.board.inbox'
const subs = new Set<() => void>()
function readOpen(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}
let open = readOpen()
export function setInboxOpen(v: boolean) {
  open = v
  try {
    localStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    // 存不下（隐私模式）也照样开关，只是不记
  }
  for (const f of subs) f()
}
export function useInboxOpen(): boolean {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => open,
  )
}

/** 收件箱里的（不算这一篇自己），新的在前 */
export const inboxOf = (notes: NoteFile[], self: string) => notes.filter((n) => n.kind === 'inbox' && n.path !== self).sort((a, b) => b.createdMs - a.createdMs)

/** 标签条右端「收件箱 N」：开关右边那一格 */
export function InboxButton(props: { count: number }) {
  const on = useInboxOpen()
  return (
    <button
      type="button"
      className={'ab-act wt db-inbox-btn' + (on ? ' on' : '')}
      aria-pressed={on}
      aria-label={`收件箱${props.count ? ` ${props.count}条` : ''}`}
      data-testid="db-inbox"
      data-tip={on ? '收起右边的收件箱' : '打开右边的收件箱：拖进一列，就放进文档的那一节'}
      data-side="below"
      onClick={() => setInboxOpen(!on)}
    >
      <Codicon name="inbox" size={14} />
      <span className="lb">收件箱</span>
      {props.count > 0 && <span className="cnt num">{props.count}</span>}
    </button>
  )
}

// ---------- 一条长什么样 ----------

type Face = { k: 'clip'; title: string; sum: string; domain: string; thumb: string | null } | { k: 'quick'; text: string } | { k: 'image'; src: string; name: string; domain: string }

/** 读那一篇的字（剪藏要第一张图当缩略图、图要认出来）；只读看得到的这几条 */
function useText(path: string): string | null {
  const [t, setT] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.readNote(path).then(
      (n) => live && setT(n.text),
      () => live && setT(''),
    )
    return () => void (live = false)
  }, [path])
  return t
}

const IMG = /!\[([^\]]*)\]\(([^)\s]+)/

function faceOf(n: NoteFile, text: string | null): Face {
  const body = (text ?? '').replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^#\s+[^\n]*\n*/, '').trim()
  const img = IMG.exec(body)
  // 只有一张图（手机发来的、拖进收件箱的）：画图
  if (img && body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^——.*$/gm, '').trim() === '')
    return { k: 'image', src: imageSrc(n.path, img[2]!), name: img[1] || titleOf(n.path), domain: n.source ? domainOf(n.source) : '收件箱' }
  if (n.source) return { k: 'clip', title: titleOf(n.path), sum: n.excerpt ?? '', domain: domainOf(n.source), thumb: img ? imageSrc(n.path, img[2]!) : null }
  return { k: 'quick', text: n.excerpt || n.preview || titleOf(n.path) }
}

function Item(props: { n: NoteFile; onDown(e: React.MouseEvent, n: NoteFile): void }) {
  const { n } = props
  const text = useText(n.path)
  const f = faceOf(n, text)
  const at = when(n.createdMs, { time: true })
  return (
    <div
      className={'dbr-item dbr-' + f.k}
      role="listitem"
      aria-label={f.k === 'clip' ? f.title : f.k === 'image' ? f.name : f.text}
      data-path={n.path}
      title="拖进一列，就放进文档的那一节；拖到空白处，就放在那里"
      onMouseDown={(e) => props.onDown(e, n)}
    >
      {f.k === 'clip' && (
        <>
          <div className="dbr-row">
            {f.thumb && <div className="dbr-th" style={{ backgroundImage: `url("${f.thumb}")` }} />}
            <div className="dbr-tx">
              <div className="dbr-ttl">{f.title}</div>
              {f.sum && <div className="dbr-sum">{f.sum}</div>}
            </div>
          </div>
          <div className="dbr-src">
            <Codicon name="globe" size={12} />
            <span className="truncate">{f.domain}</span>
            <span className="dbr-t">{at}</span>
          </div>
        </>
      )}
      {f.k === 'quick' && (
        <>
          <div className="dbr-tx">{f.text}</div>
          <div className="dbr-src">
            <Codicon name="note" size={12} />
            <span>{`速记 · ${at}`}</span>
          </div>
        </>
      )}
      {f.k === 'image' && (
        <>
          <div className="dbr-img">
            <img src={f.src} alt="" draggable={false} />
          </div>
          <div className="dbr-tx dbr-ttl">{f.name}</div>
          <div className="dbr-src">
            <Codicon name="file-media" size={12} />
            <span className="truncate">{f.domain}</span>
            <span className="dbr-t">{at}</span>
          </div>
        </>
      )}
    </div>
  )
}

/** 右边一格 */
export function InboxDrawer(props: { items: NoteFile[]; readOnly: boolean; onItemDown(e: React.MouseEvent, n: NoteFile): void }) {
  const [q, setQ] = useState('')
  const all = props.items
  const s = q.trim().toLowerCase()
  const shown = s ? all.filter((n) => titleOf(n.path).toLowerCase().includes(s) || (n.excerpt ?? '').toLowerCase().includes(s)) : all
  const start = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  const today = shown.filter((n) => n.createdMs >= start)
  const older = shown.filter((n) => n.createdMs < start)
  const down = (e: React.MouseEvent, n: NoteFile) => !props.readOnly && e.button === 0 && props.onItemDown(e, n)
  return (
    <aside className="db-drawer" aria-label="收件箱" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="dbr-head">
        <Codicon name="inbox" size={15} />
        <b>收件箱</b>
        <span className="num">{`${all.length}条`}</span>
        <span className="grow" />
        <button type="button" className="dbr-close" aria-label="收起收件箱" data-tip="收起（再点标签条上的「收件箱」打开）" data-side="left" onClick={() => setInboxOpen(false)}>
          <Codicon name="layout-sidebar-right-off" size={15} />
        </button>
      </div>
      {all.length ? (
        <>
          <div className="dbr-hint">拖进一列，就放进文档的那一节；拖到空白处，就放在那里。</div>
          {all.length > 20 && (
            <label className="dbr-search">
              <Codicon name="search" size={13} />
              <input aria-label="在收件箱里找" placeholder="在收件箱里找" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            </label>
          )}
          <div className="dbr-list" role="list" aria-label="收件箱里的">
            {today.length > 0 && <div className="dbr-grp">今天</div>}
            {today.map((n) => (
              <Item key={n.path} n={n} onDown={down} />
            ))}
            {older.length > 0 && <div className="dbr-grp">更早</div>}
            {older.map((n) => (
              <Item key={n.path} n={n} onDown={down} />
            ))}
            {!shown.length && <div className="dbr-none">{`收件箱里没有「${q.trim()}」`}</div>}
          </div>
        </>
      ) : (
        <div className="dbr-empty">
          <Codicon name="inbox" size={32} />
          <b>收件箱是空的</b>
          剪藏、速记、手机发来的都先到这里。
        </div>
      )}
    </aside>
  )
}
