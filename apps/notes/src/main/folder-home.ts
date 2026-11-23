/**
 * 文件夹首页的主线部分：读写 <文件夹>/.首页.json（先写临时文件再改名）、模板、恢复默认、
 * 列出这个文件夹（或整个库）的文件和属性给「按条件列出」用、列出库里有首页的文件夹、新建课程和项目；
 * 任何文件夹的新建、改名、移到废纸篓在 folder-ops.ts，接口也挂在这里。
 * 换封面走主页那套（window.cn.pickCover，图拷进 附件/封面/）。
 */
import { baseFoldersIn, decodeNote, notePathFor, readProps } from '@cn/format'
import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  defaultFolderHome,
  type FolderEntry,
  folderHomeJson,
  folderKind,
  type FolderHome,
  homeKindOf,
  type FolderKind,
  homeFileOf,
  normalizeFolderHome,
  type PropFile,
  blankNote,
  onlyBase,
  bodyChars,
  sortFolders,
  templateFileOf,
} from '../shared/folder-home'
import { writeFileAtomic } from './atomic'
import { followOpen } from './ctx-menu'
import { countFiles, GITKEEP, makeFolder, moveFolder, moveItem, renameFolder, testTrash, trashFolder } from './folder-ops'
import { readDescs, writeDesc } from './categories'
import { catName } from '../shared/categories'
import { readLeft, writeLeft } from './left'
import type { Vault } from './vault'

const SKIP = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

function kindOf(folder: unknown): FolderKind {
  const k = typeof folder === 'string' ? homeKindOf(folder) : null
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
  if (own) return { home: normalizeFolderHome(own, kind, folder), saved: true, template: false }
  const tf = templateFileOf(kind)
  const tpl = tf ? await readJson(v.abs(tf)) : null
  return { home: tpl ? normalizeFolderHome(tpl, kind, folder) : defaultFolderHome(kind, folder), saved: false, template: !!tpl }
}

export async function writeFolderHome(v: Vault, folder: string, raw: unknown): Promise<FolderHome> {
  const home = normalizeFolderHome(raw, kindOf(folder), folder)
  const p = v.abs(homeFileOf(folder))
  const text = folderHomeJson(home)
  await writeFileAtomic(p, text)
  return home
}

/** 文件夹里（scope 是 vault 时整个库）的文件和属性；md 读 frontmatter，PDF 当课件、从名字认第几讲 */
export async function propFiles(v: Vault, folder: string | null): Promise<PropFile[]> {
  const out: PropFile[] = []
  const tables = new Set<string>()
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
        // readdir 之后这篇被挪走、移到废纸篓了（关空的新笔记、删除、梦游挪走都会撞上）：跳过，不让整个列表报 ENOENT
        try {
          const ext = extname(e.name).toLowerCase()
          if (ext !== '.md' && ext !== '.pdf' && ext !== '.html') continue
          const st = await stat(v.abs(rel))
          const props: Record<string, string> = {}
          let blank = false
          let db = false
          let chars: number | undefined
          if (ext === '.md') {
            const text = decodeNote(await readFile(v.abs(rel))).text
            for (const p of readProps(text)) props[p.key] = p.value
            blank = blankNote(text)
            chars = bodyChars(text)
            for (const f of baseFoldersIn(text)) tables.add(f)
            db = onlyBase(text)
          }
          if (ext === '.html') Object.assign(props, htmlMeta(await readHead(v.abs(rel))))
          else if (ext === '.pdf') {
            props['类型'] = '课件'
            // 「第 5 讲」「Lecture05」「lecture 5」都认
            const m = /第\s*(\d+)\s*讲|lecture[\s_-]*0*(\d+)/i.exec(e.name)
            if (m) props['第几讲'] = (m[1] ?? m[2])!
          }
          out.push({ path: rel, mtimeMs: st.mtimeMs, props, ...(blank ? { blank } : {}), ...(db ? { db } : {}), ...(chars !== undefined ? { chars } : {}) })
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
      }
    }
  }
  await walk(folder ?? '')
  // 数据库的条目：所在文件夹是某个数据库（```base）的数据源。主笔记不一定在这个文件夹里（数据源拖进「写作」、主笔记挪去「生活」），
  // 库里别处的数据库也算（第 4 轮：写作首页把条目都算成草稿）
  if (folder) for (const f of await v.tableFolders()) tables.add(f)
  // 数据源是 file.inFolder：下面的子文件夹也算（第 5 轮：子文件夹里的条目表里列着，首页却算成草稿）
  const inTable = (path: string) => {
    for (let d = path; d.includes('/'); ) {
      d = d.slice(0, d.lastIndexOf('/'))
      if (tables.has(d)) return true
    }
    return false
  }
  for (const f of out) if (inTable(f.path)) f.entry = true
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
  // 分类文件夹名照这个库的（英文库是 Courses、Projects、Life、Writing）
  const folders = [...(await subdirs(v, catName('课程'))), ...(await subdirs(v, catName('项目')))]
  for (const top of [catName('生活'), catName('写作')]) if ((await stat(v.abs(top)).catch(() => null))?.isDirectory()) folders.push(top)
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
  // 空文件夹 Git 记不住：放一个看不见的 .gitkeep
  await writeFile(v.abs(`${f}/${GITKEEP}`), '')
  return f
}

