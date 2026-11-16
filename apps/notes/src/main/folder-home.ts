/**
 * 文件夹首页的主线部分：读写 <文件夹>/.首页.json（先写临时文件再改名）、模板、恢复默认、
 * 列出这个文件夹（或整个库）的文件和属性给「按条件列出」用、列出库里有首页的文件夹、新建和给空的新文件夹改名。
 * 换封面走主页那套（window.cn.pickCover，图拷进 附件/封面/）。
 */
import { decodeNote, notePathFor, readProps } from '@cn/format'
import { ipcMain, type BrowserWindow } from 'electron'
import { mkdir, open, readdir, readFile, rename, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  checkFolderName,
  defaultFolderHome,
  type FolderEntry,
  folderHomeJson,
  folderKind,
  type FolderHome,
  type FolderKind,
  homeFileOf,
  normalizeFolderHome,
  type PropFile,
  sortFolders,
  templateFileOf,
} from '../shared/folder-home'
import { writeFileAtomic } from './atomic'
import type { Vault } from './vault'

const SKIP = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

function kindOf(folder: unknown): FolderKind {
  const k = typeof folder === 'string' ? folderKind(folder) : null
  if (!k) throw new Error(`这个文件夹没有首页：${String(folder)}`)
  return k
}

async function readJson(p: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null
    throw e
  }
}


/** 这一页的设置；没存过就用模板（有的话）或默认 */
export async function readFolderHome(v: Vault, folder: string): Promise<{ home: FolderHome; saved: boolean; template: boolean }> {
  const kind = kindOf(folder)
  const own = await readJson(v.abs(homeFileOf(folder)))
  if (own) return { home: normalizeFolderHome(own, kind), saved: true, template: false }
  const tf = templateFileOf(kind)
  const tpl = tf ? await readJson(v.abs(tf)) : null
  return { home: tpl ? normalizeFolderHome(tpl, kind) : defaultFolderHome(kind), saved: false, template: !!tpl }
}

export async function writeFolderHome(v: Vault, folder: string, raw: unknown): Promise<FolderHome> {
  const home = normalizeFolderHome(raw, kindOf(folder))
  const p = v.abs(homeFileOf(folder))
  const text = folderHomeJson(home)
  await writeFileAtomic(p, text)
  return home
}

