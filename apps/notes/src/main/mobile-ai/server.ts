/**
 * Mac 上给 iPhone / iPad 的 AI 服务（task-wwqf0）：只在局域网，HTTP，规矩见 protocol.ts。
 *   POST /v1/pair    扫码配对（设置里开着、配对码没过期才认）
 *   GET  /v1/hello   签名的「在吗」：回 Mac 的名字、正在用哪家、开没开库
 *   POST /v1/ask     签名 + 封好的一问：先回一帧 meta（iPad 认这一帧算 Mac 回话了，两秒内），再一帧一帧回字，最后 done / error
 * iPad 断开（关掉对话、按停下）就停下这一问。用到的东西从外面给（deps），这个文件不碰 Electron：
 * 测试和 iOS 的 UI 测试用的「假 Mac」（fake-mac.ts）跑的是同一份。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { checkAsk, type MobileAsk } from './prompt'
import {
  b64u,
  CLOCK_SKEW_MS,
  deviceSecretOf,
  type Frame,
  isLocalAddress,
  type KeyPair,
  NONCE_TTL_MS,
  open,
  pairedProof,
  pairKeyOf,
  pairProof,
  PROTO_VERSION,
  sameBytes,
  seal,
  sessionKeys,
  sharedSecret,
  unb64u,
  verifySignature,
} from './protocol'

export interface Device {
  id: string
  /** 配对那台设备的名字（「一飞冲天」） */
  name: string
  /** iPad / iPhone */
  kind: string
  secret: Buffer
  pairedAt: number
  lastSeen?: number
}

/** 这一问用哪家、界面上怎么写（「Claude Code · Opus 5.5」） */
export interface EngineMeta {
  engine: string
  label: string
}

export interface ServerDeps {
  /** 这台 Mac：编号、名字、长期的钥匙 */
  identity(): { id: string; name: string; keys: KeyPair }
  device(id: string): Device | undefined
  addDevice(d: Device): void
  /** 记一下最后一次来问的时间（设置里写「刚刚用过」） */
  seen(id: string, at: number): void
  /** 现在能用的配对码（设置里开着、二维码在）；没有是 null */
  code(): { code: Buffer; expires: number } | null
  /** 配对码用掉了 */
  codeUsed(): void
  /** 「在吗」的回答 */
  hello(): EngineMeta & { vault: boolean; note: string }
  /** 这一问用哪家（先回给 iPad，再开始答） */
  meta(): EngineMeta
  /** 答一问：边答边 onText；停下时 signal 断开 */
  ask(req: MobileAsk, onText: (delta: string) => void, signal: AbortSignal): Promise<void>
  now?(): number
  /** 回第一帧之前等一下：只有测试用的假 Mac 用（演「Mac 在、但两秒没回话」） */
  beforeMeta?(): Promise<void>
  log?(line: string): void
}

/** 一台设备同时最多答几问，一共最多几问（Claude Code 一问一个进程） */
const PER_DEVICE = 2
const TOTAL = 4
const MAX_BODY = 8 * 1024 * 1024

/** 一帧去掉编号（编号发的时候按顺序补上） */
type WithoutI<T> = T extends unknown ? Omit<T, 'i'> : never
type FrameBody = WithoutI<Frame>

