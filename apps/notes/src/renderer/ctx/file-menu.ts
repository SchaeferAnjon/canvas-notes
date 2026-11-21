/**
 * 库里一个文件、一个文件夹的右键菜单（DESIGN.v3 9.2）：左栏的笔记、全部笔记、归档、目录树、首页和文件夹首页里列出的笔记，
 * 还有文档标签条右端的「更多」，都是这一份。
 */
import { fixedFolder } from '../../shared/files'
import { folderPinKey } from '../../shared/left'
import { leftConfig } from '../files/left-store'
import { titleOf } from '../../shared/layout'
import { app } from './actions'
import { copy, type MenuEntry, menuAt } from './menu'
import { moveMenu } from './move-menu'

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const nameOf = (p: string) => p.split('/').pop()!

/** rename：这个地方能原地改名时给（左栏、全部笔记、标签）；note：PDF、HTML 和它的笔记合成一行时那篇笔记（多一项「单独打开笔记」） */
export function fileMenu(path: string, on: { rename?(): void; note?: string } = {}): MenuEntry[] {
  const a = app()
  const md = /\.md$/i.test(path)
  const pinned = a.pins().includes(path)
  const here = folderOf(path)
  const targets = moveMenu(a.allFolders(), here, (f) => a.moveNote(path, f))
  return [
    { label: '打开', run: () => a.openHere(path) },
    { label: '在新标签打开', run: () => a.openFile(path) },
    on.note && { label: '单独打开笔记', run: () => a.openFile(on.note!) },
    '-',
    md && on.rename && { label: '重命名', run: () => on.rename!() },
    md && targets.length > 0 && { label: '移到', submenu: targets },
    md && (pinned ? { label: '取消置顶', run: () => a.togglePin(path, false) } : { label: '置顶', run: () => a.togglePin(path, true) }),
    '-',
    { label: '在访达中显示', run: () => window.cnMenu.reveal(path) },
    { label: '拷贝路径', run: () => copy(a.absPath(path)) },
    { label: '拷贝双链', run: () => copy(`[[${md ? titleOf(path) : nameOf(path)}]]`) },
    '-',
    { label: '移到废纸篓', run: () => a.trash(path) },
  ]
}

/**
 * 文件夹的右键（目录树、左栏、文件夹首页里的子文件夹卡片；2026-11-17 左栏重组，小样 2b）。
 * rename：这个地方能原地改名时给；newFolder：能在这里原地新建文件夹时给（目录树）；look：能贴着这一行弹「换图标和颜色」时给。
 * 最外层固定的文件夹（课程、生活、写作……）没有重命名、移到和移到废纸篓。
 */
export function folderMenu(folder: string, on: { rename?(): void; newFolder?(): void; look?(): void } = {}): MenuEntry[] {
  const a = app()
  const fixed = fixedFolder(folder)
  const pinned = a.pins().includes(folderPinKey(folder))
  const onLeft = leftConfig().left.includes(folder)
  const here = folderOf(folder)
  // 挪到哪：库里任何文件夹；不能挪进自己里面，也不挪回原处
  const targets = moveMenu(a.allFolders(), here, (f) => a.moveFolder(folder, f), (f) => f === folder || f.startsWith(folder + '/'))
  return [
    { label: '新建笔记', accel: 'CommandOrControl+N', run: () => a.newNote(folder) },
    { label: '新建白板', run: () => a.newBoard(folder) },
    on.newFolder && { label: '新建文件夹', run: () => on.newFolder!() },
    '-',
    { label: '打开首页', run: () => a.openFolderHere(folder) },
    { label: '在新标签打开首页', run: () => a.openFolderHome(folder) },
    '-',
    pinned ? { label: '取消置顶', run: () => a.togglePin(folderPinKey(folder), false) } : { label: '置顶', run: () => a.togglePin(folderPinKey(folder), true) },
    onLeft ? { label: '从左边拿下', run: () => a.takeOffLeft(folder) } : { label: '放到左边', run: () => a.putOnLeft(folder) },
    on.look && { label: '换图标和颜色…', run: () => on.look!() },
    '-',
    !fixed && on.rename && { label: '重命名…', accel: 'F2', run: () => on.rename!() },
    !fixed && targets.length > 0 && { label: '移到', submenu: targets },
    '-',
    { label: '在访达中显示', run: () => window.cnMenu.reveal(folder) },
    { label: '拷贝路径', run: () => copy(a.absPath(folder)) },
    '-',
    !fixed && { label: '移到废纸篓', accel: 'CommandOrControl+Backspace', run: () => a.trashFolder(folder) },
  ]
}

/** 右键事件里直接用；extra：这一处自己多的几项，放在最后（文档「⋯」里的宽版） */
export const onFileMenu = (e: React.MouseEvent, path: string, on: { rename?(): void; note?: string } = {}, extra: MenuEntry[] = []) =>
  void menuAt(e, [...fileMenu(path, on), ...(extra.some(Boolean) ? ['-' as const, ...extra] : [])])