/** 文件夹里（scope 是 vault 时整个库）的文件和属性；md 读 frontmatter，PDF 当课件、从名字认第几讲 */
export async function propFiles(v: Vault, folder: string | null): Promise<PropFile[]> {
  const out: PropFile[] = []
  const walk = async (dir: string) => {
    let ents
    try {
      ents = await readdir(v.abs(dir || '.'), { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) await walk(rel)
      else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase()
        if (ext !== '.md' && ext !== '.pdf' && ext !== '.html') continue
        const st = await stat(v.abs(rel))
        const props: Record<string, string> = {}
        if (ext === '.md') for (const p of readProps(decodeNote(await readFile(v.abs(rel))).text)) props[p.key] = p.value
        else if (ext === '.html') Object.assign(props, htmlMeta(await readHead(v.abs(rel))))
        else {
          props['类型'] = '课件'
          const m = /第\s*(\d+)\s*讲/.exec(e.name)
          if (m) props['第几讲'] = m[1]!
        }
        out.push({ path: rel, mtimeMs: st.mtimeMs, props })
      }
    }
  }
  await walk(folder ?? '')
  // 课件问到第几页：读 PDF 时写在旁边那篇笔记的属性「进度」里（问过的最大页码/一共几页）
  const byPath = new Map(out.map((f) => [f.path, f]))
  for (const f of out) {
    if (!f.path.toLowerCase().endsWith('.pdf') || f.props['问到']) continue
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(byPath.get(notePathFor(f.path))?.props['进度'] ?? '')
    if (m) Object.assign(f.props, { 问到: m[1]!, 页数: m[2]! })
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** HTML 只读开头一段（属性在 <head> 的 meta 里） */
async function readHead(abs: string): Promise<string> {
  const fh = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(8192)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

/** 做好的可视化把属性写在 <meta name="类型" content="可视化"> 里 */
export function htmlMeta(head: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of head.matchAll(/<meta\s+name="([^"]+)"\s+content="([^"]*)"\s*\/?>/gi)) out[m[1]!] = m[2]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  return out
}

const exists = (p: string) => stat(p).then(() => true, () => false)

async function subdirs(v: Vault, rel: string): Promise<string[]> {
  try {
    return (await readdir(v.abs(rel), { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => `${rel}/${e.name}`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}

/** 库里有首页的文件夹，带它首页选的图标和颜色（左栏、标签上用） */
export async function listFolderHomes(v: Vault): Promise<FolderEntry[]> {
  const folders = [...(await subdirs(v, '课程')), ...(await subdirs(v, '项目'))]
  for (const top of ['生活', '写作']) if ((await stat(v.abs(top)).catch(() => null))?.isDirectory()) folders.push(top)
  const out = await Promise.all(
    folders.map(async (folder) => {
      const { home } = await readFolderHome(v, folder)
      return { folder, kind: folderKind(folder)!, icon: home.icon, color: home.color }
    }),
  )
  return sortFolders(out)
}

/** 新建一门课 / 一个项目：建文件夹，名字重了加序号；首页先不存（读的时候用模板或默认） */
export async function createFolder(v: Vault, folder: string): Promise<string> {
  const kind = kindOf(folder)
  if (kind !== 'course' && kind !== 'project') throw new Error('只能新建课程和项目')
  let f = folder
  for (let n = 2; await exists(v.abs(f)); n++) f = `${folder} ${n}`
  await mkdir(v.abs(f), { recursive: true })
  return f
}

/** 给还空着的课程或项目改名（新建后在首页标题上改）；里面有文件了就不改，免得别处的链接断 */
export async function renameEmptyFolder(v: Vault, folder: string, name: string): Promise<string> {
  const kind = kindOf(folder)
  if (kind !== 'course' && kind !== 'project') throw new Error('生活、写作不能改名')
  const bad = checkFolderName(name)
  if (bad) throw new Error(bad)
  const to = `${folder.split('/')[0]}/${name.trim()}`
  if (to === folder) return folder
  if ((await readdir(v.abs(folder))).some((n) => !n.startsWith('.'))) throw new Error('这个文件夹里已经有文件了，在访达里改名吧')
  if (await exists(v.abs(to))) throw new Error(`已经有「${name.trim()}」了`)
  await rename(v.abs(folder), v.abs(to))
  return to
}

export function registerFolderHome(getVault: () => Vault, getWin: () => BrowserWindow | null) {
  const changed = () => getWin()?.webContents.send('files:changed')
  ipcMain.handle('folderHome:get', (_e, folder: unknown) => readFolderHome(getVault(), folder as string))
  ipcMain.handle('folderHome:set', async (_e, folder: unknown, home: unknown) => {
    const h = await writeFolderHome(getVault(), folder as string, home)
    changed()
    return h
  })
  // 恢复默认：有模板用模板；这只是一页看法，文件一个不动
  ipcMain.handle('folderHome:reset', async (_e, folder: unknown) => {
    const v = getVault()
    const kind = kindOf(folder)
    const tf = templateFileOf(kind)
    const tpl = tf ? await readJson(v.abs(tf)) : null
    const h = await writeFolderHome(v, folder as string, tpl ?? defaultFolderHome(kind))
    changed()
    return h
  })
  ipcMain.handle('folderHome:setTemplate', async (_e, folder: unknown) => {
    const v = getVault()
    const kind = kindOf(folder)
    const tf = templateFileOf(kind)
    if (!tf) throw new Error('生活、写作只有一页，不需要模板')
    const { home } = await readFolderHome(v, folder as string)
    await writeFileAtomic(v.abs(tf), folderHomeJson(home))
    changed()
    return tf
  })
  ipcMain.handle('folderHome:files', (_e, folder: unknown, scope: unknown) => {
    kindOf(folder)
    return propFiles(getVault(), scope === 'vault' ? null : (folder as string))
  })
  ipcMain.handle('folderHome:list', () => listFolderHomes(getVault()))
  ipcMain.handle('folderHome:create', async (_e, folder: unknown) => {
    const f = await createFolder(getVault(), folder as string)
    changed()
    return f
  })
  ipcMain.handle('folderHome:rename', async (_e, folder: unknown, name: unknown) => {
    if (typeof name !== 'string') throw new Error('名字不对')
    const f = await renameEmptyFolder(getVault(), folder as string, name)
    changed()
    return f
  })
}

