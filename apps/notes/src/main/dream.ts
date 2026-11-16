/**
 * 梦游：在单独的分支 dream/MM-DD 上整理，每条建议是分支上的一个提交，用户逐条收下（cherry-pick）或丢掉。
 * 用 git worktree 在临时目录检出这个分支，不碰用户正在用的工作目录。
 * 只动 收件箱/、素材/、周记/；用户自己写的作品一个字都不改（每次提交前检查）。
 * 归类和改名例外：收件箱里的东西可以挪出去（课程/、项目/、生活/、写作/），改名时别的笔记里指向它的 [[旧名]] 跟着换，
 * 这两样提交前也逐个核对（挪的源头在收件箱、别处只多了换名的双链）。
 * 可视化也是例外（dream-viz.ts）：今天卡得最久的几处各做一个 HTML 放进课程文件夹、挂到读 PDF 笔记那一段的脚上，只动这两个文件。
 * 这里不依赖 Electron：路径和 AI 都由调用方给，单元测试直接跑。
 */
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { decodeNote, encodeNote, HIDDEN_KEYS, plainText, readProps, shingles, similarity, jaccard } from '@cn/format'
import * as git from '@cn/git'
import type { DreamDiffFile, DreamGroup, DreamItem, DreamReport } from '../shared/api'
import { CLIPS, INBOX, previewOf, titleOf } from '../shared/layout'
import { BRAND } from '../shared/brand'
import { duplicatesOf } from './duplicates'
import { makeDreamViz } from './dream-viz'
import { foldersOf, movedText, parsePlan, planInBatches, redoPrompt, relinkText, targetOf, type FilePlan } from './dream-file'

/** 梦游能动的文件夹 */
export const DREAM_FOLDERS = [INBOX, CLIPS, '周记']
/** 一晚最多补几处双链、列几对可能重复（导入几百条旧笔记时不铺满报告） */
export const LINK_MAX = 30
export const DUP_MAX = 20
const allowed = (p: string) => DREAM_FOLDERS.some((f) => p.startsWith(f + '/'))

export type Ask = (system: string, prompt: string) => Promise<string>

const SYSTEM = `你是 ${BRAND.name} 笔记软件的「梦游」：夜里替一个人整理笔记。
用中文，平实、直接。只根据给你的内容回答，不编造。`

export interface DreamOptions {
  /** 库的根目录（用户正在用的工作目录） */
  root: string
  /** 临时检出放在这个目录下面 */
  scratch: string
  ask: Ask
  trigger: DreamReport['trigger']
  now?: Date
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO 周：2026-W46 */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = t.getUTCFullYear()
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400_000 + 1) / 7)
  return `${y}-W${pad(week)}`
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

async function branchExists(root: string, name: string): Promise<boolean> {
  try {
    await git.git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
    return true
  } catch (e) {
    if (e instanceof git.GitError) return false
    throw e
  }
}

const head = async (dir: string) => (await git.git(dir, ['rev-parse', 'HEAD'])).trim()

/** 提交前检查：暂存区里每个路径（挪动的新旧两头都算）都在梦游能动的文件夹里，或者是核对过的那几个（ok） */
async function commitChecked(wt: string, message: string, ok: ReadonlySet<string> = new Set()): Promise<string> {
  const staged = (await git.git(wt, ['diff', '--cached', '--name-only', '--no-renames', '-z'])).split('\0').filter(Boolean)
  const bad = staged.filter((p) => !allowed(p) && !ok.has(p))
  if (bad.length) {
    await git.git(wt, ['reset', '-q', '--hard', 'HEAD'])
    throw new Error(`梦游想改你写的文件，已拦下：${bad.join('、')}`)
  }
  if (!staged.length) throw new Error('这一条没有改动')
  await git.git(wt, ['commit', '-q', '-m', message])
  return head(wt)
}

async function readText(p: string): Promise<string> {
  return decodeNote(await readFile(p)).text
}

/** 在文件末尾加一行，沿用文件原来的 BOM 和换行 */
async function appendLine(p: string, line: string) {
  const { text, meta } = decodeNote(await readFile(p))
  const next = text.endsWith('\n') ? `${text}\n${line}\n` : `${text}\n\n${line}`
  await writeFile(p, encodeNote(next, meta))
}

