/**
 * 生长图一次算全（后台进程里跑；单元测试直接调）：缓存里上次读到的历史 → 接着读 Git → 拼数据 → 摆位置（老的不挪）→ 存回缓存。
 * 缓存是设置目录 growth/<库的编号>.json：{ hist: 读过的 Git 历史, pos: 路径 → 位置 }。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { atomicWrite } from '@cn/atomic'
import { dirname } from 'node:path'
import { type ArchivedReport, buildGrowth, type GrowthData } from '../../shared/growth'
import { emptyHist, type HistState, readHistory, viewOf } from './history'
import { placeNotes } from './layout'

export interface GrowthJob {
  root: string
  cacheFile: string
  /** [路径, 全文, 修改时间, 创建时间] */
  notes: [string, string, number, number][]
  reports: ArchivedReport[]
  current: number | null
  today: number
}

interface Cache {
  v: 1
  hist: HistState
  pos: Record<string, [number, number]>
}

async function readCache(file: string): Promise<Cache | null> {
  try {
    const c = JSON.parse(await readFile(file, 'utf8')) as Cache
    return c.v === 1 && c.hist?.v === 1 ? c : null
  } catch (e) {
    // 没有、坏了：从头算
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('生长图缓存读不了，从头算', e)
    return null
  }
}

export async function compute(job: GrowthJob): Promise<GrowthData> {
  const t0 = Date.now()
  const cache = await readCache(job.cacheFile)
  const { st, renames } = await readHistory(job.root, cache?.hist ?? null).catch((e: Error) => {
    // 不是 Git 库、git 坏了：全按估的算
    console.error('生长图读不了 Git 历史', e.message)
    return { st: emptyHist(), renames: [] as [string, string][] }
  })
  const t1 = Date.now()
  const prev = new Map(Object.entries(cache?.pos ?? {}))
  // 挪了、改了名的：位置跟过去
  for (const [from, to] of renames) {
    const p = prev.get(from)
    if (p && !prev.has(to)) prev.set(to, p)
  }
  const data = buildGrowth({
    notes: job.notes.map(([path, text, mtimeMs, createdMs]) => ({ path, text, mtimeMs, createdMs })),
    history: st.any ? viewOf(st) : null,
    reports: job.reports,
    current: job.current,
    today: job.today,
  })
  const t2 = Date.now()
  const { pos } = placeNotes(
    data.notes.map((n) => n.path),
    data.notes.map((n) => n.area),
    data.links,
    prev,
  )
  data.notes.forEach((n, i) => ([n.x, n.y] = pos[i]!))
  const t3 = Date.now()
  const out: Cache = { v: 1, hist: st, pos: Object.fromEntries(data.notes.map((n) => [n.path, [n.x, n.y]])) }
  await mkdir(dirname(job.cacheFile), { recursive: true })
  // 原子写：算到一半退出不留半个文件
  await atomicWrite(job.cacheFile, JSON.stringify(out))
  return { ...data, ms: { history: t1 - t0, layout: t3 - t2, total: Date.now() - t0 } }
}
