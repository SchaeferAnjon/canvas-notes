/**
 * 梦游：在单独的分支 dream/MM-DD 上整理，每条建议是分支上的一个提交，用户逐条收下（cherry-pick）或丢掉。
 * 用 git worktree 在临时目录检出这个分支，不碰用户正在用的工作目录。
 * 每一步做不做、一晚最多几处、能动哪些文件夹照设置 › 梦游（shared/dream-settings.ts，默认 收件箱/、阅读/、剪藏/、周记/）；
 * 能动的文件夹以外、用户自己写的作品一个字都不改（每次提交前检查）。
 * 归类和改名例外：收件箱里的东西可以挪出去（课程/、项目/、生活/、写作/），改名时别的笔记里指向它的 [[旧名]] 跟着换，
 * 这两样提交前也逐个核对（挪的源头在收件箱、别处只多了换名的双链）。
 * 可视化也是例外（dream-viz.ts）：今天卡得最久的几处各做一个 HTML 放进课程文件夹、挂到读 PDF 笔记那一段的脚上，只动这两个文件。
 * 这里不依赖 Electron：路径和 AI 都由调用方给，单元测试直接跑。
 */
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { menuKey } from './commands'
import { basename, dirname, extname, join } from 'node:path'
import { decodeNote, encodeNote, merge3Fine, readProps } from '@cn/format'
import * as git from '@cn/git'
import type { DreamGroup, DreamItem, DreamReport, DuplicatePair } from '../shared/api'
import { INBOX, previewOf, titleOf } from '../shared/layout'
import { catName } from '../shared/categories'
import { VIDEO_FOLDER, videoOf } from '../shared/video'
import { BRAND } from '../shared/brand'
import { duplicatesOf, isAutoSummary, type LinkCand, linkCandidates, linkWhy } from './duplicates'
import { oldImagesOnBranch } from './dream-attach'
import { makeDreamViz } from './dream-viz'
import { movedText, relinkText } from './dream-file'
import { FILE_BATCH, foldersOf, type FileMode, inboxEntry, parsePlan, planInBatches, redoPrompt, targetOf, type FilePlan } from '../shared/filing'
import { DEFAULT_DREAM, type DreamSettings, filesOn, inDreamFolders, linkFolders, weekOn } from '../shared/dream-settings'

/** 梦游默认能动的：收件箱、阅读（微信读书同步的书摘 2026-11-18 起在这里）、剪藏、周记；设置 › 梦游 里能改 */
export const DREAM_FOLDERS = DEFAULT_DREAM.folders
/** 一晚最多补几处双链、列几对可能重复的默认值（导入几百条旧笔记时不铺满报告） */
export const LINK_MAX = DEFAULT_DREAM.linkMax
export const DUP_MAX = DEFAULT_DREAM.dupMax
const allowedDefault = (p: string) => inDreamFolders(DEFAULT_DREAM, p)

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
  /** 梦游用的哪家哪个模型（「Claude Code · Opus 5.5」），写进可视化那一条（CN-54） */
  by?: string
  /** 补双链、找重复这两样重活怎么算；不给就在这个进程里算（单元测试） */
  similar?: Similar
  /** 设置 › 梦游：哪几样做、一晚最多几处、能动哪些文件夹；不给是默认（全做） */
  settings?: DreamSettings
}

/** 补双链、找重复：几千篇的库要算几分钟 */
export interface Similar {
  links(texts: [string, string][], loose: string[]): Promise<LinkCand[]>
  duplicates(docs: { id: string; text: string }[]): Promise<DuplicatePair[]>
}

