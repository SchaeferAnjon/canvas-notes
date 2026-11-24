/**
 * 导出导图（第二批 ④⑫）：界面画好的 PNG 字节、SVG、OPML 文字存到用户在存储面板里挑的地方；
 * PDF 用一个看不见的窗口把界面给的 SVG 打印成 PDF（一页放下：纸跟导图一样大，或 A4 横放、竖放）。
 * 测试模式（CN_E2E=1）没有存储面板（test-mode 换成了记录），给了 CN_E2E_EXPORT_DIR 就直接存进那个文件夹，测试读得到文件。
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import { atomicWrite } from '@cn/atomic'

/** 导出时嵌进 SVG 的图（库里的原照片、主题上的图）：界面的 CSP 不让 fetch cn-file:，在这里读成 data: 网址 */
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp' }

const FILTERS: Record<string, Electron.FileFilter[]> = {
  png: [{ name: 'PNG', extensions: ['png'] }],
  svg: [{ name: 'SVG', extensions: ['svg'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  opml: [{ name: 'OPML', extensions: ['opml'] }],
}

/** 文件名：去掉路径和不能用的字，补上扩展名 */
function fileName(name: unknown, fmt: string): string {
  const stem = (typeof name === 'string' ? basename(name) : '').replace(/[\\/:*?"<>|\n]/g, ' ').trim() || '导图'
  return stem.toLowerCase().endsWith('.' + fmt) ? stem : `${stem}.${fmt}`
}

async function where(win: BrowserWindow | null, name: string, fmt: string): Promise<string | null> {
  const dir = process.env.CN_E2E_EXPORT_DIR
  if (E2E && dir) return join(dir, name)
  const opts: Electron.SaveDialogOptions = { defaultPath: name, filters: FILTERS[fmt] }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  return r.canceled || !r.filePath ? null : r.filePath
}

export function setupMapExport(win: () => BrowserWindow | null, vault: () => Vault | null) {
  ipcMain.handle('map:image-data', async (_e, path: unknown) => {
    const v = vault()
    const mime = typeof path === 'string' ? MIME[extname(path).toLowerCase()] : undefined
    if (!v || !mime) return null
    try {
      return `data:${mime};base64,${(await readFile(v.abs(path as string))).toString('base64')}`
    } catch (e) {
      // 图被挪走、删了：导出时这张不画
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  })

  ipcMain.handle('map:export', async (_e, fmt: unknown, name: unknown, data: unknown) => {
    if (fmt !== 'png' && fmt !== 'svg' && fmt !== 'opml') throw new Error(`不认识的格式：${String(fmt)}`)
    const bytes = fmt === 'png' ? (data instanceof Uint8Array ? data : null) : typeof data === 'string' ? data : null
    if (bytes === null) throw new Error('导出的内容不对')
    const path = await where(win(), fileName(name, fmt), fmt)
    if (!path) return null
    await atomicWrite(path, bytes)
    return path
  })

  ipcMain.handle('map:export-pdf', async (_e, name: unknown, svg: unknown, paper: unknown) => {
    if (typeof svg !== 'string' || !svg.startsWith('<svg')) throw new Error('导出的内容不对')
    const size = paper && typeof paper === 'object' ? (paper as { w?: unknown; h?: unknown }) : null
    const fit = size && typeof size.w === 'number' && typeof size.h === 'number' && size.w > 0 && size.h > 0 ? { w: size.w, h: size.h } : null
    const a4 = paper === 'a4-land' || paper === 'a4-port' ? paper : null
    if (!fit && !a4) throw new Error('纸的大小不对')
    const path = await where(win(), fileName(name, 'pdf'), 'pdf')
    if (!path) return null
    // SVG 里嵌着图（几 MB），写成一个临时网页再开，不走 data: 网址
    const dir = await mkdtemp(join(tmpdir(), 'cn-map-pdf-'))
    const page = join(dir, 'map.html')
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
    try {
      const css = fit ? 'svg{display:block;width:100vw;height:100vh}' : 'svg{display:block;width:100vw;height:100vh;object-fit:contain}'
      await writeFile(page, `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}html,body{margin:0;padding:0}${css}</style></head><body>${svg.replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ')}</body></html>`)
      await w.loadFile(page)
      // 一英寸 96 像素；跟导图一样大时一页就是整张图
      const pdf = await w.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: fit ? { width: fit.w / 96, height: fit.h / 96 } : 'A4',
        landscape: a4 === 'a4-land',
      })
      await atomicWrite(path, pdf)
    } finally {
      w.destroy()
      await rm(dir, { recursive: true, force: true })
    }
    return path
  })
}
