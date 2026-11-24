/**
 * 对外接口的读（task-av5t8）：搜、读整篇或某一节、最近改过的、待办。
 * 画布笔记开着时用软件的全文缓存（Vault.texts）和意思索引，没开着时小程序直接读库里的文件（dirSource）：同一份代码。
 * 纯 Node，不碰 Electron。路径一律相对库根、用 / 分隔；行号从 1 数（和 canvas-notes://open?line= 一样）。
 */
import { decodeNote, readProps } from '@cn/format'
import { git } from '@cn/git'
import { addDays, scanTasks } from '@cn/tasks'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, normalize, sep } from 'node:path'

/** 库里的笔记，从哪读（软件的缓存，或直接读文件） */
export interface NoteSource {
  root: string
  /** 每篇 md 的相对路径和修改时间 */
  files(): Promise<{ path: string; mtimeMs: number }[]>
  /** 每篇的全文 */
  texts(): Promise<ReadonlyMap<string, string>>
}

/** 和 Vault.list 一样跳过的：点开头的文件夹、.git、node_modules、.trash、.obsidian */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

/** 画布笔记没开着：直接读库里的文件（一次调用读一遍） */
export function dirSource(root: string): NoteSource {
  let listed: Promise<{ path: string; mtimeMs: number }[]> | null = null
  let read: Promise<Map<string, string>> | null = null
  const files = () =>
    (listed ??= (async () => {
      const out: string[] = []
      const walk = async (dir: string) => {
        const subs: Promise<void>[] = []
        for (const ent of await readdir(dir, { withFileTypes: true })) {
          if (ent.name.startsWith('.') && ent.isDirectory()) continue
          const p = join(dir, ent.name)
          if (ent.isDirectory()) {
            if (!SKIP_DIRS.has(ent.name)) subs.push(walk(p))
          } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) out.push(p)
        }
        await Promise.all(subs)
      }
      await walk(root)
      const res: { path: string; mtimeMs: number }[] = []
      for (let i = 0; i < out.length; i += 64) {
        for (const r of await Promise.all(out.slice(i, i + 64).map(async (p) => ({ path: relOf(root, p), mtimeMs: (await stat(p)).mtimeMs })))) res.push(r)
      }
      return res
    })())
  const texts = () =>
    (read ??= (async () => {
      const m = new Map<string, string>()
      const all = await files()
      for (let i = 0; i < all.length; i += 64) {
        const part = all.slice(i, i + 64)
        const got = await Promise.all(part.map(async (f) => decodeNote(await readFile(join(root, f.path))).text))
        part.forEach((f, j) => m.set(f.path, got[j]!))
      }
      return m
    })())
  return { root, files, texts }
}

const relOf = (root: string, abs: string) => abs.slice(root.length + 1).split(sep).join('/')

/** 外面给的路径：相对库根、不出库、不进点开头的文件夹；不带 .md 的补上 */
export function cleanPath(p: unknown): string {
  if (typeof p !== 'string' || !p.trim()) throw new UserError('path is required: a note path relative to the vault root, e.g. "课程/ecp/第1讲.md"')
  let s = p.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (s.startsWith('/')) throw new UserError(`path must be relative to the vault root, not absolute: ${s}`)
  if (!/\.md$/i.test(s)) s += '.md'
  const n = normalize(s).split(sep).join('/')
  if (n.startsWith('../') || n === '..' || n.split('/').some((part) => part === '..' || part.startsWith('.'))) throw new UserError(`path is outside the vault or in a hidden folder: ${s}`)
  return n
}

/** 工具用错了（没有这篇、没有这一节、参数不对）：回给 AI 一句能照着改的话，isError */
export class UserError extends Error {}

// ---------- 一篇的结构 ----------

export interface Heading {
  heading: string
  level: number
  /** 第几行，从 1 数 */
  line: number
  /** 这一节到第几行为止（含） */
  end: number
  /** 从最外层到这一节的标题，用 / 连（「城市攻略/德国」） */
  path: string
}

