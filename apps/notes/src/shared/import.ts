/** 导入旧笔记：界面和主进程共用的类型（实现在 main/import/，界面在 renderer/importer/） */

export type ImportKind = 'notes' | 'folder'

/** 来源里的一个文件夹（备忘录的文件夹，或 md 文件夹里的子文件夹；'' 是根上那层） */
export interface ImportFolder {
  id: string
  /** 显示的名字 */
  name: string
  /** 从根往下的路径，写进「原文件夹」 */
  path: string
  depth: number
  /** 这个文件夹自己的（不含子文件夹） */
  notes: number
  /** 上了锁的（备忘录），导不了 */
  locked: number
  /** 以前导过的，这次跳过 */
  already: number
  /** 图片和附件 */
  attachments: number
}

export interface ImportScan {
  kind: ImportKind
  /** 收件箱/导入/<来源>/ 里的来源名：备忘录、或者那个文件夹的名字 */
  source: string
  /** 给人看的位置（~ 开头） */
  where: string
  folders: ImportFolder[]
  /** 选的是一个 Obsidian 库（里面有 .obsidian/）：有笔记的文件夹都选上时整个库原样放在最外层（task-wniqx） */
  vault?: boolean
}

/**
 * 这次导的是不是「整个库」（task-wniqx，用户定「整库导入保持原结构」）：Obsidian 库、这次还有东西可导的文件夹全选上了。
 * 是：原来的文件夹原样放在库的最外层、和分类同级；不是：先进 收件箱/导入/<来源>/
 */
export const wholeVault = (scan: ImportScan, picked: ReadonlySet<string> | readonly string[]): boolean => {
  const has = (id: string) => (Array.isArray(picked) ? picked.includes(id) : (picked as ReadonlySet<string>).has(id))
  const todo = scan.folders.filter((f) => f.notes - f.locked - f.already > 0)
  return scan.kind === 'folder' && !!scan.vault && todo.length > 0 && todo.every((f) => has(f.id))
}

export interface ImportResult {
  source: string
  /** 收件箱/导入/<来源>；整个库原样放在最外层时是 '' */
  dir: string
  notes: number
  attachments: number
  bytes: number
  /** 这次的提交；什么都没导进来时是 null */
  commit: string | null
  skipped: { locked: number; already: number }
  /** 没导全的地方，一条一句（「3 张手写只导了图」「2 个附件不在这台 Mac 上」） */
  lost: string[]
}

export type ImportProgress =
  | { phase: 'reading' | 'writing'; done: number; total: number; title?: string }
  | { phase: 'committing'; done: number; total: number }
  | { phase: 'done'; result: ImportResult }
  | { phase: 'failed'; error: string }
  | { phase: 'stopped' }

export interface CnImportApi {
  /** 选来源：备忘录要选一次它的数据文件夹（系统规定读别的软件的数据要人点一下）；md 选一个文件夹。取消了返回 null */
  pick(kind: ImportKind): Promise<ImportScan | null>
  /** 开始导入选中的文件夹（id），在后台跑，进度走 onProgress */
  start(kind: ImportKind, folders: string[]): Promise<void>
  stop(): Promise<void>
  /** 正在导的（关了窗口再开时接上） */
  current(): Promise<ImportProgress | null>
  /** 撤回一次导入：反向提交，返回新的提交号 */
  undo(commit: string): Promise<string>
  onProgress(cb: (p: ImportProgress) => void): () => void
  /** 菜单「文件 › 导入旧笔记…」 */
  onOpen(cb: () => void): () => void
}
