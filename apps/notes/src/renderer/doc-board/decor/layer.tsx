/**
 * 白板装饰（设计页 145「卡片贴纸便签胶带」，2026-11-25 用户定「可以开工」；格式 @cn/format ink-decor.ts）Mac 这边：
 * - 贴纸、胶带：这块白板的 笔迹.ink 里一样一行（md 不多一个字），画在白板平面里（跟着 CSS zoom 缩放）、盖在卡上面；
 *   挂在卡上的（on）跟着那张卡画（每次画量卡的位置；卡看不见、删了不画，撤回删卡就回来）；挂在便签上的跟着便签的歪角度转。
 *   选中：贴纸顶上旋转把手（转到 0° / ±15° / ±90° 附近吸一下）、右下角缩放，小条「摆正 · 放到最上面 · 删除」，
 *   拖进来的图多「改成图片卡」；胶带小条「换花样 · 删除」。按住拖是挪，胶带拖到卡角、卡边 36 以内吸住；⌫ 删、Esc 取消、⌘Z 撤回
 *   （和白板别的动作同一串：写笔迹文件走 ink-layer 的 write，进白板的撤回）。
 * - 装饰抽屉（左边工具板「装饰」）：便签 / 胶带 / 贴纸三页，拖出来放到白板上；便签放下马上进打字，空着不写文件。
 * - 透明图贴纸：从访达拖进白板、或抽屉「从照片…」：透明 PNG / WebP 放成贴纸（图拷进这篇的附件，.ink 记 src），别的照旧放成图片卡。
 * - 卡片样式、便签纸色：选中一张卡时操作条「样式 ▾」/「纸色 ▾ · 摆正」，列头右键「样式…」；改的是 md 卡注释行、列名下那一行。
 * - 会消失的笔：fade.tsx。
 * 挂到一张还没有编号（或那一行没有 ink=1）的卡上时，先给那张卡记上编号（md 改一行注释），和笔迹那一行算一步撤回。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { trackDrag } from '@cn/design/drag-end'
import {
  addDecor,
  addNote,
  type CardStyle,
  cardStyleOf,
  decorId,
  type DocBoard,
  type DocUnit,
  deleteDecors,
  freshId,
  inkCardId,
  inkDecors,
  type InkDecor,
  noteOf,
  type NoteColor,
  NOTE_SIZE,
  type ParsedDecor,
  parseInk,
  raiseDecor,
  setCardAttrs,
  setColumnAttrs,
  snapRotation,
  snapTape,
  splitDoc,
  stickerPathOf,
  stickerWidth,
  TAPE_WIDTH,
  type TapeAnchor,
  tapeAnchor,
  unitId,
  unitKeys,
  updateDecor,
} from '@cn/format'
import { type CSSProperties, type MutableRefObject, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t as tNow } from '../../../shared/i18n'
import { useT } from '../../i18n'
import { anchorOf, type PopAnchor } from '../../pop-place'
import { SelBar } from '../../multi-select/SelBar'
import { typingIn } from '../../typing'
import { imageMarkdown } from '../../web/image-drop'
import type { InkLayer } from '../ink-layer'
import { InlineCard } from '../inline-card'
import { freshStickerRot, freshTape, PAPER_NAMES, STICKER_NAMES, stickerAspect, tapeSVG } from './art'
import { DecorDrawer, type DrawerItem, type DrawerTab } from './drawer'
import { awayFrom, cardLook, colLook, type Look, noteLayers, PaperPop, StylePop, TapePop } from './look'
import { photoInfo, photoWidth } from './photo'
import { STICKER_SVG, stickerData } from './sticker-svg'
import './decor.css'

type Pt = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }

/** 能挂装饰的一张卡：白板坐标里没转过的框、歪的角度（便签）、叫什么（提示里说） */
interface Host extends Rect {
  key: string
  unit: DocUnit
  rot: number
  name: string
}

export interface DecorCtx {
  notePath: string
  readOnly: boolean
  active: boolean
  /** 画布上真正的比例（CSS zoom） */
  scale: number
  wrap: RefObject<HTMLDivElement | null>
  plane: RefObject<HTMLDivElement | null>
  board: DocBoard
  keys: Map<DocUnit, string>
  byKey: Map<string, DocUnit>
  /** 量到的每张卡在白板上的位置（白板坐标，键是卡的名字） */
  rects: Record<string, Rect>
  ink: InkLayer
  /** 编辑器里现在的全文 */
  cur: MutableRefObject<string>
  /** 改 md：一步，进白板的撤回 */
  write(next: string, what: string): boolean
  /** 刚才那一步和它前面那一步撤回时算一步（挂卡先给卡记编号、再写笔迹那一行） */
  linkLast(): void
  selected: Set<string>
  setSelected(s: Set<string>): void
  /** 选中了装饰：卡、笔迹、连线都不再选着 */
  clearOthers(): void
  removeKeys(ks: Iterable<string>): void
  toast(text: string): void
  focus(): void
  /** 拖着卡、拖着框：小条先藏起来 */
  hidden: boolean
  /** 改着字、看着全文、展开着数据库、选着笔迹：不出单张卡那一条 */
  quiet: boolean
  /** 不透明的图：照旧放成图片卡（client 是松手的地方，落进一列就放进那一列） */
  putImages(mds: string[], client: Pt | null, at: Pt): void
  onDraft?(flush: (() => void) | null): void
}

export interface Decor {
  /** 画在白板平面里的：贴纸、胶带、吸附虚线框、正在写的便签 */
  plane: ReactNode
  /** 盖在白板上的：抽屉、小条、浮层、顶上那句「贴在…」、拖着走的影子 */
  overlay: ReactNode
  /** 鼠标按下（白板的捕获阶段）：点在装饰上就选中、按住拖是挪，返回 true */
  capture(e: React.MouseEvent): boolean
  /** 从访达拖进来的图：接住了返回 true */
  drop(e: React.DragEvent): boolean
  cardLook(u: DocUnit): Look | null
  colLook: typeof colLook
  drawerOpen: boolean
  toggleDrawer(): void
  /** 列头右键「样式…」 */
  styleColumn(ci: number, at: PopAnchor): void
  /** 选了好几张时操作条「样式 ▾」 */
  styleCards(keys: Set<string>, el: HTMLElement): void
}

