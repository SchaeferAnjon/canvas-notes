// 假的 ACP 程序（像 gemini --acp / opencode acp）：测引擎接法用，不联网
import { createInterface } from 'node:readline'

let id = 1000
const waiting = new Map()
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
const ask = (method, params) =>
  new Promise((resolve) => {
    const i = ++id
    waiting.set(i, resolve)
    send({ id: i, method, params })
  })
const chunk = (sessionId, text) => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } })
const options = [
  { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
  { optionId: 'a2', name: 'Always', kind: 'allow_always' },
  { optionId: 'r1', name: 'Reject', kind: 'reject_once' },
]
let mcp = []
let sessions = 0

createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.id !== undefined && !m.method) return waiting.get(m.id)?.(m.result)
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } } } })
  if (m.method === 'session/new') {
    mcp = m.params.mcpServers
    if (process.env.FAKE_ACP_NO_LOGIN) return send({ id: m.id, error: { code: -32000, message: 'Gemini API key is missing or not configured.' } })
    return send({ id: m.id, result: { sessionId: `s${++sessions}` } })
  }
  if (m.method === 'session/prompt') {
    const sid = m.params.sessionId
    const prompt = m.params.prompt[0].text
    const ours = await ask('session/request_permission', { sessionId: sid, toolCall: { toolCallId: 't1', title: 'board_add_card (canvas MCP Server)' }, options })
    const theirs = await ask('session/request_permission', { sessionId: sid, toolCall: { toolCallId: 't2', title: 'WriteFile 笔记.md', kind: 'edit' }, options })
    // 全能模式的步骤（FAKE_ACP_STEPS=1）：跑命令（做完）、读文件（失败）、调我们的 MCP（不该报成步骤）
    if (process.env.FAKE_ACP_STEPS) {
      const up = (update) => send({ method: 'session/update', params: { sessionId: sid, update } })
      up({ sessionUpdate: 'tool_call', toolCallId: 'x1', title: 'ls -1 /Users', kind: 'execute', status: 'pending', rawInput: { command: 'ls -1 /Users' } })
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'x1', status: 'completed' })
      up({ sessionUpdate: 'tool_call', toolCallId: 'x2', title: 'ReadFile', kind: 'read', status: 'in_progress', locations: [{ path: '/etc/hosts' }] })
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'x2', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: '读不了' } }] })
      up({ sessionUpdate: 'tool_call', toolCallId: 'x3', title: 'notes_list (canvas MCP Server)', kind: 'other', status: 'pending' })
      up({ sessionUpdate: 'tool_call_update', toolCallId: 'x3', status: 'completed' })
    }
    chunk(sid, `会话 ${sid}；`)
    chunk(sid, `MCP ${mcp.map((s) => `${s.type}:${s.name}:${s.headers[0].value.startsWith('Bearer ') ? '有令牌' : '没令牌'}`).join(',')}；`)
    chunk(sid, `我们的工具 ${ours.outcome.optionId}；它自己写文件 ${theirs.outcome.optionId}；`)
    chunk(sid, `开头是系统提示 ${prompt.startsWith('系统') ? '是' : '否'}`)
    if (process.env.FAKE_ACP_ARGS) chunk(sid, `；参数 ${process.argv.slice(2).join(' ')}；设置 ${process.env.OPENCODE_CONFIG_CONTENT ?? '没给'}`)
    const imgs = m.params.prompt.filter((b) => b.type === 'image')
    if (imgs.length) chunk(sid, `；图 ${imgs.map((b) => `${b.mimeType}:${b.data}`).join(',')}`)
    if (process.env.FAKE_ACP_ECHO) chunk(sid, `；话 ${prompt.replace(/\n/g, '/')}`)
    return send({ id: m.id, result: { stopReason: 'end_turn' } })
  }
})
