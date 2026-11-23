/**
 * 选了几个主题时的操作条（第二批 ⑤）：浮在选中的上面（白板框选定的方向 A；上面放不下放下面），挂在白板外框上不跟着缩放。
 * 前半是导图自己的：外框 ⇧⌘B · 概要 · 联系线 ⇧⌘R（选两个才能点；不能点时悬停说为什么）；
 * 后半和白板框选那一条同样：问AI（引擎标志）｜ 拷贝（贴进文档是一段缩进列表）· 删除 · ⋯。
 * 白板框选那件（task-5ryf9）的操作条做好后换成同一个组件（出卡在那一件里做）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AiIcon } from '../engine-logo'
import { useT } from '../i18n'
import { useKeys } from '../keys'

export type BarAct = 'frame' | 'sum' | 'rel' | 'ai' | 'copy' | 'del' | 'more'

export function MapSelBar(props: {
  overlay: HTMLElement
  /** 选中的那几个在窗口里的范围 */
  rect: { left: number; top: number; right: number; bottom: number }
  count: number
  /** 不能点的：为什么 */
  why: Partial<Record<BarAct, string>>
  readOnly: boolean
  onAct(a: BarAct, e: React.MouseEvent): void
}) {
  const t = useT()
  const K = useKeys()
  const bar = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const o = props.overlay.getBoundingClientRect()
    const w = bar.current?.offsetWidth ?? 420
    const mid = (props.rect.left + props.rect.right) / 2 - o.left
    const left = Math.max(10, Math.min(o.width - w - 10, mid - w / 2))
    let top = props.rect.top - o.top - 40 - 14
    if (top < 8) top = props.rect.bottom - o.top + 14
    setPos({ left, top })
  }, [props.rect.left, props.rect.top, props.rect.right, props.rect.bottom, props.count])
  const key = (id: string) => K(id)
  const item = (a: BarAct, icon: CodiconName | 'ai', label: string | null, tip: string, opts: { red?: boolean; key?: string | null } = {}) => {
    const no = props.why[a] ?? (props.readOnly && a !== 'ai' && a !== 'copy' && a !== 'more' ? t('只读的文件不能改') : undefined)
    return (
      <button
        key={a}
        type="button"
        className={'sb' + (opts.red ? ' red' : '')}
        aria-disabled={no ? true : undefined}
        aria-label={label ?? tip}
        data-tip={no ?? tip}
        data-key={no ? undefined : (opts.key ?? undefined)}
        data-side="above"
        data-bar={a}
        onClick={(e) => {
          e.stopPropagation()
          if (!no) props.onAct(a, e)
        }}
      >
        {icon === 'ai' ? <AiIcon job="chat" size={15} /> : <Codicon name={icon} size={15} />}
        {label && <span>{label}</span>}
      </button>
    )
  }
  return createPortal(
    <div ref={bar} className="mm-selbar" role="toolbar" aria-label={t('选中的主题')} data-testid="map-selbar" style={pos ?? { visibility: 'hidden' }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="cnt">{t('已选{n}个', { n: props.count })}</span>
      <span className="vs" />
      {item('frame', 'surround-with', t('外框'), t('框住选中的几个'), { key: key('mm-frame') })}
      {item('sum', 'symbol-namespace', t('概要'), t('用一个括号把这几个收成一句话'))}
      {item('rel', 'merge', t('联系线'), t('在这两个之间连一条弯线'), { key: key('mm-rel') })}
      <span className="vs" />
      {item('ai', 'ai', t('问AI'), t('把这几个主题一起交给 AI'))}
      <span className="vs" />
      {item('copy', 'copy', null, t('拷贝'), { key: key('copy') })}
      {item('del', 'trash', null, t('删掉这几个（连同下面的）'), { red: true, key: key('mm-del') })}
      {item('more', 'ellipsis', null, t('更多'))}
    </div>,
    props.overlay,
  )
}
