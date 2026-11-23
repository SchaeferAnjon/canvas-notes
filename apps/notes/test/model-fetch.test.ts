// 第一次用时下载 bge-m3（search/model-fetch.ts）：续传、sha256 不对作废、主地址不行换备用。
// 本机起一个 http 服务器（端口让系统挑），不联网、不真下 560 MB。
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EmbedModel } from '../src/main/search/embed-model'
import { fetchModel, type FetchProgress, type ModelFile, modelReady } from '../src/main/search/model-fetch'
import type { EmbedModelStatus } from '../src/shared/search'

const BIG = Buffer.alloc(300_000, 0).map((_, i) => (i * 7 + 3) % 251)
const SMALL = Buffer.from('{"hello":"tokenizer"}')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const FILES: ModelFile[] = [
  { file: 'onnx/model_quantized.onnx', size: BIG.length, sha256: sha(BIG) },
  { file: 'tokenizer.json', size: SMALL.length, sha256: sha(SMALL) },
]

/** 每个请求记一行：哪条路径、带的 Range */
let log: { url: string; range: string | null }[] = []
/** /bad/ 下回 500，/wrong/ 下回内容不对的字节，/ok/ 下认 Range，/norange/ 下不认 Range（总回整份），/cut/ 下第一次只给一半就断 */
let cutOnce = true
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    log.push({ url, range: (req.headers.range as string | undefined) ?? null })
    const [, kind, ...rest] = url.split('/')
    const name = rest.join('/')
    const body = name === 'tokenizer.json' ? SMALL : name === 'onnx/model_quantized.onnx' ? BIG : null
    if (!body || kind === 'bad') {
      res.writeHead(kind === 'bad' ? 500 : 404).end()
      return
    }
    const data = kind === 'wrong' ? Buffer.from(body).fill(1) : body
    const m = kind !== 'norange' && /^bytes=(\d+)-$/.exec((req.headers.range as string | undefined) ?? '')
    const from = m ? Number(m[1]) : 0
    const part = data.subarray(from)
    res.writeHead(m ? 206 : 200, { 'content-length': part.length, ...(m ? { 'content-range': `bytes ${from}-${data.length - 1}/${data.length}` } : {}) })
    if (kind === 'cut' && cutOnce && name.endsWith('.onnx')) {
      cutOnce = false
      // 先把这一截送到，再断
      res.write(part.subarray(0, 100_000), () => setTimeout(() => res.destroy(), 30))
      return
    }
    res.end(part)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-fetch-'))
  log = []
  cutOnce = true
  return () => rmSync(dir, { recursive: true, force: true })
})

