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
    chunk(sid, `会话 ${sid}；`)
    chunk(sid, `MCP ${mcp.map((s) => `${s.type}:${s.name}:${s.headers[0].value.startsWith('Bearer ') ? '有令牌' : '没令牌'}`).join(',')}；`)
    chunk(sid, `我们的工具 ${ours.outcome.optionId}；它自己写文件 ${theirs.outcome.optionId}；`)
    chunk(sid, `开头是系统提示 ${prompt.startsWith('系统') ? '是' : '否'}`)
    const imgs = m.params.prompt.filter((b) => b.type === 'image')
    if (imgs.length) chunk(sid, `；图 ${imgs.map((b) => `${b.mimeType}:${b.data}`).join(',')}`)
    if (process.env.FAKE_ACP_ECHO) chunk(sid, `；话 ${prompt.replace(/\n/g, '/')}`)
    return send({ id: m.id, result: { stopReason: 'end_turn' } })
  }
})
