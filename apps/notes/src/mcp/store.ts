/**
 * 对外接口（task-av5t8，方案 46-对外开放MCP）的两份本机记录，都在软件设置目录（userData），不进库、不同步：
 * - mcp.json：总开关、每家一把钥匙（{ on, clients: { claude-code: { key, level, at } } }）；
 * - mcp-calls/<年-月>.jsonl：调用记录，一次一行（谁、什么时候、调了什么、回了多少字）。
 * 软件开着时由软件读写；软件没开着时小程序（stdio.ts）照样读这两份：认钥匙、记一行。纯 Node，不碰 Electron。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { MCP_CLIENTS, type McpCall, type McpClientId, type McpLevel } from '../shared/mcp'

/** 装好的软件的设置目录；测试和多开用 CN_USER_DATA（和 main/index.ts 同一个规矩） */
export const userDataDir = (env: NodeJS.ProcessEnv = process.env): string => env.CN_USER_DATA || join(homedir(), 'Library/Application Support/canvas-notes')

/**
 * 小程序和软件之间的本机 socket：设置目录里的 mcp.sock。macOS 的 socket 路径最长 104 字节，
 * 设置目录太深（测试的临时目录）时放进这个账号自己的临时目录，名字按设置目录算，两边算出来一样
 */
export function socketPath(userData: string): string {
  const p = join(userData, 'mcp.sock')
  if (Buffer.byteLength(p) < 100) return p
  return join(tmpdir(), `cn-mcp-${createHash('sha1').update(userData).digest('hex').slice(0, 12)}.sock`)
}

export interface McpClientEntry {
  key: string
  level: McpLevel
  /** 什么时候给的钥匙（毫秒） */
  at: number
}

export interface McpFile {
  on: boolean
  clients: Partial<Record<McpClientId, McpClientEntry>>
}

const stateFile = (userData: string) => join(userData, 'mcp.json')

/** 读 mcp.json；没有是默认（关着、谁都没有钥匙）。坏了的（不是 JSON）照实报错，不悄悄当成关着 */
export function readMcpFile(userData: string): McpFile {
  let text: string
  try {
    text = readFileSync(stateFile(userData), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { on: false, clients: {} }
    throw e
  }
  const v = JSON.parse(text) as Partial<McpFile>
  const clients: McpFile['clients'] = {}
  for (const id of MCP_CLIENTS) {
    const c = v.clients?.[id]
    if (c && typeof c.key === 'string' && c.key.length >= 32) clients[id] = { key: c.key, level: 'read', at: typeof c.at === 'number' ? c.at : 0 }
  }
  return { on: v.on === true, clients }
}

/** 写 mcp.json：先写临时文件再换名，权限 600（钥匙在里面） */
export function writeMcpFile(userData: string, f: McpFile): void {
  mkdirSync(userData, { recursive: true })
  const p = stateFile(userData)
  writeFileSync(p + '.tmp', JSON.stringify(f, null, 2), { mode: 0o600 })
  renameSync(p + '.tmp', p)
  chmodSync(p, 0o600)
}

/** 一把新钥匙：32 字节随机，base64url */
export const newKey = (): string => randomBytes(32).toString('base64url')

/** 这把钥匙是哪家的；不认识是 null。按位比，不因为前几个字对上就早回 */
export function clientOfKey(f: McpFile, key: string | undefined): McpClientId | null {
  if (!key) return null
  const given = Buffer.from(key)
  for (const id of MCP_CLIENTS) {
    const c = f.clients[id]
    if (!c) continue
    const want = Buffer.from(c.key)
    if (want.length === given.length && timingSafeEqual(want, given)) return id
  }
  return null
}

// ---------- 调用记录 ----------

const callsDir = (userData: string) => join(userData, 'mcp-calls')
const monthOf = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 记一行（软件和小程序都往同一份里追加；一行很短，追加写不会和另一边的交错） */
export function appendCall(userData: string, c: McpCall): void {
  mkdirSync(callsDir(userData), { recursive: true })
  appendFileSync(join(callsDir(userData), `${monthOf(c.at)}.jsonl`), JSON.stringify(c) + '\n', { mode: 0o600 })
}

/** 最近 days 天的记录，新的在前；读不出的行跳过（写到一半断电的那一行） */
export function readCalls(userData: string, o: { since: number; client?: McpClientId | null; limit?: number }): McpCall[] {
  let files: string[]
  try {
    files = readdirSync(callsDir(userData)).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const from = monthOf(o.since)
  const out: McpCall[] = []
  for (const f of files.sort().reverse()) {
    if (f.slice(0, 7) < from) break
    const lines = readFileSync(join(callsDir(userData), f), 'utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!.trim()
      if (!l) continue
      let c: McpCall
      try {
        c = JSON.parse(l) as McpCall
      } catch {
        continue
      }
      if (c.at < o.since) continue
      if (o.client !== undefined && c.client !== o.client) continue
      out.push(c)
    }
  }
  out.sort((a, b) => b.at - a.at)
  return o.limit ? out.slice(0, o.limit) : out
}

// ---------- 别的 ----------

/** 记进调用记录的参数：长字截短 */
export function briefArgs(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(a ?? {}).slice(0, 12)) out[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : typeof v === 'object' && v !== null ? '…' : v
  return out
}

/** 软件设置里的库：上次打开的、开过的（settings.json 的 lastVault、knownVaults） */
export function vaultsOf(userData: string): { last: string | null; known: string[] } {
  let s: { lastVault?: unknown; knownVaults?: unknown }
  try {
    s = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as typeof s
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return { last: null, known: [] }
    throw e
  }
  const last = typeof s.lastVault === 'string' ? s.lastVault : null
  const known = Array.isArray(s.knownVaults) ? s.knownVaults.filter((x): x is string => typeof x === 'string') : []
  return { last, known: [...new Set([...(last ? [last] : []), ...known])] }
}
