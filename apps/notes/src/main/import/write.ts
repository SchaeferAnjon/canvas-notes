/**
 * 把读出来的旧笔记写进库：md 进 收件箱/导入/<来源>/<原文件夹>/（整个 Obsidian 库时 top：原样放在库的最外层 <原文件夹>/，task-wniqx），
 * 图片和附件拷进 附件/导入/<来源>/，
 * 属性写进开头（created、updated、来源、原文件夹、import-id），文件的修改时间设成原来的；全部写完一次提交。
 * 不依赖 Electron，单元测试直接跑。
 */
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
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
 * onProgress(done, total, title) 每写好一个文件（笔记或附件）报一次；onCommit 报记进历史到哪了。
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
  /** 每写好一个文件（笔记、附件）报一次：几个 / 共几个 */
  onProgress?(done: number, total: number, title: string): void
  /** 记进 Git 历史那一步：add 了几个 / 共几个 */
  onCommit?(done: number, total: number): void
  /** 要写这个文件了（库里的相对路径）：主进程借它让文件监听别把导入自己写的几千个文件一个个当成外面的改动 */
  onWrite?(rel: string): void
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
  /** 同一个附件被几篇用到只拷一份：源文件 → 库里的位置 */
  const placed = new Map<string, string>()
  /** 要拷的：源文件 → 库里的位置（以前导进来过一模一样的不在这里，直接用那一份） */
  const toCopy: { src: string; rel: string }[] = []
  const place = async (a: { src: string; name: string }) => {
    const had = placed.get(a.src)
    if (had) return had
    const ext = extname(a.name).toLowerCase()
    const parts = a.name.slice(0, a.name.length - ext.length).split('/')
    const base = cleanSegment(parts.pop()!, 60)
    const dir = [attachDir(source), ...parts.filter(Boolean).map((s) => cleanSegment(s, 40))].join('/')
    // 以前导进来过一模一样的（再导一次）：用那一份，不再拷。那个位置上有文件才读来比（以前每个附件都先整个读一遍，几百 MB 白读一次）
    let want: Buffer | null = null
    for (let n = 1; ; n++) {
      const rel = `${dir}/${base}${n > 1 ? ` ${n}` : ''}${ext}`
      if (taken.has(rel.toLowerCase()) || !(await exists(join(root, rel)))) break
      want ??= await readFile(a.src)
      if (want.equals(await readFile(join(root, rel)))) {
        placed.set(a.src, rel)
        return rel
      }
    }
    const rel = await unique(dir, base, ext)
    placed.set(a.src, rel)
    toCopy.push({ src: a.src, rel })
    return rel
  }
  /** 建过（或正在建）的文件夹：同时写的几个等同一次 mkdir */
  const made = new Map<string, Promise<void>>()
  /** 这次新建的文件夹（停下时连同文件一起拿掉；本来就有的空文件夹，比如新库的「写作」，不动） */
  const created: string[] = []
  const mkdirOnce = (rel: string) => {
    const d = dirname(join(root, rel))
    let p = made.get(d)
    if (!p) {
      p = mkdir(d, { recursive: true }).then((first) => {
        // recursive 返回新建的最上面那一层：从它到 d 都是这次建的
        if (first) for (let x = d; x.length >= first.length; x = dirname(x)) created.push(x)
      })
      made.set(d, p)
    }
    return p
  }
  try {
    // 先定每一篇、每个附件写到哪（链接要指到真写下的文件，「第一讲 2」也一样），再一起写
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
    const texts: string[] = []
    for (const [i, note] of notes.entries()) {
      o.signal?.throwIfAborted()
      const path = paths[i]!
      const links: string[] = []
      for (const a of note.attachments) links.push(relativeLink(path, await place(a)))
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
      texts.push(text)
    }
    for (const a of o.extra ?? []) await place(a)
    // 写：笔记、附件一起排队，同时写 8 个；每写好一个报一次（几个 / 共几个文件）
    const jobs: { rel: string; title: string; run(): Promise<void> }[] = [
      ...notes.map((note, i) => ({
        rel: paths[i]!,
        title: note.title,
        async run() {
          await atomicWrite(join(root, paths[i]!), texts[i]!, { exclusive: true, noSync: true })
          const t = note.updated / 1000
          await utimes(join(root, paths[i]!), t, t)
        },
      })),
      ...toCopy.map((c) => ({
        rel: c.rel,
        title: c.rel.slice(c.rel.lastIndexOf('/') + 1),
        async run() {
          await atomicCopy(c.src, join(root, c.rel), { noSync: true })
          bytes += (await stat(join(root, c.rel))).size
          attachments++
        },
      })),
    ]
    let next = 0
    let done = 0
    const lane = async () => {
      while (next < jobs.length) {
        o.signal?.throwIfAborted()
        const j = jobs[next++]!
        await mkdirOnce(j.rel)
        o.onWrite?.(j.rel)
        written.push(j.rel)
        await j.run()
        o.onProgress?.(++done, jobs.length, j.title)
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, lane))
    o.signal?.throwIfAborted()
    // 上面一个个不 fsync（一个 12 毫秒，几千个就是一分多钟）：写完统一落盘一次再提交
    await flushAll()
  } catch (e) {
    await undoWrites(root, written, created)
    throw e
  }
  if (!written.length) return { commit: null, paths: [], attachments: 0, bytes: 0 }
  const commit = await commitImport(root, written, o.message, { ...o, created })
  return { commit, paths: written, attachments, bytes }
}

