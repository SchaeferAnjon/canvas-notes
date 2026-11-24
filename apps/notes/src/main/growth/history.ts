/**
 * 生长图读 Git 历史（task-h7oy8）：每篇第一次出现的那次提交、每一行链接第一次出现的那次提交、主线上梦游的提交、一次加进来几十篇的导入。
 * `git log --reverse -M -p --unified=0` 从旧到新一行行读：只看加进来的行（「+」开头），挪了、改了名的跟着认是同一篇。
 * 读过的记在缓存里（设置目录 growth/，不进库）：下次只读上次读到的那次提交以后的（库换了历史就整个重读）。
 * 读法（LogReader）不碰磁盘，单元测试直接喂 git log 的输出。
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { gitPath } from '@cn/git'
import { type HistoryView, isTidyLine, lineLinks, wikiKey } from '../../shared/growth'

/** 一次提交加进来这么多篇以上算导入（导入时就有的，时间要估）；库的第一次提交少一些也算 */
export const BULK = 30
export const BULK_FIRST = 10

/** 缓存里存的：按「同一篇」的编号记（挪了、改了名的还是同一个编号） */
export interface HistState {
  v: 1
  /** 读到哪次提交为止 */
  head: string | null
  next: number
  /** 现在的路径 → 编号 */
  ids: Record<string, number>
  /** 编号 → [第一次出现的那一刻（毫秒）, 是不是导入那次带进来的] */
  born: Record<number, [number, 0 | 1]>
  /** `编号\tkey` → [第一次出现的那一刻, 梦游的提交加的 / 整理那一行, 导入那次带进来的] */
  links: Record<string, [number, 0 | 1, 0 | 1]>
  dream: { ms: number; s: string; ids: number[] }[]
  imports: { ms: number; n: number }[]
  /** 有没有读到过提交 */
  any: boolean
}

export const emptyHist = (): HistState => ({ v: 1, head: null, next: 1, ids: {}, born: {}, links: {}, dream: [], imports: [], any: false })

/** 梦游的提交（收下的单条是原来那次的说明，一次收下几条的是「收下梦游的…」） */
export const isDreamSubject = (s: string) => s.startsWith('梦游：') || s.startsWith('收下梦游的')

/** git 加了引号的路径（带特殊字的）：去掉引号、还原转义（core.quotePath=false 时中文照原样） */
export function unquotePath(p: string): string {
  if (!p.startsWith('"')) return p
  const bytes: number[] = []
  const s = p.slice(1, -1)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c !== '\\') {
      for (const b of Buffer.from(c, 'utf8')) bytes.push(b)
      continue
    }
    const n = s[++i]!
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(s.slice(i, i + 3), 8))
      i += 2
    } else bytes.push(({ n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 } as Record<string, number>)[n] ?? n.charCodeAt(0))
  }
  return Buffer.from(bytes).toString('utf8')
}

/** ---/+++、rename 行里的路径：去掉 a/ b/ 前缀、有空格时 git 在末尾加的制表符 */
const pathOf = (raw: string, prefix: string) => {
  const p = unquotePath(raw.replace(/\t$/, ''))
  return p.startsWith(prefix) ? p.slice(prefix.length) : p
}

/**
 * 一行行喂 git log 的输出（格式 `\x1e提交号\x1f作者时间\x1f说明`，后面是 -p 的补丁）。
 * 读完调 finish()；renames 是这一段里挪了、改了名的（旧路径 → 新路径），位置跟着挪
 */
export class LogReader {
  renames: [string, string][] = []
  private ms = 0
  private dreamC = false
  private hash = ''
  private first: boolean
  private added: number[] = []
  private addedLinks: string[] = []
  private touched = new Set<number>()
  private subject = ''
  private inCommit = false
  /** 正在读的这个文件 */
  private file: { from: string | null; to: string | null; isNew: boolean; isDel: boolean; renFrom: string | null; renTo: string | null } | null = null
  private cur: { id: number; path: string } | null = null
  constructor(readonly st: HistState) {
    this.first = !st.any
  }

