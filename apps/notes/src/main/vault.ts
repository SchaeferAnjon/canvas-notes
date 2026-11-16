import { watch, type FSWatcher, type Stats } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { attr, content, conflictCopyName, DEFAULT_META, decodeNote, encodeNote, fmValue, isMindmap, num, parseBoard, parseMindmap } from '@cn/format'
import type { NoteFile, OpenedNote, SearchHit, ThumbRect, WriteResult } from '../shared/api'
import { clipMarkdown, INBOX, kindOf, previewOf } from '../shared/layout'
import { hitSnippet } from './search/chunks'
import { mindmapThumb } from '../shared/mindmap-layout'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

/** 一个库：一个文件夹，里面是 md 文件。所有路径都相对库根目录、用 / 分隔。 */
export class Vault {
  /** 每个文件最后一次读到或写下的文字；监听到的改动和它一样就是自己写的，不报 */
  private known = new Map<string, string>()
  private watcher: FSWatcher | null = null
  private timers = new Map<string, NodeJS.Timeout>()
  /** 搜索用的全文缓存：路径 → 文字。md 才是数据，这里只是缓存；list() 读文件时顺手填上 */
  private index = new Map<string, string>()
  /** index 里是不是已经有库里所有的文件（list() 跑完一遍才算） */
  private indexed = false
  /** list() 的缓存：路径 → 上次读到时的修改时间、大小和说明。没变的文件不再读 */
  private described = new Map<string, { mtimeMs: number; size: number; file: NoteFile }>()

  constructor(readonly root: string) {}

  get name(): string {
    return basename(this.root)
  }