const ANCHOR_NAMES: Record<TapeAnchor, string> = {
  tl: '左上角', // 不翻：画的地方翻
  tr: '右上角', // 不翻
  bl: '左下角', // 不翻
  br: '右下角', // 不翻
  t: '上边', // 不翻
  b: '下边', // 不翻
  l: '左边', // 不翻
  r: '右边', // 不翻
}

const vaultSrc = (path: string) => 'cn-file://vault/' + path.split('/').map(encodeURIComponent).join('/')

/** 卡叫什么：第一行字（去掉 md 记号，最多 14 个字）；图片卡叫「这张图」，便签叫「这张便签」 */
function nameOf(u: DocUnit): string {
  if (u.place && noteOf(u)) return tNow('这张便签')
  const first = u.text.split('\n').find((l) => l.trim()) ?? ''
  if (/^\s*!\[/.test(first)) return tNow('这张图')
  const s = first
    .replace(/^[#>*\-\s[\]xX]+/, '')
    .replace(/[*_`[\]]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
  return s.length > 14 ? s.slice(0, 14) + '…' : s || tNow('这张卡')
}

/** 把点 (x, y) 绕 (cx, cy) 转 deg 度 */
function turn(x: number, y: number, cx: number, cy: number, deg: number): Pt {
  if (!deg) return { x, y }
  const a = (deg * Math.PI) / 180
  const dx = x - cx
  const dy = y - cy
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) }
}

export function useDecor(c: DecorCtx): Decor {
  const t = useT()
  const cRef = useRef(c)
  cRef.current = c
  const decors = useMemo(() => inkDecors(c.ink.doc), [c.ink.doc])
  /** 选着的那一样：「tape:编号」「sticker:编号」 */
  const [sel, setSel] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerTab | null>(null)
  /** 拖着、转着、缩放着的那一样：画的时候用这个代替文件里的 */
  const [live, setLive] = useState<{ key: string; x: number; y: number; rot: number; w?: number } | null>(null)
  /** 拖着胶带离卡角近：吸附位（虚线框）和顶上那句 */
  const [snap, setSnap] = useState<{ x: number; y: number; rot: number; len: number; say: string } | null>(null)
  /** 从抽屉拖着的那一样：影子跟着鼠标（窗口坐标） */
  const [ghost, setGhost] = useState<{ it: DrawerItem; at: Pt } | null>(null)
  /** 刚放下、正在打字的便签 */
  const [draft, setDraft] = useState<{ x: number; y: number; color: NoteColor; rot: number; n: number } | null>(null)
  const [pop, setPop] = useState<{ k: 'style' | 'paper' | 'tape' | 'colstyle' | 'many'; at: PopAnchor; up?: boolean; ci?: number; keys?: Set<string> } | null>(null)

  // 选着的那一样从文件里没了（撤回、外面删了）：不再选着
  useEffect(() => {
    if (sel && !decors.some((d) => `${d.kind}:${d.id}` === sel)) setSel(null)
  }, [decors, sel])

  // ----- 能挂装饰的卡（白板坐标）：列里的在前、空白处的在后（盖在上面），便签按没转过的框 -----
  const hosts = useMemo((): Host[] => {
    const out: Host[] = []
    for (const [u, key] of c.keys) {
      if (u.ask || u.group) continue
      const r = c.rects[key]
      if (!r) continue
      const n = u.place ? noteOf(u) : null
      if (n) {
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        out.push({ key, unit: u, x: cx - n.w / 2, y: cy - n.h / 2, w: n.w, h: n.h, rot: n.rot, name: nameOf(u) })
      } else out.push({ key, unit: u, ...r, rot: 0, name: nameOf(u) })
    }
    return out.sort((a, b) => Number(!!a.unit.place) - Number(!!b.unit.place))
  }, [c.keys, c.rects])
  const hostById = useMemo(() => {
    const m = new Map<string, Host>()
    for (const h of hosts) {
      const id = unitId(h.unit)
      if (id) m.set(id, h)
    }
    return m
  }, [hosts])

  /** 一样装饰在白板上的中心和角度；挂的卡看不见返回 null */
  const placeOf = (d: InkDecor): { x: number; y: number; rot: number } | null => {
    if (d.on === null) return { x: d.x, y: d.y, rot: d.rot }
    const h = hostById.get(d.on)
    if (!h) return null
    const local = d.kind === 'tape' && d.at !== null ? tapeAnchor({ x: 0, y: 0, w: h.w, h: h.h }, d.at) : { x: d.x, y: d.y }
    const p = turn(h.x + local.x, h.y + local.y, h.x + h.w / 2, h.y + h.h / 2, h.rot)
    return { x: p.x, y: p.y, rot: d.rot + h.rot }
  }

  // ----- 写笔迹文件（一样一步，进白板的撤回） -----
  const inkNow = () => parseInk(cRef.current.ink.latest())
  const writeInk = (doc: ReturnType<typeof parseInk>, what: string, commit: string) => cRef.current.ink.write(doc, what, commit)
  /** 给这张卡记上编号（那一行带 ink=1）：md 改了返回 true；找不到这张卡返回 null */
  const ensureId = (key: string, quiet = false): { id: string; md: boolean } | null => {
    const cur = cRef.current.cur.current
    const unit = [...unitKeys(splitDoc(cur))].find(([, k]) => k === key)?.[0]
    if (!unit) return null
    const r = inkCardId(cur, unit)
    if (r.text === cur) return { id: r.id, md: false }
    cRef.current.write(r.text, quiet ? '' : tNow('给「{name}」记了编号：挂在它上面的装饰跟着它走', { name: nameOf(unit) }))
    return { id: r.id, md: true }
  }
  /** 写一行装饰；要先给卡记编号的，两步算一步撤回 */
  const commitDecor = (next: (id: string | null) => ReturnType<typeof parseInk>, hostKey: string | null, what: string, commit: string) => {
    let id: string | null = null
    let md = false
    if (hostKey) {
      // 挪装饰这类小操作（what 是空字）：顺手给卡记编号那一下也不出提示
      const r = ensureId(hostKey, !what)
      if (!r) return
      id = r.id
      md = r.md
    }
    if (writeInk(next(id), what, commit) && md) cRef.current.linkLast()
  }

  // ----- 吸附：胶带离哪张卡的哪个吸附位近；贴纸的中心落在哪张卡上 -----
  const tapeSnap = (x: number, y: number, len: number): { host: Host; at: TapeAnchor; x: number; y: number; rot: number; say: string } | null => {
    // 便签歪着：按它没转过的框找吸附位，再转回去
    const cands = hosts.map((h) => {
      const p = turn(x, y, h.x + h.w / 2, h.y + h.h / 2, -h.rot)
      return { h, p }
    })
    let best: { host: Host; at: TapeAnchor; x: number; y: number; rot: number; say: string } | null = null
    let bd = Infinity
    for (const { h, p } of cands) {
      const s = snapTape([{ id: h.key, x: h.x, y: h.y, w: h.w, h: h.h }], p.x, p.y)
      if (!s) continue
      const d = Math.hypot(s.x - p.x, s.y - p.y)
      if (d <= bd) {
        bd = d
        const q = turn(s.x, s.y, h.x + h.w / 2, h.y + h.h / 2, h.rot)
        best = { host: h, at: s.at, x: q.x, y: q.y, rot: s.rot + h.rot, say: tNow('贴在「{name}」{where}，跟着这张卡走', { name: h.name, where: tNow(ANCHOR_NAMES[s.at]) }) }
      }
    }
    void len
    return best
  }
  const hostUnder = (x: number, y: number): Host | null => {
    for (let i = hosts.length - 1; i >= 0; i--) {
      const h = hosts[i]!
      const p = turn(x, y, h.x + h.w / 2, h.y + h.h / 2, -h.rot)
      if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h
    }
    return null
  }
  /** 贴纸挂在卡上时记的：相对卡左上角（没转过的框）的中心、相对卡的角度 */
  const localOn = (h: Host, x: number, y: number, rot: number) => {
    const p = turn(x, y, h.x + h.w / 2, h.y + h.h / 2, -h.rot)
    return { x: Math.round((p.x - h.x) * 100) / 100, y: Math.round((p.y - h.y) * 100) / 100, rot: Math.round((rot - h.rot) * 10) / 10 }
  }

  /** 拖着的时候按 Esc：当没拖过（和白板拖卡一样）；返回「按过 Esc 没有」和收拾的函数 */
  const escWatch = () => {
    const st = { esc: false }
    const on = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      st.esc = true
      setGhost(null)
      setSnap(null)
      setLive(null)
    }
    window.addEventListener('keydown', on, true)
    return { st, off: () => window.removeEventListener('keydown', on, true) }
  }
  const toPlane = (cx: number, cy: number): Pt => {
    const r = c.plane.current!.getBoundingClientRect()
    const s = c.scale || 1
    return { x: (cx - r.left) / s, y: (cy - r.top) / s }
  }
  /** 松手的地方在白板上（不在工具板、抽屉、顶上那条、浮层上） */
  const onBoard = (cx: number, cy: number) => {
    const el = document.elementFromPoint(cx, cy)
    return !!el && !!c.wrap.current?.contains(el) && !el.closest('.dc-drawer')
  }

  // ----- 放：从抽屉拖出来 -----
  const placeSticker = (k: string, x: number, y: number) => {
    const w = stickerWidth(k)
    const rot = freshStickerRot()
    const h = hostUnder(x, y)
    const id = decorId()
    // 第一次用这一张：把 SVG 拷进库里的 附件/贴纸/<k>.svg（已经有了不动）
    void window.cn.decorSticker(k, STICKER_SVG[k] ?? '').catch((e) => c.toast(String((e as Error).message ?? e)))
    const name = t(STICKER_NAMES[k] ?? k)
    commitDecor(
      (on) => {
        const pos = h && on ? localOn(h, x, y, rot) : { x: Math.round(x), y: Math.round(y), rot }
        return addDecor(inkNow(), { kind: 'sticker', id, k, src: null, on, x: pos.x, y: pos.y, w, rot: pos.rot, t: Date.now() })
      },
      h?.key ?? null,
      h ? tNow('贴了一张「{name}」在「{card}」上：笔迹文件多了一行，跟着这张卡走', { name, card: h.name }) : tNow('贴了一张「{name}」：笔迹文件多了一行，文档一个字没动', { name }),
      `装饰：贴纸 ${k}`, // 不翻：提交说明
    )
    setSel(`sticker:${id}`)
  }
  const placeTape = (pat: string, x: number, y: number) => {
    const s = tapeSnap(x, y, 80)
    const f = freshTape(s)
    const id = decorId()
    commitDecor(
      (on) =>
        addDecor(
          inkNow(),
          s && on ? { kind: 'tape', id, on, at: s.at, x: 0, y: 0, pat, len: f.len, rot: Math.round((f.rot - s.host.rot) * 10) / 10, seed: f.seed, t: Date.now() } : { kind: 'tape', id, on: null, at: null, x: Math.round(x), y: Math.round(y), pat, len: f.len, rot: f.rot, seed: f.seed, t: Date.now() },
        ),
      s?.host.key ?? null,
      s ? s.say : tNow('钉在白板上（没挂卡）：笔迹文件多了一行，文档一个字没动'),
      `装饰：胶带 ${pat}`, // 不翻：提交说明
    )
    setSel(`tape:${id}`)
  }
  const grab = (e: React.MouseEvent, it: DrawerItem) => {
    if (e.button !== 0 || c.readOnly) return
    e.preventDefault()
    e.stopPropagation()
    let moved = false
    let last: Pt = { x: e.clientX, y: e.clientY }
    const esc = escWatch()
    trackDrag(e, {
      move: (ev: MouseEvent) => {
        if (esc.st.esc) return
        last = { x: ev.clientX, y: ev.clientY }
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
        moved = true
        setGhost({ it, at: last })
        if (it.kind === 'tape') {
          const p = toPlane(ev.clientX, ev.clientY)
          const s = onBoard(ev.clientX, ev.clientY) ? tapeSnap(p.x, p.y, 80) : null
          setSnap(s ? { x: s.x, y: s.y, rot: s.rot, len: 80, say: s.say } : null)
        }
      },
      end: (how) => {
        setGhost(null)
        setSnap(null)
        esc.off()
        if (how !== 'up' || !moved || esc.st.esc || !onBoard(last.x, last.y)) return
        const p = toPlane(last.x, last.y)
        if (it.kind === 'sticker') placeSticker(it.v, p.x, p.y)
        else if (it.kind === 'tape') placeTape(it.v, p.x, p.y)
        else {
          // 便签：放下马上打字；写了字才写进文件（md 不能有空卡）
          c.clearOthers()
          c.setSelected(new Set())
          setSel(null)
          setDraft({ x: Math.round(p.x - NOTE_SIZE / 2), y: Math.round(p.y - NOTE_SIZE / 2), color: it.v, rot: Math.round((Math.random() - 0.5) * 60) / 10, n: Date.now() })
        }
      },
    })
  }
  const doneDraft = (v: string | null) => {
    const d = draft
    setDraft(null)
    if (!d || v === null) return
    c.write(addNote(c.cur.current, v, Math.max(0, d.x), Math.max(0, d.y), d.color, d.rot), tNow('放了一张{color}便签：文档末尾多了这一段，前面一行记着位置、纸色和歪的角度', { color: t(PAPER_NAMES[d.color]) }))
  }

  // ----- 透明图：访达拖进来、抽屉「从照片…」 -----
  const placePhotos = async (files: File[], client: Pt | null, at: Pt) => {
    const cards: string[] = []
    let n = 0
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer())
        const info = await photoInfo(bytes, f.type)
        const saved = await window.cnWeb.saveImage({ kind: 'bytes', bytes, type: f.type, name: f.name }, f.name, { note: c.notePath })
        if (!info.sticker) {
          cards.push(imageMarkdown(c.notePath, saved.path, { alt: f.name.replace(/\.[a-z0-9]+$/i, '') }))
          continue
        }
        const id = decorId()
        const x = Math.round(at.x + n * 24)
        const y = Math.round(at.y + n * 24)
        n++
        writeInk(
          addDecor(inkNow(), { kind: 'sticker', id, k: null, src: saved.path, on: null, x, y, w: photoWidth(info.w, info.h), rot: -4, t: Date.now() }),
          tNow('认出是透明图，放成了贴纸：图拷进了这篇的附件，笔迹文件多了一行'),
          '装饰：透明图贴纸', // 不翻：提交说明
        )
        setSel(`sticker:${id}`)
      } catch (e) {
        c.toast(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    }
    if (cards.length) c.putImages(cards, client, { x: Math.round(at.x - 110), y: Math.round(at.y - 80) })
  }
  const drop = (e: React.DragEvent): boolean => {
    if (c.readOnly) return false
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return false
    e.preventDefault()
    void placePhotos(files, { x: e.clientX, y: e.clientY }, toPlane(e.clientX, e.clientY))
    return true
  }
  const fromPhoto = (f: File) => {
    const w = c.wrap.current
    if (!w) return
    const r = w.getBoundingClientRect()
    void placePhotos([f], null, toPlane(r.left + r.width / 2, r.top + r.height / 2.4))
  }

  // ----- 选中、挪、转、缩放 -----
  const decorOf = (key: string | null): ParsedDecor | undefined => (key ? decors.find((d) => `${d.kind}:${d.id}` === key) : undefined)
  const pick = (key: string) => {
    setSel(key)
    setPop(null)
    c.clearOthers()
    c.setSelected(new Set())
    c.focus()
  }
  const capture = (e: React.MouseEvent): boolean => {
    if (e.button !== 0) return false
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-decor]')
    if (!el || !c.plane.current?.contains(el)) return false
    const key = el.dataset.decor!
    const d = decorOf(key)
    if (!d) return false
    e.preventDefault()
    e.stopPropagation()
    pick(key)
    if (c.readOnly) return true
    const p0 = placeOf(d)
    if (!p0) return true
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle
    const start = toPlane(e.clientX, e.clientY)
    const w0 = d.kind === 'sticker' ? d.w : d.len
    let moved = false
    let cur = { key, x: p0.x, y: p0.y, rot: p0.rot, w: w0 }
    const esc = escWatch()
    trackDrag(e, {
      move: (ev: MouseEvent) => {
        if (esc.st.esc) return
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
        moved = true
        const q = toPlane(ev.clientX, ev.clientY)
        if (handle === 'rot') cur = { ...cur, rot: snapRotation((Math.atan2(q.y - p0.y, q.x - p0.x) * 180) / Math.PI + 90) }
        else if (handle === 'scale') {
          const k = Math.hypot(q.x - p0.x, q.y - p0.y) / Math.max(1, Math.hypot(start.x - p0.x, start.y - p0.y))
          cur = { ...cur, w: Math.round(Math.max(24, Math.min(640, w0 * k))) }
        } else {
          cur = { ...cur, x: p0.x + q.x - start.x, y: p0.y + q.y - start.y }
          if (d.kind === 'tape') {
            const s = tapeSnap(cur.x, cur.y, d.len)
            setSnap(s ? { x: s.x, y: s.y, rot: s.rot, len: d.len, say: s.say } : null)
          }
        }
        setLive(cur)
      },
      end: (how) => {
        setLive(null)
        setSnap(null)
        esc.off()
        if (how !== 'up' || !moved || esc.st.esc) return
        // 拖着挪、转、缩放贴纸胶带是小操作：不出提示（2026-11-25 偏好「小操作不弹成功提示」），⌘Z 照样撤回
        const now = Date.now()
        const n = inkNow()
        if (handle === 'rot') {
          const host = d.on ? hostById.get(d.on) : null
          writeInk(updateDecor(n, d.kind, d.id, { rot: Math.round((cur.rot - (host?.rot ?? 0)) * 10) / 10 }, now), '', '装饰：转了贴纸') // 不翻：提交说明
          return
        }
        if (handle === 'scale') {
          writeInk(updateDecor(n, d.kind, d.id, d.kind === 'sticker' ? { w: cur.w } : { len: cur.w }, now), '', '装饰：改了大小') // 不翻：提交说明
          return
        }
        if (d.kind === 'tape') {
          const s = tapeSnap(cur.x, cur.y, d.len)
          if (s) {
            // 换了吸附位：角度换成那个位置的（原来吸着时歪的那一点留着）
            const base = (at: TapeAnchor) => tapeAnchor({ x: 0, y: 0, w: 1, h: 1 }, at).rot
            const rot = base(s.at) + (d.at !== null ? d.rot - base(d.at) : 0)
            commitDecor(
              (on) => updateDecor(inkNow(), 'tape', d.id, { on, at: s.at, x: 0, y: 0, rot: Math.round(rot * 10) / 10 }, now),
              s.host.key,
              '',
              '装饰：挪了胶带', // 不翻：提交说明
            )
          } else writeInk(updateDecor(n, 'tape', d.id, { on: null, at: null, x: Math.round(cur.x), y: Math.round(cur.y), rot: Math.round(cur.rot * 10) / 10 }, now), '', '装饰：挪了胶带') // 不翻：提交说明
          return
        }
        const h = hostUnder(cur.x, cur.y)
        if (h) {
          commitDecor(
            (on) => {
              const l = localOn(h, cur.x, cur.y, cur.rot)
              return updateDecor(inkNow(), 'sticker', d.id, { on, x: l.x, y: l.y, rot: l.rot }, now)
            },
            h.key,
            '',
            '装饰：挪了贴纸', // 不翻：提交说明
          )
        } else writeInk(updateDecor(n, 'sticker', d.id, { on: null, x: Math.round(cur.x), y: Math.round(cur.y), rot: Math.round(cur.rot * 10) / 10 }, now), '', '装饰：挪了贴纸') // 不翻：提交说明
      },
    })
    return true
  }
  const remove = (key: string) => {
    const d = decorOf(key)
    if (!d) return
    writeInk(deleteDecors(inkNow(), [key]), d.kind === 'tape' ? tNow('删了这段胶带：笔迹文件少了一行') : tNow('删了这张贴纸：笔迹文件少了一行'), d.kind === 'tape' ? '装饰：删了胶带' : '装饰：删了贴纸') // 不翻：提交说明
    setSel(null)
    setPop(null)
  }
  const straighten = (d: ParsedDecor) => {
    const host = d.on ? hostById.get(d.on) : null
    writeInk(updateDecor(inkNow(), d.kind, d.id, { rot: -(host?.rot ?? 0) }, Date.now()), tNow('摆正了：笔迹文件里只改了这一行'), '装饰：摆正') // 不翻：提交说明
  }
  const raise = (d: ParsedDecor) => {
    const next = raiseDecor(inkNow(), d.kind, d.id)
    if (!writeInk(next, tNow('放到了最上面：笔迹文件里这一行挪到了最后'), '装饰：放到最上面')) c.toast(tNow('已经在最上面了')) // 不翻：提交说明
  }
  /** 拖进来的图贴纸改成图片卡：笔迹里删掉这一行，文档末尾放一张图片卡（两步算一步撤回） */
  const toImage = (d: ParsedDecor) => {
    if (d.kind !== 'sticker' || !d.src) return
    const p = placeOf(d)
    if (!p) return
    const md = imageMarkdown(c.notePath, d.src, { alt: d.src.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '') })
    if (!writeInk(deleteDecors(inkNow(), [`sticker:${d.id}`]), tNow('改成了图片卡：笔迹文件少了一行，文档末尾多了一张图'), '装饰：贴纸改成图片卡')) return // 不翻：提交说明
    const at = { x: Math.max(0, Math.round(p.x - d.w / 2)), y: Math.max(0, Math.round(p.y - d.w / 2)) }
    c.putImages([md], null, at)
    c.linkLast()
    setSel(null)
  }
  const setPat = (d: ParsedDecor, pat: string) => {
    if (d.kind !== 'tape' || d.pat === pat) return
    writeInk(updateDecor(inkNow(), 'tape', d.id, { pat }, Date.now()), tNow('换了花样：笔迹文件里只改了这一行'), '装饰：换了胶带花样') // 不翻：提交说明
  }

  // ⌫ 删、Esc 取消（选着装饰时）；点别处取消
  useEffect(() => {
    if (!sel || !c.active) return
    const key = (e: KeyboardEvent) => {
      if (typingIn(e.target) || !c.wrap.current?.checkVisibility()) return
      if ((e.key === 'Backspace' || e.key === 'Delete') && !cRef.current.readOnly) {
        e.preventDefault()
        e.stopPropagation()
        remove(sel)
      } else if (e.key === 'Escape') {
        e.stopPropagation()
        setSel(null)
        setPop(null)
      }
    }
    const down = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (el?.closest?.('[data-decor], .selbar, .dc-pop')) return
      setSel(null)
      setPop(null)
    }
    window.addEventListener('keydown', key, true)
    document.addEventListener('mousedown', down, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      document.removeEventListener('mousedown', down, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, c.active, decors])

  // ----- 卡片样式、便签纸色、列样式（md 卡注释行、列名下那一行） -----
  const freshUnit = (text: string, key: string) => [...unitKeys(splitDoc(text))].find(([, k]) => k === key)?.[0]
  const styleKeys = (ks: Iterable<string>, patch: Record<string, string | null>, what: string) => {
    let text = c.cur.current
    /** 改过的卡的编号（没编号的卡这一下会记上一个，名字跟着变成编号：选着的、浮层里的换成新名字） */
    const ids = new Map<string, string>()
    for (const k of ks) {
      const u = freshUnit(text, k)
      if (!u || u.ask || u.group) continue
      ids.set(k, unitId(u) ?? freshId(text, 'k'))
      text = setCardAttrs(text, u, patch)
    }
    if (text === c.cur.current) return
    c.write(text, what)
    const now = [...unitKeys(splitDoc(text))]
    const rename = (k: string) => {
      const id = ids.get(k)
      return (id && now.find(([u]) => unitId(u) === id)?.[1]) || k
    }
    if ([...c.selected].some((k) => rename(k) !== k)) c.setSelected(new Set([...c.selected].map(rename)))
    setPop((p) => (p?.keys ? { ...p, keys: new Set([...p.keys].map(rename)) } : p))
    renamed.current = new Set([...ids.keys()].map(rename))
  }
  /** 刚改名的卡：选的卡换了名字不算「选的卡换了」，浮层不收 */
  const renamed = useRef<Set<string>>(new Set())
  const styleCol = (ci: number, patch: Record<string, string | null>, what: string) => {
    const col = splitDoc(c.cur.current).columns[ci]
    if (!col?.head) return
    const next = setColumnAttrs(c.cur.current, col, patch)
    if (next !== c.cur.current) c.write(next, what)
  }
  const styleName = (s: CardStyle) => t({ paper: '纸面', glass: '磨砂玻璃', outline: '描边', header: '彩头', lined: '横线纸' }[s])
  const stylePatch = (s: CardStyle) => ({ style: s === 'paper' ? null : s })

  // ----- 单张卡选中时的那一条：样式 ▾（便签：纸色 ▾ · 摆正）｜ 删除 -----
  const oneKey = c.selected.size === 1 ? [...c.selected][0]! : null
  const one = oneKey ? c.byKey.get(oneKey) : undefined
  const oneOk = !!one && !one.ask && !one.group
  const oneNote = one?.place ? noteOf(one) : null
  const oneStyle = one ? cardStyleOf(one.attrs) : null
  const cardBar =
    oneOk && oneKey && c.active && !c.quiet && !c.readOnly ? (
      <SelBar
        count={oneNote ? t('便签') : t('已选{n}张', { n: 1 })}
        items={
          c.readOnly
            ? []
            : oneNote
              ? [
                  { k: 'paper', label: t('纸色'), menu: true, tip: t('换便签的纸色'), dot: `var(--dc-${oneNote.color})` },
                  { k: 'straight', label: t('摆正'), tip: t('摆正这张便签（不歪）') },
                  { k: 'delete', icon: 'trash', tip: t('删除'), red: true, sep: true, keys: '⌫' },
                ]
              : [
                  { k: 'style', label: t('样式'), icon: 'paintcan', menu: true, tip: t('卡片样式：纸面、磨砂玻璃、描边、彩头、横线纸，颜色跟主题的六色') },
                  { k: 'delete', icon: 'trash', tip: t('删除'), red: true, sep: true, keys: '⌫' },
                ]
        }
        foldOrder={[]}
        label={t('选中的这张卡')}
        testid="decor-cardbar"
        hidden={c.hidden}
        open={pop?.k === 'style' || pop?.k === 'paper' ? pop.k : null}
        scrollers={[c.wrap.current]}
        measure={() => {
          const area = c.wrap.current?.parentElement
          if (!area || !c.wrap.current?.checkVisibility()) return null
          const el = c.plane.current?.querySelector<HTMLElement>(`.db-card[data-id="${CSS.escape(oneKey)}"]`)
          const a = area.getBoundingClientRect()
          const r = el?.getBoundingClientRect()
          return { sel: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null, area: { left: a.left, top: a.top, right: a.right, bottom: a.bottom } }
        }}
        onAct={(k, el) => {
          if (k === 'delete') return c.removeKeys([oneKey])
          if (k === 'straight') return styleKeys([oneKey], { rot: '0' }, tNow('摆正了这张便签：只改了它前面那一行的 rot'))
          if (k === 'style' || k === 'paper') {
            const card = c.plane.current?.querySelector<HTMLElement>(`.db-card[data-id="${CSS.escape(oneKey)}"]`)?.getBoundingClientRect() ?? null
            const away = awayFrom(el, card, k === 'style' ? 200 : 96)
            setPop((p) => (p?.k === k ? null : { k, ...away }))
          }
        }}
      />
    ) : null

  // ----- 选着装饰时的小条 -----
  const sd = decorOf(sel)
  const decorBar =
    sd && c.active && !c.quiet ? (
      <SelBar
        count=""
        items={
          c.readOnly
            ? []
            : sd.kind === 'tape'
              ? [
                  { k: 'pat', label: t('换花样'), menu: true, tip: t('换一种胶带花样') },
                  { k: 'delete', label: t('删除'), red: true, tip: t('删掉这段胶带'), keys: '⌫' },
                ]
              : [
                  { k: 'straight', label: t('摆正'), tip: t('转回 0°') },
                  { k: 'raise', label: t('放到最上面'), tip: t('盖在别的装饰上面') },
                  ...(sd.src ? [{ k: 'toimg', label: t('改成图片卡'), tip: t('不当贴纸了：放成一张带框的图片卡') }] : []),
                  { k: 'delete', label: t('删除'), red: true as const, tip: t('删掉这张贴纸'), keys: '⌫' },
                ]
        }
        foldOrder={[]}
        label={sd.kind === 'tape' ? t('选中的胶带') : t('选中的贴纸')}
        testid="decor-bar"
        hidden={!!live || !!ghost}
        open={pop?.k === 'tape' ? 'pat' : null}
        scrollers={[c.wrap.current]}
        measure={() => {
          const area = c.wrap.current?.parentElement
          if (!area || !c.wrap.current?.checkVisibility()) return null
          const el = c.plane.current?.querySelector<HTMLElement>(`[data-decor="${CSS.escape(sel!)}"] > .dc-body`)
          const a = area.getBoundingClientRect()
          const r = el?.getBoundingClientRect()
          // 贴纸顶上有旋转把手：小条再往上让 30
          const up = sd.kind === 'sticker' ? 30 * (c.scale || 1) : 0
          return { sel: r ? { left: r.left, top: r.top - up, right: r.right, bottom: r.bottom } : null, area: { left: a.left, top: a.top, right: a.right, bottom: a.bottom } }
        }}
        onAct={(k, el) => {
          if (k === 'delete') return remove(sel!)
          if (k === 'straight') return straighten(sd)
          if (k === 'raise') return raise(sd)
          if (k === 'toimg') return toImage(sd)
          if (k === 'pat') {
            const r = c.plane.current?.querySelector<HTMLElement>(`[data-decor="${CSS.escape(sel!)}"] > .dc-body`)?.getBoundingClientRect() ?? null
            const away = awayFrom(el, r, 150)
            setPop((p) => (p?.k === 'tape' ? null : { k: 'tape', ...away }))
          }
        }}
      />
    ) : null

  // 浮层：点外面（网页里也算）、Esc、窗口失焦收起（公共的 useDismiss）
  useDismiss(!!pop, [], () => setPop(null), { keep: '.dc-pop, .selbar .sb[data-k="style"], .selbar .sb[data-k="paper"], .selbar .sb[data-k="pat"]' })
  // 选的卡换了：浮层收起（列样式、多张的除外，它们不跟选中走）
  useEffect(() => {
    if (oneKey && renamed.current.has(oneKey)) return void (renamed.current = new Set())
    setPop((p) => (p && (p.k === 'style' || p.k === 'paper') ? null : p))
  }, [oneKey])

  const popNode = (() => {
    if (!pop) return null
    if ((pop.k === 'style' || pop.k === 'paper') && (!oneKey || !one)) return null
    if (pop.k === 'style' && oneKey && oneStyle)
      return (
        <StylePop
          at={pop.at}
          up={pop.up}
          title={t('卡片样式')}
          style={oneStyle.style}
          color={oneStyle.color}
          onStyle={(s) => styleKeys([oneKey], stylePatch(s), tNow('这张卡换成了「{name}」：只改了它前面那一行注释', { name: styleName(s) }))}
          onColor={(col) => styleKeys([oneKey], { color: col === null ? null : String(col) }, col === null ? tNow('颜色回到跟主题：只改了它前面那一行注释') : tNow('换了颜色：只改了这张卡前面那一行注释'))}
          onClose={() => setPop(null)}
        />
      )
    if (pop.k === 'paper' && oneKey && oneNote)
      return <PaperPop at={pop.at} up={pop.up} color={oneNote.color} onPick={(col) => (styleKeys([oneKey], { note: col }, tNow('便签换成了{color}：只改了它前面那一行注释', { color: t(PAPER_NAMES[col]) })), setPop(null))} />
    if (pop.k === 'tape' && sd?.kind === 'tape') return <TapePop at={pop.at} up={pop.up} pat={sd.pat} onPick={(p) => (setPat(sd, p), setPop(null))} />
    if (pop.k === 'colstyle' && pop.ci !== undefined) {
      const col = c.board.columns[pop.ci]
      if (!col) return null
      const cs = cardStyleOf(col.attrs)
      const ci = pop.ci
      return (
        <StylePop
          at={pop.at}
          title={t('「{name}」这一列的样式', { name: col.title ?? '' })}
          style={cs.style}
          color={cs.color}
          onStyle={(s) => styleCol(ci, stylePatch(s), tNow('这一列换成了「{name}」：只改了列名下面那一行', { name: styleName(s) }))}
          onColor={(col2) => styleCol(ci, { color: col2 === null ? null : String(col2) }, col2 === null ? tNow('这一列的颜色回到跟主题：只改了列名下面那一行') : tNow('这一列换了颜色：只改了列名下面那一行'))}
          onClose={() => setPop(null)}
        />
      )
    }
    if (pop.k === 'many' && pop.keys) {
      const ks = pop.keys
      const first = [...ks].map((k) => c.byKey.get(k)).find((u) => u && !u.ask && !u.group)
      const cs = cardStyleOf(first?.attrs)
      return (
        <StylePop
          at={pop.at}
          up={pop.up}
          title={t('这{n}张卡的样式', { n: ks.size })}
          style={cs.style}
          color={cs.color}
          onStyle={(s) => styleKeys(ks, stylePatch(s), tNow('这{n}张卡换成了「{name}」：只改了它们前面那一行注释', { n: ks.size, name: styleName(s) }))}
          onColor={(col) => styleKeys(ks, { color: col === null ? null : String(col) }, tNow('这{n}张卡换了颜色：只改了它们前面那一行注释', { n: ks.size }))}
          onClose={() => setPop(null)}
        />
      )
    }
    return null
  })()

  // ----- 画 -----
  const items = decors.flatMap((d) => {
    const key = `${d.kind}:${d.id}`
    const p0 = placeOf(d)
    if (!p0) return []
    const lv = live?.key === key ? live : null
    const p = lv ? { x: lv.x, y: lv.y, rot: lv.rot } : p0
    const on = sel === key
    if (d.kind === 'tape') {
      const len = lv?.w ?? d.len
      const style: CSSProperties = { left: p.x - len / 2, top: p.y - (TAPE_WIDTH + 2) / 2, width: len, height: TAPE_WIDTH + 2, transform: `rotate(${p.rot}deg)` }
      return [
        <div key={key} className={'dc-item dc-tape' + (on ? ' sel' : '')} style={style} data-decor={key} data-on={d.on ?? undefined} data-at={d.at ?? undefined} data-testid="decor-tape" aria-label={t('胶带')}>
          <div className="dc-body" dangerouslySetInnerHTML={{ __html: tapeSVG(d.pat, len, d.seed) }} />
          {on && <div className="dc-ring" />}
        </div>,
      ]
    }
    const w = lv?.w ?? d.w
    const h = d.k ? w * stickerAspect(d.k) : undefined
    const style: CSSProperties = { left: p.x - w / 2, top: h !== undefined ? p.y - h / 2 : p.y - w / 2, width: w, ...(h !== undefined ? { height: h } : {}), transform: `rotate(${p.rot}deg)` }
    return [
      <div
        key={key}
        className={'dc-item dc-stk' + (on ? ' sel' : '') + (d.src ? ' photo' : '')}
        style={style}
        data-decor={key}
        data-on={d.on ?? undefined}
        data-k={d.k ?? undefined}
        data-testid="decor-sticker"
        aria-label={d.k ? t(STICKER_NAMES[d.k] ?? d.k) : t('贴纸')}
      >
        <img
          className="dc-body"
          src={d.k ? vaultSrc(stickerPathOf(d.k)) : vaultSrc(d.src!)}
          alt=""
          draggable={false}
          onError={(e) => {
            // 库里还没拷过去（刚放下）、读不到：自带的用软件里那一份
            if (d.k && !e.currentTarget.src.startsWith('data:')) e.currentTarget.src = stickerData(d.k)
          }}
        />
        {on && !c.readOnly && (
          <div className="dc-ring">
            <i className="dc-h rot" data-handle="rot" aria-label={t('转')} />
            <i className="dc-h scale" data-handle="scale" aria-label={t('缩放')} />
          </div>
        )}
      </div>,
    ]
  })
  const plane = (
    <>
      <div className="dc-layer" data-testid="decor-layer" data-n={decors.length}>
        {items}
        {snap && <div className="dc-snap" data-testid="decor-snap" style={{ left: snap.x - snap.len / 2, top: snap.y - TAPE_WIDTH / 2, width: snap.len, height: TAPE_WIDTH, transform: `rotate(${snap.rot}deg)` }} />}
      </div>
      {draft && (
        <div className="db-card placed editing draft dc-note dc-note-draft" data-note={draft.color} data-testid="decor-note-draft" style={{ position: 'absolute', left: draft.x, top: draft.y, width: NOTE_SIZE, height: NOTE_SIZE, '--rot': `${draft.rot}deg` } as CSSProperties}>
          {noteLayers}
          <InlineCard key={draft.n} text="" notePath={c.notePath} label={t('便签上的字')} onDone={doneDraft} onNotice={c.toast} onDraft={c.onDraft} />
        </div>
      )}
    </>
  )
  const ghostNode =
    ghost &&
    createPortal(
      <div className={'dc-ghost' + (onBoard(ghost.at.x, ghost.at.y) ? '' : ' off')} style={{ left: ghost.at.x, top: ghost.at.y }}>
        {ghost.it.kind === 'tape' ? (
          <div className="dc-ghost-tape" dangerouslySetInnerHTML={{ __html: tapeSVG(ghost.it.v, 84, 3) }} />
        ) : ghost.it.kind === 'note' ? (
          <div className="dc-note dc-ghost-note" data-note={ghost.it.v} style={{ '--rot': '-2deg' } as CSSProperties}>
            {noteLayers}
          </div>
        ) : (
          <div className="dc-ghost-stk" style={{ width: stickerWidth(ghost.it.v) * (c.scale || 1) }}>
            <img src={stickerData(ghost.it.v)} alt="" />
          </div>
        )}
      </div>,
      document.body,
    )
  const overlay = (
    <>
      {drawer && !c.readOnly && <DecorDrawer tab={drawer} onTab={setDrawer} onClose={() => setDrawer(null)} onGrab={grab} onPhoto={fromPhoto} />}
      {snap && (
        <div className="dc-say" role="status" data-testid="decor-say">
          <Codicon name="pin" size={14} />
          <span>{snap.say}</span>
        </div>
      )}
      {cardBar}
      {decorBar}
      {popNode}
      {ghostNode}
    </>
  )
  return {
    plane,
    overlay,
    capture,
    drop,
    cardLook,
    colLook,
    drawerOpen: !!drawer,
    toggleDrawer: () => setDrawer((d) => (d ? null : 'note')),
    styleColumn: (ci, at) => setPop({ k: 'colstyle', at, ci }),
    styleCards: (ks, el) => {
      const rs = [...ks].flatMap((k) => {
        const e = c.plane.current?.querySelector<HTMLElement>(`.db-card[data-id="${CSS.escape(k)}"]`)
        return e ? [e.getBoundingClientRect()] : []
      })
      const box = rs.length ? { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) } : null
      const away = awayFrom(el, box, 200)
      setPop((p) => (p?.k === 'many' ? null : { k: 'many', ...away, keys: new Set(ks) }))
    },
  }
}
