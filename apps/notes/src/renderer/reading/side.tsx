/**
 * 旁支（CN-90 方向 A「照 Dispatch 旁支」，小样 A-AI与读PDF/v2/proto-a.html）：
 * - AskBox：在主对话的回答里选中一句，选区下方 300 宽的小框：上面一格能先打问题，下面「引用进输入框 ⇧⌘L」「问这句 ↵」；
 *   空着问就在下格打开旁支、光标在旁支的输入框里，打了问题回车直接问；
 * - SideCell：右栏 AI 那一格的下格（上格是 AI 或笔记），中间一条能拖的线（默认下格 55%、最矮 201、上格最矮 420，双击回默认；
 *   窗口变矮到两头放不下时旁支自己收成格头那一条，再变高展开回来）；
 *   格头「旁支 · 名字 · 来自第 28 页」，右边 ⋯（改名、删掉、这一份 PDF 的旁支）和 ×，点格头收成 29 高的一条（在答 / 1 条新回答）；
 *   最上面引用片（指着它主对话那句亮、点它滚回那句亮 1.4 秒），下面问答，答完输入框上面「放进主对话 · 在笔记里看 · 拷贝」；
 *   输入框是共用的那个（composer.tsx），不放「谁来答」（引擎跟主对话），空着回车问「讲讲这句」；焦点在旁支里按 esc 或点 × 关掉。
 * 旁支的问答存在读 PDF 的对话记录里（store.ts），重开软件还在；答完记进笔记，挂在被问那一问的回答后面。
 */
import { Codicon } from '@cn/design'
import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReadingSide } from '../../shared/reading'
import { withoutVizMark } from '../../shared/reading'
import { AiError } from '../ai-error'
import { AiInput, MatMsg, sendText, useComposer, useConvPick } from '../composer'
import { copy } from '../ctx/menu'
import { Markdown } from '../md-render'
import { useDismiss } from '../use-dismiss'
import { litQuote, rangeText } from './marks'
import * as R from './store'

/** 下格开着时上格、下格、中间那条线共用的样子：收成一条、拖过的高低（CSS 按 --share 算，见 side.css） */
export function splitOf(r: R.Reading): { className: string; style?: CSSProperties } | null {
  if (!r.side.open || !(r.state.sides ?? []).some((s) => s.id === r.side.open)) return null
  return { className: 'with-side' + (r.side.fold ? ' side-fold' : ''), ...(r.side.share !== null ? { style: { ['--share' as string]: String(r.side.share) } } : {}) }
}

// ---------- 选中一句：小框 ----------

/** 选区在主对话某条 AI 回答的正文里：那句话、那条回答的 id 和来源 */
function answerSelection(list: HTMLElement | null): { text: string; rect: DOMRect; msg: number; src: string; range: Range } | null {
  const sel = window.getSelection()
  if (!list || !sel || sel.isCollapsed || !sel.rangeCount) return null
  const at = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest('.am .txt') ?? null
  const a = at(sel.anchorNode)
  if (!a || a !== at(sel.focusNode) || !list.contains(a)) return null
  const am = a.closest<HTMLElement>('.am[data-msg]')
  if (!am) return null
  const range = sel.getRangeAt(0)
  const text = rangeText(range)
  if (text.length < 2) return null
  return { text, rect: range.getBoundingClientRect(), msg: Number(am.dataset.msg), src: am.dataset.src ?? 'AI的回答', range: range.cloneRange() }
}

/**
 * 主对话的回答里选中一句：选区下方 8、横着居中的小框（照 Dispatch 回复里选字出来的框）。
 * 小框用 use-dismiss：点外面、失焦收起，esc 收起并取消选区；⇧⌘L 有选区就引用
 */
