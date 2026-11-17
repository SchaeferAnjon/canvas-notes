/**
 * 库里的全部文件：md、PDF、HTML 和文件夹（⌘O、目录树用）。PDF 带上问到第几页（旁边笔记的属性「进度」）。
 * 只读每篇笔记开头一小段找属性，几千个文件也快。
 */
import { ipcMain } from 'electron'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { DOUBTS_NAME, notePathFor, prop, resolveLink } from '@cn/format'
import { doubtsIndex, type FileEntry, type FileKind, fileName, parseProgress } from '../shared/files'
import type { Vault } from './vault'

const SKIP_DIRS = new Set(['node_modules', '附件'])
/** 软件汇总的两篇的名字（还要 front matter 写着「生成: 软件」才算） */
const AUTO_NAMES = new Set([DOUBTS_NAME, '视频里的疑惑.md'])

const kindOf = (name: string): FileKind | null => {
  const low = name.toLowerCase()
  if (low.endsWith('.md')) return 'md'
  if (low.endsWith('.pdf')) return 'pdf'
  if (low.endsWith('.html') || low.endsWith('.htm')) return 'html'
  return null
}

/** 文件开头 4 KB（frontmatter 在这里） */
async function head(abs: string): Promise<string> {
  const fh = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(buf, 0, 4096, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

export async function listEntries(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  const walk = async (dir: string) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue
      const abs = join(dir, ent.name)
      const path = relative(root, abs).split(sep).join('/')
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        out.push({ path, kind: 'dir', mtimeMs: 0 })
        await walk(abs)
        continue
      }
      const kind = ent.isFile() ? kindOf(ent.name) : null
      if (!kind) continue
      try {
        const st = await stat(abs)
        out.push({ path, kind, mtimeMs: st.mtimeMs, ctimeMs: st.birthtimeMs })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
  }
  await walk(root)
  const have = new Set(out.map((f) => f.path))
  // 软件汇总的两篇：标出来、数条数；「我的疑惑」再给同一文件夹里每篇读 PDF 笔记记上几条、在哪一段
  const byPath = new Map(out.map((f) => [f.path, f]))
  for (const f of out) {
    if (f.kind !== 'md' || !AUTO_NAMES.has(fileName(f.path))) continue
    const text = await readFile(join(root, f.path), 'utf8')
    if (prop(text, '生成') !== '软件') continue
    if (fileName(f.path) === DOUBTS_NAME) {
      const idx = doubtsIndex(f.path, text, notePathFor, resolveLink)
      f.auto = { count: idx.total }
      for (const [note, d] of idx.notes) {
        const e = byPath.get(note)
        if (e) e.doubts = { ...d, summary: f.path }
      }
    } else f.auto = { count: (text.match(/^## /gm) ?? []).length }
  }
  for (const f of out) {
    if (f.kind === 'html') {
      const m = /<meta\s+name="第几讲"\s+content="(\d+)"/.exec(await head(join(root, f.path)))
      if (m) f.lecture = Number(m[1])
      continue
    }
    if (f.kind !== 'pdf') continue
    const note = notePathFor(f.path)
    if (!have.has(note)) continue
    const p = parseProgress(prop(await head(join(root, note)), '进度'))
    if (p) f.progress = p
  }
  return out
}

export function registerFiles(vault: () => Vault | null) {
  ipcMain.handle('files:all', () => {
    const v = vault()
    if (!v) throw new Error('还没有打开库')
    return listEntries(v.root)
  })
}
