// Claude Code 引擎接我们的 MCP 服务（引擎在共用包 @cn/ai-engines，MCP 服务在画布笔记 main/agent/mcp-server.ts）：ACP、Codex 的在 packages/ai-engines/test/engines.test.ts
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CLAUDE_MODEL, claudeArgs, claudeEngine, claudeImageMessage, type EngineImage, type EngineStep } from '@cn/ai-engines'
import { type McpServer, startMcpServer } from '../src/main/agent/mcp-server'

const cwd = mkdtempSync(join(tmpdir(), 'cn-engine-'))
afterAll(() => rmSync(cwd, { recursive: true, force: true }))

const fixture = (name: string) => join(__dirname, 'fixtures', name)

describe('Claude Code 引擎（claude -p 命令行）', () => {
  let server: McpServer
  const calls: string[] = []
  beforeAll(async () => {
    server = await startMcpServer(
      {
        tools: () => [{ name: 'board_list', description: '列卡片', inputSchema: { type: 'object' } }],
        call: async (name) => {
          calls.push(name)
          return { text: '两张卡片' }
        },
      },
      { name: 'test', version: '0' },
    )
  })
  afterAll(() => server.close())

  const claude = (env: Record<string, string> = {}) => {
    const e = claudeEngine(process.execPath, [fixture('fake-claude.mjs')])
    return {
      async run(o: { session?: string; history?: string; tools?: boolean; prompt?: string; signal?: AbortSignal; images?: EngineImage[]; keepSession?: boolean; effort?: string; appendSystem?: boolean; fork?: boolean; omni?: boolean; onStep?(s: EngineStep): void } = {}) {
        const saved = { ...process.env }
        Object.assign(process.env, env)
        const deltas: string[] = []
        try {
          const r = await e.run({
            prompt: o.prompt ?? '用户说：\n你好',
            system: '系统提示：做个好助手',
            cwd,
            mcp: o.tools === false ? undefined : { url: server.url, token: server.token, tools: ['board_list', 'board_add_card'] },
            session: o.session,
            history: o.history,
            images: o.images,
            keepSession: o.keepSession,
            effort: o.effort,
            appendSystem: o.appendSystem,
            fork: o.fork,
            omni: o.omni,
            onStep: o.onStep,
            signal: o.signal ?? new AbortController().signal,
            onText: (d) => deltas.push(d),
          })
          return { ...r, deltas }
        } finally {
          for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]
        }
      },
    }
  }
  const configDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith('cn-claude-'))

  it('字一小段一小段给；真去调了我们的 MCP（令牌在只有自己能读的临时文件里，跑完就删）；只放行我们的工具，自带的写文件、跑命令都禁掉', async () => {
    const before = configDirs()
    const r = await claude().run()
    expect(r.deltas.slice(0, 2)).toEqual(['我先', '看看。'])
    // 调完工具另起一段
    expect(r.deltas[2]).toBe('\n\n')
    expect(calls).toEqual(['board_list'])
    expect(r.text).toContain('我先看看。\n\n工具 Read,Glob,Grep；放行 mcp__canvas__board_list,mcp__canvas__board_add_card；调工具 两张卡片；配置文件 600；轮数 40；')
    expect(r.text).toContain('禁止 Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task；权限 dontAsk；设置 不读；只接我们的 MCP 是；接着聊 否；系统提示 系统提示：做个好助手；话 用户说：/你好；')
    // 用的是边生成边给的字，不是结果里那份
    expect(r.text).not.toContain('结果里的全文')
    expect(r.session).toBe('c-new')
    expect(configDirs()).toEqual(before)
  })

  it('第二轮带上会话号接着聊，不再补之前的对话', async () => {
    const r = await claude().run({ session: 'c-new', history: '之前聊过的：……' })
    expect(r.text).toContain('接着聊 c-new；')
    expect(r.text).toContain('话 用户说：/你好；')
    expect(r.session).toBe('c-new')
  })

  it('会话找不到了（清过 ~/.claude）：从头开一个，把最近几轮补在前面', async () => {
    const r = await claude().run({ session: 'gone', history: '之前聊过的：订机票' })
    expect(r.text).toContain('接着聊 否；')
    expect(r.text).toContain('话 之前聊过的：订机票//用户说：/你好；')
    expect(r.session).toBe('c-new')
  })

  it('只聊天（/ 命令、梦游）：一个工具都不给，只答一次，不留会话记录', async () => {
    const r = await claude().run({ tools: false })
    expect(r.text).toContain('工具「」；轮数 1；不留记录 是；')
    expect(r.text).toContain('禁止 Bash,')
    const args = claudeArgs({ system: 's' })
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--allowedTools')
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', CLAUDE_MODEL])
    expect(args.slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose'])
    expect(args).toContain('--include-partial-messages')
    // 翻译这类快活换便宜的模型（askFast 给 model）
    const fast = claudeArgs({ system: 's', model: 'haiku' })
    expect(fast.slice(fast.indexOf('--model'), fast.indexOf('--model') + 2)).toEqual(['--model', 'haiku'])
    // 没给 effort 不传（梦游、小活这些用命令行自己的默认档）
    expect(args).not.toContain('--effort')
  })

  it('CN-89 读 PDF 讲解：留 Claude Code 自己的系统提示，读 PDF 那几条用 --append-system-prompt 附在后面；读用户自己的设置（带上 CLAUDE.md）但关掉 hooks；MCP 只接我们给的', async () => {
    const args = claudeArgs({ system: '读 PDF 那几条', appendSystem: true, keepSession: true, effort: 'high' })
    const at = (f: string) => args[args.indexOf(f) + 1]
    expect(at('--append-system-prompt')).toBe('读 PDF 那几条')
    expect(args).not.toContain('--system-prompt')
    expect(at('--setting-sources')).toBe('user')
    expect(args).not.toContain('--setting-sources=')
    expect(JSON.parse(at('--settings')!)).toEqual({ disableAllHooks: true })
    expect(args).toContain('--strict-mcp-config')
    expect(at('--effort')).toBe('high')
    expect(at('--tools')).toBe('')
    expect(at('--permission-mode')).toBe('dontAsk')
    expect(args).not.toContain('--no-session-persistence')
    // AI 浮窗动手那条照旧：系统提示整个换掉、一个设置都不读
    const agent = claudeArgs({ system: '动手的', effort: 'high' })
    expect(agent[agent.indexOf('--system-prompt') + 1]).toBe('动手的')
    expect(agent).toContain('--setting-sources=')
    expect(agent).not.toContain('--append-system-prompt')
    expect(agent).not.toContain('--settings')
    // 真跑一次假的 claude：这几样一路到了命令行上
    const r = await claude().run({ tools: false, keepSession: true, appendSystem: true, effort: 'high' })
    expect(r.text).toContain('设置 读 user；只接我们的 MCP 是；')
    expect(r.text).toContain('系统提示 undefined；')
    expect(r.text).toContain('effort high；附加系统提示 系统提示：做个好助手；额外设置 {"disableAllHooks":true}；')
  })

  it('旁支（fork）：--resume 主对话的会话再加 --fork-session，拿回新的会话号、不补那一轮；主对话的会话没了就开新会话、把那一轮补在前面', async () => {
    const r = await claude().run({ tools: false, keepSession: true, session: 'main-1', fork: true, history: '【那一轮】' })
    expect(r.session).toBe('main-1-fork')
    expect(r.text).toContain('接着聊 main-1；')
    expect(r.text).toContain('分叉 是；')
    expect(r.text).not.toContain('【那一轮】')
    const gone = await claude().run({ tools: false, keepSession: true, session: 'gone', fork: true, history: '【那一轮】' })
    expect(gone.session).toBe('c-new')
    expect(gone.text).toContain('分叉 否；')
    expect(gone.text).toContain('话 【那一轮】//用户说：/你好；')
    expect(claudeArgs({ system: 's', fork: true }, 'x')).toEqual(expect.arrayContaining(['--resume', 'x', '--fork-session']))
    // 没有会话就没有可分叉的
    expect(claudeArgs({ system: 's', fork: true })).not.toContain('--fork-session')
  })

  it('CN-91：这一问的 effort 传 --effort', async () => {
    const args = claudeArgs({ system: 's', effort: 'xhigh' })
    expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual(['--effort', 'xhigh'])
    const r = await claude().run({ tools: false, effort: 'max' })
    expect(r.text).toContain('effort max；')
    expect((await claude().run({ tools: false })).text).toContain('effort 没给；')
  })

  it('让 Claude 帮我找：只给只读的 Read、Glob、Grep，不接 MCP、不留会话，每调一次工具报一声', async () => {
    const tools: [string, Record<string, unknown>][] = []
    const exe = process.execPath
    const r = await claudeEngine(exe, [join(__dirname, 'fixtures/fake-claude.mjs')]).run({
      prompt: '找矩阵',
      system: 's',
      cwd: tmpdir(),
      readOnly: true,
      signal: new AbortController().signal,
      onText: () => undefined,
      onTool: (n, i) => tools.push([n, i]),
    })
    expect(tools.map((t) => t[0])).toEqual(['Grep', 'Read'])
    expect(tools[0]![1]).toEqual({ pattern: '矩阵' })
    expect(r.text).toContain('放行 Read,Glob,Grep；工具「Read,Glob,Grep」；轮数 30；不留记录 是；')
    expect(r.text).toContain('禁止 Bash,Edit,Write')
    const args = claudeArgs({ system: 's', readOnly: true })
    expect(args).not.toContain('--mcp-config')
  })

  it('读 PDF 框的那块：话和图一起作为 stream-json 的一条用户消息给；不给工具也留着会话好追问', async () => {
    const png = Buffer.from('fake-png').toString('base64')
    const r = await claude().run({ tools: false, keepSession: true, prompt: '给我讲解一下', images: [{ mime: 'image/png', data: png, path: '/tmp/x.png' }] })
    expect(r.text).toContain('不留记录 否；')
    expect(r.text).toContain(`话 给我讲解一下【图 image/png:${png.length}】；`)
    expect(claudeArgs({ system: 's', images: [{ mime: 'image/png', data: png, path: '/x' }] })).toContain('--input-format')
    expect(claudeArgs({ system: 's' })).not.toContain('--input-format')
    expect(JSON.parse(claudeImageMessage('问', [{ mime: 'image/png', data: 'AAA', path: '/x' }]))).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '问' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }] },
      parent_tool_use_id: null,
    })
  })

  it('没有边生成边给的字时，把结果整段给出去', async () => {
    const r = await claude({ FAKE_CLAUDE_NO_PARTIAL: '1' }).run()
    expect(r.deltas).toEqual(['整段给的回答'])
    expect(r.text).toBe('整段给的回答')
  })

  it('没登录：把 claude 说的原因带出来', async () => {
    await expect(claude({ FAKE_CLAUDE_NOT_LOGGED_IN: '1' }).run()).rejects.toThrow('Claude Code 没答完：Not logged in · Please run /login')
  })

  it('停下：claude 进程被关掉，这一轮算停下了', async () => {
    const pidfile = join(cwd, 'claude.pid')
    const ac = new AbortController()
    const p = claude({ FAKE_CLAUDE_PIDFILE: pidfile }).run({ prompt: '用户说：\n等着', signal: ac.signal })
    // 文件建好了、进程号还没写进去时读到的是空的（Number('') 是 0，kill(0, 0) 是发给自己这一组进程，下面就不抛了）：读到进程号才算
    const pid = await new Promise<number>((resolve) => {
      const t = setInterval(() => {
        let n = 0
        try {
          n = Number(readFileSync(pidfile, 'utf8'))
        } catch {
          // 还没起来
        }
        if (n > 0) {
          clearInterval(t)
          resolve(n)
        }
      }, 20)
    })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('全能模式（AI 对话）：bypassPermissions 不停下来问，自带工具全给（只拿掉问人的 AskUserQuestion），系统提示附在 Claude Code 自己的后面，一个用户设置都不读，MCP 只接我们的，不限轮数', async () => {
    const args = claudeArgs({ system: '动手的', omni: true, mcp: { url: 'http://x/mcp', token: 't', tools: ['notes_list'] } }, undefined, '/tmp/m.json')
    const at = (f: string) => args[args.indexOf(f) + 1]
    expect(at('--permission-mode')).toBe('bypassPermissions')
    expect(at('--append-system-prompt')).toBe('动手的')
    expect(args).not.toContain('--system-prompt')
    expect(args).toContain('--setting-sources=')
    expect(args).not.toContain('--settings')
    expect(args).toContain('--strict-mcp-config')
    expect(at('--mcp-config')).toBe('/tmp/m.json')
    expect(at('--disallowedTools')).toBe('AskUserQuestion')
    for (const f of ['--tools', '--allowedTools', '--max-turns', '--no-session-persistence']) expect(args).not.toContain(f)
    // 真跑一次假的 claude：这几样一路到了命令行上，我们的 MCP 照样调得到
    const r = await claude().run({ omni: true })
    expect(r.text).toContain('工具 undefined；放行 undefined；调工具 两张卡片；配置文件 600；轮数 undefined；加目录 没给；')
    expect(r.text).toContain('禁止 AskUserQuestion；权限 bypassPermissions；设置 不读；只接我们的 MCP 是；')
    expect(r.text).toContain('系统提示 undefined；')
    expect(r.text).toContain('附加系统提示 系统提示：做个好助手；')
  })

  it('全能模式（读 PDF）：照 CN-89 读用户自己的设置（CLAUDE.md）、关掉 hooks，再放开权限；全能关着的读 PDF 也接我们的 MCP（库里新建、改名、挪、删），只读翻库里', async () => {
    const mcp = { url: 'http://x/mcp', token: 't', tools: ['note_create'] }
    const omni = claudeArgs({ system: '讲解的', appendSystem: true, keepSession: true, omni: true, mcp }, undefined, '/tmp/m.json')
    const at = (a: string[], f: string) => a[a.indexOf(f) + 1]
    expect(at(omni, '--permission-mode')).toBe('bypassPermissions')
    expect(at(omni, '--append-system-prompt')).toBe('讲解的')
    expect(at(omni, '--setting-sources')).toBe('user')
    expect(JSON.parse(at(omni, '--settings')!)).toEqual({ disableAllHooks: true })
    expect(omni).toContain('--strict-mcp-config')
    expect(omni).not.toContain('--tools')
    const shut = claudeArgs({ system: '讲解的', appendSystem: true, keepSession: true, omni: false, mcp }, undefined, '/tmp/m.json')
    expect(at(shut, '--permission-mode')).toBe('dontAsk')
    expect(at(shut, '--tools')).toBe('Read,Glob,Grep')
    expect(at(shut, '--allowedTools')).toBe('mcp__canvas__note_create')
    expect(at(shut, '--disallowedTools')).toBe('Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task')
    expect(at(shut, '--setting-sources')).toBe('user')
    expect(at(shut, '--max-turns')).toBe('40')
  })

  it('全能关着（AI 对话）：照旧只给我们的工具和只读翻库里，跑命令、写文件、上网、子 Agent 都禁着，dontAsk 下读不到库外', () => {
    const args = claudeArgs({ system: '动手的', omni: false, mcp: { url: 'http://x/mcp', token: 't', tools: ['note_create', 'note_move'] } }, undefined, '/tmp/m.json')
    const at = (f: string) => args[args.indexOf(f) + 1]
    expect(at('--permission-mode')).toBe('dontAsk')
    expect(at('--system-prompt')).toBe('动手的')
    expect(args).toContain('--setting-sources=')
    expect(at('--tools')).toBe('Read,Glob,Grep')
    expect(at('--allowedTools')).toBe('mcp__canvas__note_create,mcp__canvas__note_move')
    expect(at('--disallowedTools')).toBe('Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task')
  })

  it('步骤：Claude Code 自己的工具开始、做完都报给 onStep（出错的带原因第一行）；我们 MCP 的不报（MCP 服务自己报），子 Agent 里面的那几步、找工具的 ToolSearch 不报', async () => {
    const got: EngineStep[] = []
    await claude({ FAKE_CLAUDE_STEPS: '1' }).run({ omni: true, onStep: (s) => got.push(s) })
    expect(got.map((s) => `${s.tool}:${s.status}`)).toEqual(['Bash:run', 'Bash:ok', 'Write:run', 'Write:err', 'Task:run', 'Task:ok'])
    expect(got[0]).toMatchObject({ id: 'b1', input: { command: 'ls -1 ~' } })
    expect(got[3]!.detail).toBe('EACCES: permission denied')
  })

  it('claude 起不来：报出是哪个命令', async () => {
    const e = claudeEngine('/nonexistent/claude')
    await expect(e.run({ prompt: 'x', system: 's', cwd, signal: new AbortController().signal, onText: () => undefined })).rejects.toThrow('/nonexistent/claude 启动不了')
  })
})