describe('下载本机模型', () => {
  it('下好、校验过写 verified.json，再叫一次不再下', async () => {
    const seen: FetchProgress[] = []
    await fetchModel({ dir, files: FILES, bases: [`${base}/ok`], onProgress: (p) => seen.push(p) })
    expect(readFileSync(join(dir, 'onnx/model_quantized.onnx')).equals(BIG)).toBe(true)
    expect(modelReady(dir, FILES)).toBe(true)
    expect(seen.at(-1)).toMatchObject({ got: BIG.length + SMALL.length, total: BIG.length + SMALL.length })
    expect(seen.some((p) => p.phase === 'verifying')).toBe(true)
    const n = log.length
    await fetchModel({ dir, files: FILES, bases: [`${base}/ok`], onProgress: () => undefined })
    expect(log.length).toBe(n)
  })

  it('断了接着下：已有的那截不重下，请求带 Range 从断的地方开始', async () => {
    mkdirSync(join(dir, 'onnx'), { recursive: true })
    writeFileSync(join(dir, 'onnx/model_quantized.onnx.part'), BIG.subarray(0, 120_000))
    const seen: FetchProgress[] = []
    await fetchModel({ dir, files: FILES, bases: [`${base}/ok`], onProgress: (p) => seen.push(p) })
    expect(log.find((l) => l.url.endsWith('.onnx'))!.range).toBe('bytes=120000-')
    // 一开头的进度就算上已有的那截
    expect(seen[0]!.got).toBe(120_000)
    expect(readFileSync(join(dir, 'onnx/model_quantized.onnx')).equals(BIG)).toBe(true)
  })

  it('下到一半连接断了：主地址再试不了就换备用地址，从断的地方接着下', async () => {
    await fetchModel({ dir, files: FILES, bases: [`${base}/cut`, `${base}/ok`], onProgress: () => undefined })
    const onnx = log.filter((l) => l.url.endsWith('.onnx'))
    expect(onnx.map((l) => l.url.split('/')[1])).toEqual(['cut', 'ok'])
    expect(onnx[1]!.range).toBe('bytes=100000-')
    expect(readFileSync(join(dir, 'onnx/model_quantized.onnx')).equals(BIG)).toBe(true)
  })

  it('服务器不认 Range、回了整份：从头写，不接在后面', async () => {
    mkdirSync(join(dir, 'onnx'), { recursive: true })
    writeFileSync(join(dir, 'onnx/model_quantized.onnx.part'), BIG.subarray(0, 50_000))
    await fetchModel({ dir, files: FILES, bases: [`${base}/norange`], onProgress: () => undefined })
    expect(readFileSync(join(dir, 'onnx/model_quantized.onnx')).equals(BIG)).toBe(true)
  })

  it('主地址出错（500）换备用地址，后面的文件直接从备用地址下', async () => {
    await fetchModel({ dir, files: FILES, bases: [`${base}/bad`, `${base}/ok`], onProgress: () => undefined })
    expect(modelReady(dir, FILES)).toBe(true)
    expect(log.filter((l) => l.url.startsWith('/bad/')).length).toBe(1)
  })

  it('sha256 对不上：下的作废（不留 .part、不写 verified.json），都不对就报错', async () => {
    await expect(fetchModel({ dir, files: FILES, bases: [`${base}/wrong`], onProgress: () => undefined })).rejects.toThrow(/sha256 对不上/)
    expect(existsSync(join(dir, 'onnx/model_quantized.onnx.part'))).toBe(false)
    expect(existsSync(join(dir, 'onnx/model_quantized.onnx'))).toBe(false)
    expect(modelReady(dir, FILES)).toBe(false)
    // 一个地址给的不对、另一个对：用对的那个
    await fetchModel({ dir, files: FILES, bases: [`${base}/wrong`, `${base}/ok`], onProgress: () => undefined })
    expect(modelReady(dir, FILES)).toBe(true)
  })

  it('盘上的整份被改过：校验不过就重下', async () => {
    await fetchModel({ dir, files: FILES, bases: [`${base}/ok`], onProgress: () => undefined })
    writeFileSync(join(dir, 'onnx/model_quantized.onnx'), Buffer.from(BIG).fill(9))
    rmSync(join(dir, 'verified.json'))
    log = []
    await fetchModel({ dir, files: FILES, bases: [`${base}/ok`], onProgress: () => undefined })
    expect(log.some((l) => l.url.endsWith('.onnx'))).toBe(true)
    expect(readFileSync(join(dir, 'onnx/model_quantized.onnx')).equals(BIG)).toBe(true)
  })

  it('下载目录不对（指到一个文件里面）：不算下好，下载时报原话，不抛到外面去', async () => {
    writeFileSync(join(dir, '是文件'), 'x')
    const bad = join(dir, '是文件', 'bge-m3')
    expect(modelReady(bad, FILES)).toBe(false)
    await expect(fetchModel({ dir: bad, files: FILES, bases: [`${base}/ok`], onProgress: () => undefined })).rejects.toThrow(/ENOTDIR/)
    const em = new EmbedModel({ dir: bad, fake: false, semantic: () => true, onStatus: () => undefined, onReady: () => undefined, delayMs: 0, files: FILES, bases: [`${base}/ok`] })
    em.sync()
    await expect.poll(() => em.status().phase, { timeout: 2000 }).toBe('error')
    expect(em.status().error).toMatch(/ENOTDIR/)
  })

  it('停下（abort）：不报成出错，下了的那截留着', async () => {
    const ac = new AbortController()
    const p = fetchModel({ dir, files: FILES, bases: [`${base}/ok`], signal: ac.signal, onProgress: (q) => q.got > 0 && ac.abort() })
    await expect(p).rejects.toThrow()
    expect(modelReady(dir, FILES)).toBe(false)
  })
})

