import { homedir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentContext } from '../src/shared/agent'
import { summarize } from '../src/main/agent/board-ops'
import { type McpServer, startMcpServer } from '../src/main/agent/mcp-server'
import { runTool, stepLabel, type ToolHost, toolLabel, toolSpecs } from '../src/main/agent/tools'

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
    select: async () => '选了',
    check: async () => '勾上了',
    upload: async () => '选好了',
    hover: async () => '移过去了',
    press: async () => '按了',
    drag: async () => '拖了',
    scroll: async () => '滚了',
    clip: async () => '收件箱/x.md',
  },
  doc: { read: async () => ({ path: 'a.md', text: 'x', selection: '' }), insert: async () => '插好了', replaceSelection: async () => '换好了' },
  vault: {
    folders: async () => ['课程', '课程/线代'],
    create: async (folder, title) => {
      vaultCalls.push(['create', folder, title])
      return `${folder ? folder + '/' : ''}${String(title)}.md`
    },
    rename: async (path, name) => {
      vaultCalls.push(['rename', path, name])
      return String(path).endsWith('.md') ? { from: String(path), to: `${String(name)}.md`, folder: false, relinked: ['旅行.md', '计划.md'] } : { from: String(path), to: `课程/${String(name)}`, folder: true, relinked: [] }
    },
    move: async (path, folder) => {
      vaultCalls.push(['move', path, folder])
      return { from: String(path), to: `${folder ? folder + '/' : ''}${String(path).split('/').pop()}`, folder: !String(path).endsWith('.md'), relinked: ['旅行.md'] }
    },
    trash: async (path) => {
      vaultCalls.push(['trash', path])
      return String(path).endsWith('.md') ? { path: String(path), folder: false, files: 1, images: 2, kept: 1 } : { path: String(path), folder: true, files: 3, images: 0, kept: 0 }
    },
    mkdir: async (parent, name) => {
      vaultCalls.push(['mkdir', parent, name])
      return `${parent ? parent + '/' : ''}${String(name)}`
    },
  },
}
const vaultCalls: unknown[][] = []

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

const tokensSeen: string[] = []
beforeAll(async () => {
  server = await startMcpServer(
    {
      tools: toolSpecs,
      call: (n, a, token) => {
        tokensSeen.push(token)
        return runTool(n, a, host)
      },
    },
    { name: 'test', version: '0' },
  )
})
afterAll(() => server.close())

describe('MCP 服务', () => {
  it('只听 127.0.0.1，没有令牌一律 401，GET 回 405', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect((await rpc('tools/list', {}, 'wrong')).status).toBe(401)
    const get = await fetch(server.url, { headers: { authorization: `Bearer ${server.token}` } })
    expect(get.status).toBe(405)
  })

  it('每一轮再发一个令牌：带着它来的调用交给 call 时带上它（好知道是哪一轮）；收回以后 401', async () => {
    const t = server.issue()
    expect(t).not.toBe(server.token)
    tokensSeen.length = 0
    expect((await rpc('tools/call', { name: 'web_read', arguments: {} }, t)).status).toBe(200)
    expect(tokensSeen).toEqual([t])
    server.revoke(t)
    expect((await rpc('tools/list', {}, t)).status).toBe(401)
    expect((await rpc('tools/list', {})).status).toBe(200)
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
    for (const n of ['web_open', 'web_read', 'web_click', 'web_type', 'web_select', 'web_check', 'web_upload', 'web_hover', 'web_press', 'web_drag', 'web_scroll', 'web_clip', 'board_list', 'board_add_card', 'board_update_card', 'board_move', 'board_put_in_column', 'board_link', 'board_arrange', 'doc_read', 'doc_insert', 'doc_replace_selection'])
      expect(names).toContain(n)
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(5)
      expect(t.inputSchema.type).toBe('object')
    }
  })
})

