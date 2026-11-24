/**
 * 选中小条（task-26nz7）和回答下面那排（task-eavzx）两页共用的几块：
 * - Ico：一颗的图标（ai、tr 画那一家的标志）；
 * - Pop：贴着按钮弹的浅底小菜单；
 * - SmallSeg：220 宽的分段；
 * - ZoneList：能拖的三段表（每行把手 · 勾 · 图标 · 名字 · 我的 / 自带 · 在哪出现 · 键 · ⋯），按住拖着排，往不让放的段拖描红；
 * - KeyRow：编辑页「快捷键」那一行（按新键、要带 ⌘ 或 ⌃、撞了说撞了谁、换给这一条 / 两个对调）。
 * 样子都在 sel-bar.css（sb- 开头）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { trackDrag } from '@cn/design/drag-end'
import { type CSSProperties, Fragment, type PointerEvent as RPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { comboOf } from '../../shared/cmd-keys'
import { barKeyOk } from '../../shared/sel-bar'
import { AiIcon } from '../engine-logo'
import { type useT } from '../i18n'
import { checkKey } from '../keys'
import './sel-bar.css'

type T = ReturnType<typeof useT>

/** 一颗的图标：ai 画 AI 对话那一家的标志，tr 画翻译那一家的 */
export function Ico({ icon, size = 16 }: { icon: string; size?: number }) {
  if (icon === 'ai') return <AiIcon job="chat" size={size} />
  if (icon === 'tr') return <AiIcon job="translate" size={size} />
  return <Codicon name={icon as CodiconName} size={size} />
}

/** 浅底的小菜单：贴着按钮下面，右边对齐，下面放不下放上面 */
export function Pop(props: { at: DOMRect; width: number; onClose(): void; children: ReactNode; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ left: -9999, top: -9999, width: props.width })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const left = Math.max(8, Math.min(props.at.right - props.width, innerWidth - props.width - 8))
    let top = props.at.bottom + 4
    if (top + el.offsetHeight > innerHeight - 8) top = Math.max(8, props.at.top - el.offsetHeight - 4)
    setStyle({ left, top, width: props.width })
  }, [props.at])
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && props.onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      props.onClose()
    }
    document.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [])
  return (
    <div ref={ref} className={'sb-pmenu' + (props.className ? ' ' + props.className : '')} style={style} role="menu" aria-label={props.label}>
      {props.children}
    </div>
  )
}

