/**
 * 库里的全部文件（⌘O 按名字跳、左栏「全部文件」目录树用）：md、PDF、HTML 和文件夹。
 * 纯计算（按名字筛、排序、拼成树）放这里，界面和单元测试都用。
 */

export type FileKind = 'md' | 'pdf' | 'html' | 'dir'

export interface FileEntry {
  /** 相对库根目录，用 / 分隔 */
  path: string
  kind: FileKind
  mtimeMs: number
  /** PDF 问到第几页（旁边笔记的属性「进度」：问过的最大页码 / 一共几页） */
  progress?: { asked: number; pages: number }
  /** HTML（做好的可视化）属于第几讲：<head> 里 <meta name="第几讲">，目录树里排在那一讲后面 */
  lecture?: number
}

export interface CnFilesApi {
  all(): Promise<FileEntry[]>
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
}

const KIND_ORDER: Record<FileKind, number> = { dir: 0, pdf: 1, md: 2, html: 3 }
/** 顶层分类按这个先后，别的文件夹按名字排在后面 */
export const TOP_ORDER = ['课程', '项目', '生活', '写作', '素材', '收件箱']

/** 一门课里放在最上面的两篇（考前看的） */
const PINNED = ['我的疑惑.md', '术语表.md']

/** 「第3讲 xx」「第 12 讲」这种按数字排，不按字 */
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/**
 * 拼成树：文件夹在前；课程文件夹里同一讲的课件、笔记、可视化挨着（按名字排，数字按大小）；
 * 顶层按 课程 / 项目 / 生活 / 写作 / 素材 / 收件箱 排。文件夹本身不在列表里也会补出来。
 */
export function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { path: '', name: '', kind: 'dir', children: [] }
  const dirs = new Map<string, TreeNode>([['', root]])
  const dirOf = (path: string): TreeNode => {
    const hit = dirs.get(path)
    if (hit) return hit
    const parent = dirOf(folderOfPath(path))
    const node: TreeNode = { path, name: fileName(path), kind: 'dir', children: [] }
    parent.children.push(node)
    dirs.set(path, node)
    return node
  }
  for (const f of files) {
    if (f.kind === 'dir') {
      const d = dirOf(f.path)
      d.entry = f
    } else dirOf(folderOfPath(f.path)).children.push({ path: f.path, name: fileName(f.path), kind: f.kind, entry: f, children: [] })
  }
  const sort = (n: TreeNode, top: boolean) => {
    n.children.sort((a, b) => {
      if (a.kind === 'dir' && b.kind === 'dir' && top) {
        const ia = TOP_ORDER.indexOf(a.name)
        const ib = TOP_ORDER.indexOf(b.name)
        if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      }
      if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1
      const pa = PINNED.indexOf(a.name)
      const pb = PINNED.indexOf(b.name)
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
      // 一门课里按讲次排，同一讲 课件 → 笔记 → 可视化；不是哪一讲的排在后面
      if (a.kind !== 'dir') {
        const la = lectureOfNode(a)
        const lb = lectureOfNode(b)
        if (la !== lb) return (la ?? Infinity) - (lb ?? Infinity)
        if (la !== undefined && a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      }
      return collator.compare(stem(a.name), stem(b.name)) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    })
    for (const c of n.children) if (c.kind === 'dir') sort(c, false)
  }
  sort(root, true)
  return root.children
}

const stem = (name: string) => name.replace(/\.(md|pdf|html?)$/i, '')

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

/** 有首页的文件夹：课程/<课>、项目/<项目>、生活、写作（点名字开首页，点箭头只展开） */
export const hasFolderHome = (path: string) => /^(课程|项目)\/[^/]+$/.test(path) || path === '生活' || path === '写作'
