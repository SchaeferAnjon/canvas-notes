/**
 * 导图白板上的导图（XMind 那样）：布局照属性「导图布局」（向右 / 左右 / 向下 / 鱼骨 / 时间线，shared/mindmap-layout.ts 的分派表），原照片卡在最左边。
 * 白板本身就是导图：正文里的嵌套列表（packages/format/src/mindmap.ts），排版自动。
 * 刚做好的导图节点一个个长出来（中心 → 第一层 → 第二层，偏好「导图长出来的动画」）。
 * 选中主题时照片卡上框出它那一块；拿不准的主题点「?」对照照片改。
 * 第一批（task-wuv05，设计页 15-思维导图）：键照 XMind，都在命令表「导图里」（设置 › 快捷键能改）——Tab 子主题、↵ 后面加同级、
 * ⇧↵ 前面加同级、⌘↵ 父主题、⌥↑ ⌥↓ 挪、空格收起、⇧⌘/ 收起到第一层、⌥↵ 只看这一枝（esc 回到整张，不写进文件）、F2 / 双击改字、
 * ⌫ 删整枝、⌘⌫ 只删这一个；右键菜单把这些都写出来。拖：指在两个同级中间是换位置（强调色插入线），指在主题正中间是放进去（虚线框），
 * 跟着手的小牌说松手后去哪。收起写进文件（行尾注释 fold），关了再开还收着；主题后面的小圆点一下收起 / 展开。
 * 第二批：备注（字后面的小图标、⇧⌘N，存成主题下面缩进的一段）、在导图里找（⇧⌘F，收着的临时展开，不写文件）、链接（只露名字，链接卡）、
 * 导出（PNG / SVG / PDF / OPML）、多选（⌘ 点、⇧ 点、空白处拖框，操作条）、外框、概要、联系线、浮动主题（双击空白处）、主题上挂图、
 * 配色和骨架（「布局 ▾」里挑，跟着软件主题）、鱼骨和时间线两种布局。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { trackDrag } from '@cn/design/drag-end'
import {
  addFloating,
  addParent,
  addSpan,
  anyUnfolded,
  breadthFirst,
  countNodes,
  detachTopic,
  eachNode,
  foldAll,
  hiddenCount,
  insertAt,
  isFloating,
  keyPath,
  type MapNode,
  type MapPath,
  type MapSeg,
  mapLayoutOf,
  mapPaletteOf,
  mapRelsOf,
  mapShown,
  mapSkeletonOf,
  moveAmong,
  moveBeside,
  moveMany,
  moveTo,
  newNode,
  nodeAt,
  parseMindmap,
  pathKey,
  pathOfId,
  relativeLink,
  removeAt,
  removeOne,
  setAttrs,
  setFold,
  setNote,
  setText,
  settle,
  unfoldAll,
  withIds,
  withMapRels,
  withMindmap,
} from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tv } from '../../shared/i18n'
import { BOXED_BOX, type Drop, dropAt, IMG_W, insertLine, layoutMindmap, type Level, type MapLayout, NODE_BOX, NODE_MAX_W, type NodeBox, nearestIn, sumsOf, UL_BOX, wireOf } from '../../shared/mindmap-layout'
import { app } from '../ctx/actions'
import { copy, type MenuEntry, showMenu } from '../ctx/menu'
import { FindBar } from '../find/FindBar'
import { useFindTarget } from '../find/find-hub'
import { useVaultFiles } from '../files/store'
import { rich, useT } from '../i18n'
import { accelFor, isKey, useKeys } from '../keys'
import { imageSrc } from '../md-widgets'
import { typingIn } from '../typing'
import { imagesFrom, looksLikeImage, mayHaveImage, saveImages } from '../web/image-drop'
import { takeGrow } from './capture-store'
import { underCat } from '../../shared/categories'
import { ExportDialog } from './ExportDialog'
import { takeExport, useExportRequest } from './export-store'
import { type BarAct, MapSelBar } from './MapSelBar'
import { measure } from './map-measure'
import { NodeBody, openMapLink, relinkText, unlinkText, useMapLinkCard } from './map-text'
import { NotePop } from './NotePop'
import { fillBlank, type MapDot, mapProgress } from '../../shared/feynman/after'
import { useMapGrow } from '../feynman-after/map-grow'

/**
 * 费曼「补进导图」留的虚线空框（行尾注释 blank）：排版时当成挂在它下面的最后一个孩子占位置（字是「自己补一句」），
 * 画成虚线空框，点开自己填；选、拖、方向键都不算它（排好以后从 L 里拿掉，单独画）
 */
function withGhosts(roots: MapNode[], text: string): { roots: MapNode[]; ghosts: Map<string, string> } {
  const ghosts = new Map<string, string>()
  const walk = (list: MapNode[], base: MapPath): MapNode[] =>
    list.map((n, i) => {
      const path = [...base, i]
      const kids = n.children.length ? walk(n.children, path) : n.children
      if (!n.blank) return kids === n.children ? n : { ...n, children: kids }
      ghosts.set(pathKey([...path, kids.length]), pathKey(path))
      return { ...n, children: [...kids, { text, children: [] }] }
    })
  const out = walk(roots, [])
  return { roots: ghosts.size ? out : roots, ghosts }
}

/** 第一层节点后面的进度小点占多宽（点 7 + 和字隔 6） */
const DOT_W = 13
/** 空框比第二层多的宽：左右内边距各 10、虚线 1（第二层本来留 8） */
const BLANK_PAD = 14
/** 正确说法比第二层多的宽：左右内边距各 8、边 1 */
const FIX_PAD = 10

/** 排好的图里拿掉空框（交互都用拿掉以后的） */
function stripGhosts(L: MapLayout, ghosts: Map<string, string>): MapLayout {
  if (!ghosts.size) return L
  const byKey = { ...L.byKey }
  for (const k of ghosts.keys()) delete byKey[k]
  return { ...L, nodes: L.nodes.filter((n) => !ghosts.has(n.key)), byKey, wires: L.wires.filter((w) => !ghosts.has(w.to)) }
}

/** 正文开头（列表前面）第一张图是原照片 */
function photoOf(before: string, notePath: string): { src: string; caption: string } | null {
  const m = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(before)
  return m ? { src: imageSrc(notePath, m[2]!), caption: m[1]! } : null
}

/** 导图里的命令（命令表 shared/cmd-table.ts 的「导图里」） */
const MAP_CMDS = ['mm-child', 'mm-after', 'mm-before', 'mm-parent', 'mm-up', 'mm-down', 'mm-fold', 'mm-fold-all', 'mm-unfold-all', 'mm-focus', 'mm-edit', 'mm-del', 'mm-del-one', 'mm-note', 'mm-frame', 'mm-rel'] as const
type MapCmd = (typeof MAP_CMDS)[number]

/**
 * 选中时那颗「+」（18 × 18，画布坐标）放哪，照原型：主题右边 6，有折叠圆点时 28，中心 8；下划线主题对着下划线；
 * 往左长的（左右展开的左边一半、鱼骨）在左边；向下展开的中心在它下面 6
 */
function plusAt(b: NodeBox, hasKids: boolean): { x: number; y: number } {
  if (b.depth === 0 && b.side === 'd') return { x: b.x + b.w / 2 - 9, y: b.y + b.h + 6 }
  const off = b.depth === 0 ? 8 : hasKids ? 28 : 6
  const y = (b.level === 'l2' && !b.boxed) || b.ul ? b.y + b.h - 9 : b.y + b.h / 2 - 9
  return b.side === 'l' ? { x: b.x - off - 18, y } : { x: b.x + b.w + off, y }
}

