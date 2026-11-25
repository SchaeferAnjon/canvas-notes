/** 测试用的本机服务器：只听 127.0.0.1，端口让系统挑（0），记下每次请求 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Hit {
  path: string
  headers: IncomingMessage['headers']
  at: number
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

export async function startServer(routes: Record<string, Handler>) {
  const hits: Hit[] = []
  const server = createServer(async (req, res) => {
    const path = req.url ?? '/'
    hits.push({ path, headers: req.headers, at: Date.now() })
    const h = routes[path] ?? routes[path.replace(/\?.*$/, '')] ?? routes['*']
    if (!h) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    try {
      await h(req, res)
    } catch (e) {
      res.statusCode = 500
      res.end(String(e))
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const base = `http://127.0.0.1:${port}`
  return {
    base,
    url: (p: string) => base + p,
    hits,
    count: (p: string) => hits.filter((h) => h.path === p).length,
    routes,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

export const send =
  (body: string | Uint8Array, type = 'application/xml; charset=utf-8', headers: Record<string, string> = {}): Handler =>
  (_req, res) => {
    res.writeHead(200, { 'content-type': type, ...headers })
    res.end(body)
  }
