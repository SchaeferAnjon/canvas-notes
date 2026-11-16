/** 文件夹首页的接口：preload 暴露成 window.cnFolder（实现在 main/folder-home.ts） */
import type { FolderEntry, FolderHome, PropFile } from './folder-home'

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
  /** 还空着的课程或项目改名（新建后在首页标题上改），返回新文件夹 */
  rename(folder: string, name: string): Promise<string>
}
