/**
 * canvas-notes-mcp：给别的 AI（Claude Code、Claude 桌面版、Codex……）用 stdio 拉起的小程序（task-av5t8，方案 46 第 4 节）。
 * 装好的软件里是 Canvas Notes.app/Contents/Resources/bin/canvas-notes-mcp（一段 sh，用软件自带的 Electron 当 Node 跑这份），
 * 开发时是 out/main/mcp-stdio.js。MCP 协议用官方 TypeScript SDK（@modelcontextprotocol/sdk）。
 *
 * 每次调用：
 * 1. 连本机 socket（设置目录里的 mcp.sock）交给开着的画布笔记：它认钥匙、查开关、跑工具、记调用记录；
 * 2. 连不上（画布笔记没开着）：读设置目录里的 mcp.json 认钥匙、看总开关，读的工具直接读库里的文件、自己记一行；
 *    open_note 在后台拉起画布笔记，最多等 15 秒连上再交过去。
 * 钥匙从环境变量 CN_MCP_KEY 来（装上时写进各家配置）；设置目录默认 ~/Library/Application Support/canvas-notes，CN_USER_DATA 能换。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, type CallToolResult, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createConnection } from 'node:net'
import { basename, join } from 'node:path'
import { dirSource } from './notes'
import { appendCall, briefArgs, clientOfKey, readMcpFile, socketPath, userDataDir, vaultsOf } from './store'
import { isToolName, runTool, SERVER_INSTRUCTIONS, TOOL_DEFS, type ToolOutcome } from './tools'
import { callWire, notListening, type WireResult } from './wire'

const OFF = 'Canvas Notes’ connection for other AI apps is turned off. Ask the user to turn it on in Canvas Notes › Settings › External access (对外接口).'
const NO_KEY = 'This MCP server has no key (CN_MCP_KEY is not set). Ask the user to click “Install” or “Copy config” for this app in Canvas Notes › Settings › External access (对外接口).'
const BAD_KEY = 'Canvas Notes does not recognize this key (it was disconnected or replaced). Ask the user to install this app again in Canvas Notes › Settings › External access (对外接口).'

const userData = userDataDir()
const sock = socketPath(userData)
const key = process.env.CN_MCP_KEY?.trim() || ''
let seq = 0

const version = (() => {
  // 开发时是 apps/notes/package.json，装好的软件里是 app.asar/package.json
  const p = join(__dirname, '../../package.json')
  return (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version
})()

const result = (r: WireResult | ToolOutcome): CallToolResult => ({
  content: [{ type: 'text', text: r.text }],
  ...(r.structured && !r.isError ? { structuredContent: r.structured } : {}),
  isError: r.isError,
})
const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true })

/** 连得上 socket 吗（拉起画布笔记以后等它） */
const reachable = () =>
  new Promise<boolean>((resolve) => {
    const s = createConnection(sock)
    s.once('connect', () => (s.end(), resolve(true)))
    s.once('error', () => resolve(false))
  })

/** 在后台拉起画布笔记：装好的用 open -g（不抢前台）；开发时用同一个 Electron 起 out/main/index.js；CN_MCP_LAUNCH 能换（测试用） */
function launchApp() {
  const custom = process.env.CN_MCP_LAUNCH
  if (custom) return void spawn('/bin/sh', ['-c', custom], { detached: true, stdio: 'ignore' }).unref()
  const bundle = /^(.*?\.app)\/Contents\/Resources\//.exec(__dirname)?.[1]
  if (bundle) return void spawn('/usr/bin/open', ['-g', '-a', bundle], { detached: true, stdio: 'ignore' }).unref()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.CN_MCP_KEY
  spawn(process.execPath, [join(__dirname, 'index.js')], { detached: true, stdio: 'ignore', env }).unref()
}

async function waitUp(ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (existsSync(sock) && (await reachable())) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!key) return fail(NO_KEY)
  if (!isToolName(name)) return fail(`No tool named ${name}. Tools: ${TOOL_DEFS.map((t) => t.name).join(', ')}`)
  try {
    return result(await callWire(sock, { id: ++seq, key, tool: name, args }))
  } catch (e) {
    if (!notListening(e)) return fail(`Canvas Notes did not answer: ${(e as Error).message}`)
  }
  // 画布笔记没开着（或对外接口关着：关着时没有 socket）
  const f = readMcpFile(userData)
  if (!f.on) return fail(OFF)
  const client = clientOfKey(f, key)
  const at = Date.now()
  if (!client) {
    appendCall(userData, { at, client: null, tool: name, args: briefArgs(args), ok: false, chars: BAD_KEY.length, error: BAD_KEY, offline: true })
    return fail(BAD_KEY)
  }
  if (name === 'open_note') {
    // 动作：在后台拉起画布笔记，连上以后交给它（它记调用记录）
    launchApp()
    if (await waitUp(15_000)) return result(await callWire(sock, { id: ++seq, key, tool: name, args }))
    const why = 'Canvas Notes is not running and did not start within 15 seconds. Ask the user to open Canvas Notes, then try again.'
    appendCall(userData, { at, client, tool: name, args: briefArgs(args), ok: false, chars: why.length, error: why, offline: true })
    return fail(why)
  }
  const { last, known } = vaultsOf(userData)
  const root = last && existsSync(last) && statSync(last).isDirectory() ? last : null
  const out = await runTool(name, args, {
    src: root ? dirSource(root) : null,
    appRunning: false,
    vaults: () => known.filter((p) => existsSync(p)).map((p) => ({ name: basename(p), path: p, open: p === root })),
  })
  appendCall(userData, { at, client, tool: name, args: briefArgs(args), ok: !out.isError, chars: out.text.length, offline: true, ...out.log })
  return result(out)
}

const server = new Server({ name: 'canvas-notes', title: 'Canvas Notes', version }, { capabilities: { tools: { listChanged: false } }, instructions: SERVER_INSTRUCTIONS })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }))
server.setRequestHandler(CallToolRequestSchema, async (req) => call(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>))

void server.connect(new StdioServerTransport())
