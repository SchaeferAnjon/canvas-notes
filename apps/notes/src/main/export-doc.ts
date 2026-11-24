/**
 * 导出一篇文档（文档「⋯」、文件树右键「导出 PDF…」「导出为 Markdown…」，2026-11-24）。
 * - PDF：界面先问存在哪（export:pick-pdf，系统存储面板，默认「下载/<标题>.pdf」），再把这篇按文档看法画进只在打印时出现的一层，
 *   export:print-pdf 把这个窗口印成 PDF（同一个页面，样式、公式字体、库里的图都现成能用）。
 * - Markdown：存储面板选一个文件夹名（默认「下载/<标题>」），建这个文件夹：<标题>.md + 附件/（@cn/format 的 exportMarkdown 定写法）。
 * 测试模式里存储面板是记录器（test-mode.ts），测试自己换成返回一个临时路径的。
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdir, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { exportMarkdown } from '@cn/format'
import { atomicCopy, atomicWrite } from '@cn/atomic'
import type { Vault } from './vault'

const SKIP = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

/** 文件名：去掉路径和不能用的字 */
const safeName = (name: unknown) => (typeof name === 'string' ? basename(name) : '').replace(/[\\/:*?"<>|\n]/g, ' ').trim() || '未命名'

/** 库里的所有文件（相对库根目录）：找 ![[图.png]] 指的是哪个、链接指向的文件在不在 */
async function vaultFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, rel: string) => {
    const subs: Promise<void>[] = []
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) subs.push(walk(join(dir, ent.name), r))
      else if (ent.isFile()) out.push(r)
    }
    await Promise.all(subs)
  }
  await walk(root, '')
  return out
}

async function savePath(win: BrowserWindow | null, opts: Electron.SaveDialogOptions): Promise<string | null> {
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  return r.canceled || !r.filePath ? null : r.filePath
}

export function setupDocExport(needVault: () => Vault) {
  /** 问好的 PDF 存放位置：界面画好再来印，只认主进程自己发出去的号 */
  const tickets = new Map<number, { path: string; wc: number }>()
  let next = 1

  ipcMain.handle('export:pick-pdf', async (e, name: unknown) => {
    const path = await savePath(BrowserWindow.fromWebContents(e.sender), {
      title: '导出 PDF',
      buttonLabel: '导出',
      defaultPath: join(app.getPath('downloads'), `${safeName(name)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!path) return null
    const id = next++
    tickets.set(id, { path: /\.pdf$/i.test(path) ? path : `${path}.pdf`, wc: e.sender.id })
    return id
  })

  ipcMain.handle('export:print-pdf', async (e, id: unknown) => {
    const t = typeof id === 'number' ? tickets.get(id) : undefined
    if (!t || t.wc !== e.sender.id) throw new Error('没有问过存在哪')
    tickets.delete(id as number)
    // A4；背景（表头底色、提示块）要印。纸边不留白：页边距是那一层每页都有的内边距（export-print.css）——
    // 留纸边的话，纸边上涂的是窗口的底色（主题深色时一圈深灰），网页的样式盖不到那里
    const pdf = await e.sender.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 }, generateDocumentOutline: true })
    await atomicWrite(t.path, pdf)
    return t.path
  })

  ipcMain.handle('export:md', async (e, path: unknown, text: unknown) => {
    if (typeof path !== 'string' || !/\.md$/i.test(path) || typeof text !== 'string') throw new Error('参数不对')
    const v = needVault()
    v.abs(path) // 拦住 .. 和绝对路径
    const title = safeName(path.replace(/\.md$/i, ''))
    const dir = await savePath(BrowserWindow.fromWebContents(e.sender), {
      title: '导出为 Markdown',
      buttonLabel: '导出',
      message: '会建一个文件夹，里面是这篇的 .md 和它用到的图、附件',
      nameFieldLabel: '文件夹名',
      defaultPath: join(app.getPath('downloads'), title),
    })
    if (!dir) return null
    const r = exportMarkdown(text, path, await vaultFiles(v.root))
    await mkdir(dir, { recursive: true })
    for (const c of r.copies) {
      await mkdir(join(dir, c.to, '..'), { recursive: true })
      await atomicCopy(v.abs(c.from), join(dir, c.to))
    }
    await atomicWrite(join(dir, `${basename(dir)}.md`), r.text)
    return { dir, files: r.copies.length }
  })
}
