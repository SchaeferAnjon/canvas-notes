/**
 * 梦游接到软件里：报告存在软件设置目录（JSON），闲时自己跑，界面通过 IPC 收下、丢掉、看 diff。
 * 闲时照设置 › 梦游（默认：这台 Mac 超过 15 分钟没人动、距上次梦游超过 20 小时、上一份报告看完了；能关掉）。测试时用环境变量缩短。
 */
import { app, ipcMain, powerMonitor } from 'electron'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DreamItem, DreamReport } from '../shared/api'
import { ask } from './ai'
import { chatRun, featureLabel, ownPick } from './agent'
import { pickLabel } from '@cn/ai-engines/shared'
import type { AiAskOpts } from '../shared/api'

type AiAskPick = NonNullable<AiAskOpts['pick']>
/** 回答头上那一行写的「Claude Code · Sonnet · Low」：照引擎真会拿到的模型、档 */
const chatRunPick = (p: AiAskPick) => ({ engine: p.engine, ...chatRun(p.engine, p) })
import * as git from '@cn/git'
import { setDreamHtml } from './attachments'
import { diffOf } from './diff'
import type { DiffSource } from '../shared/diff'
import { similarOffThread } from './similar'
import { type DreamReportInternal, autoTake, clearStrayDreams, closeIfDone, DreamInterrupted, dropItem, dropMany, movesOf, redo, runDream, takeAll, takeItem, takeMany, undo } from './dream'
import { type JudgeAsk, rememberChoice } from './dream-links'
import { judgeRunner } from './dream-judge-run'
import { checkRows, rolesOfVault, saveRoles } from './dream-roles'
import { effectiveJudge } from './agent'
import { E2E } from './test-mode'
import { type DreamSettings, idleDue } from '../shared/dream-settings'
import { atomicWrite } from '@cn/atomic'

/** 测试用：没人动几秒、隔几毫秒算到点（不设就按设置 › 梦游） */
const envNum = (k: string) => (process.env[k] === undefined ? undefined : Number(process.env[k]))
const IDLE_SEC = envNum('CN_DREAM_IDLE_SEC')
const GAP_MS = envNum('CN_DREAM_GAP_MS')
const CHECK_MS = Number(process.env.CN_DREAM_CHECK_MS) || 5 * 60_000

const dir = () => join(app.getPath('userData'), 'dream')
const vaultKey = (root: string) => createHash('sha1').update(root).digest('hex').slice(0, 16)
const reportFile = (root: string) => join(dir(), vaultKey(root) + '.json')
/** 判断的进度（dream-ledger.ts）：判过的每一对、每晚问了几次、不再提的 */
const ledgerFile = (root: string) => join(dir(), vaultKey(root) + '.ledger.json')
/** 上次判到一半被睡眠、退出打断：有这个文件时闲下来就接着判，不等「两次之间至少隔」 */
const resumeFile = (root: string) => join(dir(), vaultKey(root) + '.resume')
/** 你在报告里点的「收下 / 不要 / 丢掉」记进评测集（设计页 3：只存这台 Mac，不进库、不进仓库） */
const labelsFile = (root: string) => join(app.getPath('userData'), 'dream-eval', vaultKey(root), 'labels.jsonl')
/** 右栏「相关」读梦游的这几样（related-main.ts）：报告、判过的一对和不再提的、评测集 */
/** 每晚的报告各留一份（生长图回放「那晚梦游做了什么」，task-h7oy8）：dream/history/<库>/<开始的时间>.json，只留条目的种类、标题、文件、状态 */
export const reportArchiveDir = (root: string) => join(dir(), 'history', vaultKey(root))
export const dreamFiles = (root: string) => ({ report: reportFile(root), ledger: ledgerFile(root), labels: labelsFile(root) })

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}

