/**
 * Mac 上给 iPhone / iPad 的 AI 服务（task-wwqf0）：只在局域网，HTTP，规矩见 protocol.ts。
 *   POST /v1/pair    扫码配对（设置里开着、配对码没过期才认）
 *   GET  /v1/hello   签名的「在吗」：回 Mac 的名字、正在用哪家、开没开库
 *   POST /v1/ask     签名 + 封好的一问：先回一帧 meta（iPad 认这一帧算 Mac 回话了，两秒内），再一帧一帧回字，最后 done / error
 *                    全能模式（手机全能模式）中间还有 step（步骤行；status ask 是在等手机点头）、changed（改了哪些文件、提交成哪一次）
 *   POST /v1/confirm 签名 + 封好的 { ask: 那一问的 nonce, id: 那一步, ok }：手机点了「可以，…」或「不要」；两分钟没来当「不要」
 *   POST /v1/undo    签名 + 封好的 { commit }：撤回这台设备这一问改的那一次提交
 *   POST /v1/want-full 签名 + 封好的 { why: device | engine }：手机请 Mac 打开全能模式（Mac 上弹一句，点「允许」才开）
 * iPad 断开（关掉对话、按停下）就停下这一问。用到的东西从外面给（deps），这个文件不碰 Electron：
 * 测试和 iOS 的 UI 测试用的「假 Mac」（fake-mac.ts）跑的是同一份。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { checkAsk, type MobileAsk } from './prompt'
import type { FullNo } from './danger'
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
  /** 手机全能模式：这台设备能不能用（Mac 设置里每台单独关；没写过是能用） */
  noFull?: boolean
}

/** 这一问用哪家、界面上怎么写（「Claude Code · Opus 5.5」） */
export interface EngineMeta {
  engine: string
  label: string
}

/** 这一问按哪种答（手机全能模式）：full 全能模式，read 只读；手机要了全能模式却答成只读时 why 写为什么 */
export interface AskMeta extends EngineMeta {
  mode: 'full' | 'read'
  why?: string
  no?: FullNo
}

/** 全能模式的一步（帧里去掉 t、i） */
export interface StepOut {
  id: string
  label: string
  code?: string
  status: 'run' | 'ok' | 'err' | 'ask'
  detail?: string
  yes?: string
}

/** 答一问时能往手机那边送的东西 */
export interface AskIO {
  device: Device
  mode: 'full' | 'read'
  step(s: StepOut): void
  changed(c: { commit: string | null; files: { path: string; kind: string }[]; failed?: string }): void
  /**
   * 等手机点头：先送一帧 status ask 的 step（yes 是「可以，删除」那颗的字），等手机 POST /v1/confirm；
   * 两分钟没回（CONFIRM_MS）、这一问停下了都当「不要」，返回 false。还在等的那几步 Mac 右栏也显示（deps.waiting）
   */
  confirm(s: { id: string; label: string; code?: string; yes: string }): Promise<boolean>
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
  /** 「在吗」的回答；omni 是 Mac 右栏开没开全能模式，full 是这台设备能不能用全能模式，no 是这台从这个地址要全能模式会被挡在哪一道 */
  hello(dev: Device, addr: string | undefined): EngineMeta & { vault: boolean; note: string; omni?: boolean; full?: boolean; no?: FullNo | null }
  /** 这一问用哪家、按哪种答（先回给 iPad，再开始答） */
  meta(req: MobileAsk, dev: Device, addr: string | undefined): AskMeta
  /** 答一问：边答边 onText；停下时 signal 断开 */
  ask(req: MobileAsk, onText: (delta: string) => void, signal: AbortSignal, io: AskIO): Promise<void>
  /** 撤回这台设备这一问改的那一次提交：返回撤回以后的那次提交；不是这台设备的、撤不了的抛错（原因给手机看） */
  undo?(dev: Device, commit: string): Promise<string | null>
  /** 正在等手机点头的那几步变了（Mac 右栏显示「在等 iPhone「…」点头：…」） */
  waiting?(list: { device: string; kind: string; label: string }[]): void
  /**
   * 手机请 Mac 打开全能模式（POST /v1/want-full）：why 是挡在哪一道（device 这台在设置里关了、engine AI 对话选的不是本机命令行），
   * Mac 上弹一句「iPad「…」想打开全能模式 · 允许」；already：本来就不挡了（手机再问一声「在吗」）
   */
  wantFull?(dev: Device, why: 'device' | 'engine'): 'asked' | 'already'
  /** 等手机点头最多等多久（毫秒，默认两分钟；测试用短的） */
  confirmMs?: number
  now?(): number
  /** 回第一帧之前等一下：只有测试用的假 Mac 用（演「Mac 在、但两秒没回话」） */
  beforeMeta?(): Promise<void>
  log?(line: string): void
}

