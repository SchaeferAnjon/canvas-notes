// 假的 codex app-server：测引擎接法用，不联网。消息不带 "jsonrpc"，和真的一样
import { createInterface } from 'node:readline'

let id = 1000
const waiting = new Map()
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
const ask = (method, params) =>
  new Promise((resolve) => {
    const i = ++id
    waiting.set(i, resolve)
    send({ id: i, method, params })
  })
const args = process.argv.slice(2)
let threads = 0
let instructions = ''

createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.jsonrpc) return send({ id: m.id, error: { code: -1, message: '不该带 jsonrpc' } })
  if (m.id !== undefined && !m.method) return waiting.get(m.id)?.(m.result)
  if (m.method === 'initialize') return send({ id: m.id, result: { userAgent: 'fake' } })
  if (m.method === 'initialized') return
  if (m.method === 'thread/start') {
    instructions = m.params.developerInstructions
    return send({ id: m.id, result: { thread: { id: `th${++threads}` }, sandbox: m.params.sandbox } })
  }
  if (m.method === 'turn/start') {
    const threadId = m.params.threadId
    send({ id: m.id, result: { turn: { id: 'u1' } } })
    const delta = (d) => send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'u1', itemId: 'i1', delta: d } })
    const mcp = await ask('mcpServer/elicitation/request', { threadId, turnId: 'u1', serverName: 'canvas', mode: 'form', message: '可以调吗', requestedSchema: {} })
    const patch = await ask('item/fileChange/requestApproval', { threadId, turnId: 'u1', itemId: 'p1' })
    delta(`线程 ${threadId}；`)
    delta(`配置 ${args.filter((a) => a.startsWith('mcp_servers')).join(' ')}；`)
    delta(`令牌 ${process.env.CN_MCP_TOKEN ? '在环境变量里' : '没有'}；`)
    delta(`我们的工具 ${mcp.action}；它自己改文件 ${patch.decision}；`)
    delta(`系统提示 ${instructions}`)
    // 别的线程的字不该混进来
    send({ method: 'item/agentMessage/delta', params: { threadId: 'other', turnId: 'x', itemId: 'x', delta: '串了' } })
    send({ method: 'turn/completed', params: { threadId, turn: { id: 'u1', status: 'completed' } } })
  }
})
