/**
 * 「装上」（task-av5t8）：把小程序和这家的钥匙写进各家的 MCP 配置，「断开」拿掉。纯 Node，不碰 Electron。
 * - Claude Code：用户级配置 ~/.claude.json（设了 CLAUDE_CONFIG_DIR 时是那里的 .claude.json）的 mcpServers，
 *   和 `claude mcp add --scope user` 写的一样；整个文件读进来只改这一项、别的原样，先写临时文件再换名，权限照旧。
 * - Codex：~/.codex/config.toml（设了 CODEX_HOME 时是那里）的 [mcp_servers.canvas-notes] 一节，和 `codex mcp add` 写的一样；
 *   只换这一节的几行，别的字一个不动。
 * - Claude 桌面版：这一批只认（配置里有没有、钥匙对不对），一键装（.mcpb）在下一批；界面上给「拷贝配置」。
 * - ParaRead、MeetCaption：接上时在设置目录 mcp-clients/<id>.json 写一份现成的接法（{ mcpServers: … }，权限 600），它们拉起 AI 时交过去。
 * 配置文件坏了（不是 JSON）照实报错，不覆盖。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { MCP_SERVER_NAME, type McpClientId, type McpLaunch } from '../shared/mcp'

export interface ConfigEnv {
  home: string
  claudeConfigDir?: string
  codexHome?: string
}

export const configEnv = (env: NodeJS.ProcessEnv = process.env): ConfigEnv => ({ home: homedir(), claudeConfigDir: env.CLAUDE_CONFIG_DIR || undefined, codexHome: env.CODEX_HOME || undefined })

export function configPath(id: McpClientId, e: ConfigEnv, userData: string): string | null {
  switch (id) {
    case 'claude-code':
      return e.claudeConfigDir ? join(e.claudeConfigDir, '.claude.json') : join(e.home, '.claude.json')
    case 'codex':
      return join(e.codexHome ?? join(e.home, '.codex'), 'config.toml')
    case 'claude-desktop':
      return join(e.home, 'Library/Application Support/Claude/claude_desktop_config.json')
    case 'pararead':
    case 'meetcaption':
      return join(userData, 'mcp-clients', `${id}.json`)
    case 'other':
      return null
  }
}

/** 配置里写的那一项：起哪个程序、带哪把钥匙 */
export const serverEntry = (l: McpLaunch, key: string) => ({ command: l.command, args: l.args, env: { ...l.env, CN_MCP_KEY: key } })

/** 给别的 AI 拷的那段（Claude 桌面版、Cursor、Zed……都认这个样子） */
export const configSnippet = (l: McpLaunch, key: string) => JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: serverEntry(l, key) } }, null, 2)