function parseJsonBlock(reply: string): unknown {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(reply) ?? /(\[[\s\S]*\])/.exec(reply)
  if (!m) throw new Error('AI 没给出能用的整理方案')
  return JSON.parse(m[1]!)
}

let seq = 0
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`

/** 跑一次梦游，返回报告。改动都在新分支上，当前分支只多一次「先把没提交的改动提交掉」 */
export async function runDream(o: DreamOptions): Promise<DreamReport> {
  const { root, ask } = o
  const now = o.now ?? new Date()
  const started = Date.now()

  // 1. 用户没提交的改动先提交，梦游从一个干净的提交出发
  const pending = await git.status(root)
  if (pending.length) await git.commitAll(root, git.describeChanges(pending))
  const base = await git.currentBranch(root)
  const baseCommit = await head(root).catch(() => {
    throw new Error('库里还没有任何提交，没法梦游')
  })

  // 2. 新分支 + 临时检出
  let branch = `dream/${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  for (let n = 2; await branchExists(root, branch); n++) branch = `dream/${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${n}`
  await mkdir(o.scratch, { recursive: true })
  const wt = await mkdtemp(join(o.scratch, 'dream-'))
  await git.git(root, ['worktree', 'add', '-q', '-b', branch, wt, baseCommit])

  const report: DreamReport = { branch, base, baseCommit, started, finished: 0, trigger: o.trigger, items: [], notes: [], closed: false }
  /** 提交的顺序（cherry-pick 按这个顺序最不容易冲突） */
  const commitItems: DreamItem[] = []
  const add = (group: DreamGroup, it: Omit<DreamItem, 'id' | 'group' | 'state'>) => {
    const item: DreamItem = { id: newId(), group, state: 'pending', ...it }
    report.items.push(item)
    if (item.commit) commitItems.push(item)
    return item
  }

  try {
    const files = (await git.git(wt, ['ls-files', '-z', '--', '*.md'])).split('\0').filter(Boolean)
    const texts = new Map<string, string>()
    for (const f of files) texts.set(f, await readText(join(wt, f)))
    const inbox = files.filter((f) => f.startsWith(INBOX + '/'))
    const loose = files.filter((f) => f.startsWith(INBOX + '/') || f.startsWith(CLIPS + '/'))

    // 3. 本周小结（新文件，和别的提交互不相干）
    const week = isoWeek(now)
    const weekPath = `周记/${week}.md`
    if (!texts.has(weekPath) && !(await exists(join(wt, weekPath)))) {
      try {
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
        const commits = (await git.log(wt, 200)).filter((c) => Date.parse(c.date) >= monday.getTime())
        if (commits.length) {
          const changed = [...new Set(commits.flatMap((c) => c.files.map((f) => f.path)))].filter((p) => p.endsWith('.md'))
          const list = changed
            .slice(0, 30)
            .map((p) => `路径：${p}\n内容：${texts.has(p) ? previewOf(texts.get(p)!, 200) : '（已删除或挪走）'}`)
            .join('\n\n')
          const reply = (
            await ask(
              SYSTEM,
              `命令：本周小结\n周：${week}\n\n这周有 ${commits.length} 次提交，改到下面这些笔记。用三到五句话写一段本周小结：这周主要在做什么、定下了什么、还有什么没整理。只输出这段话。\n\n${list}`,
            )
          ).trim()
          if (reply) {
            await mkdir(join(wt, '周记'), { recursive: true })
            await writeFile(join(wt, weekPath), `---\nby: 梦游\ncreated: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}\n---\n# ${week} 小结\n\n${reply}\n`)
            await git.git(wt, ['add', '--', weekPath])
            const c = await commitChecked(wt, `梦游：写了本周小结 ${weekPath}`)
            add('week', { title: `周记 ${week}`, sub: `新文件 ${weekPath}`, why: '梦游按这周的提交写的，收下前可以改；你写的正文不会动', commit: c, files: [weekPath] })
          }
        }
      } catch (e) {
        report.notes.push(`本周小结没写成：${(e as Error).message}`)
      }
    }

    // 4. 补双链：收件箱和素材里的笔记，和库里另一篇讲到同一件事就在末尾加「相关：[[那篇]]」
    const sets = new Map<string, Set<string>>()
    for (const [p, t] of texts) sets.set(p, shingles(plainText(t)))
    // 先算出每篇最像的那篇，再按像的程度挑前 LINK_MAX 处（导入几百条时一晚上不铺几百条）
    const cands: { p: string; to: string; score: number; passage: string }[] = []
    for (const p of loose) {
      const mine = sets.get(p)!
      if (mine.size < 12) continue
      let best: { path: string; score: number } | null = null
      for (const [q, other] of sets) {
        if (q === p || other.size < 12) continue
        const s = jaccard(mine, other)
        if (s >= 0.06 && s < 0.4 && (!best || s > best.score)) best = { path: q, score: s }
      }
      if (!best) continue
      const text = texts.get(p)!
      if (text.includes(`[[${titleOf(best.path)}`)) continue
      const sim = similarity(text, texts.get(best.path)!)
      if (sim.containment >= 0.8 || Array.from(sim.passage).length < 4) continue
      cands.push({ p, to: best.path, score: best.score, passage: sim.passage })
    }
    cands.sort((a, b) => b.score - a.score)
    const linked = new Set<string>()
    let links = 0
    for (const c of cands) {
      if (links >= LINK_MAX) break
      if (linked.has(`${c.to}→${c.p}`)) continue
      const target = titleOf(c.to)
      await appendLine(join(wt, c.p), `相关：[[${target}]]`)
      await git.git(wt, ['add', '--', c.p])
      const commit = await commitChecked(wt, `梦游：「${titleOf(c.p)}」补上 [[${target}]]`)
      linked.add(`${c.p}→${c.to}`)
      links++
      add('link', {
        title: titleOf(c.p),
        sub: `↔ [[${target}]]`,
        why: `两篇都讲到「${c.passage}」。只在这篇末尾加一行，「${target}」那篇不改`,
        commit,
        files: [c.p],
      })
    }
    if (cands.length > LINK_MAX) report.notes.push(`还有 ${cands.length - links} 处能补双链，这次先补最像的 ${links} 处，下次梦游接着补`)

    // 5. 可能重复：只提醒，不改文件，没有提交；最像的 DUP_MAX 对
    const dups = duplicatesOf([...texts].map(([id, text]) => ({ id, text }))).sort((a, b) => b.score - a.score)
    for (const d of dups.slice(0, DUP_MAX)) {
      add('dup', {
        title: `${titleOf(d.a)} + ${titleOf(d.b)}`,
        sub: `相似度 ${Math.round(d.score * 100)}%`,
        why: `${d.why}。不删也不改任何一篇，你来决定留哪篇`,
        commit: null,
        files: [d.a, d.b],
      })
    }
    if (dups.length > DUP_MAX) report.notes.push(`还有 ${dups.length - DUP_MAX} 对可能重复的没列出来，⌘K「找重复」能看全部`)

    // 5b. 可视化：今天卡得最久的几处（挪动之前做，挂的是笔记现在的路径）
    for (const it of await makeDreamViz({ wt, texts, ask, now, notes: report.notes, commit: (m, ok) => commitChecked(wt, m, ok) })) add('viz', it)

    // 6. 归类和改名（挪动放最后：前面补双链改的是挪动前的路径）
    const inboxAll = (await git.git(wt, ['ls-files', '-z', '--', INBOX + '/'])).split('\0').filter(Boolean)
    if (inboxAll.length) {
      try {
        const entries = inboxAll.map((p) => {
          const t = texts.get(p)
          const props = t ? readProps(t).filter((x) => !HIDDEN_KEYS.has(x.key)).map((x) => `${x.key}: ${x.value}`).join('；') : ''
          return { path: p, preview: t ? previewOf(t, 300) || titleOf(p) : `（${p.split('.').pop()} 文件）${basename(p)}`, props }
        })
        const plans = await planInBatches(entries, foldersOf(files), (p) => ask(SYSTEM, p), (n) => report.notes.push(n))
        for (const plan of plans) {
          const it = await fileOne(wt, plan, texts)
          add('file', it)
        }
        report.stay = inboxAll.length - plans.length
      } catch (e) {
        report.notes.push(`收件箱没归类：${(e as Error).message}`)
      }
    }
  } catch (e) {
    await closeDream(root, report, wt).catch(() => undefined)
    throw e
  }

  // 列表按设计稿分组：归类和改名、双链、重复、小结；cherry-pick 按提交顺序
  const order: DreamGroup[] = ['file', 'viz', 'link', 'dup', 'week']
  report.items.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
  report.finished = Date.now()
  ;(report as DreamReportInternal).worktree = wt
  ;(report as DreamReportInternal).commitOrder = commitItems.map((i) => i.id)
  ;(report as DreamReportInternal).tip = await head(wt)
  await closeIfDone(root, report)
  return report
}

