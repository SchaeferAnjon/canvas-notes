/**
 * 第一次用时下载本机模型（bge-m3，int8 ONNX 约 570 MB）：钉死版本和 sha256，和 scripts/fetch-model.mjs 同一个做法。
 * 断了接着下（.part + Range），一个地址不行换下一个（主地址 Hugging Face，备用 hf-mirror.com，同一个提交号、同一份文件），
 * sha256 不对就作废重下。下好校验过写一个 verified.json，下次打开对上了就不再算 sha（570 MB 算一遍要一两秒）。
 * 不依赖 Electron：单元测试起一个本机 http 服务器测续传和作废。
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { atomicWriteSync } from '@cn/atomic'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface ModelFile {
  /** 仓库里的路径，也是存到本地的相对路径 */
  file: string
  size: number
  sha256: string
}

export interface FetchProgress {
  phase: 'downloading' | 'verifying'
  /** 已经下了多少字节（所有文件加起来，续传的那一截也算） */
  got: number
  total: number
}

export interface FetchOptions {
  dir: string
  files: ModelFile[]
  /** 地址前缀，按顺序试；文件的 url 是 `${base}/${file}` */
  bases: string[]
  onProgress(p: FetchProgress): void
  signal?: AbortSignal
  /** 多久没收到一个字节算断了（默认 60 秒） */
  stallMs?: number
}

const MARK = 'verified.json'

const sha256 = (p: string) =>
  new Promise<string>((res, rej) => {
    const h = createHash('sha256')
    createReadStream(p)
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej)
  })

const sizeOf = (p: string) => {
  try {
    return statSync(p).size
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return -1
    throw e
  }
}

/** 已经下好、校验过（verified.json 记的 sha 和这份清单一样，文件大小也对） */
export function modelReady(dir: string, files: ModelFile[]): boolean {
  let mark: Record<string, string>
  try {
    mark = JSON.parse(readFileSync(join(dir, MARK), 'utf8')) as Record<string, string>
  } catch (e) {
    // 没下过；目录不对（CN_EMBED_DIR 指到文件里面）也算没下好，下载时报原话
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || e instanceof SyntaxError) return false
    throw e
  }
  return files.every((f) => mark[f.file] === f.sha256 && sizeOf(join(dir, f.file)) === f.size)
}

/** 把清单里的文件都下好并校验；已经好了的直接返回。都试过还不行就抛最后一个错 */
export async function fetchModel(o: FetchOptions): Promise<void> {
  if (modelReady(o.dir, o.files)) return
  const total = o.files.reduce((s, f) => s + f.size, 0)
  // 已经在盘上的（下完的整份、没下完的 .part）先算进进度
  const have = new Map<string, number>()
  for (const f of o.files) {
    const out = join(o.dir, f.file)
    have.set(f.file, sizeOf(out) === f.size ? f.size : Math.max(0, Math.min(f.size, sizeOf(out + '.part'))))
  }
  const got = () => [...have.values()].reduce((s, n) => s + n, 0)
  const report = (phase: FetchProgress['phase']) => o.onProgress({ phase, got: got(), total })
  report('downloading')

  const verified: Record<string, string> = {}
  // 哪个地址行就先用哪个：主地址不通时后面的文件不再每个都先试一遍它
  const bases = [...o.bases]
  for (const f of o.files) {
    const out = join(o.dir, f.file)
    mkdirSync(dirname(out), { recursive: true })
    let lastErr: unknown = null
    let ok = false
    // 整份已经在了：校验一下，对就不下
    if (sizeOf(out) === f.size) {
      report('verifying')
      if ((await sha256(out)) === f.sha256) ok = true
      else {
        rmSync(out)
        have.set(f.file, 0)
      }
    }
    for (const base of [...bases]) {
      if (ok) break
      try {
        await download(`${base}/${f.file}`, out + '.part', f.size, o, (n) => {
          have.set(f.file, n)
          report('downloading')
        })
        report('verifying')
        const sum = await sha256(out + '.part')
        if (sum !== f.sha256) {
          rmSync(out + '.part')
          have.set(f.file, 0)
          throw new Error(`${f.file} 的 sha256 对不上（${sum.slice(0, 12)}…），作废重下`)
        }
        renameSync(out + '.part', out)
        ok = true
        bases.splice(bases.indexOf(base), 1)
        bases.unshift(base)
      } catch (e) {
        if (o.signal?.aborted) throw e
        lastErr = e
      }
    }
    if (!ok) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    verified[f.file] = f.sha256
  }
  atomicWriteSync(join(o.dir, MARK), JSON.stringify(verified, null, 1))
  report('verifying')
}

/** 下一个文件到 part：已有一截就从那接着下（服务器不认 Range、回了整份就从头写） */
async function download(url: string, part: string, size: number, o: FetchOptions, onBytes: (n: number) => void) {
  let from = Math.max(0, sizeOf(part))
  if (from > size) {
    rmSync(part)
    from = 0
  }
  if (from === size) return
  const stall = new AbortController()
  const signal = o.signal ? AbortSignal.any([o.signal, stall.signal]) : stall.signal
  let timer: NodeJS.Timeout | null = null
  const kick = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => stall.abort(new Error(`${url} 超过 ${Math.round((o.stallMs ?? 60_000) / 1000)} 秒没有数据`)), o.stallMs ?? 60_000)
  }
  kick()
  try {
    const res = await fetch(url, { signal, headers: from ? { Range: `bytes=${from}-` } : {} })
    if (!res.ok || !res.body) throw new Error(`${url} 回了 ${res.status}`)
    const append = from > 0 && res.status === 206
    let n = append ? from : 0
    onBytes(n)
    const counted = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).on('data', (d: Buffer) => {
      n += d.length
      kick()
      onBytes(n)
    })
    await pipeline(counted, createWriteStream(part, { flags: append ? 'a' : 'w' }), { signal })
    if (n !== size) throw new Error(`${url} 只下了 ${n} 字节，应该是 ${size}`)
  } catch (e) {
    if (stall.signal.aborted && !o.signal?.aborted) throw stall.signal.reason as Error
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}
