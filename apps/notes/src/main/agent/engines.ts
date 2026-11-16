/**
 * 四家本机 AI 命令行，统一成一个样子：给一段话，边生成边吐字，能用我们的 MCP 工具，能接着上一轮聊。
 * - Claude Code：claude -p --output-format stream-json（一轮一个进程，--resume 接着聊）
 * - Codex：codex app-server（JSON-RPC，一行一条）
 * - Gemini CLI：gemini --acp；OpenCode：opencode acp（都是 ACP）
 * 都不许 AI 自己写文件、跑命令：改笔记只能走我们的工具，这样每一轮的改动都知道是哪几个文件，能一次提交、一键撤回。
 *
 * 各家怎么接参照了 Claudian（github.com/yishentu/claudian，MIT，版权 (c) 2025 Yishen Tu）的
 * src/providers/claude、src/providers/codex、src/providers/acp，许可声明见仓库根目录 THIRD_PARTY_NOTICES.md。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineId } from '../../shared/agent'
import { cliEnv, findCli, INSTALL_HINT } from './cli'
import { RpcProcess } from './jsonrpc'

export interface EngineRun {
  prompt: string
  system: string
  cwd: string
  /** 不给就是只聊天、不用工具（/总结、/翻译 这类命令） */
  mcp?: { url: string; token: string; tools: string[] }
  /** 上一轮的会话号，接着聊 */
  session?: string
  /** 换模型（翻译这类要快的活用便宜的；只有 Claude Code 认） */
  model?: string
  /** 会话接不上（软件重开过）时补在前面的最近几轮对话 */
  history?: string
  /** 跟着这段话一起给的图（读 PDF 时框的那块）：data 是 base64，path 是本机的绝对路径（Codex 只认文件） */
  images?: EngineImage[]
  /** 不给工具时也留着会话、能接着聊（读 PDF 的问答要追问；/ 命令那种问一次就完的不留） */
  keepSession?: boolean
  /** 只给只读的 Read、Glob、Grep 自己翻库里的文件（「让 Claude 帮我找」），不接我们的 MCP；只有 Claude Code 认 */
  readOnly?: boolean
  /** AI 每调一次工具报一声（「让 Claude 帮我找」把过程显示出来） */
  onTool?(name: string, input: Record<string, unknown>): void
  signal: AbortSignal
  onText(delta: string): void
}

export interface EngineImage {
  mime: 'image/png' | 'image/jpeg'
  data: string
  path: string
}

export interface EngineOutcome {
  text: string
  session?: string
}

export interface Engine {
  id: EngineId
  label: string
  run(r: EngineRun): Promise<EngineOutcome>
  dispose?(): void
}

export const LABELS: Record<EngineId, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode' }
export const MCP_NAME = 'canvas'

const APP = { name: 'canvas-notes', version: '0.0.1' }

function need(id: EngineId): string {
  const p = findCli(id)
  if (!p) throw new Error(INSTALL_HINT[id])
  return p
}

const withHistory = (r: EngineRun, fresh: boolean) => (fresh && r.history ? `${r.history}\n\n${r.prompt}` : r.prompt)

const aborted = () => Object.assign(new Error('停下了'), { name: 'AbortError' })

// ---------------------------------------------------------------- Claude Code

export const CLAUDE_MODEL = process.env.CN_AI_MODEL || 'claude-opus-5-5'

/** Claude Code 自带的工具只留这三样只读的；dontAsk 下它读不到库外面的文件（不在工作目录里的读会被拒） */
const CLAUDE_READ_TOOLS = ['Read', 'Glob', 'Grep']
/** 自带的写文件、跑命令、上网、开子 Agent 再明着禁一遍（--tools 已经不给了） */
const CLAUDE_DENIED = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']