/** 写一个文件：先写临时文件再换名；原来有的照它的权限，新建的 600 */
function writeKeeping(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600
  writeFileSync(path + '.cn-tmp', text, { mode })
  chmodSync(path + '.cn-tmp', mode)
  renameSync(path + '.cn-tmp', path)
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, 'utf8')
  if (!text.trim()) return {}
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch (e) {
    throw new Error(`${path} is not valid JSON (${(e as Error).message}); not touching it`)
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${path} is not a JSON object; not touching it`)
  return v as Record<string, unknown>
}

// ---------- JSON 的（Claude Code、Claude 桌面版） ----------

/** 现在配置里那一项的钥匙；没有这一项是 null */
export function jsonKey(path: string): string | null {
  if (!existsSync(path)) return null
  let o: Record<string, unknown>
  try {
    o = readJsonObject(path)
  } catch {
    return null
  }
  const s = (o.mcpServers as Record<string, { env?: Record<string, unknown> }> | undefined)?.[MCP_SERVER_NAME]
  const k = s?.env?.CN_MCP_KEY
  return typeof k === 'string' ? k : null
}

export function jsonInstall(path: string, entry: ReturnType<typeof serverEntry>, withType: boolean) {
  const o = readJsonObject(path)
  const servers = o.mcpServers && typeof o.mcpServers === 'object' && !Array.isArray(o.mcpServers) ? (o.mcpServers as Record<string, unknown>) : {}
  o.mcpServers = { ...servers, [MCP_SERVER_NAME]: withType ? { type: 'stdio', ...entry } : entry }
  writeKeeping(path, JSON.stringify(o, null, 2))
}

export function jsonRemove(path: string) {
  if (!existsSync(path)) return
  const o = readJsonObject(path)
  const servers = o.mcpServers as Record<string, unknown> | undefined
  if (!servers || !(MCP_SERVER_NAME in servers)) return
  delete servers[MCP_SERVER_NAME]
  writeKeeping(path, JSON.stringify(o, null, 2))
}

// ---------- TOML 的（Codex） ----------

const HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:"canvas-notes"|'canvas-notes'|canvas-notes)\s*(?:\.\s*[\w"'-]+\s*)?\]\s*(#.*)?$/
const ANY_HEADER = /^\s*\[/

/** 去掉 [mcp_servers.canvas-notes] 和它的子表（.env），别的行一个字不动 */
export function tomlWithout(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let skipping = false
  for (const l of lines) {
    if (HEADER.test(l)) {
      skipping = true
      continue
    }
    if (skipping && ANY_HEADER.test(l)) skipping = false
    if (!skipping) out.push(l)
  }
  // 拿掉那一节后末尾多出来的空行收成一个
  return out.join('\n').replace(/\n{3,}$/, '\n\n')
}

/** TOML 的基本字符串：JSON 的写法 TOML 也认（\\ \" \n \uXXXX） */
const tq = (s: string) => JSON.stringify(s)

export function tomlWith(text: string, entry: ReturnType<typeof serverEntry>): string {
  const base = tomlWithout(text).replace(/\s*$/, '')
  const env = Object.entries(entry.env)
    .map(([k, v]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : tq(k)} = ${tq(v)}`)
    .join(', ')
  const block = [`[mcp_servers.${MCP_SERVER_NAME}]`, `command = ${tq(entry.command)}`, `args = [${entry.args.map(tq).join(', ')}]`, `env = { ${env} }`].join('\n')
  return (base ? base + '\n\n' : '') + block + '\n'
}

export function tomlKey(path: string): string | null {
  if (!existsSync(path)) return null
  const lines = readFileSync(path, 'utf8').split('\n')
  let inside = false
  for (const l of lines) {
    if (HEADER.test(l)) {
      inside = true
      continue
    }
    if (inside && ANY_HEADER.test(l)) inside = false
    if (!inside) continue
    const m = /CN_MCP_KEY\s*=\s*"([^"]+)"/.exec(l)
    if (m) return m[1]!
  }
  return null
}

export function tomlInstall(path: string, entry: ReturnType<typeof serverEntry>) {
  writeKeeping(path, tomlWith(existsSync(path) ? readFileSync(path, 'utf8') : '', entry))
}

export function tomlRemove(path: string) {
  if (!existsSync(path)) return
  const before = readFileSync(path, 'utf8')
  const after = tomlWithout(before)
  if (after !== before) writeKeeping(path, after)
}

// ---------- 合在一起 ----------

/** 这一家配置里的钥匙（没装是 null） */
export function installedKey(id: McpClientId, e: ConfigEnv, userData: string): string | null {
  const p = configPath(id, e, userData)
  if (!p) return null
  if (id === 'codex') return tomlKey(p)
  return jsonKey(p)
}

export function install(id: McpClientId, e: ConfigEnv, userData: string, l: McpLaunch, key: string): string {
  const p = configPath(id, e, userData)
  if (!p || id === 'claude-desktop') throw new Error(`${id} has no one-click install in this version`)
  const entry = serverEntry(l, key)
  if (id === 'codex') tomlInstall(p, entry)
  else if (id === 'claude-code') jsonInstall(p, entry, true)
  else writeKeeping(p, configSnippet(l, key))
  return p
}

export function uninstall(id: McpClientId, e: ConfigEnv, userData: string) {
  const p = configPath(id, e, userData)
  // Claude 桌面版、别的 AI 的配置是用户自己贴的：断开只作废钥匙，不去改它们的文件
  if (!p || id === 'claude-desktop') return
  if (id === 'codex') tomlRemove(p)
  else if (id === 'pararead' || id === 'meetcaption') {
    if (existsSync(p)) unlinkSync(p)
  } else jsonRemove(p)
}
