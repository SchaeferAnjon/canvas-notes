/**
 * 附件：文档里插图片时把文件拷进库的「附件/」，笔记里写相对链接；
 * 界面用 cn-file://vault/<库里的路径> 显示库里的图片（只认库里的图片文件）；
 * cn-file://app/backgrounds/<文件名> 是设置里自己选的窗口背景（存在软件设置目录）。
 */
import { dialog, ipcMain, net, protocol, type BrowserWindow } from 'electron'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXT_SCHEME } from '../shared/bookmarkkeeper'
import type { Vault } from './vault'

export const ATTACHMENTS = '附件'
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic', 'bmp']

/**
 * 要在 app ready 之前调，而且整个软件只能调一次，所以书签管家页面的 cn-ext 也在这里登记
 * （它的文件在 main/web/bookmarkkeeper/ 里提供）
 */
export function registerFileScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'cn-file', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: EXT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ])
}

/** 库里 HTML 的隔离规则：脚本和样式只能是文件里自己写的，连不了网、拿不到别的文件 */
export const HTML_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"

async function vaultHtml(abs: string): Promise<Response> {
  try {
    return new Response(await readFile(abs), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': HTML_CSP } })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Response('文件不在了', { status: 404 })
    throw e
  }
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

/** 梦游分支上还没收下的 HTML（梦游做的可视化，收下前预览）：dream-main 交进来怎么读 */
let dreamHtml: ((rel: string) => Promise<string | null>) | null = null
export const setDreamHtml = (f: (rel: string) => Promise<string | null>) => (dreamHtml = f)

export function registerAttachments(getVault: () => Vault, getWin: () => BrowserWindow | null, appDir: string) {
  protocol.handle('cn-file', (req) => {
    const url = new URL(req.url)
    const parts = url.pathname.slice(1).split('/').map(decodeURIComponent)
    const rel = parts.join('/')
    // 库里的 HTML（读 PDF 时做的可视化）：放在没有来源的沙箱 iframe 里跑，只许它自己的脚本和样式，不联网
    if (url.host === 'vault' && /\.html?$/i.test(rel)) return vaultHtml(getVault().abs(rel))
    // 梦游分支上的 HTML：同一个沙箱规矩
    if (url.host === 'dream' && /\.html?$/i.test(rel) && dreamHtml)
      return dreamHtml(rel).then((t) => (t === null ? new Response('梦游报告里没有这个文件', { status: 404 }) : new Response(t, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': HTML_CSP } })))
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