/** 停下、出错：这次写的文件删掉，这次新建的文件夹（里面空了的）从深到浅拿掉 */
async function undoWrites(root: string, written: string[], created: string[]) {
  for (const p of written) await rm(join(root, p), { force: true })
  for (const d of [...new Set(created)].sort((a, b) => b.length - a.length))
    await rmdir(d).catch((e: NodeJS.ErrnoException) => {
      // 里面还有别的（导的时候用户自己放进去的）：留着
      if (e.code !== 'ENOTEMPTY' && e.code !== 'ENOENT' && e.code !== 'EEXIST') throw e
    })
}

/** 把系统里还没落盘的都写到盘上（/bin/sync，一次几百毫秒） */
const flushAll = () =>
  new Promise<void>((resolve, reject) =>
    execFile('/bin/sync', [], { timeout: 120_000 }, (e) => (e ? reject(new Error(`写完落盘没成功：${e.message}`)) : resolve())),
  )

/** 一批几个文件：一批一个 git 进程，好报进度、停得下来 */
const BATCH = 400
/** 同时几个 git 在压：压缩（zlib）是记进历史最慢的一步，一个 git 只用一个核 */
const HASH_LANES = 4

/** git hash-object -w --stdin-paths：把这一批文件压好、存进 .git/objects（不碰暂存区，所以几个能同时跑） */
function hashObjects(root: string, paths: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // 和别处同一份 git（打包好的软件用安装包里自带的那份，@cn/git 的 gitEnv）
    const prog = git.gitEnv()
    const p = spawn(prog.file, ['hash-object', '-w', '--stdin-paths'], { cwd: root, env: prog.env, stdio: ['pipe', 'ignore', 'pipe'], ...(signal ? { signal } : {}) })
    let err = ''
    p.stderr!.on('data', (b: Buffer) => (err += b.toString()))
    p.on('error', (e) => reject(signal?.aborted ? signal.reason : e))
    p.on('close', (code) => (signal?.aborted ? reject(signal.reason) : code === 0 ? resolve() : reject(new git.GitError(`git hash-object 失败：${err.trim()}`, ['hash-object'], err))))
    p.stdin!.end(paths.join('\n') + '\n')
  })
}

/**
 * 只提交这次写的文件（用户别处没提交的改动不带进来），报「记进历史 几个 / 共几个」：
 * 先 4 个 git hash-object 同时把文件压好存进历史（一批 400 个，每好一批报一次；以前一个 git add 单线程压完 300 MB 要 8 秒，这样 4 秒），
 * 再一次 git add（对象已经在了，只算个指纹）、一次提交。
 * 不设死的超时（以前 add 整个 120 秒，几百 MB 的库在忙的机器上超时，写进来的文件留着、没提交，界面却说「库里什么都没动」）；
 * 停下：杀掉正在跑的 git，已经 add 的退回去（git reset），写进来的文件删掉，库回到导入前（压好没用上的对象留在 .git 里，git 以后自己清）；
 * 提交已经做完了就算导完。
 */
