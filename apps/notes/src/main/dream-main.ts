/**
 * 梦游接到软件里：报告存在软件设置目录（JSON），闲时自己跑，界面通过 IPC 收下、丢掉、看 diff。
 * 闲时 = 这台 Mac 超过 15 分钟没人动，且距上次梦游超过 20 小时。测试时用环境变量缩短。
 */
import { app, ipcMain, powerMonitor } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DreamReport } from '../shared/api'
import { ask } from './ai'
import { type DreamReportInternal, closeIfDone, dropItem, itemDiff, runDream, takeAll, takeItem } from './dream'

const IDLE_SEC = Number(process.env.CN_DREAM_IDLE_SEC ?? 15 * 60)
const GAP_MS = Number(process.env.CN_DREAM_GAP_MS ?? 20 * 3600_000)
const CHECK_MS = Number(process.env.CN_DREAM_CHECK_MS) || 5 * 60_000

const dir = () => join(app.getPath('userData'), 'dream')
const reportFile = (root: string) => join(dir(), createHash('sha1').update(root).digest('hex').slice(0, 16) + '.json')

async function load(root: string): Promise<DreamReportInternal | null> {
  try {
    return JSON.parse(await readFile(reportFile(root), 'utf8')) as DreamReportInternal
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

export function setupDream(o: { root(): string | null; send(channel: string, ...args: unknown[]): void }) {
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

  function dream(trigger: DreamReport['trigger']): Promise<DreamReport> {
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
      const r = await runDream({ root, scratch: join(dir(), 'checkouts'), ask: (s, p) => ask(s, p, AbortSignal.timeout(10 * 60_000)), trigger })
      await save(root, r)
      return view(r)!
    }).finally(() => {
      running = null
      o.send('files:changed')
      void notify(root).catch((e) => console.error('梦游通知失败', e))
    })
    void load(root).then((r) => o.send('dream:changed', view(r), true))
    return running
  }

  async function act(f: (root: string, r: DreamReportInternal) => Promise<void>): Promise<DreamReport> {
    const root = needRoot()
    return serial(async () => {
      const r = await load(root)
      if (!r) throw new Error('还没有梦游报告')
      try {
        await f(root, r)
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
  ipcMain.handle('dream:now', () => dream('manual'))
  ipcMain.handle('dream:take', (_e, id: unknown) => act((root, r) => takeItem(root, r, str(id))))
  ipcMain.handle('dream:drop', (_e, id: unknown) => act((root, r) => dropItem(root, r, str(id))))
  ipcMain.handle('dream:takeAll', () => act((root, r) => takeAll(root, r)))
  ipcMain.handle('dream:diff', async (_e, id: unknown) => {
    const root = needRoot()
    const r = await load(root)
    if (!r) throw new Error('还没有梦游报告')
    return itemDiff(root, r, str(id))
  })

  // 闲时：没人动超过 15 分钟、距上次梦游超过 20 小时、上一份报告看完了
  const timer = setInterval(() => {
    const root = o.root()
    if (!root || running) return
    if (powerMonitor.getSystemIdleTime() < IDLE_SEC) return
    void load(root)
      .then((r) => {
        if (r && (!r.closed || Date.now() - r.finished < GAP_MS)) return
        return dream('idle').then(() => undefined)
      })
      .catch((e) => console.error('闲时梦游失败', e))
  }, CHECK_MS)

  return {
    /** 菜单栏「现在梦游」 */
    dreamNow: () => dream('manual'),
    stop: () => clearInterval(timer),
  }
}
