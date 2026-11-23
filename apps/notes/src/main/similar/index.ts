/**
 * 梦游补双链、⌘K「找重复」这两样重活交给单独的进程（worker.ts）：主进程不卡，退出时直接停掉它们（下次梦游重算）。
 * 每件活起一个进程，算完就退。⌘K 的找重复边算边报进度（已比几篇、新找到的几对），「停下」直接结束那个进程。
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { DuplicatePair } from '../../shared/api'
import type { Similar } from '../dream'
import type { LinkCand } from '../duplicates'
import { E2E } from '../test-mode'
import type { SimilarJob, SimilarProgress } from './protocol'

const running = new Map<UtilityProcess, SimilarJob['t']>()
/** 测试看正在算哪几件（大库退出的测试等「找重复」算起来再退） */
const expose = () => E2E && ((globalThis as unknown as { cnSimilarRunning: string[] }).cnSimilarRunning = [...running.values()])
let stopped = false

/** 叫停一件活时 promise 报的错（界面认它，说「停下了」） */
export const STOPPED = '停下了'

interface Run<T> {
  done: Promise<T>
  /** 不等它算完：结束那个进程（promise 报 STOPPED） */
  stop(): void
}

function offThread<T>(job: SimilarJob, onProgress?: (p: SimilarProgress) => void): Run<T> {
  if (stopped) return { done: Promise.reject(new Error('软件在退出，没算')), stop: () => undefined }
  let proc: UtilityProcess | null = null
  let cancelled = false
  const done = new Promise<T>((resolve, reject) => {
    const p = utilityProcess.fork(join(__dirname, 'similar-worker.js'), [], { serviceName: '找像的笔记', stdio: 'inherit' })
    proc = p
    running.set(p, job.t)
    expose()
    let over = false
    p.on('message', (m: { t: 'progress' } & SimilarProgress | { ok: true; value: T } | { ok: false; error: string }) => {
      if ('t' in m) return onProgress?.(m)
      over = true
      if (m.ok) resolve(m.value)
      else reject(new Error(m.error))
      p.kill()
    })
    p.once('exit', (code) => {
      running.delete(p)
      expose()
      if (!over) reject(new Error(cancelled ? STOPPED : stopped ? '软件在退出，没算完' : `找像的笔记的进程退出了（${code}）`))
    })
    p.postMessage(job)
  })
  return {
    done,
    stop: () => {
      cancelled = true
      proc?.kill()
    },
  }
}

export const similarOffThread: Similar = {
  links: (texts, loose) => offThread<LinkCand[]>({ t: 'links', texts, loose }).done,
  ranked: (texts, loose, k) => offThread<LinkCand[]>({ t: 'ranked', texts, loose, k }).done,
  duplicates: (docs) => offThread<DuplicatePair[]>({ t: 'dups', docs }).done,
}

/** ⌘K「找重复」：边算边报（onProgress），能停 */
export function duplicatesWithProgress(docs: { id: string; text: string }[], onProgress: (p: SimilarProgress) => void): Run<DuplicatePair[]> {
  return offThread<DuplicatePair[]>({ t: 'dups', docs }, onProgress)
}

/** 退出：正在算的全停掉；返回停了几个 */
export function stopSimilar(): number {
  stopped = true
  const n = running.size
  for (const p of running.keys()) p.kill()
  return n
}
