/**
 * 白板右上角浮着的一小条：缩放「80% ▾」和「收件箱 N」（task-wz7gb，2026-11-22 用户：「这个可以放在白板里面的右上角，
 * 这样的话这里就不会跳来跳去了，当切换文档和白板的时候」）。以前在标签条右端，白板看法才多出这两颗，切看法时
 * 「属性 · 任务 · 白板 · 文档」那一排左右跳。样子照左边工具板：--pop 底、圆角、阴影同它（doc-board.css .db-corner）。
 * 白板窄（不到 NARROW）时只留图标和数：不写「收件箱」、不画 ⌄，少盖白板。
 */
import { Codicon } from '@cn/design'
import { useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { InboxButton } from './inbox'

/** 白板这一格窄于它：两颗只留图标和数 */
const NARROW = 560

export function BoardCorner(props: {
  /** 用户选的比例 × 100（2026-11-25 起写这个，以前写画布实际比例：右栏开着时到顶只显示 160%，像是上限） */
  pct: number
  /** 画布实际比例 × 100（右栏、AI 浮窗开着时让位 0.8 倍）；和 pct 不一样时悬停说清 */
  real?: number
  /** 提示里的缩放键（「⌘= ⌘- ⌘0」） */
  zoomKeys?: string
  onZoomMenu(): void
  inboxCount: number
}) {
  const t = useT()
  const self = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  // 量白板这一格（文档白板 doc-board、导图那种自由白板 .board）的宽
  useLayoutEffect(() => {
    const host = self.current?.closest<HTMLElement>('[data-testid="doc-board"], .board')
    if (!host) return
    const check = () => setNarrow(host.clientWidth < NARROW)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={self}
      className={'db-corner' + (narrow ? ' narrow' : '')}
      data-testid="board-corner"
      // 白板上的按下、双击、拖动都不归这里
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* 比例本身就是按钮，点开是缩放菜单 */}
      <button type="button" className="dbc-btn zoom" aria-label={t('缩放')} data-testid="board-zoom" data-tip={props.real !== undefined && props.real !== props.pct ? t('缩放\n右栏开着，画布实际 {real}%', { real: props.real }) : t('缩放')} data-key={props.zoomKeys} data-side="below-left" onClick={props.onZoomMenu}>
        <span className="num">{props.pct}%</span>
        <Codicon name="chevron-down" size={12} />
      </button>
      <i className="dbc-sep" />
      <InboxButton count={props.inboxCount} />
    </div>
  )
}
