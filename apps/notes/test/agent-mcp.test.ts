import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentContext } from '../src/shared/agent'
import { summarize } from '../src/main/agent/board-ops'
import { type McpServer, startMcpServer } from '../src/main/agent/mcp-server'
import { runTool, type ToolHost, toolSpecs } from '../src/main/agent/tools'

const BOARD = '---\ntype: board\n---\n<!-- card id=a x=100 y=100 w=280 -->\n已有的\n'

let notes: Record<string, string>
let ctx: AgentContext
const edits: string[] = []

const host: ToolHost = {
  context: async () => ctx,
  listNotes: async () => [],
  readNote: async (p) => notes[p]!,
  async editNote(p, change) {
    notes[p] = change(notes[p]!)
    edits.push(p)
  },
  measure: async () => ({}),
  web: {
    open: async (url) => ({ url, title: '标题' }),
    read: async () => ({ url: 'https://x.test/', title: '网页', text: '正文', items: [{ ref: 1, kind: 'link', text: '下一页', href: 'https://x.test/2' }], selection: '' }),
    click: async () => '点了',
    type: async () => '输入好了',
    scroll: async () => '滚了',
    clip: async () => '收件箱/x.md',
  },
  doc: { read: async () => ({ path: 'a.md', text: 'x', selection: '' }), insert: async () => '插好了', replaceSelection: async () => '换好了' },
}

let server: McpServer

async function rpc(method: string, params: unknown, token = server.token) {
  const res = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as { result?: Record<string, unknown>; error?: { message: string } }) : null, headers: res.headers }
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await rpc('tools/call', { name, arguments: args })
  const res = r.body!.result as { content: { text: string }[]; isError: boolean }
  return { text: res.content[0]!.text, isError: res.isError }
}

beforeAll(async () => {
  server = await startMcpServer({ tools: toolSpecs, call: (n, a) => runTool(n, a, host) }, { name: 'test', version: '0' })
})
afterAll(() => server.close())

describe('MCP 服务', () => {
  it('只听 127.0.0.1，没有令牌一律 401，GET 回 405', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect((await rpc('tools/list', {}, 'wrong')).status).toBe(401)
    const get = await fetch(server.url, { headers: { authorization: `Bearer ${server.token}` } })
    expect(get.status).toBe(405)
  })

  it('initialize 回协议版本和会话号；通知回 202', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    expect(r.body!.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} } })
    expect(r.headers.get('mcp-session-id')).toBeTruthy()
    const n = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    expect(n.status).toBe(202)
  })

  it('列出网页、白板、文档三组工具，每个都有说明和参数格式', async () => {
    const tools = (await rpc('tools/list', {})).body!.result!.tools as { name: string; description: string; inputSchema: { type: string } }[]
    const names = tools.map((t) => t.name)
    for (const n of ['web_open', 'web_read', 'web_click', 'web_type', 'web_scroll', 'web_clip', 'board_list', 'board_add_card', 'board_update_card', 'board_move', 'board_put_in_column', 'board_link', 'board_arrange', 'doc_read', 'doc_insert', 'doc_replace_selection'])
      expect(names).toContain(n)
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(5)
      expect(t.inputSchema.type).toBe('object')
    }
  })
})

describe('工具', () => {
  it('当前标签是白板：加卡片、排整齐都改到这块白板上', async () => {
    notes = { '旅行.md': BOARD }
    ctx = { tab: { type: 'note', title: '旅行', path: '旅行.md', mode: 'board', board: true }, web: { open: false, url: null } }
    expect((await call('board_add_card', { text: '订机票' })).text).toMatch(/^加好了，卡片 id=\w+$/)
    await call('board_add_card', { text: '订租车' })
    expect(summarize(notes['旅行.md']!).cards.map((c) => c.text)).toEqual(['已有的', '订机票', '订租车'])
    expect((await call('board_arrange', { mode: 'grid' })).text).toBe('排好了')
    const cards = summarize(notes['旅行.md']!).cards
    // 三张：一行两张，第二行一张，都和第一张左对齐或顶对齐
    expect(cards[0]).toMatchObject({ x: 100, y: 100 })
    expect(cards[1]).toMatchObject({ x: 100 + 280 + 24, y: 100 })
    expect(cards[2]!.x).toBe(100)
    const listed = JSON.parse((await call('board_list')).text) as { path: string; cards: unknown[] }
    expect(listed.path).toBe('旅行.md')
    expect(listed.cards).toHaveLength(3)
  })

  it('当前不是白板：说清楚为什么做不了，不改任何文件', async () => {
    ctx = { tab: { type: 'home', title: '首页' }, web: { open: false, url: null } }
    const n = edits.length
    const r = await call('board_add_card', { text: 'x' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('现在打开的不是白板')
    expect(edits.length).toBe(n)
  })

  it('参数不对时报错；网页工具把能点的东西带编号列出来', async () => {
    expect((await call('board_update_card', { id: 'a', path: '旅行.md' })).text).toContain('缺参数 text')
    const page = (await call('web_read')).text
    expect(page).toContain('标题：网页')
    expect(page).toContain('[1] 链接 下一页 → https://x.test/2')
    expect((await rpc('tools/call', { name: 'nope', arguments: {} })).body!.error!.message).toContain('没有叫 nope')
  })
})
