/**
 * 下载本地模型的一个大文件：先写进 <文件>.part，断了从已有的字节接着下（Range），下完算 sha256，对了才改名成正式文件。
 * 主地址连不上、回的不对就换备用地址（同一份文件，.part 接着用）；sha256 不对作废 .part，换下一个地址从头下。
 * 不依赖 Electron（单元测试直接跑）。
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { t } from '../../shared/i18n'

export interface Progress {
  phase: 'downloading' | 'verifying'
  got: number
  total: number
  /** 字节每秒（最近 3 秒） */
  speed?: number
}

export interface DownloadOpts {
  urls: string[]
  /** 正式文件的路径（下载中是 dest + '.part'） */
  dest: string
  size: number
  sha256: string
  signal: AbortSignal
  onProgress(p: Progress): void
  /** 这么久一个字节都没来就当断了（默认 30 秒） */
  stallMs?: number
}

export const partOf = (dest: string) => dest + '.part'

/** .part 里已经有多少字节 */
export function partSize(dest: string): number {
  try {
    return statSync(partOf(dest)).size
  } catch {
    return 0
  }
}

const aborted = () => Object.assign(new Error(t('停下了')), { name: 'AbortError' })

export async function sha256Of(path: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<string> {
  const h = createHash('sha256')
  let n = 0
  for await (const chunk of createReadStream(path, { highWaterMark: 8 << 20 })) {
    if (signal.aborted) throw aborted()
    h.update(chunk as Buffer)
    n += (chunk as Buffer).length
    onBytes(n)
  }
  return h.digest('hex')
}

/** 从 url 把 .part 补到 size：回 206 接着写，回 200 从头写 */
async function fetchInto(url: string, o: DownloadOpts, have: number, speedOf: (got: number) => number | undefined): Promise<void> {
  const part = partOf(o.dest)
  const stall = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const kick = () => {
    clearTimeout(timer)
    timer = setTimeout(() => stall.abort(), o.stallMs ?? 30_000)
  }
  kick()
  const signal = AbortSignal.any([o.signal, stall.signal])
  try {
    const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal, redirect: 'follow' })
    let from: number
    if (res.status === 206) {
      const m = /^bytes (\d+)-/.exec(res.headers.get('content-range') ?? '')
      if (!m || Number(m[1]) !== have) throw new Error(t('下载地址接着下的位置不对'))
      from = have
    } else if (res.status === 200) from = 0
    else throw new Error(t('下载地址回了 {code}', { code: res.status }))
    if (!res.body) throw new Error(t('下载地址没回内容'))
    const out = createWriteStream(part, { flags: from ? 'a' : 'w' })
    let got = from
    let last = 0
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        kick()
        got += chunk.length
        if (got > o.size) throw new Error(t('下下来的比该有的大，文件不对'))
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        const now = Date.now()
        if (now - last > 200) {
          last = now
          o.onProgress({ phase: 'downloading', got, total: o.size, speed: speedOf(got) })
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
    }
    o.onProgress({ phase: 'downloading', got, total: o.size, speed: speedOf(got) })
    if (got !== o.size) throw new Error(t('下载断了'))
  } catch (e) {
    if (o.signal.aborted) throw aborted()
    if (stall.signal.aborted) throw new Error(t('下载地址 {s} 秒没动静', { s: Math.round((o.stallMs ?? 30_000) / 1000) }))
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 下好、校验对了才返回；取消时报 AbortError（.part 留着，下次接着下）；所有地址都不行报最后一个原因 */
export async function downloadFile(o: DownloadOpts): Promise<void> {
  if (existsSync(o.dest)) return
  const part = partOf(o.dest)
  const samples: [number, number][] = []
  const speedOf = (got: number) => {
    const now = Date.now()
    samples.push([now, got])
    while (samples.length > 2 && now - samples[0]![0] > 3000) samples.shift()
    const [t0, g0] = samples[0]!
    return now - t0 > 300 ? ((got - g0) * 1000) / (now - t0) : undefined
  }
  let why = ''
  for (const url of o.urls) {
    // 同一个地址断了且有进展就再接着下，最多 3 回；没进展换下一个地址
    for (let tries = 0; tries < 3; tries++) {
      if (o.signal.aborted) throw aborted()
      let have = partSize(o.dest)
      if (have > o.size) {
        rmSync(part)
        have = 0
      }
      const before = have
      try {
        if (have < o.size) await fetchInto(url, o, have, speedOf)
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        why = (e as Error).message
        if (partSize(o.dest) > before) continue
        break
      }
      o.onProgress({ phase: 'verifying', got: 0, total: o.size })
      const sum = await sha256Of(part, o.signal, (n) => o.onProgress({ phase: 'verifying', got: n, total: o.size }))
      if (sum === o.sha256) {
        renameSync(part, o.dest)
        return
      }
      rmSync(part)
      why = t('校验没通过（sha256 不对），下坏的已作废')
      break
    }
  }
  throw new Error(t('下载没成功：{why}', { why }))
}
