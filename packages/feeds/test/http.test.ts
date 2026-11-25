/** 联网：本机服务器（端口 0，只听 127.0.0.1），不碰外网 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Http, HttpError } from '../src/node/http'
import { send, startServer } from './server'

const rss = readFileSync(join(__dirname, 'fixtures/rss2.xml'))
let srv: Awaited<ReturnType<typeof startServer>>

beforeAll(async () => {
  srv = await startServer({
    '/etag': (req, res) => {
      if (req.headers['if-none-match'] === '"v1"') {
        res.writeHead(304, { etag: '"v1"' })
        return void res.end()
      }
      res.writeHead(200, { 'content-type': 'application/rss+xml', etag: '"v1"' })
      res.end(rss)
    },
    '/lastmod': (req, res) => {
      const lm = 'Tue, 24 Nov 2026 10:00:00 GMT'
      if (req.headers['if-modified-since'] === lm) {
        res.writeHead(304)
        return void res.end()
      }
      res.writeHead(200, { 'content-type': 'application/rss+xml', 'last-modified': lm })
      res.end(rss)
    },
    '/moved': (_req, res) => {
      res.writeHead(301, { location: '/moved2' })
      res.end()
    },
    '/moved2': (_req, res) => {
      res.writeHead(308, { location: '/etag' })
      res.end()
    },
    '/temp': (_req, res) => {
      res.writeHead(302, { location: '/etag' })
      res.end()
    },
    '/loop': (_req, res) => {
      res.writeHead(302, { location: '/loop' })
      res.end()
    },
    '/slow': (_req, res) => {
      setTimeout(() => {
        res.writeHead(200)
        res.end('late')
      }, 1500)
    },
    '/big': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('x'.repeat(5000))
    },
    '/429': (_req, res) => {
      res.writeHead(429, { 'retry-after': '120' })
      res.end()
    },
    '/ok': send('ok', 'text/plain'),
  })
})
afterAll(() => srv.close())

describe('条件请求', () => {
  it('ETag：第二次带 If-None-Match，回 304，不带正文', async () => {
    const http = new Http({ hostGapMs: 0 })
    const a = await http.get(srv.url('/etag'))
    expect(a.status).toBe(200)
    expect(a.headers.get('etag')).toBe('"v1"')
    expect(a.body.byteLength).toBe(rss.byteLength)
    const b = await http.get(srv.url('/etag'), { etag: a.headers.get('etag') })
    expect(b).toMatchObject({ status: 304, notModified: true })
    expect(b.body.byteLength).toBe(0)
    expect(srv.hits.filter((h) => h.path === '/etag').at(-1)!.headers['if-none-match']).toBe('"v1"')
  })
  it('Last-Modified：第二次带 If-Modified-Since', async () => {
    const http = new Http({ hostGapMs: 0 })
    const a = await http.get(srv.url('/lastmod'))
    const b = await http.get(srv.url('/lastmod'), { lastModified: a.headers.get('last-modified') })
    expect(b.notModified).toBe(true)
  })
})

describe('跳转、超时、大小、出错', () => {
  it('一路永久跳转：记下新地址；中间有临时跳转：不换地址；跳太多次报错', async () => {
    const http = new Http({ hostGapMs: 0 })
    const a = await http.get(srv.url('/moved'))
    expect(a).toMatchObject({ status: 200, url: srv.url('/etag'), movedTo: srv.url('/etag') })
    const b = await http.get(srv.url('/temp'))
    expect(b.url).toBe(srv.url('/etag'))
    expect(b.movedTo).toBeUndefined()
    await expect(http.get(srv.url('/loop'))).rejects.toThrow('跳转太多次')
  })
  it('超时', async () => {
    const http = new Http({ hostGapMs: 0, timeoutMs: 300 })
    await expect(http.get(srv.url('/slow'))).rejects.toThrow(/超时/)
  })
  it('超过大小上限不收', async () => {
    const http = new Http({ hostGapMs: 0, maxBytes: 1000 })
    await expect(http.get(srv.url('/big'))).rejects.toThrow(/太大了/)
  })
  it('HTTP 错误带状态和头（429 的 Retry-After 交给退避）', async () => {
    const http = new Http({ hostGapMs: 0 })
    const e = (await http.get(srv.url('/429')).catch((x) => x)) as HttpError
    expect(e).toBeInstanceOf(HttpError)
    expect(e.status).toBe(429)
    expect(e.headers?.get('retry-after')).toBe('120')
    const nf = (await http.get(srv.url('/nope')).catch((x) => x)) as HttpError
    expect(nf.status).toBe(404)
  })
  it('连不上：给人看的原因', async () => {
    const http = new Http({ hostGapMs: 0, timeoutMs: 2000 })
    // 端口 1 上没有服务
    await expect(http.get('http://127.0.0.1:1/x')).rejects.toThrow(/拒绝连接|连不上/)
  })
})

describe('对站点客气', () => {
  it('同一个站点两次开始之间至少隔 hostGapMs；同时最多 perHost 个', async () => {
    // 在发请求的那一刻记时间（服务器收到的时间受连接快慢影响，不准）
    const at: number[] = []
    let active = 0
    let most = 0
    const http = new Http({
      hostGapMs: 150,
      perHost: 1,
      fetch: async (input, init) => {
        at.push(performance.now())
        most = Math.max(most, ++active)
        try {
          return await fetch(input, init)
        } finally {
          active--
        }
      },
    })
    await Promise.all([1, 2, 3, 4].map(() => http.get(srv.url('/ok'))))
    expect(at).toHaveLength(4)
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(145)
    expect(most).toBe(1)
  })
})
