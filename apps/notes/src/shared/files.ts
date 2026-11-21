/**
 * 库里的全部文件（⌘O 按名字跳、左栏「全部文件」目录树用）：md、PDF、HTML、附件/ 里的图和文件夹。
 * 纯计算（按名字筛、排序、拼成树）放这里，界面和单元测试都用。
 */
import { CATEGORIES, CATEGORY_GROUPS, CATEGORY_NAMES, type CategoryGroup, categoryRank, isCategory } from './categories'

/** img：附件/ 里的图片；att：附件/ 里别的文件（附件文件夹在树里看得到，CN-104、four-items 1a） */
export type FileKind = 'md' | 'pdf' | 'html' | 'img' | 'att' | 'dir'

export interface FileEntry {
  /** 相对库根目录，用 / 分隔 */
  path: string
  kind: FileKind
  mtimeMs: number
  /** 建文件的时间（目录树「按创建时间」排） */
  ctimeMs?: number
  /** PDF 问到第几页（旁边笔记的属性「进度」：问过的最大页码 / 一共几页） */
  progress?: { asked: number; pages: number }
  /** HTML（做好的可视化）属于第几讲：<head> 里 <meta name="第几讲">，目录树里排在那一讲后面 */
  lecture?: number
  /**
   * PDF、HTML 旁边那篇读 PDF 笔记（「<名字> 笔记.md」，一个 PDF 一篇，2026-11-20）和里面问了几问（主问题 + 旁支问题）：
   * 目录树里 PDF 和它的笔记合成一行，笔记不单独列
   */
  note?: { path: string; asks: number }
  /** 附件（img、att）：多大，字节 */
  bytes?: number
}

/** 附件/ 里的文件：图片、别的附件 */
export const isAttachKind = (k: FileKind) => k === 'img' || k === 'att'

/**
 * 「附件」筛选（CN-104）：每篇笔记用到哪些附件、没有谁在用的附件。
 * 读 PDF 的完整对话（.canvas-notes/对话/）用的图挂在那份 PDF 的笔记下面；PDF 或它的笔记不在了的放 convos（「完整对话在用的附件」一组）
 */
export interface AttachIndex {
  notes: { note: string; items: { path: string; bytes: number }[] }[]
  /** convo：用它的那份完整对话（双击打开） */
  convos: { path: string; bytes: number; convo: string }[]
  orphans: { path: string; bytes: number }[]
}

export interface CnFilesApi {
  all(): Promise<FileEntry[]>
  /** 只在选了「附件」筛选时读（要读全库的笔记） */
  attachments(): Promise<AttachIndex>
}


export const fileName = (p: string) => p.split('/').pop() ?? p
export const folderOfPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** 「进度: 5/10」→ { asked: 5, pages: 10 } */
export function parseProgress(v: string | undefined): FileEntry['progress'] {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(v ?? '')
  return m ? { asked: Number(m[1]), pages: Number(m[2]) } : undefined
}

export const progressDone = (p: FileEntry['progress']) => !!p && p.pages > 0 && p.asked >= p.pages

/**
 * ⌘O 的筛法（像 Obsidian 的 Quick Switcher）：名字里连着有这几个字的最前（开头就是的更前），
 * 再是按顺序都出现的，再是字都出现的（不管顺序）；空格分开的几段都要有。同一档里名字短的、新改的在前。
 */
export function matchFiles<T extends { path: string; mtimeMs: number }>(files: T[], q: string, limit = 50): { items: T[]; more: number } {
  const parts = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!parts.length) return { items: files.slice(0, limit), more: Math.max(0, files.length - limit) }
  const scored: { f: T; s: number }[] = []
  for (const f of files) {
    const name = fileName(f.path).toLowerCase()
    const full = f.path.toLowerCase()
    let s = 0
    for (const p of parts) {
      let one: number
      if (name.startsWith(p)) one = 4
      else if (name.includes(p)) one = 3
      else if (inOrder(name, p)) one = 2
      else if ([...p].every((ch) => name.includes(ch))) one = 1
      else if (full.includes(p)) one = 0.5
      else {
        s = -1
        break
      }
      s += one
    }
    if (s > 0) scored.push({ f, s })
  }
  scored.sort((a, b) => b.s - a.s || fileName(a.f.path).length - fileName(b.f.path).length || b.f.mtimeMs - a.f.mtimeMs)
  return { items: scored.slice(0, limit).map((x) => x.f), more: Math.max(0, scored.length - limit) }
}

function inOrder(name: string, p: string): boolean {
  let i = 0
  for (const ch of p) {
    i = name.indexOf(ch, i)
    if (i === -1) return false
    i += ch.length
  }
  return true
}

/** 目录树的一个节点 */
export interface TreeNode {
  path: string
  name: string
  kind: FileKind
  entry?: FileEntry
  children: TreeNode[]
  /** 里面（含子文件夹）有几个文件（筛过类型以后的）；文件是 1 */
  count: number
  /** 排序用的时间：文件是它的修改 / 创建时间，文件夹是里面最新的那个 */
  time: number
  /** 置顶了（笔记写在置顶.json 里，文件夹写成「写作/」） */
  pinned?: boolean
}

