/**
 * 卡片样式、便签的外观（设计页 145「卡片样式」「便签」，画法照 design/ink-decor/src/decor.js）：只在卡、列的外观层上加一个类名、
 * 几个 data 和 CSS 变量（decor.css 画），不动卡里怎么排字、不碰缩放和缩略图那条路。
 * - 卡片样式五种（纸面、磨砂玻璃、描边、彩头、横线纸）+ 主题六色（导图那六色 --mm-b0…5，换主题跟着换）；没写颜色跟主题（强调色）。
 * - 便签：一张摆在空白处的卡多 note=纸色 rot=角度（w、h 默认 200）：投影、纸（上沿背胶一截深、纸纹）、右下卷角三层。
 * 浮层：样式（五种样式 + 六色，照 sheet-cards 图）、便签纸色、胶带花样。
 */
import { CARD_STYLES, type CardStyle, cardStyleOf, type DocColumn, type DocUnit, NOTE_COLORS, type NoteColor, noteOf, TAPE_PATTERNS } from '@cn/format'
import type { CSSProperties, ReactNode } from 'react'
import { useT } from '../../i18n'
import { anchorOf, EDGE, FloatPop, type PopAnchor } from '../../pop-place'
import { PAPER_NAMES, TAPE_NAMES, tapeSVG } from './art'

export interface Look {
  cls: string
  style: CSSProperties
  data: Record<string, string>
  /** 画在卡里最底下的几层（便签的投影、纸、卷角） */
  layers?: ReactNode
}


/**
 * 浮层往远离选中物的一边开（选中物至少露一半）：操作条在选中物下面就往下开；操作条在上面就往上开，
 * 上面放不下就开在选中物的旁边（右边放不下放左边），顶和选中物的顶对齐。h 是浮层大约多高
 */
export function awayFrom(el: HTMLElement, sel: { left: number; top: number; right: number; bottom: number } | null, h: number): { at: PopAnchor; up: boolean } {
  const bar = el.closest<HTMLElement>('.selbar')
  const at = anchorOf(el)
  if (bar?.dataset.below === '1') return { at, up: false }
  const br = (bar ?? el).getBoundingClientRect()
  if (br.top - 6 - h >= EDGE) return { at, up: true }
  if (!sel) return { at, up: false }
  // 旁边：left 是右边那一格的起点，right 是左边那一格的终点（popPlace 右边放不下就用 right - 宽）
  return { at: { left: sel.right + 10, right: sel.left - 10, top: sel.top - 6, bottom: sel.top - 6 }, up: false }
}

const colorVar = (c: number | null) => (c === null ? 'var(--acc)' : `var(--mm-b${c})`)

/** 便签的三层：投影、纸（纸纹在里面）、卷角 */
export const noteLayers = (
  <>
    <div className="sn-sh" aria-hidden />
    <div className="sn" aria-hidden>
      <div className="sn-tex" />
    </div>
    <div className="sn-curl" aria-hidden />
  </>
)

/** 一张卡的外观：便签（摆在空白处、带 note=）或有样式的卡；什么都没有（纸面 · 跟主题）返回 null */
export function cardLook(u: DocUnit): Look | null {
  const n = u.place ? noteOf(u) : null
  if (n) return { cls: ' dc-note', style: { width: n.w, height: n.h, '--rot': `${n.rot}deg` } as CSSProperties, data: { 'data-note': n.color }, layers: noteLayers }
  const { style, color } = cardStyleOf(u.attrs)
  if (style === 'paper' && color === null) return null
  return { cls: ' dc-cs', style: { '--c': colorVar(color) } as CSSProperties, data: { 'data-cs': style } }
}

/** 一列的外观（列名下面那一行 `<!-- column style=… color=… -->`） */
export function colLook(c: DocColumn): Look | null {
  const { style, color } = cardStyleOf(c.attrs)
  if (style === 'paper' && color === null) return null
  return { cls: ' dc-cs', style: { '--c': colorVar(color) } as CSSProperties, data: { 'data-cs': style } }
}