/** claude -p 的参数（以 claude --help 为准，2.1.323 核过）。mcpConfig：写着我们 MCP 服务和令牌的 json 文件，只在给工具时有 */
export function claudeArgs(r: Pick<EngineRun, 'system' | 'mcp' | 'model' | 'images' | 'keepSession' | 'readOnly'>, resume?: string, mcpConfig?: string): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', r.model ?? CLAUDE_MODEL,
    '--system-prompt', r.system,
    // 不读用户的设置（hooks、权限、插件），MCP 只接我们给的
    '--setting-sources=',
    '--strict-mcp-config',
    // 没明着放行的一律拒绝，不会停下来问
    '--permission-mode', 'dontAsk',
    '--disallowedTools', CLAUDE_DENIED.join(','),
  ]
  if (r.mcp && mcpConfig) {
    const ours = r.mcp.tools.map((t) => `mcp__${MCP_NAME}__${t}`)
    args.push('--tools', CLAUDE_READ_TOOLS.join(','), '--mcp-config', mcpConfig, '--allowedTools', ours.join(','), '--max-turns', '40')
  } else if (r.readOnly) {
    // 只读翻文件：只给 Read、Glob、Grep，dontAsk 下读不到库外面；找完就完，不留会话
    args.push('--tools', CLAUDE_READ_TOOLS.join(','), '--allowedTools', CLAUDE_READ_TOOLS.join(','), '--max-turns', '30', '--no-session-persistence')
  } else {
    // 只聊天：一个工具都不给，答一次；/ 命令那种不留会话记录，读 PDF 的问答留着好追问
    args.push('--tools', '', '--max-turns', '1')
    if (!r.keepSession) args.push('--no-session-persistence')
  }
  // 带图：话改成 stream-json 的一条用户消息（图是 image 内容块），见 code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
  if (r.images?.length) args.push('--input-format', 'stream-json')
  if (resume) args.push('--resume', resume)
  return args
}

/** 带图时从标准输入给的那一行 */
export function claudeImageMessage(text: string, images: EngineImage[]): string {
  const content = [{ type: 'text', text }, ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }))]
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }) + '\n'
}

/** 我们的 MCP 服务写进一个只有自己能读的临时文件（令牌不放在命令行上，ps 看不到） */
function mcpConfigFile(mcp: NonNullable<EngineRun['mcp']>): { path: string; remove(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'cn-claude-'))
  const path = join(dir, 'mcp.json')
  const config = { mcpServers: { [MCP_NAME]: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } }
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

/** stream-json 里用得到的几样 */
interface ClaudeLine {
  type?: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: string
  event?: { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string } }
  message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] }
}

/** 跑一次 claude -p：话从标准输入给，一行一个 JSON 事件读回来 */
function runClaude(exe: string, args: string[], prompt: string, r: EngineRun): Promise<EngineOutcome> {
  if (r.signal.aborted) return Promise.reject(aborted())
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: r.cwd, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let text = ''
    let streamed = false
    let session: string | undefined
    let result: string | null = null
    let error: string | null = null
    let stderr = ''
    let buf = ''
    let settled = false
    const stop = () => child.kill('SIGTERM')
    r.signal.addEventListener('abort', stop)
    const finish = (f: () => void) => {
      if (settled) return
      settled = true
      r.signal.removeEventListener('abort', stop)
      f()
    }

    const onLine = (line: string) => {
      if (!line.trim()) return
      let m: ClaudeLine
      try {
        m = JSON.parse(line) as ClaudeLine
      } catch {
        return // 不是事件的行（比如升级提示）不管
      }
      if (typeof m.session_id === 'string') session = m.session_id
      if (m.type === 'stream_event' && m.event) {
        const ev = m.event
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'text' && text) {
          // 调完工具接着说的话另起一段
          text += '\n\n'
          r.onText('\n\n')
        }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          streamed = true
          text += ev.delta.text
          r.onText(ev.delta.text)
        }
      } else if (m.type === 'assistant' && r.onTool) {
        for (const c of m.message?.content ?? []) if (c.type === 'tool_use' && c.name) r.onTool(c.name, c.input ?? {})
      } else if (m.type === 'result') {
        if (m.subtype === 'success' && !m.is_error) result = m.result ?? ''
        else error = (m.subtype === 'success' ? m.result : m.subtype) || '不知道为什么'
      }
    }

    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (d: string) => {
      buf += d
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        onLine(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (d: string) => (stderr = (stderr + d).slice(-4000)))
    child.on('error', (e) => finish(() => reject(new Error(`${exe} 启动不了：${e.message}`))))
    child.on('close', (code) =>
      finish(() => {
        onLine(buf)
        if (r.signal.aborted) return reject(aborted())
        const why = stderr.trim().split('\n').slice(-3).join(' ')
        if (error) return reject(new Error(`Claude Code 没答完：${error}${why ? `（${why}）` : ''}`))
        if (result === null && !text) {
          return reject(new Error(code ? `Claude Code 退出了（${code}）${why ? `：${why}` : ''}` : 'Claude Code 没有回答。确认这台 Mac 上的 Claude Code 已经登录（终端里运行 claude）。'))
        }
        if (!streamed && result) r.onText(result)
        resolve({ text: streamed ? text.trim() : (result ?? ''), session })
      }),
    )
    // 进程一启动就退出时写不进去（EPIPE）；为什么退出由上面的 close 报
    child.stdin!.on('error', () => undefined)
    child.stdin!.end(prompt)
  })
}