export async function commitImport(
  root: string,
  written: string[],
  message: string,
  o: { signal?: AbortSignal; onCommit?(done: number, total: number): void; created?: string[] } = {},
): Promise<string> {
  let before = await revParse(root, 'HEAD')
  const tmp = await mkdtemp(join(tmpdir(), 'cn-import-'))
  // 文件名的写法：Mac 上的 git（core.precomposeunicode 默认开）把名字记成合成的写法（NFC），命令行参数也替你换，
  // 但 --pathspec-from-file 里的不换。来源里很多名字是分解的写法（NFD，访达、iCloud 来的韩文、带声调的字常这样），
  // 照原样交给 git commit 就是「pathspec did not match」，整次导入报没导成、写进来的文件留在库里没提交（用户真库 2026-11-26 实测）。
  // 所以交给 git 的名单一律换成 git 记的那种写法
  const precompose = process.platform === 'darwin' && (await gitConfig(root, 'core.precomposeunicode')) !== 'false'
  const asGit = (p: string) => (precompose ? p.normalize('NFC') : p)
  const listOf = async (name: string, ps: string[]) => {
    const f = join(tmp, name)
    await writeFile(f, ps.map(asGit).join('\0'))
    return f
  }
  const long = { timeoutMs: 30 * 60_000, signal: o.signal }
  try {
    try {
      o.onCommit?.(0, written.length)
      // 名字里带换行的（几乎没有）hash-object 一行一个读不了：留给下面的 add 自己压
      const batches: string[][] = []
      const plain = written.filter((p) => !p.includes('\n'))
      for (let i = 0; i < plain.length; i += BATCH) batches.push(plain.slice(i, i + BATCH))
      let next = 0
      let hashed = 0
      const lane = async () => {
        while (next < batches.length) {
          o.signal?.throwIfAborted()
          const b = batches[next++]!
          await hashObjects(root, b, o.signal)
          o.signal?.throwIfAborted()
          hashed += b.length
          o.onCommit?.(hashed, written.length)
        }
      }
      await Promise.all(Array.from({ length: Math.min(HASH_LANES, batches.length) }, lane))
      o.signal?.throwIfAborted()
      // add 和提交排进这个库的提交队（别的提交插不进这中间；「提交落没落下」照这一段开始时的 HEAD 认）
      const done = await git.withCommitLock(root, async () => {
        before = await revParse(root, 'HEAD')
        await git.git(root, ['add', '--pathspec-from-file=' + (await listOf('add', written)), '--pathspec-file-nul'], long)
        if (hashed < written.length) o.onCommit?.(written.length, written.length)
        o.signal?.throwIfAborted()
        const all = await listOf('all', written)
        await git.git(root, ['commit', '-q', '-m', message, '--pathspec-from-file=' + all, '--pathspec-file-nul'], long)
        return (await git.git(root, ['rev-parse', 'HEAD'])).trim()
      })
      return done
    } catch (e) {
      const now = await revParse(root, 'HEAD')
      // 提交已经落下了（停下正好在提交完那一刻）：算导完
      if (now && now !== before) return now
      // 退回去：已经 add 的从暂存区拿掉（库里本来就有的文件不会在 written 里），写进来的文件删掉
      const all = await listOf('reset', written)
      if (before) await git.git(root, ['reset', '-q', '--pathspec-from-file=' + all, '--pathspec-file-nul'], { timeoutMs: 10 * 60_000 }).catch((er) => console.error('导入停下时退回暂存区没成功', er))
      else await git.git(root, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--pathspec-from-file=' + all, '--pathspec-file-nul'], { timeoutMs: 10 * 60_000 }).catch((er) => console.error('导入停下时退回暂存区没成功', er))
      await undoWrites(root, written, o.created ?? [])
      throw e
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** 库里这项 git 设置（--bool），没设是 null */
async function gitConfig(root: string, key: string): Promise<string | null> {
  try {
    return (await git.git(root, ['config', '--bool', key])).trim()
  } catch (e) {
    // 没设时退出码 1
    if (e instanceof git.GitError) return null
    throw e
  }
}

/** 还没有提交时是 null */
async function revParse(root: string, ref: string): Promise<string | null> {
  try {
    return (await git.git(root, ['rev-parse', '-q', '--verify', ref])).trim()
  } catch (e) {
    if (e instanceof git.GitError) return null
    throw e
  }
}
