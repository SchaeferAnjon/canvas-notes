/**
 * 备注弹层（第二批 ①，用户定「备注存成主题下缩进的一段」）：点主题后面的备注小图标、或选中主题按 ⇧⌘N 打开，贴在主题下面（放不下翻到上面）。
 * 直接写，能写多段（md 的粗体、列表、链接、公式照写，文档看法里就是这一项下面的正文）；esc、点别处收起。
 * 写的时候停 0.8 秒存一次，收起时再存一次（不是每个字一次提交）；底下一行说存在哪。
 */
import { Codicon } from '@cn/design'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { useKeys } from '../keys'

export function NotePop(props: { overlay: HTMLElement; anchor: HTMLElement | null; topic: string; note: string; focus: boolean; readOnly: boolean; onSave(note: string): void; onClose(): void }) {
  const t = useT()
  const K = useKeys()
  const [v, setV] = useState(props.note)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const saved = useRef(props.note)
  const cb = useRef(props)
  cb.current = props
  const save = (x: string) => {
    if (x === saved.current) return
    saved.current = x
    cb.current.onSave(x)
  }
  // 停 0.8 秒存一次
  useEffect(() => {
    if (v === saved.current) return
    const tm = setTimeout(() => save(v), 800)
    return () => clearTimeout(tm)
  }, [v])
  // 收起（关掉、换了主题、整块导图不画了）时把没存的存上
  const latest = useRef(v)
  latest.current = v
  useEffect(() => () => save(latest.current), [])
  useLayoutEffect(() => {
    const o = props.overlay.getBoundingClientRect()
    const a = props.anchor?.getBoundingClientRect()
    if (!a) return
    const h = box.current?.offsetHeight ?? 180
    const left = Math.max(10, Math.min(a.left - o.left - 8, o.width - 310))
    let top = a.bottom - o.top + 10
    if (top + h > o.height - 10) top = Math.max(10, a.top - o.top - h - 10)
    setPos({ left, top })
  }, [props.anchor])
  useLayoutEffect(() => {
    if (!props.focus || !pos) return
    const el = area.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [props.focus, pos === null])
  // 点别处收起
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return
      if ((e.target as Element | null)?.closest?.('[data-testid="map-note-icon"]')) return
      cb.current.onClose()
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [])
  return createPortal(
    <div ref={box} className="mm-notepop" role="dialog" aria-label={t('备注')} data-testid="map-note" style={pos ?? { visibility: 'hidden' }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="nh">
        <Codicon name="note" size={14} />
        {t('备注')}
        {K('mm-note') && <span className="k">{K('mm-note')}</span>}
      </div>
      <textarea
        ref={area}
        value={v}
        readOnly={props.readOnly}
        aria-label={t('备注')}
        placeholder={t('写在这里：公式、为什么、老师怎么说……')}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => save(v)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            save(v)
            props.onClose()
          }
        }}
      />
      <div className="nf">{t('存在文件里「{topic}」那一行下面，缩进的一段；文档看法里就是这一项下面的正文。', { topic: props.topic })}</div>
    </div>,
    props.overlay,
  )
}
