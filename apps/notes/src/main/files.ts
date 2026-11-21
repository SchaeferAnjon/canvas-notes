/**
 * 库里的全部文件：md、PDF、HTML、附件/ 里的图和别的文件、文件夹（⌘O、目录树用）。PDF 带上问到第几页（旁边笔记的属性「进度」）。
 * 只读每篇笔记开头一小段找属性，几千个文件也快。附件/ 在树里看得到（four-items 1a、CN-104）。
 * 「附件」筛选要的「哪篇笔记用哪些附件」另外算（attachIndex，只在选了「附件」时读全库）。
 */
import { ipcMain } from 'electron'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { ATTACHMENTS_DIR, attachmentDir, decodeNote, linkedPaths, notePathFor, parseReadingNote, prop } from '@cn/format'
import { type AttachIndex, type FileEntry, type FileKind, parseProgress } from '../shared/files'
import type { Vault } from './vault'

const SKIP_DIRS = new Set(['node_modules'])
const IMAGE = /\.(png|jpe?g|gif|webp|svg|heic|bmp|avif)$/i

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
      // 附件/ 里别的文件也列出来（图、附件）；md、PDF、HTML 照常能开
      const inAttach = path.startsWith(ATTACHMENTS_DIR + '/')
      const kind = ent.isFile() ? (kindOf(ent.name) ?? (inAttach ? (IMAGE.test(ent.name) ? 'img' : 'att') : null)) : null
      if (!kind) continue
      try {
        const st = await stat(abs)
        out.push({ path, kind, mtimeMs: st.mtimeMs, ctimeMs: st.birthtimeMs, ...(kind === 'img' || kind === 'att' ? { bytes: st.size } : {}) })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
  }
  await walk(root)
  const have = new Set(out.map((f) => f.path))
  for (const f of out) {
    if (f.kind === 'html') {
      const m = /<meta\s+name="第几讲"\s+content="(\d+)"/.exec(await head(join(root, f.path)))
      if (m) f.lecture = Number(m[1])
    }
    if (f.kind !== 'pdf' && f.kind !== 'html') continue
    // 一个 PDF 一篇笔记：旁边那篇「<名字> 笔记.md」和里面问了几问（目录树里合成一行），PDF 还带问到第几页
    const note = notePathFor(f.path)
    if (!have.has(note)) continue
    const text = decodeNote(await readFile(join(root, note))).text
    f.note = { path: note, asks: parseReadingNote(text, note).reduce((n, s) => n + s.rounds, 0) }
    if (f.kind !== 'pdf') continue
    const p = parseProgress(prop(text.slice(0, 4096), '进度'))
    if (p) f.progress = p
  }
  return out
}

/**
 * 「附件」筛选（CN-104）：每篇笔记用到的附件（自己的附件文件夹 附件/<笔记路径>/ 里的，加上文中引用的 附件/ 里的），
 * 和没有哪篇在用的附件。files 是 listEntries 的结果
 */
export async function attachIndex(root: string, files: FileEntry[]): Promise<AttachIndex> {
  const atts = files.filter((f) => f.kind !== 'dir' && f.path.startsWith(ATTACHMENTS_DIR + '/'))
  const byPath = new Map(atts.map((f) => [f.path, f]))
  const used = new Set<string>()
  const notes: AttachIndex['notes'] = []
  for (const n of files) {
    if (n.kind !== 'md' || n.path.startsWith(ATTACHMENTS_DIR + '/')) continue
    const dir = attachmentDir(n.path) + '/'
    const mine = new Set(atts.filter((f) => f.path.startsWith(dir)).map((f) => f.path))
    const text = decodeNote(await readFile(join(root, n.path))).text
    for (const p of linkedPaths(text, n.path)) if (byPath.has(p)) mine.add(p)
    if (!mine.size) continue
    for (const p of mine) used.add(p)
    // 自己附件文件夹里的在前，文中用到的别处的在后
    const own = (p: string) => (p.startsWith(dir) ? 0 : 1)
    notes.push({ note: n.path, items: [...mine].sort((a, b) => own(a) - own(b) || a.localeCompare(b, 'zh-CN', { numeric: true })).map((p) => ({ path: p, bytes: byPath.get(p)!.bytes ?? 0 })) })
  }
  const orphans = atts.filter((f) => !used.has(f.path)).map((f) => ({ path: f.path, bytes: f.bytes ?? 0 }))
  return { notes, orphans }
}

export function registerFiles(vault: () => Vault | null) {
  ipcMain.handle('files:all', () => {
    const v = vault()
    if (!v) throw new Error('还没有打开库')
    return listEntries(v.root)
  })
  ipcMain.handle('files:attachments', async () => {
    const v = vault()
    if (!v) throw new Error('还没有打开库')
    return attachIndex(v.root, await listEntries(v.root))
  })
}
