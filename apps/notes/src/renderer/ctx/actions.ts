/**
 * 右键菜单里要用到的整个软件的动作（开标签、右栏开网页、问 AI、通知……）。
 * 菜单分散在编辑器、白板、网页、目录树里，不一层层传 props：App 每次渲染把这些登记在这里。
 */
import type { CodiconName } from '@cn/design'
import type { Clip } from '../../shared/api'
import type { DiffSource } from '../../shared/diff'
import type { Tab } from '../tabs'
import type { NoteDoc } from '../note-doc'
import type { PickItem } from '../ai-pick'

export interface AppActions {
  /** 新标签打开库里的文件（已经开着就切过去）：md、PDF、HTML 按类型开 */
  openFile(path: string): void
  /** 开在后面的新标签（不切过去，开着就不动）：AI 回答里 ⇧⌘点引用（task-3e53q，cite.tsx） */
  openFileBehind(path: string): void
  /** 对比标签（历史里一次提交改了什么）；behind：开在后面的新标签、不切走（AI 回答里 ⇧⌘点 canvas-notes://commit/<号>，task-3e53q） */
  openDiff(src: DiffSource, title: string, behind?: boolean): void
  /** 打开 PDF（开着就切过去）翻到那页，有 rect 时那块闪一下（笔记里的「第 3 页」链接，page-link.ts） */
  openPdfAt(path: string, page: number, rect?: [number, number, number, number]): void
  /** 当前标签换成这一篇（它已经开在别的标签就切过去） */
  openHere(path: string): void
  /** 配好对的笔记只打开笔记，网页不跟着开（右键，task-kbnc0） */
  openNoteOnly(path: string): void
  /** 和右栏这个网页配成一对…（问整本书还是只这一页）、解除配对（task-kbnc0） */
  pairWeb(path: string): void
  unpairWeb(path: string): void
  /** [[双链]]：here = 在当前标签打开 */
  openWikilink(target: string, here?: boolean): void
  /** PDF / HTML 开它的 AI（边读边问） */
  openReading(path: string): void
  /** 目录树里 PDF 和它的笔记那一行：开 PDF，笔记标签没开就开上（「笔记跟着在旁边」） */
  openWithNote(path: string): void
  /** 右栏网页开一个新标签；reuse：已经开着这个网站（网址以它开头）的标签就切过去 */
  openInWeb(url: string, reuse?: string): void
  /**
   * 回到网页那一段（task-6cxtc：笔记里「↩」那种带 #:~:text= 的链接）：右栏网页开到那一页（开着就用它）、滚到那几句、亮 1.6 秒；
   * quote：笔记里引着的全文（比链接里的开头准）
   */
  openWebAt(url: string, quote?: string): void
  /** B 的设置是居中弹窗，要看右栏时先关掉；A 的设置是中间的一个标签，不动 */
  closeSettingsDialog(): void
  /** 中间栏开成宽网页标签 */
  openWide(url: string, title?: string): void
  /** 这段字成为 AI 输入框顶上那一排的第一块引用（src：来源，不给是当前这一页「《文档标题》」），光标在它后面 */
  askAi(text: string, src?: string): void
  /** 打开 AI 对话、直接问这一句（文档里选中小条上那颗「只在 AI 栏答」，task-26nz7） */
  sendAi(text: string): void
  /** 文档里「回到 AI 对话」的链接（task-83vl3）：打开 AI 标签，换到 key 那段对话，滚到那条回答 */
  openChat(key: string, msg: number): void
  /** 左栏选了好几个「问AI」（task-0tgz2）：打开 AI，「看得到」写「选中的N个」，每一轮把它们交给 AI */
  askAiFiles(items: PickItem[]): void
  /** 打开 AI；给了 text 就当场跑这一句（白板、文档操作条的「AI整理」跑 /整理这几张，task-5ryf9） */
  runAi(text?: string): void
  /** icon：提示前面的小图标（比如 info） */
  notice(text: string, icon?: CodiconName): void
  /** 底栏现在说的正是这一句就收掉（数字格「没写进去」，改对或放弃以后，task-cle3x） */
  noticeDrop(text: string): void
  /** 底栏说「…开在后面的标签里了」（AI 回答里 ⇧⌘点，task-3e53q）：切到那个标签（is 认）时这句收掉 */
  noticeBehind(text: string, is: (tab: Tab) => boolean): void
  /** 底栏提示带「撤回」（白板上一次改了两篇：卡拖进另一个标签里的文档） */
  noticeUndo(text: string, run: () => void): void
  /** 底栏提示：前面一个小图标、后面一颗按钮（「看记录」）和「撤回」（数据库自动化跑了、按钮点了） */
  toast(t: { text: string; icon?: CodiconName; act?: { label: string; icon: CodiconName; run(): void }; undo?: () => void }): void
  /** 中间开着的文档（不是白板、不是只读）：剪进文档、插进文档用 */
  doc(): NoteDoc | null
  /** 剪一段：inbox 进收件箱成一张卡，doc 插到中间文档的光标处 */
  clip(c: Clip, to: 'inbox' | 'doc'): Promise<void>
  /** 库里的文件变了（新建、挪、删之后）：左栏、目录树重读 */
  refresh(): void
  newNote(folder: string): Promise<void>
  newBoard(folder: string): Promise<void>
  /** 建 课程/新的课程，开它的首页（「课程」右键「新建一门课」，task-xy89o；同 ⌘K「新建一门课」） */
  newCourse(): Promise<void>
  trash(path: string): Promise<void>
  /** 文件树里选了好几个一起删（CN-105）：一个确认框（有图时带「连同 N 张图」），删完底部能撤回 */
  trashMany(paths: string[]): Promise<void>
  /** 好几个一起挪进 folder（CN-105）：一次提交，链接跟着改 */
  moveMany(paths: string[], folder: string): Promise<void>
  togglePin(path: string, pin: boolean): Promise<void>
  pins(): string[]
  /** 一级文件夹和有首页的文件夹 */
  folders(): string[]
  /** 库里的每个文件夹（「移到」菜单，ctx/move-menu.ts） */
  allFolders(): string[]
  openFolderHome(folder: string): void
  /** 当前标签换成这个文件夹的首页（右键「打开首页」）；已经开着就切过去 */
  openFolderHere(folder: string): void
  /** 文件夹改名（链接、置顶、开着的标签一起换）；出错在底栏说，返回新文件夹或 null */
  renameFolder(folder: string, name: string): Promise<string | null>
  /** 文件夹移到废纸篓：先弹系统确认，里面开着的标签一起关 */
  trashFolder(folder: string): Promise<void>
  /** 文件夹挪进另一个文件夹（链接、置顶、左栏、开着的标签跟着换） */
  moveFolder(folder: string, parent: string): Promise<void>
  /** 文件夹摘到活动栏单独一格，并切到它 */
  putOnLeft(folder: string): void
  /** 从活动栏拿下（文件夹本身不动），底部能撤回 */
  takeOffLeft(folder: string): void
  /** 挪到另一个文件夹（开着的标签跟着换路径） */
  moveNote(path: string, folder: string): Promise<void>
  /** 文件夹首页卡里拖走、右键「移到…」的一份（task-r00en）：PDF 连挂着的笔记、可视化一起走，一次提交，底栏能撤回 */
  moveItem(path: string, folder: string): Promise<void>
  /** 库里的相对路径 → 绝对路径（拷贝路径） */
  absPath(rel: string): string
  /** 中间开「最近删掉的」（目录树最底下那一行，task-5yp97） */
  openTrash(): void
}

let current: AppActions | null = null

export function setAppActions(a: AppActions) {
  current = a
}

export function app(): AppActions {
  if (!current) throw new Error('软件还没准备好')
  return current
}
