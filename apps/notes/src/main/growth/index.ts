/**
 * 生长图（task-h7oy8）的主进程这一头：界面要数据时看库变没变（笔记的数目和修改时间、HEAD、梦游报告），没变给上次算好的；
 * 变了先给旧的（标着在算），交给后台进程（worker.ts）重算，算完推 growth:changed。退出时正在算的直接停掉，下次接着算。
 */
import { app, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as git from '@cn/git'
import type { DreamReport, GrowthState } from '../../shared/api'
import { type ArchivedReport, dayOf, type GrowthData } from '../../shared/growth'
import { reportArchiveDir } from '../dream-main'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import type { GrowthJob } from './compute'

const cacheFile = (root: string) => join(app.getPath('userData'), 'growth', createHash('sha1').update(root).digest('hex').slice(0, 16) + '.json')

/** 存下来的每晚报告（梦游每存一次报告就按开始的时间存一份） */
async function readReports(root: string): Promise<ArchivedReport[]> {
  const dir = reportArchiveDir(root)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const out: ArchivedReport[] = []
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      out.push(JSON.parse(await readFile(join(dir, n), 'utf8')) as ArchivedReport)
    } catch (e) {
      console.error('生长图读不了一份存下的梦游报告', n, e)
    }
  }
  return out
}

let proc: UtilityProcess | null = null
let stopped = false

function runWorker(job: GrowthJob): Promise<GrowthData> {
  if (stopped) return Promise.reject(new Error('软件在退出，没算'))
  return new Promise((resolve, reject) => {
    const p = utilityProcess.fork(join(__dirname, 'growth-worker.js'), [], { serviceName: '生长图', stdio: 'inherit' })
    proc = p
    let over = false
    p.on('message', (m: { ok: true; value: GrowthData } | { ok: false; error: string }) => {
      over = true
      if (m.ok) resolve(m.value)
      else reject(new Error(m.error))
      p.kill()
    })
    p.once('exit', (code) => {
      if (proc === p) proc = null
      if (!over) reject(new Error(stopped ? '软件在退出，没算完' : `生长图的进程退出了（${code}）`))
    })
    p.postMessage(job)
  })
}

/** 退出：正在算的停掉 */
export function stopGrowth(): boolean {
  stopped = true
  const had = !!proc
  proc?.kill()
  return had
}

export function setupGrowth(o: { vault(): Vault | null; report(): Promise<DreamReport | null>; send(channel: string, ...args: unknown[]): void }) {
  let last: { root: string; sig: string; data: GrowthData } | null = null
  let running: Promise<void> | null = null
  let error: string | null = null
  /** 算的时候库又变了：算完再算一次 */
  let again = false

  async function signature(v: Vault): Promise<string> {
    const files = await v.list()
    let max = 0
    for (const f of files) max = Math.max(max, f.mtimeMs)
    const head = await git.git(v.root, ['rev-parse', '-q', '--verify', 'HEAD']).then(
      (s) => s.trim(),
      () => '',
    )
    const r = await o.report()
    const reports = await readdir(reportArchiveDir(v.root)).then(
      (x) => x.length,
      () => 0,
    )
    return [files.length, max, head, r?.started ?? 0, r?.items.map((i) => i.state[0]).join('') ?? '', reports, dayOf(Date.now())].join('|')
  }

  async function rebuild(v: Vault, sig: string) {
    const t0 = Date.now()
    const texts = await v.texts()
    const files = await v.list()
    const report = await o.report()
    const reports = await readReports(v.root)
    // 这份报告还没存过一份（这一版以前的梦游）：照它算
    if (report && !reports.some((r) => r.started === report.started))
      reports.push({ started: report.started, items: report.items.map((i) => ({ group: i.group, title: i.title, sub: i.sub, files: i.files, state: i.state, ...(i.move ? { move: i.move } : {}) })) })
    const job: GrowthJob = {
      root: v.root,
      cacheFile: cacheFile(v.root),
      notes: files.filter((f) => texts.has(f.path)).map((f) => [f.path, texts.get(f.path)!, f.mtimeMs, f.createdMs]),
      reports,
      current: report?.started ?? null,
      today: dayOf(Date.now()),
    }
    const data = await runWorker(job)
    last = { root: v.root, sig, data }
    error = null
    console.log(`生长图：${data.notes.length} 篇、${data.links.length} 条链接、${data.nights.length} 晚；读历史 ${data.ms.history} 毫秒，摆位置 ${data.ms.layout} 毫秒，共 ${Date.now() - t0} 毫秒`)
  }

  function kick(v: Vault, sig: string) {
    if (running) {
      again = true
      return
    }
    running = rebuild(v, sig)
      .catch((e: Error) => {
        error = e.message
        console.error('生长图没算成', e)
      })
      .finally(() => {
        running = null
        o.send('growth:changed', state(v.root))
        if (again) {
          again = false
          void signature(v).then((s) => s !== last?.sig && kick(v, s))
        }
      })
  }

  const state = (root: string): GrowthState => ({ data: last?.root === root ? last.data : null, building: !!running, error })

  ipcMain.handle('growth:data', async (): Promise<GrowthState> => {
    const v = o.vault()
    if (!v) return { data: null, building: false, error: null }
    const sig = await signature(v)
    if (last?.root !== v.root || last.sig !== sig) kick(v, sig)
    return state(v.root)
  })

  if (E2E) (globalThis as unknown as { cnGrowthRunning: () => boolean }).cnGrowthRunning = () => !!running
}
