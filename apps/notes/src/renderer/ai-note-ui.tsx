/**
 * AI 对话记笔记开关的几样小东西（2026-11-24 方向 A，shared/ai-note.ts）：读 PDF 的 AI、别处的 AI 对话共用。
 * - RecChip：头上「● 正在记进《…》」（强调色呼吸点，不用红；旁支关着时后面加「· 旁支不记」），点了打开那篇。
 * - NotedLine：每条记了的回答下面「✓ 已记进《…》 · 撤回」；正在记、没记成也在这一行。
 * - NoteTargetMenu：输入框下面「《记进哪篇》▾」弹的菜单（原型 proto.html 的 target 菜单：一组几项、一句默认的说明）。
 * - NoteTip：中途拨开关时输入框上面那一条（「前面 N 问没记 · 补进去 / 只记以后的」「之后的不记了……」）。
 */
import { Codicon } from '@cn/design'
import { noteName } from '../shared/ai-note'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDismiss } from '@cn/ai-chat/use-dismiss'
import { useT } from './i18n'
import './ai-note.css'


export function RecChip(p: { target: string; side: boolean; onOpen?: () => void }) {
  const t = useT()
  const text = t('正在记进《{name}》', { name: noteName(p.target, 22) }) + (p.side ? '' : ' · ' + t('旁支不记'))
  return (
    <div className="ai-rec-row">
      <button className="rec-chip" data-testid="ai-note-rec" data-tip={t('这段对话答一条记一条，点了打开那篇')} data-side="below" onClick={p.onOpen} disabled={!p.onOpen}>
        <i className="dot" aria-hidden="true" />
        <span className="tx">{text}</span>
      </button>
    </div>
  )
}

export type NotedState = { state: 'writing' } | { state: 'done'; to: string; undoing?: boolean } | { state: 'error'; error: string }

export function NotedLine(p: { s: NotedState; onUndo?: () => void; onOpen?: () => void; testId?: string }) {
  const t = useT()
  const s = p.s
  if (s.state === 'writing')
    return (
      <div className="noted" data-testid={p.testId ?? 'ai-noted'} data-state="writing">
        <Codicon name="loading" size={12} className="spin" />
        {t('正在记进笔记…')}
      </div>
    )
  if (s.state === 'error')
    return (
      <div className="noted err" data-testid={p.testId ?? 'ai-noted'} data-state="error">
        {t('没记进笔记：{why}', { why: s.error })}
      </div>
    )
  return (
    <div className="noted" data-testid={p.testId ?? 'ai-noted'} data-state="done">
      <Codicon name="check" size={12} />
      {p.onOpen ? (
        <button className="lnk" onClick={p.onOpen}>
          {t('已记进《{name}》', { name: noteName(s.to, 18) })}
        </button>
      ) : (
        <span>{t('已记进《{name}》', { name: noteName(s.to, 18) })}</span>
      )}
      {p.onUndo && (
        <>
          <span aria-hidden="true">·</span>
          <button className="lnk undo" data-testid="ai-noted-undo" disabled={s.undoing} onClick={p.onUndo}>
            {t('撤回')}
          </button>
        </>
      )}
    </div>
  )
}

export interface NoteTargetItem {
  id: string
  label: string
  /** 右边灰字（「配对的那篇」「挂在下面」） */
  sub?: string
  checked?: boolean
  onClick?: () => void
}

/** 「记进哪篇 ▾」的菜单：贴着按钮往上弹（输入框在底下），左边和按钮对齐；点一项、点外面、esc 收起 */
export function NoteTargetMenu(p: { anchor: HTMLElement; items: NoteTargetItem[]; foot?: string; onClose(): void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const at = useRef<HTMLElement | null>(p.anchor)
  at.current = p.anchor
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const a = p.anchor.getBoundingClientRect()
    const h = ref.current?.offsetHeight ?? 0
    const w = ref.current?.offsetWidth ?? 280
    setPos({ left: Math.max(8, Math.min(a.left, window.innerWidth - w - 8)), top: Math.max(8, a.top - h - 6) })
  }, [p.anchor, p.items.length])
  useDismiss(true, [ref, at], p.onClose)
  return createPortal(
    <div ref={ref} className="ai-menu ai-note-menu" role="menu" aria-label={t('记进哪篇')} data-testid="ai-note-menu" data-composer-pop="" style={pos ?? { left: -9999, top: -9999 }}>
      <div className="mh">{t('记进哪篇')}</div>
      {p.items.map((it) => (
        <button
          key={it.id}
          className="it"
          role="menuitemradio"
          aria-checked={!!it.checked}
          data-id={it.id}
          onClick={() => {
            p.onClose()
            it.onClick?.()
          }}
        >
          <span className="ck">{it.checked && <Codicon name="check" size={14} />}</span>
          <span className="nm">{it.label}</span>
          {it.sub && <span className="r">{it.sub}</span>}
        </button>
      ))}
      {p.foot && (
        <>
          <div className="sep" />
          <div className="sub">{p.foot}</div>
        </>
      )}
    </div>,
    document.body,
  )
}

export interface NoteTipState {
  text: string
  /** 两颗：先是强调色的（补进去），后是灰的（只记以后的） */
  acts?: { label: string; run(): void; dim?: boolean }[]
  ok?: boolean
}

/** 输入框上面那一条提示（灰底圆角，字后面一两颗按钮） */
export function NoteTip(p: { tip: NoteTipState }) {
  return (
    <div className="ai-note-tip inline" role="status" data-testid="ai-note-tip">
      {p.tip.ok && <Codicon name="check" size={12} />}
      <span className="tx">{p.tip.text}</span>
      {p.tip.acts?.length ? <span className="sp" /> : null}
      {p.tip.acts?.map((a) => (
        <button key={a.label} className={'lnk' + (a.dim ? ' dim' : '')} onClick={a.run}>
          {a.label}
        </button>
      ))}
    </div>
  )
}
