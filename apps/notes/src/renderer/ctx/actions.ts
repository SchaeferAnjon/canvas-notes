/**
 * 右键菜单里要用到的整个软件的动作（开标签、右栏开网页、问 AI、通知……）。
 * 菜单分散在编辑器、白板、网页、目录树里，不一层层传 props：App 每次渲染把这些登记在这里。
 */
import type { Clip } from '../../shared/api'
import type { NoteDoc } from '../note-doc'

export interface AppActions {
  /** 新标签打开库里的文件（已经开着就切过去）：md、PDF、HTML 按类型开 */
  openFile(path: string): void
  /** 当前标签换成这一篇（它已经开在别的标签就切过去） */
  openHere(path: string): void
  /** [[双链]]：here = 在当前标签打开 */
  openWikilink(target: string, here?: boolean): void
  /** PDF / HTML 在右栏下格开它的 AI（边读边问） */
  openReading(path: string): void
  /** 右栏网页开一个新标签 */
  openInWeb(url: string): void
  /** 中间栏开成宽网页标签 */
  openWide(url: string, title?: string): void
  /** 这段字作为引文放进 AI 输入框 */
  askAi(text: string): void
  notice(text: string): void
  /** 中间开着的文档（不是白板、不是只读）：剪进文档、插进文档用 */
  doc(): NoteDoc | null
  /** 剪一段：inbox 进收件箱成一张卡，doc 插到中间文档的光标处 */
  clip(c: Clip, to: 'inbox' | 'doc'): Promise<void>
  /** 库里的文件变了（新建、挪、删之后）：左栏、目录树重读 */
  refresh(): void
  newNote(folder: string): Promise<void>
  newBoard(folder: string): Promise<void>
  trash(path: string): Promise<void>
  togglePin(path: string, pin: boolean): Promise<void>
  pins(): string[]
  /** 一级文件夹（「移到」子菜单） */
  folders(): string[]
  /** 有首页的文件夹 */
  hasFolderHome(folder: string): boolean
  openFolderHome(folder: string): void
  /** 挪到另一个文件夹（开着的标签跟着换路径） */
  moveNote(path: string, folder: string): Promise<void>
  /** 库里的相对路径 → 绝对路径（拷贝路径） */
  absPath(rel: string): string
}

let current: AppActions | null = null

export function setAppActions(a: AppActions) {
  current = a
}

export function app(): AppActions {
  if (!current) throw new Error('软件还没准备好')
  return current
}