const KIND_ORDER: Record<FileKind, number> = { dir: 0, pdf: 1, md: 2, html: 3, img: 4, att: 5 }
/** 顶层分类按这个先后（shared/categories.ts 的顺序），别的文件夹按名字排在后面 */
export const TOP_ORDER: readonly string[] = CATEGORY_NAMES

/** 一门课里放在最上面的几篇（考前看的）。「我的疑惑」「视频里的疑惑」2026-11-20 起不再是软件汇总的文件，不放最上 */
const PINNED = ['术语表.md']

/** 「第3讲 xx」「第 12 讲」这种按数字排，不按字 */
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** 目录树的六种排法（照 Obsidian 的排序菜单）：修改时间、创建时间、名字，各有正反 */
export type TreeSort = 'mtime-desc' | 'mtime-asc' | 'ctime-desc' | 'ctime-asc' | 'name-asc' | 'name-desc'
export const TREE_SORTS: { id: TreeSort; label: string; hint: string }[] = [
  { id: 'mtime-desc', label: '修改时间', hint: '新的在前' },
  { id: 'mtime-asc', label: '修改时间', hint: '旧的在前' },
  { id: 'ctime-desc', label: '创建时间', hint: '新的在前' },
  { id: 'ctime-asc', label: '创建时间', hint: '旧的在前' },
  { id: 'name-asc', label: '名字', hint: 'A → Z' },
  { id: 'name-desc', label: '名字', hint: 'Z → A' },
]
export const isTreeSort = (v: unknown): v is TreeSort => TREE_SORTS.some((s) => s.id === v)

export interface TreeOpts {
  sort: TreeSort
  /** 文件夹排在前面 */
  foldersFirst: boolean
  /** 置顶的排在最前 */
  pinsFirst: boolean
  /** 置顶了的路径（文件夹带 /） */
  pins: ReadonlySet<string>
  /** 类型筛选：只留这些文件；留不下文件的文件夹也不画。不给 = 全部（空文件夹也画） */
  keep?: (f: FileEntry) => boolean
}
export const DEFAULT_TREE_OPTS: TreeOpts = { sort: 'name-asc', foldersFirst: true, pinsFirst: true, pins: new Set() }

/**
 * 拼成树：文件夹在前（可关）；置顶的在最前（可关）；按名字排时课程文件夹里同一讲的课件、笔记、可视化挨着（数字按大小），
 * 顶层按 课程 / 项目 / 生活 / 写作 / 素材 / 收件箱 排；按时间排时文件夹算里面最新的那个。
 * 文件夹本身不在列表里也会补出来（不筛类型时空文件夹也画）。每个节点记着里面有几个文件。
 */
