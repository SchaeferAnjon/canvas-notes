/**
 * 「记进哪篇 ▾」（AI 对话记笔记开关，方向 A，design/ai-note-switch/proto.html 的 target 菜单）：别处的 AI 对话（AiPanel）用。
 * - 看文档：「<这篇>」这篇本身（默认，插在光标处）/ 选的另一篇 / 换一篇…；下面一句这一种在看的默认开关。
 * - 没开东西：收件箱新建一篇「和 AI 聊：<对话名>」/ 找一篇…；下面一句「每段对话打开记笔记时都先问这一句」。
 * 「换一篇…」「找一篇…」就在这个菜单里展开一个找笔记的框（打名字筛，↑↓ 回车选），不另弹窗。
 */
import { Codicon } from '@cn/design'
import { useMemo, useRef, useState } from 'react'
import { type NoteTarget } from '../shared/ai-note'
import { titleOf } from '../shared/layout'
import { FloatPop, type PopAnchor } from './pop-place'
import { useDismiss } from './use-dismiss'
import { useT } from './i18n'

export interface TargetMenuProps {
  at: PopAnchor
  /** 看文档时是那篇（库里的路径）；没开东西是 null */
  doc: string | null
  /** 现在记进的那篇；没开东西、还没选是 null */
  current: NoteTarget | null
  /** 没开东西时收件箱新建那篇的名字（「和 AI 聊：…」）和路径 */
  inbox: NoteTarget | null
  /** 下面那一句：「看文档时默认：记笔记关、旁支关……」/「以后在首页聊：……」 */
  hint: string
  /** 能找的几篇（库里的 md） */
  notes: readonly string[]
  /** 弹它的那颗按钮（点它是开关切换，不算点外面） */
  anchor: HTMLElement | null
  onPick(t: NoteTarget): void
  onClose(): void
}

export function TargetMenu(p: TargetMenuProps) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const anchorRef = useRef(p.anchor)
  anchorRef.current = p.anchor
  const findRef = useRef<HTMLInputElement>(null)
  const [find, setFind] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  useDismiss(true, [ref, anchorRef], () => p.onClose())

  const box = useMemo(() => {
    const r = p.anchor?.closest('.ai-omni')?.parentElement?.querySelector('.aiin')?.getBoundingClientRect()
    return r ? { left: r.left, right: r.right, top: r.top, bottom: r.top } : null
  }, [p.anchor])
  const cur = p.current?.path ?? null
  const other = cur && cur !== p.doc ? cur : null
  const list = useMemo(() => {
    const w = q.trim().toLowerCase()
    return p.notes.filter((n) => n !== cur && (!w || titleOf(n).toLowerCase().includes(w) || n.toLowerCase().includes(w))).slice(0, 6)
  }, [q, p.notes, cur])

  const openFind = () => {
    setFind((v) => !v)
    setHi(0)
    requestAnimationFrame(() => findRef.current?.focus())
  }
  const row = (o: { id: string; check?: boolean | null; icon?: 'inbox' | 'file' | 'search'; name: string; sub?: string; onClick(): void }) => (
    <button key={o.id} className="it" role={o.check === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={o.check ?? undefined} data-testid={`ai-note-to-${o.id}`} onClick={o.onClick}>
      <span className={'ck' + (o.icon ? ' ic' : '')}>{o.icon ? <Codicon name={o.icon} size={14} /> : o.check ? <Codicon name="check" size={12} /> : null}</span>
      <span className="lb">{o.name}</span>
      {o.sub && <span className="r">{o.sub}</span>}
    </button>
  )
  return (
    // 和输入框一样宽、左右边对齐（设计复审，照 p-none），弹在输入框上面；找不到输入框照点的那颗按钮放
    <FloatPop at={box ?? p.at} gap={6} className="ntm-pop" role="menu" aria-label={t('记进哪篇')} data-testid="ai-note-menu" {...(box ? { style: { width: box.right - box.left } } : {})}>
      <div
        className="ntm"
        ref={ref}
        onKeyDown={(e) => {
          if (!find || e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(0, Math.min(list.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1))))
          } else if (e.key === 'Enter' && list[hi]) {
            e.preventDefault()
            p.onPick({ path: list[hi]! })
          }
        }}
      >
        <div className="mh">{t('记进哪篇')}</div>
        {p.doc ? (
          <>
            {row({ id: 'self', check: cur === p.doc, name: titleOf(p.doc), sub: t('这篇本身'), onClick: () => p.onPick({ path: p.doc!, inline: true }) })}
            {other && row({ id: 'other', check: true, name: titleOf(other), sub: t('选的'), onClick: () => p.onPick({ path: other }) })}
            {row({ id: 'find', check: false, name: t('换一篇…'), onClick: openFind })}
          </>
        ) : (
          <>
            {p.current && row({ id: 'cur', check: true, name: titleOf(p.current.path), sub: t('选着的'), onClick: () => p.onPick(p.current!) })}
            {p.inbox && row({ id: 'inbox', icon: 'inbox', name: t('收件箱新建一篇'), sub: titleOf(p.inbox.path), onClick: () => p.onPick(p.inbox!) })}
            {row({ id: 'find', icon: 'file', name: t('找一篇…'), onClick: openFind })}
          </>
        )}
        {find && (
          <div className="find">
            <input ref={findRef} aria-label={t('找一篇')} placeholder={t('打名字找一篇')} value={q} onChange={(e) => (setQ(e.target.value), setHi(0))} />
            <div className="fl" role="listbox" aria-label={t('找到的')}>
              {list.map((n, i) => (
                <button key={n} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''} onMouseEnter={() => setHi(i)} onClick={() => p.onPick({ path: n })}>
                  <span className="lb">{titleOf(n)}</span>
                  <span className="r">{n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : ''}</span>
                </button>
              ))}
              {!list.length && <div className="none">{q.trim() ? t('没有名字里带「{q}」的笔记', { q: q.trim() }) : t('库里还没有笔记')}</div>}
            </div>
          </div>
        )}
        <div className="sep" />
        <div className="note">{p.hint}</div>
      </div>
    </FloatPop>
  )
}

/** 输入框上面那一条提示（中途打开「前面 N 问没记 · 补进去 / 只记以后的」，中途关「之后的不记了…」）：几秒后自己收的由调用的管 */
export function NoteTip(p: { text: string; ok?: boolean; acts?: { label: string; primary?: boolean; onClick(): void }[] }) {
  return (
    <div className="ai-note-tip inline" role="status" data-testid="ai-note-tip">
      {p.ok && <Codicon name="check" size={12} />}
      <span className="tx">{p.text}</span>
      {p.acts?.length ? <span className="sp" /> : null}
      {p.acts?.map((a) => (
        <button key={a.label} className={a.primary ? 'lnk' : 'lnk dim'} onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  )
}