  /** 相对路径 → 绝对路径；不许跑出库外 */
  abs(rel: string): string {
    if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) throw new Error(`路径不对：${rel}`)
    const p = resolve(this.root, rel)
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`路径在库外：${rel}`)
    return p
  }

  rel(abs: string): string {
    return relative(this.root, abs).split(sep).join('/')
  }

  /**
   * 库里所有 md 的说明，新改的在前。
   * 大库（几千篇）每次全读一遍太慢：按「修改时间 + 大小」缓存每篇的说明，没变的不再读；
   * 读到的全文顺手放进搜索缓存，⌘F 第一次搜不用再读一遍。
   */
  async list(): Promise<NoteFile[]> {
    const paths: string[] = []
    const walk = async (dir: string) => {
      const subs: Promise<void>[] = []
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        if (ent.name.startsWith('.') && ent.isDirectory()) continue
        const p = join(dir, ent.name)
        if (ent.isDirectory()) {
          if (!SKIP_DIRS.has(ent.name)) subs.push(walk(p))
        } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) paths.push(p)
      }
      await Promise.all(subs)
    }
    await walk(this.root)
    const out: NoteFile[] = []
    // 一次最多同时开 64 个文件，几千篇也不会把文件句柄用完
    for (let i = 0; i < paths.length; i += 64) {
      for (const f of await Promise.all(paths.slice(i, i + 64).map((p) => this.describeCached(p)))) if (f) out.push(f)
    }
    const seen = new Set(out.map((f) => f.path))
    for (const rel of new Set([...this.described.keys(), ...this.index.keys()])) if (!seen.has(rel)) this.forget(rel)
    this.indexed = true
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  /** 没变（修改时间和大小都一样）就用上次的说明；文件刚被删掉返回 null */
  private async describeCached(p: string): Promise<NoteFile | null> {
    const rel = this.rel(p)
    let st: Stats
    let bytes: Buffer
    try {
      st = await stat(p)
      const hit = this.described.get(rel)
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.file
      bytes = await readFile(p)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
    const { text } = decodeNote(bytes)
    const file = describe(rel, st, text)
    this.described.set(rel, { mtimeMs: st.mtimeMs, size: st.size, file })
    this.index.set(rel, text)
    return file
  }

  /** 文件没了：说明和搜索缓存一起丢掉 */
  private forget(rel: string) {
    this.described.delete(rel)
    this.index.delete(rel)
  }

  /** 在 folder 里新建，名字重了加「 2」「 3」 */
  async create(folder: string, name: string, text: string): Promise<string> {
    const dir = folder ? this.abs(folder) : this.root
    await mkdir(dir, { recursive: true })
    const base = safeName(name)
    for (let n = 1; ; n++) {
      const target = join(dir, `${base}${n > 1 ? ` ${n}` : ''}.md`)
      try {
        await writeFile(target, encodeNote(text, DEFAULT_META), { flag: 'wx' })
        const rel = this.rel(target)
        this.known.set(rel, text)
        this.reindex(rel, text)
        return rel
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
  }

  async rename(rel: string, newName: string): Promise<string> {
    const from = this.abs(rel)
    const to = join(dirname(from), `${safeName(newName)}.md`)
    if (to === from) return rel
    try {
      await stat(to)
      throw new Error(`已经有一篇叫「${safeName(newName)}」了`)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    await rename(from, to)
    const newRel = this.rel(to)
    const text = this.known.get(rel)
    this.known.delete(rel)
    if (text !== undefined) this.known.set(newRel, text)
    this.moved(rel, newRel)
    await this.relink(basename(rel, '.md'), safeName(newName))
    return newRel
  }

  /** 改名后把所有 [[旧名]]、[[旧名|…]]、[[旧名#…]] 换成新名。打开着的笔记会通过监听收到改动并合并 */
  private async relink(oldName: string, newName: string) {
    const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\[\\[${esc}(?=[\\]|#^])`, 'g')
    for (const f of await this.list()) {
      const p = this.abs(f.path)
      const bytes = await readFile(p)
      const { text, meta } = decodeNote(bytes)
      if (meta.readOnly || !re.test(text)) continue
      re.lastIndex = 0
      await writeFile(p, encodeNote(text.replace(re, `[[${newName}`), meta))
    }
  }

  async createBoard(folder: string, name: string): Promise<string> {
    const colors = ['#4A7FA7', '#A8775A', '#6E8A5C', '#8A6AA8', '#A85A6E', '#5A8F8A']
    const color = colors[Math.floor(Math.random() * colors.length)]
    return this.create(folder, name, `---\ntype: board\ncolor: ${color}\n---\n`)
  }

  /** 挪到另一个文件夹（名字重了加序号），返回新路径 */
  async move(rel: string, toFolder: string): Promise<string> {
    const from = this.abs(rel)
    const dir = this.abs(toFolder)
    await mkdir(dir, { recursive: true })
    const base = basename(rel, '.md')
    for (let n = 1; ; n++) {
      const target = join(dir, `${base}${n > 1 ? ` ${n}` : ''}.md`)
      try {
        await stat(target)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        await rename(from, target)
        const text = this.known.get(rel)
        this.known.delete(rel)
        const newRel = this.rel(target)
        if (text !== undefined) this.known.set(newRel, text)
        this.moved(rel, newRel)
        return newRel
      }
    }
  }

  /** 速记：一句话进收件箱，文件名用开头几个字，创建时间（和来源网址）写进 frontmatter */
  async capture(text: string, now = new Date(), source?: string): Promise<string> {
    const body = text.trim()
    if (!body) throw new Error('速记是空的')
    const first = body.split('\n')[0]!.replace(/^>\s*/, '').slice(0, 24)
    const src = source && /^https?:\/\/\S+$/.test(source) ? `source: ${source}\n` : ''
    return this.create(INBOX, first, `---\ncreated: ${localStamp(now)}\n${src}---\n${body}\n`)
  }

  /** 网页剪的一段进收件箱：引文加来源，来源网址写进 frontmatter */
  async clip(text: string, url: string, title: string, now = new Date()): Promise<string> {
    const body = text.trim()
    if (!body) throw new Error('没有选中文字')
    const first = body.split('\n')[0]!.slice(0, 24)
    return this.create(INBOX, first, `---\ncreated: ${localStamp(now)}\nsource: ${url}\n---\n${clipMarkdown(body, title, url)}\n`)
  }

  /** 全文搜索：每个词都要出现在标题或正文里；标题命中排前面 */
  async search(q: string, limit = 40): Promise<SearchHit[]> {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    if (!this.indexed) await this.list()
    const hits: (SearchHit & { score: number })[] = []
    for (const [path, text] of this.index) {
      const title = basename(path, '.md').toLowerCase()
      const low = text.toLowerCase()
      if (!words.every((w) => title.includes(w) || low.includes(w))) continue
      const inTitle = words.filter((w) => title.includes(w)).length
      const first = words.map((w) => low.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0]
      hits.push({ path, snippet: '', score: inTitle * 100 + (first === undefined ? 0 : 50 - Math.min(50, first / 100)) })
    }
    return hits
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ path }) => ({ path, snippet: hitSnippet(this.index.get(path)!, words) }))
  }

  private reindex(rel: string, text: string | null) {
    if (text === null) this.forget(rel)
    else this.index.set(rel, text)
  }

  /** 改名、挪走：搜索缓存跟着换路径；说明下次 list() 再读 */
  private moved(from: string, to: string) {
    const text = this.index.get(from)
    this.forget(from)
    if (text !== undefined) this.index.set(to, text)
  }

  async read(rel: string): Promise<OpenedNote> {
    const { text, meta } = decodeNote(await readFile(this.abs(rel)))
    this.known.set(rel, text)
    return { path: rel, text, readOnly: meta.readOnly }
  }

  /**
   * 先比后写：磁盘上还是 base 才写，否则把磁盘上的还回去让界面合并。
   * 写的时候沿用磁盘上文件的 BOM 和换行。
   */
  async write(rel: string, text: string, base: string): Promise<WriteResult> {
    const p = this.abs(rel)
    if (!p.toLowerCase().endsWith('.md')) throw new Error(`只写 md 文件：${rel}`)
    let meta = DEFAULT_META
    let bytes: Buffer | null = null
    try {
      bytes = await readFile(p)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    if (bytes) {
      const disk = decodeNote(bytes)
      if (disk.meta.readOnly) throw new Error(`这个文件只能只读打开：${rel}`)
      if (disk.text !== base) {
        this.known.set(rel, disk.text)
        return { ok: false, diskText: disk.text }
      }
      if (disk.text === text) return { ok: true }
      meta = disk.meta
    }
    this.known.set(rel, text)
    await writeFile(p, encodeNote(text, meta))
    this.reindex(rel, text)
    return { ok: true }
  }

  async saveConflictCopy(rel: string, text: string): Promise<string> {
    const p = this.abs(rel)
    const now = new Date()
    for (let n = 1; ; n++) {
      const target = join(dirname(p), conflictCopyName(basename(p), now, n))
      try {
        await writeFile(target, encodeNote(text, DEFAULT_META), { flag: 'wx' })
        return this.rel(target)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
  }

  watch(onNoteChanged: (rel: string, text: string) => void, onFilesChanged: () => void): void {
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const rel = filename.split(sep).join('/')
      if (rel.split('/').some((part) => SKIP_DIRS.has(part))) return
      // PDF、HTML 加了、删了、改了：只报「文件变了」（目录树、⌘O、PDF 列表跟着刷新），不当笔记读
      if (/\.(pdf|html?)$/i.test(rel) && !rel.split('/').some((part) => part.startsWith('.'))) {
        clearTimeout(this.timers.get(rel))
        this.timers.set(
          rel,
          setTimeout(() => {
            this.timers.delete(rel)
            onFilesChanged()
          }, 300),
        )
        return
      }
      if (!rel.toLowerCase().endsWith('.md')) return
      // 同一个文件一次保存常常连着来好几个事件，等它停 50ms 再读
      clearTimeout(this.timers.get(rel))
      this.timers.set(
        rel,
        setTimeout(() => {
          this.timers.delete(rel)
          void this.check(rel, onNoteChanged, onFilesChanged)
        }, 50),
      )
    })
  }

  private async check(rel: string, onNoteChanged: (rel: string, text: string) => void, onFilesChanged: () => void) {
    let bytes: Buffer
    try {
      bytes = await readFile(this.abs(rel))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      this.known.delete(rel)
      this.reindex(rel, null)
      onFilesChanged()
      return
    }
    const prev = this.known.get(rel)
    const { text } = decodeNote(bytes)
    this.index.set(rel, text)
    if (prev === undefined) {
      onFilesChanged()
      return
    }
    if (prev === text) return
    this.known.set(rel, text)
    onNoteChanged(rel, text)
    onFilesChanged()
  }

  close(): void {
    this.watcher?.close()
    for (const t of this.timers.values()) clearTimeout(t)
  }
}

/** 文件名里不能有的字符换掉；空的叫「未命名」 */
export function safeName(name: string): string {
  const s = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  return s || '未命名'
}

/** 2026-11-15 14:03 */
export function localStamp(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 一篇的说明：哪一类、是不是草稿、白板的缩略图、收件箱和素材的预览和来源 */
function describe(rel: string, st: Stats, text: string): NoteFile {
  const { kind, topic } = kindOf(rel)
  const file: NoteFile = { path: rel, mtimeMs: st.mtimeMs, createdMs: st.birthtimeMs, kind }
  if (topic) file.topic = topic
  if (fmValue(text, 'draft') === 'true') file.draft = true
  if (fmValue(text, 'type') === 'board') {
    const blocks = parseBoard(text).blocks
    const cards = blocks.filter((b) => b.kind === 'card').length
    // 缩略图：画布上的卡片和列大概摆在哪、多高
    const thumb: ThumbRect[] = []
    for (const b of blocks) {
      if (attr(b, 'in')) continue
      const body = content(b)
      const w = num(b, 'w', b.kind === 'column' ? 300 : 280)
      if (b.kind === 'column') {
        const n = blocks.filter((x) => attr(x, 'in') === attr(b, 'id')).length
        thumb.push({ x: num(b, 'x', 0), y: num(b, 'y', 0), w, h: 60 + n * 90, k: 'l' })
      } else {
        const k = /!\[[^\]]*\]\(/.test(body) ? 'i' : /^——\s*\[|\n——\s*\[/.test(body) ? 'c' : 'n'
        const h = k === 'i' ? 200 : Math.min(320, 52 + Math.ceil(body.length / (w / 14)) * 22)
        thumb.push({ x: num(b, 'x', 0), y: num(b, 'y', 0), w, h, k })
      }
    }
    file.board = { color: fmValue(text, 'color') ?? '#8E8E96', cards, thumb }
    // 导图白板：节点不算卡片，缩略图按节点排出来的位置画，首页写「N 个节点」
    if (isMindmap(text)) {
      const m = mindmapThumb(parseMindmap(text).roots, /!\[[^\]]*\]\(/.test(text))
      file.board.nodes = m.nodes
      file.board.thumb = [...m.thumb, ...thumb]
    }
    const icon = fmValue(text, 'icon')
    if (icon) file.board.icon = icon
  }
  if (kind !== 'work') {
    file.preview = previewOf(text)
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
    const created = /^created:\s*(.+)$/m.exec(fm)?.[1]
    const t = created ? Date.parse(created.trim().replace(' ', 'T')) : NaN
    if (!Number.isNaN(t)) file.createdMs = t
    const source = /^source:\s*(.+)$/m.exec(fm)?.[1]
    if (source) file.source = source.trim()
  }
  return file
}
