import { composing } from '../ime'
import { useT } from '../i18n'
import { accelFor, isKey, useKeyHandler, useKeys } from '../keys'
import { Codicon } from '@cn/design'
import { openSettingsAt } from '../settings/jump'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type AttachItem, sizeText } from '../../shared/attach'
import { catName } from '../../shared/categories'
import { type AttachIndex, buildTree, type FileEntry, fileName, filterTree, folderOfPath, folderProgress, isTreeSort, previewFiles, subtree, topGroups, TREE_SORTS, type TreeNode, type TreeSort } from '../../shared/files'
import { MovedMark, type DreamPreview } from '../dream/preview'
import { fileIcon } from '../Palette'
import { Progress } from '../search/QuickOpen'
import { onReveal, setTreePicked, takeReveal, useVaultFiles } from './store'
import { folderMenu, onFileMenu, type TreeMenu } from '../ctx/file-menu'
import { DRAG_ITEM, draggedItem } from '../folder-home/drag-item'
import { copy, menuAt } from '../ctx/menu'
import { app } from '../ctx/actions'
import { AiIcon } from '../engine-logo'
import { FolderRename, RenameInput } from '../note-menu'
import { HeadBtn, MenuItem, Popover, ViewHead } from '../shell/Shell'
import { FolderGlyph, LookPicker } from './look'
import { useLeft } from './left-store'
import { presetsOn } from '../../shared/left'
import { MovePicker, noteMovedTo } from './move-pick'
import { fileType, TypeChips, type TypeFilter, useSideType } from './type-filter'
import './file-tree.css'
import { bookName, usePairs } from '../read-along/store'
import { openDream } from '../dream/nav'
import { ClipRule, TreeStrip, useDreamTree } from '../dream/tree'

const OPEN_KEY = 'cn.treeOpen'
/** 筛了类型时符合的不超过这么多篇，装着它们的文件夹自己展开 */
const FILTER_OPEN_MAX = 200
/** 筛之前展开了哪些（回到「全部」时放回去）、已经替哪种筛选展开过 */
const filterOpen: { before: Set<string> | null; done: string | null } = { before: null, done: null }
const VIEW_KEY = 'cn.treeView'
/** 树的第一行（库本身）收起了：记在本机 */
const ROOT_KEY = 'cn.treeRootClosed'
/** 一个文件夹先显示这么多，多的点「再显示」（别把上万条全铺开） */
const PAGE = 100
/** 「附件」筛选：一篇先列这么多张，多的「再显示 N 张」（CN-104） */
const ATT_PAGE = 3
/** 定位到的那一行一圈强调色外圈，约 2 秒后消失（和白板上刚落下的卡片一样） */
const RING_MS = 2000
/** 拖着停在收着的文件夹上这么久，它自己展开（task-4891y ⑤，访达的弹簧文件夹、VS Code 都是这样） */
const SPRING_MS = 600

/** 目录树里拖着的笔记（库里的相对路径） */
const DRAG_MIME = 'application/x-cn-note'
/** 拖着的是文件夹（和访达一样能拖进别的文件夹；拖到图标栏上是「放到左边」，task-wniqx） */
export const DRAG_DIR = 'application/x-cn-folder'
/** 正在从树里拖着的文件夹（图标栏 dragover 时读不到 dataTransfer 里的值，问这里：已经在左边的不接） */
let draggedDir: string | null = null
export const draggedFolder = () => draggedDir
/** 拖着选中的好几个（CN-105） */
const DRAG_MANY = 'application/x-cn-many'

/** 排序菜单里的：六种排法、三个开关、自动定位当前文件；记在本机 */
export interface TreeView {
  sort: TreeSort
  foldersFirst: boolean
  pinsFirst: boolean
  counts: boolean
  autoReveal: boolean
}
const DEFAULT_VIEW: TreeView = { sort: 'name-asc', foldersFirst: true, pinsFirst: true, counts: true, autoReveal: true }

function loadView(): TreeView {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<TreeView> | null
    if (!v) return DEFAULT_VIEW
    return {
      sort: isTreeSort(v.sort) ? v.sort : DEFAULT_VIEW.sort,
      foldersFirst: v.foldersFirst !== false,
      pinsFirst: v.pinsFirst !== false,
      counts: v.counts !== false,
      autoReveal: v.autoReveal !== false,
    }
  } catch {
    return DEFAULT_VIEW
  }
}

function loadOpen(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [catName('课程')])
  } catch {
    return new Set([catName('课程')])
  }
}

const ancestors = (p: string) => {
  const out: string[] = []
  for (let d = folderOfPath(p); d; d = folderOfPath(d)) out.push(d)
  return out
}

const shown = (name: string) => name.replace(/\.(md|pdf|html?)$/i, '')
const imgUrl = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const isAttach = (k: TreeNode['kind']) => k === 'img' || k === 'att'

/** 「课程」这一行：每门课问完了几讲加起来（和活动栏、首页「在上的课」一样数） */
function coursesProgress(n: TreeNode): { done: number; total: number } | null {
  let done = 0
  let total = 0
  for (const c of n.children) {
    if (c.kind !== 'dir') continue
    const p = folderProgress(c)
    if (p) ((done += p.done), (total += p.total))
  }
  return total ? { done, total } : null
}

/**
 * 左栏「文件」（按位置，Obsidian 式目录树）：头上六个图标（新建笔记、新建文件夹、新建白板、定位当前文件、排序、全部收起），
 * 一排类型筛选（全部 / 文档 / 白板 / 剪藏 / 附件），下面一个找文件的框（⌥⌘F，打字把树筛到命中的几行，task-4891y），再下面是整个库的目录树；
 * 钉住的几样（置顶.json，右键「钉到最上面」）在库那一行上面单独一组（task-4891y）。拖着停在收着的文件夹上 0.6 秒它自己展开；
 * 右键「移到…」是打字找的小弹层（move-pick.tsx）。
 * 第一行是库本身（库图标 + 库名 + 一共几个，CN-104），最外层挂在它下面：顶级分类按「收件箱 | 读进来的 | 自己写的」分组，
 * 别的文件夹和散文件收在「不在分类里的」；附件/ 也在树里（图是 file-media）。每个文件夹后面是篇数，置顶的有图钉，能有自己的图标和颜色。
 * 点文件夹的名字开它的首页（顺手展开），点箭头只展开；点文件按类型开标签。
 * 选好几个（CN-105，照访达）：Shift 点连选、⌘ 点加选、在空白处按下拖框选、Shift ↑↓ 一行行加；选了两个以上底部浮出「已选 N 个 · 移到… · 删除」，
 * 右键对着这一组，拖着其中一个挪的是全部，⌘⌫ 删（和右键「移到废纸篓」同一个确认）。
 * 「附件」筛选：附件挂在用它的那篇笔记下面，一篇先列 3 张；读 PDF 的完整对话用的图挂在那份 PDF 的笔记下面（PDF 不在了的单列「完整对话在用的附件」），
 * 没有谁在用的放最下面「没有笔记的附件」一组。
 * root：摘到活动栏的文件夹，只画它自己那一枝。梦游预览开着时画成改好以后的样子：挪来的标「新」，原来的位置留划掉的影子。
 */
/** 挂着的子文件左边的线：x 是父文件展开箭头的正中，rails 是上面几层还没走完的竖线，last 是最后一个（拐弯，不再往下） */
interface Guide {
  x: number
  rails: number[]
  last: boolean
}