/** 存盘用的报告多三项：临时检出在哪、提交顺序、分支最后一次提交（分支删了也能接着重做） */
export interface DreamReportInternal extends DreamReport {
  worktree?: string
  commitOrder?: string[]
  tip?: string
}

/** 还有没处理的提交吗 */
const hasPendingCommits = (r: DreamReport) => r.items.some((i) => i.commit && i.state === 'pending')

/** 删掉临时检出和梦游分支 */
async function closeDream(root: string, r: DreamReport, wt?: string) {
  const dir = wt ?? (r as DreamReportInternal).worktree
  if (dir) {
    await git.git(root, ['worktree', 'remove', '--force', dir]).catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
    await git.git(root, ['worktree', 'prune']).catch(() => undefined)
  }
  if (await branchExists(root, r.branch)) await git.git(root, ['branch', '-D', r.branch])
  r.closed = true
}

/** 提交都处理完了就删分支和临时检出（可能重复那几条只是提醒，不用等） */
export async function closeIfDone(root: string, r: DreamReport) {
  if (!r.closed && !hasPendingCommits(r)) await closeDream(root, r)
}

function find(r: DreamReport, id: string): DreamItem {
  const it = r.items.find((i) => i.id === id)
  if (!it) throw new Error('报告里没有这一条')
  return it
}

