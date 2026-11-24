/**
 * 把读出来的旧笔记写进库：md 进 收件箱/导入/<来源>/<原文件夹>/（整个 Obsidian 库时 top：原样放在库的最外层 <原文件夹>/，task-wniqx），
 * 图片和附件拷进 附件/导入/<来源>/，
 * 属性写进开头（created、updated、来源、原文件夹、import-id），文件的修改时间设成原来的；全部写完一次提交。
 * 不依赖 Electron，单元测试直接跑。
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { relativeLink, setProp } from '@cn/format'
import * as git from '@cn/git'
import { INBOX } from '../../shared/layout'
import { atomicCopy, atomicWrite } from '@cn/atomic'

export interface ImportNote {
  /** 来源里的文件夹路径（'' 是根），也是 收件箱/导入/<来源>/ 下面的子文件夹 */
  folder: string
  title: string
  /** md 全文（可以已经带 frontmatter）；附件的位置写成 attRef(i) */
  text: string
  /** 要加的属性，按顺序 */
  props: [string, string][]
  /** 毫秒 */
  created: number
  updated: number
  /** name：库里用的文件名（可以带子文件夹，重了加序号） */
  attachments: { src: string; name: string }[]
  /**
   * 正文里 [[noteRef(i)]] 指的笔记：id 是那一篇的 import-id，name 是它原来的名字。写盘时它也在这次导的里面，
   * 名字在整个库里不重就写名字，重了写新位置的路径（从库根算，不带 .md）；不在这次导的里面就写 name
   */
  links?: { id: string; name: string }[]
  /** 记在 import-id 里，再导一次时认出来跳过 */
  id: string
}

/** md 里第 i 个附件的位置，写盘时换成相对链接 */
export const attRef = (i: number) => `\uE000${i}\uE001`
/** [[…]] 里第 i 个笔记链接指的那一篇，写盘时换成名字或路径 */
export const noteRef = (i: number) => `\uE002${i}\uE003`

export const importDir = (source: string) => `${INBOX}/导入/${source}`
/** 和 main/attachments.ts 的 ATTACHMENTS 同一个（那边依赖 Electron，这里不引） */
export const attachDir = (source: string) => `附件/导入/${source}`

