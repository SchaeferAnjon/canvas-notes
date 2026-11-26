/**
 * 内置的工具循环（2026-11-25，MeetCaption 问 AI 方案 B）：没装命令行、只有 API Key 或会员的人也用同一套工具。
 * 引擎（Engine）的样子，交给画布笔记的 runAgentTurn 跑：工具从这一轮给的 MCP 服务拿（tools/list）、也交给它调（tools/call），
 * 所以工具、步骤行、一轮一提交、要点头的那几下和命令行那条路完全一样；系统提示、每条消息的话也是调的人给的同一份。
 *
 * 工具调用用字写在回答里（不靠接口的 tools 参数）：会员服务器现在会把 tools 丢掉（meetcaption-server 的 sanitize），
 * 各家 OpenAI 兼容接口对 tools 的支持也不齐。写法：单独一段 <tool>{"name":"…","args":{…}}</tool>，写完就停，结果在下一条消息里给。
 * 一问最多 maxRounds 轮（默认 6），用完了让它照已经拿到的直接答。只给我们的工具：不能跑命令、不能读写任意文件（那是命令行的全能模式）。
 *
 * 不引 Electron，也不引哪个软件的文件：怎么问模型（chat）由宿主给（MeetCaption 交它自己的 complete()，会员通道在里面）。
 */
import type { Engine, EngineImage, EngineRun } from './engines'

export interface LoopTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type LoopPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string }
export interface LoopMsg {
  role: 'user' | 'assistant'
  content: string | LoopPart[]
}

/** 问一次模型：边出字边给累计的全文（onDelta），答完给全文 */
export type LoopChat = (o: { system: string; messages: LoopMsg[]; model?: string; effort?: string; signal: AbortSignal; onDelta(full: string): void }) => Promise<string>

export interface ToolCall {
  name: string
  args: Record<string, unknown>
}

const OPEN = '<tool>'
const CLOSE = '</tool>'
/** 一个工具结果最多给多少字（读整场字幕、整篇笔记时不把上下文撑爆） */
export const RESULT_MAX = 12_000

// 不翻：给 AI 的话
/** 接在系统提示后面：有哪些工具、怎么写调用 */
export function toolProtocol(tools: LoopTool[]): string {
  const list = tools.map((t) => `- ${t.name}：${t.description}\n  参数（JSON Schema）：${JSON.stringify(t.inputSchema)}`).join('\n')
  return [
    '## 工具',
    '你能用下面这些工具。要用时，单独起一段，只写一行：',
    `${OPEN}{"name":"工具名","args":{参数}}${CLOSE}`,
    '一次可以写几行（每行一个）。写完调用就停下，不要替工具编结果；结果会在下一条消息里给你，再接着答。',
    '拿到够用的东西就直接回答用户，回答里不要再出现工具调用的写法。不用工具也能答的，直接答。',
    '',
    list,
  ].join('\n')
}

/** 一段回答里写的工具调用（写坏了的 JSON 记在 bad 里，告诉模型重写） */
export function toolCalls(text: string): { calls: ToolCall[]; bad: string[] } {
  const calls: ToolCall[] = []
  const bad: string[] = []
  let at = 0
  for (;;) {
    const i = text.indexOf(OPEN, at)
    if (i < 0) break
    const j = text.indexOf(CLOSE, i + OPEN.length)
    if (j < 0) break
    const raw = text.slice(i + OPEN.length, j).trim()
    at = j + CLOSE.length
    try {
      const o = JSON.parse(raw) as { name?: unknown; args?: unknown; arguments?: unknown }
      const args = (o.args ?? o.arguments ?? {}) as unknown
      if (typeof o.name !== 'string' || !o.name || typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('bad')
      calls.push({ name: o.name, args: args as Record<string, unknown> })
    } catch {
      bad.push(raw.slice(0, 200))
    }
  }
  return { calls, bad }
}

/**
 * 能给用户看的字：去掉写完的工具调用；末尾还没写完的那一段（<tool> 写了一半，或者末尾几个字可能是 <tool> 的开头）先不给，
 * 这样边出字边给时给出去的只会变长、不会收回
 */
export function visibleText(full: string): string {
  let out = ''
  let at = 0
  for (;;) {
    const i = full.indexOf(OPEN, at)
    if (i < 0) {
      out += full.slice(at)
      break
    }
    out += full.slice(at, i)
    const j = full.indexOf(CLOSE, i + OPEN.length)
    if (j < 0) return tidy(out)
    at = j + CLOSE.length
  }
  // 末尾可能是 <tool> 的前几个字
  for (let k = Math.min(OPEN.length - 1, out.length); k > 0; k--) {
    if (OPEN.startsWith(out.slice(-k))) return tidy(out.slice(0, -k))
  }
  return tidy(out)
}

const tidy = (s: string) => s.replace(/\n{3,}/g, '\n\n')

const cut = (s: string) => (s.length > RESULT_MAX ? `${s.slice(0, RESULT_MAX)}\n…（太长，后面省掉了 ${s.length - RESULT_MAX} 字；要看后面就换个参数再取）` : s)

const aborted = () => Object.assign(new Error('停下了'), { name: 'AbortError' })

export interface LoopRun {
  chat: LoopChat
  system: string
  prompt: string
  history?: string
  images?: EngineImage[]
  tools: LoopTool[]
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }>
  model?: string
  effort?: string
  signal: AbortSignal
  onText(delta: string): void
  maxRounds?: number
}

