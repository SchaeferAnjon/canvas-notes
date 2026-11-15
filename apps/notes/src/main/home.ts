/** 首页设置存在库里的 .canvas-notes/首页.json；从电脑选的封面拷进 附件/封面/ */
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { COVER_DIR, HOME_FILE, homeJson, normalizeHome, type HomeConfig } from '../shared/home'
import { copyIntoVault, IMAGE_EXT } from './attachments'
import type { Vault } from './vault'

export async function readHome(vault: Vault): Promise<HomeConfig> {
  try {
    return normalizeHome(JSON.parse(await readFile(vault.abs(HOME_FILE), 'utf8')))
  } catch (e) {
    // 没有文件是新库；文件坏了（手改、合并冲突）也回到默认，不挡着首页
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return normalizeHome(undefined)
    throw e
  }
}

export async function writeHome(vault: Vault, cfg: unknown): Promise<HomeConfig> {
  const text = homeJson(normalizeHome(cfg))
  const p = vault.abs(HOME_FILE)
  // 一样就不写，免得 Git 里多出假改动
  const cur = await readFile(p, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  if (cur !== text) {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, text)
  }
  return JSON.parse(text) as HomeConfig
}

export function registerHome(getVault: () => Vault, getWin: () => BrowserWindow | null) {
  ipcMain.handle('home:get', () => readHome(getVault()))
  ipcMain.handle('home:set', async (_e, cfg: unknown) => {
    const saved = await writeHome(getVault(), cfg)
    // 首页.json 不是 md，库的监视不报它；底栏的「未提交」要知道它变了
    getWin()?.webContents.send('files:changed')
    return saved
  })
  // 拖一张图到封面上：界面把字节传过来，写进 附件/封面/，名字重了加序号
  ipcMain.handle('home:dropCover', async (_e, bytes: unknown, name: unknown) => {
    if (!(bytes instanceof Uint8Array) || typeof name !== 'string') throw new Error('封面参数不对')
    if (bytes.byteLength === 0 || bytes.byteLength > 30 * 1024 * 1024) throw new Error('图片是空的或者太大（超过 30MB）')
    const ext = extname(name).toLowerCase()
    if (!IMAGE_EXT.includes(ext.slice(1))) throw new Error('这不是图片')
    const dir = getVault().abs(COVER_DIR)
    await mkdir(dir, { recursive: true })
    const base = basename(name, extname(name)).replace(/[\\/:*?"<>|]/g, '').trim() || '封面'
    for (let n = 1; ; n++) {
      const file = `${base}${n > 1 ? ` ${n}` : ''}${ext}`
      try {
        await writeFile(join(dir, file), bytes, { flag: 'wx' })
        return `${COVER_DIR}/${file}`
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
  })
  ipcMain.handle('home:pickCover', async () => {
    const vault = getVault()
    const win = getWin()
    const opts = { title: '选一张封面', buttonLabel: '用这张', properties: ['openFile' as const], filters: [{ name: '图片', extensions: IMAGE_EXT }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return copyIntoVault(vault, r.filePaths[0], COVER_DIR)
  })
}