/**
 * 挪动不算改过：收下（或撤回）前记下每个文件原来位置的修改时间，挪完以后新位置设回去。
 * 不然 cherry-pick 把文件写在新位置、修改时间成了现在：导进来的几百条旧笔记收下后全算「这周动过的」、不进归档。
 */
async function keepTimes(root: string, moves: { from: string; to: string }[]): Promise<() => Promise<void>> {
  const times: [string, Date][] = []
  for (const m of moves) {
    try {
      times.push([m.to, (await stat(join(root, m.from))).mtime])
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  return async () => {
    for (const [p, t] of times) {
      try {
        await utimes(join(root, p), t, t)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
  }
}

/** 收下一条：用户没提交的改动先提交，再 cherry-pick；冲突就退回，告诉用户 */
async function cherryPick(root: string, it: DreamItem): Promise<void> {
  if (!it.commit) {
    it.state = 'taken'
    return
  }
  const pending = await git.status(root)
  if (pending.length) await git.commitAll(root, git.describeChanges(pending))
  const restore = await keepTimes(root, it.move ? [it.move] : [])
  try {
    // 不按「整个文件夹挪走了」去猜：丢掉的那几条挪动会让 git 以为 素材/旅行/ 整个挪回了收件箱
    await git.git(root, ['-c', 'merge.directoryRenames=false', 'cherry-pick', it.commit])
  } catch (e) {
    if (!(e instanceof git.GitError)) throw e
    // 这条的改动 main 上已经有了：算收下，不多一次空提交
    if (/empty|nothing to commit/i.test(e.stderr + e.message)) {
      await git.git(root, ['cherry-pick', '--skip']).catch(() => git.git(root, ['cherry-pick', '--abort']).catch(() => undefined))
      it.state = 'taken'
      return
    }
    await git.git(root, ['cherry-pick', '--abort']).catch(() => undefined)
    throw new Error(`「${it.title}」和你后来的改动冲突了，没收下。可以丢掉这条。`)
  }
  await restore()
  it.state = 'taken'
  it.taken = await head(root)
}

export async function takeItem(root: string, r: DreamReport, id: string): Promise<void> {
  const it = find(r, id)
  if (it.state !== 'pending') return
  await cherryPick(root, it)
  await closeIfDone(root, r)
}

export async function dropItem(root: string, r: DreamReport, id: string): Promise<void> {
  const it = find(r, id)
  if (it.state !== 'pending') return
  it.state = 'dropped'
  await closeIfDone(root, r)
}

/** 剩下的全部收下：一次提交 */
export async function takeAll(root: string, r: DreamReport): Promise<string | null> {
  return takeMany(
    root,
    r,
    r.items.filter((i) => i.state === 'pending').map((i) => i.id),
  )
}

/**
 * 收下几条（一组、预览条上的「收下这 N 处」、全部收下）：按提交顺序 cherry-pick --no-commit，合成一次提交进当前分支。
 * 只有一条、又没重做过时照旧 cherry-pick（提交说明就是那一条的）。冲突就整个退回，告诉用户。返回那次提交号。
 */
export async function takeMany(root: string, r: DreamReport, ids: string[]): Promise<string | null> {
  const order = (r as DreamReportInternal).commitOrder ?? r.items.map((i) => i.id)
  const rank = (i: DreamItem) => (order.includes(i.id) ? order.indexOf(i.id) : order.length)
  const items = ids
    .map((id) => find(r, id))
    .filter((i) => i.state === 'pending')
    .sort((a, b) => rank(a) - rank(b))
  if (!items.length) return null
  try {
    if (items.length === 1 && !items[0]!.redoCommits?.length) {
      await cherryPick(root, items[0]!)
      return items[0]!.taken ?? null
    }
    const commits = items.flatMap((i) => (i.commit ? [i.commit, ...(i.redoCommits ?? [])] : []))
    if (!commits.length) {
      for (const i of items) i.state = 'taken'
      return null
    }
    const pending = await git.status(root)
    if (pending.length) await git.commitAll(root, git.describeChanges(pending))
    const restore = await keepTimes(root, items.flatMap((i) => (i.move ? [i.move] : [])))
    try {
      // 导入几百条后一次收下几百个提交，机器忙时 30 秒不够
      await git.git(root, ['-c', 'merge.directoryRenames=false', 'cherry-pick', '--no-commit', ...commits], { timeoutMs: 5 * 60_000 })
    } catch (e) {
      if (!(e instanceof git.GitError)) throw e
      await git.git(root, ['cherry-pick', '--abort']).catch(() => undefined)
      await git.git(root, ['reset', '-q', '--hard', 'HEAD'])
      throw new Error(`这 ${items.length} 处里有和你后来的改动冲突的，一处都没收下。可以一条条收下，冲突的那条丢掉。`)
    }
    const staged = (await git.git(root, ['diff', '--cached', '--name-only'])).trim()
    if (!staged) {
      for (const i of items) i.state = 'taken'
      return null
    }
    const real = items.filter((i) => i.commit)
    const files = real.filter((i) => i.group === 'file').length
    const message = files === real.length ? `收下梦游的归类和改名：${files} 处` : `收下梦游的整理：${real.length} 处`
    await git.git(root, ['commit', '-q', '-m', message], { timeoutMs: 5 * 60_000 })
    await restore()
    const hash = await head(root)
    for (const i of items) {
      i.state = 'taken'
      if (i.commit) i.taken = hash
    }
    return hash
  } finally {
    await closeIfDone(root, r)
  }
}

export async function dropMany(root: string, r: DreamReport, ids: string[]): Promise<void> {
  for (const id of ids) {
    const it = find(r, id)
    if (it.state === 'pending') it.state = 'dropped'
  }
  await closeIfDone(root, r)
}

/**
 * 撤回：taken 是收下时那次提交，再做一次反向提交，这几条回到待看（分支删了也能再收下：提交还在）；
 * 不给 taken 是撤回丢掉，这几条回到待看。返回反向提交的提交号。
 */
export async function undo(root: string, r: DreamReport, ids: string[], taken?: string): Promise<string | null> {
  const items = ids.map((id) => find(r, id))
  let hash: string | null = null
  if (taken) {
    if (!items.every((i) => i.taken === taken || (i.state === 'taken' && !i.commit))) throw new Error('这几条不是那一次收下的')
    // 挪回收件箱也不算改过
    const restore = await keepTimes(root, items.flatMap((i) => (i.move ? [{ from: i.move.to, to: i.move.from }] : [])))
    hash = await git.revert(root, taken)
    await restore()
  } else if (!items.every((i) => i.state === 'dropped')) throw new Error('这几条没丢掉')
  for (const i of items) {
    i.state = 'pending'
    delete i.taken
  }
  return hash
}

/** 分支和临时检出删了（都处理完以后又撤回）：按最后一次提交重新建出来，好接着重做 */
async function ensureOpen(root: string, r: DreamReportInternal, scratch: string): Promise<string> {
  if (!r.closed && r.worktree && (await exists(r.worktree))) return r.worktree
  if (!r.tip) throw new Error('这份报告太旧了，重做不了；再梦游一次')
  if (!(await branchExists(root, r.branch))) await git.git(root, ['branch', r.branch, r.tip])
  await mkdir(scratch, { recursive: true })
  const wt = await mkdtemp(join(scratch, 'dream-'))
  await git.git(root, ['worktree', 'add', '-q', wt, r.branch])
  r.worktree = wt
  r.closed = false
  return wt
}

/**
 * 跟 AI 说哪里不对：在梦游分支上按这句话重做这几条归类和改名，每条变了的是分支上一次新提交；
 * 他说留在收件箱的那条挪回去、算丢掉。返回变了几条。
 */
export async function redo(root: string, r: DreamReportInternal, ids: string[], feedback: string, ask: Ask, scratch: string): Promise<number> {
  const text = feedback.replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!text) throw new Error('先说一句哪里不对')
  const items = ids.map((id) => find(r, id)).filter((i) => i.group === 'file' && i.state === 'pending' && i.move)
  if (!items.length) throw new Error('这几条没有能重做的（收下或丢掉的不重做）')
  const wt = await ensureOpen(root, r, scratch)
  const files = (await git.git(wt, ['ls-files', '-z'])).split('\0').filter(Boolean)
  const current = items.map((i) => ({ path: i.move!.from, folder: dirname(i.move!.to), name: titleOf(i.move!.to), why: i.why }))
  const reply = await ask(SYSTEM, redoPrompt(text, current, foldersOf(files)))
  const plans = parsePlan(reply, current.map((c) => c.path), true)
  let changed = 0
  for (const plan of plans) {
    const it = items.find((i) => i.move!.from === plan.path)!
    const target = plan.folder === INBOX ? it.move!.from : targetOf(plan)
    if (target === it.move!.to) continue
    const moved = await moveOnBranch(wt, it.move!.to, target)
    const c = await commitChecked(wt, `梦游：按你说的重做「${titleOf(plan.path)}」`, moved.ok)
    it.redoCommits = [...(it.redoCommits ?? []), c]
    it.move = { from: it.move!.from, to: moved.to }
    it.files = [it.move.from, moved.to]
    it.redo = text
    it.why = `你说「${text}」，${plan.why || '按你说的重做了'}`
    if (moved.to === it.move.from) {
      it.state = 'dropped'
      it.sub = '按你说的留在收件箱'
    } else {
      it.title = titleOf(moved.to)
      it.sub = `从 收件箱 挪来 · 原名 ${titleOf(it.move.from)}`
    }
    changed++
  }
  r.tip = await head(wt)
  await closeIfDone(root, r)
  return changed
}

/** 在梦游分支上把 cur 挪到 target（名字重了加序号），md 里的标题和相对链接跟着改，别的笔记里的 [[旧名]] 换成新名 */
async function moveOnBranch(wt: string, cur: string, target: string): Promise<{ to: string; ok: Set<string> }> {
  const ext = /\.[^./]+$/.exec(target)?.[0] ?? ''
  const stem = target.slice(0, target.length - ext.length)
  let to = target
  for (let n = 2; to !== cur && (await exists(join(wt, to))); n++) to = `${stem} ${n}${ext}`
  const ok = new Set([cur, to])
  if (to === cur) return { to, ok }
  await mkdir(dirname(join(wt, to)), { recursive: true })
  await git.git(wt, ['mv', '--', cur, to])
  if (to.endsWith('.md')) {
    const { text, meta } = decodeNote(await readFile(join(wt, to)))
    const next = movedText(text, cur, to)
    if (next !== text && !meta.readOnly) {
      await writeFile(join(wt, to), encodeNote(next, meta))
      await git.git(wt, ['add', '--', to])
    }
  }
  const oldName = titleOf(cur)
  const newName = titleOf(to)
  if (oldName !== newName) {
    // 只看提到 [[旧名 的那几篇（导入几百条时一篇篇全读太慢）
    const mentions = await git.git(wt, ['grep', '-l', '-z', '-F', '-e', `[[${oldName}`, '--', '*.md']).catch((e) => {
      if (e instanceof git.GitError) return ''
      throw e
    })
    for (const f of mentions.split('\0').filter(Boolean)) {
      if (f === to) continue
      const { text, meta } = decodeNote(await readFile(join(wt, f)))
      const next = relinkText(text, oldName, newName)
      if (next === text || meta.readOnly) continue
      // 别处的笔记只许多出换名的双链：上面就是这么算出来的，所以放行
      await writeFile(join(wt, f), encodeNote(next, meta))
      await git.git(wt, ['add', '--', f])
      ok.add(f)
    }
  }
  return { to, ok }
}

/** 一条归类和改名：挪好、提交，返回报告里那一条 */
async function fileOne(wt: string, plan: FilePlan, texts: Map<string, string>): Promise<Omit<DreamItem, 'id' | 'group' | 'state'>> {
  const moved = await moveOnBranch(wt, plan.path, targetOf(plan))
  const renamed = titleOf(moved.to) !== titleOf(plan.path)
  const c = await commitChecked(wt, `梦游：「${titleOf(plan.path)}」挪到 ${plan.folder}${renamed ? `，改名「${titleOf(moved.to)}」` : ''}`, moved.ok)
  const t = texts.get(plan.path)
  return {
    title: titleOf(moved.to),
    sub: `从 收件箱 挪来 · 原名 ${titleOf(plan.path)}`,
    why: plan.why || (t ? `AI 读了内容，放进「${plan.folder}」` : `按文件名放进「${plan.folder}」`),
    commit: c,
    files: [plan.path, moved.to],
    move: { from: plan.path, to: moved.to },
  }
}

/** 这一条的提交改了什么 */
export async function itemDiff(root: string, r: DreamReport, id: string): Promise<DreamDiffFile[]> {
  const it = find(r, id)
  if (!it.commit) return []
  // 重做过的：从第一次提交之前到最后一次重做，只看这一条的文件
  const last = it.redoCommits?.[it.redoCommits.length - 1]
  const out = last
    ? await git.git(root, ['diff', '-M', '--no-color', '--no-ext-diff', '-U2', `${it.commit}^`, last, '--', ...it.files])
    : await git.git(root, ['show', '--format=', '-M', '--no-color', '--no-ext-diff', '-U2', it.commit])
  return parseDiff(out)
}

export function parseDiff(out: string): DreamDiffFile[] {
  const files: DreamDiffFile[] = []
  let cur: DreamDiffFile | null = null
  const unq = (s: string) => s.replace(/^"|"$/g, '')
  for (const line of out.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      cur = { path: unq(m?.[2] ?? ''), status: 'changed', lines: [] }
      files.push(cur)
      continue
    }
    if (!cur) continue
    if (line.startsWith('new file mode')) cur.status = 'new'
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted'
    else if (line.startsWith('rename from ')) {
      cur.from = unq(line.slice('rename from '.length))
      cur.status = 'moved'
    } else if (line.startsWith('rename to ')) cur.path = unq(line.slice('rename to '.length))
    else if (line.startsWith('@@')) {
      if (cur.lines.length) cur.lines.push({ k: 'gap', t: '…' })
    } else if (/^(index |similarity index|--- |\+\+\+ |old mode|new mode|\\ No newline)/.test(line)) continue
    else if (line.startsWith('+')) cur.lines.push({ k: 'a', t: line.slice(1) })
    else if (line.startsWith('-')) cur.lines.push({ k: 'd', t: line.slice(1) })
    else if (line.startsWith(' ')) cur.lines.push({ k: 'c', t: line.slice(1) })
  }
  for (const f of files) if (f.status === 'moved' && !f.lines.length) f.lines.push({ k: 'gap', t: `从 ${f.from} 挪到 ${f.path}，内容没变` })
  return files
}
