/**
 * 找的条（⇧⌘F「在这一页里找」，文档、网页、PDF、白板、导图共用一个；样子照导图第二批设计页「② 在导图里找」那一屏，用户点过头）：
 * 贴在这一栏右上角（右 14、上 14，宽 392，--pop 底、圆角 10、--shadow-up）。一行：放大镜 · 框 · 「2/4」· 上一个 · 下一个 ｜ 开关 · 关掉；
 * 下面一行 12 --t3 的说明（这一处在哪、没找到时「到全库找 ⌘K」）。框里 ↵ 下一个、⇧↵ 上一个、esc 关掉；替换（文档用）给了才多一行。
 * 父元素要 position: relative（各页面自己摆）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useT } from '../i18n'
import { useKeys } from '../keys'
import './find.css'

export interface FindToggle {
  key: string
  icon: CodiconName
  label: string
  on: boolean
  onToggle(): void
}

export interface FindBarProps {
  query: string
  onQuery(q: string): void
  /** 第几处 / 一共几处；框里没字时 null */
  count: { at: number; total: number } | null
  onNext(): void
  onPrev(): void
  onClose(): void
  /** 框里的灰字（「在这块导图里找」「在这一篇里找」） */
  placeholder: string
  /** 框下面那一行（可以带 <b>）；不给时：没找到写「没找到 · 到全库找 ⌘K」，别的时候不写 */
  note?: React.ReactNode
  /** 右边的开关（导图「也找备注」、文档「区分大小写」） */
  toggles?: FindToggle[]
  /** 替换：给了才多一行（文档用） */
  replace?: { value: string; onValue(v: string): void; onOne(): void; onAll(): void }
  /** 每变一次就把焦点放回框里、全选（开着时再按 ⇧⌘F） */
  focusSeq?: number
  className?: string
  /** 网页里找时页面会把焦点抢走：拿到框好放回去 */
  inputRef?: React.RefObject<HTMLInputElement | null>
}

export function FindBar(p: FindBarProps) {
  const t = useT()
  const K = useKeys()
  const own = useRef<HTMLInputElement>(null)
  const input = p.inputRef ?? own
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.select()
  }, [p.focusSeq])
  // 按钮点完变灰了（全部替换以后），焦点掉到页面上：esc 照样关掉这条
  const root = useRef<HTMLDivElement>(null)
  const closeRef = useRef(p.onClose)
  closeRef.current = p.onClose
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.activeElement !== document.body) return
      e.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const none = !!p.query.trim() && p.count !== null && p.count.total === 0
  const note = p.note !== undefined ? p.note : none ? t('没找到 · 到全库找 {key}', { key: K('search') ?? '' }) : null
  const keys = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.key !== 'Enter') return
    e.preventDefault()
    if (e.shiftKey) p.onPrev()
    else p.onNext()
  }
  return (
    <div
      ref={root}
      className={'cn-findbar' + (p.className ? ' ' + p.className : '')}
      role="search"
      data-testid="find-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 条里的键不交给页面（文档、导图自己的快捷键）；esc 在条里哪儿（框里、按钮上）都是关掉
        e.stopPropagation()
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          p.onClose()
        }
      }}
    >
      <div className="fb-row">
        <Codicon name="search" size={14} />
        <input ref={input} value={p.query} placeholder={p.placeholder} aria-label={p.placeholder} onChange={(e) => p.onQuery(e.target.value)} onKeyDown={keys} />
        <span className="fb-count" data-testid="find-count">
          {p.count && p.query.trim() ? (p.count.total ? `${p.count.at}/${p.count.total}` : '0') : ''}
        </span>
        <button type="button" aria-label={t('上一个')} data-tip={t('上一个')} data-key={K('newline') ?? undefined} data-side="below" disabled={!p.count?.total} onClick={p.onPrev}>
          <Codicon name="arrow-up" size={14} />
        </button>
        <button type="button" aria-label={t('下一个')} data-tip={t('下一个')} data-key={K('enter') ?? undefined} data-side="below" disabled={!p.count?.total} onClick={p.onNext}>
          <Codicon name="arrow-down" size={14} />
        </button>
        {!!p.toggles?.length && <span className="fb-gap" />}
        {p.toggles?.map((g) => (
          <button key={g.key} type="button" className={g.on ? 'on' : ''} aria-label={g.label} aria-pressed={g.on} data-tip={g.label} data-side="below" onClick={g.onToggle}>
            <Codicon name={g.icon} size={14} />
          </button>
        ))}
        <button type="button" aria-label={t('关掉')} data-tip={t('关掉')} data-key={K('escape') ?? undefined} data-side="below" onClick={p.onClose}>
          <Codicon name="close" size={14} />
        </button>
      </div>
      {p.replace && (
        <div className="fb-row fb-rep">
          <Codicon name="replace" size={14} />
          <input
            value={p.replace.value}
            placeholder={t('换成')}
            aria-label={t('换成')}
            onChange={(e) => p.replace!.onValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') (e.preventDefault(), e.metaKey ? p.replace!.onAll() : p.replace!.onOne())
            }}
          />
          <button type="button" className="fb-txt" disabled={!p.count?.total} onClick={p.replace.onOne}>
            {t('替换')}
          </button>
          <button type="button" className="fb-txt" disabled={!p.count?.total} onClick={p.replace.onAll}>
            {t('全部替换')}
          </button>
        </div>
      )}
      {note && (
        <div className="fb-note" data-testid="find-note">
          {note}
        </div>
      )}
    </div>
  )
}
