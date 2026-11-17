/**
 * 文件夹的图标和颜色（2026-11-17 左栏重组）：树上那一行、文件夹首页的头、活动栏（只用单色符号）都用同一个。
 * 「设图标和颜色…」是贴在那一行右边的小弹层：先摆 32 个常用的 Codicons，上面能搜整套；8 个低饱和色；改了马上生效。
 */
import { Codicon, hasCodicon } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import { COLOR_NAMES, FOLDER_COLORS, type FolderColor, PICK_ICONS, setLook } from '../../shared/left'
import { Popover } from '../shell/Shell'
import { folderLook, updateLeft, useLeft } from './left-store'
import './look.css'

type Glyphs = Record<string, readonly [string, string, string]>
let all: Glyphs | null = null
let loading: Promise<Glyphs> | null = null
/** 整套 Codicons 只在用到常用那套以外的图标、或者在弹层里搜的时候才加载 */
const loadAll = () => (loading ??= import('@cn/design/codicons-all').then((m) => (all = m.ALL_CODICONS)))

/** 任何一个 Codicon：常用那套直接画，不在里面的等整套加载完再画（之前先画普通文件夹） */
export function AnyCodicon(props: { name: string; size?: number }) {
  const size = props.size ?? 16
  const [, redraw] = useState(0)
  const known = hasCodicon(props.name)
  useEffect(() => {
    if (!known && !all) void loadAll().then(() => redraw((x) => x + 1))
  }, [known])
  if (known) return <Codicon name={props.name as Parameters<typeof Codicon>[0]['name']} size={size} />
  const g = all?.[props.name]
  if (!g) return <Codicon name="folder" size={size} />
  return <svg className="ci" width={size} height={size} viewBox={g[0]} fill="currentColor" aria-hidden dangerouslySetInnerHTML={{ __html: g[1] }} />
}

/** 树上、卡片上的文件夹图标：自己的图标，染自己的颜色（mono：活动栏，只要符号不要颜色） */
export function FolderGlyph(props: { folder: string; size?: number; mono?: boolean; open?: boolean }) {
  useLeft()
  const look = folderLook(props.folder)
  const icon = props.open && look.icon === 'folder' ? 'folder-opened' : look.icon
  return (
    <span className="fglyph" style={!props.mono && look.color ? { color: look.color } : undefined} data-icon={look.icon}>
      <AnyCodicon name={icon} size={props.size ?? 16} />
    </span>
  )
}

/** 文件夹首页头上的图标方块：图标染色，底是这个颜色 13% 的淡底（没颜色时 --fill 底 --t2 图标） */
export function FolderBadge(props: { folder: string; size?: number }) {
  useLeft()
  const look = folderLook(props.folder)
  const size = props.size ?? 44
  return (
    <span
      className="fbadge"
      data-testid="folder-badge"
      data-icon={look.icon}
      style={{ width: size, height: size, ...(look.color ? { color: look.color, background: `color-mix(in srgb, ${look.color} 13%, var(--card))` } : {}) }}
    >
      <AnyCodicon name={look.icon} size={Math.round(size / 2)} />
    </span>
  )
}

/** 「设图标和颜色…」弹层 */
export function LookPicker(props: { folder: string; anchor: HTMLElement; onClose(): void }) {
  const cfg = useLeft()
  const look = folderLook(props.folder)
  const own = cfg.looks[props.folder] ?? {}
  const [q, setQ] = useState('')
  const [, redraw] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (q && !all) void loadAll().then(() => redraw((x) => x + 1))
  }, [q])
  const found = useMemo(() => {
    const w = q.trim().toLowerCase()
    if (!w || !all) return null
    return Object.entries(all)
      .filter(([n, g]) => n.includes(w) || g[2].includes(w))
      .slice(0, 48)
      .map(([n]) => n)
  }, [q, all])
  const put = (patch: { icon?: string; color?: FolderColor | undefined }) =>
    void updateLeft((c) => setLook(c, props.folder, { icon: own.icon ?? (look.own ? undefined : look.icon), color: own.color, ...patch }))
  const icons = found ?? [...PICK_ICONS]
  const name = props.folder.split('/').pop()!
  return (
    <Popover anchor={props.anchor} label="设图标和颜色" onClose={props.onClose} side="right" className="lookpick">
      <div className="lp-hd">
        <FolderBadge folder={props.folder} size={32} />
        <b className="truncate">{name}</b>
      </div>
      <label className="lp-find">
        <Codicon name="search" size={14} />
        <input ref={input} aria-label="找图标" placeholder="找图标（Codicons）" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="lp-lab">{found ? `找到${found.length === 48 ? '48+' : found.length}个` : '图标'}</div>
      <div className="lp-icons" role="listbox" aria-label="图标">
        {icons.map((n) => (
          <button key={n} role="option" aria-selected={look.icon === n} aria-label={n} title={n} className={look.icon === n ? 'on' : ''} onClick={() => put({ icon: n })}>
            <AnyCodicon name={n} />
          </button>
        ))}
        {found && !found.length && <p className="lp-none">Codicons里没有叫这个的</p>}
      </div>
      <div className="lp-lab">颜色</div>
      <div className="lp-cols" role="listbox" aria-label="颜色">
        <button role="option" aria-label="不设颜色" aria-selected={!look.color} className={'none' + (!look.color ? ' on' : '')} onClick={() => put({ color: undefined })} />
        {(Object.keys(FOLDER_COLORS) as FolderColor[]).map((c) => (
          <button key={c} role="option" aria-label={COLOR_NAMES[c]} aria-selected={look.color === FOLDER_COLORS[c]} className={look.color === FOLDER_COLORS[c] ? 'on' : ''} style={{ background: FOLDER_COLORS[c] }} onClick={() => put({ color: c })} />
        ))}
      </div>
      <div className="lp-ft">
        <span>树、首页、活动栏都用它</span>
        <button className="lp-reset" disabled={!cfg.looks[props.folder]} onClick={() => void updateLeft((c) => setLook(c, props.folder, null))}>
          <Codicon name="discard" size={14} />
          恢复默认
        </button>
      </div>
    </Popover>
  )
}