/** 整张图往右下挪一截（换布局时让中心主题留在原处，左上空出来） */
function moveLayout(L: MapLayout, dx: number, dy: number): MapLayout {
  const nodes = L.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy, ...(n.via ? { via: n.via.map((v) => ({ x: v.x + dx, y: v.y + dy })) } : {}) }))
  const shift = (d: string) => d.replace(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${+x + dx} ${+y + dy}`)
  return {
    ...L,
    nodes,
    byKey: Object.fromEntries(nodes.map((n) => [n.key, n])),
    photo: L.photo && { ...L.photo, x: L.photo.x + dx, y: L.photo.y + dy },
    lines: L.lines.map((l) => ({ ...l, x1: l.x1 + dx, x2: l.x2 + dx, y1: l.y1 + dy, y2: l.y2 + dy })),
    frames: L.frames.map((f) => ({ ...f, x: f.x + dx, y: f.y + dy })),
    sums: L.sums.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy, bracket: s.bracket.replace(/V(-?\d+(?:\.\d+)?)/g, (_, v: string) => `V${+v + dy}`).replace(/([MQ])([^MQV]*)/g, (_, c: string, a: string) => c + shift(a)) })),
    rels: L.rels.map((g) => g && { ...g, d: shift(g.d), ah: shift(g.ah), mx: g.mx + dx, my: g.my + dy, hx: g.hx + dx, hy: g.hy + dy, right: g.right + dx, bottom: g.bottom + dy }),
    w: L.w + dx,
    h: L.h + dy,
  }
}

/** 收起来的（有孩子才算）：只看这一枝时那一枝自己照样展开着画；找到东西临时展开的也不算 */
function foldedKeys(roots: MapNode[], center: string | null, open: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  eachNode(roots, (n, p) => {
    const k = pathKey(p)
    if (n.fold && n.children.length && k !== center && !open.has(k)) out.add(k)
  })
  return out
}

/** 只看这一枝：记着路径和字；文件变了（撤回、外面改了）先按路径找，字对不上按字找，找不到就回到整张 */
function locate(roots: MapNode[], focus: { path: MapPath; text: string } | null): MapPath | null {
  if (!focus) return null
  if (nodeAt(roots, focus.path)?.text === focus.text) return focus.path
  let hit: MapPath | null = null
  eachNode(roots, (n, p) => {
    if (!hit && n.text === focus.text) hit = p
  })
  return hit
}

/** 拷贝、交给 AI 时的样子：一段缩进列表（字、备注；行尾注释不带） */
function plainList(list: MapNode[], depth = 0): string {
  return list
    .map((n) => {
      const pad = '  '.repeat(depth)
      const note = n.note ? '\n' + n.note.split('\n').map((l) => (l ? `${pad}  ${l}` : '')).join('\n') : ''
      const kids = n.children.length ? '\n' + plainList(n.children, depth + 1) : ''
      return `${pad}- ${mapShown(n.text)}${n.img ? ` ![${n.img.alt}](${n.img.src})` : ''}${note}${kids}`
    })
    .join('\n')
}

/** 费曼学习盖住的那几支：底下一块淡色的框（原型的 .selbox），框上浮「讲完再看 · 按住看一眼」 */
function MapCover(props: { boxes: { x: number; y: number; w: number; h: number }[]; peeking: boolean; chip: React.ReactNode }) {
  if (!props.boxes.length) return null
  const x = Math.min(...props.boxes.map((b) => b.x)) - 14
  const y = Math.min(...props.boxes.map((b) => b.y)) - 12
  const w = Math.max(...props.boxes.map((b) => b.x + b.w)) + 14 - x
  const h = Math.max(...props.boxes.map((b) => b.y + b.h)) + 12 - y
  return (
    <>
      <div className={'fy-mapcover' + (props.peeking ? ' peek' : '')} data-testid="fy-mapcover" style={{ left: x, top: y, width: w, height: h }} />
      <div className="fy-mapchip" style={{ left: x + 12, top: y + 10 }}>
        {props.chip}
      </div>
    </>
  )
}

/** 选中的几个里最外面的（一个在另一个下面的，只算上面那个） */
const outermost = (keys: string[]) => keys.filter((k) => !keys.some((o) => o !== k && k.startsWith(o + '.')))

export interface MindmapLayerProps {
  text: string
  notePath: string
  scale: number
  readOnly: boolean
  /** 白板的外框（提示条、改字的小弹层挂在它上面，不跟着画布缩放） */
  overlay: HTMLElement | null
  onChange(text: string): void
  onUndo(): void
  onRedo(): void
  onSize(w: number, h: number): void
  onNotice(t: string): void
  /** 换了布局整张放不下：白板缩到放得下（BoardView 的 fitMap） */
  onFit?(): void
  /** 选中的主题变了（费曼学习拿选中的一支当材料，task-yvabi） */
  onSelect?(keys: string[]): void
  /**
   * 费曼学习讲着：这几支（节点的 key，连同下面全部）盖住模糊，上面浮一颗「讲完再看 · 按住看一眼」（chip）；peeking 时露出来
   */
  cover?: { keys: string[]; peeking: boolean; chip: React.ReactNode } | null
}

/** 拖着一个（或选中的几个）主题：按下的地方、现在手在哪（窗口坐标）、动起来没有、松手会去哪 */
type Drag = { key: string; keys: string[]; start: { x: number; y: number }; at: { x: number; y: number }; moved: boolean; drop: Drop }
/** 找的条：找什么、第几处（从 1 起）、也找备注、每按一次 ⇧⌘F 加一（焦点放回框里） */
type FindState = { q: string; cur: number; notes: boolean; seq: number }
/** 画布上的小输入框：外框的名字、概要那句话、联系线上的字 */
type Inline = { kind: 'frame' | 'sum'; key: string } | { kind: 'rel'; i: number }

export function MindmapLayer(p: MindmapLayerProps) {
  const t = useT()
  const K = useKeys()
  const mdoc = useMemo(() => parseMindmap(p.text), [p.text])
  /** 最新的文件（弹层里慢慢存的、拖完才存的按它来） */
  const textRef = useRef(p.text)
  textRef.current = p.text
  const roots = mdoc.roots
  const kind = useMemo(() => mapLayoutOf(p.text), [p.text])
  const palette = useMemo(() => mapPaletteOf(p.text), [p.text])
  const skeleton = useMemo(() => mapSkeletonOf(p.text), [p.text])
  const rels = useMemo(() => mapRelsOf(p.text), [p.text])
  const photo = useMemo(() => photoOf(mdoc.before, p.notePath), [mdoc.before, p.notePath])
  const [aspect, setAspect] = useState<number | null>(null)
  useEffect(() => {
    if (!photo) return
    const img = new Image()
    img.onload = () => img.naturalWidth && setAspect(img.naturalHeight / img.naturalWidth)
    img.src = photo.src
  }, [photo?.src])
  // 主题上挂的图：读到图的宽高比再排（没读到按 3:4）
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const imgSrcs = useMemo(() => {
    const s = new Set<string>()
    eachNode(roots, (n) => n.img && s.add(n.img.src))
    return [...s].sort().join('\n')
  }, [roots])
  useEffect(() => {
    for (const src of imgSrcs ? imgSrcs.split('\n') : []) {
      if (src in aspects) continue
      const img = new Image()
      img.onload = () => img.naturalWidth && setAspects((a) => ({ ...a, [src]: img.naturalHeight / img.naturalWidth }))
      img.src = imageSrc(p.notePath, src)
    }
  }, [imgSrcs, p.notePath])

  // ---------- 只看这一枝（一种看法，不写进文件） ----------
  const [focus, setFocus] = useState<{ path: MapPath; text: string } | null>(null)
  const focusPath = useMemo(() => locate(roots, focus), [roots, focus])
  const focusKey = focusPath ? pathKey(focusPath) : null
  useEffect(() => {
    if (focus && !focusPath) setFocus(null)
  }, [focus, focusPath])

  // ---------- 在导图里找（⇧⌘F；只是看法，收着的枝临时展开，关掉就收回，不写文件） ----------
  const [find, setFind] = useState<FindState | null>(null)
  const hits = useMemo(() => {
    const q = find?.q.trim().toLowerCase()
    if (!q) return []
    const out: { key: string; inNote: boolean }[] = []
    eachNode(roots, (n, path) => {
      const k = pathKey(path)
      if (focusKey && k !== focusKey && !k.startsWith(focusKey + '.')) return
      const inText = mapShown(n.text).toLowerCase().includes(q)
      const inNote = !!find!.notes && !!n.note?.toLowerCase().includes(q)
      if (inText || inNote) out.push({ key: k, inNote: !inText })
    })
    return out
  }, [find?.q, find?.notes, roots, focusKey])
  /** 为了给你看找到的，临时展开的那几枝 */
  const tmpOpen = useMemo(() => {
    const out = new Set<string>()
    for (const h of hits) {
      const path = keyPath(h.key)
      for (let i = 1; i < path.length; i++) {
        const up = path.slice(0, i)
        if (nodeAt(roots, up)?.fold) out.add(pathKey(up))
      }
    }
    return out
  }, [hits, roots])
  const cur = find && hits.length ? hits[Math.min(Math.max(find.cur, 1), hits.length) - 1]! : null

  // ---------- 排版 ----------
  /** 拖着改图的宽、拖着改联系线的弯度：松手前只画，不写文件 */
  const [imgDrag, setImgDrag] = useState<{ key: string; w: number } | null>(null)
  const [bendDrag, setBendDrag] = useState<{ i: number; bend: number } | null>(null)
  const viewRoots = useMemo(() => (imgDrag ? setAttrs(roots, keyPath(imgDrag.key), { imgW: imgDrag.w }) : roots), [roots, imgDrag])
  const folded = useMemo(() => foldedKeys(roots, focusKey, tmpOpen), [roots, focusKey, tmpOpen])
  const relKeys = useMemo(
    () =>
      rels.map((r, i) => {
        const a = pathOfId(roots, r.a)
        const b = pathOfId(roots, r.b)
        return { a: a ? pathKey(a) : '', b: b ? pathKey(b) : '', bend: bendDrag?.i === i ? bendDrag.bend : (r.bend ?? 0) }
      }),
    [rels, roots, bendDrag],
  )
  // ---------- 费曼：空框、第一层的进度小点（讲过没有、过没过），中心下面「费曼 讲过 n/m」 ----------
  const blankText = t('自己补一句')
  const ghosted = useMemo(() => withGhosts(viewRoots, blankText), [viewRoots, blankText])
  const progress = useMemo(() => mapProgress(p.text, p.notePath), [p.text, p.notePath])
  /** 这张图上讲过费曼才画小点：第一层每个点的框多留一个小点的宽 */
  const dotted = Object.values(progress.dots).some((d) => d.state !== 'none')
  // 正确说法（带框）、空框比普通第二层多左右内边距（mindmap.css .fixn / .mm-blank 同一组数）
  const fixTexts = useMemo(() => {
    const s = new Set<string>()
    eachNode(roots, (n) => n.fix && s.add(n.text))
    return s
  }, [roots])
  const measureMap = useMemo(
    () => (txt: string, level: Level, maxW: number) => {
      const extra = level === 'l1' && dotted ? DOT_W : level === 'l2' && txt === blankText ? BLANK_PAD : level === 'l2' && fixTexts.has(txt) ? FIX_PAD : 0
      if (!extra) return measure(txt, level, maxW)
      const m = measure(txt, level, maxW - extra)
      return { ...m, w: m.w + extra }
    },
    [dotted, blankText, fixTexts],
  )
  const layoutFor = (focusOn: MapPath | null) =>
    layoutMindmap(ghosted.roots, measureMap, photo ? (aspect ?? 0.69) : null, folded, { kind, focus: focusOn, skeleton, imgAspect: (src) => aspects[src], rels: relKeys })
  const natural = useMemo(() => layoutFor(focusPath), [ghosted, measureMap, photo, aspect, folded, kind, focusPath, skeleton, aspects, relKeys])

  // 换布局（含撤回）、进出只看这一枝、加了挪了浮动主题：中心主题在屏幕上不动（缩放不动；designer 复审提的）。
  // 中心要往右下挪的：白板跟着往右下滚；要往左上挪的（滚不到负的）：整张图往右下让出这么多
  const floatSig = useMemo(() => JSON.stringify(roots.map((r, i) => (isFloating(roots, [i]) ? r.at : null))), [roots])
  const sig = `${kind}|${focusKey ?? ''}|${floatSig}`
  const [shift, setShift] = useState({ sig, x: 0, y: 0 })
  const Lfull = useMemo(() => (shift.sig === sig && (shift.x || shift.y) ? moveLayout(natural, shift.x, shift.y) : natural), [natural, shift, sig])
  const L = useMemo(() => stripGhosts(Lfull, ghosted.ghosts), [Lfull, ghosted])
  const ghostBoxes = useMemo(() => Lfull.nodes.filter((n) => ghosted.ghosts.has(n.key)), [Lfull, ghosted])
  const Lref = useRef(L)
  Lref.current = L
  useEffect(() => p.onSize(L.w, L.h), [L.w, L.h])
  /** 上一次画出来时中心主题（的中点）在画布上的哪儿 */
  const centerAt = useRef<{ sig: string; x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const c = natural.nodes.find((n) => n.depth === 0)
    if (!c) return
    const nat = { x: c.x + c.w / 2, y: c.y + c.h / 2 }
    const prev = centerAt.current
    const wrap = layer.current?.closest<HTMLElement>('.board-wrap')
    if (!prev || prev.sig === sig || !wrap) {
      const s = shift.sig === sig ? shift : { x: 0, y: 0 }
      centerAt.current = { sig, x: nat.x + s.x, y: nat.y + s.y }
      return
    }
    const sx = Math.max(0, prev.x - nat.x)
    const sy = Math.max(0, prev.y - nat.y)
    setShift({ sig, x: sx, y: sy })
    centerAt.current = { sig, x: nat.x + sx, y: nat.y + sy }
    const want = { left: wrap.scrollLeft + Math.max(0, nat.x - prev.x) * p.scale, top: wrap.scrollTop + Math.max(0, nat.y - prev.y) * p.scale }
    wrap.scrollLeft = want.left
    wrap.scrollTop = want.top
    // 画布要等 BoardView 照导图的新大小撑开（下一帧）：这一下够不着的再滚一次
    requestAnimationFrame(() => {
      if (Math.abs(wrap.scrollLeft - want.left) > 1) wrap.scrollLeft = want.left
      if (Math.abs(wrap.scrollTop - want.top) > 1) wrap.scrollTop = want.top
      // 换了布局（不是进出只看这一枝、挪浮动主题）：中心不动时有一块在屏幕外，整张放得下就平移到整张看得见，放不下就缩到放得下（designer 复审提的）
      if (prev.sig.split('|')[0] === sig.split('|')[0]) return
      const lay = layer.current?.getBoundingClientRect()
      const view = wrap.getBoundingClientRect()
      if (!lay) return
      const left = view.left + 80
      const m = 24
      const box = { l: lay.left + 60 * p.scale, t: lay.top + 40 * p.scale, r: lay.right - 40 * p.scale, b: lay.bottom - 20 * p.scale }
      if (box.r - box.l > view.right - left - 2 * m || box.b - box.t > view.bottom - view.top - 2 * m) return p.onFit?.()
      if (box.l < left + m) wrap.scrollLeft -= left + m - box.l
      else if (box.r > view.right - m) wrap.scrollLeft += box.r - (view.right - m)
      if (box.t < view.top + m) wrap.scrollTop -= view.top + m - box.t
      else if (box.b > view.bottom - m) wrap.scrollTop += box.b - (view.bottom - m)
    })
  }, [natural, sig])

  // ---------- 长出来 ----------
  const order = useMemo(() => breadthFirst(roots).map(pathKey), [roots])
  const [shown, setShown] = useState(() => (takeGrow(p.notePath) ? 0 : Infinity))
  const growing = shown !== Infinity && shown < order.length
  const [pill, setPill] = useState<'growing' | 'done' | null>(() => (shown === 0 ? 'growing' : null))
  useEffect(() => {
    if (!growing) return
    // 一个 0.23 秒；节点多时整张最多 6 秒
    const tm = setTimeout(() => setShown((s) => s + 1), Math.min(230, 6000 / Math.max(1, order.length)))
    return () => clearTimeout(tm)
  }, [growing, shown, order.length])
  // 最后一个长完以后就当普通导图画（再改节点时不重放动画）
  useEffect(() => {
    if (shown === Infinity || shown < order.length) return
    const tm = setTimeout(() => setShown(Infinity), 300)
    return () => clearTimeout(tm)
  }, [shown, order.length])
  useEffect(() => {
    if (pill === 'growing' && !growing) setPill('done')
    if (pill !== 'done') return
    const tm = setTimeout(() => setPill(null), 6000)
    return () => clearTimeout(tm)
  }, [pill, growing])
  // 「补进导图」放进去的几处：照放的先后一个个长出来（新节点、标红的、空框）
  const growReq = useMapGrow(p.notePath)
  const [late, setLate] = useState<{ seq: number; keys: string[]; shown: number } | null>(null)
  useEffect(() => {
    if (growReq) setLate({ seq: growReq.seq, keys: growReq.keys, shown: 0 })
  }, [growReq?.seq])
  useEffect(() => {
    if (!late) return
    // 一处 0.35 秒；全露出来以后再等一下动画放完，回到普通画法
    const tm = setTimeout(() => setLate((x) => (x && x.seq === late.seq ? (x.shown >= x.keys.length ? null : { ...x, shown: x.shown + 1 }) : x)), late.shown >= late.keys.length ? 500 : 350)
    return () => clearTimeout(tm)
  }, [late])
  /** 还没轮到长出来的（hid）、正在长的（grow）：长出来以前，节点在、但看不见 */
  const lateState = (key: string): 'hid' | 'grow' | null => {
    if (!late) return null
    const i = late.keys.indexOf(key)
    if (i === -1) return null
    return i >= late.shown ? 'hid' : 'grow'
  }
  const visible = (key: string) => (shown === Infinity || order.indexOf(key) < shown) && lateState(key) !== 'hid'

  // ---------- 选中、改 ----------
  const [sel, setSel] = useState<string | null>(null)
  /** 选了好几个（两个起）：⌘ 点加减、⇧ 点连选同一级、空白处拖框 */
  const [msel, setMsel] = useState<string[]>([])
  const [selRel, setSelRel] = useState<number | null>(null)
  /** 选一个按 ⇧⌘R：等点另一个主题连过去 */
  const [relFrom, setRelFrom] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [fix, setFix] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [noteOf, setNoteOf] = useState<{ key: string; focus: boolean } | null>(null)
  const [inline, setInline] = useState<Inline | null>(null)
  /** 点开了哪个虚线空框在填（空框的 key） */
  const [blankEdit, setBlankEdit] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [exporting, setExporting] = useState<{ fmt?: 'png' | 'svg' | 'pdf' | 'opml' } | null>(null)
  const [dropImg, setDropImg] = useState<string | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  /** 刚拖过（松手后接着来的 click 不当点链接） */
  const dragged = useRef(false)
  useEffect(() => {
    if (!flash) return
    const tm = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(tm)
  }, [flash])
  // 文件被别处改了，选中的节点没了（或者收起来、出了只看的那一枝）就不选
  useEffect(() => {
    if (sel && !L.byKey[sel]) setSel(null)
    if (msel.some((k) => !L.byKey[k])) setMsel((m) => m.filter((k) => L.byKey[k]))
    if (selRel !== null && !L.rels[selRel]) setSelRel(null)
    if (noteOf && !L.byKey[noteOf.key]) setNoteOf(null)
  }, [L])
  const multi = msel.length >= 2
  const selected = multi ? msel : sel ? [sel] : []
  const selKey = selected.join('\n')
  useEffect(() => p.onSelect?.(selKey ? selKey.split('\n') : []), [selKey])
  /** 费曼学习盖住的：这几支和下面全部 */
  const coverKeys = p.cover?.keys ?? []
  const under = (k: string) => coverKeys.some((c) => k === c || k.startsWith(c + '.'))
  const hide = (k: string) => !p.cover?.peeking && under(k)

  const commit = (next: MapNode[]) => {
    if (p.readOnly) return
    const out = withMindmap(p.text, next)
    if (out !== p.text) p.onChange(out)
  }
  const commitText = (out: string) => {
    if (!p.readOnly && out !== p.text) p.onChange(out)
  }
  const focusLayer = () => layer.current?.focus({ preventScroll: true })
  const selectOnly = (k: string | null) => {
    setSel(k)
    setMsel([])
    setSelRel(null)
  }
  /** 画出来的中心（一棵树的根，或者只看的那一枝） */
  const isCenter = (key: string) => L.byKey[key]?.depth === 0
  const newTopic = () => newNode(tv('新主题'))
  const textOf = (k: string) => mapShown(nodeAt(roots, keyPath(k))?.text ?? '')

  // ---------- 找的条 ----------
  useFindTarget(
    p.overlay
      ? {
          el: () => p.overlay,
          owner: p.notePath,
          open: () => setFind((f) => (f ? { ...f, seq: f.seq + 1 } : { q: '', cur: 1, notes: true, seq: 1 })),
        }
      : null,
  )
  // 跳到当前那一处：选中它、滚到看得见
  useEffect(() => {
    if (!cur) return
    selectOnly(cur.key)
  }, [cur?.key, find?.seq])
  useLayoutEffect(() => {
    if (!cur) return
    const el = layer.current?.querySelector<HTMLElement>(`[data-key="${cur.key}"]`)
    const wrap = layer.current?.closest<HTMLElement>('.board-wrap')
    if (!el || !wrap) return
    const r = el.getBoundingClientRect()
    const w = wrap.getBoundingClientRect()
    const m = 60
    if (r.left < w.left + m || r.right > w.right - m) wrap.scrollLeft += r.left + r.width / 2 - (w.left + w.width / 2)
    if (r.top < w.top + m + 60 || r.bottom > w.bottom - m) wrap.scrollTop += r.top + r.height / 2 - (w.top + w.height / 2)
  }, [cur?.key, L])
  const closeFind = () => {
    setFind(null)
    focusLayer()
  }

  // ---------- 导出（⌘K「导出导图…」、标签条「⋯」） ----------
  const want = useExportRequest(p.notePath)
  useEffect(() => {
    if (!want) return
    takeExport(want.seq)
    setExporting({ fmt: want.fmt })
  }, [want?.seq])

  // ---------- 链接卡 ----------
  const linkKey = useRef<string | null>(null)
  const linkCard = useMapLinkCard(
    p.notePath,
    p.readOnly,
    (seg, to) => {
      const k = linkKey.current
      const n = k ? nodeAt(roots, keyPath(k)) : undefined
      if (k && n) commit(setText(roots, keyPath(k), relinkText(n.text, seg, to)))
    },
    (seg) => {
      const k = linkKey.current
      const n = k ? nodeAt(roots, keyPath(k)) : undefined
      if (k && n) commit(setText(roots, keyPath(k), unlinkText(n.text, seg)))
    },
  )

  // ---------- 外框、概要、联系线、浮动主题、图 ----------
  function addSpanOf(keys: string[], kindOf: 'frame' | 'sum') {
    const paths = keys.map(keyPath).filter((x) => x.length >= 2 && !isCenter(pathKey(x)))
    if (!paths.length) return
    commit(addSpan(roots, paths, kindOf))
    const first = [...paths].sort((a, b) => a[a.length - 1]! - b[b.length - 1]!)[0]!
    const k = pathKey(first)
    selectOnly(k)
    setInline({ kind: kindOf, key: k })
  }
  function addRel(a: string, b: string) {
    if (a === b) return
    const w = withIds(roots, [keyPath(a), keyPath(b)])
    const text1 = withMindmap(p.text, w.roots)
    const next = [...mapRelsOf(text1), { a: w.ids[0]!, b: w.ids[1]! }]
    commitText(withMapRels(text1, next))
    setSel(null)
    setMsel([])
    setSelRel(next.length - 1)
    setInline({ kind: 'rel', i: next.length - 1 })
  }
  function removeRel(i: number) {
    commitText(withMapRels(p.text, rels.filter((_, j) => j !== i)))
    setSelRel(null)
  }
  function deleteKeys(keys: string[]) {
    const del = outermost(keys).filter((k) => !isCenter(k) && k !== focusKey)
    if (!del.length) return
    // 从后往前删，前面的路径不变
    const sorted = del.map(keyPath).sort((a, b) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i]! - a[i]!
      return b.length - a.length
    })
    let next = roots
    for (const path of sorted) next = removeAt(next, path)
    commit(next)
    selectOnly(null)
  }
  async function attachImage(key: string, get: () => Promise<{ alt: string; src: string } | null>) {
    const img = await get()
    if (!img) return
    const n = nodeAt(roots, keyPath(key))
    if (!n) return
    commit(setAttrs(roots, keyPath(key), { img, imgW: n.imgW ?? IMG_W }))
    // 第一次挂上图：底栏说一句怎么改（同原型的提示）
    if (!n.img) p.onNotice(t('挂上了图：拖右下角改大小 · 右键「换一张图…」「去掉图片」 · 也能把图拖到主题上、或者 {key} 贴', { key: K('paste') ?? '' }))
  }
  /** 从 ![说明](路径) 里拿出图 */
  const imgOfMd = (md: string) => {
    const m = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(md)
    return m ? { alt: m[1]!, src: m[2]! } : null
  }
  const pickImage = (key: string) =>
    void attachImage(key, async () => {
      const saved = await window.cn.pickImage(p.notePath)
      return saved ? { alt: saved.split('/').pop()!.replace(/\.[a-z0-9]+$/i, ''), src: relativeLink(p.notePath, saved) } : null
    })
  const dropImageOn = (key: string, dt: DataTransfer, paste = false) =>
    void attachImage(key, async () => {
      const found = await imagesFrom(dt)
      if (!found.length) return null
      const { md, errors } = await saveImages(p.notePath, paste ? found.map((c) => ({ ...c, alt: '', shot: true })) : found.slice(0, 1))
      if (errors.length) p.onNotice(t('图没存成：{why}', { why: errors[0]! }))
      return md[0] ? imgOfMd(md[0]) : null
    })

  /** 跑一条导图里的命令（键、右键菜单、加号、⌘K 都走这里）；这会儿不归它返回 false */
  function run(cmd: MapCmd, key: string | null = sel): boolean {
    if (cmd === 'mm-fold-all' || cmd === 'mm-unfold-all') {
      commit(cmd === 'mm-fold-all' && anyUnfolded(roots) ? foldAll(roots) : unfoldAll(roots))
      return true
    }
    // 选了好几个：外框、联系线、收起、删除对这几个做
    if (multi && (cmd === 'mm-frame' || cmd === 'mm-rel' || cmd === 'mm-fold' || cmd === 'mm-del')) {
      if (p.readOnly) return true
      if (cmd === 'mm-frame') addSpanOf(msel, 'frame')
      else if (cmd === 'mm-rel') {
        if (msel.length === 2) addRel(msel[0]!, msel[1]!)
        else p.onNotice(t('选两个主题才能连线'))
      } else if (cmd === 'mm-del') deleteKeys(msel)
      else {
        const list = msel.filter((k) => !isCenter(k) && nodeAt(roots, keyPath(k))?.children.length)
        const fold = list.some((k) => !folded.has(k))
        commit(list.reduce((r, k) => setFold(r, keyPath(k), fold), roots))
      }
      return true
    }
    if (!key) return false
    const path = keyPath(key)
    const node = nodeAt(roots, path)
    if (!node) return false
    if (cmd === 'mm-focus') {
      if (focusKey === key) setFocus(null)
      else {
        setFocus({ path, text: node.text })
        selectOnly(key)
      }
      return true
    }
    if (cmd === 'mm-note') {
      setNoteOf({ key, focus: true })
      return true
    }
    if (p.readOnly) return true
    const center = isCenter(key)
    const float = isFloating(roots, path)
    const parent = path.slice(0, -1)
    const at = path[path.length - 1]!
    const edit = (k: string) => {
      selectOnly(k)
      setEditing(k)
    }
    switch (cmd) {
      case 'mm-child': {
        // 收着的先展开，新加的看得见
        const base = node.fold ? setFold(roots, path, false) : roots
        commit(insertAt(base, path, node.children.length, newTopic()))
        edit(pathKey([...path, node.children.length]))
        return true
      }
      case 'mm-after':
        if (center || float) return run('mm-child', key)
        commit(insertAt(roots, parent, at + 1, newTopic()))
        edit(pathKey([...parent, at + 1]))
        return true
      case 'mm-before':
        if (center || float) return true
        commit(insertAt(roots, parent, at, newTopic()))
        edit(key)
        return true
      case 'mm-parent': {
        const r = center || float ? null : addParent(roots, path, tv('新主题'))
        if (r) {
          commit(r.roots)
          edit(pathKey(r.path))
        }
        return true
      }
      case 'mm-up':
      case 'mm-down': {
        const r = center || float ? null : moveAmong(roots, path, cmd === 'mm-up' ? -1 : 1)
        if (r) {
          commit(r.roots)
          selectOnly(pathKey(r.path))
        }
        return true
      }
      case 'mm-fold':
        if (!center && node.children.length) commit(setFold(roots, path, !folded.has(key)))
        return true
      case 'mm-edit':
        setEditing(key)
        return true
      case 'mm-frame':
        if (!center && !float) addSpanOf([key], 'frame')
        return true
      case 'mm-rel':
        setRelFrom(key)
        p.onNotice(t('点另一个主题，连一条线过去 · esc 不连了'))
        return true
      case 'mm-del':
        if (key === focusKey) return true
        if (path.length === 1 && !float && roots.filter((_, i) => !isFloating(roots, [i])).length === 1) {
          p.onNotice('中心不能删；整张不要了，把这块白板移到废纸篓')
          return true
        }
        commit(removeAt(roots, path))
        selectOnly(path.length > 1 ? pathKey(parent) : null)
        return true
      case 'mm-del-one':
        if (center || float) return true
        commit(removeOne(roots, path))
        selectOnly(node.children.length ? key : pathKey(parent))
        return true
    }
    return false
  }

  /** 方向键：照布局在主题之间走（向右、左右：往外是孩子、往里是上级，上下是同一边的兄弟；向下：第一层左右是兄弟、往下是孩子；鱼骨、时间线、浮动主题：往那个方向最近的） */
  function walk(k: string) {
    const b = sel ? L.byKey[sel] : undefined
    if (!sel || !b) return
    const go = (key: string | undefined) => key && L.byKey[key] && selectOnly(key)
    if (kind === 'fish' || kind === 'time' || b.float) return void go(nearestIn(L, b, k as 'ArrowUp')?.key)
    const path = keyPath(sel)
    const parentKey = pathKey(path.slice(0, -1))
    const kids = L.nodes.filter((n) => n.key.startsWith(sel + '.') && keyPath(n.key).length === path.length + 1)
    // 同一个上级下面画出来的（中心们是几棵树的根）
    const sibs = L.nodes.filter((n) => !n.float && (b.depth === 0 ? n.depth === 0 : n.depth === b.depth && keyPath(n.key).slice(0, -1).join('.') === parentKey && n.side === b.side))
    const up = b.depth > 0 ? parentKey : undefined
    const byY = (list: NodeBox[]) => [...list].sort((a, c) => a.y - c.y)
    const byX = (list: NodeBox[]) => [...list].sort((a, c) => a.x - c.x)
    const step = (list: NodeBox[], d: -1 | 1) => list[list.findIndex((n) => n.key === sel) + d]?.key
    const first = byY(kids)[0]?.key
    if (kind === 'down') {
      if (b.depth === 0) return void (k === 'ArrowDown' ? go(first) : k === 'ArrowUp' && go(step(byY(sibs), -1)))
      if (b.depth === 1) return void (k === 'ArrowUp' ? go(up) : k === 'ArrowDown' ? go(first) : go(step(byX(sibs), k === 'ArrowLeft' ? -1 : 1)))
      return void (k === 'ArrowLeft' ? go(up) : k === 'ArrowRight' ? go(first) : go(step(byY(sibs), k === 'ArrowUp' ? -1 : 1)))
    }
    if (b.depth === 0) {
      if (k === 'ArrowRight' || k === 'ArrowLeft') go(byY(kids.filter((n) => n.side === (k === 'ArrowRight' ? 'r' : 'l')))[0]?.key)
      else go(step(byY(sibs), k === 'ArrowUp' ? -1 : 1))
      return
    }
    // 往外（右边的往右、左边的往左）是孩子，往里是上级
    const outward = b.side === 'l' ? 'ArrowLeft' : 'ArrowRight'
    if (k === outward) go(first)
    else if (k === 'ArrowLeft' || k === 'ArrowRight') go(up)
    else go(step(byY(sibs), k === 'ArrowUp' ? -1 : 1))
  }

  function onKey(e: React.KeyboardEvent) {
    // 改主题的字、改拿不准的主题：⌫、回车、方向键都是改字（第 8 轮：输入框里的键不当导图的快捷键）
    if (editing || typingIn(e.target)) return
    const stop = () => (e.preventDefault(), e.stopPropagation())
    if (e.metaKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'z') {
      stop()
      return e.shiftKey ? p.onRedo() : p.onUndo()
    }
    // ⌘C：选中的几个（连同下面的）拷成一段缩进列表
    if (isKey(e.nativeEvent, 'copy') && selected.length) {
      stop()
      const list = outermost(selected).map((k) => nodeAt(roots, keyPath(k))!)
      void copy(plainList(list)).then(() => p.onNotice(t('拷好了{n}个主题：贴进文档是一段缩进列表', { n: list.length })))
      return
    }
    if (e.key === 'Escape') {
      if (drag) return void (stop(), setDrag(null))
      if (relFrom) return void (stop(), setRelFrom(null))
      if (selRel !== null) return void (stop(), setSelRel(null))
      if (multi) return void (stop(), setMsel([]))
      if (focusKey) return void (stop(), setFocus(null))
      if (!sel && !fix) return
      stop()
      setSel(null)
      setFix(null)
      ;(p.overlay as HTMLElement | null)?.focus({ preventScroll: true })
      return
    }
    const cmd = MAP_CMDS.find((id) => isKey(e.nativeEvent, id))
    if (selRel !== null && cmd === 'mm-del') {
      stop()
      if (!p.readOnly) removeRel(selRel)
      return
    }
    const arrow = e.key.startsWith('Arrow') && !e.metaKey && !e.altKey && !e.ctrlKey
    if (cmd === 'mm-fold-all' || (cmd && (sel || multi))) {
      stop()
      run(cmd!)
    } else if (!sel && (arrow || cmd === 'mm-child' || cmd === 'mm-after')) {
      // 什么都没选：方向键、Tab、↵ 先选中中心（同原型）
      stop()
      selectOnly(focusKey ?? pathKey([0]))
    } else if (arrow) {
      stop()
      walk(e.key)
    }
  }

  // 只看这一枝时 esc 回到整张：焦点在白板别处（点过空白处）也认
  useEffect(() => {
    const o = p.overlay
    if (!focusKey || !o) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || typingIn(e.target)) return
      e.preventDefault()
      setFocus(null)
    }
    o.addEventListener('keydown', h)
    return () => o.removeEventListener('keydown', h)
  }, [focusKey, p.overlay])

  // ⌘K、标签条「布局 ▾」里的收起到第一层、全部展开（NoteTab 登记，焦点不在导图上时也能用）走文件，不经这里

  // ---------- 拖：两个同级中间换位置，正中间放进去；浮动主题拖到别处是挪位置 ----------
  const toPlane = (cx: number, cy: number) => {
    const r = layer.current!.getBoundingClientRect()
    return { x: (cx - r.left) / p.scale, y: (cy - r.top) / p.scale }
  }
  const inDrag = (key: string) => !!drag?.moved && drag.keys.some((k) => key === k || key.startsWith(k + '.'))

  /** 拖着主题时每一下挪、松手调的是最新画出来的那一版（拖的那一下以后 drag、roots 都会变） */
  const nodeDrag = useRef({ move: (_e: PointerEvent) => {}, up: (_e: PointerEvent) => {} })
  nodeDrag.current = { move: (ev) => onNodeMove(ev), up: (ev) => onNodeUp(ev) }
  function onNodeDown(e: React.PointerEvent, key: string) {
    if (e.button !== 0 || editing === key) return
    e.stopPropagation()
    focusLayer()
    dragged.current = false
    if (relFrom) {
      if (relFrom !== key && !p.readOnly) addRel(relFrom, key)
      setRelFrom(null)
      return
    }
    // 按在链接的字上：不拖、不抓住指针（不然 click 落不到链接上）；⌘ 点链接是右栏打开，不是加选
    if ((e.target as Element).closest('.lk')) {
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) selectOnly(key)
      return
    }
    if (e.metaKey || e.ctrlKey) {
      // ⌘ 点：加一个、再点去掉
      const base = multi ? msel : sel ? [sel] : []
      const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key]
      setSelRel(null)
      if (next.length >= 2) {
        setMsel(next)
        setSel(key)
      } else selectOnly(next[0] ?? null)
      return
    }
    if (e.shiftKey && sel && sel !== key) {
      // ⇧ 点：同一级里从上回点的到这个之间的都选上
      const a = keyPath(sel)
      const b = keyPath(key)
      const same = a.length === b.length && a.slice(0, -1).join('.') === b.slice(0, -1).join('.')
      const keys = same
        ? Array.from({ length: Math.abs(a[a.length - 1]! - b[b.length - 1]!) + 1 }, (_, i) => pathKey([...b.slice(0, -1), Math.min(a[a.length - 1]!, b[b.length - 1]!) + i])).filter((k) => L.byKey[k])
        : [...new Set([...(multi ? msel : [sel]), key])]
      setSelRel(null)
      if (keys.length >= 2) setMsel(keys)
      else setMsel([])
      setSel(key)
      return
    }
    const keepMulti = multi && msel.includes(key)
    if (!keepMulti) selectOnly(key)
    else setSel(key)
    if (fix && fix !== key) setFix(null)
    if (p.readOnly || isCenter(key)) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const keys = keepMulti ? outermost(msel).filter((k) => !isCenter(k)) : [key]
    setDrag({ key, keys, start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, moved: false, drop: null })
    // 松手没送到页面（窗口外松手、失焦）：当没拖过，主题不挪（trackDrag，task-0nz63）。挪、松手照这一刻画出来的那一版算
    trackDrag<PointerEvent>(e, { move: (ev) => nodeDrag.current.move(ev), end: (how, ev) => (how === 'up' ? nodeDrag.current.up(ev!) : setDrag(null)) })
  }
  function onNodeMove(e: PointerEvent) {
    if (!drag) return
    const at = { x: e.clientX, y: e.clientY }
    const moved = drag.moved || Math.hypot(at.x - drag.start.x, at.y - drag.start.y) >= 5
    if (!moved) return
    let drop = dropAt(L, drag.key, toPlane(at.x, at.y))
    // 选中的几个一起拖：拖到它们自己里面不算
    const target = drop && ('into' in drop ? drop.into : drop.beside)
    if (target && drag.keys.some((k) => target === k || target.startsWith(k + '.'))) drop = null
    // 浮动主题只能放进一个主题（挂回树上）；别的都是挪位置
    if (drop && 'beside' in drop && isFloating(roots, keyPath(drag.key))) drop = null
    setDrag({ ...drag, at, moved, drop })
  }
  function onNodeUp(e: PointerEvent) {
    if (!drag) return
    setDrag(null)
    dragged.current = drag.moved
    // 在选中的几个里点一下（没拖）：只留这一个
    if (!drag.moved) {
      if (multi && msel.includes(drag.key)) selectOnly(drag.key)
      return
    }
    const d = drag.drop
    const from = keyPath(drag.key)
    if (!d && isFloating(roots, from) && drag.keys.length === 1) {
      // 浮动主题：挪到松手的地方
      const node = nodeAt(roots, from)!
      const dx = (e.clientX - drag.start.x) / p.scale
      const dy = (e.clientY - drag.start.y) / p.scale
      commit(setAttrs(roots, from, { at: [Math.round(node.at![0] + dx), Math.round(node.at![1] + dy)] }))
      return
    }
    if (!d || (drag.keys.length === 1 && stays(drag.key, d))) return
    if (drag.keys.length > 1) {
      const r = moveMany(roots, drag.keys.map(keyPath), keyPath('into' in d ? d.into : d.beside), 'into' in d ? 'into' : d.after ? 'after' : 'before')
      if (!r) return
      commit(r.roots)
      setMsel(r.paths.map(pathKey))
      setSel(pathKey(r.paths[r.paths.length - 1]!))
      return
    }
    let m: { roots: MapNode[]; path: MapPath } | null
    if ('into' in d) {
      const into = keyPath(d.into)
      // 放进收着的主题：先展开，放进去的看得见
      m = moveTo(nodeAt(roots, into)?.fold ? setFold(roots, into, false) : roots, from, into)
    } else m = moveBeside(roots, from, keyPath(d.beside), d.after)
    m = settle(m)
    if (!m) return
    commit(m.roots)
    selectOnly(pathKey(m.path))
  }

  /** 松手后还在原来的位置（拖到自己前后） */
  function stays(key: string, d: Drop): boolean {
    if (!d || 'into' in d) return false
    const from = keyPath(key)
    const to = keyPath(d.beside)
    if (from.length !== to.length || from.slice(0, -1).join('.') !== to.slice(0, -1).join('.')) return false
    const at = to[to.length - 1]! + (d.after ? 1 : 0)
    const fi = from[from.length - 1]!
    return at === fi || at === fi + 1
  }

  /** 跟着手的小牌：松手后去哪 */
  function dragHint(d: Drag): string {
    const drop = d.drop
    if (!drop && isFloating(roots, keyPath(d.key))) return t('松手放在这里')
    if (!drop || (d.keys.length === 1 && stays(d.key, drop))) return t('松手放回原处')
    if ('into' in drop) return t('放进「{name}」，排在最后', { name: textOf(drop.into) })
    const to = keyPath(drop.beside)
    const parent = to.slice(0, -1)
    const from = keyPath(d.key)
    const moved = from.slice(0, -1).join('.') !== parent.join('.') && parent.length > 0
    const sibs = parent.length ? (nodeAt(roots, parent)?.children ?? []) : roots
    const i = to[to.length - 1]!
    const other = sibs[drop.after ? i + 1 : i - 1]
    const name = textOf(drop.beside)
    const up = moved ? textOf(pathKey(parent)) : ''
    if (other && other !== nodeAt(roots, from)) {
      const [a, b] = drop.after ? [name, mapShown(other.text)] : [mapShown(other.text), name]
      return moved ? t('排到「{a}」和「{b}」中间（换到「{up}」下面）', { a, b, up }) : t('排到「{a}」和「{b}」中间', { a, b })
    }
    if (drop.after) return moved ? t('排到「{name}」后面（换到「{up}」下面）', { name, up }) : t('排到「{name}」后面', { name })
    return moved ? t('排到「{name}」前面（换到「{up}」下面）', { name, up }) : t('排到「{name}」前面', { name })
  }

  // ---------- 空白处：拖框选几个、双击加一个浮动主题（白板自己的双击加卡片在导图上让给这里） ----------
  const live = useRef({ roots, focusKey, readOnly: p.readOnly, scale: p.scale })
  live.current = { roots, focusKey, readOnly: p.readOnly, scale: p.scale }
  useEffect(() => {
    const wrap = layer.current?.closest<HTMLElement>('.board-wrap')
    if (!wrap) return
    const toPlane = (cx: number, cy: number) => {
      const r = layer.current!.getBoundingClientRect()
      return { x: (cx - r.left) / live.current.scale, y: (cy - r.top) / live.current.scale }
    }
    const blank = (tgt: Element | null) =>
      !!tgt &&
      !tgt.closest('.mm-node, .mm-photocard, button, input, textarea, .mm-frt, .mm-rlab, .mm-rels .rh, .mm-rhd, .mm-imgh, [data-block], .card, .col') &&
      (tgt === wrap || tgt.classList.contains('plane') || !!layer.current?.contains(tgt))
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !blank(e.target as Element)) return
      const start = toPlane(e.clientX, e.clientY)
      let moved = false
      let last = { x: e.clientX, y: e.clientY }
      const move = (ev: PointerEvent) => {
        const pt = toPlane(ev.clientX, ev.clientY)
        if (!moved && Math.hypot(pt.x - start.x, pt.y - start.y) * live.current.scale < 5) return
        moved = true
        last = { x: ev.clientX, y: ev.clientY }
        setMarquee({ x0: start.x, y0: start.y, x1: pt.x, y1: pt.y })
      }
      // 松手没送到页面（窗口外松手、失焦）：照最后按着时的框选上（trackDrag，task-0nz63）
      const up = () => {
        if (!moved) return
        setMarquee(null)
        const pt = toPlane(last.x, last.y)
        const x1 = Math.min(start.x, pt.x)
        const x2 = Math.max(start.x, pt.x)
        const y1 = Math.min(start.y, pt.y)
        const y2 = Math.max(start.y, pt.y)
        const keys = Lref.current.nodes.filter((n) => n.x < x2 && n.x + n.w > x1 && n.y < y2 && n.y + n.h > y1).map((n) => n.key)
        setSelRel(null)
        if (keys.length >= 2) {
          setMsel(keys)
          setSel(keys[keys.length - 1]!)
        } else selectOnly(keys[0] ?? null)
        layer.current?.focus({ preventScroll: true })
      }
      trackDrag<PointerEvent>(e, {
        move,
        end: (_how, ev) => {
          if (ev && ev.type === 'pointerup') last = { x: ev.clientX, y: ev.clientY }
          up()
        },
      })
    }
    const dbl = (e: MouseEvent) => {
      if (!blank(e.target as Element)) return
      // 白板的双击加卡片不要了：导图上双击空白处是加浮动主题
      e.stopPropagation()
      e.preventDefault()
      const { roots: rs, focusKey: fk, readOnly } = live.current
      if (readOnly || fk) return
      const c = Lref.current.nodes.find((n) => n.depth === 0 && !n.float)
      if (!c) return
      const pt = toPlane(e.clientX, e.clientY)
      const r = addFloating(rs, tv('新主题'), [pt.x - (c.x + c.w / 2) - 20, pt.y - (c.y + c.h / 2) - 16])
      const out = withMindmap(p.text, r.roots)
      if (out !== p.text) p.onChange(out)
      const k = pathKey(r.path)
      setSel(k)
      setMsel([])
      setEditing(k)
    }
    wrap.addEventListener('pointerdown', down)
    wrap.addEventListener('dblclick', dbl, true)
    return () => {
      wrap.removeEventListener('pointerdown', down)
      wrap.removeEventListener('dblclick', dbl, true)
    }
  }, [p.text])

  // ---------- 拖着改图的宽、联系线的弯度 ----------
  function startImgResize(e: React.PointerEvent, key: string) {
    e.stopPropagation()
    e.preventDefault()
    const n = nodeAt(roots, keyPath(key))
    if (!n?.img || p.readOnly) return
    const w0 = n.imgW ?? IMG_W
    const x0 = e.clientX
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let w = w0
    // 松手没送到页面（窗口外松手、失焦）：宽度回原样、不写文件（trackDrag，task-0nz63）
    trackDrag<PointerEvent>(e, {
      move: (ev) => {
        w = Math.round(Math.max(40, Math.min(NODE_MAX_W - 16, w0 + (ev.clientX - x0) / p.scale)))
        setImgDrag({ key, w })
      },
      end: (how) => {
        setImgDrag(null)
        if (how === 'up' && w !== w0) commit(setAttrs(roots, keyPath(key), { imgW: w }))
      },
    })
  }
  function startBend(e: React.PointerEvent, i: number) {
    e.stopPropagation()
    e.preventDefault()
    const g = L.rels[i]
    if (!g || p.readOnly) return
    const b0 = rels[i]!.bend ?? 0
    const s = { x: e.clientX, y: e.clientY }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let bend = b0
    // 松手没送到页面（窗口外松手、失焦）：弯度回原样、不写文件（trackDrag，task-0nz63）
    trackDrag<PointerEvent>(e, {
      move: (ev) => {
        // 小圆点在线上 0.28 处：弯度变 1，它往外挪 3 × 0.28 × 0.72 ≈ 0.6
        bend = Math.round(b0 + (((ev.clientX - s.x) * g.px + (ev.clientY - s.y) * g.py) / p.scale) / 0.6048)
        setBendDrag({ i, bend })
      },
      end: (how) => {
        setBendDrag(null)
        if (how === 'up' && bend !== b0) commitText(withMapRels(p.text, rels.map((r, j) => (j === i ? { ...r, bend } : r))))
      },
    })
  }

  // ---------- 右键：主题能做的都写出来，键照命令表 ----------
  function nodeMenu(key: string): MenuEntry[] {
    const path = keyPath(key)
    const node = nodeAt(roots, path)
    if (!node) return []
    const center = isCenter(key)
    const float = isFloating(roots, path)
    const ro = p.readOnly
    const sibs = path.length > 1 ? (nodeAt(roots, path.slice(0, -1))?.children.length ?? 0) : 0
    const at = path[path.length - 1]!
    const item = (cmd: MapCmd, label: string, enabled = true): MenuEntry => ({ label, accel: accelFor(cmd), enabled: enabled && !ro, run: () => run(cmd, key) })
    const tree = !center && !float
    return [
      item('mm-child', t('加子主题')),
      item('mm-after', t('在后面加同级'), tree),
      item('mm-before', t('在前面加同级'), tree),
      item('mm-parent', t('加父主题'), tree),
      '-',
      item('mm-up', t('往上挪'), tree && at > 0),
      item('mm-down', t('往下挪'), tree && at < sibs - 1),
      item('mm-fold', folded.has(key) ? t('展开') : t('收起这一枝'), !center && node.children.length > 0),
      { label: focusKey === key ? t('回到整张') : t('只看这一枝'), accel: accelFor('mm-focus'), run: () => run('mm-focus', key) },
      '-',
      { label: node.note ? t('改备注') : t('加备注'), accel: accelFor('mm-note'), run: () => run('mm-note', key) },
      node.frame?.n ? { label: t('去掉外框'), enabled: !ro, run: () => commit(setAttrs(roots, path, { frame: undefined })) } : item('mm-frame', t('加外框'), tree),
      node.sum?.n
        ? { label: t('去掉概要'), enabled: !ro, run: () => commit(setAttrs(roots, path, { sum: undefined })) }
        : { label: t('加概要'), enabled: !ro && tree && sumsOf(kind), run: () => addSpanOf([key], 'sum') },
      item('mm-rel', t('连一条联系线…')),
      float
        ? { label: t('挂回树上：拖到一个主题正中间'), enabled: false, run: () => undefined }
        : {
            label: t('拆成浮动主题'),
            enabled: !ro && tree,
            run: () => {
              const b = L.byKey[key]
              const c = L.nodes.find((n) => n.depth === 0 && !n.float)
              if (!b || !c) return
              const r = detachTopic(roots, path, [b.x - (c.x + c.w / 2) + 60, b.y - (c.y + c.h / 2) - 70])
              if (!r) return
              commit(r.roots.map((n, i) => (i === r.path[0] ? { ...n, frame: undefined, sum: undefined } : n)))
              selectOnly(pathKey(r.path))
            },
          },
      '-',
      ...(node.img
        ? [
            { label: t('换一张图…'), enabled: !ro, run: () => pickImage(key) },
            { label: t('去掉图片'), enabled: !ro, run: () => commit(setAttrs(roots, path, { img: undefined, imgW: undefined })) },
          ]
        : [{ label: t('加图片…'), enabled: !ro, run: () => pickImage(key) }]),
      '-',
      item('mm-edit', t('改字')),
      item('mm-del', t('删掉这一枝'), !center),
      item('mm-del-one', t('只删这一个（下面的往上提）'), tree),
    ]
  }

  // ---------- 操作条（选了好几个） ----------
  function onBar(a: BarAct, e: React.MouseEvent) {
    const list = outermost(msel).map((k) => nodeAt(roots, keyPath(k))!)
    switch (a) {
      case 'frame':
        return addSpanOf(msel, 'frame')
      case 'sum':
        return addSpanOf(msel, 'sum')
      case 'rel':
        return addRel(msel[0]!, msel[1]!)
      case 'ai':
        return app().askAi(plainList(list), t('《{name}》里选中的{n}个主题', { name: p.notePath.split('/').pop()!.replace(/\.md$/i, ''), n: list.length }))
      case 'copy':
        return void copy(plainList(list)).then(() => p.onNotice(t('拷好了{n}个主题：贴进文档是一段缩进列表', { n: list.length })))
      case 'del':
        return deleteKeys(msel)
      case 'more': {
        e.stopPropagation()
        const can = msel.filter((k) => !isCenter(k) && nodeAt(roots, keyPath(k))?.children.length)
        void showMenu([
          { label: t('收起这几个'), accel: accelFor('mm-fold'), enabled: !p.readOnly && can.some((k) => !folded.has(k)), run: () => commit(can.reduce((r, k) => setFold(r, keyPath(k), true), roots)) },
          { label: t('展开这几个'), enabled: !p.readOnly && can.some((k) => folded.has(k)), run: () => commit(can.reduce((r, k) => setFold(r, keyPath(k), false), roots)) },
          '-',
          { label: t('不选了'), accel: accelFor('escape'), run: () => setMsel([]) },
        ])
      }
    }
  }
  const hasCenter = msel.some((k) => isCenter(k))
  const barWhy: Partial<Record<BarAct, string>> = {
    ...(hasCenter ? { frame: t('中心主题不能加外框'), sum: t('中心主题不能加概要') } : {}),
    ...(!sumsOf(kind) ? { sum: t('鱼骨、时间线、向下展开里先不画概要') } : {}),
    ...(msel.length !== 2 ? { rel: t('选两个主题才能连线') } : {}),
  }
  const barRect = (() => {
    if (!multi || drag?.moved || !layer.current) return null
    const r = layer.current.getBoundingClientRect()
    const boxes = msel.map((k) => L.byKey[k]).filter((b): b is NodeBox => !!b)
    if (!boxes.length) return null
    return {
      left: r.left + Math.min(...boxes.map((b) => b.x)) * p.scale,
      top: r.top + Math.min(...boxes.map((b) => b.y)) * p.scale,
      right: r.left + Math.max(...boxes.map((b) => b.x + b.w)) * p.scale,
      bottom: r.top + Math.max(...boxes.map((b) => b.y + b.h)) * p.scale,
    }
  })()

  // ---------- 画 ----------
  const selBox = sel ? nodeAt(roots, keyPath(sel))?.box : undefined
  const ph = L.photo
  const photoImgH = ph ? ph.h - 34 : 0
  const counts = countNodes(roots)
  const line = drag?.moved && drag.drop && 'beside' in drag.drop && !(drag.keys.length === 1 && stays(drag.key, drag.drop)) ? insertLine(L, drag.drop.beside, drag.drop.after) : null
  const dragNode = drag?.moved ? nodeAt(roots, keyPath(drag.key)) : undefined
  const dragMore = drag?.moved ? drag.keys.reduce((s, k) => s + 1 + hiddenCount(nodeAt(roots, keyPath(k))!), 0) - 1 : 0
  // 找的条开着时不出「+」（designer 复审提的：当前找到的那处是选中的，旁边露个加号不对）
  const selNode = sel && !multi && !editing && !drag?.moved && !p.readOnly && !find ? L.byKey[sel] : undefined
  const plus = selNode && !nodeAt(roots, keyPath(selNode.key))?.img ? { key: selNode.key, ...plusAt(selNode, !!nodeAt(roots, keyPath(selNode.key))?.children.length) } : null
  const inlineAt = (() => {
    if (!inline) return null
    if (inline.kind === 'rel') {
      const g = L.rels[inline.i]
      return g ? { x: g.mx - 80, y: g.my - 14, value: rels[inline.i]?.label ?? '', ph: t('线上写什么（可以不写）') } : null
    }
    const n = nodeAt(roots, keyPath(inline.key))
    if (inline.kind === 'frame') {
      const f = L.frames.find((x) => x.key === inline.key)
      return f && n ? { x: f.x + 12, y: f.y - 13, value: n.frame?.title ?? '', ph: t('外框的名字（可以不写）') } : null
    }
    const s = L.sums.find((x) => x.key === inline.key)
    return s && n ? { x: s.x - 4, y: s.y - 3, value: n.sum?.text ?? '', ph: t('用一句话收住这几个') } : null
  })()
  const doneInline = (v: string | null) => {
    const it = inline
    setInline(null)
    focusLayer()
    if (!it || v === null || p.readOnly) return
    if (it.kind === 'rel') {
      const r = rels[it.i]
      if (r && (r.label ?? '') !== v) commitText(withMapRels(p.text, rels.map((x, j) => (j === it.i ? { ...x, label: v || undefined } : x))))
      return
    }
    const path = keyPath(it.key)
    const n = nodeAt(roots, path)
    if (!n) return
    if (it.kind === 'frame' && n.frame && (n.frame.title ?? '') !== v) commit(setAttrs(roots, path, { frame: { n: n.frame.n, ...(v ? { title: v } : {}) } }))
    if (it.kind === 'sum' && n.sum && (n.sum.text ?? '') !== v) commit(setAttrs(roots, path, { sum: { n: n.sum.n, ...(v ? { text: v } : {}) } }))
  }
  const hitOpened = [...tmpOpen].map((k) => t('「{name}」', { name: textOf(k) })).join('')
  const findNote = !find
    ? null
    : !find.q.trim()
      ? find.notes
        ? t('找主题的字和备注；收着的枝里找到了会临时展开')
        : t('找主题的字；收着的枝里找到了会临时展开')
      : !cur
        ? rich(t('这块导图里没有「{q}」 · 到全库找 {key}'), { q: find.q.trim(), key: <b>{K('search')}</b> })
        : (
            <>
              {cur.inNote
                ? rich(t('第 {n} 处在{topic}的备注里'), { n: Math.min(find.cur, hits.length), topic: <b>{t('「{name}」', { name: textOf(cur.key) })}</b> })
                : rich(t('第 {n} 处：{topic}'), { n: Math.min(find.cur, hits.length), topic: <b>{t('「{name}」', { name: textOf(cur.key) })}</b> })}
              {hitOpened && ` · ${t('{names}本来收着，先临时展开了，关掉就收回', { names: hitOpened })}`}
            </>
          )

  return (
    <div
      className={`mm-layer lay-${kind}`}
      ref={layer}
      tabIndex={-1}
      onKeyDown={onKey}
      onPaste={(e) => {
        if (p.readOnly || !sel || multi || typingIn(e.target) || !e.clipboardData) return
        if (!Array.from(e.clipboardData.items).some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return
        e.preventDefault()
        e.stopPropagation()
        dropImageOn(sel, e.clipboardData, true)
      }}
      style={{ width: L.w, height: L.h }}
      data-testid="mindmap"
      data-layout={kind}
      data-pal={palette}
      data-sk={skeleton}
    >
      {L.frames.map((f) => (
        <div key={'f' + f.key} className="mm-frm" data-testid="map-frame" style={{ left: f.x, top: f.y, width: f.w, height: f.h }} />
      ))}
      <svg className="mm-wires" width={L.w} height={L.h}>
        {L.lines.map((l, i) => (
          <g key={'l' + i} className="spine">
            <path d={`M${l.x1} ${l.y1}L${l.x2} ${l.y2}`} />
            {l.arrow && <path className="arrow" d={`M${l.x2 - 8} ${l.y2 - 5}L${l.x2} ${l.y2}L${l.x2 - 8} ${l.y2 + 5}`} />}
          </g>
        ))}
        {L.wires.map((w) => {
          const a = L.byKey[w.from]
          const b = L.byKey[w.to]
          if (!a || !b) return null
          const d = wireOf(kind, a, b)
          if (!d) return null
          return (
            <path
              key={w.to}
              pathLength={1}
              className={(visible(w.to) ? (shown === Infinity && lateState(w.to) !== 'grow' ? '' : 'grow') : 'hid') + (b.branch !== undefined ? ' br' : '') + (hide(w.to) ? ' fy-covered' : '')}
              style={b.branch !== undefined ? ({ '--bc': `var(--mm-b${b.branch})` } as React.CSSProperties) : undefined}
              d={d}
            />
          )
        })}
        {L.sums.map((s) => (
          <path key={'s' + s.key} className="sumb" d={s.bracket} />
        ))}
        {ghostBoxes.map((g) => {
          const parent = ghosted.ghosts.get(g.key)!
          const a = Lfull.byKey[parent]
          const d = a && wireOf(kind, a, g)
          return d ? <path key={'gw' + g.key} pathLength={1} className={'ghost' + (visible(parent + '#blank') ? (lateState(parent + '#blank') === 'grow' ? ' grow' : '') : ' hid')} d={d} /> : null
        })}
      </svg>
      {L.frames.map((f) =>
        f.title ? (
          <div
            key={'ft' + f.key}
            className="mm-frt"
            data-testid="map-frame-title"
            style={{ left: f.x + 12, top: f.y - 10 }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (!p.readOnly) setInline({ kind: 'frame', key: f.key })
            }}
          >
            {f.title}
          </div>
        ) : null,
      )}
      {L.sums.map((s) => (
        <div
          key={'st' + s.key}
          className="mm-node l2 sumt"
          data-testid="map-sum"
          style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (!p.readOnly) setInline({ kind: 'sum', key: s.key })
          }}
        >
          <span className="t">{s.text}</span>
        </div>
      ))}
      {photo && ph && (
        <figure className="mm-photocard" style={{ left: ph.x, top: ph.y, width: ph.w }} data-testid="map-photo" onPointerDown={(e) => e.stopPropagation()}>
          <div className="ph" style={{ height: photoImgH }}>
            <img src={photo.src} alt={photo.caption} draggable={false} />
            {selBox && (
              <div
                className="hl"
                data-testid="photo-highlight"
                style={{ left: selBox[0] * ph.w - 3, top: selBox[1] * photoImgH - 3, width: selBox[2] * ph.w + 6, height: selBox[3] * photoImgH + 6 }}
              />
            )}
          </div>
          <figcaption>
            <Codicon name="device-camera" size={12} />
            {photo.caption}
          </figcaption>
        </figure>
      )}
      {coverKeys.length > 0 && <MapCover boxes={L.nodes.filter((b) => under(b.key))} peeking={!!p.cover?.peeking} chip={p.cover?.chip} />}
      {L.nodes.map((b) => {
        const n = nodeAt(viewRoots, keyPath(b.key))!
        const isFolded = folded.has(b.key)
        const center = b.depth === 0
        const hasKids = n.children.length > 0
        const tmp = tmpOpen.has(b.key) && !!n.fold
        const isSel = (sel === b.key && !multi) || msel.includes(b.key)
        const cls = [
          'mm-node',
          b.level,
          `side-${b.side}`,
          b.boxed ? 'boxed' : '',
          b.ul ? 'ul' : '',
          b.floatRoot ? 'flt' : '',
          n.img && b.img ? 'hasimg' : '',
          visible(b.key) ? (shown === Infinity && lateState(b.key) !== 'grow' ? '' : 'grow') : 'hid',
          isSel && !inDrag(b.key) ? 'sel' : '',
          n.wrong ? 'wrong' : '',
          n.fix ? 'fixn' : '',
          dotted && b.depth === 1 && progress.dots[b.key] ? 'dotted' : '',
          cur?.key === b.key ? 'hitcur' : '',
          n.unsure ? 'unsure' : '',
          flash === b.key ? 'flash' : '',
          drag?.moved && drag.drop && 'into' in drag.drop && drag.drop.into === b.key ? 'drop' : '',
          dropImg === b.key ? 'drop' : '',
          inDrag(b.key) ? 'dim' : '',
          relFrom && relFrom !== b.key ? 'relto' : '',
          hide(b.key) ? 'fy-covered' : '',
        ]
        return (
          <div
            key={b.key}
            className={cls.filter(Boolean).join(' ')}
            style={{ left: b.x, top: b.y, width: b.w, height: b.h, ...(b.branch !== undefined ? ({ '--bc': `var(--mm-b${b.branch})` } as React.CSSProperties) : {}) }}
            data-key={b.key}
            onPointerDown={(e) => onNodeDown(e, b.key)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (!p.readOnly) setEditing(b.key)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!msel.includes(b.key)) selectOnly(b.key)
              focusLayer()
              void showMenu(nodeMenu(b.key))
            }}
            onDragOver={(e) => {
              if (p.readOnly || !mayHaveImage(Array.from(e.dataTransfer.types))) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'copy'
              if (dropImg !== b.key) setDropImg(b.key)
            }}
            onDragLeave={(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null) && setDropImg(null)}
            onDrop={(e) => {
              setDropImg(null)
              if (p.readOnly || !looksLikeImage(e.dataTransfer)) return
              e.preventDefault()
              e.stopPropagation()
              selectOnly(b.key)
              dropImageOn(b.key, e.dataTransfer)
            }}
          >
            {editing === b.key ? (
              <NodeEditor
                initial={n.text}
                level={b.level}
                boxed={b.boxed}
                ul={b.ul}
                overlay={p.overlay}
                onDone={(v, then) => {
                  setEditing(null)
                  focusLayer()
                  const changed = v !== null && v.trim() && v.trim() !== n.text
                  const next = changed ? setText(roots, keyPath(b.key), v) : roots
                  // 改字时按 Tab：存下这个字，接着给它加一个子主题（同 XMind）
                  if (then === 'child') {
                    const node = nodeAt(next, keyPath(b.key))!
                    commit(insertAt(node.fold ? setFold(next, keyPath(b.key), false) : next, keyPath(b.key), node.children.length, newTopic()))
                    const k = pathKey([...keyPath(b.key), node.children.length])
                    selectOnly(k)
                    setEditing(k)
                  } else if (changed) commit(next)
                }}
              />
            ) : (
              <NodeBody
                node={n}
                notePath={p.notePath}
                img={b.img}
                query={find?.q ?? ''}
                noteOn={cur?.key === b.key && cur.inNote}
                onNote={() => {
                  selectOnly(b.key)
                  setNoteOf((x) => (x?.key === b.key ? null : { key: b.key, focus: true }))
                }}
                onLink={(seg: MapSeg, e) => {
                  if (dragged.current || e.shiftKey) return
                  e.stopPropagation()
                  linkCard.hide()
                  openMapLink(p.notePath, seg, e.metaKey || e.ctrlKey)
                }}
                onImgResize={sel === b.key && !multi && !p.readOnly ? (e) => startImgResize(e, b.key) : undefined}
                onLinkHover={(seg, el) => {
                  if (drag?.moved) return
                  if (seg) linkKey.current = b.key
                  linkCard.hover(seg, el)
                }}
              />
            )}
            {dotted && b.depth === 1 && progress.dots[b.key] && <ProgressDot dot={progress.dots[b.key]!} />}
            {n.unsure && editing !== b.key && (
              <button
                className="q"
                title="AI 拿不准，点一下对照照片改"
                aria-label="对照照片改"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  selectOnly(b.key)
                  setFix(b.key)
                }}
              >
                ?
              </button>
            )}
            {hasKids && !center && (
              <button
                type="button"
                tabIndex={-1}
                className={'fold' + (isFolded ? ' folded num' : '') + (tmp ? ' tmp' : '')}
                aria-label={tmp ? t('为了给你看找到的，先临时展开了；关掉找就收回') : isFolded ? t('展开（藏着{n}个）', { n: hiddenCount(n) }) : t('收起这一枝')}
                data-tip={tmp ? t('为了给你看找到的，先临时展开了；关掉找就收回') : isFolded ? t('展开（藏着{n}个）', { n: hiddenCount(n) }) : t('收起这一枝')}
                data-key={K('mm-fold') ?? undefined}
                data-side="below"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.preventDefault()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  selectOnly(b.key)
                  focusLayer()
                  run('mm-fold', b.key)
                }}
              >
                {/* 收着时写藏了几个；没收时的「−」画在 CSS 里（不算主题的字） */}
                {isFolded ? hiddenCount(n) : null}
              </button>
            )}
          </div>
        )
      })}
      {ghostBoxes.map((g) => {
        const parent = ghosted.ghosts.get(g.key)!
        const st = lateState(parent + '#blank')
        return (
          <button
            key={'g' + g.key}
            type="button"
            className={'mm-blank' + (st === 'hid' ? ' hid' : st === 'grow' ? ' grow' : '')}
            style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
            data-testid="map-blank"
            data-key={parent}
            disabled={p.readOnly}
            data-tip={t('含糊、没讲到：点开自己补一句，就是一次回忆')}
            data-side="below"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (!p.readOnly) setBlankEdit(g.key)
            }}
          >
            {blankText}
          </button>
        )
      })}
      {dotted &&
        L.nodes
          .filter((b) => b.depth === 0 && !b.float && b.key === '0')
          .map((c) => (
            <div key="fprog" className="mm-fprog num" data-testid="map-feynman-progress" style={{ left: c.x + 4, top: c.y + c.h + 8 }}>
              {t('费曼 讲过{done}/{total}', { done: progress.done, total: progress.total })}
            </div>
          ))}
      {blankEdit && Lfull.byKey[blankEdit] && (
        <InlineEdit
          key={'be' + blankEdit}
          x={Lfull.byKey[blankEdit]!.x}
          y={Lfull.byKey[blankEdit]!.y}
          value=""
          placeholder={blankText}
          onDone={(v) => {
            const parent = ghosted.ghosts.get(blankEdit)
            setBlankEdit(null)
            focusLayer()
            if (parent && v && v.trim()) commit(fillBlank(roots, parent, v))
          }}
        />
      )}
      {L.rels.some(Boolean) && (
        <svg className="mm-rels" width={L.w} height={L.h} data-testid="map-rels">
          {L.rels.map((g, i) =>
            g ? (
              <g key={i}>
                <path className={'rl' + (selRel === i ? ' on' : '')} d={g.d} />
                <path
                  className="rh"
                  data-testid="map-rel"
                  d={g.d}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setSel(null)
                    setMsel([])
                    setSelRel(i)
                    focusLayer()
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (!p.readOnly) setInline({ kind: 'rel', i })
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setSelRel(i)
                    void showMenu([
                      { label: t('改线上的字'), enabled: !p.readOnly, run: () => setInline({ kind: 'rel', i }) },
                      { label: t('删掉这条联系线'), accel: accelFor('mm-del'), enabled: !p.readOnly, run: () => removeRel(i) },
                    ])
                  }}
                />
                <path className={'ah' + (selRel === i ? ' on' : '')} d={g.ah} />
              </g>
            ) : null,
          )}
        </svg>
      )}
      {L.rels.map((g, i) =>
        g && rels[i]?.label && !(inline?.kind === 'rel' && inline.i === i) ? (
          <div
            key={'rl' + i}
            className={'mm-rlab' + (selRel === i ? ' on' : '')}
            data-testid="map-rel-label"
            style={{ left: g.mx, top: g.my }}
            onPointerDown={(e) => (e.stopPropagation(), setSelRel(i), setSel(null), setMsel([]))}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (!p.readOnly) setInline({ kind: 'rel', i })
            }}
          >
            {rels[i]!.label}
          </div>
        ) : null,
      )}
      {selRel !== null && L.rels[selRel] && !p.readOnly && (
        <div className="mm-rhd" data-testid="map-rel-handle" data-tip={t('拖着改弯度')} data-side="below" style={{ left: L.rels[selRel]!.hx, top: L.rels[selRel]!.hy }} onPointerDown={(e) => startBend(e, selRel)} />
      )}
      {plus && (
        <button
          type="button"
          tabIndex={-1}
          className="mm-plus"
          style={{ left: plus.x, top: plus.y }}
          aria-label={t('加子主题')}
          data-tip={t('加子主题')}
          data-key={K('mm-child') ?? undefined}
          data-side="below"
          data-testid="map-plus"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            run('mm-child', plus.key)
          }}
        >
          <Codicon name="add" size={12} />
        </button>
      )}
      {line && <div className={'mm-ins' + (line.across ? ' v' : '')} data-testid="map-insert-line" style={{ left: line.x, top: line.y, width: line.w, height: line.h }} />}
      {marquee && (
        <div
          className="mm-marquee"
          data-testid="map-marquee"
          style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
        />
      )}
      {inline && inlineAt && <InlineEdit key={JSON.stringify(inline)} x={inlineAt.x} y={inlineAt.y} value={inlineAt.value} placeholder={inlineAt.ph} onDone={doneInline} />}
      {p.overlay && drag?.moved && dragNode && createPortal(<DragHand overlay={p.overlay} at={drag.at} text={mapShown(dragNode.text)} more={dragMore} hint={dragHint(drag)} />, p.overlay)}
      {p.overlay && focusPath && createPortal(<FocusPill roots={roots} path={focusPath} onExit={() => (setFocus(null), focusLayer())} />, p.overlay)}
      {p.overlay && pill && createPortal(<Pill kind={pill} total={counts.all} unsure={counts.unsure} shown={Math.min(shown, order.length)} inbox={underCat(p.notePath, '收件箱')} onClose={() => setPill(null)} />, p.overlay)}
      {p.overlay && relFrom && createPortal(<div className="mm-pill" role="status" data-testid="map-rel-mode">{t('点另一个主题，连一条线过去 · esc 不连了')}</div>, p.overlay)}
      {p.overlay &&
        find &&
        createPortal(
          <FindBar
            className="mm-find"
            query={find.q}
            onQuery={(q) => setFind({ ...find, q, cur: 1 })}
            count={find.q.trim() ? { at: hits.length ? Math.min(find.cur, hits.length) : 0, total: hits.length } : null}
            onNext={() => hits.length && setFind({ ...find, cur: (find.cur % hits.length) + 1 })}
            onPrev={() => hits.length && setFind({ ...find, cur: ((find.cur - 2 + hits.length) % hits.length) + 1 })}
            onClose={closeFind}
            placeholder={t('在这块导图里找')}
            note={findNote}
            toggles={[{ key: 'notes', icon: 'note', label: t('也找备注'), on: find.notes, onToggle: () => setFind({ ...find, notes: !find.notes, cur: 1 }) }]}
            focusSeq={find.seq}
          />,
          p.overlay,
        )}
      {p.overlay && multi && barRect && <MapSelBar overlay={p.overlay} rect={barRect} count={msel.length} why={barWhy} readOnly={p.readOnly} onAct={onBar} />}
      {p.overlay && noteOf && L.byKey[noteOf.key] && (
        <NotePop
          key={noteOf.key}
          overlay={p.overlay}
          anchor={layer.current?.querySelector<HTMLElement>(`[data-key="${noteOf.key}"]`) ?? null}
          topic={textOf(noteOf.key)}
          note={nodeAt(roots, keyPath(noteOf.key))?.note ?? ''}
          focus={noteOf.focus}
          readOnly={p.readOnly}
          onSave={(note) => {
            // 存的时候按最新的文件来（弹层开着时别处也可能改了）
            const now = parseMindmap(textRef.current).roots
            const path = keyPath(noteOf.key)
            if (!nodeAt(now, path) || p.readOnly) return
            const out = withMindmap(textRef.current, setNote(now, path, note))
            if (out !== textRef.current) p.onChange(out)
          }}
          onClose={() => {
            setNoteOf(null)
            focusLayer()
          }}
        />
      )}
      {p.overlay && exporting && (
        <ExportDialog
          overlay={p.overlay}
          fmt={exporting.fmt}
          roots={roots}
          notePath={p.notePath}
          palette={palette}
          photo={photo}
          branch={focusKey ?? (sel && !isCenter(sel) ? sel : null)}
          branchFirst={!!focusKey}
          layoutFor={(k) => layoutFor(k ? keyPath(k) : null)}
          relLabels={(lay) => lay.rels.map((_, i) => rels[i]?.label)}
          host={layer.current ?? p.overlay}
          onClose={() => (setExporting(null), focusLayer())}
          onDone={(path) => {
            setExporting(null)
            focusLayer()
            if (path) p.onNotice(t('存好了：{path}', { path: path.split('/').slice(-2).join(' / ') }))
          }}
        />
      )}
      {p.overlay && fix && L.byKey[fix] && layer.current && (
        <FixPop
          key={fix}
          overlay={p.overlay}
          anchor={layer.current.querySelector<HTMLElement>(`[data-key="${fix}"]`)}
          node={nodeAt(roots, keyPath(fix))!}
          onCancel={() => setFix(null)}
          onOk={(v) => {
            commit(setText(roots, keyPath(fix), v))
            setFix(null)
            setFlash(fix)
            focusLayer()
            p.onNotice('改好了 · 已保存')
          }}
        />
      )}
    </div>
  )
}

/** 画布上的小输入框（外框的名字、概要那句话、联系线上的字）：↵ 存，esc 不改，点别处存 */
function InlineEdit(props: { x: number; y: number; value: string; placeholder: string; onDone(v: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    props.onDone(v === null ? null : v.trim())
  }
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true })
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="mm-inl"
      data-testid="map-inline"
      aria-label={props.placeholder}
      placeholder={props.placeholder}
      defaultValue={props.value}
      style={{ left: props.x, top: props.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') (e.preventDefault(), finish(e.currentTarget.value))
        if (e.key === 'Escape') (e.preventDefault(), finish(null))
      }}
    />
  )
}

/** 拖着的时候跟着手的：一块小卡写它的字和「+N」，下面一块小牌说松手后去哪（挂在白板外框上，不跟着缩放） */
function DragHand(props: { overlay: HTMLElement; at: { x: number; y: number }; text: string; more: number; hint: string }) {
  const r = props.overlay.getBoundingClientRect()
  const x = props.at.x - r.left + 16
  const y = props.at.y - r.top
  return (
    <>
      <div className="mm-ghost" data-testid="map-drag-ghost" style={{ left: x, top: y + 10 }}>
        {props.more ? `${props.text}  +${props.more}` : props.text}
      </div>
      <div className="mm-dragchip" role="status" data-testid="map-drag-hint" style={{ left: x, top: y + 44 }}>
        {props.hint}
      </div>
    </>
  )
}

/** 只看这一枝时顶上的胶囊：只看「核与像」这一枝 · 从哪来 · 回到整张 esc */
function FocusPill(props: { roots: MapNode[]; path: MapPath; onExit(): void }) {
  const t = useT()
  const K = useKeys()
  const chain = props.path.map((_, i) => mapShown(nodeAt(props.roots, props.path.slice(0, i + 1))?.text ?? ''))
  const name = chain[chain.length - 1] ?? ''
  return (
    <div className="mm-pill focus" role="status" data-testid="map-focus">
      <Codicon name="target" size={14} />
      <span>{rich(t('只看{name}这一枝'), { name: <b>{t('「{name}」', { name })}</b> })}</span>
      <span className="crumb">{chain.join(' › ')}</span>
      <button type="button" className="back" onPointerDown={(e) => e.stopPropagation()} onClick={props.onExit}>
        {t('回到整张')}
        <span className="mm-esc">{K('escape')}</span>
      </button>
    </div>
  )
}

function Pill(props: { kind: 'growing' | 'done'; total: number; unsure: number; shown: number; inbox: boolean; onClose(): void }) {
  const where = props.inbox ? '放在收件箱' : '放好了'
  return (
    <div className="mm-pill" role="status" data-testid="map-pill">
      {props.kind === 'growing' ? (
        <>
          <span className="pd" />
          {`正在放上白板 · ${props.shown} / ${props.total}个`}
        </>
      ) : (
        <>
          <Codicon name="check" size={14} />
          {props.unsure ? (
            <span>
              {`放好了${props.total}个节点，`}<b className="yel">{`${props.unsure}个拿不准`}</b>，点「?」对照照片改 · {where}
            </span>
          ) : (
            <span>做好了，{where}{props.inbox ? ' · 今晚梦游时归类、起名' : ''}</span>
          )}
          <button className="btn btn-ghost" aria-label="关掉提示" onClick={props.onClose}>
            <Codicon name="close" size={12} />
          </button>
        </>
      )}
    </div>
  )
}

/** 改主题的字：↵ 存下，esc 不改，Tab 存下再加一个子主题（同 XMind）；打 [[ 出找笔记的小框（和文档里一样），改字时露出原文 [[…]] */
function NodeEditor(props: { initial: string; level: Level; boxed: boolean; ul: boolean; overlay: HTMLElement | null; onDone(v: string | null, then?: 'child'): void }) {
  const t = useT()
  const [v, setV] = useState(props.initial)
  const [caret, setCaret] = useState(props.initial.length)
  const [pick, setPick] = useState(0)
  const done = useRef(false)
  const ref = useRef<HTMLInputElement>(null)
  const { files } = useVaultFiles()
  const finish = (x: string | null, then?: 'child') => {
    if (done.current) return
    done.current = true
    props.onDone(x, then)
  }
  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  // 光标前面是「[[…」（还没合上）：找笔记
  const open = /\[\[([^\]\n]*)$/.exec(v.slice(0, caret))
  const q = open ? open[1]!.toLowerCase() : null
  const sugg =
    q === null
      ? []
      : files
          .filter((f) => f.kind === 'md')
          .map((f) => f.path.split('/').pop()!.replace(/\.md$/i, ''))
          .filter((name, i, all) => all.indexOf(name) === i && name.toLowerCase().includes(q))
          .slice(0, 8)
  const choose = (name: string) => {
    const at = caret - (open ? open[0].length : 0)
    const rest = v.slice(caret).replace(/^\]\]/, '')
    const next = `${v.slice(0, at)}[[${name}]]${rest}`
    setV(next)
    const c = at + name.length + 4
    setCaret(c)
    requestAnimationFrame(() => ref.current?.setSelectionRange(c, c))
  }
  const pad = (props.boxed ? BOXED_BOX : props.ul ? UL_BOX : NODE_BOX[props.level]).pad
  const r = ref.current?.getBoundingClientRect()
  return (
    <>
      <input
        ref={ref}
        className="mm-edit"
        aria-label="节点的字"
        value={v}
        style={{ width: Math.max(48, measure(v, props.level, NODE_MAX_W - pad).w + 14) }}
        onChange={(e) => {
          setV(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setPick(0)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? v.length)}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={() => !sugg.length && finish(v)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (sugg.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return void (e.preventDefault(), setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : sugg.length - 1)) % sugg.length))
            if (e.key === 'Enter' || e.key === 'Tab') return void (e.preventDefault(), choose(sugg[pick] ?? sugg[0]!))
            if (e.key === 'Escape') return void (e.preventDefault(), setCaret(-1))
          }
          if (e.key === 'Enter') (e.preventDefault(), finish(v))
          if (e.key === 'Escape') (e.preventDefault(), finish(null))
          if (e.key === 'Tab' && !e.shiftKey) (e.preventDefault(), finish(v, 'child'))
        }}
      />
      {sugg.length > 0 &&
        r &&
        createPortal(
          <div className="mm-sugg" role="listbox" aria-label={t('链接到笔记')} data-testid="map-link-suggest" style={{ left: r.left, top: r.bottom + 6 }} onPointerDown={(e) => e.preventDefault()}>
            {sugg.map((name, i) => (
              <button key={name} type="button" role="option" aria-selected={i === pick} className={i === pick ? 'on' : ''} onMouseEnter={() => setPick(i)} onClick={() => choose(name)}>
                <Codicon name="file" size={13} />
                {name}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

/** 拿不准的节点：照片上框出这一块，对着改；AI 猜的几种写法点一下就填上 */
function FixPop(props: { overlay: HTMLElement; anchor: HTMLElement | null; node: MapNode; onCancel(): void; onOk(v: string): void }) {
  const [v, setV] = useState(props.node.text)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const o = props.overlay.getBoundingClientRect()
    const a = props.anchor?.getBoundingClientRect()
    if (!a) return
    const left = Math.max(12, Math.min(a.left - o.left - 20, o.width - 312))
    let top = a.bottom - o.top + 12
    if (top > o.height - 200) top = Math.max(12, a.top - o.top - 200)
    setPos({ left, top })
    input.current?.focus()
    input.current?.select()
  }, [])
  const guesses = [...new Set([...(props.node.guesses ?? []), props.node.text])].slice(0, 3)
  // 点外面（网页里也算）、窗口失焦当不改（公共的 useDismiss）；Esc 照旧归导图那一层的键盘处理
  const box = useRef<HTMLDivElement>(null)
  useDismiss(true, [box, props.anchor], () => props.onCancel(), { esc: false })
  return createPortal(
    <div ref={box} className="mm-fix" role="dialog" aria-label="照片上这块写的是？" style={pos ?? { visibility: 'hidden' }} onPointerDown={(e) => e.stopPropagation()}>
      <h4>照片上这块写的是？</h4>
      <p className="help">左边照片上框出来的就是这一块。字写得潦草，AI读成了「{props.node.text}」。</p>
      <input
        ref={input}
        aria-label="改成"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && v.trim()) (e.preventDefault(), props.onOk(v))
          if (e.key === 'Escape') (e.preventDefault(), props.onCancel())
        }}
      />
      <div className="guess">
        <span className="help">AI猜：</span>
        {guesses.map((g) => (
          <button key={g} className="chip" onClick={() => setV(g)}>
            {g}
          </button>
        ))}
      </div>
      <div className="act">
        {/* 收不收那一套的叫法和图标（task-eavzx）：不要（无边框）· 改好了（实心） */}
        <button className="btn btn-ghost btn-sm" onClick={props.onCancel}>
          <Codicon name="close" size={14} />
          不要
        </button>
        <button className="btn btn-primary btn-sm" disabled={!v.trim()} onClick={() => props.onOk(v)}>
          <Codicon name="check" size={14} />
          改好了<span className="kbd-in">↵</span>
        </button>
      </div>
    </div>,
    props.overlay,
  )
}

/** 给标签条「布局 ▾」、⌘K 用：收起到第一层、全部展开（焦点不在导图上、文档看法里也能改文件；按 ⇧⌘/ 才是来回切） */
/** 第一层一个点后面的小点：没讲过空心灰圈、正在讲蓝、过绿、差一点黄、没过红；悬停写哪天讲的 */
function ProgressDot({ dot }: { dot: MapDot }) {
  const t = useT()
  const day = dot.day ? dayLabel(dot.day) : ''
  const tip =
    dot.state === 'none'
      ? t('还没讲过')
      : dot.state === 'talking'
        ? t('正在讲 · {day}开讲', { day })
        : t('{verdict} · {day}讲的 · 讲过{n}次', { verdict: t(dot.state === 'pass' ? '过' : dot.state === 'almost' ? '差一点' : '没过'), day, n: Math.max(1, dot.times) })
  return <i className={'fdot fs-' + dot.state} data-testid="map-feynman-dot" data-state={dot.state} data-tip={tip} aria-label={tip} />
}

/** 「11月23日」「Nov 23」（跟界面语言） */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString(document.documentElement.lang || undefined, { month: 'short', day: 'numeric' }) : iso
}

export function foldAllText(text: string, all: boolean): string {
  const roots = parseMindmap(text).roots
  return withMindmap(text, all ? foldAll(roots) : unfoldAll(roots))
}