/** command、prefix 只在测试里给（假的 claude） */
export function claudeEngine(command?: string, prefix: string[] = []): Engine {
  return {
    id: 'claude',
    label: LABELS.claude,
    async run(r) {
      const exe = command ?? need('claude')
      const once = async (resume: string | undefined): Promise<EngineOutcome> => {
        const config = r.mcp ? mcpConfigFile(r.mcp) : null
        try {
          const text = withHistory(r, !resume)
          return await runClaude(exe, [...prefix, ...claudeArgs(r, resume, config?.path)], r.images?.length ? claudeImageMessage(text, r.images) : text, r)
        } finally {
          config?.remove()
        }
      }
      if (!r.session) return once(undefined)
      try {
        return await once(r.session)
      } catch (e) {
        // 会话找不到了（清过 ~/.claude）：从头开一个，补上最近几轮
        if (r.signal.aborted || !/No conversation found|session|conversation/i.test(String((e as Error).message))) throw e
        return once(undefined)
      }
    },
  }
}

// ---------------------------------------------------------------- Codex

/** command 只在测试里给（假的 app-server） */
export function codexEngine(command?: string, prefix: string[] = []): Engine {
  let proc: RpcProcess | null = null
  let starting: Promise<RpcProcess> | null = null
  let mcpKey = ''
  const live = new Set<string>()

  async function ensure(cwd: string, mcp: EngineRun['mcp']): Promise<RpcProcess> {
    const key = mcp ? mcp.url : ''
    // 只聊天（不给 MCP）时，已经开着的进程直接用
    if (proc && !proc.closed && (!mcp || key === mcpKey)) return proc
    if (starting && key === mcpKey && !proc?.closed) return starting
    proc?.close()
    proc = null
    live.clear()
    mcpKey = key
    starting = (async () => {
      // 只接我们的 MCP（不带用户自己配的那些）；我们的工具不用再批（approvalPolicy=never 时要批的会被直接拒掉）
      const servers = mcp
        ? `mcp_servers={${MCP_NAME}={url="${mcp.url}",bearer_token_env_var="CN_MCP_TOKEN",default_tools_approval_mode="approve"}}`
        : 'mcp_servers={}'
      const args = [...prefix, 'app-server', '-c', servers]
      if (process.env.CN_CODEX_MODEL) args.push('-c', `model="${process.env.CN_CODEX_MODEL}"`)
      const p = new RpcProcess(command ?? need('codex'), args, { cwd, env: cliEnv(mcp ? { CN_MCP_TOKEN: mcp.token } : {}) }, false)
      p.onRequest(async (method, params) => {
        // 我们的工具不用再问；Codex 自己要写文件、跑命令一律不许
        if (method === 'mcpServer/elicitation/request') return params.serverName === MCP_NAME ? { action: 'accept', content: {}, _meta: null } : { action: 'decline', content: null, _meta: null }
        if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') return { decision: 'decline' }
        if (method === 'execCommandApproval' || method === 'applyPatchApproval') return { decision: 'denied' }
        throw new Error(`不支持 ${method}`)
      })
      await p.request('initialize', { clientInfo: { name: APP.name, title: APP.name, version: APP.version }, capabilities: null })
      p.notify('initialized', undefined)
      proc = p
      void p.exited.then(() => (starting = null))
      return p
    })().catch((e) => {
      starting = null
      throw e
    })
    return starting
  }

  return {
    id: 'codex',
    label: LABELS.codex,
    dispose: () => proc?.close(),
    async run(r) {
      const p = await ensure(r.cwd, r.mcp)
      let threadId = r.session && live.has(r.session) ? r.session : undefined
      let fresh = false
      if (!threadId && r.session) {
        threadId = await p
          .request<{ thread: { id: string } }>('thread/resume', { threadId: r.session, cwd: r.cwd, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: r.system })
          .then((x) => x.thread.id)
          .catch(() => undefined)
      }
      if (!threadId) {
        const t = await p.request<{ thread: { id: string } }>('thread/start', { cwd: r.cwd, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: r.system })
        threadId = t.thread.id
        fresh = true
      }
      live.add(threadId)
      let text = ''
      let turnId: string | null = null
      const done = new Promise<void>((resolve, reject) => {
        const off = p.onNotification((method, params) => {
          if (params.threadId !== threadId) return
          if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
            text += params.delta
            r.onText(params.delta)
          } else if (method === 'item/started' && (params.item as { type?: string })?.type === 'agentMessage' && text && !text.endsWith('\n\n')) {
            text += '\n\n'
            r.onText('\n\n')
          } else if (method === 'error' && !params.willRetry) {
            off()
            reject(new Error(`Codex 出错了：${(params.error as { message?: string })?.message ?? '不知道为什么'}`))
          } else if (method === 'turn/completed') {
            off()
            const turn = params.turn as { status?: string; error?: { message?: string } | null }
            if (turn.status === 'failed') reject(new Error(`Codex 没答完：${turn.error?.message ?? ''}`))
            else resolve()
          }
        })
        void p.exited.then(() => {
          off()
          reject(new Error(`Codex 退出了：${p.lastError.split('\n').slice(-2).join(' ')}`))
        })
      })
      const stop = () => turnId && void p.request('turn/interrupt', { threadId, turnId }).catch(() => undefined)
      r.signal.addEventListener('abort', stop)
      try {
        const input: unknown[] = [{ type: 'text', text: withHistory(r, fresh), text_elements: [] }, ...(r.images ?? []).map((i) => ({ type: 'localImage', path: i.path }))]
        const t = await p.request<{ turn: { id: string } }>('turn/start', { threadId, input })
        turnId = t.turn.id
        if (r.signal.aborted) stop()
        await done
      } finally {
        r.signal.removeEventListener('abort', stop)
      }
      if (r.signal.aborted) throw aborted()
      return { text: text.trim(), session: threadId }
    },
  }
}

