/**
 * 读一个放 md 的文件夹（旧的 Obsidian 库之类）：md 原样拷进来，图片和别的附件拷进 附件/导入/<来源>/（保留原来的子文件夹），
 * 链接改成指向新位置：![[图.png]]、[[文件.pdf]] 变成普通的相对链接；[[笔记]] 原样留着（按名字找，挪到哪都能点），
 * [[子文件夹/笔记|别名]] 去掉前面的文件夹。属性只加不删。不依赖 Electron。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, posix } from 'node:path'
import { decodeNote, prop } from '@cn/format'
import type { ImportFolder } from '../../shared/import'
import { attRef, type ImportNote } from './write'

const SKIP = new Set(['node_modules'])
const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg|avif)$/i

export interface MdFile {
  rel: string
  abs: string
  size: number
  birth: number
  mtime: number
}

export interface MdScan {
  dir: string
  notes: MdFile[]
  files: MdFile[]
}

/** 走一遍文件夹：.开头的（.obsidian、.trash、.git）不进 */
export async function scanMdFolder(dir: string): Promise<MdScan> {
  const notes: MdFile[] = []
  const files: MdFile[] = []
  const walk = async (rel: string) => {
    for (const ent of await readdir(join(dir, rel), { withFileTypes: true })) {
      if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) await walk(r)
      else if (ent.isFile()) {
        const st = await stat(join(dir, r))
        const f = { rel: r, abs: join(dir, r), size: st.size, birth: st.birthtimeMs, mtime: st.mtimeMs }
        ;(/\.md$/i.test(ent.name) ? notes : files).push(f)
      }
    }
  }
  await walk('')
  return { dir, notes, files }
}

const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

/** 有 md 或附件的每个文件夹（'' 是根），带自己的篇数和附件数 */
export function mdFolders(scan: MdScan, rootName: string): ImportFolder[] {
  const map = new Map<string, ImportFolder>()
  const get = (d: string) => {
    let f = map.get(d)
    if (!f) {
      f = { id: d, name: d ? d.split('/').pop()! : rootName, path: d, depth: d ? d.split('/').length : 0, notes: 0, locked: 0, already: 0, attachments: 0 }
      map.set(d, f)
    }
    return f
  }
  for (const n of scan.notes) get(dirOf(n.rel)).notes++
  for (const f of scan.files) get(dirOf(f.rel)).attachments++
  // 中间只有子文件夹的那层也列出来，好看出层级
  for (const d of [...map.keys()]) for (let p = dirOf(d); p !== d && p; p = dirOf(p)) get(p)
  if (map.size) get('')
  return [...map.values()].sort((a, b) => (a.path === '' ? -1 : b.path === '' ? 1 : a.path.localeCompare(b.path, 'zh-CN')))
}

/** frontmatter 里的时间（created、date、创建时间……），认不出就 null */
function fmTime(text: string, keys: string[]): number | null {
  for (const k of keys) {
    const v = prop(text, k)
    if (!v) continue
    const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(v) ? v.replace(' ', 'T') : v)
    if (!Number.isNaN(t)) return t
  }
  return null
}

/**
 * 选中的文件夹里的 md → 要写进库的样子；extra 是这些文件夹里没有笔记用到的附件（也拷）。
 * 附件按 Obsidian 的规矩找：先按相对路径，再按文件名在整个文件夹里找。
 */
export async function readMdFolder(scan: MdScan, folders: string[], source: string): Promise<{ notes: ImportNote[]; extra: { src: string; name: string }[] }> {
  const pick = new Set(folders)
  const byName = new Map<string, MdFile>()
  const byRel = new Map<string, MdFile>()
  for (const f of scan.files) {
    byRel.set(f.rel.toLowerCase(), f)
    if (!byName.has(basename(f.rel).toLowerCase())) byName.set(basename(f.rel).toLowerCase(), f)
  }
  const used = new Set<string>()
  const notes: ImportNote[] = []
  for (const n of scan.notes) {
    const folder = dirOf(n.rel)
    if (!pick.has(folder)) continue
    const raw = decodeNote(await readFile(n.abs)).text
    const atts: { src: string; name: string }[] = []
    const ref = (f: MdFile) => {
      let i = atts.findIndex((a) => a.src === f.abs)
      if (i < 0) i = atts.push({ src: f.abs, name: f.rel }) - 1
      used.add(f.abs)
      return attRef(i)
    }
    const find = (target: string, fromDir: string): MdFile | undefined => {
      let t = target.trim()
      try {
        t = decodeURI(t)
      } catch {
        // 不是转义过的，原样用
      }
      const rel = posix.normalize(fromDir ? `${fromDir}/${t}` : t)
      return byRel.get(rel.toLowerCase()) ?? byRel.get(t.toLowerCase()) ?? byName.get(basename(t).toLowerCase())
    }
    const label = (s: string) => s.replace(/[[\]]/g, '')
    let text = raw
      // ![[图.png|300]]、[[文件.pdf]]：附件 → 普通链接；笔记 → 只留名字
      .replace(/(!?)\[\[([^\]\n|#^]+)((?:#[^\]\n|]*)?)(\|[^\]\n]*)?\]\]/g, (all, bang: string, target: string, sub: string, alias: string | undefined) => {
        const isNote = !extname(target) || /\.md$/i.test(target)
        if (isNote) {
          const name = basename(target.trim()).replace(/\.md$/i, '')
          return `${bang}[[${name}${sub}${alias ?? ''}]]`
        }
        const f = find(target, folder)
        if (!f) return all
        const shown = alias && !/^\|\d+(x\d+)?$/.test(alias) ? alias.slice(1) : basename(f.rel)
        return IMAGE.test(f.rel) ? `![${label(bang ? '' : shown)}](${ref(f)})` : `[${label(shown)}](${ref(f)})`
      })
      // ![说明](相对路径)、[文字](相对路径)：指向附件的换成新位置；网址和 md 不动
      .replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)(\s+"[^"\n]*")?\)/g, (all, head: string, url: string, title: string | undefined) => {
        const u = url.replace(/^<|>$/g, '')
        if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(u) || /\.md$/i.test(u.split('#')[0]!)) return all
        const f = find(u, folder)
        return f ? `${head}${ref(f)}${title ?? ''})` : all
      })
    if (text && !text.endsWith('\n')) text += '\n'
    const created = fmTime(raw, ['created', 'date', 'created_at', '创建时间', '创建日期', '日期']) ?? (n.birth > 0 ? n.birth : n.mtime)
    notes.push({
      folder,
      title: basename(n.rel).replace(/\.md$/i, ''),
      text,
      props: [['来源', source], ...(folder ? [['原文件夹', folder] as [string, string]] : [])],
      created,
      updated: fmTime(raw, ['updated', 'modified', 'updated_at', '修改时间']) ?? n.mtime,
      attachments: atts,
      id: `md:${source}/${n.rel}`,
    })
  }
  const extra = scan.files.filter((f) => pick.has(dirOf(f.rel)) && !used.has(f.abs)).map((f) => ({ src: f.abs, name: f.rel }))
  return { notes, extra }
}