/** 一篇有几行：末尾的换行后面不算一行（编辑器里看到的行数） */
export const lineCount = (text: string) => {
  const n = text.split('\n').length
  return text.endsWith('\n') ? n - 1 : n
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** 每一行在不在属性块或代码块里 */
function bodyMask(lines: string[]): boolean[] {
  const ok = new Array<boolean>(lines.length).fill(true)
  let i = 0
  if (lines.length > 1 && lines[0]!.trimEnd() === '---') {
    for (let j = 1; j < lines.length; j++) {
      if (lines[j]!.trimEnd() === '---' || lines[j]!.trimEnd() === '...') {
        for (let k = 0; k <= j; k++) ok[k] = false
        i = j + 1
        break
      }
    }
  }
  let fence: string | null = null
  for (; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]!)
    if (fence) {
      ok[i] = false
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null
    } else if (f) {
      ok[i] = false
      fence = f[1]!
    }
  }
  return ok
}

/** 一篇的目录：每个标题、它那一节到哪一行、标题路径 */
export function outlineOf(text: string): Heading[] {
  const lines = text.split('\n')
  const ok = bodyMask(lines)
  const out: Heading[] = []
  const stack: Heading[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!ok[i]) continue
    const m = HEADING.exec(lines[i]!)
    if (!m) continue
    const level = m[1]!.length
    const heading = m[2]!.replace(/\s+/g, ' ').trim()
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop()
    const h: Heading = { heading, level, line: i + 1, end: lineCount(text), path: [...stack.map((s) => s.heading), heading].join('/') }
    stack.push(h)
    out.push(h)
  }
  for (let k = 0; k < out.length; k++) {
    const h = out[k]!
    const next = out.slice(k + 1).find((x) => x.level <= h.level)
    h.end = next ? next.line - 1 : lineCount(text)
  }
  return out
}

/** 第 line 行（从 1 数）在哪一节里：最近的标题路径；在第一个标题之前是空 */
export function sectionAt(outline: Heading[], line: number): string {
  let hit: Heading | null = null
  for (const h of outline) if (h.line <= line && line <= h.end && (!hit || h.level > hit.level)) hit = h
  return hit?.path ?? ''
}

