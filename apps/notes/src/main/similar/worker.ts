/**
 * 找像的笔记（梦游补双链、找重复）的单独进程（Electron utilityProcess）：几千篇的库放在主进程里算时主进程整段卡住，
 * ⌘Q 要等它算完才存字、退出（7000 篇的库卡过 13–18 分钟）。一次只算一件，算完回一条消息；优先级调低，不和界面抢 CPU。
 *
 * 找重复：先在这里把每篇切好、算好签名（7000 篇约 3 秒），再拆成几份交给几个线程一起比（同一个文件，线程里走 runPart），
 * 每 0.3 秒报一次「已比几篇、新找到哪几对」（progress），先找到的先给，⌘K 那边边算边列。
 * 停下：主进程直接结束这个进程，线程跟着没了。
 */
import { availableParallelism, setPriority } from 'node:os'
import { isMainThread, parentPort as threadPort, Worker, workerData } from 'node:worker_threads'
import { prepareSimilar, scanSimilar, type SimilarPair, type SimilarPrep, sortSimilar } from '@cn/format'
import type { DuplicatePair } from '../../shared/api'
import { dupEnds, linkCandidates, linkRanked } from '../duplicates'
import { findHits } from '../wiki-find'
import type { SimilarJob, SimilarProgress } from './protocol'

/** 交给线程的：编号、签名放在共享内存里（不按线程各拷一份） */
interface PartData {
  part: number
  parts: number
  ids: string[]
  off: Int32Array
  grams: Int32Array
  sigs: Uint32Array
  /** 每篇给人看的那段字（UTF-16），第 i 篇在 [plainOff[i], plainOff[i + 1]) */
  plainBuf: Uint16Array
  plainOff: Int32Array
  threshold: number
  containment: number
  minShingles: number
}

/** 线程发回来的：又比完了几篇、新找到的几对 */
type PartMsg = { done: number; pairs: SimilarPair[] }

const share = <T extends Int32Array | Uint32Array | Uint16Array>(a: T, make: (b: SharedArrayBuffer) => T): T => {
  const out = make(new SharedArrayBuffer(a.byteLength))
  out.set(a as never)
  return out
}

/** 线程里：比自己那一份，0.2 秒报一次 */
function runPart() {
  const d = workerData as PartData
  const decoder = new TextDecoder('utf-16le')
  const cache = new Map<number, string>()
  // 给人看的那段只有像的那几对才用到：用到哪篇再从共享内存里解出来
  const plain = new Proxy([] as string[], {
    get(_t, key) {
      const i = Number(key)
      let s = cache.get(i)
      if (s === undefined) cache.set(i, (s = decoder.decode(d.plainBuf.slice(d.plainOff[i]!, d.plainOff[i + 1]!))))
      return s
    },
  })
  const prep: SimilarPrep = { ids: d.ids, off: d.off, grams: d.grams, sigs: d.sigs, plain, threshold: d.threshold, containment: d.containment, minShingles: d.minShingles }
  let msg: PartMsg = { done: 0, pairs: [] }
  let at = Date.now()
  const flush = () => {
    threadPort!.postMessage(msg)
    msg = { done: 0, pairs: [] }
    at = Date.now()
  }
  scanSimilar(
    prep,
    d.part,
    d.parts,
    (p) => msg.pairs.push(p),
    () => {
      msg.done++
      if (Date.now() - at > 200) flush()
    },
  )
  flush()
}

/** 找重复：拆给几个线程一起比；report 每 0.3 秒报一次进度和新找到的几对 */
async function duplicates(docs: { id: string; text: string }[], report: (p: SimilarProgress) => void): Promise<DuplicatePair[]> {
  const { own, toPair } = dupEnds(docs)
  report({ done: 0, total: 0, pairs: [] })
  const prep = prepareSimilar(own)
  const total = prep.ids.length
  const found: SimilarPair[] = []
  let fresh: DuplicatePair[] = []
  let done = 0
  const take = (m: PartMsg) => {
    done += m.done
    for (const p of m.pairs) {
      found.push(p)
      const d = toPair(p)
      if (d) fresh.push(d)
    }
  }
  const flush = () => {
    report({ done, total, pairs: fresh })
    fresh = []
  }
  flush()
  const timer = setInterval(flush, 300)
  try {
    const parts = Math.max(1, Math.min(8, availableParallelism() - 2))
    if (parts === 1 || total < 200) {
      // 篇数少（或者只有一两个核）：就在这里比
      scanSimilar(prep, 0, 1, (p) => found.push(p), () => done++)
    } else {
      const enc = prep.plain.map((s) => {
        const e = new Uint16Array(s.length)
        for (let k = 0; k < s.length; k++) e[k] = s.charCodeAt(k)
        return e
      })
      const plainOff = new Int32Array(total + 1)
      enc.forEach((e, i) => (plainOff[i + 1] = plainOff[i]! + e.length))
      const plainBuf = new Uint16Array(new SharedArrayBuffer(plainOff[total]! * 2))
      enc.forEach((e, i) => plainBuf.set(e, plainOff[i]!))
      const data: Omit<PartData, 'part'> = {
        parts,
        ids: prep.ids,
        off: share(prep.off, (b) => new Int32Array(b)),
        grams: share(prep.grams, (b) => new Int32Array(b)),
        sigs: share(prep.sigs, (b) => new Uint32Array(b)),
        plainBuf,
        plainOff,
        threshold: prep.threshold,
        containment: prep.containment,
        minShingles: prep.minShingles,
      }
      await Promise.all(
        Array.from(
          { length: parts },
          (_, part) =>
            new Promise<void>((resolve, reject) => {
              const w = new Worker(__filename, { workerData: { ...data, part } })
              w.on('message', take)
              w.once('error', reject)
              w.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`比较的线程退出了（${code}）`))))
            }),
        ),
      )
    }
  } finally {
    clearInterval(timer)
  }
  // 线程里像的那几对已经一条条报过了；最后按像的程度排好整份给出去
  fresh = []
  report({ done: total, total, pairs: [] })
  return sortSimilar(found)
    .map(toPair)
    .filter((p): p is DuplicatePair => p !== null)
}

if (!isMainThread) runPart()
else {
  try {
    setPriority(10)
  } catch {
    // 调不了优先级（权限）就照常跑
  }
  process.parentPort.on('message', (e) => {
    const job = e.data as SimilarJob
    void (async () => {
      try {
        const value =
          job.t === 'links' ? linkCandidates(job.texts, job.loose) : job.t === 'ranked' ? linkRanked(job.texts, job.loose, job.k) : job.t === 'wiki' ? findHits(job.texts, job.asks) : await duplicates(job.docs, (p) => process.parentPort.postMessage({ t: 'progress', ...p }))
        process.parentPort.postMessage({ ok: true, value })
      } catch (err) {
        process.parentPort.postMessage({ ok: false, error: String((err as Error).stack ?? err) })
      }
    })()
  })
}
