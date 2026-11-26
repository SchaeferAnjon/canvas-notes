/**
 * 标签条右端「布局 ▾」（task-wuv05 第一批，用户点头的；只在导图白板上有，文档、白板两种看法都在，切换时那一排不跳）：
 * 图标和字跟着当前布局（向右 / 左右 / 向下 / 鱼骨 / 时间线）。点开一张 330 宽的小菜单：五种摆法各一张小图（当前的打勾）、
 * 第二批的配色（跟主题 / 彩虹 / 墨线）和骨架（卡片 / 线条 / 方框）各一排小图（都放这一个菜单里，标签条右端不多一颗按钮）、
 * 收起到第一层（⇧⌘/）、全部展开，底下一行说记在哪（属性 `导图布局: 左右`、`导图配色: 彩虹`、`导图骨架: 线条`；默认的不写）。
 * 换哪样都只改属性那一行（packages/format 的 withMapLayout / withMapPalette / withMapSkeleton），能 ⌘Z 撤回。
 * ⌘K 里的收起到第一层、全部展开、导出导图…也在这里登记。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import {
  MAP_LAYOUT_KEY,
  MAP_LAYOUT_VALUE,
  MAP_PALETTE_KEY,
  MAP_PALETTE_VALUE,
  MAP_SKELETON_KEY,
  MAP_SKELETON_VALUE,
  type MapLayoutKind,
  type MapPalette,
  type MapSkeleton,
  mapLayoutOf,
  mapPaletteOf,
  mapSkeletonOf,
  withMapLayout,
  withMapPalette,
  withMapSkeleton,
} from '@cn/format'
import { useRef, useState } from 'react'
import { rich, useT } from '../i18n'
import { useKeyHandler, useKeys } from '../keys'
import { requestExport } from './export-store'
import { foldAllText } from './MindmapLayer'
import { useKeepInside } from './PropsButton'

const ICON: Record<MapLayoutKind, CodiconName> = { right: 'type-hierarchy-sub', both: 'type-hierarchy', down: 'organization', fish: 'graph-line', time: 'milestone' }

/** 五种摆法的小图（46 × 28，跟着字色） */
const DIA: Record<MapLayoutKind, React.ReactNode> = {
  right: (
    <svg width="46" height="28" viewBox="0 0 46 28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="11" width="12" height="6" rx="2" fill="currentColor" stroke="none" />
      <path d="M14 14C20 14 20 5 26 5M14 14H26M14 14C20 14 20 23 26 23" />
      <path d="M27 5h15M27 14h12M27 23h14" />
    </svg>
  ),
  both: (
    <svg width="46" height="28" viewBox="0 0 46 28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="17" y="11" width="12" height="6" rx="2" fill="currentColor" stroke="none" />
      <path d="M29 14C33 14 33 6 37 6M29 14C33 14 33 22 37 22M17 14C13 14 13 6 9 6M17 14C13 14 13 22 9 22" />
      <path d="M38 6h6M38 22h6M2 6h6M2 22h6" />
    </svg>
  ),
  down: (
    <svg width="46" height="28" viewBox="0 0 46 28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="17" y="2" width="12" height="6" rx="2" fill="currentColor" stroke="none" />
      <path d="M23 8v5M8 13h30M8 13v5M23 13v5M38 13v5" />
      <rect x="3" y="19" width="10" height="6" rx="1.5" />
      <rect x="18" y="19" width="10" height="6" rx="1.5" />
      <rect x="33" y="19" width="10" height="6" rx="1.5" />
    </svg>
  ),
  fish: (
    <svg width="46" height="28" viewBox="0 0 46 28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="34" y="10" width="10" height="8" rx="2" fill="currentColor" stroke="none" />
      <path d="M3 14H34" strokeWidth="2" />
      <path d="M28 14L23 4M28 14L23 24M17 14L12 4M17 14L12 24" />
      <path d="M15 8h6M15 20h6M4 8h6M4 20h6" strokeWidth="1" />
    </svg>
  ),
  time: (
    <svg width="46" height="28" viewBox="0 0 46 28" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 14H43M39 11l4 3-4 3" strokeWidth="1.8" />
      <rect x="5" y="11" width="9" height="6" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="19" y="11" width="9" height="6" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="33" y="11" width="5" height="6" rx="1.5" fill="currentColor" stroke="none" />
      <path d="M7 17v5h6M21 11V6h6M35 17v5h5" strokeWidth="1" />
    </svg>
  ),
}

