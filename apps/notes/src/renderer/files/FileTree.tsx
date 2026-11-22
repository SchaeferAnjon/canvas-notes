import { composing } from '../ime'
import { accelFor, isKey, useKeyHandler, useKeys } from '../keys'
import { Codicon } from '@cn/design'
import { openSettingsAt } from '../settings/jump'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type AttachItem, sizeText } from '../../shared/attach'
import { type AttachIndex, buildTree, type FileEntry, fileName, folderOfPath, folderProgress, isTreeSort, previewFiles, subtree, topGroups, TREE_SORTS, type TreeNode, type TreeSort } from '../../shared/files'
import { MovedMark, type DreamPreview } from '../dream/preview'
import { fileIcon } from '../Palette'
import { Progress } from '../search/QuickOpen'
import { onReveal, setTreePicked, takeReveal, useTrashCount, useVaultFiles } from './store'
import { folderMenu, onFileMenu } from '../ctx/file-menu'
import { copy, menuAt } from '../ctx/menu'
import { moveMenu } from '../ctx/move-menu'
import { app } from '../ctx/actions'
import { AiIcon } from '../engine-logo'
import { FolderRename, RenameInput } from '../note-menu'
import { HeadBtn, MenuItem, Popover, ViewHead } from '../shell/Shell'
import { FolderGlyph, LookPicker } from './look'
import { fileType, TypeChips, type TypeFilter, useSideType } from './type-filter'
import './file-tree.css'
import { bookName, usePairs } from '../read-along/store'

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

