/**
 * AI 空对话（task-0tgz2，小样 design/ai-empty 方向 A「贴着输入框」）：消息区底下一句问候，输入框上面一排快捷命令。
 * AI 对话（AiPanel）和读 PDF（ReadingAi）共用。问候放不下时由调用的那一格收（.ai-empty 的 tight1 / tight2、reading.css 的容器查询）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { forwardRef, Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EngineId } from '../shared/agent'
import { hello } from './ai-greet'
import { EngineLogo } from './engine-logo'

/** 引擎标志 + 钟点问候（宋体 600 22），下面一句（13 --t2）跟着在看的东西走 */
export const Greeting = forwardRef<HTMLDivElement, { engine: EngineId; ask: string }>(function Greeting(props, ref) {
  return (
    <div className="ai-empty ai-greet" data-testid="ai-greet" ref={ref}>
      <div className="hi">
        <EngineLogo id={props.engine} size={22} />
        <h2>{hello(new Date().getHours())}</h2>
      </div>
      <p>{props.ask}</p>
    </div>
  )
})

/** 一颗快捷命令：icon 是 Codicon，engine 给了画那一家的标志（交给 AI 跑的，偏好「AI 图标用引擎标志」）；tip 是悬停提示 */
export interface Quick {
  text: string
  icon?: CodiconName
  engine?: EngineId
  tip?: string
  /** 自己存的命令（task-9womr）：排在一道竖线后面，图标用强调色（小样 ai-empty proto.html「以后有自己的命令」） */
  own?: boolean
  go(): void
}

/**
 * 输入框上面一排小按钮（28 高、圆角 8）：放不下的从后往前收进最后一颗「⋯」，点开先列收起的几条，一道线，
 * 最后「全部命令 /」（就是在输入框打「/」）；不换第二排。以后「存成命令」做好了，自己的命令接在后面
 */
export function QuickRow(props: { items: Quick[]; /** 「⋯」最后一行「全部命令 /」：在输入框打「/」（读 PDF 那一排只有「问这一页」一颗，收不进「⋯」，不给） */ onAll?(): void }) {
  const row = useRef<HTMLDivElement>(null)
  const moreBtn = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  /** 露着几颗（其余收进「⋯」） */
  const [shown, setShown] = useState(props.items.length)
  const [menu, setMenu] = useState(false)
  const sig = props.items.map((i) => i.text).join('|')

  // 量放得下几颗：先全露着量，不够就让出「⋯」那一格，从后往前收
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const fit = () => {
      const btns = [...el.querySelectorAll<HTMLElement>('.qc:not(.more)')]
      const gap = 6
      const room = el.clientWidth
      // 自己的命令前面那道竖线（1 宽、左右各 2，加一个间距）：露着自己的命令时才算它
      const sep = 5 + gap
      const firstOwn = btns.findIndex((b) => b.classList.contains('own'))
      const widths = btns.map((b, i) => b.offsetWidth + (i === firstOwn ? sep : 0))
      const total = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, widths.length - 1)
      if (total <= room) return setShown(widths.length)
      const more = 28 + gap
      let used = 0
      let n = 0
      for (const w of widths) {
        const next = used + (n ? gap : 0) + w
        if (next + more > room) break
        used = next
        n++
      }
      setShown(n)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sig])

  // 点外面、esc 收起
  useEffect(() => {
    if (!menu) return
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !moreBtn.current?.contains(t)) setMenu(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [menu])

  const glyph = (q: Quick) => (q.engine ? <EngineLogo id={q.engine} size={14} className="ai-ic" /> : <Codicon name={q.icon ?? 'comment-discussion'} size={14} />)
  const folded = props.items.slice(shown)
  return (
    <div className="aiq">
      <div className="qrow" ref={row} data-testid="ai-quick">
        {/* 收起的也画着（visibility: hidden 量宽度），不然量不出哪几颗放得下 */}
        {props.items.map((q, i) => (
          <Fragment key={q.text}>
            {q.own && !props.items[i - 1]?.own && <span className={'qsep' + (i < shown ? '' : ' folded')} aria-hidden />}
            <button className={'qc' + (q.own ? ' own' : '') + (i < shown ? '' : ' folded')} title={q.tip} tabIndex={i < shown ? 0 : -1} aria-hidden={i < shown ? undefined : true} onClick={q.go}>
              {glyph(q)}
              <span>{q.text}</span>
            </button>
          </Fragment>
        ))}
        <button ref={moreBtn} className={'qc more' + (menu ? ' on' : '')} aria-label="更多命令" title="更多命令" hidden={!folded.length} onClick={() => setMenu(!menu)}>
          <Codicon name="ellipsis" size={14} />
        </button>
      </div>
      {menu && (
        <div className="qmenu" role="menu" aria-label="更多命令" ref={menuRef} style={{ left: Math.max(0, Math.min((moreBtn.current?.offsetLeft ?? 0) - 6, (row.current?.clientWidth ?? 0) - 220)) }}>
          {folded.map((q, i) => (
            <Fragment key={q.text}>
              {/* 自己的命令和自带的之间一道横线（和那一排里的竖线一个意思） */}
              {q.own && i > 0 && !folded[i - 1]!.own && <div className="sep" />}
              <button role="menuitem" className={q.own ? 'own' : ''} title={q.tip} onClick={() => (setMenu(false), q.go())}>
                {glyph(q)}
                <span className="truncate">{q.text}</span>
              </button>
            </Fragment>
          ))}
          {props.onAll && (
            <>
              <div className="sep" />
              <button role="menuitem" onClick={() => (setMenu(false), props.onAll!())}>
                <Codicon name="comment-discussion" size={14} />
                <span className="truncate">全部命令</span>
                <span className="k">/</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
