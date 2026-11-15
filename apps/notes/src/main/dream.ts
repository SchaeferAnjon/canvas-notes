/**
 * 梦游：在单独的分支 dream/MM-DD 上整理，每条建议是分支上的一个提交，用户逐条收下（cherry-pick）或丢掉。
 * 用 git worktree 在临时目录检出这个分支，不碰用户正在用的工作目录。
 * 只动 收件箱/、素材/、周记/；用户自己写的作品一个字都不改（每次提交前检查）。
 * 这里不依赖 Electron：路径和 AI 都由调用方给，单元测试直接跑。
 */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { decodeNote, encodeNote, plainText, shingles, similarity, jaccard } from '@cn/format'
import * as git from '@cn/git'
import type { DreamDiffFile, DreamGroup, DreamItem, DreamReport } from '../shared/api'
import { CLIPS, INBOX, previewOf, titleOf } from '../shared/layout'
import { BRAND } from '../shared/brand'
import { duplicatesOf } from './duplicates'

/** 梦游能动的文件夹 */
export const DREAM_FOLDERS = [INBOX, CLIPS, '周记']
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

/** 提交前检查：暂存区里每个路径（挪动的新旧两头都算）都在梦游能动的文件夹里 */
async function commitChecked(wt: string, message: string): Promise<string> {
  const staged = (await git.git(wt, ['diff', '--cached', '--name-only', '--no-renames', '-z'])).split('\0').filter(Boolean)
  const bad = staged.filter((p) => !allowed(p))
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
    const linked = new Set<string>()
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
      const target = titleOf(best.path)
      const text = texts.get(p)!
      if (text.includes(`[[${target}`) || linked.has(`${best.path}→${p}`)) continue
      const sim = similarity(text, texts.get(best.path)!)
      if (sim.containment >= 0.8 || Array.from(sim.passage).length < 4) continue
      await appendLine(join(wt, p), `相关：[[${target}]]`)
      await git.git(wt, ['add', '--', p])
      const c = await commitChecked(wt, `梦游：「${titleOf(p)}」补上 [[${target}]]`)
      linked.add(`${p}→${best.path}`)
      add('link', {
        title: titleOf(p),
        sub: `↔ [[${target}]]`,
        why: `两篇都讲到「${sim.passage}」。只在这篇末尾加一行，「${target}」那篇不改`,
        commit: c,
        files: [p],
      })
    }

    // 5. 可能重复：只提醒，不改文件，没有提交
    for (const d of duplicatesOf([...texts].map(([id, text]) => ({ id, text })))) {
      add('dup', {
        title: `${titleOf(d.a)} + ${titleOf(d.b)}`,
        sub: `相似度 ${Math.round(d.score * 100)}%`,
        why: `${d.why}。不删也不改任何一篇，你来决定留哪篇`,
        commit: null,
        files: [d.a, d.b],
      })
    }

    // 6. 收件箱分类（挪动放最后：前面补双链改的是挪动前的路径）
    if (inbox.length) {
      try {
        const topics = [...new Set(files.filter((f) => f.startsWith(CLIPS + '/') && f.split('/').length > 2).map((f) => f.split('/')[1]!))]
        const list = inbox.map((p) => `路径：${p}\n内容：${previewOf(texts.get(p)!, 300)}`).join('\n\n')
        const reply = await ask(
          SYSTEM,
          `命令：整理收件箱\n\n下面是收件箱里的东西。给每一条选一个主题（素材文件夹名），优先用已有的主题：${topics.join('、') || '（还没有）'}。
没把握的那条就不要列出来。主题名短一点（2 到 6 个字）。why 用一句话说为什么归到这里。
只输出一个 JSON 代码块：[{"path": "收件箱/…", "topic": "主题", "why": "…"}]\n\n${list}`,
        )
        const raw = parseJsonBlock(reply)
        if (!Array.isArray(raw)) throw new Error('AI 没给出能用的整理方案')
        const seen = new Set<string>()
        for (const x of raw as { path?: unknown; topic?: unknown; why?: unknown }[]) {
          if (typeof x?.path !== 'string' || typeof x.topic !== 'string') continue
          const topic = x.topic.trim()
          if (!inbox.includes(x.path) || seen.has(x.path) || !topic || /[\\/:]|^\./.test(topic) || topic.length > 20) continue
          seen.add(x.path)
          const dir = `${CLIPS}/${topic}`
          let to = `${dir}/${basename(x.path)}`
          for (let n = 2; await exists(join(wt, to)); n++) to = `${dir}/${basename(x.path, '.md')} ${n}.md`
          await mkdir(dirname(join(wt, to)), { recursive: true })
          await git.git(wt, ['mv', '--', x.path, to])
          const c = await commitChecked(wt, `梦游：「${titleOf(x.path)}」归到 ${dir}`)
          add('inbox', {
            title: previewOf(texts.get(x.path)!, 40) || titleOf(x.path),
            sub: `→ ${dir}`,
            why: typeof x.why === 'string' && x.why.trim() ? x.why.trim() : `AI 读了内容，归到「${topic}」`,
            commit: c,
            files: [x.path, to],
          })
        }
      } catch (e) {
        report.notes.push(`收件箱没分类：${(e as Error).message}`)
      }
    }
  } catch (e) {
    await closeDream(root, report, wt).catch(() => undefined)
    throw e
  }

  // 列表按设计稿分组：收件箱、双链、重复、小结；cherry-pick 按提交顺序
  const order: DreamGroup[] = ['inbox', 'link', 'dup', 'week']
  report.items.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
  report.finished = Date.now()
  ;(report as DreamReportInternal).worktree = wt
  ;(report as DreamReportInternal).commitOrder = commitItems.map((i) => i.id)
  await closeIfDone(root, report)
  return report
}

/** 存盘用的报告多两项：临时检出在哪、提交顺序 */
export interface DreamReportInternal extends DreamReport {
  worktree?: string
  commitOrder?: string[]
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

/** 收下一条：用户没提交的改动先提交，再 cherry-pick；冲突就退回，告诉用户 */
async function cherryPick(root: string, it: DreamItem): Promise<void> {
  if (!it.commit) {
    it.state = 'taken'
    return
  }
  const pending = await git.status(root)
  if (pending.length) await git.commitAll(root, git.describeChanges(pending))
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

/** 剩下的全部收下：按提交顺序一条条 cherry-pick，遇到冲突停下 */
export async function takeAll(root: string, r: DreamReport): Promise<void> {
  const order = (r as DreamReportInternal).commitOrder ?? r.items.map((i) => i.id)
  const rest = [...order.map((id) => find(r, id)), ...r.items.filter((i) => !order.includes(i.id))].filter((i) => i.state === 'pending')
  try {
    for (const it of rest) await cherryPick(root, it)
  } finally {
    await closeIfDone(root, r)
  }
}

/** 这一条的提交改了什么 */
export async function itemDiff(root: string, r: DreamReport, id: string): Promise<DreamDiffFile[]> {
  const it = find(r, id)
  if (!it.commit) return []
  const out = await git.git(root, ['show', '--format=', '-M', '--no-color', '--no-ext-diff', '-U2', it.commit])
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