export interface MobileServer {
  port: number
  close(): Promise<void>
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let n = 0
    req.on('data', (c: Buffer) => {
      n += c.length
      if (n > MAX_BODY) {
        reject(new HttpError(413, '太大了'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

export function startMobileServer(deps: ServerDeps, port = 0): Promise<MobileServer> {
  const now = () => deps.now?.() ?? Date.now()
  const log = (s: string) => deps.log?.(s)
  /** 每台设备用过的 nonce → 时间 */
  const nonces = new Map<string, Map<string, number>>()
  const busy = new Map<string, number>()
  let total = 0

  /** 签名对不对；对的话返回这台设备和这一问的 nonce。哪一样不对都只回 401，不说是哪一样 */
  function auth(req: IncomingMessage, method: string, path: string, body: Buffer): { dev: Device; nonce: string } {
    const id = String(req.headers['x-cn-device'] ?? '')
    const time = Number(req.headers['x-cn-time'])
    const nonce = String(req.headers['x-cn-nonce'] ?? '')
    const sign = String(req.headers['x-cn-sign'] ?? '')
    const dev = id ? deps.device(id) : undefined
    const t = now()
    if (!dev || !Number.isFinite(time) || Math.abs(t - time) > CLOCK_SKEW_MS || unb64u(nonce).length !== 12 || !sign) throw new HttpError(401, '没认出这台设备')
    const seen = nonces.get(id) ?? new Map<string, number>()
    for (const [k, at] of seen) if (t - at > NONCE_TTL_MS) seen.delete(k)
    if (seen.has(nonce)) throw new HttpError(401, '没认出这台设备')
    if (!verifySignature(sessionKeys(dev.secret), method, path, { device: id, time, nonce }, body, sign)) throw new HttpError(401, '没认出这台设备')
    seen.set(nonce, t)
    nonces.set(id, seen)
    deps.seen(id, t)
    return { dev, nonce }
  }

  async function pair(req: IncomingMessage, res: ServerResponse) {
    const c = deps.code()
    if (!c || c.expires < now()) throw new HttpError(403, 'Mac 上没在配对：在 Mac 的设置 › AI 里打开「让iPhone / iPad用这台Mac的AI」，再扫一次')
    const raw = await readBody(req)
    let o: { v?: unknown; device?: unknown; name?: unknown; kind?: unknown; pub?: unknown; proof?: unknown }
    try {
      o = JSON.parse(raw.toString('utf8'))
    } catch {
      throw new HttpError(400, '请求不对')
    }
    const ok = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max
    if (o.v !== PROTO_VERSION || !ok(o.device, 64) || !/^[\w-]+$/.test(o.device) || !ok(o.name, 80) || !ok(o.kind, 20) || !ok(o.pub, 64) || !ok(o.proof, 64)) throw new HttpError(400, '请求不对')
    const me = deps.identity()
    let shared: Buffer
    try {
      shared = sharedSecret(me.keys, o.pub)
    } catch {
      throw new HttpError(400, '请求不对')
    }
    if (!sameBytes(pairProof(pairKeyOf(shared, c.code), o.device, o.name), unb64u(o.proof))) throw new HttpError(401, '配对码不对或者过期了：在 Mac 上换一个码再扫')
    const secret = deviceSecretOf(shared, c.code)
    // 先作废这个码再记下设备：设置页收到「配好了一台」时二维码已经换成「配一台新的」
    deps.codeUsed()
    deps.addDevice({ id: o.device, name: o.name, kind: o.kind, secret, pairedAt: now() })
    log(`配对了：${o.kind}「${o.name}」`)
    sendJson(res, 200, { v: PROTO_VERSION, mac: me.id, name: me.name, proof: b64u(pairedProof(secret, o.device)) })
  }

  async function hello(req: IncomingMessage, res: ServerResponse) {
    const { dev, nonce } = auth(req, 'GET', '/v1/hello', Buffer.alloc(0))
    const me = deps.identity()
    const h = deps.hello()
    const frame: Frame = { t: 'hello', i: 0, mac: me.name, engine: h.engine, label: h.label, vault: h.vault, note: h.note }
    const line = seal(sessionKeys(dev.secret).res, JSON.stringify(frame), nonce) + '\n'
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(line) })
    res.end(line)
  }

  async function ask(req: IncomingMessage, res: ServerResponse) {
    const body = await readBody(req)
    const { dev, nonce } = auth(req, 'POST', '/v1/ask', body)
    const keys = sessionKeys(dev.secret)
    let q: MobileAsk
    try {
      q = checkAsk(JSON.parse(open(keys.req, body.toString('utf8'))))
    } catch {
      throw new HttpError(400, '请求不对')
    }
    if ((busy.get(dev.id) ?? 0) >= PER_DEVICE || total >= TOTAL) throw new HttpError(429, 'Mac 上正同时答着好几问，等一下再问')
    busy.set(dev.id, (busy.get(dev.id) ?? 0) + 1)
    total++
    const ac = new AbortController()
    // iPad 关掉对话、按停下：连接断了，这一问停下
    res.on('close', () => {
      if (!res.writableFinished) ac.abort()
    })
    let i = 0
    const send = (f: FrameBody) => {
      if (res.writableEnded || res.destroyed) return
      res.write(seal(keys.res, JSON.stringify({ ...f, i: i++ }), nonce) + '\n')
    }
    try {
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
      req.socket.setNoDelay(true)
      const me = deps.identity()
      const m = deps.meta()
      await deps.beforeMeta?.()
      // 先回一帧：iPad 两秒内收到它就不换云端
      send({ t: 'meta', mac: me.name, engine: m.engine, label: m.label })
      log(`${dev.kind}「${dev.name}」问了一问（${q.kind}）`)
      await deps.ask(q, (d) => send({ t: 'text', d }), ac.signal)
      send({ t: 'done' })
    } catch (e) {
      if (!ac.signal.aborted) send({ t: 'error', message: String((e as Error).message ?? e) })
    } finally {
      busy.set(dev.id, (busy.get(dev.id) ?? 1) - 1)
      total--
      if (!res.writableEnded) res.end()
    }
  }

  const server: Server = createServer((req, res) => {
    // 只认这台 Mac 自己、局域网和 Tailscale 的地址
    if (!isLocalAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, { error: '只在局域网里用' })
      req.destroy()
      return
    }
    const url = (req.url ?? '').split('?')[0]
    const route = req.method === 'POST' && url === '/v1/pair' ? pair : req.method === 'GET' && url === '/v1/hello' ? hello : req.method === 'POST' && url === '/v1/ask' ? ask : null
    if (!route) {
      sendJson(res, 404, { error: '没有这个' })
      return
    }
    route(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500
      if (status === 500) log(`出错：${String((e as Error).message ?? e)}`)
      if (res.headersSent) {
        res.end()
        return
      }
      sendJson(res, status, { error: e instanceof HttpError ? e.message : '出错了' })
    })
  })

  return new Promise((resolve, reject) => {
    const listen = (p: number) => {
      const onError = (e: NodeJS.ErrnoException) => {
        // 上次的端口被占了：换一个
        if (e.code === 'EADDRINUSE' && p !== 0) listen(0)
        else reject(e)
      }
      server.once('error', onError)
      server.listen({ port: p, host: '::', ipv6Only: false }, () => {
        server.off('error', onError)
        resolve({
          port: (server.address() as AddressInfo).port,
          close: () =>
            new Promise<void>((r) => {
              server.close(() => r())
              server.closeAllConnections()
            }),
        })
      })
    }
    listen(port)
  })
}