export function buildTree(files: FileEntry[], opts: Partial<TreeOpts> = {}): TreeNode[] {
  const o = { ...DEFAULT_TREE_OPTS, ...opts }
  const byTime = !o.sort.startsWith('name')
  const ctime = o.sort.startsWith('ctime')
  const root: TreeNode = { path: '', name: '', kind: 'dir', children: [], count: 0, time: 0 }
  const dirs = new Map<string, TreeNode>([['', root]])
  // 一个 PDF 一篇笔记：PDF（HTML）在树里时，它旁边那篇笔记不单独列（合成 PDF 那一行）；PDF 被筛掉时笔记照旧单独一行
  const merged = new Set(files.flatMap((f) => (f.note && (f.kind === 'pdf' || f.kind === 'html') && (!o.keep || o.keep(f)) ? [f.note.path] : [])))
  const dirOf = (path: string): TreeNode => {
    const hit = dirs.get(path)
    if (hit) return hit
    const parent = dirOf(folderOfPath(path))
    const node: TreeNode = { path, name: fileName(path), kind: 'dir', children: [], count: 0, time: 0 }
    parent.children.push(node)
    dirs.set(path, node)
    return node
  }
  for (const f of files) {
    if (f.kind === 'dir') {
      if (o.keep) continue
      const d = dirOf(f.path)
      d.entry = f
      continue
    }
    if (o.keep && !o.keep(f)) continue
    if (merged.has(f.path)) continue
    const time = ctime ? (f.ctimeMs ?? f.mtimeMs) : f.mtimeMs
    dirOf(folderOfPath(f.path)).children.push({ path: f.path, name: fileName(f.path), kind: f.kind, entry: f, children: [], count: 1, time })
  }
  if (o.keep) for (const f of files) if (f.kind === 'dir' && dirs.has(f.path)) dirs.get(f.path)!.entry = f
  const desc = o.sort.endsWith('desc')
  const finish = (n: TreeNode, top: boolean) => {
    for (const c of n.children) {
      c.pinned = o.pins.has(c.kind === 'dir' ? c.path + '/' : c.path)
      if (c.kind === 'dir') finish(c, false)
    }
    n.count = n.children.reduce((s, c) => s + c.count, 0)
    n.time = n.children.reduce((m, c) => Math.max(m, c.time), n.entry?.mtimeMs ?? 0)
    n.children.sort((a, b) => {
      if (o.pinsFirst && !!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      if (o.foldersFirst && (a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1
      if (byTime) {
        if (a.time !== b.time) return desc ? b.time - a.time : a.time - b.time
        return collator.compare(stem(a.name), stem(b.name))
      }
      if (desc) return collator.compare(stem(b.name), stem(a.name)) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      if (a.kind === 'dir' && b.kind === 'dir' && top) {
        const ia = TOP_ORDER.indexOf(a.name)
        const ib = TOP_ORDER.indexOf(b.name)
        if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      }
      const pa = PINNED.indexOf(a.name)
      const pb = PINNED.indexOf(b.name)
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
      // 一门课里按讲次排，同一讲 课件 → 笔记 → 可视化；不是哪一讲的排在后面
      if (a.kind !== 'dir' && b.kind !== 'dir') {
        const la = lectureOfNode(a)
        const lb = lectureOfNode(b)
        if (la !== lb) return (la ?? Infinity) - (lb ?? Infinity)
        if (la !== undefined && a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      }
      return collator.compare(stem(a.name), stem(b.name)) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    })
  }
  finish(root, true)
  return root.children
}

/** 树里找到某个文件夹那一枝（摘到活动栏的文件夹，左栏只画它自己的树） */
export function subtree(nodes: TreeNode[], folder: string): TreeNode[] {
  let list = nodes
  for (const seg of folder.split('/')) {
    const hit = list.find((n) => n.kind === 'dir' && n.name === seg)
    if (!hit) return []
    list = hit.children
  }
  return list
}

const stem = (name: string) => name.replace(/\.(md|pdf|html?)$/i, '')

/** 文件树最外层的一组：收件箱（没有组名）、读进来的、自己写的、不在分类里的 */
export interface TopGroup {
  /** 组名（收件箱那一组是空的，不画组头） */
  title: CategoryGroup | '不在分类里的'
  nodes: TreeNode[]
}

/**
 * 文件树最外层按顶级分类分组（2026-11-18 方案 3「分两组」）：分类按分类表的先后，库里还没有这个文件夹的
 * 也画一行空的（all：没筛类型时）；别的文件夹和散文件收在最后一组「不在分类里的」，按原来的排法。空的组不出现。
 */
export function topGroups(nodes: TreeNode[], all: boolean): TopGroup[] {
  const byName = new Map(nodes.filter((n) => n.kind === 'dir' && isCategory(n.name)).map((n) => [n.name, n]))
  const out: TopGroup[] = CATEGORY_GROUPS.map((g) => ({
    title: g,
    nodes: CATEGORIES.filter((c) => c.group === g)
      .map((c) => byName.get(c.name) ?? (all ? { path: c.name, name: c.name, kind: 'dir' as const, children: [], count: 0, time: 0 } : null))
      .filter((n): n is TreeNode => !!n)
      .sort((a, b) => categoryRank(a.name) - categoryRank(b.name)),
  }))
  out.push({ title: '不在分类里的', nodes: nodes.filter((n) => !(n.kind === 'dir' && isCategory(n.name))) })
  return out.filter((g) => g.nodes.length)
}

/** 第几讲：名字里的「第3讲」，HTML 还看它自己写的 */
function lectureOfNode(n: TreeNode): number | undefined {
  if (n.entry?.lecture !== undefined) return n.entry.lecture
  const m = /第\s*(\d+)\s*讲/.exec(n.name)
  return m ? Number(m[1]) : undefined
}

/** 一个文件夹里的课件问完了几份 / 一共几份（只算直接在里面的 PDF），没有 PDF 是 null */
export function folderProgress(node: TreeNode): { done: number; total: number } | null {
  const pdfs = node.children.filter((c) => c.kind === 'pdf')
  if (!pdfs.length) return null
  return { done: pdfs.filter((p) => progressDone(p.entry?.progress)).length, total: pdfs.length }
}

/** 梦游预览：还没收下的「归类和改名」先按改好以后的路径画；moved 是新路径 → 原路径，ghosts 是原来位置留的影子 */
export function previewFiles(files: FileEntry[], moves: { from: string; to: string }[]): { files: FileEntry[]; moved: Map<string, string>; ghosts: { from: string; to: string }[] } {
  const byFrom = new Map(moves.map((m) => [m.from, m]))
  const moved = new Map<string, string>()
  const out = files.map((f) => {
    const m = byFrom.get(f.path)
    if (!m) return f
    moved.set(m.to, m.from)
    return { ...f, path: m.to }
  })
  return { files: out, moved, ghosts: moves.filter((m) => moved.has(m.to)) }
}

/** 最外层这几个是软件自带的分类（附件放图），不改名、不挪、不删 */
export const fixedFolder = (folder: string) => !folder.includes('/') && (isCategory(folder) || folder === '附件')