// ---------------------------------------------------------------- ACP（Gemini、OpenCode）

interface AcpOptions {
  id: 'gemini' | 'opencode'
  /** 开进程前先看看登录了没有；没登录返回 false，免得等它超时 */
  loggedIn?(): boolean
  /** 只在测试里给（假的 ACP 程序） */
  command?: string
  args(cwd: string): string[]
  env?(): Record<string, string>
  /** 会话开不了时的说法（多半是没登录） */
  loginHint: string
}

export function acpEngine(o: AcpOptions): Engine {
  let proc: RpcProcess | null = null
  let ready: Promise<RpcProcess> | null = null
  const live = new Set<string>()
  /** 每个会话现在这一轮把字交给谁 */
  const sinks = new Map<string, (delta: string) => void>()

  async function ensure(cwd: string): Promise<RpcProcess> {
    if (proc && !proc.closed) return proc
    if (ready && !proc?.closed) return ready
    live.clear()
    ready = (async () => {
      const p = new RpcProcess(o.command ?? need(o.id), o.args(cwd), { cwd, env: cliEnv(o.env?.() ?? {}) })
      p.onNotification((method, params) => {
        if (method !== 'session/update') return
        const u = params.update as { sessionUpdate?: string; content?: { type?: string; text?: string } }
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && u.content.text) sinks.get(String(params.sessionId))?.(u.content.text)
      })
      p.onRequest(async (method, params) => {
        if (method !== 'session/request_permission') throw new Error(`不支持 ${method}`)
        const call = params.toolCall as { title?: string; kind?: string; rawInput?: unknown } | undefined
        const options = (params.options ?? []) as { optionId: string; kind: string }[]
        // 只放行我们的工具；AI 自己改文件、跑命令一律拒绝
        const ours = /canvas|board_|web_|doc_|note_read|notes_list/.test(`${call?.title ?? ''}`)
        const pick = options.find((x) => x.kind === (ours ? 'allow_once' : 'reject_once')) ?? options.find((x) => x.kind.startsWith(ours ? 'allow' : 'reject'))
        return pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } }
      })
      await p.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: APP.name, version: APP.version },
      })
      proc = p
      void p.exited.then(() => (ready = null))
      return p
    })().catch((e) => {
      ready = null
      throw e
    })
    return ready
  }

  return {
    id: o.id,
    label: LABELS[o.id],
    dispose: () => proc?.close(),
    async run(r) {
      if (o.loggedIn && !o.loggedIn()) throw new Error(o.loginHint)
      const p = await ensure(r.cwd)
      let sessionId = r.session && live.has(r.session) ? r.session : undefined
      const fresh = !sessionId
      if (!sessionId) {
        const mcpServers = r.mcp ? [{ type: 'http', name: MCP_NAME, url: r.mcp.url, headers: [{ name: 'Authorization', value: `Bearer ${r.mcp.token}` }] }] : []
        try {
          sessionId = (await p.request<{ sessionId: string }>('session/new', { cwd: r.cwd, mcpServers }, 120_000)).sessionId
        } catch (e) {
          const msg = String((e as Error).message)
          throw new Error(/auth|key|login|credential|登录/i.test(msg) ? `${o.loginHint}（${msg}）` : msg)
        }
        live.add(sessionId)
      }
      let text = ''
      sinks.set(sessionId, (d) => {
        text += d
        r.onText(d)
      })
      const stop = () => p.notify('session/cancel', { sessionId })
      r.signal.addEventListener('abort', stop)
      try {
        // ACP 没有单独的系统提示，开新会话时放在第一段话前面
        const prompt = fresh ? `${r.system}\n\n---\n\n${withHistory(r, true)}` : r.prompt
        const images = (r.images ?? []).map((i) => ({ type: 'image', mimeType: i.mime, data: i.data }))
        const res = await p.request<{ stopReason?: string }>('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }, ...images] }, 0)
        if (res.stopReason === 'refusal') throw new Error(`${LABELS[o.id]} 拒绝回答`)
      } finally {
        r.signal.removeEventListener('abort', stop)
        sinks.delete(sessionId)
      }
      if (r.signal.aborted) throw aborted()
      return { text: text.trim(), session: sessionId }
    },
  }
}

