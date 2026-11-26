/**
 * 读一个放 md 的文件夹（旧的 Obsidian 库之类）：md 原样拷进来，图片和别的附件拷进 附件/导入/<来源>/（保留原来的子文件夹），
 * 链接改成指向新位置：![[图.png]]、[[文件.pdf]] 变成普通的相对链接，![[图.png|300]] 写成 ![|300](…) 宽留着；
 * 指到这次一起导的笔记的 [[笔记]]、[[子文件夹/笔记|别名]] 先记下指的是哪一篇，写盘时名字在整个库里不重的只留名字（挪到哪都能点），
 * 重的写成新位置的路径（write.ts）；指不到的、指到没选的文件夹里的原样留着。
 * 整段的 %%注释%% 变成收起的提示块（@cn/format 的 obsidianComments）。属性只加不删。不依赖 Electron。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, posix } from 'node:path'
import { decodeNote, obsidianComments, prop } from '@cn/format'
import type { ImportFolder } from '../../shared/import'
import { attRef, noteRef, type ImportNote } from './write'

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
  /** 最外层 . 开头、没拷的（.obsidian、.git、.trash……） */
  hidden: string[]
}

/**
 * 走一遍文件夹：.开头的（.obsidian、.trash、.git，不管是文件夹还是 .git 指针文件）不进。
 * .git：原来的 Git 历史（用户的库里是一个指到别的电脑的指针文件，拷进来以后库里每次 git 都会失败），新库从这次导入开始记自己的历史；
 * .obsidian：Obsidian 自己的设置和插件，画布笔记不认，拷进来只会多几百个没用的文件进历史；原来的库一个字都不动，要用回 Obsidian 照旧在
 */