const inProcess: Similar = {
  links: async (texts, loose) => linkCandidates(texts, loose),
  duplicates: async (docs) => duplicatesOf(docs),
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

/** 提交前检查：暂存区里每个路径（挪动的新旧两头都算）都在梦游能动的文件夹里（allowed，照设置），或者是核对过的那几个（ok） */
async function commitChecked(wt: string, message: string, ok: ReadonlySet<string> = new Set(), allowed: (p: string) => boolean = allowedDefault): Promise<string> {
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

/**
 * 上次梦游被打断（⌘Q、崩溃）留下的 dream/ 分支和它的临时检出：报告没存下，界面上看不到也没人清，下次只好改叫 dream/11-17-2。
 * 下次梦游前清掉；keep 是还开着的那份报告的分支（里面的条目还能收下）。返回清掉的分支
 */
export async function clearStrayDreams(root: string, keep: string | null): Promise<string[]> {
  const out = await git.git(root, ['worktree', 'list', '--porcelain'])
  for (const block of out.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
    if (!path || !branch?.startsWith('dream/') || branch === keep) continue
    await git.git(root, ['worktree', 'remove', '--force', path]).catch(() => undefined)
    await rm(path, { recursive: true, force: true })
  }
  await git.git(root, ['worktree', 'prune']).catch(() => undefined)
  const stray = (await git.git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/dream/'])).split('\n').filter((b) => b && b !== keep)
  for (const b of stray) await git.git(root, ['branch', '-D', b])
  return stray
}

/** 跑一次梦游，返回报告。改动都在新分支上，当前分支只多一次「先把没提交的改动提交掉」 */
export async function runDream(o: DreamOptions): Promise<DreamReport> {
  const similar = o.similar ?? inProcess
  const set = o.settings ?? DEFAULT_DREAM
  const allowed = (p: string) => inDreamFolders(set, p)
  const check = (m: string, ok?: ReadonlySet<string>) => commitChecked(wt, m, ok, allowed)
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
    // 2b. 老图挪进各篇自己的附件文件夹（最先做：用的是还没挪动的路径；收件箱里的那几篇等归类以后再挪）。
    // 例外：改的是引用这些图的那几篇里的链接（在哪个文件夹都改），提交前逐个核对
    if (set.steps.attach) {
      try {
        const it = await oldImagesOnBranch(wt, files, texts, check)
        if (it) add('attach', it)
      } catch (e) {
        report.notes.push(`老图没挪：${(e as Error).message}`)
      }
    }
    // 补双链补在这几个文件夹里的笔记末尾（默认 收件箱、阅读、剪藏；周记只放小结）
    const linkIn = linkFolders(set)
    const loose = files.filter((f) => linkIn.some((d) => f.startsWith(d + '/')))

    // 3. 本周小结（新文件，和别的提交互不相干）
    const week = isoWeek(now)
    const weekPath = `${catName('周记')}/${week}.md`
    if (weekOn(set) && !texts.has(weekPath) && !(await exists(join(wt, weekPath)))) {
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
            await mkdir(join(wt, catName('周记')), { recursive: true })
            await writeFile(join(wt, weekPath), `---\nby: 梦游\ncreated: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}\n---\n# ${week} 小结\n\n${reply}\n`)
            await git.git(wt, ['add', '--', weekPath])
            const c = await check(`梦游：写了本周小结 ${weekPath}`)
            add('week', { title: `${catName('周记')} ${week}`, sub: `新文件 ${weekPath}`, why: '梦游按这周的提交写的，收下前可以改；你写的正文不会动', commit: c, files: [weekPath], changes: [{ path: weekPath, text: `新建 ${weekPath}` }] })
          }
        }
      } catch (e) {
        report.notes.push(`本周小结没写成：${(e as Error).message}`)
      }
    }

    // 4. 补双链：收件箱、剪藏、阅读里的笔记，和库里另一篇讲到同一件事就在末尾加「相关：[[那篇]]」
    // 先算出每篇最像的那篇，再按像的程度挑前 linkMax 处（设置 › 梦游，默认 30）（导入几百条时一晚上不铺几百条）。
    // 几千篇的库要算几分钟：交给 similar（软件里在单独的进程算，主进程不卡，退出时直接停掉）
    const cands = set.steps.link && loose.length ? await similar.links([...texts], loose) : []
    const linked = new Set<string>()
    let links = 0
    for (const c of cands) {
      if (links >= set.linkMax) break
      if (linked.has(`${c.to}→${c.p}`)) continue
      const target = titleOf(c.to)
      await appendLine(join(wt, c.p), `相关：[[${target}]]`)
      await git.git(wt, ['add', '--', c.p])
      const commit = await check(`梦游：「${titleOf(c.p)}」补上 [[${target}]]`)
      linked.add(`${c.p}→${c.to}`)
      links++
      add('link', {
        title: titleOf(c.p),
        sub: `↔ [[${target}]]`,
        why: `${linkWhy(c.terms)}。只在这篇末尾加一行，「${target}」那篇不改`,
        commit,
        files: [c.p],
        changes: [{ path: c.p, text: `末尾加了一行 相关：[[${target}]]` }],
      })
    }
    if (cands.length > set.linkMax) report.notes.push(`还有 ${cands.length - links} 处能补双链，这次先补最像的 ${links} 处，下次梦游接着补`)

    // 5. 可能重复：只提醒，不改文件，没有提交；最像的 dupMax 对
    const dups = set.steps.dup ? (await similar.duplicates([...texts].map(([id, text]) => ({ id, text })))).sort((a, b) => b.score - a.score) : []
    for (const d of dups.slice(0, set.dupMax)) {
      add('dup', {
        title: `${titleOf(d.a)} + ${titleOf(d.b)}`,
        sub: `相似度${Math.round(d.score * 100)}%`,
        why: `${d.why}。不删也不改任何一篇，你来决定留哪篇`,
        commit: null,
        files: [d.a, d.b],
      })
    }
    if (dups.length > set.dupMax) report.notes.push(`还有 ${dups.length - set.dupMax} 对可能重复的没列出来，${menuKey('search') ?? '搜索框'}「找重复」能看全部`)

    // 5a. 同一个视频记散在两篇以上（CN-80）：提醒合成一篇；只是提醒，不改文件
    for (const g of set.steps.video ? sameVideoNotes(texts) : []) {
      add('dup', {
        title: g.files.map((f) => titleOf(f)).join(' + '),
        sub: `同一个视频《${g.title}》· 可以合成一篇`,
        why: `这 ${g.files.length} 篇都记着《${g.title}》的时刻或问答。合成一篇，以后看这个视频的笔记只在一处；不删也不改任何一篇，你来合`,
        commit: null,
        files: g.files,
      })
    }

    // 5b. 可视化：今天卡得最久的几处（挪动之前做，挂的是笔记现在的路径）。例外：挂在课程里读 PDF 的笔记上，提交前核对只动了那两个文件
    if (set.steps.viz) for (const it of await makeDreamViz({ wt, texts, ask, now, max: set.vizMax, notes: report.notes, commit: check, ...(o.by ? { by: o.by } : {}) })) add('viz', it)

    // 6. 归类和改名（挪动放最后：前面补双链改的是挪动前的路径）。两个开关各管一样：只挪不改名、只在原处改名
    const mode: FileMode | null = !filesOn(set) ? null : set.steps.file && set.steps.rename ? 'both' : set.steps.file ? 'move' : 'rename'
    // 收件箱/待办.md 是画布今日和左边「待办」格的收件箱（task-pd1d1）：不归类、不改名
    const inboxAll = mode ? (await git.git(wt, ['ls-files', '-z', '--', INBOX + '/'])).split('\0').filter((p) => p && p !== `${INBOX}/待办.md`) : []
    if (mode && inboxAll.length) {
      try {
        // 归法和 /整理收件箱 是同一份（shared/filing.ts）；一批多少条、同时问几批能用环境变量调（导几百条时试）
        const entries = inboxAll.map((p) => inboxEntry(p, texts.get(p)))
        const plans = await planInBatches(entries, foldersOf(files), (p) => ask(SYSTEM, p), (n) => report.notes.push(n), mode, {
          batch: Number(process.env.CN_DREAM_BATCH) || FILE_BATCH,
          parallel: Number(process.env.CN_DREAM_PARALLEL) || 3,
        })
        for (const plan of plans) {
          const it = await fileOne(wt, plan, texts, allowed)
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
  const order: DreamGroup[] = ['attach', 'file', 'viz', 'link', 'dup', 'week']
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

/**
 * cherry-pick 一个提交。git 合不上的文件再用 merge3Fine 合一次：同一行两边改的不是同一处、两边都只往末尾加了几行（用户末尾打了一句、
 * 梦游补「相关：[[…]]」）都合得上，合上了照常提交（说明、作者用原来那次的）。这次的改动 main 上已经有了也算收下（不多一次空提交）。
 * 合不上就退回到 pick 之前，返回为什么（「你后来删了这篇」）；title 是这一条的标题，原因里的文件就是它时不重复写名字
 */
async function pickOne(root: string, commit: string, title: string): Promise<string | null> {
  try {
    // 不按「整个文件夹挪走了」去猜：丢掉的那几条挪动会让 git 以为 剪藏/旅行/ 整个挪回了收件箱
    await git.git(root, ['-c', 'merge.directoryRenames=false', 'cherry-pick', commit])
    return null
  } catch (e) {
    if (!(e instanceof git.GitError)) throw e
    const files = (await git.git(root, ['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean)
    if (!files.length) {
      if (/empty|nothing to commit/i.test(e.stderr + e.message)) {
        await git.git(root, ['cherry-pick', '--skip']).catch(() => git.git(root, ['cherry-pick', '--abort']).catch(() => undefined))
        return null
      }
      await git.git(root, ['cherry-pick', '--abort']).catch(() => undefined)
      throw e
    }
    const name = (f: string) => (titleOf(f) === title ? '这篇' : `「${titleOf(f)}」`)
    const merged: [string, string][] = []
    let why: string | null = null
    for (const f of files) {
      const stage = (n: number) => git.git(root, ['show', `:${n}:${f}`]).catch(() => null)
      const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)])
      if (ours === null) why = `你后来删了${name(f)}`
      else if (base === null) why = `你后来也建了一篇${name(f)}`
      else if (theirs === null) why = `${name(f)}后来又改过，合不上`
      else {
        const m = merge3Fine(base, ours, theirs)
        if (m.conflict) why = `你后来在${name(f)}里改的和它要改的是同一处`
        else merged.push([f, m.text])
      }
      if (why) break
    }
    if (why) {
      await git.git(root, ['cherry-pick', '--abort']).catch(() => undefined)
      return why
    }
    for (const [f, text] of merged) await writeFile(join(root, f), text)
    await git.git(root, ['add', '--', ...files])
    if (!(await git.git(root, ['diff', '--cached', '--name-only'])).trim()) {
      await git.git(root, ['cherry-pick', '--skip'])
      return null
    }
    await git.git(root, ['commit', '-q', '-C', commit])
    return null
  }
}

/** 收下一条：和一组、全部收下走同一条路；合不上就退回，说是哪条、为什么 */
export async function takeItem(root: string, r: DreamReport, id: string): Promise<void> {
  const it = find(r, id)
  if (it.state !== 'pending') return
  await takeMany(root, r, [id])
  if (it.state === 'pending' && it.conflict) throw new Error(`「${it.title}」没收下：${it.conflict}。可以丢掉这条。`)
}

export async function dropItem(root: string, r: DreamReport, id: string): Promise<void> {
  const it = find(r, id)
  if (it.state !== 'pending') return
  it.state = 'dropped'
  await closeIfDone(root, r)
}

/**
 * 这一次收下、撤回挪了哪几篇：前后比每条的状态。待看 → 收下是 from → to，收下 → 待看（撤回）是 to → from。
 * 单条收下、一组、全部收下、撤回都从这里出，开着的那篇跟过去走同一条路
 */
export function movesOf(before: Map<string, DreamItem['state']>, items: DreamItem[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const it of items) {
    if (!it.move || !it.commit || it.move.from === it.move.to) continue
    const was = before.get(it.id)
    if (was === 'pending' && it.state === 'taken') out.push({ from: it.move.from, to: it.move.to })
    else if (was === 'taken' && it.state === 'pending') out.push({ from: it.move.to, to: it.move.from })
  }
  return out
}

/**
 * 设置里选了「改完直接收下」：梦游完把有提交的几条一次收下（只提醒的留着看），记下那次提交好在报告里一键撤回。
 * 合不上的那几条照常留着待看。返回那次提交号
 */
export async function autoTake(root: string, r: DreamReport): Promise<string | null> {
  const hash = await takeMany(
    root,
    r,
    r.items.filter((i) => i.commit && i.state === 'pending').map((i) => i.id),
  )
  if (hash) r.autoTaken = hash
  return hash
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
 * 收下几条（一条、一组、预览条上的「收下这 N 处」、全部收下）：用户没提交的改动先提交，再按提交顺序一条条 cherry-pick；
 * 合不上的那条退回、记下为什么（item.conflict），留着待看，别的照收（第 6 轮：以前碰到一条冲突就一条都不收，也不说是哪条）。
 * 收下的几条合成一次提交进当前分支；只收下一条、又没重做过时保留那一条自己的提交（说明就是那一条的）。返回那次提交号
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
    const ok = items.filter((i) => !i.commit)
    const real = items.filter((i) => i.commit)
    let hash: string | null = null
    if (real.length) {
      const pending = await git.status(root)
      if (pending.length) await git.commitAll(root, git.describeChanges(pending))
      const start = await head(root)
      const restore = await keepTimes(root, real.flatMap((i) => (i.move ? [i.move] : [])))
      for (const it of real) {
        const before = await head(root)
        let why: string | null = null
        for (const c of [it.commit!, ...(it.redoCommits ?? [])]) if ((why = await pickOne(root, c, it.title))) break
        if (!why) {
          delete it.conflict
          ok.push(it)
          continue
        }
        // 重做过的那几个提交前面的已经进来了：一起退回
        if ((await head(root)) !== before) await git.git(root, ['reset', '-q', '--hard', before])
        it.conflict = why
      }
      const taken = ok.filter((i) => i.commit)
      if ((await head(root)) !== start) {
        if (taken.length > 1 || taken.some((i) => i.redoCommits?.length)) {
          const files = taken.filter((i) => i.group === 'file').length
          const message = files === taken.length ? `收下梦游的归类和改名：${files} 处` : `收下梦游的整理：${taken.length} 处`
          await git.git(root, ['reset', '-q', '--soft', start])
          // 导入几百条后一次收下几百个提交，机器忙时 30 秒不够
          await git.git(root, ['commit', '-q', '-m', message], { timeoutMs: 5 * 60_000 })
        }
        hash = await head(root)
      }
      await restore()
    }
    for (const i of ok) {
      i.state = 'taken'
      if (i.commit && hash) i.taken = hash
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
    // 收下以后在开着的那篇里接着打的字（自动存了、还没提交）：先提交，和收下时一样，不然 git revert 嫌工作区不干净撤不回
    await git.commitPending(root)
    // 收下以后那篇在外面改了名、挪走或删了：撤回找不到它，直接说清楚（不去试 revert，那样报的是「同一处又改了」）
    const gone = await goneSince(root, taken, items)
    if (gone) throw new Error(gone)
    // 挪回收件箱也不算改过
    const restore = await keepTimes(root, items.flatMap((i) => (i.move ? [{ from: i.move.to, to: i.move.from }] : [])))
    // 撤回的说明用中文；同一行收下以后又打了字（图那一行后面接着写）按字合并，改的不是同一处就撤得回
    const subject = (await git.git(root, ['log', '-1', '--format=%s', taken])).trim()
    hash = await git
      .revert(root, taken, {
        message: subject.startsWith('梦游：') ? `撤回${subject}` : subject.startsWith('收下梦游的') ? `撤回${subject.slice(2)}` : `撤回梦游：${subject}`,
        resolve: (base, ours, theirs) => {
          const m = merge3Fine(base, ours, theirs)
          return m.conflict ? null : m.text
        },
        conflict: (files) =>
          `撤回不了：${[...new Set(files.map((f) => `「${titleOf(f)}」`))].join('、')}里这次改过的地方后来又改了，和撤回要改的是同一处。什么都没动；要改回去，在右竖条「历史」里点开这次收下，照着对比手动改。`,
      })
      .finally(restore)
  } else if (!items.every((i) => i.state === 'dropped')) throw new Error('这几条没丢掉')
  for (const i of items) {
    i.state = 'pending'
    delete i.taken
  }
  return hash
}

/**
 * 收下时挪过去的那篇，后来在外面改了名、挪走或删了（访达、同步盘）：撤回要把它挪回收件箱，却找不到它。
 * 返回说给用户的那句（它现在叫什么、在哪）；都还在原处给 null
 */
async function goneSince(root: string, taken: string, items: DreamItem[]): Promise<string | null> {
  for (const i of items) {
    if (!i.move || (await exists(join(root, i.move.to)))) continue
    // git 按内容认改名：收下那次以后，挪过去的那个文件变成了哪个
    const parts = (await git.git(root, ['diff', '-M', '--name-status', '-z', taken, 'HEAD'])).split('\0')
    let now: string | null = null
    for (let k = 0; k < parts.length; k++) {
      if (/^[RC]\d*$/.test(parts[k]!)) {
        if (parts[k + 1] === i.move.to) now = parts[k + 2]!
        k += 2
      } else if (parts[k]) k += 1
    }
    // git 只认相似度过半的：收件箱的随手记很短，外面改名时顺手添两句就认不出了。
    // 再看那次以后新出现的文件里，有没有一篇把原来那篇的字几乎都留着（同内容或改名时加了几句）
    if (!now) now = await grewInto(root, taken, i.move.to)
    const was = titleOf(i.move.to)
    // 短到底栏一行放得下（960 宽）；怎么办交给提示后面的「在历史里看」
    if (!now) return `撤回不了：「${was}」收下以后被删了，什么都没动`
    // 最外层写库名（CN-106）
    const where = titleOf(now) === was ? `挪到了${now.includes('/') ? now.slice(0, now.lastIndexOf('/')) : basename(root)}` : `改名成了「${titleOf(now)}」`
    return `撤回不了：「${was}」收下以后${where}，什么都没动`
  }
  return null
}

/**
 * 收下那次以后新加的文件里，哪一篇是 gone 改了名、又改了字变来的。按内容认，两种都算：
 * - 原来那篇的每一行（去掉空行）八成以上原样还在它里面（改名时在后面添了几句）；
 * - 按字比，原来正文（去掉 front matter）的字八成以上还在、顺序不变（改名时顺手改了几个字、在句子中间插了一段）。
 *   收件箱的随手记只有一两行正文，改一个字整行就不算「原样还在」了（第 6 轮）。
 * 好几篇都像时取最像的那篇；都不像是 null
 */
async function grewInto(root: string, taken: string, gone: string): Promise<string | null> {
  const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean)
  const before = await git.git(root, ['show', `${taken}:${gone}`])
  const old = lines(before)
  if (!old.length) return null
  const added = (await git.git(root, ['diff', '--no-renames', '--diff-filter=A', '--name-only', '-z', taken, 'HEAD'])).split('\0').filter((p) => p && extname(p) === extname(gone))
  let best: { path: string; share: number } | null = null
  for (const p of added) {
    const text = await git.git(root, ['show', `HEAD:${p}`])
    const now = new Set(lines(text))
    const share = Math.max(old.filter((l) => now.has(l)).length / old.length, kept(body(before), body(text)))
    if (share >= 0.8 && (!best || share > best.share)) best = { path: p, share }
  }
  return best?.path ?? null
}

/** 去掉开头的 front matter（随手记的 created: 这几行，篇篇都差不多，不拿来比像不像） */
const body = (t: string) => t.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\s+/g, '')

/** a 的字有几成按原来的顺序还在 b 里（最长公共子序列 ÷ a 的长度）；太长的不算（撤回认改名只看短笔记，长的 git 自己认得出） */
function kept(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  if (!x.length || x.length * y.length > 4_000_000) return 0
  let prev = new Array<number>(y.length + 1).fill(0)
  for (const c of x) {
    const cur = new Array<number>(y.length + 1).fill(0)
    for (let j = 1; j <= y.length; j++) cur[j] = c === y[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!)
    prev = cur
  }
  return prev[y.length]! / x.length
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
    // 重做以后正文改了的照最后一次算（挪回收件箱、换了名都重算）
    if (moved.self || moved.others) it.edits = { self: moved.self, others: moved.others }
    else delete it.edits
    it.files = [it.move.from, moved.to]
    it.changes = [{ path: moved.to, text: `按你说的挪到 ${dirname(moved.to) === '.' ? basename(root) : dirname(moved.to)}` }]
    it.redo = text
    it.why = `你说「${text}」，${plan.why || '按你说的重做了'}`
    if (moved.to === it.move.from) {
      it.state = 'dropped'
      it.sub = '按你说的留在收件箱'
    } else {
      it.title = titleOf(moved.to)
      it.sub = `从收件箱挪来 · 原名「${titleOf(it.move.from)}」`
    }
    changed++
  }
  r.tip = await head(wt)
  await closeIfDone(root, r)
  return changed
}

/** 在梦游分支上把 cur 挪到 target（名字重了加序号），md 里的标题和相对链接跟着改，别的笔记里的 [[旧名]] 换成新名 */
async function moveOnBranch(wt: string, cur: string, target: string): Promise<{ to: string; ok: Set<string>; self: boolean; others: number }> {
  const ext = /\.[^./]+$/.exec(target)?.[0] ?? ''
  const stem = target.slice(0, target.length - ext.length)
  let to = target
  for (let n = 2; to !== cur && (await exists(join(wt, to))); n++) to = `${stem} ${n}${ext}`
  const ok = new Set([cur, to])
  /** 正文真改了的：挪的这篇自己（标题、相对链接）、别的笔记里换了 [[旧名]] 的几篇 */
  let self = false
  let others = 0
  if (to === cur) return { to, ok, self, others }
  await mkdir(dirname(join(wt, to)), { recursive: true })
  await git.git(wt, ['mv', '--', cur, to])
  if (to.endsWith('.md')) {
    const { text, meta } = decodeNote(await readFile(join(wt, to)))
    const next = movedText(text, cur, to)
    if (next !== text && !meta.readOnly) {
      await writeFile(join(wt, to), encodeNote(next, meta))
      await git.git(wt, ['add', '--', to])
      self = true
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
      others++
    }
  }
  return { to, ok, self, others }
}

/** 一条归类和改名：挪好、提交，返回报告里那一条。去处还在原来的文件夹里就是只改名（设置里关了归类挪动） */
async function fileOne(wt: string, plan: FilePlan, texts: Map<string, string>, allowed: (p: string) => boolean): Promise<Omit<DreamItem, 'id' | 'group' | 'state'>> {
  const moved = await moveOnBranch(wt, plan.path, targetOf(plan))
  const renamed = titleOf(moved.to) !== titleOf(plan.path)
  const stays = dirname(moved.to) === dirname(plan.path)
  const was = titleOf(plan.path)
  const now = titleOf(moved.to)
  const c = await commitChecked(wt, stays ? `梦游：「${was}」改名「${now}」` : `梦游：「${was}」挪到 ${plan.folder}${renamed ? `，改名「${now}」` : ''}`, moved.ok, allowed)
  const t = texts.get(plan.path)
  return {
    title: now,
    sub: stays ? `改名 · 原名「${was}」` : `从收件箱挪来 · 原名「${was}」`,
    why: plan.why || (stays ? 'AI 读了内容，起了个一看就懂的名字' : t ? `AI 读了内容，放进「${plan.folder}」` : `按文件名放进「${plan.folder}」`),
    commit: c,
    files: [plan.path, moved.to],
    move: { from: plan.path, to: moved.to },
    ...(moved.self || moved.others ? { edits: { self: moved.self, others: moved.others } } : {}),
    changes: [{ path: moved.to, text: stays ? `改名「${now}」` : `从 收件箱 挪到 ${plan.folder}${renamed ? `，改名「${now}」` : ''}` }],
  }
}

/**
 * 同一个视频散在几篇笔记里（CN-80）：按文档里的视频卡、时刻、问答（video=<站>:<号>）和属性「视频: <网址>」认；
 * 字幕全文（素材/视频/）和软件汇总的（视频里的疑惑）不算。两篇以上才给。
 */
export function sameVideoNotes(texts: Map<string, string>): { key: string; title: string; files: string[] }[] {
  const byKey = new Map<string, { title: string; files: string[] }>()
  for (const [path, text] of texts) {
    if (path.startsWith(VIDEO_FOLDER + '/') || isAutoSummary(text)) continue
    const keys = new Set([...text.matchAll(/<!--\s*(?:video|moment|moment-ask)\s+video=(\S+)/g)].map((m) => m[1]!))
    const own = videoOf(readProps(text).find((p) => p.key === '视频')?.value)
    if (own) keys.add(own.key)
    for (const k of keys) {
      const g = byKey.get(k) ?? { title: '', files: [] }
      g.files.push(path)
      if (!g.title) g.title = /\[▶ [\d:]+ · (.+)\]\(/.exec(text)?.[1] ?? ''
      byKey.set(k, g)
    }
  }
  return [...byKey]
    .filter(([, g]) => g.files.length >= 2)
    .map(([key, g]) => ({ key, title: g.title || key, files: g.files.sort() }))
}