/** moved：文件夹改名时里面每个文件挪了（本机记着的读 PDF 进度跟着换） */
export function registerFolderHome(getVault: () => Vault, getWin: () => BrowserWindow | null, moved?: (root: string, from: string, to: string) => void) {
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
    const h = await writeFolderHome(v, folder as string, tpl ?? defaultFolderHome(kind, folder as string))
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
  // 任何文件夹：新建（放 .gitkeep）、改名（链接、置顶跟着改）、移到废纸篓（先问一句），各一次提交
  ipcMain.handle('folder:create', async (_e, parent: unknown, name: unknown) => {
    if (typeof parent !== 'string' || typeof name !== 'string') throw new Error('新建文件夹的参数不对')
    const f = await makeFolder(getVault(), parent, name)
    changed()
    return f
  })
  ipcMain.handle('folder:rename', async (e, folder: unknown, name: unknown) => {
    const v = getVault()
    const follow = followOpen(e.sender)
    try {
      return (await renameFolder(v, folder, name, (from, to) => (moved?.(v.root, from, to), follow(from, to)))).to
    } finally {
      changed()
    }
  })
  ipcMain.handle('folder:move', async (e, folder: unknown, parent: unknown) => {
    const v = getVault()
    const follow = followOpen(e.sender)
    try {
      return (await moveFolder(v, folder, parent, (from, to) => (moved?.(v.root, from, to), follow(from, to)))).to
    } finally {
      changed()
    }
  })
  // 首页卡里拖走一份（task-r00en）：PDF 连挂着的笔记、可视化一起挪；读 PDF 记在本机的进度、开着的编辑器跟到新路径
  ipcMain.handle('folder:moveItem', async (e, path: unknown, folder: unknown) => {
    const v = getVault()
    const follow = followOpen(e.sender)
    try {
      return await moveItem(v, path, folder, (from, to) => (moved?.(v.root, from, to), follow(from, to)))
    } finally {
      changed()
    }
  })
  ipcMain.handle('left:get', () => readLeft(getVault()))
  ipcMain.handle('cat:descs', () => readDescs(getVault()))
  ipcMain.handle('cat:setDesc', async (_e, name: unknown, text: unknown) => {
    const d = await writeDesc(getVault(), name, text)
    changed()
    return d
  })
  ipcMain.handle('left:set', (_e, c: unknown) => writeLeft(getVault(), c))
  // confirmed：界面已经问过了（文件树里选了好几个一起删，一个确认框问完），不再弹系统确认
  ipcMain.handle('folder:trash', async (_e, folder: unknown, confirmed: unknown) => {
    const v = getVault()
    if (typeof folder !== 'string') throw new Error('文件夹不对')
    const n = await countFiles(v, folder)
    if (confirmed === true) {
      const trashDir = process.env.CN_TRASH_DIR
      try {
        return await trashFolder(v, folder, trashDir ? testTrash(trashDir) : (abs) => shell.trashItem(abs))
      } finally {
        changed()
      }
    }
    const win = getWin()
    const ask = {
      type: 'warning' as const,
      message: `把「${folder.split('/').pop()}」${n ? `和里面 ${n} 个文件` : ''}移到废纸篓？`,
      detail: '会提交一次，在历史里能撤回；也能在访达的废纸篓里找回。',
      buttons: ['移到废纸篓', '取消'],
      defaultId: 0,
      cancelId: 1,
    }
    const r = win ? await dialog.showMessageBox(win, ask) : await dialog.showMessageBox(ask)
    if (r.response !== 0) return null
    const trashDir = process.env.CN_TRASH_DIR
    try {
      return await trashFolder(v, folder, trashDir ? testTrash(trashDir) : (abs) => shell.trashItem(abs))
    } finally {
      changed()
    }
  })
}