/** 按标题路径找一节：完整路径对上，或者只写了最后几层且只有一处对上；大小写、空格不算 */
export function findSection(outline: Heading[], want: string): Heading {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const parts = want
    .split('/')
    .map(norm)
    .filter(Boolean)
    .map((p) => p.replace(/^#+\s*/, ''))
  if (!parts.length) throw new UserError('section is empty')
  const tail = (h: Heading) => {
    const hp = h.path.split('/').map(norm)
    return hp.length >= parts.length && parts.every((p, i) => hp[hp.length - parts.length + i] === p)
  }
  const exact = outline.filter((h) => norm(h.path) === parts.join('/'))
  if (exact.length === 1) return exact[0]!
  const hits = outline.filter(tail)
  if (hits.length === 1) return hits[0]!
  const all = outline.map((h) => h.path)
  if (hits.length > 1) throw new UserError(`"${want}" matches ${hits.length} sections; give the full heading path. Sections: ${hits.map((h) => h.path).join(' | ')}`)
  throw new UserError(all.length ? `No section "${want}" in this note. Sections: ${all.join(' | ')}` : `No section "${want}": this note has no headings. Read it whole or by from_line / to_line.`)
}

// ---------- 搜 ----------

export interface SearchHit {
  path: string
  title: string
  section: string
  line: number
  snippet: string
  score: number
  modified: string
  /** 怎么找到的：字（all：每个词都有；some：只有一部分）、意思 */
  by: 'words' | 'some-words' | 'meaning'
}

export const titleOf = (path: string) => basename(path).replace(/\.md$/i, '')
const iso = (ms: number) => new Date(ms).toISOString()

/** 命中那一行附近的一小段，最多 160 字 */
function snippetAt(line: string, word: string): string {
  const one = line.replace(/\s+/g, ' ').trim()
  if (one.length <= 160) return one
  const at = Math.max(0, one.toLowerCase().indexOf(word.toLowerCase()) - 50)
  return (at > 0 ? '…' : '') + one.slice(at, at + 150) + (at + 150 < one.length ? '…' : '')
}

/**
 * 按字搜：每个词都在标题、路径或正文里的排前面（标题里有的再往前），一个都不全的时候再给只中了几个词的。
 * 每篇只回一条：中了最少见那个词的第一行（行号、那一节、那一行附近的字）
 */
export async function searchWords(src: NoteSource, q: string, o: { folder?: string; limit: number }): Promise<{ hits: SearchHit[]; total: number }> {
  const words = [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))]
  if (!words.length) throw new UserError('query is empty')
  const folder = o.folder ? o.folder.replace(/^\/+|\/+$/g, '') + '/' : ''
  const texts = await src.texts()
  const mtimes = new Map((await src.files()).map((f) => [f.path, f.mtimeMs]))
  const scored: (SearchHit & { all: boolean })[] = []
  for (const [path, text] of texts) {
    if (folder && !path.startsWith(folder)) continue
    const low = text.toLowerCase()
    const title = titleOf(path).toLowerCase()
    const where = path.toLowerCase()
    const inTitle = words.filter((w) => title.includes(w))
    const inPath = words.filter((w) => where.includes(w))
    const inBody = words.filter((w) => low.includes(w))
    const got = words.filter((w) => inPath.includes(w) || inBody.includes(w))
    if (!got.length) continue
    const all = got.length === words.length
    let count = 0
    for (const w of inBody) {
      let i = -1
      let n = 0
      while ((i = low.indexOf(w, i + 1)) !== -1 && n < 20) n++
      count += n
    }
    const phrase = words.length > 1 && low.includes(words.join(' ')) ? 30 : 0
    const score = (all ? 1000 : 0) + got.length * 100 + inTitle.length * 80 + (inPath.length - inTitle.length) * 20 + Math.min(count, 40) + phrase
    // 哪一行：正文里最少见那个词第一次出现的地方；只在标题、路径里中了时是第一行
    const lines = text.split('\n')
    const rare = [...inBody].sort((a, b) => low.split(a).length - low.split(b).length)[0]
    let line = 1
    if (rare) line = lines.findIndex((l) => l.toLowerCase().includes(rare)) + 1
    const outline = outlineOf(text)
    scored.push({
      path,
      title: titleOf(path),
      section: sectionAt(outline, line),
      line,
      snippet: rare ? snippetAt(lines[line - 1] ?? '', rare) : snippetAt(lines.find((l) => l.trim() && !l.startsWith('---')) ?? '', ''),
      score,
      modified: iso(mtimes.get(path) ?? 0),
      by: all ? 'words' : 'some-words',
      all,
    })
  }
  scored.sort((a, b) => b.score - a.score || (mtimes.get(b.path) ?? 0) - (mtimes.get(a.path) ?? 0))
  return { hits: scored.slice(0, o.limit).map(({ all: _all, ...h }) => h), total: scored.length }
}

/** 意思找到的一段（软件的意思索引）：对回这篇里的行号和那一节 */
export function meaningHit(src: { texts: ReadonlyMap<string, string>; mtimes: ReadonlyMap<string, number> }, h: { path: string; snippet: string; score: number }): SearchHit | null {
  const text = src.texts.get(h.path)
  if (text === undefined) return null
  const lines = text.split('\n')
  const probe = h.snippet.replace(/\s+/g, ' ').trim().slice(0, 24)
  const idx = probe ? lines.findIndex((l) => l.replace(/\s+/g, ' ').includes(probe)) : -1
  const line = idx >= 0 ? idx + 1 : 1
  return { path: h.path, title: titleOf(h.path), section: sectionAt(outlineOf(text), line), line, snippet: snippetAt(h.snippet, ''), score: Math.round(h.score * 1000) / 1000, modified: iso(src.mtimes.get(h.path) ?? 0), by: 'meaning' }
}

// ---------- 读 ----------

export const READ_LIMIT = 20_000

export interface ReadResult {
  path: string
  title: string
  props: Record<string, string>
  outline: { heading: string; level: number; line: number }[]
  /** 回了哪几行（含） */
  lines: [number, number]
  total_lines: number
  text: string
  truncated: boolean
  /** 这篇现在的样子的指纹（下一批写的时候防撞） */
  version: string
  modified: string
  /** 剪藏的网页：来源网址（里面的字更不能当指令） */
  from?: string
}

