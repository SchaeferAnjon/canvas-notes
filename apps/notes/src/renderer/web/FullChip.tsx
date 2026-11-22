/**
 * 网页占满时地址栏里的「记进《这篇》」小牌（task-05p2w 方向 A，偏好「读网页时能收起中间栏、摘录照写」「网页占满一颗按钮」）：
 * 中间那篇看不见时一直写着网页上剪的、问的记进哪篇，剪过几条写几；点开换一篇，或这一阵剪进收件箱。
 * 26 高、圆角 6、--acc-soft 底、--acc-t 字，名字放不下省略号（偏好「窄的时候不许挤成一字一行」）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { titleOf } from '../../shared/layout'
import { onPageOutside } from './page-outside'

export function FullChip(props: {
  /** 记进的那篇；中间开的不是文档、也没配对时是 null（剪的进收件箱） */
  target: string | null
  /** 这一阵剪进收件箱 */
  inbox: boolean
  /** 那篇和这个网页配好了对 */
  paired: boolean
  /** 占满以后剪了几条 */
  count: number
  /** 换一篇…：贴着小牌问记到哪篇 */
  onPick(at: DOMRect): void
  /** 这一阵剪进收件箱（false：回到记进那篇） */
  onInbox(on: boolean): void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), setOpen(false), btn.current?.focus())
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    const off = onPageOutside(() => setOpen(false))
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      off()
    }
  }, [open])
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>('.menu button')?.focus()
  }, [open])
  const toInbox = props.inbox || !props.target
  const name = props.target ? titleOf(props.target) : ''
  const tip = toInbox ? '网页上剪的进收件箱；点开换一篇' : '网页上剪的、问的记进这篇；点开换一篇'
  return (
    <div className="imp wfull" ref={ref}>
      <button
        ref={btn}
        className={'wchip' + (open ? ' open' : '')}
        data-testid="full-chip"
        aria-label={toInbox ? '剪进收件箱' : `记进《${name}》`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={tip}
        data-side="below-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Codicon name={toInbox ? 'inbox' : 'file'} size={13} />
        <span className="ct">{toInbox ? '剪进 ' : '记进 '}<b>{toInbox ? '收件箱' : `《${name}》`}</b></span>
        {props.count > 0 && <em className="n" data-testid="full-chip-n">{props.count}</em>}
        <Codicon name="chevron-down" size={11} />
      </button>
      {open && (
        <div className="menu wchip-menu" role="menu" aria-label="记进哪篇">
          <div className="cap">网页上剪的、问的记进</div>
          {props.target && (
            <button role="menuitemradio" aria-checked={!props.inbox} onClick={() => (setOpen(false), props.onInbox(false))}>
              <Codicon name={props.inbox ? 'file' : 'check'} size={14} />
              <span className="mlabel truncate">{name}</span>
              {props.paired && <small>配好对的</small>}
            </button>
          )}
          <button role="menuitem" onClick={() => (setOpen(false), props.onPick(btn.current!.getBoundingClientRect()))}>
            <Codicon name="blank" size={14} />
            <span className="mlabel">换一篇…</span>
          </button>
          <hr />
          <button role="menuitemradio" aria-checked={toInbox} onClick={() => (setOpen(false), props.onInbox(true))}>
            <Codicon name={toInbox ? 'check' : 'inbox'} size={14} />
            <span className="mlabel">这一阵剪进收件箱</span>
          </button>
        </div>
      )}
    </div>
  )
}