export function FileTree(props: {
  /** 头上的字：「文件」或摘出来的文件夹的名字 */
  title: string
  root?: string
  /** 树第一行写的库名 */
  vaultName: string
  onNewNote(): void
  onNewBoard(): void
  activePath: string | null
  onOpen(path: string): void
  onOpenFolder(path: string): void
  preview?: DreamPreview | null
  onRename(path: string, name: string): void
  /** 白板：路径 → 它自己的颜色（目录树里画颜色方块，不画文档图标） */
  boards: Map<string, string>
  /** 挂在别的笔记下面的子文件 → 那一篇（白板下的导图、子白板，task-wuv05） */
  subOf: ReadonlyMap<string, string>
  /** md 是哪类（白板、剪藏；没有的是文档），类型筛选用 */
  noteTypes: ReadonlyMap<string, Exclude<TypeFilter, 'all' | 'att'>>
  /** 书摘：图标是 quote（同一篇在哪都是同一个图标） */
  digests: ReadonlySet<string>
  pins: string[]
}) {
  /** 写在界面上的键照命令表（改了跟着变） */
  const K = useKeys()
  const t = useT()
  const { files, loaded } = useVaultFiles()
  const [open, setOpen] = useState(loadOpen)
  const [rootOpen, setRootOpen] = useState(() => {
    try {
      return localStorage.getItem(ROOT_KEY) !== '1'
    } catch {
      return true
    }
  })
  const [view, setView] = useState(loadView)
  const [type, setType] = useSideType()
  const [pages, setPages] = useState<Record<string, number>>({})
  /** 右键「重命名」：原地改名的那一篇或那个文件夹 */
  const [renaming, setRenaming] = useState<string | null>(null)
  /** 点过的文件夹（新建笔记、文件夹放进它里面）；点文件后换成没有 */
  const [picked, setPicked] = useState<string | null>(null)
  /** 正在新建文件夹：在哪个文件夹里（'' 是最外层） */
  const [making, setMaking] = useState<string | null>(null)
  const [sortMenu, setSortMenu] = useState<HTMLElement | null>(null)
  const [look, setLook] = useState<{ folder: string; el: HTMLElement } | null>(null)
  /** 刚定位到的那一行：一圈外圈，2 秒后消失 */
  /** 一圈外圈的那几行（定位到的一行；放回的文件夹和里面放回的几篇） */
  const [ring, setRing] = useState<ReadonlySet<string> | null>(null)
  /** 选中的（CN-105）：⌘ 点、Shift 连选、框选来的（灰底），和「正在看」（开着的那篇，竖线）分开（task-cqia6）；两个以上底部出「已选 N 个」那一条；anchor 是 Shift 连选的起点，cursor 是 Shift ↑↓ 走到的那一头 */
  const [sel, setSel] = useState<Set<string>>(new Set())
  /** 和网页配成一对的几篇（task-kbnc0）：这一行右边一个网页小标 */
  const pairs = usePairs()
  const anchor = useRef<string | null>(null)
  const cursor = useRef<string | null>(null)
  /** 框选：起点和现在的点（相对目录树） */
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  /** 「附件」筛选要的：哪篇笔记用哪些附件（只在选了「附件」时读） */
  const [att, setAtt] = useState<AttachIndex | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  /** 找文件的框（task-4891y ②）：打的字；有字时树只留命中的几行和它们的上一层，都展开着 */
  const [q, setQ] = useState('')
  const qOn = q.trim() !== ''
  const findRef = useRef<HTMLInputElement>(null)
  // ⌥⌘F（命令表 find-file）：光标到这个框，打过的字全选上
  useKeyHandler('find-file', () => (findRef.current?.focus(), findRef.current?.select(), true))
  /** 「移到…」小弹层（task-4891y ⑦）：挪哪几个、贴着哪一行（或底部那颗按钮） */
  const [mover, setMover] = useState<{ paths: string[]; what?: string; dirs: string[]; anchor: HTMLElement; side?: 'right' } | null>(null)
  /** 拖着一篇笔记或一个文件夹经过的文件夹（松手就挪进去） */
  const [dropOn, setDropOn] = useState<string | null>(null)
  /** 正在拖的文件夹（dragover 时读不到 dataTransfer 里的值，自己记着，不让拖进它自己里面） */
  const draggingDir = useRef<string | null>(null)
  /** 拖着停在哪个收着的文件夹上、到点展开它的计时（task-4891y ⑤）：换了文件夹、离开、松手就作废 */
  const spring = useRef<{ folder: string; timer: number } | null>(null)
  const stopSpring = (folder?: string) => {
    if (!spring.current || (folder !== undefined && spring.current.folder !== folder)) return
    window.clearTimeout(spring.current.timer)
    spring.current = null
  }
  useEffect(() => () => stopSpring(), [])
  useEffect(() => {
    if (dropOn === null) return
    // 从文件夹首页拖来的（task-r00en）按 esc 取消、松在别处：行自己的 onDragEnd 管不到，冒泡到 window 时收起亮着的那一行
    const end = () => (stopSpring(), setDropOn(null))
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => (window.removeEventListener('dragend', end), window.removeEventListener('drop', end))
  }, [dropOn !== null])
  const many = sel.size > 1
  /** key：这一行在 dropOn 里记成什么（钉住那一组的行和树里同一个文件夹分开亮） */
  const dropProps = (folder: string, closed = false, key = folder) => ({
    onDragOver: (e: React.DragEvent) => {
      const types = [...e.dataTransfer.types]
      const dir = types.includes(DRAG_DIR) ? draggingDir.current : null
      // 文件夹首页卡里拖来的一份（task-r00en）：和拖树里的笔记一样，本来就在的那个文件夹不亮
      const item = types.includes(DRAG_ITEM) ? draggedItem() : null
      if (!types.includes(DRAG_MIME) && !types.includes(DRAG_MANY) && !dir && !item) return
      if (item && folderOfPath(item) === folder) return
      // 文件夹不能拖进它自己、它里面，拖回原来的上一层也不算
      if (dir && (folder === dir || folder.startsWith(dir + '/') || folderOfPath(dir) === folder)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropOn !== key) setDropOn(key)
      // 收着的文件夹：停 0.6 秒自己展开（只在头一次经过时起计时，之后的 dragover 不重新算）
      if (closed && spring.current?.folder !== folder) {
        stopSpring()
        spring.current = {
          folder,
          timer: window.setTimeout(() => {
            spring.current = null
            if (folder) setOpen((o) => (o.has(folder) ? o : new Set([...o, folder])))
            else setRootOpen(true)
          }, SPRING_MS),
        }
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return
      stopSpring(folder)
      if (dropOn === key) setDropOn(null)
    },
    onDrop: (e: React.DragEvent) => {
      const path = e.dataTransfer.getData(DRAG_MIME)
      const dir = e.dataTransfer.getData(DRAG_DIR)
      const list = e.dataTransfer.getData(DRAG_MANY)
      const item = e.dataTransfer.getData(DRAG_ITEM)
      setDropOn(null)
      stopSpring()
      draggingDir.current = null
      if (!path && !dir && !list && !item) return
      e.preventDefault()
      e.stopPropagation()
      if (item) {
        if (folderOfPath(item) !== folder) (noteMovedTo(folder), void app().moveItem(item, folder))
      } else if (list) {
        const paths = (JSON.parse(list) as string[]).filter((p) => p !== folder && !folder.startsWith(p + '/'))
        if (paths.length) (noteMovedTo(folder), void app().moveMany(paths, folder).then(() => setSel(new Set())))
      } else if (dir) {
        if (folder !== dir && !folder.startsWith(dir + '/') && folderOfPath(dir) !== folder) (noteMovedTo(folder), void app().moveFolder(dir, folder))
      } else if (folderOfPath(path) !== folder) (noteMovedTo(folder), void app().moveNote(path, folder))
    },
  })
  const pv = props.preview
  // 梦游预览一开：挪去的地方、挪走的地方都展开，标「新」的行和划掉的影子行一眼看得到（设计稿 design/frame 梦游预览）
  const pvMoves = pv ? pv.moves.map((m) => `${m.from}\n${m.to}`).join('\n') : ''
  useEffect(() => {
    if (!pvMoves) return
    setOpen((o) => new Set([...o, ...pvMoves.split('\n').flatMap(ancestors)]))
    // 展开画好以后把第一处「新」（挪去的地方）滚到左栏中间：收件箱这种大枝整枝展开在前面时，去处常在首屏以下。
    // 树刚换上来时文件列表、展开还没画好：每一帧找一次，最多等 1.5 秒；一直没有「新」才滚到影子行。
    // 只滚左栏能滚的那一块：行自己 overflow: hidden，对「新」scrollIntoView 会把行里的名字滚走
    const until = performance.now() + 1500
    let raf = 0
    const tryScroll = () => {
      const tree = treeRef.current
      const late = performance.now() > until
      const at = (tree?.querySelector('.ft-row .pv-mark') ?? (late ? tree?.querySelector('.pv-ghost') : null))?.closest<HTMLElement>('.ft-row')
      let sc = at?.parentElement ?? null
      while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement
      if (!at || !sc) {
        if (!late) raf = requestAnimationFrame(tryScroll)
        return
      }
      const r = at.getBoundingClientRect()
      const v = sc.getBoundingClientRect()
      if (r.top < v.top || r.bottom > v.bottom) sc.scrollTop += r.top - v.top - (v.height - r.height) / 2
    }
    raf = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(raf)
  }, [pvMoves])
  // 新建笔记（⌘N、头上的按钮）放进点过的文件夹；摘出来的文件夹里没点过就放进它自己；目录树关了就不算
  useEffect(() => setTreePicked(picked ?? props.root ?? null), [picked, props.root])
  useEffect(() => () => setTreePicked(null), [])
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view))
    } catch {
      // 记不住排法不影响使用
    }
  }, [view])
  useEffect(() => {
    try {
      localStorage.setItem(ROOT_KEY, rootOpen ? '0' : '1')
    } catch {
      // 记不住不影响使用
    }
  }, [rootOpen])
  // 从摘出来的文件夹点「在「文件」里看位置」过来：展开到它、滚过去、一圈外圈
  useEffect(() => {
    if (props.root) return
    const go = (r: string, self = false, more: string[] = []) => {
      setRootOpen(true)
      setOpen((o) => new Set([...o, ...ancestors(r), ...(self ? [r] : [])]))
      setRing(new Set([r, ...more]))
      scrollTo(r)
    }
    const r = takeReveal()
    if (r) go(r)
    // 树开着时来的定位（历史里「放回」）：马上展开、一圈外圈
    return onReveal(go)
  }, [])
  useEffect(() => {
    if (!ring) return
    const t = setTimeout(() => setRing(null), RING_MS)
    return () => clearTimeout(t)
  }, [ring])
  // 「附件」筛选：读哪篇笔记用哪些附件；库里文件变了重读
  useEffect(() => {
    if (type !== 'att') return
    let stale = false
    void window.cnFiles.attachments().then((a) => !stale && setAtt(a))
    return () => {
      stale = true
    }
  }, [type, files])

  const pinSet = useMemo(() => new Set(props.pins), [props.pins])
  /** 梦游（task-m552v）：没收下的可视化挂在它的笔记下面；正在看的这条改了的文件后面一个小点 */
  const dream = useDreamTree()
  /** 用预设的分类（task-wniqx）：关掉时最外层不分组，分类和自己的文件夹一起按名字排 */
  const presets = presetsOn(useLeft())
  const { tree, real, ghosts, attOf, newDirs, keep } = useMemo(() => {
    // PDF › 笔记 › 可视化一层挂一层（task-m552v，shared/files.ts 的 hang）
    const opts = { sort: view.sort, foldersFirst: view.foldersFirst, pinsFirst: view.pinsFirst, pins: pinSet, hang: true, cats: presets, subOf: props.subOf }
    let real = new Map<string, string>()
    let ghosts = new Map<string, string>()
    // 梦游预览里才有的文件夹（要新建的，比如新的一门课）：那一行标「新」
    let newDirs = new Set<string>()
    // 「附件」：树上只有用了附件的笔记（挂在它所在的文件夹下面），每篇的数是它的附件张数
    if (type === 'att') {
      const attOf = new Map((att?.notes ?? []).map((n) => [n.note, n.items]))
      const list: FileEntry[] = (att?.notes ?? []).map((n) => ({ path: n.note, kind: 'md' as const, mtimeMs: files.find((f) => f.path === n.note)?.mtimeMs ?? 0 }))
      const all = buildTree(list, { ...opts, keep: () => true })
      const recount = (ns: TreeNode[]): number => ns.reduce((s, n) => s + (n.kind === 'dir' ? (n.count = recount(n.children)) : (n.count = attOf.get(n.path)?.length ?? 0)), 0)
      recount(all)
      return { tree: filterTree(props.root ? subtree(all, props.root) : all, q), real, ghosts, attOf, newDirs, keep: undefined }
    }
    const keep = type === 'all' ? undefined : (f: FileEntry) => fileType(f, props.noteTypes) === type
    let list = dream.ghosts.length ? [...files, ...dream.ghosts.filter((g) => !files.some((f) => f.path === g.path))] : files
    if (pv) {
      const p = previewFiles(list, pv.moves)
      list = [...p.files, ...p.ghosts.map((g): FileEntry => ({ path: g.from, kind: 'md', mtimeMs: 0 }))]
      real = p.moved
      ghosts = new Map(p.ghosts.map((g) => [g.from, g.to]))
      const had = new Set(files.flatMap((f) => [...ancestors(f.path), ...(f.kind === 'dir' ? [f.path] : [])]))
      newDirs = new Set(p.files.flatMap((f) => ancestors(f.path)).filter((d) => !had.has(d)))
    }
    const all = buildTree(list, { ...opts, keep })
    return { tree: filterTree(props.root ? subtree(all, props.root) : all, q), real, ghosts, attOf: null, newDirs, keep }
  }, [files, dream.ghosts, pv, view.sort, view.foldersFirst, view.pinsFirst, pinSet, type, props.noteTypes, props.root, att, q, presets, props.subOf])
  // 笔记挂在它的 PDF 下面自己一行（task-m552v）：开着的就是它自己那一行
  const activePath = props.activePath

  // 筛了类型（不是「全部」）：装着符合的那几篇的文件夹都展开（CN-104），回到「全部」时回到筛之前的展开。
  // 记在模块里：换到「最近」再回来树是重新挂上的，筛选也是两边共用的
  useEffect(() => {
    if (type === 'all') {
      if (filterOpen.before) setOpen(filterOpen.before)
      filterOpen.before = null
      filterOpen.done = null
      return
    }
    // 找文件的框里有字时树是筛过的：等清空了再算（不然只替命中的几行展开过，记成「展开过了」）
    if (qOn || filterOpen.done === type || !tree.length) return
    const dirs: string[] = []
    let files = 0
    const walk = (ns: TreeNode[]) => {
      for (const n of ns) {
        if (n.kind === 'dir') (dirs.push(n.path), walk(n.children))
        else files++
      }
    }
    walk(tree)
    filterOpen.done = type
    // 符合的太多（筛「文档」时差不多整个库）就不自己展开，免得一下铺开上千行
    if (files > FILTER_OPEN_MAX) return
    if (!filterOpen.before) filterOpen.before = open
    setOpen((o) => new Set([...o, ...dirs]))
  }, [type, tree])

  const openTo = (path: string) =>
    setOpen((o) => {
      // 挂在 PDF、笔记下面的（task-m552v）：一路上收起来的那几行也打开
      const note = files.find((f) => f.vizOf && f.path === path)?.vizOf ?? path
      const shut = [note, files.find((f) => f.note?.path === note)?.path].filter((x): x is string => !!x && o.has('shut:' + x)).map((x) => 'shut:' + x)
      const need = ancestors(path).filter((d) => !o.has(d))
      if (!need.length && !shut.length) return o
      const n = new Set([...o, ...need])
      for (const k of shut) n.delete(k)
      return n
    })
  const scrollTo = (path: string) =>
    requestAnimationFrame(() => treeRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' }))
  // 自动定位当前文件（VS Code 的 Auto Reveal）：切标签时展开到那一篇、滚过去
  useEffect(() => {
    if (!activePath || !view.autoReveal) return
    openTo(activePath)
    scrollTo(activePath)
  }, [activePath, view.autoReveal])
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...open]))
    } catch {
      // 记不住展开了哪些不影响使用
    }
  }, [open])

  const toggle = (p: string) =>
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const openFolder = (p: string) => {
    setPicked(p)
    setOpen((o) => (o.has(p) ? o : new Set([...o, p])))
    props.onOpenFolder(p)
  }

  /** 新建文件夹放在哪：点过的文件夹；没点过就是开着的文件所在的文件夹；都没有是最外层（摘出来的文件夹里是它自己） */
  const isDir = (p: string) => files.some((f) => f.kind === 'dir' && f.path === p)
  const inRoot = (p: string) => !props.root || p === props.root || p.startsWith(props.root + '/')
  const around = activePath && inRoot(activePath) ? (isDir(activePath) ? activePath : folderOfPath(activePath)) : null
  const target = picked ?? around ?? props.root ?? ''
  // ⌘K「新建文件夹」、它的快捷键：在点过的文件夹里（没点过放最外层）原地新建
  useKeyHandler('new-folder', () => (startFolder(target), true))
  const startFolder = (parent: string) => {
    if (parent) setOpen((o) => new Set([...o, parent, ...ancestors(parent)]))
    else setRootOpen(true)
    setMaking(parent)
  }
  const makeFolder = async (parent: string, name: string) => {
    setMaking(null)
    if (!name.trim()) return
    try {
      const f = await window.cnFolder.make(parent, name)
      setPicked(f)
      app().refresh()
      app().notice(t('建好了「{name}」', { name: f }))
    } catch (e) {
      app().notice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  /** 定位当前文件：展开到它那一层，滚过去，一圈外圈 2 秒 */
  const reveal = () => {
    if (!activePath) return app().notice(t('现在没有开着库里的文件'))
    if (!inRoot(activePath)) return app().notice(t('开着的文件不在「{name}」里', { name: props.title }))
    if (type !== 'all') setType('all')
    setRootOpen(true)
    openTo(activePath)
    setRing(new Set([activePath]))
    scrollTo(activePath)
  }
  const setV = (patch: Partial<TreeView>) => setView((v) => ({ ...v, ...patch }))

  // ---------- 选好几个（CN-105） ----------
  /** 现在看得到的行（Shift 连选、Shift ↑↓、框选按这个先后） */
  const order: string[] = []
  const rangeTo = (path: string) => {
    const a = anchor.current && order.includes(anchor.current) ? anchor.current : path
    const i = order.indexOf(a)
    const j = order.indexOf(path)
    cursor.current = path
    setSel(new Set(order.slice(Math.min(i, j), Math.max(i, j) + 1)))
  }
  /** 点一行：Shift 连选、⌘ 加选或去掉（都不打开；⌘ 点从空开始，不把正在看的那篇算进来，照 Obsidian，task-cqia6）；平常的点是打开它、清掉选中。返回 true 表示是选择，不往下做 */
  const pick = (e: React.MouseEvent, path: string): boolean => {
    if (e.shiftKey) {
      e.preventDefault()
      if (!anchor.current) anchor.current = activePath && order.includes(activePath) ? activePath : path
      rangeTo(path)
      return true
    }
    if (e.metaKey) {
      e.preventDefault()
      setSel((s) => {
        const n = new Set(s)
        if (n.has(path)) n.delete(path)
        else n.add(path)
        return n
      })
      anchor.current = path
      cursor.current = path
      return true
    }
    anchor.current = path
    cursor.current = path
    clearSel()
    return false
  }
  const clearSel = () => {
    if (sel.size) setSel(new Set())
  }
  const selList = () => order.filter((p) => sel.has(p))
  /** 选中的这几个交给 AI：右栏 AI 打开，「看得到」写「选中的N个」 */
  const askSel = () => app().askAiFiles(selList().map((p) => ({ path: p, dir: isDir(p) })))
  /** 「移到…」小弹层：贴着 anchor（树里的一行贴在它右边，底部那颗按钮在它上面） */
  const openMover = (paths: string[], anchor: HTMLElement, side?: 'right') =>
    setMover({ paths, ...(paths.length === 1 ? { what: shown(fileName(paths[0]!)) } : {}), dirs: paths.filter(isDir), anchor, ...(side ? { side } : {}) })
  /** 挑好了去哪：一篇、一个文件夹、选中的几个各走各的（和拖进去一样） */
  const moveTo = (paths: string[], folder: string) => {
    if (paths.length > 1) return void app().moveMany(paths, folder).then(() => setSel(new Set()))
    const p = paths[0]!
    void (isDir(p) ? app().moveFolder(p, folder) : app().moveNote(p, folder))
  }
  /** 树里右键的那几项（钉住、移到…）：右键的是哪一行 */
  const treeMenu = (path: string, el: HTMLElement): TreeMenu => ({ moveTo: () => openMover([path], el, 'right') })
  /** 选中的这一组的右键菜单：一次只能对一个的灰掉 */
  const groupMenu = (e: React.MouseEvent) => {
    const paths = selList()
    const el = e.currentTarget as HTMLElement
    void menuAt(e, [
      { label: t('打开'), enabled: false, run: () => undefined },
      // 交给 AI（task-0tgz2，偏好「多选文件能交给 AI」）：和底部那一条的「问AI」一样
      { label: t('问 AI'), ai: 'chat', run: () => askSel() },
      '-',
      { label: t('重命名…'), enabled: false, run: () => undefined },
      { label: t('移到…'), run: () => openMover(paths, el, 'right') },
      { label: t('放到左边'), enabled: false, run: () => undefined },
      '-',
      { label: t('拷贝路径'), run: () => copy(paths.map((p) => app().absPath(p)).join('\n')) },
      '-',
      { label: t('移到废纸篓（{n}个）', { n: paths.length }), accel: accelFor('tree-trash'), run: () => void app().trashMany(paths).then(() => setSel(new Set())) },
    ])
  }
  /** ⌘⌫：删选中的（没选好几个时删现在这一行），和右键「移到废纸篓」同一个确认 */
  const trashSel = (fallback: string | null) => {
    const paths = sel.size ? selList() : fallback ? [fallback] : []
    if (!paths.length) return
    if (paths.length === 1 && isDir(paths[0]!)) return void app().trashFolder(paths[0]!)
    void (paths.length === 1 ? app().trash(paths[0]!) : app().trashMany(paths)).then(() => setSel(new Set()))
  }
  const onTreeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && sel.size) return (e.preventDefault(), clearSel())
    if (isKey(e, 'tree-trash')) {
      e.preventDefault()
      const row = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-sel]')
      return trashSel(row?.dataset.sel ?? null)
    }
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const from = cursor.current && order.includes(cursor.current) ? cursor.current : activePath && order.includes(activePath) ? activePath : order[0]
      if (!from) return
      if (!anchor.current || !order.includes(anchor.current)) anchor.current = from
      const next = order[Math.min(order.length - 1, Math.max(0, order.indexOf(from) + (e.key === 'ArrowDown' ? 1 : -1)))]!
      rangeTo(next)
      treeRef.current?.querySelector<HTMLElement>(`[data-sel="${CSS.escape(next)}"]`)?.focus()
    }
  }
  /** 在空白处按下拖：框选（碰到的行都选上） */
  const startLasso = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-sel], button, input, .ft-pins')) return
    // 焦点放到树上：框完按 Esc 能取消、⌘⌫ 能删（键盘事件要落在树里）
    treeRef.current!.focus({ preventScroll: true })
    const box = treeRef.current!.getBoundingClientRect()
    const x0 = e.clientX - box.left
    const y0 = e.clientY - box.top
    let moved = false
    const base = e.metaKey || e.shiftKey ? new Set(sel) : new Set<string>()
    const move = (ev: MouseEvent) => {
      const b = treeRef.current?.getBoundingClientRect()
      if (!b) return
      const x1 = ev.clientX - b.left
      const y1 = ev.clientY - b.top
      if (!moved && Math.abs(y1 - y0) < 4 && Math.abs(x1 - x0) < 4) return
      moved = true
      setLasso({ x0, y0, x1, y1 })
      const top = Math.min(y0, y1) + b.top
      const bottom = Math.max(y0, y1) + b.top
      const hit = new Set(base)
      for (const el of treeRef.current!.querySelectorAll<HTMLElement>('[data-sel]')) {
        const r = el.getBoundingClientRect()
        if (r.bottom > top && r.top < bottom) hit.add(el.dataset.sel!)
      }
      setSel(hit)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setLasso(null)
      // 只是在空白处点了一下：不再「选着」哪个文件夹，也不再选着好几个
      if (!moved) (setPicked(null), clearSel())
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  /** 每一行都带：⌘⌫ 认这一行是谁（右键对着选中的那一组时，每种行自己的 onContextMenu 里转给 groupMenu） */
  const selProps = (path: string) => ({ 'data-sel': path })
  /** 拖着选中的其中一个：挪的是全部 */
  const dragMany = (e: React.DragEvent, path: string): boolean => {
    if (!many || !sel.has(path)) return false
    e.stopPropagation()
    e.dataTransfer.setData(DRAG_MANY, JSON.stringify(selList()))
    e.dataTransfer.effectAllowed = 'move'
    return true
  }
  /** 文件夹那一行能拖进别的文件夹（普通文件夹、挂在笔记下面的数据库记录文件夹都是） */
  const dirDrag = (path: string) => ({
    draggable: !pv && renaming !== path && type !== 'att',
    onDragStart: (e: React.DragEvent) => {
      if (dragMany(e, path)) return
      e.stopPropagation()
      draggingDir.current = draggedDir = path
      e.dataTransfer.setData(DRAG_DIR, path)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => ((draggingDir.current = draggedDir = null), stopSpring(), setDropOn(null)),
  })

  const newFolderRow = (parent: string, depth: number) => (
    <div key={'new:' + parent} role="treeitem" aria-level={depth + 1} aria-selected={false} className="si ft-row ft-new" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="ft-tw" />
      <Codicon name="folder" size={16} />
      <input
        className="si-rename"
        aria-label={t('新文件夹的名字')}
        autoFocus
        placeholder={t('新文件夹')}
        onBlur={(e) => void makeFolder(parent, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (composing(e)) return
          if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
          if (e.key === 'Escape') (e.preventDefault(), (e.currentTarget.value = ''), e.currentTarget.blur())
        }}
      />
    </div>
  )

  /**
   * 一张附件（附件/ 里的图、文件，或「附件」筛选里笔记下面的那几张）：点一下在访达中显示，双击开用它的那篇。
   * where：名字后面灰字写它在哪个文件夹（「附件」筛选最下面平铺的两组：p1-1.png 这种名字每份 PDF 都有，删之前要看得出是哪份的）
   */
  const attachRow = (path: string, depth: number, note: string | null, bytes?: number, key = path, where?: string) => {
    order.push(path)
    const img = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path)
    return (
      <div
        key={key}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={sel.has(path)}
        tabIndex={-1}
        data-path={path}
        className={'si ft-row ft-att' + (sel.has(path) ? ' sel' : '')}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={path}
        {...selProps(path)}
        onClick={(e) => pick(e, path) || void window.cnMenu.reveal(path)}
        onDoubleClick={() => note && props.onOpen(note)}
        onContextMenu={(e) => {
          if (many && sel.has(path)) return groupMenu(e)
          void menuAt(e, [
            { label: t('在访达中显示'), run: () => void window.cnMenu.reveal(path) },
            { label: t('拷贝路径'), run: () => copy(app().absPath(path)) },
            note && { label: t('打开用它的《{name}》', { name: shown(fileName(note)) }), run: () => props.onOpen(note) },
          ])
        }}
      >
        <span className="ft-tw" />
        {type === 'att' && img ? <img className="ft-thumb" src={imgUrl(path)} alt="" draggable={false} /> : <Codicon name={img ? 'file-media' : 'file'} size={16} />}
        <span className="truncate">
          {fileName(path)}
          {where && (
            <span className="ft-count" style={{ marginLeft: 8 }}>
              {where}
            </span>
          )}
        </span>
        <span className="ft-fl" />
        {bytes !== undefined && <span className="ft-count num">{sizeText(bytes)}</span>}
      </div>
    )
  }

  /**
   * 挂着的子文件左边的线（task-wuv05，偏好「挂着的文件缩进加弯线」）：父文件展开箭头的正下方一条 1px 竖线，
   * 到这一行中间圆角拐到子文件的图标前面（toggle：子文件自己有展开箭头时拐到箭头前面）；不是最后一个的，竖线接着往下；
   * 上面几层没走完的竖线（rails）一路穿过去。线画在行的底色上面，不打断选中、悬停的底色
   */
  const guides = (g: Guide | undefined, depth: number, toggle: boolean) => {
    if (!g) return null
    const pad = 8 + depth * 14
    const end = toggle ? pad - 2 : pad + 16 - 3
    return (
      <span className="ft-guides" aria-hidden>
        {g.rails.map((x) => (
          <i key={x} className="gl-v" style={{ left: x }} />
        ))}
        {!g.last && <i className="gl-v" style={{ left: g.x }} />}
        <i className="gl-e" data-last={g.last ? '1' : '0'} style={{ left: g.x, width: end - g.x }} />
      </span>
    )
  }

  /**
   * 数据库的记录文件夹（task-5yp97「藏之后」）：挂在用它的那篇下面一行——数据库图标 · 名字 · 「N条」，不画箭头（记录不在树里一条条列）；
   * 点开它的首页（每一条都在），右键照文件夹的菜单（重命名…、移到…）；能拖进别的文件夹（库里的链接、数据库块里的路径一起改，
   * 离开了那篇就照普通文件夹画）；不能往里拖笔记（挪进去就成了一条记录，和「移到」里不列它一样）。那篇挪走时它跟着挪（主进程 folder-ops）
   */
  const baseRow = (d: TreeNode, depth: number, g?: Guide) => {
    order.push(d.path)
    const on = activePath === d.path
    const n = d.entry?.base?.records ?? 0
    return (
      <div
        key={'db:' + d.path}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={sel.has(d.path)}
        aria-current={on ? 'page' : undefined}
        tabIndex={-1}
        data-path={d.path}
        className={'si ft-row ft-dbrow' + (g ? ' ft-hg' : '') + (sel.has(d.path) ? ' sel' : '') + (on ? ' on' : '') + (ring?.has(d.path) ? ' ring' : '') + (hit(d.name) ? ' hit' : '')}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={t('{path} · 数据库的{n}条记录（磁盘上是一个文件夹）', { path: d.path, n })}
        {...selProps(d.path)}
        {...dirDrag(d.path)}
        onClick={(e) => pick(e, d.path) || openFolder(d.path)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') openFolder(d.path)
          if (isKey(e, 'rename')) setRenaming(d.path)
        }}
        onContextMenu={(e) => {
          if (many && sel.has(d.path)) return groupMenu(e)
          setPicked(d.path)
          const el = e.currentTarget
          void menuAt(e, folderMenu(d.path, { rename: () => setRenaming(d.path), newFolder: () => startFolder(d.path), look: () => setLook({ folder: d.path, el }), tree: treeMenu(d.path, el) }))
        }}
      >
        {guides(g, depth, false)}
        <span className="ft-tw" />
        <Codicon name="database" size={16} className="ft-db" />
        {renaming === d.path ? <FolderRename folder={d.path} onDone={() => setRenaming(null)} /> : <span className="truncate">{hl(d.name)}</span>}
        <span className="ft-fl" />
        {view.counts && <span className="ft-count num">{t('{n}条', { n, ctx: '目录树' })}</span>}
      </div>
    )
  }

  /** 找文件：名字里命中的那几个字加粗、强调色；这一行算不算命中 */
  const qw = q.trim().toLowerCase()
  const hit = (name: string) => qOn && name.toLowerCase().includes(qw)
  const hl = (name: string): React.ReactNode => {
    const i = qOn ? name.toLowerCase().indexOf(qw) : -1
    if (i < 0) return name
    return (
      <>
        {name.slice(0, i)}
        <b>{name.slice(i, i + qw.length)}</b>
        {name.slice(i + qw.length)}
      </>
    )
  }

  const rows: React.ReactNode[] = []
  const walk = (nodes: TreeNode[], depth: number, dir: string, pageKey = dir, g?: Omit<Guide, 'last'> & { lastAt: number }) => {
    if (making === dir && dir !== '') rows.push(newFolderRow(dir, depth))
    const limit = pages[pageKey] ?? PAGE
    for (const [i, n] of nodes.slice(0, limit).entries()) {
      const pad = { paddingLeft: 8 + depth * 14 }
      if (n.kind === 'dir') {
        const isOpen = qOn || open.has(n.path)
        const fp = n.path === catName('课程') ? coursesProgress(n) : folderProgress(n)
        const on = activePath === n.path
        order.push(n.path)
        rows.push(
          <div
            key={n.path}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={isOpen}
            aria-selected={sel.has(n.path)}
            aria-current={on ? 'page' : undefined}
            tabIndex={-1}
            data-path={n.path}
            className={'si ft-row' + (sel.has(n.path) ? ' sel' : '') + (on ? ' on' : !sel.has(n.path) && picked === n.path ? ' picked' : '') + (ring?.has(n.path) ? ' ring' : '') + (dropOn === n.path ? ' drop' : '') + (hit(n.name) ? ' hit' : '')}
            style={pad}
            title={n.path}
            {...dropProps(n.path, !isOpen)}
            {...selProps(n.path)}
            {...dirDrag(n.path)}
            onClick={(e) => pick(e, n.path) || openFolder(n.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openFolder(n.path)
              if (isKey(e, 'rename')) setRenaming(n.path)
            }}
            onContextMenu={(e) => {
              if (many && sel.has(n.path)) return groupMenu(e)
              setPicked(n.path)
              const el = e.currentTarget
              void menuAt(e, folderMenu(n.path, { rename: () => setRenaming(n.path), newFolder: () => startFolder(n.path), look: () => setLook({ folder: n.path, el }), tree: treeMenu(n.path, el) }))
            }}
          >
            <span
              className="ft-tw"
              role="button"
              aria-label={isOpen ? t('收起 {name}', { name: n.name }) : t('展开 {name}', { name: n.name })}
              onClick={(e) => {
                e.stopPropagation()
                toggle(n.path)
              }}
            >
              <Codicon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
            </span>
            <FolderGlyph folder={n.path} open={isOpen} />
            {renaming === n.path ? <FolderRename folder={n.path} onDone={() => setRenaming(null)} /> : <span className="truncate">{hl(n.name)}</span>}
            {newDirs.has(n.path) && (
              <span className="pv-mark">
                <span className="tag-new" title={t('梦游要新建的文件夹，收下以后才有')}>
                  {t('新')}
                </span>
              </span>
            )}
            <span className="ft-fl" />
            {n.pinned && (
              <span className="ft-pin" aria-label={t('置顶了')}>
                <Codicon name="pinned" size={12} />
              </span>
            )}
            {/* 课程文件夹：问完了几讲 / 一共几讲（一讲都没问完不写）；「课程」这一行是几门课加起来；别的写篇数 */}
            {fp && fp.done > 0 && type !== 'att' ? (
              <span className="ft-meta num">
                {t('{done}/{total}讲', { done: fp.done, total: fp.total })}
              </span>
            ) : (
              view.counts && !qOn && <span className="ft-count num">{n.count}</span>
            )}
          </div>,
        )
        if (isOpen) walk(n.children, depth + 1, n.path)
        else if (making === n.path) rows.push(newFolderRow(n.path, depth + 1))
        continue
      }
      if (isAttach(n.kind)) {
        // 附件/<笔记路径>/ 里的：双击开那篇笔记
        const owner = n.path.startsWith('附件/') ? n.path.slice('附件/'.length, n.path.lastIndexOf('/')) + '.md' : null // 不翻：磁盘上的附件文件夹名
        rows.push(attachRow(n.path, depth, owner && files.some((f) => f.path === owner) ? owner : null, undefined))
        continue
      }
      const ghostTo = ghosts.get(n.path)
      if (ghostTo) {
        rows.push(
          <div key={'ghost:' + n.path} role="treeitem" aria-level={depth + 1} aria-selected={false} className="si ft-row pv-ghost" style={pad} title={t('挪到 {path}', { path: ghostTo })}>
            <span className="ft-tw" />
            <Codicon name="inbox" size={16} />
            <s className="truncate">{shown(n.name)}</s>
            <span className="to truncate">{t('挪到{name}', { name: fileName(folderOfPath(ghostTo)) })}</span>
          </div>,
        )
        continue
      }
      const realPath = real.get(n.path) ?? n.path
      const mark = pv?.preview.marks.get(n.path)
      // 「附件」筛选：笔记一行能展开，下面是它的附件
      const items: AttachItem[] | { path: string; bytes: number }[] | undefined = attOf?.get(n.path)
      const attKey = 'att:' + n.path
      const attOpen = !!items && open.has(attKey)
      // 一个 PDF 一篇笔记：PDF（HTML）和旁边那篇笔记合成一行，右端是笔记里问了几问；点开 PDF，笔记标签跟着开（2026-11-20）
      const note = n.entry?.note
      // 这篇用的数据库的记录文件夹挂在它下面（task-5yp97）：这一行能展开
      const dbs = items ? [] : n.children.filter((c) => c.kind === 'dir')
      const dbKey = 'db:' + n.path
      const dbOpen = dbs.length > 0 && (qOn || open.has(dbKey))
      // PDF › 笔记 › 可视化（task-m552v）：挂在下面的文件默认展开；没收下的可视化（ghost）淡着写「没收下」，点了开报告里那一条
      const kids = items ? [] : n.children.filter((c) => c.kind !== 'dir')
      const kidsOpen = kids.length > 0 && (qOn || !open.has('shut:' + n.path))
      const ghost = n.entry?.dream
      const hasNote = kids.some((k) => k.hung === 'note')
      // 挂在别的文件下面的这一行（task-wuv05）：左边的弯线；它自己挂着东西时，往下传它的竖线
      const mine: Guide | undefined = g ? { x: g.x, rails: g.rails, last: i === g.lastAt } : undefined
      order.push(realPath)
      rows.push(
        <div
          key={n.path}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={sel.has(realPath)}
          aria-current={activePath === realPath ? 'page' : undefined}
          aria-expanded={items ? attOpen : dbs.length ? dbOpen : kids.length ? kidsOpen : undefined}
          tabIndex={-1}
          data-path={realPath}
          className={'si ft-row ft-fit' + (mine || dbOpen || kidsOpen ? ' ft-hg' : '') + (items ? ' att' : '') + (ghost ? ' ghost' : '') + (sel.has(realPath) ? ' sel' : '') + (activePath === realPath ? ' on' : '') + (ring?.has(realPath) ? ' ring' : '') + (hit(shown(n.name)) ? ' hit' : '')}
          style={pad}
          title={
            n.hung === 'viz'
              ? `从笔记「${shown(fileName(n.entry?.vizOf ?? ''))}」做的可视化${ghost ? '，还没收下：点了开梦游报告里那一条' : ''}`
              : n.hung === 'note'
                ? `${shown(n.name)}（挂在它的 PDF 下面）`
                : note
                  ? `${n.kind === 'pdf' ? 'PDF' : 'HTML'} 和它的笔记：点开 ${n.kind === 'pdf' ? 'PDF' : 'HTML'}，笔记跟着在旁边`
                  : n.path
          }
          data-note={note?.path}
          {...selProps(realPath)}
          // 笔记能拖进别的文件夹（松在文件夹那一行上）
          draggable={n.kind === 'md' && !pv && type !== 'att'}
          onDragStart={(e) => dragMany(e, realPath) || ((e.dataTransfer.setData(DRAG_MIME, realPath), (e.dataTransfer.effectAllowed = 'move')))}
          onDragEnd={() => (stopSpring(), setDropOn(null))}
          onClick={(e) => (ghost ? openDream(ghost) : pick(e, realPath) || (setPicked(null), note && !pv ? app().openWithNote(realPath) : props.onOpen(realPath)))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (note && !pv ? app().openWithNote(realPath) : props.onOpen(realPath))
            if (isKey(e, 'rename') && /\.md$/i.test(realPath)) setRenaming(realPath)
          }}
          onContextMenu={(e) =>
            ghost ? e.preventDefault() : many && sel.has(realPath) ? groupMenu(e) : onFileMenu(e, realPath, { rename: () => setRenaming(realPath), ...(note ? { note: note.path } : {}), tree: treeMenu(realPath, e.currentTarget) })
          }
        >
          {guides(mine, depth, items ? false : dbs.length > 0 || kids.length > 0)}
          {(dbOpen || kidsOpen) && <i className="gl-s" aria-hidden style={{ left: 8 + depth * 14 + 6 }} />}
          <span
            className="ft-tw"
            {...(items
              ? {
                  role: 'button',
                  'aria-label': attOpen ? t('收起 {name} 的附件', { name: shown(n.name) }) : t('展开 {name} 的附件', { name: shown(n.name) }),
                  onClick: (e: React.MouseEvent) => (e.stopPropagation(), toggle(attKey)),
                }
              : dbs.length
                ? {
                    role: 'button',
                    'aria-label': dbOpen ? t('收起 {name} 的数据库', { name: shown(n.name) }) : t('展开 {name} 的数据库', { name: shown(n.name) }),
                    onClick: (e: React.MouseEvent) => (e.stopPropagation(), toggle(dbKey)),
                  }
                : kids.length
                  ? {
                      role: 'button',
                      'aria-label': `${kidsOpen ? '收起' : '展开'} ${n.label ?? shown(n.name)}`,
                      onClick: (e: React.MouseEvent) => (e.stopPropagation(), toggle('shut:' + n.path)),
                    }
                  : {})}
          >
            {(items || dbs.length > 0 || kids.length > 0) && <Codicon name={(items ? attOpen : dbs.length ? dbOpen : kidsOpen) ? 'chevron-down' : 'chevron-right'} size={12} />}
          </span>
          {props.boards.has(realPath) ? (
            <i className="sw ft-sw" style={{ background: props.boards.get(realPath) }} />
          ) : (
            <Codicon name={n.hung === 'note' ? 'note' : n.hung === 'viz' ? 'graph' : fileIcon(n.path, false, props.digests.has(n.path))} size={16} />
          )}
          {renaming === realPath ? (
            <RenameInput path={realPath} onDone={() => setRenaming(null)} onRename={props.onRename} />
          ) : (
            <span className="truncate">{hl(n.label ?? shown(n.name))}</span>
          )}
          {/* 正在看的这条梦游改了它（task-m552v） */}
          {dream.touched.has(realPath) && <span className="ft-dd" aria-label="正在看的这条梦游改了它" data-tip="正在看的这条梦游改了它" data-side="right" />}
          {/* PDF、HTML 名字后面一个小标（照 Obsidian）；md 不加（默认状态不加标签）；挂在笔记下面的可视化写「可视化」，没收下的写「没收下」 */}
          {n.hung === 'viz' ? (
            <span className={'ft-tag' + (ghost ? ' acc' : '')}>{ghost ? '没收下' : '可视化'}</span>
          ) : (
            (n.kind === 'pdf' || n.kind === 'html') && <span className="ft-ext">{n.kind === 'pdf' ? 'PDF' : 'HTML'}</span>
          )}
          {mark && pv && <MovedMark m={mark} pv={pv} />}
          <span className="ft-fl" />
          {/* 和网页配成一对（task-kbnc0）：右边一个网页小标，悬停说点开会怎样 */}
          {pairs.has(realPath) && (
            <span className="ft-pair" aria-label={t('和网页配成一对')} data-tip={t('和网页「{name}」配成一对：点开这篇，网页跟着在右栏开到上次读到的那段', { name: bookName(pairs.get(realPath)!) })} data-side="right">
              <Codicon name="globe" size={13} />
            </span>
          )}
          {n.pinned && (
            <span className="ft-pin" aria-label={t('置顶了')}>
              <Codicon name="pinned" size={12} />
            </span>
          )}
          {items && <span className="ft-count num">{`${items.length}张`}</span>}
          {n.hung === 'note' && n.asks ? (
            <span className="ft-q num" data-testid="ft-note" aria-label={`问了${n.asks.n}问${n.asks.sent ? '，都送进Anki了' : ''}`}>
              <Codicon name="comment-discussion" size={13} />
              {n.asks.n}
              {n.asks.sent && <Codicon name="check" size={13} className="ft-sent" />}
            </span>
          ) : hasNote ? (
            // 笔记挂在下面（问了几问在笔记那行）：PDF 这一行右端写问到第几页（DESIGN.md「PDF 右端 3/5」）
            <span className="ft-meta">
              <Progress p={n.entry?.progress} />
            </span>
          ) : note ? (
            <span className="ft-nb num" data-testid="ft-note" aria-label={`笔记里问了${note.asks}问${note.sent ? '，都送进Anki了' : ''}`}>
              <Codicon name="note" size={13} />
              {note.asks}
              {note.sent && <Codicon name="check" size={13} className="ft-sent" />}
            </span>
          ) : (
            n.kind === 'pdf' && (
              <span className="ft-meta">
                <Progress p={n.entry?.progress} />
              </span>
            )
          )}
        </div>,
      )
      // 挂着的（记录文件夹、笔记、可视化、导图、子白板）：竖线从这一行的展开箭头下面伸下去，最后一个拐弯
      const below = { x: 8 + depth * 14 + 6, rails: mine && !mine.last ? [...mine.rails, mine.x] : (mine?.rails ?? []) }
      const nKids = kidsOpen ? kids.length : 0
      if (dbOpen) dbs.forEach((d, j) => rows.push(baseRow(d, depth + 1, { ...below, last: nKids === 0 && j === dbs.length - 1 })))
      if (kidsOpen) walk(kids, depth + 1, '\0' + n.path, 'hang:' + n.path, { ...below, lastAt: Math.min(kids.length, pages['hang:' + n.path] ?? PAGE) - 1 })
      if (items && attOpen) {
        const lim = pages[attKey] ?? ATT_PAGE
        for (const it of items.slice(0, lim)) rows.push(attachRow(it.path, depth + 1, realPath, it.bytes, attKey + '>' + it.path))
        if (items.length > lim)
          rows.push(
            <button key={'more:' + attKey} className="si s-more ft-more" style={{ paddingLeft: 36 + (depth + 1) * 14 }} onClick={() => setPages((p) => ({ ...p, [attKey]: items.length }))}>
              <span className="num">{t('再显示{n}张', { n: items.length - lim })}</span>
            </button>,
          )
      }
    }
    if (nodes.length > limit) {
      rows.push(
        <button key={'more:' + pageKey} className="si s-more ft-more" style={{ paddingLeft: 36 + depth * 14 }} onClick={() => setPages((p) => ({ ...p, [pageKey]: limit + PAGE }))}>
          <span className="num">{t('还有{n}个 · 再显示{more}个', { n: nodes.length - limit, more: Math.min(PAGE, nodes.length - limit) })}</span>
        </button>,
      )
    }
  }
  const total = tree.reduce((s, n) => s + n.count, 0)
  if (props.root) walk(tree, 0, props.root)
  else {
    // 第一行是库本身（CN-104）：最外层挂在它下面，筛选时也一样
    rows.push(
      <div
        key="root"
        role="treeitem"
        aria-level={1}
        aria-expanded={rootOpen || qOn}
        aria-selected={false}
        tabIndex={-1}
        data-path=""
        className={'si ft-row ft-root' + (dropOn === '' ? ' drop' : '')}
        style={{ paddingLeft: 8 }}
        title={props.vaultName}
        {...dropProps('', !rootOpen)}
        onClick={() => setRootOpen((o) => !o)}
        onContextMenu={(e) =>
          void menuAt(e, [
            { label: t('新建笔记'), run: () => app().newNote('') },
            { label: t('新建白板'), run: () => app().newBoard('') },
            { label: t('新建文件夹'), run: () => (setPicked(null), startFolder('')) },
            '-',
            { label: t('在访达中显示'), run: () => void window.cnMenu.reveal('') },
          ])
        }
      >
        <span className="ft-tw">
          <Codicon name={rootOpen || qOn ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
        <Codicon name="library" size={16} />
        <span className="truncate">{props.vaultName}</span>
        <span className="ft-fl" />
        {view.counts && !qOn && <span className="ft-count num">{type === 'att' && att ? total + att.convos.length + att.orphans.length : total}</span>}
      </div>,
    )
    if (rootOpen || qOn) {
      if (making === '') rows.push(newFolderRow('', 1))
      if (qOn && !tree.length)
        rows.push(
          <p key="q-none" className="s-none ft-qnone">
            {t('没有名字里带「{q}」的文件', { q: q.trim() })}
          </p>,
        )
      // 最外层按顶级分类分组：收件箱 | 读进来的 | 自己写的 | 不在分类里的（筛类型、找文件时没有东西的分类不画）；
      // 关掉预设的分类时不分组，空的分类不画（task-wniqx）
      for (const g of topGroups(tree, type === 'all' && !pv && !qOn, presets)) {
        if (g.title)
          rows.push(
            <div key={'gh:' + g.title} className="ft-gh" role="presentation" style={{ paddingLeft: 22 }}>
              <span>{t(g.title)}</span>
              <span className="ln" />
            </div>,
          )
        walk(g.nodes, 1, '', 'top:' + g.title)
      }
      // 「附件」筛选：最下面两组。读 PDF 的完整对话在用、那份 PDF 的笔记已经不在的（对话记录本身不进树，双击这一张打开那份对话）；没有谁在用的。
      // 名字后面写所在的文件夹（附件/ 最外层的不写）
      if (type === 'att' && att) {
        const groups: [string, string, { path: string; bytes: number; convo?: string }[]][] = [
          ['convos', t('完整对话在用的附件'), att.convos],
          ['orphans', t('没有笔记的附件'), att.orphans],
        ]
        for (const [key, title, list] of groups) {
          if (!list.length) continue
          rows.push(
            <div key={'gh:' + key} className="ft-gh" role="presentation" style={{ paddingLeft: 22 }}>
              <span>{title}</span>
              <span className="ln" />
            </div>,
          )
          const lim = pages[key] ?? PAGE
          for (const o of list.slice(0, lim)) {
            const dir = folderOfPath(o.path)
            rows.push(attachRow(o.path, 1, o.convo ?? null, o.bytes, `${key}:${o.path}`, dir.includes('/') ? fileName(dir) : undefined))
          }
          if (list.length > lim)
            rows.push(
              <button key={'more:' + key} className="si s-more ft-more" style={{ paddingLeft: 50 }} onClick={() => setPages((p) => ({ ...p, [key]: lim + PAGE }))}>
                <span className="num">{t('还有{n}张 · 再显示{more}张', { n: list.length - lim, more: Math.min(PAGE, list.length - lim) })}</span>
              </button>,
            )
        }
      }
    }
  }
  const sortNow = TREE_SORTS.find((s) => s.id === view.sort)!
  const selN = sel.size

  /**
   * 树顶「钉住」（task-4891y ①，图上的框 ①）：置顶.json 里的那几样（文件夹写成「写作/」），按钉的先后一行一个，排在库那一行上面；
   * 不展开、不缩进第二层，文件夹后面写篇数；点开、右键和树里那一行一样，能把笔记拖进钉住的文件夹。
   * 筛着类型、找着文件、梦游预览开着、摘出来的文件夹里不画（那时树是筛过的一枝）
   */
  const find = (ns: TreeNode[], path: string): TreeNode | null => {
    for (const n of ns) {
      if (n.path === path) return n
      if (path.startsWith(n.path + '/')) return find(n.children, path)
    }
    return null
  }
  const pinRows =
    props.root || type !== 'all' || qOn || pv
      ? []
      : props.pins.flatMap((key) => {
          const dir = key.endsWith('/')
          const path = dir ? key.slice(0, -1) : key
          const n = find(tree, path)
          if (!n || (n.kind === 'dir') !== dir) return []
          const on = activePath === path
          const go = () => (dir ? openFolder(path) : props.onOpen(path))
          return [
            <div
              key={'pin:' + key}
              role="button"
              tabIndex={0}
              aria-current={on ? 'page' : undefined}
              className={'si ft-row ft-pinrow' + (on ? ' on' : '') + (dropOn === 'pin:' + path ? ' drop' : '')}
              style={{ paddingLeft: 22 }}
              title={path}
              {...(dir ? dropProps(path, false, 'pin:' + path) : {})}
              onClick={go}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              onContextMenu={(e) => {
                const el = e.currentTarget
                if (!dir) return onFileMenu(e, path, { tree: treeMenu(path, el) })
                void menuAt(e, folderMenu(path, { look: () => setLook({ folder: path, el }), tree: treeMenu(path, el) }))
              }}
            >
              <span className="ft-tw" />
              {dir ? <FolderGlyph folder={path} /> : props.boards.has(path) ? <i className="sw ft-sw" style={{ background: props.boards.get(path) }} /> : <Codicon name={fileIcon(path, false, props.digests.has(path))} size={16} />}
              <span className="truncate">{dir ? n.name : shown(n.name)}</span>
              <span className="ft-fl" />
              <span className="ft-pin" aria-label={t('钉住了')}>
                <Codicon name="pinned" size={12} />
              </span>
              {dir && view.counts && <span className="ft-count num">{n.count}</span>}
            </div>,
          ]
        })
  const findKey = K('find-file')

  return (
    <>
      <ViewHead title={props.title}>
        <HeadBtn icon="new-file" label={t('新建笔记')} keys={K('new-note') ?? undefined} onClick={props.onNewNote} />
        <HeadBtn icon="new-folder" label={t('新建文件夹')} keys={target ? t('放进「{name}」', { name: fileName(target) }) : t('放在「{name}」最外层', { name: props.vaultName })} onClick={() => startFolder(target)} />
        <HeadBtn icon="layout" label={t('新建白板')} onClick={props.onNewBoard} />
        <HeadBtn icon="target" label={t('定位当前文件')} onClick={reveal} />
        <HeadBtn icon="sort-precedence" label={t('排序')} keys={`${t(sortNow.label)} · ${t(sortNow.hint)}`} on={!!sortMenu} onClick={(e) => {
          const el = e.currentTarget
          setSortMenu((m) => (m ? null : el))
        }} />
        <HeadBtn icon="collapse-all" label="全部收起" onClick={() => setOpen(new Set())} />
      </ViewHead>
      <TypeChips value={type} onChange={setType} className="side-chips" att />
      {pv && !props.root && <TreeStrip pv={pv} />}
      {/* 找文件的框（task-4891y ②）：类型筛选下面；空着时右边写命令表里的键（⌥⌘F），有字时是一个 ×；esc 清空，回车开第一个命中的，↓ 到树里 */}
      <label className="ft-find">
        <Codicon name="search" size={14} />
        <input
          ref={findRef}
          type="search"
          aria-label={t('找文件')}
          placeholder={t('找文件、文件夹')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (composing(e)) return
            if (e.key === 'Escape') (e.preventDefault(), q ? setQ('') : e.currentTarget.blur())
            if (e.key === 'Enter') (e.preventDefault(), treeRef.current?.querySelector<HTMLElement>('.ft-row.hit')?.click())
            if (e.key === 'ArrowDown') (e.preventDefault(), treeRef.current?.querySelector<HTMLElement>(qOn ? '.ft-row.hit' : '[role=treeitem]')?.focus())
          }}
        />
        {q ? (
          <button className="ft-x" aria-label={t('清空')} onClick={() => (setQ(''), findRef.current?.focus())}>
            <Codicon name="close" size={14} />
          </button>
        ) : (
          findKey && <span className="ft-k">{findKey}</span>
        )}
      </label>
      {sortMenu && (
        <Popover anchor={sortMenu} label={t('排序')} onClose={() => setSortMenu(null)} className="sortpop">
          <div className="mh">{t('排序')}</div>
          {TREE_SORTS.map((s) => (
            <MenuItem key={s.id} icon={view.sort === s.id ? 'check' : undefined} label={t(s.label)} right={t(s.hint)} onClick={() => setV({ sort: s.id })} />
          ))}
          <div className="ms" />
          <MenuItem icon={view.foldersFirst ? 'check' : undefined} label={t('文件夹排在前面')} onClick={() => setV({ foldersFirst: !view.foldersFirst })} />
          <MenuItem icon={view.pinsFirst ? 'check' : undefined} label={t('置顶的排在最前')} onClick={() => setV({ pinsFirst: !view.pinsFirst })} />
          <MenuItem icon={view.counts ? 'check' : undefined} label={t('显示篇数')} onClick={() => setV({ counts: !view.counts })} />
          <div className="ms" />
          <MenuItem icon={view.autoReveal ? 'check' : undefined} label={t('自动定位当前文件')} onClick={() => setV({ autoReveal: !view.autoReveal })} />
          {/* 从用的地方跳到设置（方向 A 的 A3）：文件树头上的菜单最下面一项到设置 › 文件和附件 */}
          <div className="ms" />
          <MenuItem icon="settings-gear" className="go" label={t('新笔记放哪、附件、删除…')} right={<Codicon name="chevron-right" size={12} />} onClick={() => (setSortMenu(null), openSettingsAt('newWhere'))} />
        </Popover>
      )}
      {look && <LookPicker folder={look.folder} anchor={look.el} onClose={() => setLook(null)} />}
      {mover && <MovePicker {...mover} onPick={(f) => moveTo(mover.paths, f)} onClose={() => setMover(null)} />}
      <nav className="nav" aria-label={t('笔记')}>
        <div
          className="ftree"
          role="tree"
          aria-label={props.root ? t('{name} 的文件', { name: props.title }) : t('全部文件')}
          aria-multiselectable
          tabIndex={-1}
          ref={treeRef}
          onKeyDown={onTreeKey}
          // 空白处：点一下就不再「选着」哪个文件夹（新建文件夹放到开着的文件旁边或最外层）；按下拖是框选；右键在这一层新建
          onMouseDown={startLasso}
          onContextMenu={(e) =>
            e.target === e.currentTarget &&
            void menuAt(e, [
              { label: t('新建笔记'), run: () => app().newNote(props.root ?? '') },
              { label: t('新建白板'), run: () => app().newBoard(props.root ?? '') },
              { label: t('新建文件夹'), run: () => (setPicked(null), startFolder(props.root ?? '')) },
            ])
          }
        >
          {pinRows.length > 0 && (
            <div className="ft-pins" role="group" aria-label={t('钉住')}>
              <div className="ft-gh" role="presentation" style={{ paddingLeft: 22 }}>
                <span>{t('钉住')}</span>
                <span className="ln" />
              </div>
              {pinRows}
            </div>
          )}
          {rows}
          {type === 'clip' && <ClipRule />}
          {loaded && !tree.length && making === null && props.root && <p className="s-none">{qOn ? `没有名字里带「${q.trim()}」的文件` : type === 'all' ? '这个文件夹还是空的' : '没有这一类的文件'}</p>}
          {lasso && (
            <div
              className="ft-lasso"
              aria-hidden
              style={{ left: Math.min(lasso.x0, lasso.x1), top: Math.min(lasso.y0, lasso.y1), width: Math.abs(lasso.x1 - lasso.x0), height: Math.abs(lasso.y1 - lasso.y0) }}
            />
          )}
        </div>
      </nav>
      {selN > 1 && (
        <div className="ft-selbar" role="toolbar" aria-label={t('选中的')}>
          <Codicon name="check" size={14} />
          <b className="num">{t('已选{n}个', { n: selN })}</b>
          {/* 「问AI」（task-0tgz2）：前面是 AI 对话那一家的标志（偏好「AI 图标用引擎标志」） */}
          <button className="act" onClick={askSel}>
            <AiIcon job="chat" size={14} />
            {t('问AI')}
          </button>
          {/* 左栏窄（默认 240）放不下三颗带字的：「移到…」「删除」只留图标（名字在 aria-label 和悬停提示里），file-tree.css 的容器查询 */}
          <button
            className="act"
            aria-label={t('移到…')}
            data-tip={t('移到…')}
            data-side="above"
            onClick={(e) => openMover(selList(), e.currentTarget)}
          >
            <Codicon name="folder-opened" size={14} />
            <span className="lb">{t('移到…')}</span>
          </button>
          <button className="act" aria-label={t('删除')} data-tip={t('删除')} data-side="above" onClick={() => trashSel(null)}>
            <Codicon name="trash" size={14} />
            <span className="lb">{t('删除')}</span>
          </button>
        </div>
      )}
    </>
  )
}