/** 目录树里拖着的笔记（库里的相对路径） */
const DRAG_MIME = 'application/x-cn-note'
/** 拖着的是文件夹（和访达一样能拖进别的文件夹） */
const DRAG_DIR = 'application/x-cn-folder'
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
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['课程'])
  } catch {
    return new Set(['课程'])
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
 * 一排类型筛选（全部 / 文档 / 白板 / 剪藏 / 附件），下面是整个库的目录树。
 * 第一行是库本身（库图标 + 库名 + 一共几个，CN-104），最外层挂在它下面：顶级分类按「收件箱 | 读进来的 | 自己写的」分组，
 * 别的文件夹和散文件收在「不在分类里的」；附件/ 也在树里（图是 file-media）。每个文件夹后面是篇数，置顶的有图钉，能有自己的图标和颜色。
 * 点文件夹的名字开它的首页（顺手展开），点箭头只展开；点文件按类型开标签。
 * 选好几个（CN-105，照访达）：Shift 点连选、⌘ 点加选、在空白处按下拖框选、Shift ↑↓ 一行行加；选了两个以上底部浮出「已选 N 个 · 移到… · 删除」，
 * 右键对着这一组，拖着其中一个挪的是全部，⌘⌫ 删（和右键「移到废纸篓」同一个确认）。
 * 「附件」筛选：附件挂在用它的那篇笔记下面，一篇先列 3 张；读 PDF 的完整对话用的图挂在那份 PDF 的笔记下面（PDF 不在了的单列「完整对话在用的附件」），
 * 没有谁在用的放最下面「没有笔记的附件」一组。
 * root：摘到活动栏的文件夹，只画它自己那一枝。梦游预览开着时画成改好以后的样子：挪来的标「新」，原来的位置留划掉的影子。
 */
export function FileTree(props: {
  /** 头上的字：「文件」或摘出来的文件夹的名字 */
  title: string
  root?: string
  /** 树第一行写的库名 */
  vaultName: string
  onNewNote(): void
  onNewBoard(): void
  activePath: string | null
  /** 中间开着的是「最近删掉的」（最底下那一行是正在看的） */
  trashOn?: boolean
  onOpen(path: string): void
  onOpenFolder(path: string): void
  preview?: DreamPreview | null
  onRename(path: string, name: string): void
  /** 白板：路径 → 它自己的颜色（目录树里画颜色方块，不画文档图标） */
  boards: Map<string, string>
  /** md 是哪类（白板、剪藏；没有的是文档），类型筛选用 */
  noteTypes: ReadonlyMap<string, Exclude<TypeFilter, 'all' | 'att'>>
  /** 书摘：图标是 quote（同一篇在哪都是同一个图标） */
  digests: ReadonlySet<string>
  pins: string[]
}) {
  /** 写在界面上的键照命令表（改了跟着变） */
  const K = useKeys()
  const { files, loaded } = useVaultFiles()
  /** 「最近删掉的」有几篇（task-5yp97）：库里的文件变了就重数 */
  const trashN = useTrashCount(files)
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
  /** 拖着一篇笔记或一个文件夹经过的文件夹（松手就挪进去） */
  const [dropOn, setDropOn] = useState<string | null>(null)
  /** 正在拖的文件夹（dragover 时读不到 dataTransfer 里的值，自己记着，不让拖进它自己里面） */
  const draggingDir = useRef<string | null>(null)
  const many = sel.size > 1
  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const types = [...e.dataTransfer.types]
      const dir = types.includes(DRAG_DIR) ? draggingDir.current : null
      if (!types.includes(DRAG_MIME) && !types.includes(DRAG_MANY) && !dir) return
      // 文件夹不能拖进它自己、它里面，拖回原来的上一层也不算
      if (dir && (folder === dir || folder.startsWith(dir + '/') || folderOfPath(dir) === folder)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropOn !== folder) setDropOn(folder)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null) && dropOn === folder) setDropOn(null)
    },
    onDrop: (e: React.DragEvent) => {
      const path = e.dataTransfer.getData(DRAG_MIME)
      const dir = e.dataTransfer.getData(DRAG_DIR)
      const list = e.dataTransfer.getData(DRAG_MANY)
      setDropOn(null)
      draggingDir.current = null
      if (!path && !dir && !list) return
      e.preventDefault()
      e.stopPropagation()
      if (list) {
        const paths = (JSON.parse(list) as string[]).filter((p) => p !== folder && !folder.startsWith(p + '/'))
        if (paths.length) void app().moveMany(paths, folder).then(() => setSel(new Set()))
      } else if (dir) {
        if (folder !== dir && !folder.startsWith(dir + '/') && folderOfPath(dir) !== folder) void app().moveFolder(dir, folder)
      } else if (folderOfPath(path) !== folder) void app().moveNote(path, folder)
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
  const { tree, real, ghosts, attOf, newDirs, keep } = useMemo(() => {
    const opts = { sort: view.sort, foldersFirst: view.foldersFirst, pinsFirst: view.pinsFirst, pins: pinSet }
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
      return { tree: props.root ? subtree(all, props.root) : all, real, ghosts, attOf, newDirs, keep: undefined }
    }
    const keep = type === 'all' ? undefined : (f: FileEntry) => fileType(f, props.noteTypes) === type
    let list = files
    if (pv) {
      const p = previewFiles(files, pv.moves)
      list = [...p.files, ...p.ghosts.map((g): FileEntry => ({ path: g.from, kind: 'md', mtimeMs: 0 }))]
      real = p.moved
      ghosts = new Map(p.ghosts.map((g) => [g.from, g.to]))
      const had = new Set(files.flatMap((f) => [...ancestors(f.path), ...(f.kind === 'dir' ? [f.path] : [])]))
      newDirs = new Set(p.files.flatMap((f) => ancestors(f.path)).filter((d) => !had.has(d)))
    }
    const all = buildTree(list, { ...opts, keep })
    return { tree: props.root ? subtree(all, props.root) : all, real, ghosts, attOf: null, newDirs, keep }
  }, [files, pv, view.sort, view.foldersFirst, view.pinsFirst, pinSet, type, props.noteTypes, props.root, att])
  // 一个 PDF 一篇笔记：开着的是合进 PDF 那一行的笔记（「单独打开笔记」）时，当前的是 PDF 那一行（选中、定位、自动定位都认它）
  const activePath = useMemo(() => {
    const a = props.activePath
    if (!a || type === 'att') return a
    const pdf = files.find((f) => f.note?.path === a && (!keep || keep(f)))
    return pdf ? pdf.path : a
  }, [props.activePath, files, keep, type])

  // 筛了类型（不是「全部」）：装着符合的那几篇的文件夹都展开（CN-104），回到「全部」时回到筛之前的展开。
  // 记在模块里：换到「最近」再回来树是重新挂上的，筛选也是两边共用的
  useEffect(() => {
    if (type === 'all') {
      if (filterOpen.before) setOpen(filterOpen.before)
      filterOpen.before = null
      filterOpen.done = null
      return
    }
    if (filterOpen.done === type || !tree.length) return
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
      const need = ancestors(path).filter((d) => !o.has(d))
      return need.length ? new Set([...o, ...need]) : o
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
      app().notice(`建好了「${f}」`)
    } catch (e) {
      app().notice(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  /** 定位当前文件：展开到它那一层，滚过去，一圈外圈 2 秒 */
  const reveal = () => {
    if (!activePath) return app().notice('现在没有开着库里的文件')
    if (!inRoot(activePath)) return app().notice(`开着的文件不在「${props.title}」里`)
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
  /** 选中的这一组的右键菜单：一次只能对一个的灰掉 */
  const groupMenu = (e: React.MouseEvent) => {
    const paths = selList()
    const dirs = new Set(paths.filter((p) => isDir(p)))
    const targets = moveMenu(app().allFolders(), null, (f) => void app().moveMany(paths, f).then(() => setSel(new Set())), (f) => [...dirs].some((d) => f === d || f.startsWith(d + '/')))
    void menuAt(e, [
      { label: '打开', enabled: false, run: () => undefined },
      // 交给 AI（task-0tgz2，偏好「多选文件能交给 AI」）：和底部那一条的「问AI」一样
      { label: '问 AI', ai: 'chat', run: () => askSel() },
      '-',
      { label: '重命名…', enabled: false, run: () => undefined },
      targets.length > 0 && { label: '移到', submenu: targets },
      { label: '放到左边', enabled: false, run: () => undefined },
      '-',
      { label: '拷贝路径', run: () => copy(paths.map((p) => app().absPath(p)).join('\n')) },
      '-',
      { label: `移到废纸篓（${paths.length}个）`, accel: accelFor('tree-trash'), run: () => void app().trashMany(paths).then(() => setSel(new Set())) },
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
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-sel], button, input')) return
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
      draggingDir.current = path
      e.dataTransfer.setData(DRAG_DIR, path)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => ((draggingDir.current = null), setDropOn(null)),
  })

  const newFolderRow = (parent: string, depth: number) => (
    <div key={'new:' + parent} role="treeitem" aria-level={depth + 1} aria-selected={false} className="si ft-row ft-new" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="ft-tw" />
      <Codicon name="folder" size={16} />
      <input
        className="si-rename"
        aria-label="新文件夹的名字"
        autoFocus
        placeholder="新文件夹"
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
            { label: '在访达中显示', run: () => void window.cnMenu.reveal(path) },
            { label: '拷贝路径', run: () => copy(app().absPath(path)) },
            note && { label: `打开用它的《${shown(fileName(note))}》`, run: () => props.onOpen(note) },
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
   * 数据库的记录文件夹（task-5yp97「藏之后」）：挂在用它的那篇下面一行——数据库图标 · 名字 · 「N条」，不画箭头（记录不在树里一条条列）；
   * 点开它的首页（每一条都在），右键照文件夹的菜单（重命名…、移到…）；能拖进别的文件夹（库里的链接、数据库块里的路径一起改，
   * 离开了那篇就照普通文件夹画）；不能往里拖笔记（挪进去就成了一条记录，和「移到」里不列它一样）。那篇挪走时它跟着挪（主进程 folder-ops）
   */
  const baseRow = (d: TreeNode, depth: number) => {
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
        className={'si ft-row ft-dbrow' + (sel.has(d.path) ? ' sel' : '') + (on ? ' on' : '') + (ring?.has(d.path) ? ' ring' : '')}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={`${d.path} · 数据库的${n}条记录（磁盘上是一个文件夹）`}
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
          void menuAt(e, folderMenu(d.path, { rename: () => setRenaming(d.path), newFolder: () => startFolder(d.path), look: () => setLook({ folder: d.path, el }) }))
        }}
      >
        <span className="ft-tw" />
        <Codicon name="database" size={16} className="ft-db" />
        {renaming === d.path ? <FolderRename folder={d.path} onDone={() => setRenaming(null)} /> : <span className="truncate">{d.name}</span>}
        <span className="ft-fl" />
        {view.counts && <span className="ft-count num">{`${n}条`}</span>}
      </div>
    )
  }

  const rows: React.ReactNode[] = []
  const walk = (nodes: TreeNode[], depth: number, dir: string, pageKey = dir) => {
    if (making === dir && dir !== '') rows.push(newFolderRow(dir, depth))
    const limit = pages[pageKey] ?? PAGE
    for (const [i, n] of nodes.slice(0, limit).entries()) {
      const pad = { paddingLeft: 8 + depth * 14 }
      if (n.kind === 'dir') {
        const isOpen = open.has(n.path)
        const fp = n.path === '课程' ? coursesProgress(n) : folderProgress(n)
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
            className={'si ft-row' + (sel.has(n.path) ? ' sel' : '') + (on ? ' on' : !sel.has(n.path) && picked === n.path ? ' picked' : '') + (ring?.has(n.path) ? ' ring' : '') + (dropOn === n.path ? ' drop' : '')}
            style={pad}
            title={n.path}
            {...dropProps(n.path)}
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
              void menuAt(e, folderMenu(n.path, { rename: () => setRenaming(n.path), newFolder: () => startFolder(n.path), look: () => setLook({ folder: n.path, el }) }))
            }}
          >
            <span
              className="ft-tw"
              role="button"
              aria-label={`${isOpen ? '收起' : '展开'} ${n.name}`}
              onClick={(e) => {
                e.stopPropagation()
                toggle(n.path)
              }}
            >
              <Codicon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
            </span>
            <FolderGlyph folder={n.path} open={isOpen} />
            {renaming === n.path ? <FolderRename folder={n.path} onDone={() => setRenaming(null)} /> : <span className="truncate">{n.name}</span>}
            {newDirs.has(n.path) && (
              <span className="pv-mark">
                <span className="tag-new" title="梦游要新建的文件夹，收下以后才有">
                  新
                </span>
              </span>
            )}
            <span className="ft-fl" />
            {n.pinned && (
              <span className="ft-pin" aria-label="置顶了">
                <Codicon name="pinned" size={12} />
              </span>
            )}
            {/* 课程文件夹：问完了几讲 / 一共几讲（一讲都没问完不写）；「课程」这一行是几门课加起来；别的写篇数 */}
            {fp && fp.done > 0 && type !== 'att' ? (
              <span className="ft-meta num">
                {`${fp.done}/${fp.total}讲`}
              </span>
            ) : (
              view.counts && <span className="ft-count num">{n.count}</span>
            )}
          </div>,
        )
        if (isOpen) walk(n.children, depth + 1, n.path)
        else if (making === n.path) rows.push(newFolderRow(n.path, depth + 1))
        continue
      }
      if (isAttach(n.kind)) {
        // 附件/<笔记路径>/ 里的：双击开那篇笔记
        const owner = n.path.startsWith('附件/') ? n.path.slice('附件/'.length, n.path.lastIndexOf('/')) + '.md' : null
        rows.push(attachRow(n.path, depth, owner && files.some((f) => f.path === owner) ? owner : null, undefined))
        continue
      }
      const ghostTo = ghosts.get(n.path)
      if (ghostTo) {
        rows.push(
          <div key={'ghost:' + n.path} role="treeitem" aria-level={depth + 1} aria-selected={false} className="si ft-row pv-ghost" style={pad} title={`挪到 ${ghostTo}`}>
            <span className="ft-tw" />
            <Codicon name="inbox" size={16} />
            <s className="truncate">{shown(n.name)}</s>
            <span className="to truncate">{`挪到${fileName(folderOfPath(ghostTo))}`}</span>
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
      const dbOpen = dbs.length > 0 && open.has(dbKey)
      order.push(realPath)
      rows.push(
        <div
          key={n.path}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={sel.has(realPath)}
          aria-current={activePath === realPath ? 'page' : undefined}
          aria-expanded={items ? attOpen : dbs.length ? dbOpen : undefined}
          tabIndex={-1}
          data-path={realPath}
          className={'si ft-row ft-fit' + (items ? ' att' : '') + (sel.has(realPath) ? ' sel' : '') + (activePath === realPath ? ' on' : '') + (ring?.has(realPath) ? ' ring' : '')}
          style={pad}
          title={note ? `${n.kind === 'pdf' ? 'PDF' : 'HTML'} 和它的笔记是一行：点开 ${n.kind === 'pdf' ? 'PDF' : 'HTML'}，笔记跟着在旁边` : n.path}
          data-note={note?.path}
          {...selProps(realPath)}
          // 笔记能拖进别的文件夹（松在文件夹那一行上）
          draggable={n.kind === 'md' && !pv && type !== 'att'}
          onDragStart={(e) => dragMany(e, realPath) || ((e.dataTransfer.setData(DRAG_MIME, realPath), (e.dataTransfer.effectAllowed = 'move')))}
          onDragEnd={() => setDropOn(null)}
          onClick={(e) => pick(e, realPath) || (setPicked(null), note && !pv ? app().openWithNote(realPath) : props.onOpen(realPath))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (note && !pv ? app().openWithNote(realPath) : props.onOpen(realPath))
            if (isKey(e, 'rename') && /\.md$/i.test(realPath)) setRenaming(realPath)
          }}
          onContextMenu={(e) => (many && sel.has(realPath) ? groupMenu(e) : onFileMenu(e, realPath, { rename: () => setRenaming(realPath), ...(note ? { note: note.path } : {}) }))}
        >
          <span
            className="ft-tw"
            {...(items
              ? {
                  role: 'button',
                  'aria-label': `${attOpen ? '收起' : '展开'} ${shown(n.name)} 的附件`,
                  onClick: (e: React.MouseEvent) => (e.stopPropagation(), toggle(attKey)),
                }
              : dbs.length
                ? {
                    role: 'button',
                    'aria-label': `${dbOpen ? '收起' : '展开'} ${shown(n.name)} 的数据库`,
                    onClick: (e: React.MouseEvent) => (e.stopPropagation(), toggle(dbKey)),
                  }
                : {})}
          >
            {(items || dbs.length > 0) && <Codicon name={(items ? attOpen : dbOpen) ? 'chevron-down' : 'chevron-right'} size={12} />}
          </span>
          {props.boards.has(realPath) ? <i className="sw ft-sw" style={{ background: props.boards.get(realPath) }} /> : <Codicon name={fileIcon(n.path, false, props.digests.has(n.path))} size={16} />}
          {renaming === realPath ? (
            <RenameInput path={realPath} onDone={() => setRenaming(null)} onRename={props.onRename} />
          ) : (
            <span className="truncate">{shown(n.name)}</span>
          )}
          {/* PDF、HTML 名字后面一个小标（照 Obsidian）；md 不加（默认状态不加标签） */}
          {(n.kind === 'pdf' || n.kind === 'html') && <span className="ft-ext">{n.kind === 'pdf' ? 'PDF' : 'HTML'}</span>}
          {mark && pv && <MovedMark m={mark} pv={pv} />}
          <span className="ft-fl" />
          {/* 和网页配成一对（task-kbnc0）：右边一个网页小标，悬停说点开会怎样 */}
          {pairs.has(realPath) && (
            <span className="ft-pair" aria-label="和网页配成一对" data-tip={`和网页「${bookName(pairs.get(realPath)!)}」配成一对：点开这篇，网页跟着在右栏开到上次读到的那段`} data-side="right">
              <Codicon name="globe" size={13} />
            </span>
          )}
          {n.pinned && (
            <span className="ft-pin" aria-label="置顶了">
              <Codicon name="pinned" size={12} />
            </span>
          )}
          {items && <span className="ft-count num">{`${items.length}张`}</span>}
          {note ? (
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
      if (dbOpen) for (const d of dbs) rows.push(baseRow(d, depth + 1))
      if (items && attOpen) {
        const lim = pages[attKey] ?? ATT_PAGE
        for (const it of items.slice(0, lim)) rows.push(attachRow(it.path, depth + 1, realPath, it.bytes, attKey + '>' + it.path))
        if (items.length > lim)
          rows.push(
            <button key={'more:' + attKey} className="si s-more ft-more" style={{ paddingLeft: 36 + (depth + 1) * 14 }} onClick={() => setPages((p) => ({ ...p, [attKey]: items.length }))}>
              <span className="num">{`再显示${items.length - lim}张`}</span>
            </button>,
          )
      }
    }
    if (nodes.length > limit) {
      rows.push(
        <button key={'more:' + pageKey} className="si s-more ft-more" style={{ paddingLeft: 36 + depth * 14 }} onClick={() => setPages((p) => ({ ...p, [pageKey]: limit + PAGE }))}>
          <span className="num">{`还有${nodes.length - limit}个 · 再显示${Math.min(PAGE, nodes.length - limit)}个`}</span>
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
        aria-expanded={rootOpen}
        aria-selected={false}
        tabIndex={-1}
        data-path=""
        className={'si ft-row ft-root' + (dropOn === '' ? ' drop' : '')}
        style={{ paddingLeft: 8 }}
        title={props.vaultName}
        {...dropProps('')}
        onClick={() => setRootOpen((o) => !o)}
        onContextMenu={(e) =>
          void menuAt(e, [
            { label: '新建笔记', run: () => app().newNote('') },
            { label: '新建白板', run: () => app().newBoard('') },
            { label: '新建文件夹', run: () => (setPicked(null), startFolder('')) },
            '-',
            { label: '在访达中显示', run: () => void window.cnMenu.reveal('') },
          ])
        }
      >
        <span className="ft-tw">
          <Codicon name={rootOpen ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
        <Codicon name="library" size={16} />
        <span className="truncate">{props.vaultName}</span>
        <span className="ft-fl" />
        {view.counts && <span className="ft-count num">{type === 'att' && att ? total + att.convos.length + att.orphans.length : total}</span>}
      </div>,
    )
    if (rootOpen) {
      if (making === '') rows.push(newFolderRow('', 1))
      // 最外层按顶级分类分组：收件箱 | 读进来的 | 自己写的 | 不在分类里的（筛类型时没有东西的分类不画）
      for (const g of topGroups(tree, type === 'all' && !pv)) {
        if (g.title)
          rows.push(
            <div key={'gh:' + g.title} className="ft-gh" role="presentation" style={{ paddingLeft: 22 }}>
              <span>{g.title}</span>
              <span className="ln" />
            </div>,
          )
        walk(g.nodes, 1, '', 'top:' + g.title)
      }
      // 最底下一行「最近删掉的 N」（task-5yp97，用户看图定「只列 30 天」）：点开中间「最近删掉的」，正在看时同别的行一道竖线。
      // 样子同一行文件夹，但它不是库里的文件（不当 treeitem，键盘上下、框选、多选都不算它）
      const trashRow = (
        <div
          key="trash"
          role="button"
          aria-current={props.trashOn ? 'page' : undefined}
          tabIndex={0}
          className={'si ft-row ft-trash' + (props.trashOn ? ' on' : '')}
          style={{ paddingLeft: 22 }}
          title="30天里删掉的，放回去还在原来的文件夹"
          onClick={() => app().openTrash()}
          onKeyDown={(e) => e.key === 'Enter' && app().openTrash()}
        >
          <span className="ft-tw" />
          <Codicon name="trash" size={16} />
          <span className="truncate">最近删掉的</span>
          <span className="ft-fl" />
          {view.counts && !!trashN && <span className="ft-count num">{trashN}</span>}
        </div>
      )
      // 「附件」筛选：最下面两组。读 PDF 的完整对话在用、那份 PDF 的笔记已经不在的（对话记录本身不进树，双击这一张打开那份对话）；没有谁在用的。
      // 名字后面写所在的文件夹（附件/ 最外层的不写）
      if (type === 'att' && att) {
        const groups: [string, string, { path: string; bytes: number; convo?: string }[]][] = [
          ['convos', '完整对话在用的附件', att.convos],
          ['orphans', '没有笔记的附件', att.orphans],
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
                <span className="num">{`还有${list.length - lim}张 · 再显示${Math.min(PAGE, list.length - lim)}张`}</span>
              </button>,
            )
        }
      }
      rows.push(<div key="trash-gap" className="ft-trash-gap" role="presentation" />, trashRow)
    }
  }
  const sortNow = TREE_SORTS.find((s) => s.id === view.sort)!
  const selN = sel.size

  return (
    <>
      <ViewHead title={props.title}>
        <HeadBtn icon="new-file" label="新建笔记" keys={K('new-note') ?? undefined} onClick={props.onNewNote} />
        <HeadBtn icon="new-folder" label="新建文件夹" keys={target ? `放进「${fileName(target)}」` : `放在「${props.vaultName}」最外层`} onClick={() => startFolder(target)} />
        <HeadBtn icon="layout" label="新建白板" onClick={props.onNewBoard} />
        <HeadBtn icon="target" label="定位当前文件" onClick={reveal} />
        <HeadBtn icon="sort-precedence" label="排序" keys={`${sortNow.label} · ${sortNow.hint}`} on={!!sortMenu} onClick={(e) => {
          const el = e.currentTarget
          setSortMenu((m) => (m ? null : el))
        }} />
        <HeadBtn icon="collapse-all" label="全部收起" onClick={() => setOpen(new Set())} />
      </ViewHead>
      <TypeChips value={type} onChange={setType} className="side-chips" att />
      {sortMenu && (
        <Popover anchor={sortMenu} label="排序" onClose={() => setSortMenu(null)} className="sortpop">
          <div className="mh">排序</div>
          {TREE_SORTS.map((s) => (
            <MenuItem key={s.id} icon={view.sort === s.id ? 'check' : undefined} label={s.label} right={s.hint} onClick={() => setV({ sort: s.id })} />
          ))}
          <div className="ms" />
          <MenuItem icon={view.foldersFirst ? 'check' : undefined} label="文件夹排在前面" onClick={() => setV({ foldersFirst: !view.foldersFirst })} />
          <MenuItem icon={view.pinsFirst ? 'check' : undefined} label="置顶的排在最前" onClick={() => setV({ pinsFirst: !view.pinsFirst })} />
          <MenuItem icon={view.counts ? 'check' : undefined} label="显示篇数" onClick={() => setV({ counts: !view.counts })} />
          <div className="ms" />
          <MenuItem icon={view.autoReveal ? 'check' : undefined} label="自动定位当前文件" onClick={() => setV({ autoReveal: !view.autoReveal })} />
          {/* 从用的地方跳到设置（方向 A 的 A3）：文件树头上的菜单最下面一项到设置 › 文件和附件 */}
          <div className="ms" />
          <MenuItem icon="settings-gear" className="go" label="新笔记放哪、附件、删除…" right={<Codicon name="chevron-right" size={12} />} onClick={() => (setSortMenu(null), openSettingsAt('newWhere'))} />
        </Popover>
      )}
      {look && <LookPicker folder={look.folder} anchor={look.el} onClose={() => setLook(null)} />}
      <nav className="nav" aria-label="笔记">
        <div
          className="ftree"
          role="tree"
          aria-label={props.root ? `${props.title} 的文件` : '全部文件'}
          aria-multiselectable
          tabIndex={-1}
          ref={treeRef}
          onKeyDown={onTreeKey}
          // 空白处：点一下就不再「选着」哪个文件夹（新建文件夹放到开着的文件旁边或最外层）；按下拖是框选；右键在这一层新建
          onMouseDown={startLasso}
          onContextMenu={(e) =>
            e.target === e.currentTarget &&
            void menuAt(e, [
              { label: '新建笔记', run: () => app().newNote(props.root ?? '') },
              { label: '新建白板', run: () => app().newBoard(props.root ?? '') },
              { label: '新建文件夹', run: () => (setPicked(null), startFolder(props.root ?? '')) },
            ])
          }
        >
          {rows}
          {loaded && !tree.length && making === null && props.root && <p className="s-none">{type === 'all' ? '这个文件夹还是空的' : '没有这一类的文件'}</p>}
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
        <div className="ft-selbar" role="toolbar" aria-label="选中的">
          <Codicon name="check" size={14} />
          <b className="num">{`已选${selN}个`}</b>
          {/* 「问AI」（task-0tgz2）：前面是 AI 对话那一家的标志（偏好「AI 图标用引擎标志」） */}
          <button className="act" onClick={askSel}>
            <AiIcon job="chat" size={14} />
            问AI
          </button>
          {/* 左栏窄（默认 240）放不下三颗带字的：「移到…」「删除」只留图标（名字在 aria-label 和悬停提示里），file-tree.css 的容器查询 */}
          <button
            className="act"
            aria-label="移到…"
            data-tip="移到…"
            data-side="above"
            onClick={(e) => {
              const paths = selList()
              const dirs = paths.filter((p) => isDir(p))
              void menuAt(e, moveMenu(app().allFolders(), null, (f) => void app().moveMany(paths, f).then(() => setSel(new Set())), (f) => dirs.some((d) => f === d || f.startsWith(d + '/'))))
            }}
          >
            <Codicon name="folder-opened" size={14} />
            <span className="lb">移到…</span>
          </button>
          <button className="act" aria-label="删除" data-tip="删除" data-side="above" onClick={() => trashSel(null)}>
            <Codicon name="trash" size={14} />
            <span className="lb">删除</span>
          </button>
        </div>
      )}
    </>
  )
}
