/**
 * 本机假的 Soniox 实时听写（WebSocket，端口系统挑）：费曼的语音输入测试用（task-yvabi）。
 * 照真接口（docs.soniox.com/stt/api-reference/websocket-api，2026-11-23 查）：
 * 连接时 Authorization: Bearer <key>；第一条是 JSON 配置；之后是二进制的声音；空的文字帧表示说完了；
 * 回的每条 {tokens:[{text,is_final}], final_audio_proc_ms, total_audio_proc_ms}，没定的每次整段重发，定了的只发一次；
 * 说完后把剩下的定下来、发 <fin>，再发 {finished:true} 关连接；出错发 {error_code,error_type,error_message} 关连接；
 * {"type":"ping","id":n} 回 {"type":"pong","id":n}。
 * 只写了测试要的那一点 WebSocket（RFC 6455），不带第三方包。
 */
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

export const FAKE_RT_KEY = 'test-soniox-rt-key'
/** 假服务按收到的声音一个字一个字地「听」出这一句 */
export const FAKE_RT_TEXT = '范数就是向量的长度。比如三四这个向量，长度是五。'

export interface FakeRtConn {
  auth: string | undefined
  config: Record<string, unknown> | null
  bytes: number
  /** 收到过非静音的声音（假麦克风真在送那段 wav） */
  loud: boolean
  pings: number
  ended: boolean
}

export interface FakeRtOptions {
  /** 每收到多少字节声音出一个字（16 kHz 16 位单声道：3200 字节是 0.1 秒） */
  bytesPerChar?: number
  /** 出了这么多字以后突然断开（测网络断） */
  dropAfterChars?: number
  /** 不回 ping（测超时） */
  noPong?: boolean
}

export interface FakeSonioxRt {
  server: Server
  url: string
  conns: FakeRtConn[]
  opts: FakeRtOptions
  close(): Promise<void>
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function frame(op: number, payload: Buffer): Buffer {
  const n = payload.length
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b })()])
  return Buffer.concat([head, payload])
}

/** 从缓冲里拆出完整的帧（客户端发的都带掩码） */
function* frames(st: { buf: Buffer }): Generator<{ op: number; data: Buffer }> {
  for (;;) {
    const b = st.buf
    if (b.length < 2) return
    const op = b[0]! & 15
    let len = b[1]! & 127
    let off = 2
    if (len === 126) {
      if (b.length < 4) return
      len = b.readUInt16BE(2)
      off = 4
    } else if (len === 127) {
      if (b.length < 10) return
      len = Number(b.readBigUInt64BE(2))
      off = 10
    }
    const masked = (b[1]! & 128) !== 0
    const mask = masked ? b.subarray(off, off + 4) : null
    if (masked) off += 4
    if (b.length < off + len) return
    const data = Buffer.from(b.subarray(off, off + len))
    if (mask) for (let i = 0; i < data.length; i++) data[i]! ^= mask[i & 3]!
    st.buf = b.subarray(off + len)
    yield { op, data }
  }
}

export async function startFakeSonioxRt(opts: FakeRtOptions = {}): Promise<FakeSonioxRt> {
  const conns: FakeRtConn[] = []
  const sockets = new Set<Duplex>()
  const server = createServer((_req, res) => res.writeHead(404).end())
  server.on('upgrade', (req, sock: Duplex) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
    sock.on('error', () => {})
    const key = req.headers['sec-websocket-key']
    if (req.url !== '/transcribe-websocket' || typeof key !== 'string') {
      sock.end('HTTP/1.1 404 Not Found\r\n\r\n')
      return
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64')
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const c: FakeRtConn = { auth: req.headers.authorization, config: null, bytes: 0, loud: false, pings: 0, ended: false }
    conns.push(c)
    const chars = [...FAKE_RT_TEXT]
    let said = 0
    let fixed = 0
    let closed = false
    const sendJson = (o: unknown) => !closed && sock.write(frame(1, Buffer.from(JSON.stringify(o))))
    const close = () => {
      if (closed) return
      sock.write(frame(8, Buffer.from([0x03, 0xe8])))
      closed = true
      sock.end()
    }
    const fail = (code: number, type: string, message: string) => {
      sendJson({ error_code: code, error_type: type, error_message: message, request_id: 'fake' })
      close()
    }
    const ms = () => Math.round(c.bytes / 32)
    const reply = (newFinal: string[], interim: string[]) =>
      sendJson({
        tokens: [...newFinal.map((t) => ({ text: t, is_final: true, confidence: 0.9 })), ...interim.map((t) => ({ text: t, is_final: false, confidence: 0.6 }))],
        final_audio_proc_ms: ms(),
        total_audio_proc_ms: ms(),
      })
    const st = { buf: Buffer.alloc(0) }
    sock.on('data', (d: Buffer) => {
      st.buf = Buffer.concat([st.buf, d])
      for (const f of frames(st)) {
        if (closed) return
        if (f.op === 8) return close()
        if (f.op === 9) {
          sock.write(frame(10, f.data))
          continue
        }
        if (f.op === 1) {
          const text = f.data.toString('utf8')
          if (text === '') {
            // 说完了：没定的全定下来，<fin>，finished
            c.ended = true
            reply(chars.slice(fixed, said).concat('<fin>'), [])
            fixed = said
            sendJson({ tokens: [], final_audio_proc_ms: ms(), total_audio_proc_ms: ms(), finished: true })
            close()
            return
          }
          const msg = JSON.parse(text) as Record<string, unknown>
          if (msg.type === 'ping') {
            c.pings++
            if (!opts.noPong) sendJson({ type: 'pong', id: msg.id })
            continue
          }
          if (msg.type === 'keepalive' || msg.type === 'finalize') continue
          c.config = msg
          if (c.auth !== `Bearer ${FAKE_RT_KEY}`) return fail(401, 'unauthenticated', 'Invalid API key.')
          if (msg.audio_format !== 'pcm_s16le' || msg.sample_rate !== 16000 || msg.num_channels !== 1 || typeof msg.model !== 'string') return fail(400, 'invalid_request', 'Bad audio format.')
          continue
        }
        if (f.op === 2) {
          if (!c.config) return fail(400, 'invalid_request', 'Audio before config.')
          c.bytes += f.data.length
          for (let i = 0; i + 1 < f.data.length; i += 2) if (Math.abs(f.data.readInt16LE(i)) > 1500) c.loud = true
          const want = Math.min(chars.length, Math.floor(c.bytes / (opts.bytesPerChar ?? 4800)))
          if (want <= said) continue
          said = want
          // 没定的最多留 3 个字，多出来的定下来
          const nf = Math.max(fixed, said - 3)
          reply(chars.slice(fixed, nf), chars.slice(nf, said))
          fixed = nf
          if (opts.dropAfterChars && said >= opts.dropAfterChars) {
            closed = true
            sock.destroy()
            return
          }
        }
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    server,
    url: `ws://127.0.0.1:${port}/transcribe-websocket`,
    conns,
    opts,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
      }),
  }
}