  private newId(path: string, ms: number): number {
    const id = this.st.next++
    this.st.ids[path] = id
    this.st.born[id] = [ms, 0]
    return id
  }

  /** 文件头读完（到第一个 @@、下一个文件、下一次提交）：认出是哪一篇 */
  private settle() {
    const f = this.file
    this.file = null
    if (!f) return
    const st = this.st
    if (f.renFrom !== null && f.renTo !== null) {
      const id = st.ids[f.renFrom] ?? this.newId(f.renFrom, this.ms)
      delete st.ids[f.renFrom]
      st.ids[f.renTo] = id
      this.renames.push([f.renFrom, f.renTo])
      const name = (p: string) => wikiKey(p.slice(p.lastIndexOf('/') + 1))
      if (name(f.renFrom) !== name(f.renTo)) this.renamed.set(name(f.renFrom), name(f.renTo))
      this.touched.add(id)
      this.cur = { id, path: f.renTo }
      return
    }
    if (f.isDel) {
      const p = f.from ?? f.to
      if (p !== null) delete st.ids[p]
      this.cur = null
      return
    }
    const p = f.to ?? f.from
    if (p === null) return
    let id = st.ids[p]
    if (f.isNew || id === undefined) {
      id = this.newId(p, this.ms)
      this.added.push(id)
    }
    this.touched.add(id)
    this.cur = { id, path: p }
  }

  /** 这次提交里改了名的（旧名字的 key → 新名字的 key）：别的笔记里 [[旧名]] 跟着换成 [[新名]] 时，那条链接不算新长出来的 */
  private renamed = new Map<string, string>()

  private endCommit() {
    if (!this.inCommit) return
    this.settle()
    const st = this.st
    if (this.renamed.size) {
      for (const [k, v] of Object.entries(st.links)) {
        const tab = k.indexOf('\t')
        const nk = this.renamed.get(k.slice(tab + 1))
        if (!nk) continue
        const to = k.slice(0, tab + 1) + nk
        const had = st.links[to]
        // 新名字的这条是这次提交里才有的（跟着改名换的）：照旧名字那条的日子
        if (!had || had[0] >= this.ms) st.links[to] = v
      }
      this.renamed.clear()
    }
    const bulk = this.added.length >= BULK || (this.first && this.added.length >= BULK_FIRST)
    if (bulk) {
      for (const id of this.added) st.born[id]![1] = 1
      for (const k of this.addedLinks) st.links[k]![2] = 1
      st.imports.push({ ms: this.ms, n: this.added.length })
    }
    if (this.dreamC && this.touched.size) st.dream.push({ ms: this.ms, s: this.subject, ids: [...this.touched] })
    st.any = true
    st.head = this.hash
    this.first = false
    this.added = []
    this.addedLinks = []
    this.touched = new Set()
    this.cur = null
    this.inCommit = false
  }

  line(l: string) {
    if (l.startsWith('\x1e')) {
      this.endCommit()
      const [hash, at, subject] = l.slice(1).split('\x1f')
      this.hash = hash!
      this.ms = Number(at) * 1000
      this.subject = subject ?? ''
      this.dreamC = isDreamSubject(this.subject)
      this.inCommit = true
      return
    }
    if (!this.inCommit) return
    if (l.startsWith('diff --git ')) {
      this.settle()
      this.cur = null
      this.file = { from: null, to: null, isNew: false, isDel: false, renFrom: null, renTo: null }
      return
    }
    const f = this.file
    if (f) {
      if (l.startsWith('@@')) return this.settle()
      if (l.startsWith('new file mode')) f.isNew = true
      else if (l.startsWith('deleted file mode')) f.isDel = true
      else if (l.startsWith('rename from ')) f.renFrom = pathOf(l.slice(12), '')
      else if (l.startsWith('rename to ')) f.renTo = pathOf(l.slice(10), '')
      else if (l.startsWith('--- ')) f.from = l === '--- /dev/null' ? null : pathOf(l.slice(4), 'a/')
      else if (l.startsWith('+++ ')) f.to = l === '+++ /dev/null' ? null : pathOf(l.slice(4), 'b/')
      return
    }
    if (!this.cur || l[0] !== '+') return
    const text = l.slice(1)
    const keys = lineLinks(text, this.cur.path)
    if (!keys.length) return
    const dream = this.dreamC || isTidyLine(text) ? 1 : 0
    for (const key of keys) {
      const k = this.cur.id + '\t' + key
      if (this.st.links[k]) continue
      this.st.links[k] = [this.ms, dream, 0]
      this.addedLinks.push(k)
    }
  }

