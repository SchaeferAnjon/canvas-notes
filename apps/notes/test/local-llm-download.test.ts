// 本地模型的下载（task-h7oy8）：断点续传（.part + Range）、sha256 不对作废、取消留着 .part、主地址不行换备用。
// 临时 http 服务器让系统挑端口（:0），不用 8765。
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { downloadFile, partOf, type Progress } from '../src/main/local-llm/download'

const BODY = Buffer.alloc(3 * 1024 * 1024 + 123)
for (let i = 0; i < BODY.length; i++) BODY[i] = (i * 31 + (i >> 9)) & 255
const SHA = createHash('sha256').update(BODY).digest('hex')

/** 服务器记下每次请求的 Range；mode 决定这次怎么回 */
let ranges: (string | null)[] = []
let mode: 'ok' | 'cut' | 'no-range' | 'bad' | 'slow' | '500' = 'ok'
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    ranges.push(req.headers.range ?? null)
    if (req.url === '/broken') {
      res.statusCode = 500
      res.end()
      return
    }
    if (mode === '500') {
      res.statusCode = 503
      res.end()
      return
    }
    const body = mode === 'bad' ? Buffer.from(BODY).fill(7, 1000, 2000) : BODY
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '')
    const from = m && mode !== 'no-range' ? Number(m[1]) : 0
    res.statusCode = from ? 206 : 200
    if (from) res.setHeader('Content-Range', `bytes ${from}-${body.length - 1}/${body.length}`)
    res.setHeader('Content-Length', body.length - from)
    if (mode === 'cut') {
      // 只给一半就断开（像网断了）；下一次照常给
      mode = 'ok'
      res.write(body.subarray(from, from + Math.floor((body.length - from) / 2)), () => res.destroy())
      return
    }
    if (mode === 'slow') {
      // 慢慢给，测试在中途取消
      let at = from
      const timer = setInterval(() => {
        if (res.destroyed || at >= body.length) return clearInterval(timer)
        res.write(body.subarray(at, at + 64 * 1024))
        at += 64 * 1024
        if (at >= body.length) (clearInterval(timer), res.end())
      }, 10)
      res.on('close', () => clearInterval(timer))
      return
    }
    res.end(body.subarray(from))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

let dir = ''
beforeEach(() => {
  ranges = []
  mode = 'ok'
  dir = mkdtempSync(join(tmpdir(), 'cn-llm-dl-'))
  return () => rmSync(dir, { recursive: true, force: true })
})

const opts = (over: Partial<Parameters<typeof downloadFile>[0]> = {}) => {
  const seen: Progress[] = []
  return {
    seen,
    o: { urls: [`${base}/model.gguf`], dest: join(dir, 'model.gguf'), size: BODY.length, sha256: SHA, signal: new AbortController().signal, onProgress: (p: Progress) => seen.push(p), ...over },
  }
}

describe('本地模型下载', () => {
  it('下完校验对了才改名成正式文件，进度从下载到校验', async () => {
    const { o, seen } = opts()
    await downloadFile(o)
    expect(readFileSync(o.dest).equals(BODY)).toBe(true)
    expect(existsSync(partOf(o.dest))).toBe(false)
    expect(seen.some((p) => p.phase === 'downloading' && p.got === BODY.length)).toBe(true)
    expect(seen.at(-1)).toMatchObject({ phase: 'verifying', got: BODY.length, total: BODY.length })
  })

  it('已有 .part 时从断的地方接着下（Range），不从头来', async () => {
    const { o } = opts()
    writeFileSync(partOf(o.dest), BODY.subarray(0, 1_000_000))
    await downloadFile(o)
    expect(ranges).toEqual(['bytes=1000000-'])
    expect(readFileSync(o.dest).equals(BODY)).toBe(true)
  })

  it('下到一半断了：同一个地址接着下完', async () => {
    mode = 'cut'
    const { o } = opts()
    await downloadFile(o)
    expect(ranges[0]).toBeNull()
    expect(ranges[1]).toMatch(/^bytes=\d+-$/)
    expect(readFileSync(o.dest).equals(BODY)).toBe(true)
  })

  it('服务器不认 Range 回 200：从头写，不把两份接在一起', async () => {
    mode = 'no-range'
    const { o } = opts()
    writeFileSync(partOf(o.dest), BODY.subarray(0, 500_000))
    await downloadFile(o)
    expect(readFileSync(o.dest).equals(BODY)).toBe(true)
  })

  it('sha256 不对：.part 作废，不留正式文件，报一句人话', async () => {
    mode = 'bad'
    const { o } = opts()
    await expect(downloadFile(o)).rejects.toThrow(/sha256/)
    expect(existsSync(o.dest)).toBe(false)
    expect(existsSync(partOf(o.dest))).toBe(false)
  })

  it('主地址不行换备用地址', async () => {
    const { o } = opts({ urls: [`${base}/broken`, `${base}/model.gguf`] })
    await downloadFile(o)
    expect(readFileSync(o.dest).equals(BODY)).toBe(true)
  })

  it('所有地址都不行：报最后一个原因，不留正式文件', async () => {
    mode = '500'
    const { o } = opts({ urls: [`${base}/a`, `${base}/b`] })
    await expect(downloadFile(o)).rejects.toThrow(/503/)
    expect(existsSync(o.dest)).toBe(false)
  })

  it('取消：报 AbortError，.part 留着；再下从那里接着', async () => {
    mode = 'slow'
    const ac = new AbortController()
    const { o } = opts({ signal: ac.signal, onProgress: (p) => p.got > 500_000 && ac.abort() })
    const err = await downloadFile(o).catch((e: Error) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(existsSync(o.dest)).toBe(false)
    const kept = statSync(partOf(o.dest)).size
    expect(kept).toBeGreaterThan(500_000)
    expect(kept).toBeLessThan(BODY.length)
    mode = 'ok'
    ranges = []
    await downloadFile({ ...o, signal: new AbortController().signal, onProgress: () => undefined })
    expect(ranges).toEqual([`bytes=${kept}-`])
    expect(readFileSync(o.dest).equals(BODY)).toBe(true)
  })

  it('正式文件已经在：不联网', async () => {
    const { o } = opts()
    writeFileSync(o.dest, 'x')
    await downloadFile(o)
    expect(ranges).toEqual([])
  })
})