export function AskBox(p: {
  list: RefObject<HTMLElement | null>
  active: boolean
  onQuote(text: string, src: string): void
  /** range：选中的那几个字（开旁支时上格变矮，靠它把这句留在看得见的地方） */
  onAsk(at: { msg: number; quote: string }, question: string, range: Range): void
}) {
  const [box, setBox] = useState<{ text: string; msg: number; src: string; cx: number; bottom: number; range: Range } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(p)
  cb.current = p
  useDismiss(!!box, [ref], (why) => {
    if (why === 'esc') window.getSelection()?.removeAllRanges()
    setBox(null)
  })
  const ask = (question: string) => {
    if (!box) return
    const b = box
    window.getSelection()?.removeAllRanges()
    setBox(null)
    cb.current.onAsk({ msg: b.msg, quote: b.text }, question.trim(), b.range)
  }
  const quote = () => {
    if (!box) return
    const b = box
    window.getSelection()?.removeAllRanges()
    setBox(null)
    cb.current.onQuote(b.text, b.src)
  }
  const askRef = useRef(ask)
  askRef.current = ask
  const quoteRef = useRef(quote)
  quoteRef.current = quote
  useEffect(() => {
    const list = p.list.current
    if (!list || !p.active) return
    const up = () =>
      setTimeout(() => {
        const s = answerSelection(list)
        if (!s) return
        setQ('')
        setPos(null)
        setBox({ text: s.text, msg: s.msg, src: s.src, cx: s.rect.left + s.rect.width / 2, bottom: s.rect.bottom, range: s.range })
      }, 0)
    const key = (e: KeyboardEvent) => {
      if (e.isComposing) return
      // ⇧⌘L：选着回答里的一段就引用进输入框（小框开着、没开都行）
      if (e.metaKey && e.shiftKey && e.code === 'KeyL') {
        const s = answerSelection(list)
        if (!s) return
        e.preventDefault()
        e.stopPropagation()
        window.getSelection()?.removeAllRanges()
        setBox(null)
        cb.current.onQuote(s.text, s.src)
      }
    }
    // 回答区滚了：小框不跟着跑，收起
    const scroll = () => setBox(null)
    list.addEventListener('mouseup', up)
    list.addEventListener('scroll', scroll)
    window.addEventListener('keydown', key, true)
    return () => {
      list.removeEventListener('mouseup', up)
      list.removeEventListener('scroll', scroll)
      window.removeEventListener('keydown', key, true)
    }
  }, [p.list, p.active])
  // 小框开着、焦点不在输入的地方：回车就是「问这句」
  useEffect(() => {
    if (!box) return
    const enter = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.metaKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('textarea, input, [contenteditable="true"]')) return
      e.preventDefault()
      askRef.current('')
    }
    window.addEventListener('keydown', enter)
    return () => window.removeEventListener('keydown', enter)
  }, [box])
  // 量了高再放：选区下方 8、横着居中；左右收进 AI 那一格（离两边 8，不压到 PDF 栏上），格子比小框还窄时贴着格子右边；下面放不下贴着窗口底
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !box || pos) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const cell = (p.list.current?.closest('aside') ?? document.body).getBoundingClientRect()
    const lo = cell.left + 8
    const hi = Math.min(cell.right, window.innerWidth) - w - 8
    const left = hi < lo ? Math.max(8, hi) : Math.max(lo, Math.min(box.cx - w / 2, hi))
    setPos({ left, top: Math.max(8, Math.min(box.bottom + 8, window.innerHeight - h - 12)) })
  }, [box, pos, p.list])
  if (!box) return null
  return createPortal(
    <div ref={ref} className="menu askbox" role="dialog" aria-label="选中的这句" data-composer-pop="" style={pos ?? { left: box.cx, top: box.bottom + 8, visibility: 'hidden' }}>
      <textarea
        rows={1}
        value={q}
        aria-label="问这句"
        placeholder="问这句…（空着 ↵ 就是打开旁支自己打）"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.stopPropagation()
            ask(q)
          }
        }}
      />
      <div className="sep" />
      <button className="it" onMouseDown={(e) => e.preventDefault()} onClick={quote}>
        <span className="ck">
          <Codicon name="quote" size={14} />
        </span>
        引用进输入框<span className="r">⇧⌘L</span>
      </button>
      <button className="it" onMouseDown={(e) => e.preventDefault()} onClick={() => ask(q)}>
        <span className="ck">
          <Codicon name="comment-discussion" size={14} />
        </span>
        问这句<span className="r">↵</span>
      </button>
    </div>,
    document.body,
  )
}

// ---------- 下格 ----------

/** 上格最矮 420 + 下格最矮 201：这一格比这矮了，两头都放不下（side.css 的 --pane） */
export const SIDE_ROOM = 420 + 201