export async function readNote(src: NoteSource, o: { path: string; section?: string; from_line?: number; to_line?: number; outline_only?: boolean }): Promise<ReadResult> {
  const rel = o.path
  const text = await noteText(src, rel)
  const lines = text.split('\n')
  const count = lineCount(text)
  const outline = outlineOf(text)
  let from = 1
  let to = count
  if (o.section) {
    const h = findSection(outline, o.section)
    from = h.line
    to = h.end
  }
  if (o.from_line !== undefined) from = Math.max(from, Math.floor(o.from_line))
  if (o.to_line !== undefined) to = Math.min(to, Math.floor(o.to_line))
  if (from > count) throw new UserError(`from_line ${from} is past the end: the note has ${count} lines`)
  if (to < from) throw new UserError(`to_line must be ≥ from_line (got ${from}–${to})`)
  // 读到最后一行时连末尾的换行一起回（整篇读回来和文件一个字不差）
  let body = o.outline_only ? '' : lines.slice(from - 1, to).join('\n') + (to === count && count < lines.length ? '\n' : '')
  let truncated = false
  if (body.length > READ_LIMIT) {
    // 截在整行上：说清楚回到第几行，接着从下一行读
    let n = 0
    let last = from - 1
    for (let i = from - 1; i < to; i++) {
      if (n + lines[i]!.length + 1 > READ_LIMIT) break
      n += lines[i]!.length + 1
      last = i + 1
    }
    body = lines.slice(from - 1, last).join('\n')
    to = last
    truncated = true
  }
  const props: Record<string, string> = {}
  for (const p of readProps(text)) props[p.key] = p.value
  const st = await stat(join(src.root, rel))
  const source = props.source && /^https?:\/\//.test(props.source) ? props.source : undefined
  return {
    path: rel,
    title: titleOf(rel),
    props,
    outline: outline.map((h) => ({ heading: h.path, level: h.level, line: h.line })),
    lines: [from, o.outline_only ? from - 1 : to],
    total_lines: count,
    text: body,
    truncated,
    version: versionOf(text),
    modified: iso(st.mtimeMs),
    ...(source ? { from: source } : {}),
  }
}

/** 一篇的字；没有这篇时说清楚、给几个名字像的 */
export async function noteText(src: NoteSource, rel: string): Promise<string> {
  let bytes: Buffer
  try {
    bytes = await readFile(join(src.root, rel))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    const like = await similarPaths(src, rel)
    throw new UserError(`No note at "${rel}".${like.length ? ` Did you mean: ${like.join(' | ')}` : ' Use search_notes to find it.'}`)
  }
  return decodeNote(bytes).text
}

export const versionOf = (text: string) => {
  // FNV-1a 32 位，够防撞用（不是安全用途）
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + '-' + text.length
}

/** 没有这篇时给几个名字像的 */
async function similarPaths(src: NoteSource, rel: string): Promise<string[]> {
  const want = titleOf(rel).toLowerCase()
  const all = await src.files()
  return all
    .map((f) => f.path)
    .filter((p) => {
      const t = titleOf(p).toLowerCase()
      return t === want || t.includes(want) || (want.length >= 2 && want.includes(t) && t.length >= 2)
    })
    .slice(0, 5)
}

// ---------- 最近改过的 ----------

export interface RecentItem {
  path: string
  title: string
  modified: string
  /** 谁改的：you 你自己、ai-chat 画布笔记里的 AI、dream 梦游、automation 自动化；还没提交的算你 */
  by: 'you' | 'ai-chat' | 'dream' | 'automation'
  /** 最近一次提交（还没提交是 null） */
  commit: string | null
  /** 那次提交的说明 */
  message?: string
  uncommitted?: boolean
}

export function byOf(subject: string): RecentItem['by'] {
  if (/^AI：/.test(subject)) return 'ai-chat'
  if (/^(梦游：|收下梦游|撤回梦游)/.test(subject)) return 'dream'
  if (/^(撤回)?自动化「/.test(subject)) return 'automation'
  return 'you'
}