/** 文件名、文件夹名里不能有的字符换掉；链接里会断开的括号方括号也换掉 */
export function cleanSegment(s: string, max = 80): string {
  return (
    s
      .replace(/[\\/:*?"<>|\u0000-\u001f#^[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, max)
      .trim() || '未命名'
  )
}

/** 2026-11-15 14:03（和速记的 created 一样） */
export function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}

/** 库里已经导过的 import-id（再导一次时跳过） */
export async function importedIds(root: string): Promise<Set<string>> {
  let out = ''
  try {
    out = await git.git(root, ['grep', '-h', '-I', '--no-color', '-e', '^import-id: ', '--', '*.md'])
  } catch (e) {
    // 一条都没有时 git grep 退出码是 1
    if (!(e instanceof git.GitError)) throw e
  }
  return new Set(out.split('\n').map((l) => l.replace(/^import-id:\s*/, '').trim()).filter(Boolean))
}

/** 库里已有的笔记名（小写、不带 .md），.开头的文件夹不进 */
async function noteNames(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string) => {
    for (const ent of await readdir(join(root, rel), { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) await walk(r)
      else if (/\.md$/i.test(ent.name)) out.push(ent.name.slice(0, -3).toLowerCase())
    }
  }
  await walk('')
  return out
}

export interface WriteResult {
  commit: string | null
  paths: string[]
  attachments: number
  bytes: number
}

/**
 * 写进库并提交。signal 停下时把这次写的文件全删掉，库回到原样。
 * onProgress(done, total, title) 每写一篇报一次。
 */
export async function writeImport(o: {
  root: string
  source: string
  notes: ImportNote[]
  /** 没有笔记用到、也要一起拷的文件（md 文件夹里散放的 PDF 之类）；name 可以带子文件夹 */
  extra?: { src: string; name: string }[]
  /**
   * 整个库导进来（task-wniqx）：原来的文件夹原样放在库的最外层、和分类同级（和分类同名的就合到那个文件夹里，同名的笔记加「 2」）；
   * 不给是先进 收件箱/导入/<来源>/
   */
  top?: boolean
  message: string
  signal?: AbortSignal
  onProgress?(done: number, total: number, title: string): void
}): Promise<WriteResult> {
  const { root, source, notes } = o
  const written: string[] = []
  const taken = new Set<string>()
  /** 名字重了加「 2」「 3」；苹果的磁盘不分大小写 */
  const unique = async (dir: string, base: string, ext: string) => {
    for (let n = 1; ; n++) {
      const rel = `${dir ? dir + '/' : ''}${base}${n > 1 ? ` ${n}` : ''}${ext}`
      if (!taken.has(rel.toLowerCase()) && !(await exists(join(root, rel)))) {
        taken.add(rel.toLowerCase())
        return rel
      }
    }
  }
  let attachments = 0
  let bytes = 0
  /** 同一个附件被几篇用到只拷一份 */
  const copied = new Map<string, string>()
  const copy = async (a: { src: string; name: string }) => {
    const had = copied.get(a.src)
    if (had) return had
    const ext = extname(a.name).toLowerCase()
    const parts = a.name.slice(0, a.name.length - ext.length).split('/')
    const base = cleanSegment(parts.pop()!, 60)
    const dir = [attachDir(source), ...parts.filter(Boolean).map((s) => cleanSegment(s, 40))].join('/')
    // 以前导进来过一模一样的（再导一次、两篇用同一张图）：用那一份，不再拷
    const want = await readFile(a.src)
    for (let n = 1; ; n++) {
      const rel = `${dir}/${base}${n > 1 ? ` ${n}` : ''}${ext}`
      if (taken.has(rel.toLowerCase()) || !(await exists(join(root, rel)))) break
      if (want.equals(await readFile(join(root, rel)))) {
        copied.set(a.src, rel)
        return rel
      }
    }
    const rel = await unique(dir, base, ext)
    await mkdir(dirname(join(root, rel)), { recursive: true })
    written.push(rel)
    await atomicCopy(a.src, join(root, rel))
    copied.set(a.src, rel)
    bytes += (await stat(join(root, rel))).size
    attachments++
    return rel
  }
  try {
    // 先定每一篇写到哪（链接要指到真写下的文件，「第一讲 2」也一样），再写
    const paths: string[] = []
    for (const note of notes) {
      const dir = [...(o.top ? [] : [importDir(source)]), ...note.folder.split('/').filter(Boolean).map((s) => cleanSegment(s, 40))].join('/')
      paths.push(await unique(dir, cleanSegment(note.title), '.md'))
    }
    const pathOf = new Map(notes.map((n, i) => [n.id, paths[i]!]))
    const stem = (p: string) => p.slice(p.lastIndexOf('/') + 1, -3)
    /** 笔记名在整个库里（原来有的加这次导的）出现几次 */
    const named = new Map<string, number>()
    if (notes.some((n) => n.links?.length)) for (const k of [...(await noteNames(root)), ...paths.map((p) => stem(p).toLowerCase())]) named.set(k, (named.get(k) ?? 0) + 1)
    for (const [i, note] of notes.entries()) {
      o.signal?.throwIfAborted()
      const path = paths[i]!
      const links: string[] = []
      for (const a of note.attachments) links.push(relativeLink(path, await copy(a)))
      let text = note.text
        .replace(/\uE000(\d+)\uE001/g, (_, n: string) => links[Number(n)] ?? '')
        .replace(/\uE002(\d+)\uE003/g, (_, n: string) => {
          const l = note.links?.[Number(n)]
          if (!l) return ''
          const to = pathOf.get(l.id)
          if (!to) return l.name
          return (named.get(stem(to).toLowerCase()) ?? 0) > 1 ? to.slice(0, -3) : stem(to)
        })
      for (const [k, v] of [['created', stamp(note.created)], ['updated', stamp(note.updated)], ...note.props, ['import-id', note.id]] as [string, string][])
        text = setProp(text, k, v)
      if (!text.endsWith('\n')) text += '\n'
      await mkdir(dirname(join(root, path)), { recursive: true })
      written.push(path)
      await atomicWrite(join(root, path), text, { exclusive: true })
      const t = note.updated / 1000
      await utimes(join(root, path), t, t)
      o.onProgress?.(i + 1, notes.length, note.title)
    }
    for (const a of o.extra ?? []) {
      o.signal?.throwIfAborted()
      await copy(a)
    }
    o.signal?.throwIfAborted()
  } catch (e) {
    for (const p of written) await rm(join(root, p), { force: true })
    throw e
  }
  if (!written.length) return { commit: null, paths: [], attachments: 0, bytes: 0 }

  // 只提交这次写的文件（用户别处没提交的改动不带进来）；路径多，走文件传给 git
  const tmp = await mkdtemp(join(tmpdir(), 'cn-import-'))
  try {
    const list = join(tmp, 'paths')
    await writeFile(list, written.join('\0'))
    await git.git(root, ['add', '--pathspec-from-file=' + list, '--pathspec-file-nul'], { timeoutMs: 120_000 })
    await git.git(root, ['commit', '-q', '-m', o.message, '--pathspec-from-file=' + list, '--pathspec-file-nul'], { timeoutMs: 120_000 })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  const commit = (await git.git(root, ['rev-parse', 'HEAD'])).trim()
  return { commit, paths: written, attachments, bytes }
}