/** 等手机点头最多等多久：两分钟没回当「不要」 */
export const CONFIRM_MS = 2 * 60_000

/** 一台设备同时最多答几问（手机 AI 对话同时跑最多 3 段，同 Mac 设置的默认），一共最多几问（Claude Code 一问一个进程） */
const PER_DEVICE = 3
const TOTAL = 6
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
  /** 在等手机点头的那几步：设备|那一问的 nonce|步骤 → 回话 */
  const pending = new Map<string, { resolve(ok: boolean): void; device: Device; label: string }>()
  const tellWaiting = () => deps.waiting?.([...pending.values()].map((p) => ({ device: p.device.name, kind: p.device.kind, label: p.label })))

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
    const h = deps.hello(dev, req.socket.remoteAddress)
    const frame: Frame = { t: 'hello', i: 0, mac: me.name, engine: h.engine, label: h.label, vault: h.vault, note: h.note, ...(h.omni !== undefined ? { omni: h.omni } : {}), ...(h.full !== undefined ? { full: h.full } : {}), ...(h.no ? { no: h.no } : {}) }
    log(`${dev.kind}「${dev.name}」问了在吗（${h.no ? `全能模式挡在 ${h.no}` : '能用全能模式'}，地址 ${req.socket.remoteAddress ?? '?'}）`)
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
      const m = deps.meta(q, dev, req.socket.remoteAddress)
      await deps.beforeMeta?.()
      // 先回一帧：iPad 两秒内收到它就不换云端
      send({ t: 'meta', mac: me.name, engine: m.engine, label: m.label, mode: m.mode, ...(m.why ? { why: m.why } : {}), ...(m.no ? { no: m.no } : {}) })
      log(`${dev.kind}「${dev.name}」问了一问（${q.kind}，${m.mode === 'full' ? '全能模式' : m.no ? `只读：全能模式挡在 ${m.no}` : q.mode === 'full' ? '只读' : '只读（没要全能模式）'}）`)
      const io: AskIO = {
        device: dev,
        mode: m.mode,
        step: (st) => send({ t: 'step', ...st }),
        changed: (c) => send({ t: 'changed', ...c }),
        confirm: (st) =>
          new Promise<boolean>((resolve) => {
            if (ac.signal.aborted) return resolve(false)
            const key = `${dev.id}|${nonce}|${st.id}`
            let timer: NodeJS.Timeout
            const done = (ok: boolean) => {
              if (!pending.has(key)) return
              pending.delete(key)
              clearTimeout(timer)
              ac.signal.removeEventListener('abort', onAbort)
              tellWaiting()
              resolve(ok)
            }
            const onAbort = () => done(false)
            timer = setTimeout(() => done(false), deps.confirmMs ?? CONFIRM_MS)
            ac.signal.addEventListener('abort', onAbort)
            pending.set(key, { resolve: done, device: dev, label: st.label })
            tellWaiting()
            send({ t: 'step', id: st.id, label: st.label, ...(st.code ? { code: st.code } : {}), status: 'ask', yes: st.yes })
          }),
      }
      await deps.ask(q, (d) => send({ t: 'text', d }), ac.signal, io)
      send({ t: 'done' })
    } catch (e) {
      if (!ac.signal.aborted) send({ t: 'error', message: String((e as Error).message ?? e) })
    } finally {
      busy.set(dev.id, (busy.get(dev.id) ?? 1) - 1)
      total--
      if (!res.writableEnded) res.end()
    }
  }

  /** 封好的小请求（点头、撤回）：签名对、打得开才收 */
  async function small(req: IncomingMessage, path: string): Promise<{ dev: Device; nonce: string; body: Record<string, unknown> }> {
    const raw = await readBody(req)
    const { dev, nonce } = auth(req, 'POST', path, raw)
    try {
      const body = JSON.parse(open(sessionKeys(dev.secret).req, raw.toString('utf8'))) as Record<string, unknown>
      if (!body || typeof body !== 'object') throw new Error()
      return { dev, nonce, body }
    } catch {
      throw new HttpError(400, '请求不对')
    }
  }

  function reply(res: ServerResponse, dev: Device, nonce: string, f: FrameBody) {
    const line = seal(sessionKeys(dev.secret).res, JSON.stringify({ ...f, i: 0 }), nonce) + '\n'
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(line) })
    res.end(line)
  }

  async function confirm(req: IncomingMessage, res: ServerResponse) {
    const { dev, nonce, body } = await small(req, '/v1/confirm')
    const ask = body.ask
    const id = body.id
    if (typeof ask !== 'string' || typeof id !== 'string' || typeof body.ok !== 'boolean' || ask.length > 64 || id.length > 200) throw new HttpError(400, '请求不对')
    const p = pending.get(`${dev.id}|${ask}|${id}`)
    if (!p) throw new HttpError(409, '这一步已经不等了（两分钟没回当作不要，或者这一问停下了）')
    log(`${dev.kind}「${dev.name}」${body.ok ? '点了头' : '说了不要'}：${p.label}`)
    p.resolve(body.ok)
    reply(res, dev, nonce, { t: 'ok' })
  }

  async function undo(req: IncomingMessage, res: ServerResponse) {
    const { dev, nonce, body } = await small(req, '/v1/undo')
    if (typeof body.commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(body.commit)) throw new HttpError(400, '请求不对')
    if (!deps.undo) throw new HttpError(404, '没有这个')
    let head: string | null
    try {
      head = await deps.undo(dev, body.commit)
    } catch (e) {
      throw new HttpError(409, String((e as Error).message ?? e))
    }
    log(`${dev.kind}「${dev.name}」撤回了 ${body.commit.slice(0, 7)}`)
    reply(res, dev, nonce, { t: 'ok', commit: head })
  }

  async function wantFull(req: IncomingMessage, res: ServerResponse) {
    const { dev, nonce, body } = await small(req, '/v1/want-full')
    if (body.why !== 'device' && body.why !== 'engine') throw new HttpError(400, '请求不对')
    if (!deps.wantFull) throw new HttpError(404, '没有这个')
    const r = deps.wantFull(dev, body.why)
    log(`${dev.kind}「${dev.name}」请 Mac 打开全能模式（${body.why}）：${r === 'already' ? '本来就能用' : '在 Mac 上问了'}`)
    reply(res, dev, nonce, { t: 'ok', ...(r === 'already' ? { already: true } : {}) })
  }

  const server: Server = createServer((req, res) => {
    // 只认这台 Mac 自己、局域网和 Tailscale 的地址
    if (!isLocalAddress(req.socket.remoteAddress)) {
      log(`不在局域网里的地址来连，没理：${req.socket.remoteAddress ?? '?'}`)
      sendJson(res, 403, { error: '只在局域网里用' })
      req.destroy()
      return
    }
    const url = (req.url ?? '').split('?')[0]
    const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = { 'POST /v1/pair': pair, 'GET /v1/hello': hello, 'POST /v1/ask': ask, 'POST /v1/confirm': confirm, 'POST /v1/undo': undo, 'POST /v1/want-full': wantFull }
    const route = routes[`${req.method} ${url}`] ?? null
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
