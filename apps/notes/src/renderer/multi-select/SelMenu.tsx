/**
 * 操作条按钮弹出的菜单（task-5ryf9，原型 .menu）：最窄 220，内边距 6，圆角 12，--pop、--shadow-up；行 30 高、图标 14；
 * 组头 12 --t3，说明 12/1.5 --t3，分隔线 --line；右边写键（11 等宽 --t3）；灰掉的行点不了。
 * 贴着按钮下面 6 弹出来，下面放不下翻到上面（pop-place）；↑↓ 换行、↵ 选、esc 和点外面收起。
 * 对齐那九个图标 Codicons 里没有：照 Figma 画的 14 小示意图，跟字色（DESIGN.md 图标一节记着这个例外）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { AiIcon } from '../engine-logo'
import { FloatPop, type PopAnchor } from '../pop-place'

export type GlyphName = 'left' | 'hc' | 'right' | 'top' | 'vc' | 'bottom' | 'dh' | 'dv' | 'tidy'

const GLYPHS: Record<GlyphName, string> = {
  left: '<rect x="1" y="1" width="1.2" height="12"/><rect x="3" y="3" width="9" height="3" rx=".6"/><rect x="3" y="8" width="6" height="3" rx=".6"/>',
  hc: '<rect x="6.4" y="1" width="1.2" height="12"/><rect x="2" y="3" width="10" height="3" rx=".6"/><rect x="3.5" y="8" width="7" height="3" rx=".6"/>',
  right: '<rect x="11.8" y="1" width="1.2" height="12"/><rect x="2" y="3" width="9" height="3" rx=".6"/><rect x="5" y="8" width="6" height="3" rx=".6"/>',
  top: '<rect x="1" y="1" width="12" height="1.2"/><rect x="3" y="3" width="3" height="9" rx=".6"/><rect x="8" y="3" width="3" height="6" rx=".6"/>',
  vc: '<rect x="1" y="6.4" width="12" height="1.2"/><rect x="3" y="2" width="3" height="10" rx=".6"/><rect x="8" y="3.5" width="3" height="7" rx=".6"/>',
  bottom: '<rect x="1" y="11.8" width="12" height="1.2"/><rect x="3" y="2" width="3" height="9" rx=".6"/><rect x="8" y="5" width="3" height="6" rx=".6"/>',
  dh: '<rect x="1" y="4" width="3" height="6" rx=".6"/><rect x="5.5" y="4" width="3" height="6" rx=".6"/><rect x="10" y="4" width="3" height="6" rx=".6"/>',
  dv: '<rect x="4" y="1" width="6" height="3" rx=".6"/><rect x="4" y="5.5" width="6" height="3" rx=".6"/><rect x="4" y="10" width="6" height="3" rx=".6"/>',
  tidy: '<rect x="1" y="1" width="5" height="5" rx=".8"/><rect x="8" y="1" width="5" height="5" rx=".8"/><rect x="1" y="8" width="5" height="5" rx=".8"/><rect x="8" y="8" width="5" height="5" rx=".8"/>',
}

/** 对齐菜单的小示意图（14、跟字色） */
export function Glyph(props: { name: GlyphName }) {
  return <svg className="glyph" width={14} height={14} viewBox="0 0 14 14" fill="currentColor" aria-hidden dangerouslySetInnerHTML={{ __html: GLYPHS[props.name] }} />
}

export type MenuRow =
  | { v: string; label: string; icon?: CodiconName; glyph?: GlyphName; ai?: true; keys?: string | null; off?: boolean; red?: boolean }
  | { head: string }
  | { note: string }
  | 'sep'

export function SelMenu(props: { at: PopAnchor; label: string; rows: MenuRow[]; onPick(v: string): void; onClose(): void; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const items = props.rows.filter((r): r is Extract<MenuRow, { v: string }> => typeof r === 'object' && 'v' in r)
  const live = items.filter((r) => !r.off)
  // 刚弹出来哪一行都不亮（和块菜单一样），鼠标移上去、按 ↑↓ 才亮
  const [idx, setIdx] = useState(-1)
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const outside = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (ref.current?.contains(t as Node)) return
      // 点的是开这个菜单的那颗按钮：交给按钮自己（它会关掉）
      if (t?.closest?.('.selbar .sb.open')) return
      closeRef.current()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('mousedown', outside, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', outside, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [])
  const cur = live[idx]
  return (
    <FloatPop
      at={props.at}
      gap={6}
      className="sel-menu"
      role="menu"
      aria-label={props.label}
      data-testid={props.testid}
      tabIndex={-1}
      onMouseLeave={() => setIdx(-1)}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const d = e.key === 'ArrowDown' ? 1 : -1
          setIdx((i) => (i < 0 ? (d > 0 ? 0 : live.length - 1) : (i + d + live.length) % live.length))
        } else if (e.key === 'Enter' && cur) {
          e.preventDefault()
          props.onPick(cur.v)
        }
      }}
    >
      <div ref={ref} className="sel-menu-in" tabIndex={-1}>
        {props.rows.map((r, k) =>
          r === 'sep' ? (
            <div key={'s' + k} className="sm-sep" role="separator" />
          ) : 'head' in r ? (
            <div key={'h' + k} className="sm-head">
              {r.head}
            </div>
          ) : 'note' in r ? (
            <div key={'n' + k} className="sm-note">
              {r.note}
            </div>
          ) : (
            <button
              key={r.v}
              type="button"
              role="menuitem"
              className={'sm-item' + (cur === r ? ' on' : '') + (r.off ? ' off' : '') + (r.red ? ' red' : '')}
              aria-disabled={r.off || undefined}
              data-v={r.v}
              onMouseEnter={() => !r.off && setIdx(live.indexOf(r))}
              onClick={() => !r.off && props.onPick(r.v)}
            >
              {r.glyph ? <Glyph name={r.glyph} /> : r.ai ? <AiIcon job="chat" size={14} /> : <Codicon name={r.icon ?? 'blank'} size={14} />}
              <span className="lb">{r.label}</span>
              {r.keys && <kbd>{r.keys}</kbd>}
            </button>
          ),
        )}
      </div>
    </FloatPop>
  )
}