describe('EmbedModel 的状态（测试模式的假下载）', () => {
  it('按意思找开着：假下载几步走完 → 叫搜索进程换模型 → 搜索进程报建索引、建好', async () => {
    const seen: EmbedModelStatus[] = []
    let ready: unknown = null
    const em = new EmbedModel({ dir, fake: true, semantic: () => true, onStatus: (s) => seen.push(s), onReady: (b) => (ready = b), delayMs: 0, fakeMs: 60 })
    em.fromWorker({ model: 'multilingual-e5-small-int8', big: 'none', done: 0, total: 0 })
    expect(em.big()).toBeNull()
    em.sync()
    await expect.poll(() => ready, { timeout: 2000 }).toEqual({ dir: null, fake: true })
    expect(seen.some((s) => s.phase === 'downloading' && s.got > 0 && s.got < s.size)).toBe(true)
    expect(seen.some((s) => s.phase === 'verifying')).toBe(true)
    expect(em.status()).toMatchObject({ phase: 'indexing', model: 'multilingual-e5-small-int8', fake: true })
    em.fromWorker({ model: 'multilingual-e5-small-int8', big: 'indexing', done: 3, total: 10 })
    expect(em.status()).toMatchObject({ phase: 'indexing', done: 3, total: 10 })
    em.fromWorker({ model: 'bge-m3-fake', big: 'ready', done: 10, total: 10 })
    expect(em.status()).toMatchObject({ phase: 'ready', model: 'bge-m3-fake' })
  })

  it('按意思找关着：不下，状态写 semantic false；开了才下', async () => {
    let on = false
    const em = new EmbedModel({ dir, fake: true, semantic: () => on, onStatus: () => undefined, onReady: () => undefined, delayMs: 0, fakeMs: 30 })
    em.sync()
    expect(em.status()).toMatchObject({ phase: 'e5', semantic: false, model: null })
    await new Promise((r) => setTimeout(r, 80))
    expect(em.status().got).toBe(0)
    on = true
    em.sync()
    await expect.poll(() => em.big(), { timeout: 2000 }).toEqual({ dir: null, fake: true })
  })

  it('真下载：断了报 error 带原话，重试从断的地方接着下；下好以后新建的 EmbedModel 直接认得', async () => {
    const seen: EmbedModelStatus[] = []
    let ready: unknown = null
    const em = new EmbedModel({ dir, fake: false, semantic: () => true, onStatus: (s) => seen.push(s), onReady: (b) => (ready = b), delayMs: 0, files: FILES, bases: [`${base}/cut`] })
    em.sync()
    await expect.poll(() => em.status().phase, { timeout: 2000 }).toBe('error')
    expect(em.status().error).toBeTruthy()
    expect(em.status().got).toBeGreaterThanOrEqual(100_000)
    em.retry()
    await expect.poll(() => ready, { timeout: 2000 }).toEqual({ dir })
    expect(log.filter((l) => l.url.endsWith('.onnx')).at(-1)!.range).toBe('bytes=100000-')
    expect(seen.some((s) => s.phase === 'verifying')).toBe(true)
    const again = new EmbedModel({ dir, fake: false, semantic: () => true, onStatus: () => undefined, onReady: () => undefined, files: FILES })
    expect(again.big()).toEqual({ dir })
  })
})