/** 那一条回答原文（放进主对话、拷贝用）：去掉可视化、配图那两行标记 */
const answerOf = (s: ReadingSide) => {
  const last = [...s.msgs].reverse().find((m) => m.role === 'ai' && m.text.trim() && !m.error)
  return last ? withoutVizMark(last.text).text : ''
}

export function SideCell(props: { pdf: string; view: 'ai' | 'notes'; onView(v: 'ai' | 'notes'): void; onNotice(text: string): void }) {
  const { pdf } = props
  const r = R.useReading(pdf)!
  const side = (r.state.sides ?? []).find((s) => s.id === r.side.open)!
  const split = splitOf(r)!
  const fold = r.side.fold
  const c = useComposer(props.onNotice)
  // 模型、effort 跟主对话（这份 PDF 的对话选的）；「谁来答」不放，引擎跟主对话
  const cp = useConvPick(r.state.pick, (p) => R.setPick(pdf, p), props.onNotice)
  const list = useRef<HTMLDivElement>(null)
  const cell = useRef<HTMLElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [drag, setDrag] = useState(false)
  const thread = r.state.threads.find((t) => t.id === side.thread)
  const page = thread?.page ?? 0
  const title = r.note.sections.find((s) => s.id === side.thread)?.title ?? (page > 0 ? `第 ${page} 页` : '')
  const name = R.sideName(side)
  const running = r.sideRunning[side.id] !== undefined
  const asked = side.msgs.some((m) => m.role === 'user')
  const answered = side.msgs.some((m) => m.role === 'ai' && m.text.trim() && !m.error)

  // 换了一条旁支：输入框清掉；打开、切过来的那一下光标进旁支的输入框
  useEffect(() => {
    c.clear()
    setRenaming(null)
    setCopied(false)
    requestAnimationFrame(() => {
      if (R.takeSideFocus()) c.ta.current?.focus()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side.id])
  // 窗口变矮到两头都放不下（这一格从够高变成不够高）：旁支先收成格头那一条，主对话照旧能读；又变高了，是自己收的就展开回来。
  // 刚打开旁支时不收（人就是要看它）；人自己点过格头就不再替他展开
  const autoFold = useRef(false)
  const foldNow = useRef(fold)
  foldNow.current = fold
  useEffect(() => {
    const me = cell.current
    if (!me) return
    let prev: number | null = null
    const check = () => {
      const top = document.querySelector<HTMLElement>('.win > aside.right.aicell.with-side:not([hidden])')
      if (!top) return
      const room = top.offsetHeight + me.offsetHeight
      if (prev !== null && prev >= SIDE_ROOM && room < SIDE_ROOM && !foldNow.current) {
        autoFold.current = true
        R.foldSide(pdf, true)
      } else if (room >= SIDE_ROOM && autoFold.current && foldNow.current) {
        autoFold.current = false
        R.foldSide(pdf, false)
      }
      prev = room
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [pdf])
  const toggle = () => {
    autoFold.current = false
    R.foldSide(pdf, !fold)
  }

  // 新消息、边答边显示：滚到底
  const tail = side.msgs.length ? side.msgs[side.msgs.length - 1]!.text.length : 0
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [side.msgs.length, tail, side.id, fold])

  function send() {
    const mats = c.plain()
    const text = sendText(c.text, mats)
    c.clear()
    void R.sendSide(pdf, side.id, text, mats)
  }

  // 拖两格之间的线：下格的高 = 按下时的高 - 往下挪的；按 AI 那一格的高算比例（CSS 再夹到最矮 201、上格最矮 32）
  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (fold || e.button !== 0) return
    e.preventDefault()
    const top = document.querySelector<HTMLElement>('.win > aside.right.aicell.with-side:not([hidden])')
    const me = cell.current
    if (!top || !me) return
    const room = top.offsetHeight + me.offsetHeight
    const y0 = e.clientY
    const h0 = me.offsetHeight
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(true)
    const move = (ev: PointerEvent) => R.setSideShare(pdf, Math.max(0, Math.min(1, (h0 - (ev.clientY - y0)) / room)))
    const end = () => {
      setDrag(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const sub = renaming !== null ? null : fold ? (running ? <span className="s shimmer">· 在答</span> : r.side.unread ? <span className="s new">{`· ${r.side.unread} 条新回答`}</span> : <span className="s">{`· ${name}`}</span>) : <span className="s">{`· ${name}${page > 0 ? ` · 来自第 ${page} 页` : ''}`}</span>

  return (
    <>
      <div
        className={'side-sash ' + split.className + (drag ? ' on' : '')}
        style={split.style}
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖着调高低，双击回默认"
        title="拖着调高低，双击回默认"
        onPointerDown={startDrag}
        onDoubleClick={() => R.setSideShare(pdf, null)}
      />
      <aside
        ref={cell}
        className={'right aicell reading-side ' + split.className + (drag ? ' dragging' : '')}
        style={split.style}
        aria-label="旁支"
        onKeyDown={(e) => {
          // 焦点在旁支里按 esc：关掉旁支（弹出来的菜单先收，use-dismiss 拦住了）
          if (e.key === 'Escape' && !e.nativeEvent.isComposing && renaming === null) {
            e.preventDefault()
            R.closeSide(pdf)
          }
        }}
      >
        <div
          className="sh"
          role="button"
          tabIndex={0}
          aria-expanded={!fold}
          aria-label={fold ? '展开旁支' : '收起旁支'}
          title="点一下收起 / 展开"
          onClick={(e) => {
            if ((e.target as Element).closest('.ib, input')) return
            toggle()
            // 展开：光标回到旁支的输入框
            if (fold) requestAnimationFrame(() => c.ta.current?.focus())
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
              e.preventDefault()
              toggle()
            }
          }}
        >
          <Codicon name="chevron-down" size={12} className="cv" />
          <Codicon name="comment-discussion" size={14} className="ic" />
          <b>旁支</b>
          {renaming !== null ? (
            <input
              className="rn"
              aria-label="旁支的名字"
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') {
                  e.preventDefault()
                  R.renameSide(pdf, side.id, renaming)
                  setRenaming(null)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setRenaming(null)
                }
              }}
              onBlur={() => {
                R.renameSide(pdf, side.id, renaming)
                setRenaming(null)
              }}
            />
          ) : (
            sub
          )}
          <span className="ibs">
            <button ref={menuBtn} className={'ib' + (menu ? ' open' : '')} aria-label="旁支菜单" aria-haspopup="menu" aria-expanded={menu} data-tip="改名、删掉、别的旁支" data-side="below" onClick={() => setMenu((v) => !v)}>
              <Codicon name="ellipsis" size={14} />
            </button>
            <button className="ib" aria-label="关掉旁支" data-tip="关掉旁支 esc" data-side="below" onClick={() => R.closeSide(pdf)}>
              <Codicon name="close" size={14} />
            </button>
          </span>
        </div>
        <div className="sbody" hidden={fold}>
          <div className="smsgs msgs" ref={list}>
            <button
              className="qchip"
              data-testid="side-quote"
              title="指着它，主对话里那句亮起来；点一下回到那句"
              onMouseEnter={() => litQuote(side.id, 'hov')}
              onMouseLeave={() => litQuote(side.id, 'off')}
              onClick={() => {
                if (props.view !== 'ai') props.onView('ai')
                requestAnimationFrame(() => requestAnimationFrame(() => litQuote(side.id, 'lit')))
              }}
            >
              <Codicon name="quote" size={14} className="qi" />
              <span className="qc">
                <span className="l1">{side.quote}</span>
                <span className="l2">{`主对话${page > 0 ? ` · 第 ${page} 页` : ''}${title && title !== `第 ${page} 页` ? ` · ${title}` : ''}`}</span>
              </span>
            </button>
            {side.msgs.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="um-wrap">
                  {m.mats?.length ? <MatMsg text={m.text} mats={m.mats} /> : <div className="um">{m.text}</div>}
                </div>
              ) : (
                <div key={m.id} className="am" data-testid="side-msg">
                  {m.text ? (
                    <div className="txt md">
                      <Markdown text={withoutVizMark(m.text).text} math />
                    </div>
                  ) : m.error ? null : (
                    <div className="thinking">正在想…</div>
                  )}
                  {m.error && <AiError raw={m.error} engine={{ id: m.engine ?? cp.pick.engine }} />}
                </div>
              ),
            )}
          </div>
          {answered && !running && (
            <div className="sacts" role="group" aria-label="这条回答">
              <button
                onClick={() => {
                  // 这条回答作为一块引用进主对话的输入框（不自动发）
                  R.addMaterial(pdf, { kind: 'quote', text: answerOf(side), src: `旁支 · ${name}` })
                  props.onView('ai')
                }}
              >
                <Codicon name="reply" size={12} />
                放进主对话
              </button>
              <button
                onClick={() => {
                  props.onView('notes')
                  R.focusSide(pdf, side.thread, side.quote)
                }}
              >
                <Codicon name="note" size={12} />
                在笔记里看
              </button>
              <button
                onClick={() => {
                  void copy(answerOf(side))
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                }}
              >
                <Codicon name={copied ? 'check' : 'copy'} size={12} />
                {copied ? '已拷贝' : '拷贝'}
              </button>
            </div>
          )}
          <AiInput
            c={c}
            className="side-in"
            placeholder={asked ? '接着问这条旁支…' : `问这句…（直接 ↵ 就是「${R.ASK_THIS}」）`}
            hint="↵ 发送"
            picks={{ ...cp.picks, engine: false }}
            running={running}
            sendDisabled={asked && !c.text.trim() && !c.mats.length}
            onSend={send}
            onStop={() => R.stopSide(pdf, side.id)}
            onNotice={props.onNotice}
            list={list}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
                e.preventDefault()
                // 还没问过：空着回车就是「讲讲这句」；问过以后空着不发（发送键也灰着）
                if (!running && (!asked || c.text.trim() || c.mats.length)) send()
              }
            }}
          />
        </div>
      </aside>
      {menu && (
        <SideMenu
          pdf={pdf}
          anchor={menuBtn}
          current={side.id}
          onClose={() => setMenu(false)}
          onRename={() => {
            setMenu(false)
            setRenaming(name)
          }}
        />
      )}
    </>
  )
}

