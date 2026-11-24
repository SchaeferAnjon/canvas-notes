/**
 * 小程序和开着的画布笔记之间的本机 socket（task-av5t8）：一行一条 JSON。
 * 小程序发 { id, key, tool, args }，软件回 { id, ok: true, result } 或 { id, ok: false, error }。
 * socket 文件权限 600（只有这个账号的程序连得上）；钥匙每次都带，软件按钥匙认是哪家，不信别的自报。纯 Node。
 */
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { createConnection, createServer, type Server, type Socket } from 'node:net'

export interface WireRequest {
  id: number
  key: string
  tool: string
  args: Record<string, unknown>
}

export interface WireResult {
  structured?: Record<string, unknown>
  text: string
  isError: boolean
}

type WireReply = { id: number; ok: true; result: WireResult } | { id: number; ok: false; error: string }

const MAX_LINE = 4 * 1024 * 1024

/** 读一行一条：攒到换行就交出去；一行太长的断开 */
function lines(sock: Socket, onLine: (l: string) => void) {
  let buf = ''
  sock.setEncoding('utf8')
  sock.on('data', (d: string) => {
    buf += d
    if (buf.length > MAX_LINE) return sock.destroy()
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const l = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (l) onLine(l)
    }
  })
}

/** 软件这边：听 socket，每条交给 handle。旧的（上次没退干净留下的）socket 文件先删掉 */
export async function serveWire(path: string, handle: (r: WireRequest) => Promise<WireResult>): Promise<{ close(): Promise<void> }> {
  if (existsSync(path)) unlinkSync(path)
  const server: Server = createServer((sock) => {
    sock.on('error', () => undefined)
    lines(sock, (l) => {
      let r: WireRequest
      try {
        r = JSON.parse(l) as WireRequest
      } catch {
        return sock.end(JSON.stringify({ id: 0, ok: false, error: 'bad request' }) + '\n')
      }
      if (typeof r.id !== 'number' || typeof r.tool !== 'string' || typeof r.key !== 'string') return sock.end(JSON.stringify({ id: r.id ?? 0, ok: false, error: 'bad request' }) + '\n')
      handle({ id: r.id, key: r.key, tool: r.tool, args: r.args && typeof r.args === 'object' ? r.args : {} })
        .then((result): WireReply => ({ id: r.id, ok: true, result }))
        .catch((e: unknown): WireReply => ({ id: r.id, ok: false, error: String((e as Error)?.message ?? e) }))
        .then((reply) => sock.writable && sock.write(JSON.stringify(reply) + '\n'))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => resolve())
  })
  chmodSync(path, 0o600)
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        if (existsSync(path)) unlinkSync(path)
      }),
  }
}

/** 连不上的几种：没有 socket 文件（软件没开、对外接口关着）、文件在但没人听（软件上次没退干净） */
export const notListening = (e: unknown) => ['ENOENT', 'ECONNREFUSED'].includes((e as NodeJS.ErrnoException)?.code ?? '')

/** 小程序这边：连上、发一条、等回音（timeoutMs 没回就算失败）、断开 */
export function callWire(path: string, req: WireRequest, timeoutMs = 60_000): Promise<WireResult> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path)
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`Canvas Notes did not answer within ${Math.round(timeoutMs / 1000)} s`))
    }, timeoutMs)
    sock.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    sock.once('connect', () => sock.write(JSON.stringify(req) + '\n'))
    lines(sock, (l) => {
      clearTimeout(timer)
      sock.end()
      const r = JSON.parse(l) as WireReply
      if (r.ok) resolve(r.result)
      else reject(new Error(r.error))
    })
  })
}