describe('库里的笔记工具（全能模式关着也有）', () => {
  it('列出来：新建、改写、改名、挪动、删除、建文件夹，每个说明里写清楚冲突、出了库怎么办', async () => {
    const tools = (await rpc('tools/list', {})).body!.result!.tools as { name: string; description: string }[]
    for (const n of ['note_create', 'note_write', 'note_rename', 'note_move', 'note_delete', 'folder_create']) expect(tools.map((t) => t.name)).toContain(n)
    expect(tools.find((t) => t.name === 'note_delete')!.description).toContain('废纸篓')
  })

  it('新建、改写（整篇换 / 末尾加）、改名、挪动、删除、建文件夹都交给库操作；回给 AI 一句说清做了什么', async () => {
    notes = { '课程/周报.md': '# 周报\n\n第一段\n' }
    vaultCalls.length = 0
    expect((await call('note_create', { folder: '课程', title: '周报2', text: '正文' })).text).toBe('建好了：课程/周报2.md')
    expect((await call('note_write', { path: '课程/周报.md', text: '第二段', mode: 'append' })).text).toBe('加好了：课程/周报.md')
    expect(notes['课程/周报.md']).toBe('# 周报\n\n第一段\n\n第二段\n')
    expect((await call('note_write', { path: '课程/周报.md', text: '# 周报\n\n全换了\n' })).text).toBe('改好了：课程/周报.md')
    expect(notes['课程/周报.md']).toBe('# 周报\n\n全换了\n')
    expect((await call('note_rename', { path: '冰岛.md', name: '冰岛自驾' })).text).toBe('改好了：冰岛.md → 冰岛自驾.md；库里2篇笔记的链接跟着改了')
    expect((await call('note_move', { path: '收件箱/冰岛.md', folder: '课程' })).text).toBe('挪好了：收件箱/冰岛.md → 课程/冰岛.md；库里1篇笔记的链接跟着改了')
    expect((await call('note_delete', { path: '冰岛.md' })).text).toContain('移到了废纸篓：冰岛.md（连同2个只有它在用的附件；1个别的笔记也在用，留着）')
    expect((await call('folder_create', { parent: '课程', name: 'ecp' })).text).toBe('建好了文件夹：课程/ecp')
    expect(vaultCalls.map((c) => c[0])).toEqual(['create', 'rename', 'move', 'trash', 'mkdir'])
  })

  it('改写一篇没有的：说清楚，不建新的', async () => {
    notes = {}
    const r = await call('note_write', { path: '没有.md', text: 'x' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('没有「没有.md」')
  })

  it('notes_list 连文件夹一起列（新建、挪动前看有哪些文件夹）', async () => {
    const r = (await call('notes_list')).text
    expect(r).toContain('文件夹：\n课程/\n课程/线代/')
  })

  it('步骤行的人话（DESIGN.v3 2.3）：新建《…》、把《…》挪进「课程」、删掉《…》（在废纸篓里能找回）；文件夹用「」，不手打中西文空格', () => {
    expect(toolLabel('note_create', { folder: '课程', title: '周报' })).toBe('新建《周报》，放进「课程」')
    expect(toolLabel('note_create', { title: '周报' })).toBe('新建《周报》，放在库的最外层')
    expect(toolLabel('note_read', { path: '课程/周报.md' })).toBe('读《周报》')
    expect(toolLabel('note_write', { path: '课程/周报.md', mode: 'append' })).toBe('在《周报》末尾加一段')
    expect(toolLabel('note_write', { path: '课程/周报.md' })).toBe('改写《周报》')
    expect(toolLabel('note_rename', { path: '课程/冰岛.md', name: '冰岛自驾' })).toBe('把《冰岛》改名为《冰岛自驾》')
    expect(toolLabel('note_move', { path: '收件箱/冰岛.md', folder: '课程/' })).toBe('把《冰岛》挪进「课程」')
    expect(toolLabel('note_move', { path: '收件箱/冰岛.md', folder: '' })).toBe('把《冰岛》挪到库的最外层')
    expect(toolLabel('note_delete', { path: '冰岛.md' })).toBe('删掉《冰岛》（在废纸篓里能找回）')
    expect(toolLabel('folder_create', { parent: '课程', name: 'ecp' })).toBe('新建文件夹「课程/ecp」')
  })

  it('改名、挪动、删的是文件夹：做完步骤行换成文件夹的说法', async () => {
    const renamed = await runTool('note_rename', { path: '课程/ecp', name: '经济学' }, host)
    expect(renamed.label).toBe('把文件夹「课程/ecp」改名为「经济学」')
    const moved = await runTool('note_move', { path: '项目/旧', folder: '课程' }, host)
    expect(moved.label).toBe('把文件夹「项目/旧」挪进「课程」')
    const gone = await runTool('note_delete', { path: '项目/旧' }, host)
    expect(gone.label).toBe('删掉文件夹「项目/旧」（在废纸篓里能找回）')
    expect(gone.text).toContain('移到了废纸篓：项目/旧（文件夹，里面3个文件）')
  })
})

describe('全能模式下命令行自己的工具：步骤行的人话', () => {
  const root = '/Users/me/笔记库'
  it('跑命令、读写改文件（库里的写《标题》，别的路径和命令放进等宽那一段、家目录写 ~）、搜、上网、子 Agent；不手打中西文空格', () => {
    expect(stepLabel('Bash', { command: 'ls -1 /Users/me' }, root)).toEqual({ label: '跑命令', code: 'ls -1 /Users/me' })
    expect(stepLabel('Bash', { command: 'ls -1 ~', description: '列出主目录' }, root)).toEqual({ label: '跑命令：列出主目录' })
    expect(stepLabel('Bash', { command: 'x'.repeat(80) }, root)).toEqual({ label: '跑命令', code: 'x'.repeat(40) + '…' })
    expect(stepLabel('Read', { file_path: '/Users/me/笔记库/课程/周报.md' }, root)).toEqual({ label: '读《周报》' })
    expect(stepLabel('Write', { file_path: `${homedir()}/Desktop/a.txt` }, root)).toEqual({ label: '写', code: '~/Desktop/a.txt' })
    expect(stepLabel('Edit', { file_path: '/Users/me/笔记库/附件/x.png' }, root)).toEqual({ label: '改', code: '附件/x.png' })
    expect(stepLabel('Write', { file_path: '/private/tmp/cn/a.txt' }, root)).toEqual({ label: '写', code: '/private/tmp/cn/a.txt' })
    expect(stepLabel('Glob', { pattern: '**/*.md' }, root)).toEqual({ label: '找文件', code: '**/*.md' })
    expect(stepLabel('Grep', { pattern: '矩阵' }, root)).toEqual({ label: '搜「矩阵」' })
    expect(stepLabel('WebSearch', { query: '冰岛 极光 预报' }, root)).toEqual({ label: '上网搜「冰岛 极光 预报」' })
    expect(stepLabel('WebFetch', { url: 'https://www.vedur.is/x' }, root)).toEqual({ label: '读网页vedur.is' })
    expect(stepLabel('Task', { description: '查资料' }, root)).toEqual({ label: '开子Agent：查资料' })
    expect(stepLabel('TodoWrite', {}, root)).toEqual({ label: '列要做的几步' })
    expect(stepLabel('Mcp', { server: 'x', tool: 'y' }, root)).toEqual({ label: '用x的y' })
    expect(stepLabel('Whatever', {}, root)).toEqual({ label: '用Whatever' })
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