  finish() {
    this.endCommit()
  }
}

/** 编号记的 → 按现在路径的（交给 buildGrowth） */
export function viewOf(st: HistState): HistoryView {
  const pathOfId = new Map<number, string>()
  for (const [p, id] of Object.entries(st.ids)) pathOfId.set(id, p)
  const born = new Map<string, { ms: number; bulk: boolean }>()
  for (const [p, id] of Object.entries(st.ids)) {
    const b = st.born[id]
    if (b) born.set(p, { ms: b[0], bulk: b[1] === 1 })
  }
  const links = new Map<string, { ms: number; dream: boolean; bulk: boolean }>()
  for (const [k, v] of Object.entries(st.links)) {
    const tab = k.indexOf('\t')
    const p = pathOfId.get(Number(k.slice(0, tab)))
    if (p) links.set(p + k.slice(tab), { ms: v[0], dream: v[1] === 1, bulk: v[2] === 1 })
  }
  return {
    born,
    links,
    dream: st.dream.map((d) => ({ ms: d.ms, subject: d.s, paths: d.ids.map((id) => pathOfId.get(id)).filter((p): p is string => !!p) })),
    imports: st.imports.map((x) => ({ ms: x.ms, count: x.n })),
    any: st.any,
  }
}

function run(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, { cwd: root, env: { ...process.env, PATH: gitPath() } })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `git ${args[0]} 退出码 ${code}`))))
  })
}

/**
 * 接着上次读：上次读到的那次提交还在现在的历史里，就只读它以后的；不在了（改写过历史）整个重读。
 * 还没有提交时原样交回。返回新的状态（传进来的不改）和这一段里挪了名的
 */
export async function readHistory(root: string, prev: HistState | null): Promise<{ st: HistState; renames: [string, string][] }> {
  let head: string
  try {
    head = (await run(root, ['rev-parse', '--verify', '-q', 'HEAD'])).trim()
  } catch {
    return { st: prev ?? emptyHist(), renames: [] }
  }
  let st = prev ? (JSON.parse(JSON.stringify(prev)) as HistState) : emptyHist()
  if (st.head === head) return { st, renames: [] }
  if (st.head) {
    const ok = await run(root, ['merge-base', '--is-ancestor', st.head, head]).then(
      () => true,
      () => false,
    )
    if (!ok) st = emptyHist()
  }
  const reader = new LogReader(st)
  const range = st.head ? `${st.head}..${head}` : head
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      'git',
      ['-c', 'core.quotePath=false', 'log', '--reverse', '-M', '-p', '--unified=0', '--no-color', '--no-ext-diff', '--no-textconv', '--format=%x1e%H%x1f%at%x1f%s', range, '--', '*.md'],
      { cwd: root, env: { ...process.env, PATH: gitPath() } },
    )
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    const rl = createInterface({ input: p.stdout, crlfDelay: Infinity })
    rl.on('line', (l) => reader.line(l))
    p.on('error', reject)
    // 进程退了、最后几行也读完了才算完
    const lines = new Promise<void>((r) => rl.once('close', r))
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `git log 退出码 ${code}`))
      void lines.then(() => {
        reader.finish()
        // 这一段里没有动 md 的提交：也算读到了这里
        st.head = head
        st.any = true
        resolve()
      })
    })
  })
  return { st, renames: reader.renames }
}
