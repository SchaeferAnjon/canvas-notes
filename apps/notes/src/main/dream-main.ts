/**
 * 梦游接到软件里：报告存在软件设置目录（JSON），闲时自己跑，界面通过 IPC 收下、丢掉、看 diff。
 * 闲时照设置 › 梦游（默认：这台 Mac 超过 15 分钟没人动、距上次梦游超过 20 小时、上一份报告看完了；能关掉）。测试时用环境变量缩短。
 */
import { app, ipcMain, powerMonitor } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DreamReport } from '../shared/api'
import { ask } from './ai'
import { chatRun, featureLabel, ownPick } from './agent'
import { pickLabel } from '../shared/ai-features'
import type { AiAskOpts } from '../shared/api'

type AiAskPick = NonNullable<AiAskOpts['pick']>
/** 回答头上那一行写的「Claude Code · Sonnet · Low」：照引擎真会拿到的模型、档 */
const chatRunPick = (p: AiAskPick) => ({ engine: p.engine, ...chatRun(p.engine, p) })
import * as git from '@cn/git'
import { setDreamHtml } from './attachments'
import { diffOf } from './diff'
import type { DiffSource } from '../shared/diff'
import { similarOffThread } from './similar'
import { type DreamReportInternal, autoTake, clearStrayDreams, closeIfDone, dropItem, dropMany, movesOf, redo, runDream, takeAll, takeItem, takeMany, undo } from './dream'
import { type DreamSettings, idleDue } from '../shared/dream-settings'

/** 测试用：没人动几秒、隔几毫秒算到点（不设就按设置 › 梦游） */
const envNum = (k: string) => (process.env[k] === undefined ? undefined : Number(process.env[k]))
const IDLE_SEC = envNum('CN_DREAM_IDLE_SEC')
const GAP_MS = envNum('CN_DREAM_GAP_MS')
const CHECK_MS = Number(process.env.CN_DREAM_CHECK_MS) || 5 * 60_000

const dir = () => join(app.getPath('userData'), 'dream')
const reportFile = (root: string) => join(dir(), createHash('sha1').update(root).digest('hex').slice(0, 16) + '.json')

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
  await writeFile(reportFile(root), JSON.stringify(r, null, 2))
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
}) {
  // 报告里还没收下的可视化：从梦游分支上读出来预览（只给报告里列着的文件）
  setDreamHtml(async (rel) => {
    const root = o.root()
    const r = root ? await load(root) : null
    if (!root || !r || r.closed || !r.items.some((i) => i.group === 'viz' && i.state === 'pending' && i.files.includes(rel))) return null
    return git.git(root, ['show', `${r.tip ?? r.branch}:${rel}`])
  })
  let running: Promise<DreamReport> | null = null
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
      const r = await runDream({ root, scratch: join(dir(), 'checkouts'), ask: (s, p) => ask(s, p, AbortSignal.timeout(10 * 60_000), undefined, 'dream', pick ? { pick } : {}), by: pick ? pickLabel(chatRunPick(pick)) : featureLabel('dream'), trigger, similar: similarOffThread, settings })
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
        await save(root, r)
        o.send('files:changed')
        void notify(root)
      }
      return view(r)!
    })
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
    void load(root)
      .then((r) => {
        if (!idleDue({ ...opts, last: r })) return
        return dream('idle').then(() => undefined)
      })
      .catch((e) => console.error('闲时梦游失败', e))
  }, CHECK_MS)

  return {
    /** 菜单栏「现在梦游」 */
    dreamNow: () => dream('manual'),
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
    stop: () => clearInterval(timer),
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