export const geminiEngine = () =>
  acpEngine({
    id: 'gemini',
    // 只接我们的 MCP；AI 想改文件、跑命令会来问，我们拒绝
    args: () => ['--acp', '--approval-mode', 'default', '--allowed-mcp-server-names', MCP_NAME],
    loginHint: 'Gemini 还没登录：在终端里运行一次 gemini，选「Log in with Google」，或者设好 GEMINI_API_KEY',
    // 没登录时 gemini --acp 要等一分钟才报错，先看有没有登录凭据
    loggedIn: () => {
      const env = process.env
      if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_USE_VERTEXAI || env.GOOGLE_CLOUD_PROJECT) return true
      const dir = join(env.HOME || homedir(), '.gemini')
      if (existsSync(join(dir, 'oauth_creds.json'))) return true
      try {
        const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { security?: { auth?: { selectedType?: string } }; selectedAuthType?: string }
        return !!(settings.security?.auth?.selectedType || settings.selectedAuthType)
      } catch {
        return false
      }
    },
  })

export const opencodeEngine = () =>
  acpEngine({
    id: 'opencode',
    args: (cwd) => ['acp', '--cwd', cwd],
    // OpenCode 自己改文件、跑命令一律不许，改笔记走我们的工具
    env: () => ({ OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { edit: 'deny', bash: 'deny' } }) }),
    loginHint: 'OpenCode 还没登录：在终端里运行 opencode auth login',
  })
