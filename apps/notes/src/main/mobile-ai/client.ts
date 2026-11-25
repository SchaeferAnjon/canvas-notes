/**
 * 照 iPad 的做法问 Mac 的一个小客户端（task-wwqf0）：单元测试、端到端测试、真 AI 那一遍用（软件本身不用它）。
 * iPad 那份在 apps/apple/CanvasNotes/AI/MacLink.swift，规矩同 protocol.ts。
 */
import { randomBytes } from 'node:crypto'
import type { MobileAsk } from './prompt'
import { b64u, deviceSecretOf, type Frame, newKeyPair, open, type PairLink, pairedProof, pairKeyOf, pairProof, PROTO_VERSION, sameBytes, seal, sessionKeys, sharedSecret, signRequest, unb64u } from './protocol'

export interface Paired {
  base: string
  device: string
  secret: Buffer
  mac: string
  name: string
}

/** 扫到二维码以后配对：成功返回存下来的那些（Mac 的证明对不上也算失败） */
export async function pairWith(link: PairLink, base: string, name = '测试 iPad', kind = 'iPad'): Promise<Paired> {
  const mine = newKeyPair()
  const device = b64u(randomBytes(12))
  const shared = sharedSecret(mine, link.key)
  const code = unb64u(link.code)
  const proof = b64u(pairProof(pairKeyOf(shared, code), device, name))
  const res = await fetch(`${base}/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: PROTO_VERSION, device, name, kind, pub: mine.pub, proof }), signal: AbortSignal.timeout(10_000) })
  const body = (await res.json()) as { error?: string; mac?: string; name?: string; proof?: string }
  if (!res.ok) throw new Error(`配对没成：${res.status} ${body.error ?? ''}`)
  const secret = deviceSecretOf(shared, code)
  if (!sameBytes(pairedProof(secret, device), unb64u(body.proof ?? ''))) throw new Error('Mac 的证明对不上')
  return { base, device, secret, mac: body.mac ?? '', name: body.name ?? '' }
}

function signedHeaders(p: Paired, method: string, path: string, body: string, opts: { time?: number; nonce?: string } = {}) {
  const keys = sessionKeys(p.secret)
  const head = { device: p.device, time: opts.time ?? Date.now(), nonce: opts.nonce ?? b64u(randomBytes(12)) }
  return { head, headers: { 'x-cn-device': head.device, 'x-cn-time': String(head.time), 'x-cn-nonce': head.nonce, 'x-cn-sign': signRequest(keys, method, path, head, body) } }
}

export async function hello(p: Paired): Promise<Frame> {
  const { head, headers } = signedHeaders(p, 'GET', '/v1/hello', '')
  const res = await fetch(`${p.base}/v1/hello`, { headers, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw Object.assign(new Error(`Mac 回了 ${res.status}`), { status: res.status })
  return JSON.parse(open(sessionKeys(p.secret).res, (await res.text()).trim(), head.nonce)) as Frame
}

/**
 * 问一问，一帧一帧交给 onFrame（已经打开、按顺序）；返回全部帧。
 * opts.time / nonce：测试故意给旧时间、用过的 nonce；signal：中途停下（断开连接）
 */
export async function ask(p: Paired, q: MobileAsk, onFrame: (f: Frame, at: number) => void = () => undefined, opts: { time?: number; nonce?: string; signal?: AbortSignal } = {}): Promise<Frame[]> {
  const keys = sessionKeys(p.secret)
  const body = seal(keys.req, JSON.stringify(q))
  const { head, headers } = signedHeaders(p, 'POST', '/v1/ask', body, opts)
  const res = await fetch(`${p.base}/v1/ask`, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body, ...(opts.signal ? { signal: opts.signal } : {}) })
  if (!res.ok) throw Object.assign(new Error(`Mac 回了 ${res.status}`), { status: res.status })
  const frames: Frame[] = []
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const f = JSON.parse(open(keys.res, line, head.nonce)) as Frame
      if (f.i !== frames.length) throw new Error(`帧的顺序不对：等 ${frames.length}，来了 ${f.i}`)
      frames.push(f)
      onFrame(f, Date.now())
    }
  }
  return frames
}

/** 封好发一个小请求（点头、撤回），拿回那一帧 */
async function small(p: Paired, path: string, body: unknown): Promise<Frame> {
  const keys = sessionKeys(p.secret)
  const sealed = seal(keys.req, JSON.stringify(body))
  const { head, headers } = signedHeaders(p, 'POST', path, sealed)
  const res = await fetch(`${p.base}${path}`, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: sealed, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw Object.assign(new Error(`Mac 回了 ${res.status}：${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ''}`), { status: res.status })
  return JSON.parse(open(keys.res, (await res.text()).trim(), head.nonce)) as Frame
}

/** 手机全能模式：那一问（nonce 是问的时候给的）的那一步点头或不要 */
export const confirm = (p: Paired, ask: string, id: string, ok: boolean) => small(p, '/v1/confirm', { ask, id, ok })

/** 手机全能模式：撤回那一次提交 */
export const undo = (p: Paired, commit: string) => small(p, '/v1/undo', { commit })
