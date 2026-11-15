/**
 * 附件：文档里插图片时把文件拷进库的「附件/」，笔记里写相对链接；
 * 界面用 cn-file://vault/<库里的路径> 显示库里的图片（只认库里的图片文件）；
 * cn-file://app/backgrounds/<文件名> 是设置里自己选的窗口背景（存在软件设置目录）。
 */
import { dialog, ipcMain, net, protocol, type BrowserWindow } from 'electron'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Vault } from './vault'

export const ATTACHMENTS = '附件'
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic', 'bmp']

/** 要在 app ready 之前调 */
export function registerFileScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'cn-file', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

/** 拷进 附件/（或别的库里文件夹），名字重了加序号；返回库里的相对路径 */
export async function copyIntoVault(vault: Vault, src: string, folder: string = ATTACHMENTS): Promise<string> {
  const dir = vault.abs(folder)
  await mkdir(dir, { recursive: true })
  const ext = extname(src)
  const base = basename(src, ext)
  for (let n = 1; ; n++) {
    const name = `${base}${n > 1 ? ` ${n}` : ''}${ext}`
    try {
      await stat(join(dir, name))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      await copyFile(src, join(dir, name))
      return `${folder}/${name}`
    }
  }
}

export function registerAttachments(getVault: () => Vault, getWin: () => BrowserWindow | null, appDir: string) {
  protocol.handle('cn-file', (req) => {
    const url = new URL(req.url)
    const parts = url.pathname.slice(1).split('/').map(decodeURIComponent)
    const rel = parts.join('/')
    if (!IMAGE_EXT.includes(extname(rel).slice(1).toLowerCase())) return new Response('不认识的文件', { status: 404 })
    if (url.host === 'vault') return net.fetch(pathToFileURL(getVault().abs(rel)).toString())
    if (url.host === 'app' && parts.length === 2 && parts[0] === 'backgrounds' && !/[\\/]|^\.\.?$/.test(parts[1]!))
      return net.fetch(pathToFileURL(join(appDir, 'backgrounds', parts[1]!)).toString())
    return new Response('不认识的文件', { status: 404 })
  })
  ipcMain.handle('attach:pickImage', async () => {
    const vault = getVault()
    const win = getWin()
    const opts = { title: '插入图片', buttonLabel: '插入', properties: ['openFile' as const], filters: [{ name: '图片', extensions: IMAGE_EXT }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return copyIntoVault(vault, r.filePaths[0])
  })
}
