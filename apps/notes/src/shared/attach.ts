/**
 * 一篇笔记的附件（2026-11-17 四件事第 1、2 条）：「属性」弹层里列出这篇的图；删笔记时连同只有它在用的图一起移到废纸篓，删完能撤回。
 * 附件放在 附件/<笔记路径>/（packages/format 的 attachmentDir）。删笔记时问的是「跟着这篇走的」（mine）：
 * 自己文件夹里的，加上文中用到、放在 附件/ 别处的（读 PDF 的截图在 附件/<PDF>/、视频时刻在 附件/视频/…、导进来的在 附件/导入/…、
 * 梦游归类挪走以前存的在 附件/收件箱/<旧名>/）；别的笔记也在用的不删，首页和文件夹的封面（附件/封面/）不算。
 */

export interface AttachItem {
  /** 库里的路径 */
  path: string
  bytes: number
  /** 在文中哪一节（没用到是 null） */
  where: string | null
  /** 在原文里的位置，双击跳过去（没用到是 null） */
  offset: number | null
  /** 在这篇自己的附件文件夹里 */
  own: boolean
  /** 跟着这篇走：删这篇时问要不要一起删（自己文件夹里的，和文中用到的 附件/ 里别处的，封面除外） */
  mine: boolean
  /** 别的笔记也链着它（只在查了的时候有） */
  sharedWith?: string[]
}

export interface NoteAttachments {
  /** 这篇的附件文件夹 附件/<笔记路径> */
  dir: string
  dirExists: boolean
  /** 文中用到的按先后在前，没用到的按名字在后 */
  items: AttachItem[]
  bytes: number
}

export interface TrashResult {
  /** 撤回用的号 */
  id: string
  /** 一起移到废纸篓的图 */
  images: number
  /** 别的笔记也在用、留下没删的 */
  kept: number
}

export interface CnAttachApi {
  /** shared：再查一遍全库，哪些图别的笔记也在用（删笔记前要） */
  of(note: string, shared: boolean): Promise<NoteAttachments>
  /** 删笔记（md）：withImages 时连同只有它在用的附件一起；先在软件设置目录留一份，撤回时放回原处 */
  trashNote(note: string, withImages: boolean): Promise<TrashResult>
  /** 撤回刚才那次删除：笔记和图放回原处（原处已经有同名的就不盖） */
  undo(id: string): Promise<void>
}

/** 1.8 MB、640 KB、512 B */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** 删除确认框里勾不勾「连同 N 张图」：记住上次的（默认勾上） */
export const TRASH_IMAGES_KEY = 'cn.trashImages'