/** 格头 ⋯：300 宽、往下弹、右边和按钮对齐。改名…、删掉这条旁支；这一份 PDF 的旁支（当前那条打勾，右边第几页 · 几问），点一条切过去 */
function SideMenu(p: { pdf: string; anchor: RefObject<HTMLButtonElement | null>; current: string; onClose(): void; onRename(): void }) {
  const r = R.useReading(p.pdf)!
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const a = p.anchor.current!.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(a.right - 300, window.innerWidth - 308)), top: a.bottom + 6 })
  }, [p.anchor])
  useDismiss(true, [ref, p.anchor], p.onClose)
  const all = (r.state.sides ?? []).filter((s) => s.msgs.length || s.id === p.current)
  const pageOf = (s: ReadingSide) => r.state.threads.find((t) => t.id === s.thread)?.page ?? 0
  return createPortal(
    <div ref={ref} className="ai-menu side-menu" role="menu" aria-label="旁支" data-composer-pop="" style={{ width: 300, ...(pos ?? { visibility: 'hidden' }) }}>
      <button className="it" role="menuitem" onClick={p.onRename}>
        <span className="ck">
          <Codicon name="edit" size={13} />
        </span>
        <span className="nm">改名…</span>
      </button>
      <button
        className="it"
        role="menuitem"
        onClick={() => {
          p.onClose()
          R.deleteSide(p.pdf, p.current)
        }}
      >
        <span className="ck">
          <Codicon name="close" size={13} />
        </span>
        <span className="nm">删掉这条旁支</span>
      </button>
      <div className="sep" />
      <div className="mh">这一份 PDF 的旁支</div>
      {all.map((s) => (
        <button
          key={s.id}
          className="it"
          role="menuitemradio"
          aria-checked={s.id === p.current}
          onClick={() => {
            p.onClose()
            if (s.id !== p.current) R.showSide(p.pdf, s.id)
          }}
        >
          <span className="ck">{s.id === p.current && <Codicon name="check" size={14} />}</span>
          <span className="nm">{R.sideName(s)}</span>
          <span className="r">{`${pageOf(s) > 0 ? `第 ${pageOf(s)} 页 · ` : ''}${R.sideAsks(s)} 问`}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
