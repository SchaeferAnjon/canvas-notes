/**
 * 课程主页「课件进度」（CN-2、CN-21）：
 * - 从访达拖 PDF 到卡上：拷一份进这门课的文件夹（访达里的原文件不动），重名照访达加「 2」；能撤回（删掉刚拷的那份）。
 *   这门课里已经有一模一样的（内容相同）就不再拷，告诉用户已经有了。
 * - 每份 PDF 第一页的封面：界面用 pdf.js 画好交来，存在软件设置目录 thumbs/（按路径 + 修改时间），不进库、不进 Git；
 *   界面用 cn-file://app/thumbs/<名字> 显示。
 */
import { ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import type { Vault } from './vault'

/** 拷进来的、还能撤回的（库里的路径） */
const imported = new Set<string>()

const exists = (p: string) =>
  stat(p).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return false
      throw e
    },
  )

/** 「Lecture06.pdf」在 dir 里没有就用它，有了就「Lecture06 2.pdf」「Lecture06 3.pdf」…（访达的规矩） */
export async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const base = basename(name, ext)
  for (let n = 1; ; n++) {
    const cand = n === 1 ? name : `${base} ${n}${ext}`
    if (!(await exists(join(dir, cand)))) return cand
  }
}

const sha1 = async (p: string) => createHash('sha1').update(await readFile(p)).digest('hex')

/** 这门课文件夹里（含子文件夹）和 file 内容一样的 PDF：先比大小，大小一样再比内容 */
async function sameIn(dir: string, file: string, size: number): Promise<string | null> {
  let hash: string | null = null
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || extname(e.name).toLowerCase() !== '.pdf') continue
    const p = join(e.parentPath, e.name)
    if ((await stat(p)).size !== size) continue
    hash ??= await sha1(file)
    if ((await sha1(p)) === hash) return p
  }
  return null
}

/** 拷进课程文件夹：只收 PDF；返回拷进来的库里路径、没收的文件名、这门课里已经有一模一样的（库里那份的路径） */
export async function importPdfs(v: Vault, folder: string, paths: string[]): Promise<{ added: string[]; skipped: string[]; already: string[] }> {
  if (!/^课程\/[^/]+$/.test(folder)) throw new Error('只能拷进一门课的文件夹')
  const dir = v.abs(folder)
  await mkdir(dir, { recursive: true })
  const added: string[] = []
  const skipped: string[] = []
  const already: string[] = []
  for (const p of paths) {
    if (typeof p !== 'string' || !isAbsolute(p)) throw new Error('文件路径不对')
    const st = await stat(p)
    if (extname(p).toLowerCase() !== '.pdf' || !st.isFile()) {
      skipped.push(basename(p))
      continue
    }
    // 同一份再拖一次（同一次拖了两份一样的也算）：不再悄悄多出「Lecture06 2.pdf」
    const same = await sameIn(dir, p, st.size)
    if (same) {
      already.push(`${folder}/${relative(dir, same).split(sep).join('/')}`)
      continue
    }
    const name = await freeName(dir, basename(p))
    await copyFile(p, join(dir, name))
    const rel = `${folder}/${name}`
    imported.add(rel)
    added.push(rel)
  }
  return { added, skipped, already }
}

/** 撤回刚拷进来的（只删这次会话里拷进来的那几份） */
export async function unimportPdfs(v: Vault, paths: string[]): Promise<void> {
  for (const p of paths) {
    if (!imported.has(p)) throw new Error('只能撤回刚拷进来的课件')
    await rm(v.abs(p), { force: true })
    imported.delete(p)
  }
}

const thumbName = (path: string, mtimeMs: number) => createHash('sha1').update(`${path}\0${Math.round(mtimeMs)}`).digest('hex').slice(0, 24) + '.png'
const thumbUrl = (name: string) => `cn-file://app/thumbs/${name}`

export function registerSlides(getVault: () => Vault, appDir: string, changed: () => void) {
  const dir = join(appDir, 'thumbs')
  ipcMain.handle('slides:import', async (_e, folder: unknown, paths: unknown) => {
    if (typeof folder !== 'string' || !Array.isArray(paths)) throw new Error('参数不对')
    const r = await importPdfs(getVault(), folder, paths as string[])
    if (r.added.length) changed()
    return r
  })
  ipcMain.handle('slides:unimport', async (_e, paths: unknown) => {
    if (!Array.isArray(paths)) throw new Error('参数不对')
    await unimportPdfs(getVault(), paths as string[])
    changed()
  })
  ipcMain.handle('slides:thumb', async (_e, path: unknown, mtimeMs: unknown) => {
    if (typeof path !== 'string' || typeof mtimeMs !== 'number') throw new Error('参数不对')
    const name = thumbName(path, mtimeMs)
    return (await exists(join(dir, name))) ? thumbUrl(name) : null
  })
  ipcMain.handle('slides:thumb:put', async (_e, path: unknown, mtimeMs: unknown, png: unknown) => {
    if (typeof path !== 'string' || typeof mtimeMs !== 'number' || !(png instanceof Uint8Array) || png.length > 8 * 1024 * 1024) throw new Error('参数不对')
    const name = thumbName(path, mtimeMs)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, name), png)
    return thumbUrl(name)
  })
}