/** 220 宽的分段（原型 .seg.w220；停用的一样灰） */
export function SmallSeg<V extends string>(props: { label: string; value: V; options: readonly (readonly [V, string, boolean?])[]; onChange(v: V): void }) {
  return (
    <div className="sb-seg w220" role="radiogroup" aria-label={props.label}>
      {props.options.map(([v, text, off]) => (
        <button key={v} type="button" role="radio" aria-checked={props.value === v} className={props.value === v ? 'on' : ''} disabled={off} onClick={() => props.value !== v && props.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- 能拖的三段表

/** 表里一段 */
export interface ZoneDef<Z extends string> {
  z: Z
  /** 段名（也是这一段 list 的名字） */
  title: string
  /** 段名那一行段名后面的（几颗、满了的提示） */
  head?: ReactNode
  /** 空着时那一格写的 */
  empty: string
  /** 这一段多加的 class（描红、抖一下） */
  cls?: string
}

/** 表里一行 */
export interface ZoneRow {
  id: string
  label: string
  icon: string
  mine: boolean
  /** 「在哪出现」那一格 */
  where: string
  key: string | null
}

export function ZoneList<Z extends string>(p: {
  t: T
  /** 这张表的名字（role=group） */
  label: string
  dataRow?: string
  zones: readonly ZoneDef<Z>[]
  rows(z: Z): ZoneRow[]
  /** 去掉勾的那一段（行变灰、勾空着） */
  offZone: Z
  flash: { id: string; seq: number } | null
  /** 勾上悬停写的（默认：勾着「去掉勾：不出现」，空着「勾上：收进 ⋯」） */
  ckTip?: { on: string; off: string }
  /** 拖着往这一段放不行（条上满了）：描红，松手不挪 */
  denies?(id: string, z: Z): boolean
  /** 正拖着往不让放的段上放（松手、拖走、被打断都退掉） */
  onDragDeny?(on: boolean): void
  /** 松手在不让放的段上 */
  onDenied?(): void
  onMove(id: string, z: Z, index: number): void
  onToggle(id: string): void
  onMenu(id: string, at: DOMRect): void
}) {
  const { t } = p
  const drag = useRef<{ id: string; x0: number; y0: number; off: number; started: boolean; ghost: HTMLElement | null; row: HTMLElement; target: { z: Z; idx: number } | 'deny' | null } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const dropline = useRef<HTMLDivElement>(null)

  function onRowDown(e: RPointerEvent<HTMLDivElement>, id: string) {
    if (e.button !== 0 || (e.target as Element).closest('.sb-ck, .sb-more')) return
    const row = e.currentTarget
    const rr = row.getBoundingClientRect()
    drag.current = { id, x0: e.clientX, y0: e.clientY, off: e.clientY - rr.top, started: false, ghost: null, row, target: null }
    row.setPointerCapture(e.pointerId)
    // 松手没送到页面（窗口外松手、失焦）：当没拖过，先后不变（trackDrag，task-0nz63）
    trackDrag<PointerEvent>(e, { move: onRowMove, end: (how) => onRowUp(how === 'up') })
  }
  function onRowMove(e: { clientX: number; clientY: number }) {
    const d = drag.current
    const L = list.current
    if (!d || !L) return
    if (!d.started) {
      if (Math.abs(e.clientY - d.y0) < 4 && Math.abs(e.clientX - d.x0) < 4) return
      d.started = true
      d.row.classList.add('dragging')
      const g = d.row.cloneNode(true) as HTMLElement
      g.classList.remove('dragging', 'flash')
      g.classList.add('sb-ghost')
      L.appendChild(g)
      d.ghost = g
    }
    const lr = L.getBoundingClientRect()
    d.ghost!.style.left = '6px'
    d.ghost!.style.width = `${lr.width - 12}px`
    d.ghost!.style.top = `${e.clientY - lr.top - d.off}px`
    let best: { z: Z; idx: number; y: number } | null = null
    for (const z of Array.from(L.querySelectorAll<HTMLElement>('.sb-zone'))) {
      const zr = z.getBoundingClientRect()
      if (e.clientY < zr.top - 18 || e.clientY > zr.bottom + 18) continue
      const rows = Array.from(z.querySelectorAll<HTMLElement>('.sb-it')).filter((r) => r.dataset.id !== d.id)
      let idx = rows.length
      let y = rows.length ? rows[rows.length - 1]!.getBoundingClientRect().bottom : zr.top + 4
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) {
          idx = i
          y = r.top
          break
        }
      }
      best = { z: z.dataset.z as Z, idx, y }
      break
    }
    const dl = dropline.current!
    const denyNow = !!best && !!p.denies?.(d.id, best.z)
    p.onDragDeny?.(denyNow)
    if (!best) {
      dl.style.display = 'none'
      d.target = null
      return
    }
    if (denyNow) {
      dl.style.display = 'none'
      d.target = 'deny'
      return
    }
    dl.style.display = 'block'
    dl.style.top = `${best.y - lr.top - 1}px`
    d.target = { z: best.z, idx: best.idx }
  }
  /** 松手（drop false：松手没送到，只收拾、不挪） */
  function onRowUp(drop: boolean) {
    const d = drag.current
    drag.current = null
    p.onDragDeny?.(false)
    if (!d || !d.started) return
    d.ghost?.remove()
    d.row.classList.remove('dragging')
    if (dropline.current) dropline.current.style.display = 'none'
    const tg = drop ? d.target : null
    if (!tg) return
    if (tg === 'deny') return p.onDenied?.()
    const rows = p.rows(tg.z)
    if (rows.findIndex((r) => r.id === d.id) === tg.idx) return
    p.onMove(d.id, tg.z, tg.idx)
  }

  return (
    <div className="sb-tbl sb-list" ref={list} role="group" aria-label={p.label} data-row={p.dataRow}>
      {p.zones.map((zd) => {
        const items = p.rows(zd.z)
        const off = zd.z === p.offZone
        return (
          <Fragment key={zd.z}>
            <div className="sb-sec">
              {zd.title}
              {zd.head}
            </div>
            <div className={'sb-zone' + (items.length ? '' : ' sb-empty') + (zd.cls ? ' ' + zd.cls : '')} data-z={zd.z} role="list" aria-label={zd.title} data-empty={zd.empty}>
              {items.map((it) => (
                <div
                  key={it.id + (p.flash?.id === it.id ? p.flash.seq : '')}
                  className={'sb-it' + (off ? ' off' : '') + (p.flash?.id === it.id ? ' flash' : '')}
                  data-id={it.id}
                  role="listitem"
                  aria-label={it.label}
                  onPointerDown={(e) => onRowDown(e, it.id)}
                  onLostPointerCapture={() => onRowUp(true)}
                >
                  <span className="sb-grip" title={t('按住拖')}>
                    <Codicon name="gripper" size={16} />
                  </span>
                  <span className={'sb-ck' + (off ? '' : ' on')} role="checkbox" aria-checked={!off} aria-label={it.label} title={off ? (p.ckTip?.off ?? t('勾上：收进 ⋯')) : (p.ckTip?.on ?? t('去掉勾：不出现'))} onClick={() => p.onToggle(it.id)}>
                    {!off && <Codicon name="check" size={12} />}
                  </span>
                  <span className="sb-ico">
                    <Ico icon={it.icon} />
                  </span>
                  <span className="sb-n">{it.label}</span>
                  <span className={'sb-tag' + (it.mine ? ' mine' : '')}>{it.mine ? t('我的') : t('自带')}</span>
                  <span className="sb-wh">{it.where}</span>
                  <span className="sb-kk">{it.key && <span className="sb-kbd">{it.key}</span>}</span>
                  <button type="button" className="sb-more" aria-label={t('这一颗还能…')} title={t('这一颗还能…')} onClick={(e) => p.onMenu(it.id, e.currentTarget.getBoundingClientRect())}>
                    <Codicon name="ellipsis" size={16} />
                  </button>
                </div>
              ))}
            </div>
          </Fragment>
        )
      })}
      <div className="sb-dropline" ref={dropline} />
    </div>
  )
}

// ---------------------------------------------------------------- 快捷键那一行

/** 撞了别的：换给这一条（give），两个对调（swap）；没撞是 null */
export type KeyMode = 'give' | 'swap' | null

/**
 * 编辑页「快捷键」那一行：点了按新键（esc 取消）；要带 ⌘ 或 ⌃，或 ⌥ 加字母；撞了说撞了谁，给「换给这一条」「两个对调」。
 * rec 由页面管（⌘↵ 存好在按新键时不算）
 */
export function KeyRow(p: {
  t: T
  value: string
  mode: KeyMode
  rec: boolean
  setRec(on: boolean): void
  /** 这一条的编号（新的还没有时给个占位） */
  self: string
  desc: ReactNode
  /** 这一页自己的表里撞了谁（比命令表先认） */
  clashOf?(combo: string): string | undefined
  /** 只认带 ⌘ 或 ⌃ 的（全局键；默认还认 ⌥ 加字母，选中小条那种只在选着字时认的） */
  strict?: boolean
  onChange(key: string, mode: KeyMode): void
}) {
  const { t } = p
  const [clash, setClash] = useState<{ text: string; who?: string } | null>(null)
  // 按键时拿最新的（页面别处改了草稿也不拿旧的）
  const now = useRef(p)
  now.current = p

  useEffect(() => {
    if (!p.rec) return
    const p0 = now.current
    setClash({ text: p0.strict ? t('要带 ⌘ 或 ⌃；esc 取消') : t('要带 ⌘ 或 ⌃，或 ⌥ 加字母；esc 取消') })
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        p0.setRec(false)
        setClash(null)
        return
      }
      const p = now.current
      const c = comboOf(e)
      if (!c || ['Meta', 'Alt', 'Control', 'Shift'].includes(e.key)) return
      if (p.strict ? !/[⌘⌃]/.test(c) : !barKeyOk(c)) return setClash({ text: p.strict ? t('「{key}」不能用：要带 ⌘ 或 ⌃', { key: c }) : t('「{key}」不能用：要带 ⌘ 或 ⌃，或 ⌥ 加字母', { key: c }) })
      p.setRec(false)
      const hit = p.clashOf?.(c)
      const app = hit ? null : checkKey(p.self, c)
      if (app?.problem) return setClash({ text: app.problem })
      const who = hit ?? app?.clash?.name
      p.onChange(c, who ? 'give' : null)
      setClash(who ? { text: t('和「{name}」撞了', { name: who }), who } : null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p.rec])

  return (
    <div className="sb-row">
      <div className="nm">
        <b>{t('快捷键')}</b>
        <span>{p.desc}</span>
        {clash && (
          <div className="sb-clash" role="status">
            {clash.text}
            {clash.who && (
              <>
                <a role="button" tabIndex={0} className={p.mode === 'give' ? 'on' : ''} onClick={() => (p.onChange(p.value, 'give'), setClash({ text: t('「{name}」的键给这一条；存好时改', { name: clash.who! }), who: clash.who }))}>
                  {t('换给这一条')}
                </a>
                <a role="button" tabIndex={0} className={p.mode === 'swap' ? 'on' : ''} onClick={() => (p.onChange(p.value, 'swap'), setClash({ text: t('和「{name}」两个对调；存好时改', { name: clash.who! }), who: clash.who }))}>
                  {t('两个对调')}
                </a>
              </>
            )}
          </div>
        )}
      </div>
      <div className="rc">
        <button type="button" className={'sb-keybtn' + (p.rec ? ' rec' : '')} aria-label={t('快捷键')} onClick={() => p.setRec(true)}>
          {p.rec ? t('按下新键…') : p.value || t('设快捷键')}
        </button>
        {p.value && !p.rec && (
          <button type="button" className="sb-btn ghost" onClick={() => (p.onChange('', null), setClash(null))}>
            {t('清掉')}
          </button>
        )}
      </div>
    </div>
  )
}
