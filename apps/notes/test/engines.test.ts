import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { acpEngine, CLAUDE_MODEL, claudeArgs, claudeEngine, codexEngine, type Engine } from '../src/main/agent/engines'
import { type McpServer, startMcpServer } from '../src/main/agent/mcp-server'

const cwd = mkdtempSync(join(tmpdir(), 'cn-engine-'))
const opened: Engine[] = []
afterAll(() => {
  for (const e of opened) e.dispose?.()
  rmSync(cwd, { recursive: true, force: true })
})

const fixture = (name: string) => join(__dirname, 'fixtures', name)
const mcp = { url: 'http://127.0.0.1:1/mcp', token: 'tok', tools: ['board_add_card'] }

async function turn(e: Engine, session?: string) {
  const deltas: string[] = []
  const r = await e.run({ prompt: '用户说：\n你好', system: '系统提示：做个好助手', cwd, mcp, session, signal: new AbortController().signal, onText: (d) => deltas.push(d) })
  return { ...r, deltas }
}

describe('ACP 引擎（Gemini、OpenCode 的接法）', () => {
  it('开会话带上我们的 MCP 和令牌，字边生成边给；我们的工具放行，它自己写文件拒绝；第二轮接着同一个会话', async () => {
    const e = acpEngine({ id: 'gemini', command: process.execPath, args: () => [fixture('fake-acp.mjs')], loginHint: '去登录' })
    opened.push(e)
    const r = await turn(e)
    expect(r.deltas.length).toBe(4)
    expect(r.text).toBe('会话 s1；MCP http:canvas:有令牌；我们的工具 a1；它自己写文件 r1；开头是系统提示 是')
    expect(r.session).toBe('s1')
    const again = await turn(e, r.session)
    expect(again.text).toContain('会话 s1；')
    expect(again.text).toContain('开头是系统提示 否')
  })

  it('没登录时说清楚怎么登录', async () => {
    const e = acpEngine({ id: 'gemini', command: process.execPath, args: () => [fixture('fake-acp.mjs')], env: () => ({ FAKE_ACP_NO_LOGIN: '1' }), loginHint: 'Gemini 还没登录：在终端里运行一次 gemini' })
    opened.push(e)
    await expect(turn(e)).rejects.toThrow('Gemini 还没登录：在终端里运行一次 gemini（Gemini API key is missing or not configured.）')
  })
})

describe('Codex 引擎（app-server）', () => {
  it('只接我们的 MCP（令牌放环境变量），只读沙箱；我们的工具放行、它自己改文件拒绝；别的线程的字不混进来', async () => {
    const e = codexEngine(process.execPath, [fixture('fake-codex.mjs')])
    opened.push(e)
    const r = await turn(e)
    expect(r.text).toBe(
      '线程 th1；配置 mcp_servers={canvas={url="http://127.0.0.1:1/mcp",bearer_token_env_var="CN_MCP_TOKEN",default_tools_approval_mode="approve"}}；令牌 在环境变量里；我们的工具 accept；它自己改文件 decline；系统提示 系统提示：做个好助手',
    )
    expect(r.deltas).not.toContain('串了')
    expect(r.session).toBe('th1')
    expect((await turn(e, 'th1')).session).toBe('th1')
  })
})

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
      async run(o: { session?: string; history?: string; tools?: boolean; prompt?: string; signal?: AbortSignal } = {}) {
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
    const pid = await new Promise<number>((resolve) => {
      const t = setInterval(() => {
        try {
          resolve(Number(readFileSync(pidfile, 'utf8')))
          clearInterval(t)
        } catch {
          // 还没起来
        }
      }, 20)
    })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('claude 起不来：报出是哪个命令', async () => {
    const e = claudeEngine('/nonexistent/claude')
    await expect(e.run({ prompt: 'x', system: 's', cwd, signal: new AbortController().signal, onText: () => undefined })).rejects.toThrow('/nonexistent/claude 启动不了')
  })
})
