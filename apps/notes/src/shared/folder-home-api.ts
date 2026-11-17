/** 文件夹首页的接口：preload 暴露成 window.cnFolder（实现在 main/folder-home.ts） */
import type { FolderEntry, FolderHome, PropFile } from './folder-home'
import type { LeftConfig } from './left'

export interface CnFolderApi {
  /** saved：这页自己存过；template：没存过、用的是模板 */
  get(folder: string): Promise<{ home: FolderHome; saved: boolean; template: boolean }>
  set(folder: string, home: FolderHome): Promise<FolderHome>
  /** 恢复默认（有模板用模板） */
  reset(folder: string): Promise<FolderHome>
  /** 设为模板：返回模板文件的路径 */
  setTemplate(folder: string): Promise<string>
  /** 文件和属性（scope 是 vault 时整个库） */
  files(folder: string, scope: 'folder' | 'vault'): Promise<PropFile[]>
  /** 库里有首页的文件夹（课程/<课>、项目/<项目>、生活、写作），带各自的图标和颜色 */
  list(): Promise<FolderEntry[]>
  /** 新建一门课 / 一个项目，名字重了加序号，返回文件夹 */
  create(folder: string): Promise<string>
  /** 任何文件夹改名（最外层的课程、生活这些固定的除外）：库里写着旧路径的链接、置顶一起改，一次提交；返回新文件夹 */
  rename(folder: string, name: string): Promise<string>
  /** 从访达拖进来的文件在本机的路径（拖放的 File 换成路径） */
  pathOf(file: File): string
  /** 课件进度：拷 PDF 进这门课的文件夹（不是 PDF 的不收），返回拷进来的库里路径 */
  /** already：这门课里已经有一模一样的那几份（库里的路径），没再拷 */
  importPdfs(folder: string, paths: string[]): Promise<{ added: string[]; skipped: string[]; already: string[] }>
  /** 撤回刚拷进来的 */
  unimportPdfs(paths: string[]): Promise<void>
  /** 课件封面：存过就给网址，没存过 null */
  thumb(path: string, mtimeMs: number): Promise<string | null>
  /** 存一张画好的封面，给网址 */
  putThumb(path: string, mtimeMs: number, png: Uint8Array): Promise<string>
  /** 在 parent（'' 是库的最外层）里新建文件夹，放 .gitkeep 并提交；名字重了加序号，返回新文件夹 */
  make(parent: string, name: string): Promise<string>
  /** 文件夹挪进另一个文件夹（'' 是库的最外层）：链接、置顶、左栏跟着换，一次提交；返回新文件夹 */
  move(folder: string, parent: string): Promise<string>
  /** 左栏摘了哪些文件夹、文件夹的图标和颜色（.canvas-notes/左栏.json） */
  left(): Promise<LeftConfig>
  setLeft(c: LeftConfig): Promise<LeftConfig>
  /** 先弹系统确认，再连里面的文件移到废纸篓、提交；返回挪走了几个文件，取消了是 null */
  trash(folder: string): Promise<number | null>
}