/** 配色的小图（38 × 22）：照这种配色画出来的样子 */
function PalDia(props: { k: MapPalette }) {
  const c = props.k === 'rainbow' ? ['var(--mm-b0)', 'var(--mm-b1)', 'var(--mm-b2)'] : props.k === 'ink' ? ['var(--t1)', 'var(--t1)', 'var(--t1)'] : ['var(--wire)', 'var(--wire)', 'var(--wire)']
  const fill = props.k === 'rainbow' ? 'var(--solid)' : props.k === 'ink' ? 'none' : 'var(--card)'
  const stroke = props.k === 'ink' ? 'var(--t1)' : 'var(--line2)'
  return (
    <svg width="38" height="22" viewBox="0 0 38 22" fill="none" aria-hidden="true">
      <rect x="2" y="8" width="11" height="6" rx="2" fill={fill} stroke={stroke} />
      <path d="M13 11C18 11 18 4 23 4" stroke={c[0]} strokeWidth="1.6" />
      <path d="M13 11H23" stroke={c[1]} strokeWidth="1.6" />
      <path d="M13 11C18 11 18 18 23 18" stroke={c[2]} strokeWidth="1.6" />
      <path d="M24 4h11" stroke={c[0]} strokeWidth="2.4" />
      <path d="M24 11h9" stroke={c[1]} strokeWidth="2.4" />
      <path d="M24 18h10" stroke={c[2]} strokeWidth="2.4" />
    </svg>
  )
}

/** 骨架的小图（38 × 22） */
function SkDia(props: { k: MapSkeleton }) {
  return (
    <svg width="38" height="22" viewBox="0 0 38 22" fill="none" stroke="var(--t2)" strokeWidth="1.2" aria-hidden="true">
      <rect x="2" y="8" width="10" height="6" rx="2" fill="var(--t2)" stroke="none" />
      <path d="M12 11C16 11 16 5 20 5M12 11C16 11 16 17 20 17" />
      {props.k === 'card' ? (
        <>
          <rect x="20" y="2" width="10" height="6" rx="2" />
          <rect x="20" y="14" width="10" height="6" rx="2" />
          <path d="M30 5h6M30 17h5" />
        </>
      ) : props.k === 'line' ? (
        <path d="M20 8h10M20 20h10M30 5h6M30 17h5" />
      ) : (
        <>
          <rect x="20" y="2" width="9" height="6" rx="1" />
          <rect x="20" y="14" width="9" height="6" rx="1" />
          <rect x="31" y="2" width="5" height="6" rx="1" />
          <rect x="31" y="14" width="5" height="6" rx="1" />
        </>
      )}
    </svg>
  )
}

/** ⌘K 里「导图：收起到第一层」「导图：全部展开」「导出导图…」（App 只在导图白板开着时列出来，点了交给这里） */
export function useMapCommands(on: boolean, text: string | null, setText: (t: string) => void, path: string, showBoard: () => void) {
  useKeyHandler('mm-fold-all', on && text !== null ? () => (setText(foldAllText(text, true)), true) : null)
  useKeyHandler('mm-unfold-all', on && text !== null ? () => (setText(foldAllText(text, false)), true) : null)
  // 在文档看法里也能点：先切到白板（导出要照画出来的样子画）
  useKeyHandler('mm-export', on ? () => (requestExport(path), showBoard(), true) : null)
}

export function MapLayoutButton(props: { text: string; readOnly: boolean; onChange(text: string): void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const kind = mapLayoutOf(props.text)
  useDismiss(open, [box], () => setOpen(false))
  const name = { right: t('向右'), both: t('左右'), down: t('向下'), fish: t('鱼骨'), time: t('时间线') }[kind]
  const done = (text: string) => {
    setOpen(false)
    // 用鼠标挑完：按钮不留着焦点的外圈（designer 复审提的）
    ;(box.current?.querySelector('button') as HTMLElement | null)?.blur()
    if (text !== props.text) props.onChange(text)
  }
  return (
    <div className="mm-laybtn" ref={box}>
      <button
        type="button"
        className={'ab-act wt' + (open ? ' on' : '')}
        aria-label={t('布局：{name}', { name })}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : t('换布局、配色、骨架')}
        data-side="below"
        data-testid="map-layout"
        onClick={() => setOpen((v) => !v)}
      >
        <Codicon name={ICON[kind]} size={16} />
        <span className="lb">{name}</span>
        <Codicon name="chevron-down" size={12} />
      </button>
      {open && (
        <LayoutPop
          kind={kind}
          palette={mapPaletteOf(props.text)}
          skeleton={mapSkeletonOf(props.text)}
          readOnly={props.readOnly}
          onPick={(k) => done(withMapLayout(props.text, k))}
          // 配色、骨架点了马上换，菜单不关（好几样一起比着挑）
          onPalette={(k) => props.onChange(withMapPalette(props.text, k))}
          onSkeleton={(k) => props.onChange(withMapSkeleton(props.text, k))}
          onFold={(all) => done(foldAllText(props.text, all))}
        />
      )}
    </div>
  )
}