export async function scanMdFolder(dir: string): Promise<MdScan> {
  const notes: MdFile[] = []
  const files: MdFile[] = []
  const hidden: string[] = []
  const walk = async (rel: string) => {
    for (const ent of await readdir(join(dir, rel), { withFileTypes: true })) {
      if (ent.name.startsWith('.') && !rel && ent.name !== '.DS_Store') hidden.push(ent.name)
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
  return { dir, notes, files, hidden: hidden.sort() }
}

/** 去掉这些文件（下不下来的占位文件、读不了的）以后的样子：链接指到它们的原样留着 */
export function withoutFiles(scan: MdScan, drop: ReadonlySet<string>): MdScan {
  if (!drop.size) return scan
  return { ...scan, notes: scan.notes.filter((f) => !drop.has(f.rel)), files: scan.files.filter((f) => !drop.has(f.rel)) }
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
export async function readMdFolder(
  scan: MdScan,
  folders: string[],
  source: string,
  o: { signal?: AbortSignal; onProgress?(done: number, total: number, title: string): void } = {},
): Promise<{ notes: ImportNote[]; extra: { src: string; name: string }[]; lost: Record<string, number> }> {
  const pick = new Set(folders)
  const lost: Record<string, number> = {}
  const noteByRel = new Map<string, MdFile>()
  for (const n of scan.notes) noteByRel.set(n.rel.toLowerCase(), n)
  /** 文件名（小写、带 .md）→ 叫这个名字的几篇：按名字找不用每次把几千篇全过一遍 */
  const noteByName = new Map<string, MdFile[]>()
  for (const n of scan.notes) {
    const k = basename(n.rel).toLowerCase()
    noteByName.set(k, [...(noteByName.get(k) ?? []), n])
  }
  /** [[笔记]] 指的是源库里哪一篇（Obsidian 的找法）：先按这篇的相对路径、再按库根，都没有按名字（或路径的后几截），同一个文件夹的先、路径短的先 */
  const findNote = (target: string, fromDir: string): MdFile | undefined => {
    let t = target.trim()
    try {
      t = decodeURI(t)
    } catch {
      // 不是转义过的，原样用
    }
    t = t.replace(/^\.?\//, '').replace(/\.md$/i, '')
    if (!t) return undefined
    const hit = noteByRel.get(posix.normalize(fromDir ? `${fromDir}/${t}` : t).toLowerCase() + '.md') ?? noteByRel.get(t.toLowerCase() + '.md')
    if (hit) return hit
    const low = t.toLowerCase() + '.md'
    const away = (n: MdFile) => Number(dirOf(n.rel) !== fromDir)
    return (noteByName.get(basename(low)) ?? [])
      .filter((n) => {
        const l = n.rel.toLowerCase()
        return l === low || l.endsWith('/' + low)
      })
      .sort((a, b) => away(a) - away(b) || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))[0]
  }
  const byName = new Map<string, MdFile>()
  const byRel = new Map<string, MdFile>()
  for (const f of scan.files) {
    byRel.set(f.rel.toLowerCase(), f)
    if (!byName.has(basename(f.rel).toLowerCase())) byName.set(basename(f.rel).toLowerCase(), f)
  }
  const used = new Set<string>()
  const notes: ImportNote[] = []
  // 先把选中的笔记都读进来（同时读 16 篇，每读完一篇报一次进度）；读不了的（没权限、坏了）跳过，结果里列出来
  const todo = scan.notes.filter((n) => pick.has(dirOf(n.rel)))
  const raws = new Map<MdFile, string>()
  const unread: string[] = []
  let next = 0
  let read = 0
  const lane = async () => {
    while (next < todo.length) {
      o.signal?.throwIfAborted()
      const n = todo[next++]!
      try {
        raws.set(n, decodeNote(await readFile(n.abs)).text)
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (!code) throw e
        unread.push(`${n.rel}（${code}）`)
      }
      o.onProgress?.(++read, todo.length, basename(n.rel).replace(/\.md$/i, ''))
    }
  }
  await Promise.all(Array.from({ length: Math.min(16, todo.length) }, lane))
  if (unread.length) lost[`读不出来、没导的笔记：${unread.slice(0, 20).join('、')}${unread.length > 20 ? `等${unread.length}篇` : ''}`] = 0
  for (const n of todo) {
    const folder = dirOf(n.rel)
    const raw = raws.get(n)
    if (raw === undefined) continue
    const atts: { src: string; name: string }[] = []
    const links: { id: string; name: string }[] = []
    const comments = obsidianComments(raw)
    if (comments.inline) lost['一行里夹着的%%注释%%照原文留着'] = (lost['一行里夹着的%%注释%%照原文留着'] ?? 0) + comments.inline
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
    let text = comments.text
      // ![[图.png|300]]、[[文件.pdf]]：附件 → 普通链接；笔记 → 记下指哪一篇，写盘时定写名字还是路径
      .replace(/(!?)\[\[([^\]\n|#^]+)((?:#[^\]\n|]*)?)(\|[^\]\n]*)?\]\]/g, (all, bang: string, target: string, sub: string, alias: string | undefined) => {
        const isNote = !extname(target) || /\.md$/i.test(target)
        if (isNote) {
          const to = findNote(target, folder)
          if (!to || !pick.has(dirOf(to.rel))) return all
          const i = links.push({ id: `md:${source}/${to.rel}`, name: basename(to.rel).replace(/\.md$/i, '') }) - 1
          return `${bang}[[${noteRef(i)}${sub}${alias ?? ''}]]`
        }
        const f = find(target, folder)
        if (!f) return all
        const shown = alias && !/^\|\d+(x\d+)?$/.test(alias) ? alias.slice(1) : basename(f.rel)
        if (!IMAGE.test(f.rel)) return `[${label(shown)}](${ref(f)})`
        if (!bang) return `![${label(shown)}](${ref(f)})`
        // ![[图.png|300]]、![[图.png|说明|300]]：我们认 ![说明|300](…)（image-alt.ts），宽留着。只写了宽的说明空着：
        // 我们的文档把说明画在图下面，Obsidian 里这张图下面没有字，不拿文件名去填
        const size = alias ? /^(?:(.*)\|)?(\d{1,5}(?:x\d{1,5})?)$/.exec(alias.slice(1)) : null
        const alt = size ? `${size[1] ?? ''}|${size[2]}` : alias ? alias.slice(1) : ''
        return `![${label(alt)}](${ref(f)})`
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
      ...(links.length ? { links } : {}),
      id: `md:${source}/${n.rel}`,
    })
  }
  const extra = scan.files.filter((f) => pick.has(dirOf(f.rel)) && !used.has(f.abs)).map((f) => ({ src: f.abs, name: f.rel }))
  return { notes, extra, lost }
}
