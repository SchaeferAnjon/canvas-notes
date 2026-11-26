/**
 * 地址栏里的剪藏去处小牌（task-05p2w 方向 A 的「记进《这篇》」小牌；剪藏去处 2026-11-25 页 142 推荐甲：不再只在网页占满时挂，一直挂着）：
 * 写着网页上剪的进哪：「记进《这篇》」「剪进 收件箱」「剪进 某文件夹」，占满以后剪过几条写几；点开能改：
 * 这篇 / 换一篇… ｜ 收件箱 / 那个文件夹 / 放进一个文件夹… / 中间开着文件夹首页时「放进这个文件夹」。选了都记在这个网站的去处里（同「剪到哪篇…」）。
 * 26 高、圆角 6、--acc-soft 底、--acc-t 字，名字放不下省略号（偏好「窄的时候不许挤成一字一行」）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { titleOf } from '../../shared/layout'
import { useT } from '../i18n'
import { useDismiss } from '@cn/design/dismiss'

/** 网页上剪的现在进哪（剪藏去处规则）：配对的那篇、收件箱、选的文件夹 */
export type ChipDest = { kind: 'doc'; path: string } | { kind: 'inbox' } | { kind: 'dir'; path: string }

export function FullChip(props: {
  dest: ChipDest
  /** 菜单第一项列的那篇（记进的那篇，或中间开着的那篇）；没有是 null */
  doc: string | null
  /** 那篇和这个网页配好了对 */
  paired: boolean
  /** 占满以后剪了几条（没占满是 0） */
  count: number
  /** 网页占满着（地址栏宽，小牌最宽 290；没占满最宽 170） */
  wide: boolean
  /** 中间开着的那篇（菜单第一项是它时右边写「中间开着的」） */
  center: string | null
  /** 中间开着的文件夹首页（菜单多一项「放进这个文件夹」）；没开是 null */
  here: string | null
  /** 文件夹在小牌、菜单里怎么写（库的最外层另有说法） */
  dirName(dir: string): string
  /** 点了菜单第一项那篇 */
  onDoc(path: string): void
  /** 换一篇…：贴着小牌问记到哪篇 */
  onPick(at: DOMRect): void
  /** 剪进收件箱 */
  onInbox(): void
  /** 放进一个文件夹…：贴着小牌弹选文件夹 */
  onDir(anchor: HTMLElement): void
  /** 放进这个文件夹（中间开着的那个）、点了已经选着的文件夹 */
  onHere(dir: string): void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // 点外面（网页里也算）、Esc（焦点回到按钮）、窗口失焦收起（公共的 useDismiss）
  useDismiss(open, [ref], (why) => {
    setOpen(false)
    if (why === 'esc') btn.current?.focus()
  }, { esc: 'late' })
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>('.menu button')?.focus()
  }, [open])
  const d = props.dest
  const docName = props.doc ? titleOf(props.doc) : ''
  const label = d.kind === 'doc' ? t('记进《{name}》', { name: titleOf(d.path) }) : d.kind === 'inbox' ? t('剪进收件箱') : t('剪进「{dir}」', { dir: props.dirName(d.path) })
  const tip =
    d.kind === 'doc'
      ? t('网页上剪的、问的记进这篇；点开能改')
      : d.kind === 'inbox'
        ? t('网页上剪的一段一张卡片进收件箱；点开能改')
        : t('网页上剪的一段一张卡片进这个文件夹；点开能改')
  const pick = (f: () => void) => () => (setOpen(false), f())
  const showHere = props.here !== null && !(d.kind === 'dir' && d.path === props.here)
  return (
    <div className="imp wfull" ref={ref}>
      <button
        ref={btn}
        className={'wchip' + (props.wide ? ' wide' : '') + (open ? ' open' : '')}
        data-testid="full-chip"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={tip}
        data-side="below-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Codicon name={d.kind === 'doc' ? 'file' : d.kind === 'inbox' ? 'inbox' : 'folder'} size={13} />
        <span className="ct">
          <span className="v">{d.kind === 'doc' ? t('记进') : t('剪进')} </span>
          <b>{d.kind === 'doc' ? (props.wide ? `《${titleOf(d.path)}》` : titleOf(d.path)) : d.kind === 'inbox' ? t('收件箱') : props.dirName(d.path)}</b>
        </span>
        {props.count > 0 && <em className="n" data-testid="full-chip-n">{props.count}</em>}
        <Codicon name="chevron-down" size={11} />
      </button>
      {open && (
        <div className="menu wchip-menu" role="menu" aria-label={t('剪到哪')}>
          <div className="cap">{t('网页上剪的、问的记进')}</div>
          {props.doc && (
            <button role="menuitemradio" aria-checked={d.kind === 'doc'} onClick={pick(() => props.onDoc(props.doc!))}>
              <Codicon name={d.kind === 'doc' ? 'check' : 'file'} size={14} />
              <span className="mlabel truncate">{docName}</span>
              {props.paired ? <small>{t('配好对的')}</small> : props.doc === props.center && <small>{t('中间开着的')}</small>}
            </button>
          )}
          <button role="menuitem" onClick={() => (setOpen(false), props.onPick(btn.current!.getBoundingClientRect()))}>
            <Codicon name="blank" size={14} />
            <span className="mlabel">{t('换一篇…')}</span>
          </button>
          <hr />
          <button role="menuitemradio" aria-checked={d.kind === 'inbox'} onClick={pick(props.onInbox)}>
            <Codicon name={d.kind === 'inbox' ? 'check' : 'inbox'} size={14} />
            <span className="mlabel">{t('剪成卡片，放进收件箱')}</span>
          </button>
          {d.kind === 'dir' && (
            <button role="menuitemradio" aria-checked onClick={pick(() => props.onHere(d.path))}>
              <Codicon name="check" size={14} />
              <span className="mlabel truncate">{props.dirName(d.path)}</span>
              <small>{t('选的文件夹')}</small>
            </button>
          )}
          {showHere && (
            <button role="menuitem" onClick={pick(() => props.onHere(props.here!))}>
              <Codicon name="folder" size={14} />
              <span className="mlabel">{t('放进这个文件夹')}</span>
              <small className="truncate">{props.dirName(props.here!)}</small>
            </button>
          )}
          <button role="menuitem" onClick={() => (setOpen(false), props.onDir(btn.current!))}>
            <Codicon name="folder-opened" size={14} />
            <span className="mlabel">{t('放进一个文件夹…')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