function LayoutPop(props: {
  kind: MapLayoutKind
  palette: MapPalette
  skeleton: MapSkeleton
  readOnly: boolean
  onPick(k: MapLayoutKind): void
  onPalette(k: MapPalette): void
  onSkeleton(k: MapSkeleton): void
  onFold(all: boolean): void
}) {
  const t = useT()
  const K = useKeys()
  const pop = useRef<HTMLDivElement>(null)
  useKeepInside(pop, props.kind)
  const rows: [MapLayoutKind, string, string][] = [
    ['right', t('向右展开'), t('逻辑图：中心在左，一层层往右')],
    ['both', t('左右展开'), t('思维导图：第一层分到左右两边')],
    ['down', t('向下展开'), t('组织结构：中心在上，一层层往下')],
    ['fish', t('鱼骨'), t('找原因：中心是鱼头，原因一根根长在骨头上')],
    ['time', t('时间线'), t('按先后：第一层排在一根横线上')],
  ]
  const pal: [MapPalette, string, string][] = [
    ['theme', t('跟主题'), t('跟着软件主题')],
    ['rainbow', t('彩虹'), t('第一层每枝一个颜色')],
    ['ink', t('墨线'), t('只有黑白线，打印用')],
  ]
  const sk: [MapSkeleton, string, string][] = [
    ['card', t('卡片'), t('第一层是小卡片，往下是线')],
    ['line', t('线条'), t('除了中心都是线')],
    ['box', t('方框'), t('每个主题都套框')],
  ]
  const codes = [
    <code key="l">{`${MAP_LAYOUT_KEY}: ${MAP_LAYOUT_VALUE[props.kind]}`}</code>,
    // 向右是默认、不写：紧跟着说一句，免得以为文件里写着（designer 复审提的）
    ...(props.kind === 'right' ? [<span key="d">{t('（向右是默认，不写）')}</span>] : []),
    ...(props.palette !== 'theme' ? [<code key="p">{`${MAP_PALETTE_KEY}: ${MAP_PALETTE_VALUE[props.palette]}`}</code>] : []),
    ...(props.skeleton !== 'card' ? [<code key="s">{`${MAP_SKELETON_KEY}: ${MAP_SKELETON_VALUE[props.skeleton]}`}</code>] : []),
  ]
  const code = <>{codes.flatMap((c, i) => (i && c.key !== 'd' ? [' ', c] : [c]))}</>
  const foldKey = K('mm-fold-all')
  const unfoldKey = K('mm-unfold-all')
  function chips<V extends string>(label: string, now: V, list: [V, string, string][], dia: (k: V) => React.ReactNode, pick: (k: V) => void, testid: string) {
    return (
      <div className="prow" role="group" aria-label={label} data-testid={testid}>
        <div className="pl">
          {label}
          <span>{list.find((x) => x[0] === now)?.[1]}</span>
        </div>
        <div className="chips">
          {list.map(([k, name, desc]) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={k === now}
              aria-label={name}
              data-tip={t('{name}：{desc}', { name, desc })}
              data-side="below"
              className={'chip' + (k === now ? ' on' : '')}
              disabled={props.readOnly}
              onClick={() => pick(k)}
            >
              {dia(k)}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div ref={pop} className="mm-laypop" role="menu" aria-label={t('这块导图怎么摆')} data-testid="map-layout-menu">
      <div className="head">{t('这块导图怎么摆')}</div>
      {rows.map(([k, title, desc]) => (
        <button key={k} type="button" role="menuitemradio" aria-checked={k === props.kind} className={'lay' + (k === props.kind ? ' on' : '')} disabled={props.readOnly} onClick={() => props.onPick(k)}>
          <span className="dia">{DIA[k]}</span>
          <span className="tx">
            <b>{title}</b>
            <span>{desc}</span>
          </span>
          <Codicon name="check" size={14} className="ck" />
        </button>
      ))}
      <hr />
      {chips(t('配色'), props.palette, pal, (k) => <PalDia k={k} />, props.onPalette, 'map-palette')}
      {chips(t('骨架'), props.skeleton, sk, (k) => <SkDia k={k} />, props.onSkeleton, 'map-skeleton')}
      <hr />
      <button type="button" role="menuitem" className="it" disabled={props.readOnly} onClick={() => props.onFold(true)}>
        <Codicon name="collapse-all" size={14} className="ic" />
        {t('收起到第一层')}
        {foldKey && <span className="k">{foldKey}</span>}
      </button>
      <button type="button" role="menuitem" className="it" disabled={props.readOnly} onClick={() => props.onFold(false)}>
        <Codicon name="expand-all" size={14} className="ic" />
        {t('全部展开')}
        {unfoldKey && <span className="k">{unfoldKey}</span>}
      </button>
      <div className="foot">{rich(t('记在这篇的属性里：{prop}'), { prop: code })}</div>
    </div>
  )
}