async function load(root: string): Promise<DreamReportInternal | null> {
  try {
    const r = JSON.parse(await readFile(reportFile(root), 'utf8')) as DreamReportInternal
    // 旧版的「收件箱分了类」现在叫「归类和改名」
    for (const i of r.items) if ((i.group as string) === 'inbox') i.group = 'file'
    return r
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

async function save(root: string, r: DreamReport) {
  await mkdir(dir(), { recursive: true })
  await atomicWrite(reportFile(root), JSON.stringify(r, null, 2))
  const arch = reportArchiveDir(root)
  await mkdir(arch, { recursive: true })
  const items = r.items.map((i) => ({ group: i.group, title: i.title, sub: i.sub, files: i.files, state: i.state, ...(i.move ? { move: i.move } : {}) }))
  await atomicWrite(join(arch, `${r.started}.json`), JSON.stringify({ started: r.started, items }))
}

/** 给界面看的报告：不带内部字段 */
function view(r: DreamReportInternal | null): DreamReport | null {
  if (!r) return null
  const { worktree: _w, commitOrder: _c, ...rest } = r
  return rest
}

export function setupDream(o: {
  root(): string | null
  send(channel: string, ...args: unknown[]): void
  /** 收下、撤回在这里面做：和写笔记排同一个队（没给就直接做） */
  exclusive?<T>(f: () => Promise<T>): Promise<T>
  /** 软件自己挪了这几篇：开着的编辑器跟到新路径、重载内容 */
  followMoves?(moves: { from: string; to: string }[]): Promise<void>
  /** 设置 › 梦游（每次梦游、每次看闲不闲时现读，改了马上算数） */
  settings(): DreamSettings
  /** 补双链找候选的向量那一路（搜索索引里的段向量）；没给只用关键词和标题 */
  related?: import('./dream-links').Related
  /** Wiki 化找候选的向量那一路 */
  passages?: import('./dream-wiki').WikiVec
}) {
  // 报告里还没收下的可视化：从梦游分支上读出来预览（只给报告里列着的文件）
  setDreamHtml(async (rel) => {
    const root = o.root()
    const r = root ? await load(root) : null
    if (!root || !r || r.closed || !r.items.some((i) => i.group === 'viz' && i.state === 'pending' && i.files.includes(rel))) return null
    return git.git(root, ['show', `${r.tip ?? r.branch}:${rel}`])
  })
  let running: Promise<DreamReport> | null = null
  /** 正在梦游的那一次：睡眠、退出时叫停（判完的记着，醒来闲时接着） */
  let stopper: AbortController | null = null
  const interrupt = () => stopper?.abort()
  powerMonitor.on('suspend', interrupt)
  app.on('before-quit', interrupt)
  // 测试演一次睡眠（和 suspend 同一条路）
  if (E2E) (globalThis as unknown as { cnDreamInterrupt: () => void }).cnDreamInterrupt = interrupt
  /** 同一时间只做一件事（梦游、收下、丢掉），免得两个 git 命令抢锁 */
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const p = chain.then(f, f)
    chain = p.catch(() => undefined)
    return p
  }
  const needRoot = () => {
    const r = o.root()
    if (!r) throw new Error('还没有打开库')
    return r
  }

  async function notify(root: string) {
    o.send('dream:changed', view(await load(root)), running !== null)
  }

  /** pick：AI 输入框里打 /现在梦游 时输入框底行选的那一家、模型、想多久（task-0fhyo）；夜里自己梦游照设置 › AI「梦游」那一行 */
  function dream(trigger: DreamReport['trigger'], pick?: AiAskPick, only?: Partial<DreamSettings>): Promise<DreamReport> {
    if (running) return running
    const root = needRoot()
    running = serial(async () => {
      const old = await load(root)
      // 上一份还没看完就手动再梦游：旧的分支和临时检出先收掉（没处理的条目新报告里会再出现）
      if (old && !old.closed) {
        for (const it of old.items) if (it.state === 'pending') it.state = 'dropped'
        await closeIfDone(root, old)
        await save(root, old)
      }
      // 上次被 ⌘Q 打断留下的半截分支：清掉（开着的报告的分支留着）
      await clearStrayDreams(root, old && !old.closed ? old.branch : null)
      // only：自动化「定时整理收件箱」只做归类、改完直接收下（task-i921u）
      const settings = { ...o.settings(), ...only }
      const stop = (stopper = new AbortController())
      const judge = judgeRunner(effectiveJudge(settings.judge))
      let r: DreamReportInternal
      try {
        r = await runDream({
          root,
          scratch: join(dir(), 'checkouts'),
          ask: (s, p) => ask(s, p, AbortSignal.any([stop.signal, AbortSignal.timeout(10 * 60_000)]), undefined, 'dream', pick ? { pick } : {}),
          by: pick ? pickLabel(chatRunPick(pick)) : featureLabel('dream'),
          trigger,
          similar: { ...similarOffThread, ...(o.related ? { related: o.related } : {}), ...(o.passages ? { passages: o.passages } : {}) },
          settings,
          judge: judge.ask as JudgeAsk,
          judgeBy: judge.by,
          judgeParallel: judge.parallel,
          judgeLine: judge.line,
          ledgerFile: ledgerFile(root),
          signal: stop.signal,
        })
      } catch (e) {
        if (e instanceof DreamInterrupted || stop.signal.aborted) {
          await mkdir(dir(), { recursive: true })
          await atomicWrite(resumeFile(root), String(Date.now()))
          // 半截的分支下次梦游前清掉（clearStrayDreams）
          throw new DreamInterrupted()
        }
        throw e
      } finally {
        stopper = null
      }
      await rm(resumeFile(root), { force: true })
      await save(root, r)
      // 改完直接收下：和「全部收下」同一条路（和写笔记排同一个队，挪了的开着的那篇跟过去）；只提醒的留着看
      if (settings.autoTake && r.items.some((i) => i.commit && i.state === 'pending')) {
        const before = new Map(r.items.map((i) => [i.id, i.state] as const))
        const run = async () => {
          try {
            await autoTake(root, r)
          } finally {
            await o.followMoves?.(movesOf(before, r.items))
          }
        }
        try {
          await (o.exclusive ? o.exclusive(run) : run())
        } catch (e) {
          r.notes.push(`没能直接收下：${(e as Error).message}。改动还在${r.branch}分支上，在这里逐条收下`)
        }
        await save(root, r)
      }
      return view(r)!
    }).finally(() => {
      running = null
      o.send('files:changed')
      void notify(root).catch((e) => console.error('梦游通知失败', e))
    })
    void load(root).then((r) => o.send('dream:changed', view(r), true))
    return running
  }

  /** moves：这件事会挪库里的文件（收下、撤回）：和写笔记排同一个队，挪了的开着的那篇跟过去。重做要等 AI 几分钟，不排进去 */
  async function act(f: (root: string, r: DreamReportInternal) => Promise<unknown>, moves = false): Promise<DreamReport> {
    const root = needRoot()
    return serial(async () => {
      const r = await load(root)
      if (!r) throw new Error('还没有梦游报告')
      const before = new Map(r.items.map((i) => [i.id, i.state] as const))
      const run = async () => {
        try {
          await f(root, r)
        } finally {
          // 失败了也看一眼：做了一半（先收下了几条再出错）挪了的照样跟过去
          if (moves) await o.followMoves?.(movesOf(before, r.items))
        }
      }
      try {
        await (moves && o.exclusive ? o.exclusive(run) : run())
      } finally {
        await remember(root, before, r)
        await save(root, r)
        o.send('files:changed')
        void notify(root)
      }
      return view(r)!
    })
  }

  /** 这次点了什么：丢掉的那一对以后不再提、复查点了留着的不再查（判断进度里）；拿不准、补双链、复查的选择记进评测集 */
  async function remember(root: string, before: Map<string, DreamItem['state']>, r: DreamReport) {
    for (const it of r.items) {
      const was = before.get(it.id)
      if (it.group === 'entry' && was !== it.state) {
        if (it.state === 'dropped') await rememberChoice(ledgerFile(root), it, 'drop')
        else if (was === 'dropped') await rememberChoice(ledgerFile(root), it, 'undo')
      }
      if (!it.judged || was === it.state) continue
      if (it.state === 'dropped') await rememberChoice(ledgerFile(root), it, 'drop')
      else if (was === 'dropped' && it.state === 'pending') await rememberChoice(ledgerFile(root), it, 'undo')
      if (it.state === 'pending') continue
      await mkdir(join(labelsFile(root), '..'), { recursive: true })
      const choice = it.group === 'recheck' ? (it.state === 'taken' ? 'remove' : 'keep') : it.state === 'taken' ? 'link' : 'no-link'
      await appendFile(labelsFile(root), JSON.stringify({ at: Date.now(), group: it.group, choice, a: it.judged.a.path, b: it.judged.b.path, level: it.judged.level, confidence: it.judged.confidence, why: it.why, by: it.by }) + '\n')
    }
  }

  const str = (x: unknown) => {
    if (typeof x !== 'string') throw new Error('参数不对')
    return x
  }

  ipcMain.handle('dream:report', async () => {
    const root = o.root()
    return root ? view(await load(root)) : null
  })
  ipcMain.handle('dream:running', () => running !== null)
  // 这个库怎么分（设置 › 梦游，task-h7oy8）：看、重新认一遍、确认（写 .canvas-notes/梦游.md，一次提交；和写笔记排同一个队）
  ipcMain.handle('dream:roles', (_e, fresh: unknown) => rolesOfVault(needRoot(), fresh === true))
  ipcMain.handle('dream:rolesSave', async (_e, x: unknown) => {
    const root = needRoot()
    const rows = checkRows(x)
    const save = () => saveRoles(root, rows)
    await (o.exclusive ? o.exclusive(save) : save())
    o.send('files:changed')
    return rolesOfVault(root)
  })
  ipcMain.handle('dream:now', (_e, pick?: unknown) => dream('manual', pick === undefined || pick === null ? undefined : ownPick(pick)))
  ipcMain.handle('dream:take', (_e, id: unknown) => act((root, r) => takeItem(root, r, str(id)), true))
  ipcMain.handle('dream:drop', (_e, id: unknown) => act((root, r) => dropItem(root, r, str(id))))
  ipcMain.handle('dream:takeAll', () => act((root, r) => takeAll(root, r), true))
  const ids = (x: unknown) => {
    if (!Array.isArray(x) || !x.every((i) => typeof i === 'string')) throw new Error('参数不对')
    return x as string[]
  }
  ipcMain.handle('dream:takeMany', async (_e, x: unknown) => {
    let commit: string | null = null
    const report = await act(async (root, r) => (commit = await takeMany(root, r, ids(x))), true)
    return { report, commit }
  })
  ipcMain.handle('dream:dropMany', (_e, x: unknown) => act((root, r) => dropMany(root, r, ids(x))))
  ipcMain.handle('dream:undo', async (_e, u: { ids?: unknown; taken?: unknown }) => {
    let commit: string | null = null
    const taken = typeof u?.taken === 'string' && /^[0-9a-f]{7,40}$/.test(u.taken) ? u.taken : undefined
    const report = await act(async (root, r) => (commit = await undo(root, r, ids(u?.ids), taken)), true)
    return { report, commit }
  })
  let redoing: AbortController | null = null
  ipcMain.handle('dream:redo', async (_e, x: unknown, feedback: unknown) => {
    if (typeof feedback !== 'string') throw new Error('参数不对')
    if (redoing) throw new Error('上一次重做还没完')
    const ac = new AbortController()
    redoing = ac
    try {
      let changed = 0
      const report = await act(async (root, r) => {
        changed = await redo(root, r, ids(x), feedback, (s, p) => ask(s, p, AbortSignal.any([ac.signal, AbortSignal.timeout(10 * 60_000)]), undefined, 'dream'), join(dir(), 'checkouts'))
      })
      return { report, changed }
    } finally {
      redoing = null
    }
  })
  ipcMain.handle('dream:redoStop', () => redoing?.abort())
  // 对比标签：历史的一次提交、梦游的一条、可能重复的两篇（梦游的要报告，所以接在这里）
  ipcMain.handle('diff:files', async (_e, src: unknown) => {
    const root = needRoot()
    return diffOf(root, checkSource(src), await load(root))
  })

  // 闲时（设置 › 梦游）：开着自己梦游、没人动够久、距上次够久、（要等的话）上一份报告看完了
  const timer = setInterval(() => {
    const root = o.root()
    if (!root || running) return
    const s = o.settings()
    const idleSec = powerMonitor.getSystemIdleTime()
    const opts = { s, idleSec, now: Date.now(), ...(IDLE_SEC !== undefined ? { idleNeed: IDLE_SEC } : {}), ...(GAP_MS !== undefined ? { gapMs: GAP_MS } : {}) }
    // 先不读报告看一眼：关着、没闲够就不碰磁盘
    if (!idleDue({ ...opts, last: null })) return
    void Promise.all([load(root), exists(resumeFile(root))])
      .then(([r, resume]) => {
        // 上次判到一半被打断：闲下来就接着，不等「两次之间至少隔」
        if (!idleDue({ ...opts, last: r, ...(resume ? { gapMs: 0 } : {}) })) return
        return dream('idle').then(() => undefined)
      })
      .catch((e) => console.error('闲时梦游失败', e))
  }, CHECK_MS)

  return {
    /** 菜单栏「现在梦游」 */
    dreamNow: () => dream('manual'),
    /** 现在这份报告（生长图标出「左栏开着的这一晚」） */
    report: async () => {
      const root = o.root()
      return root ? view(await load(root)) : null
    },
    /**
     * 自动化「定时整理收件箱」（task-i921u）：梦游只做归类和改名、改完直接收下（报告里能撤回）；
     * 交回挪了几篇（梦游的提交号在报告里）
     */
    async tidyInbox(): Promise<{ moved: number; stay: number; notes: string[] }> {
      const base = o.settings()
      const steps = Object.fromEntries(Object.keys(base.steps).map((k) => [k, k === 'file' || k === 'rename'])) as DreamSettings['steps']
      const r = await dream('manual', undefined, { steps, autoTake: true })
      return { moved: r.items.filter((i) => i.group === 'file' && i.state === 'taken').length, stay: r.stay ?? 0, notes: r.notes }
    },
    /** 这周梦游整理了什么（周记的 AI 摘要读）：最近一份报告是 from 以后的，收下了的那几条 */
    async weekItems(from: number): Promise<string[]> {
      const root = o.root()
      const r = root ? await load(root) : null
      if (!r || r.started < from) return []
      return r.items.filter((i) => i.state === 'taken').map((i) => `${i.title}${i.sub ? ' ' + i.sub : ''}`)
    },
    stop: () => {
      clearInterval(timer)
      powerMonitor.off('suspend', interrupt)
    },
    /** 测试：演一次睡眠（和 powerMonitor 的 suspend 同一条路） */
    interrupt,
  }
}

/** 界面给的对比来源：只认这几种，字段都是字符串 */
function checkSource(src: unknown): DiffSource {
  const s = src as Record<string, unknown> | null
  const str = (k: string) => (typeof s?.[k] === 'string' ? (s[k] as string) : null)
  const kind = str('kind')
  if (kind === 'commit' && str('hash')) return { kind, hash: str('hash')! }
  if (kind === 'version' && str('hash') && str('path')) return { kind, hash: str('hash')!, path: str('path')! }
  if (kind === 'dream' && str('id')) return { kind, id: str('id')! }
  if (kind === 'pair' && str('a') && str('b')) return { kind, a: str('a')!, b: str('b')! }
  if (kind === 'working') return { kind, ...(str('focus') ? { focus: str('focus')! } : {}) }
  throw new Error('对比的东西不对')
}

