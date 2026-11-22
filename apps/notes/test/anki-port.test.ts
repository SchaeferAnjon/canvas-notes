// 送 Anki 时 8765 被别的程序占着（task-tz7y3，用户截图「Anki 的回答读不懂」：`python3 -m http.server 8765` 对 POST 回 501 的 HTML）：
// 本机假服务（端口让系统挑，不碰真的 8765）回各种不是 AnkiConnect 的东西，都说「端口被别的程序占着」并写出占着它的程序和进程号；
// 连不上照旧是「Anki 没开」；真 AnkiConnect 形状的假服务照旧能送
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AnkiConnectError, call, connected, sendCards } from '../src/main/reading/anki'

type Handler = (body: { action: string; params?: Record<string, unknown> }, res: ServerResponse) => void
let handler: Handler = () => {}
let server: Server
let port = 0
const old = process.env.CN_ANKI_URL

const json = (res: ServerResponse, v: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(v))
}
/** 真 AnkiConnect 的回答形状（v6）：一律 200，{result, error} */
const anki: Handler = (b, res) => {
  const result: Record<string, unknown> = {
    version: 6,
    modelNames: [],
    createModel: {},
    deckNamesAndIds: {},
    createDeck: 1,
    canAddNotesWithErrorDetail: (b.params?.notes as unknown[] | undefined)?.map(() => ({ canAdd: true })) ?? [],
    addNotes: (b.params?.notes as unknown[] | undefined)?.map((_, i) => 1000 + i) ?? [],
  }
  json(res, { result: result[b.action] ?? null, error: null })
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    let s = ''
    req.on('data', (c) => (s += c))
    req.on('end', () => handler(JSON.parse(s || '{}'), res))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
  process.env.CN_ANKI_URL = `http://127.0.0.1:${port}`
})
afterEach(() => {
  process.env.CN_ANKI_URL = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  if (old === undefined) delete process.env.CN_ANKI_URL
  else process.env.CN_ANKI_URL = old
})

const card = {
  id: 'Lecture05.pdf#q1',
  pdf: 'Lecture05.pdf',
  course: '',
  section: { title: '一轮', page: 2, good: '答', points: [], doubts: ['问'] },
  question: '问',
  card: { q: '为什么减掉门槛？', a: '留下超出的那一截', more: '', quote: '原句' },
} as unknown as Parameters<typeof sendCards>[0][number]

async function caught(p: Promise<unknown>): Promise<AnkiConnectError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  )
  expect(e).toBeInstanceOf(AnkiConnectError)
  return e as AnkiConnectError
}

/** 占着端口的就是跑这个测试的进程（假服务在这里面），lsof 查得到它的进程号 */
function expectBusy(e: AnkiConnectError) {
  expect(e.kind).toBe('port')
  expect(e.message).not.toContain('读不懂')
  expect(e.message).toContain(`${port}端口被别的程序占着`)
  expect(e.message).toContain('不是AnkiConnect。关掉它，重启Anki再送。')
  if (process.platform === 'darwin') expect(e.message).toContain(`进程号${process.pid}`)
}

describe('8765 上回的不是 AnkiConnect', () => {
  it('回 HTML 501（python3 -m http.server 对 POST 的回答）：说端口被占，写出占着的程序和进程号', async () => {
    handler = (_b, res) => {
      res.writeHead(501, { 'content-type': 'text/html' })
      res.end('<!DOCTYPE HTML><html><body><h1>Error response</h1><p>Error code: 501</p></body></html>')
    }
    expectBusy(await caught(sendCards([card])))
  })

  it('回 200 但不是 JSON', async () => {
    handler = (_b, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>hello</html>')
    }
    expectBusy(await caught(call('version')))
  })

  it('回 200 的 JSON，但没有 AnkiConnect 的 result / error', async () => {
    handler = (_b, res) => json(res, { ok: true, data: [1, 2] })
    expectBusy(await caught(sendCards([card])))
  })

  it('有 result / error，但 version 答不出数字', async () => {
    handler = (_b, res) => json(res, { result: 'hello', error: null })
    expectBusy(await caught(sendCards([card])))
  })

  it('不是 AnkiConnect 时也不算「连上了」', async () => {
    handler = (_b, res) => json(res, { ok: true })
    expect(await connected()).toBe(false)
  })
})

describe('照旧', () => {
  it('连不上：说 Anki 没开 / 没装 AnkiConnect（kind off）', async () => {
    const s = createServer()
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    const free = (s.address() as AddressInfo).port
    await new Promise((r) => s.close(r))
    process.env.CN_ANKI_URL = `http://127.0.0.1:${free}`
    const e = await caught(sendCards([card]))
    expect(e.kind).toBe('off')
    expect(e.message).toContain('Anki 没开着，或者没装 AnkiConnect 插件')
  })

  it('AnkiConnect 自己回的错误照旧原样说（不当成端口被占）', async () => {
    handler = (_b, res) => json(res, { result: null, error: 'valid api key must be provided' })
    const e = await caught(call('version'))
    expect(e.kind).toBe('api')
    expect(e.message).toBe('Anki 回了一个错误：valid api key must be provided')
  })

  it('真 AnkiConnect 形状的假服务：照旧送进去', async () => {
    const seen: string[] = []
    handler = (b, res) => (seen.push(b.action), anki(b, res))
    const r = await sendCards([card])
    expect(r.added).toEqual([card.id])
    expect(r.notes[card.id]).toBe(1000)
    expect(seen).toEqual(['version', 'modelNames', 'createModel', 'deckNamesAndIds', 'createDeck', 'canAddNotesWithErrorDetail', 'addNotes'])
    expect(await connected()).toBe(true)
  })
})
