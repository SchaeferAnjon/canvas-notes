/**
 * 库里一个文件、一个文件夹的右键菜单（DESIGN.v3 9.2）：左栏的笔记、全部笔记、归档、目录树、首页和文件夹首页里列出的笔记，
 * 还有文档标签条右端的「更多」，都是这一份。
 */
import { titleOf } from '../../shared/layout'
import { app } from './actions'
import { copy, type MenuEntry, menuAt } from './menu'

const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const nameOf = (p: string) => p.split('/').pop()!

/** rename：这个地方能原地改名时给（左栏、全部笔记、标签） */
export function fileMenu(path: string, on: { rename?(): void } = {}): MenuEntry[] {
  const a = app()
  const md = /\.md$/i.test(path)
  const pinned = a.pins().includes(path)
  const here = folderOf(path)
  const targets = ['', ...a.folders()].filter((f) => f !== here)
  return [
    { label: '打开', run: () => a.openHere(path) },
    { label: '在新标签打开', run: () => a.openFile(path) },
    '-',
    md && on.rename && { label: '重命名', run: () => on.rename!() },
    md && targets.length > 0 && { label: '移到', submenu: targets.map((f) => ({ label: f || '库的最外层', run: () => a.moveNote(path, f) })) },
    md && (pinned ? { label: '取消置顶', run: () => a.togglePin(path, false) } : { label: '置顶', run: () => a.togglePin(path, true) }),
    '-',
    { label: '在访达中显示', run: () => window.cnMenu.reveal(path) },
    { label: '拷贝路径', run: () => copy(a.absPath(path)) },
    { label: '拷贝双链', run: () => copy(`[[${md ? titleOf(path) : nameOf(path)}]]`) },
    '-',
    { label: '移到废纸篓', run: () => a.trash(path) },
  ]
}

export function folderMenu(folder: string): MenuEntry[] {
  const a = app()
  return [
    { label: '新建笔记', run: () => a.newNote(folder) },
    { label: '新建白板', run: () => a.newBoard(folder) },
    '-',
    a.hasFolderHome(folder) && { label: '打开首页', run: () => a.openFolderHome(folder) },
    { label: '在访达中显示', run: () => window.cnMenu.reveal(folder) },
    { label: '拷贝路径', run: () => copy(a.absPath(folder)) },
  ]
}

/** 右键事件里直接用 */
export const onFileMenu = (e: React.MouseEvent, path: string, on: { rename?(): void } = {}) => void menuAt(e, fileMenu(path, on))