export async function listRecent(src: NoteSource, o: { days: number; folder?: string; limit: number; now?: number }): Promise<RecentItem[]> {
  const since = (o.now ?? Date.now()) - o.days * 86_400_000
  const folder = o.folder ? o.folder.replace(/^\/+|\/+$/g, '') + '/' : ''
  const files = (await src.files()).filter((f) => f.mtimeMs >= since && (!folder || f.path.startsWith(folder))).sort((a, b) => b.mtimeMs - a.mtimeMs)
  const top = files.slice(0, o.limit)
  const last = new Map<string, { hash: string; subject: string }>()
  const dirty = new Set<string>()
  try {
    const out = await git(src.root, ['log', `--since=${new Date(since).toISOString()}`, '--format=%x1e%h%x1f%s', '--name-only', '-z', '--', ...(folder ? [folder] : ['.'])], { timeoutMs: 10_000 })
    for (const rec of out.split('\x1e')) {
      // 用了 -z：说明那一行以 \0 结尾，后面一个 \0 一个文件
      const cut = rec.search(/[\0\n]/)
      if (cut <= 0) continue
      const [hash, subject] = rec.slice(0, cut).split('\x1f') as [string, string]
      for (const p of rec.slice(cut + 1).split(/[\0\n]/)) {
        const path = p.trim()
        if (path && !last.has(path)) last.set(path, { hash, subject })
      }
    }
    const st = await git(src.root, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { timeoutMs: 10_000 })
    for (const e of st.split('\0')) if (e.length > 3) dirty.add(e.slice(3))
  } catch (e) {
    // 不是 Git 仓库：只按修改时间（谁改的不知道，算你）
    if (!(e instanceof Error && /not a git repository/i.test(e.message))) throw e
  }
  return top.map((f) => {
    const c = last.get(f.path)
    const uncommitted = dirty.has(f.path)
    return {
      path: f.path,
      title: titleOf(f.path),
      modified: iso(f.mtimeMs),
      by: uncommitted || !c ? 'you' : byOf(c.subject),
      commit: uncommitted ? null : (c?.hash ?? null),
      ...(c && !uncommitted ? { message: c.subject } : {}),
      ...(uncommitted ? { uncommitted: true } : {}),
    }
  })
}

// ---------- 待办 ----------

export type TaskRange = 'today' | 'week' | 'overdue' | 'all'

export interface TaskItem {
  text: string
  due: string | null
  time: string | null
  repeat: string | null
  done: boolean
  path: string
  line: number
  /** 上面最近的标题 */
  section: string
}

/** 这台 Mac 上的今天（YYYY-MM-DD） */
export const localToday = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/**
 * 库里每篇的「- [ ]」（@cn/tasks 的 scanTasks，和画布今日同一种写法）。
 * today：今天到期；week：今天起 7 天内到期；overdue：过了日子还没做；all：全部（没写日子的也在）。取消了的不列。
 */
export async function listTasks(src: NoteSource, o: { range: TaskRange; includeDone: boolean; folder?: string; today: string; limit: number }): Promise<{ tasks: TaskItem[]; total: number; overdue: number }> {
  const folder = o.folder ? o.folder.replace(/^\/+|\/+$/g, '') + '/' : ''
  const end = addDays(o.today, 6)
  const out: TaskItem[] = []
  let overdue = 0
  for (const [path, text] of await src.texts()) {
    if (folder && !path.startsWith(folder)) continue
    if (!text.includes('[')) continue
    for (const t of scanTasks(text)) {
      const k = t.task
      if (k.cancelled) continue
      const due = k.date
      if (!k.done && due && due < o.today) overdue++
      if (k.done && !o.includeDone) continue
      const fits = o.range === 'all' || (due !== null && (o.range === 'today' ? due === o.today : o.range === 'week' ? due >= o.today && due <= end : due < o.today && !k.done))
      if (!fits) continue
      out.push({ text: k.title.trim(), due, time: k.time, repeat: k.repeat, done: k.done, path, line: t.line + 1, section: t.heading?.text ?? '' })
    }
  }
  out.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || (a.time ?? '99').localeCompare(b.time ?? '99') || a.path.localeCompare(b.path) || a.line - b.line)
  return { tasks: out.slice(0, o.limit), total: out.length, overdue }
}