const STYLE_NAMES: Record<CardStyle, string> = {
  paper: '纸面', // 不翻：画的地方翻
  glass: '磨砂玻璃', // 不翻
  outline: '描边', // 不翻
  header: '彩头', // 不翻
  lined: '横线纸', // 不翻
}

/** 「样式 ▾」浮层：卡片样式五种 + 颜色（跟主题的六色）；点已经选着的那颗颜色是回到跟主题 */
export function StylePop(props: { at: PopAnchor; up?: boolean; title: string; style: CardStyle; color: number | null; onStyle(s: CardStyle): void; onColor(c: number | null): void; onClose(): void }) {
  const t = useT()
  return (
    <FloatPop at={props.at} up={props.up} gap={6} className="dc-pop dc-style-pop" role="dialog" aria-label={props.title} data-testid="decor-style-pop" onMouseDown={(e) => e.preventDefault()}>
      <div className="dc-pop-h">{props.title}</div>
      <div className="dc-styles" role="radiogroup" aria-label={t('卡片样式')}>
        {CARD_STYLES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={props.style === s} className={'dc-style' + (props.style === s ? ' on' : '')} data-v={s} onClick={() => props.onStyle(s)}>
            <span className="dc-sw dc-cs" data-cs={s} style={{ '--c': colorVar(props.color) } as CSSProperties}>
              {s === 'header' && <i className="dc-sw-band" />}
            </span>
            <span className="dc-style-n">{t(STYLE_NAMES[s])}</span>
          </button>
        ))}
      </div>
      <div className="dc-pop-h">{t('颜色（跟主题的六色）')}</div>
      <div className="dc-colors">
        <div className="dc-dots" role="radiogroup" aria-label={t('颜色')}>
          {[0, 1, 2, 3, 4, 5].map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={props.color === c}
              aria-label={t('第{n}色', { n: c + 1 })}
              className={props.color === c ? 'on' : ''}
              data-c={c}
              style={{ background: `var(--mm-b${c})` }}
              onClick={() => props.onColor(props.color === c ? null : c)}
            />
          ))}
        </div>
        <span className="dc-pop-note">{t('新卡默认：纸面 · 跟主题')}</span>
      </div>
    </FloatPop>
  )
}

/** 便签「纸色 ▾」浮层：六种纸 */
export function PaperPop(props: { at: PopAnchor; up?: boolean; color: NoteColor; onPick(c: NoteColor): void }) {
  const t = useT()
  return (
    <FloatPop at={props.at} up={props.up} gap={6} className="dc-pop dc-paper-pop" role="dialog" aria-label={t('纸色')} data-testid="decor-paper-pop" onMouseDown={(e) => e.preventDefault()}>
      <div className="dc-papers" role="radiogroup" aria-label={t('纸色')}>
        {NOTE_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={props.color === c} className={'dc-paper' + (props.color === c ? ' on' : '')} data-v={c} onClick={() => props.onPick(c)}>
            <span className="dc-paper-sw" data-note={c} />
            <span>{t(PAPER_NAMES[c])}</span>
          </button>
        ))}
      </div>
    </FloatPop>
  )
}

/** 胶带「换花样 ▾」浮层：八种花样 */
export function TapePop(props: { at: PopAnchor; up?: boolean; pat: string; onPick(p: string): void }) {
  const t = useT()
  return (
    <FloatPop at={props.at} up={props.up} gap={6} className="dc-pop dc-tape-pop" role="dialog" aria-label={t('换花样')} data-testid="decor-tape-pop" onMouseDown={(e) => e.preventDefault()}>
      <div className="dc-tapes" role="radiogroup" aria-label={t('换花样')}>
        {TAPE_PATTERNS.map((p, i) => (
          <button key={p} type="button" role="radio" aria-checked={props.pat === p} className={'dc-tape-pick' + (props.pat === p ? ' on' : '')} data-v={p} onClick={() => props.onPick(p)}>
            <span className="dc-roll" dangerouslySetInnerHTML={{ __html: tapeSVG(p, 76, i + 1) }} />
            <span>{t(TAPE_NAMES[p])}</span>
          </button>
        ))}
      </div>
    </FloatPop>
  )
}