/** 跑一问：问模型 → 写了工具调用就调、结果送回去 → 再问，直到它直接答（或轮数用完）。返回给用户看的全文 */
export async function runToolLoop(o: LoopRun): Promise<string> {
  const system = o.tools.length ? `${o.system}\n\n${toolProtocol(o.tools)}` : o.system
  const first = o.history ? `${o.history}\n\n${o.prompt}` : o.prompt
  const messages: LoopMsg[] = [
    { role: 'user', content: o.images?.length ? [{ type: 'text', text: first }, ...o.images.map((im) => ({ type: 'image' as const, dataUrl: `data:${im.mime};base64,${im.data}` }))] : first },
  ]
  const max = o.maxRounds ?? 6
  /** 前几轮已经给用户看的字（每轮之间空一行） */
  let shown = ''
  for (let round = 0; ; round++) {
    if (o.signal.aborted) throw aborted()
    const last = round >= max
    let given = 0
    const lead = shown ? '\n\n' : ''
    const emit = (full: string) => {
      const vis = visibleText(full).replace(/^\s+/, '')
      if (vis.length <= given) return
      o.onText((given === 0 ? lead : '') + vis.slice(given))
      given = vis.length
    }
    const raw = await o.chat({ system, messages, ...(o.model ? { model: o.model } : {}), ...(o.effort ? { effort: o.effort } : {}), signal: o.signal, onDelta: emit })
    if (o.signal.aborted) throw aborted()
    emit(raw)
    const vis = visibleText(raw).trim()
    if (vis) shown += (shown ? '\n\n' : '') + vis
    const { calls, bad } = last ? { calls: [], bad: [] } : toolCalls(raw)
    if (!calls.length && !bad.length) return shown
    messages.push({ role: 'assistant', content: raw })
    const results: string[] = []
    for (const c of calls) {
      if (o.signal.aborted) throw aborted()
      if (!o.tools.some((t) => t.name === c.name)) {
        results.push(`<result name="${c.name}" error="true">没有叫 ${c.name} 的工具</result>`)
        continue
      }
      const r = await o.call(c.name, c.args).catch((e: unknown) => ({ text: String((e as Error)?.message ?? e), isError: true }))
      results.push(`<result name="${c.name}"${r.isError ? ' error="true"' : ''}>\n${cut(r.text)}\n</result>`)
    }
    for (const b of bad) results.push(`<result error="true">这一行没认出来（要写成 ${OPEN}{"name":"…","args":{…}}${CLOSE}）：${b}</result>`)
    // 不翻：给 AI 的话
    const next = round + 1 >= max ? '工具的次数用完了：照上面已经拿到的直接回答用户，不要再写工具调用。' : '接着答：还要查就再写工具调用，够了就直接回答用户。'
    messages.push({ role: 'user', content: `${results.join('\n\n')}\n\n${next}` })
  }
}

// ---------------------------------------------------------------- 经这一轮的 MCP 服务拿工具、调工具

async function rpc(url: string, token: string, method: string, params: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
  })
  if (!res.ok) throw new Error(`MCP ${method} 回了 ${res.status}`)
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (body.error) throw new Error(body.error.message)
  return body.result ?? {}
}

export async function mcpTools(mcp: NonNullable<EngineRun['mcp']>, signal: AbortSignal): Promise<LoopTool[]> {
  const r = await rpc(mcp.url, mcp.token, 'tools/list', {}, signal)
  const all = (r.tools ?? []) as LoopTool[]
  return all.filter((t) => mcp.tools.includes(t.name))
}

export async function mcpCall(mcp: NonNullable<EngineRun['mcp']>, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ text: string; isError?: boolean }> {
  const r = await rpc(mcp.url, mcp.token, 'tools/call', { name, arguments: args }, signal)
  const text = ((r.content ?? []) as { type?: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
  return { text, ...(r.isError ? { isError: true } : {}) }
}

/**
 * 内置工具循环当一个引擎：给了 mcp 就用这一轮的工具，没给只聊天。没有会话号（每问把最近几轮放在前面，调的人给 history）
 */
export function loopEngine(o: { id: string; label: string; chat: LoopChat; maxRounds?: number }): Engine {
  return {
    id: o.id as Engine['id'],
    label: o.label,
    async run(r) {
      const tools = r.mcp ? await mcpTools(r.mcp, r.signal) : []
      const text = await runToolLoop({
        chat: o.chat,
        system: r.system,
        prompt: r.prompt,
        ...(r.history ? { history: r.history } : {}),
        ...(r.images?.length ? { images: r.images } : {}),
        tools,
        call: (name, args) => mcpCall(r.mcp!, name, args, r.signal),
        ...(r.model ? { model: r.model } : {}),
        ...(r.effort ? { effort: r.effort } : {}),
        signal: r.signal,
        onText: r.onText,
        ...(o.maxRounds ? { maxRounds: o.maxRounds } : {}),
      })
      return { text: text.trim() }
    },
  }
}
