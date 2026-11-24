// 假的 claude 命令行（claude -p --output-format stream-json）：测引擎接法用，不联网。
// 话从标准输入读，一行一个 JSON 事件写到标准输出，和真的一样；--mcp-config 给了就真去调一次 MCP 服务的 board_list。
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}
const has = (name) => argv.includes(name)
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n')

let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (prompt += d))
process.stdin.on('end', () => void main())

async function main() {
  // e2e 看软件真的给了哪些参数（像 ps 看子进程）：一次一行
  if (process.env.FAKE_CLAUDE_ARGV) appendFileSync(process.env.FAKE_CLAUDE_ARGV, JSON.stringify(argv) + '\n')
  // 带图时话是 stream-json 的一条用户消息：取出文字，图记个数和类型
  if (flag('--input-format') === 'stream-json') {
    const msg = JSON.parse(prompt.trim())
    const blocks = msg.message.content
    prompt = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('') + `【图 ${blocks.filter((b) => b.type === 'image').map((b) => `${b.source.media_type}:${b.source.data.length}`).join(',')}】`
  }
  const resume = flag('--resume')
  if (resume === 'gone') {
    process.stderr.write(`No conversation found with session ID: ${resume}\n`)
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: resume })
    process.exit(1)
  }
  if (process.env.FAKE_CLAUDE_NOT_LOGGED_IN) {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', session_id: 'x' })
    process.exit(1)
  }
  // --fork-session：从 resume 那个会话分叉，另起一个会话号
  const session = resume ? (has('--fork-session') ? `${resume}-fork` : resume) : 'c-new'
  out({ type: 'system', subtype: 'init', session_id: session, tools: (flag('--tools') ?? '').split(',').filter(Boolean) })
  if (prompt.includes('等着')) {
    if (process.env.FAKE_CLAUDE_PIDFILE) writeFileSync(process.env.FAKE_CLAUDE_PIDFILE, String(process.pid))
    setInterval(() => undefined, 1000)
    return
  }
  if (process.env.FAKE_CLAUDE_NO_PARTIAL) {
    out({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: '整段给的回答' }] } })
    out({ type: 'result', subtype: 'success', is_error: false, result: '整段给的回答', session_id: session })
    return
  }

  const block = () => out({ type: 'stream_event', session_id: session, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
  const delta = (text) => out({ type: 'stream_event', session_id: session, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })
  // 前面混一行不是 JSON 的（真的 claude 偶尔打印提示）
  process.stdout.write('not json\n')
  block()
  delta('我先')
  delta('看看。')

  // 全能模式的步骤（FAKE_CLAUDE_STEPS=1）：自己跑一条命令（做完）、写一个文件（出错）、调一次我们的 MCP（不该报成步骤）；
  // 子 Agent 里面的那几步（parent_tool_use_id 不是 null）也不该报
  if (process.env.FAKE_CLAUDE_STEPS) {
    const use = (id, name, input, parent = null) => out({ type: 'assistant', session_id: session, parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } })
    const result = (id, content, isError, parent = null) => out({ type: 'user', session_id: session, parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } })
    use('q1', 'ToolSearch', { query: 'select:mcp__canvas__notes_list' })
    result('q1', '（工具说明）', false)
    use('b1', 'Bash', { command: 'ls -1 ~', description: 'List home' })
    result('b1', 'Desktop\nDocuments', false)
    use('w1', 'Write', { file_path: process.cwd() + '/新笔记.md', content: 'x' })
    result('w1', [{ type: 'text', text: 'EACCES: permission denied\n第二行' }], true)
    use('m1', 'mcp__canvas__notes_list', {})
    result('m1', '（没有）', false)
    use('t1', 'Task', { description: '查资料', prompt: '去查' })
    use('s1', 'Grep', { pattern: '子 Agent 里的' }, 't1')
    result('s1', '没找到', false, 't1')
    result('t1', '查好了', false)
  }

  const parts = []
  const config = flag('--mcp-config')
  if (config) {
    const mode = (statSync(config).mode & 0o777).toString(8)
    const server = JSON.parse(readFileSync(config, 'utf8')).mcpServers.canvas
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...server.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'board_list', arguments: {} } }),
    })
    const body = await res.json()
    out({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__canvas__board_list', input: {} }] } })
    // 话里有「挪卡」：像整理白板那样挪一张空白处的卡到 (900, 80)，再试着挪一张「问过 AI」列（fixed）里的卡（r147）
    if (prompt.includes('挪卡')) {
      const call = async (name, args) => {
        const r = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', ...server.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) })
        const j = await r.json()
        return `${j.result?.isError || j.error ? '出错' : '好了'}：${j.result?.content?.[0]?.text ?? j.error?.message}`
      }
      const list = JSON.parse(body.result.content[0].text)
      const free = list.cards.find((c) => c.x !== undefined)
      const fixed = list.columns.find((c) => c.fixed)
      parts.push(`挪空白处的卡 ${free?.id} ${free ? await call('board_move', { id: free.id, x: 900, y: 80 }) : '没有'}`)
      parts.push(`挪问答列里的卡 ${fixed ? await call('board_move', { id: fixed.cards[0], x: 340, y: 64 }) : '没有'}`)
    }
    parts.push(`工具 ${flag('--tools')}`, `放行 ${flag('--allowedTools')}`, `调工具 ${body.result.content[0].text}`, `配置文件 ${mode}`, `轮数 ${flag('--max-turns')}`, `加目录 ${flag('--add-dir') ?? '没给'}`)
  } else {
    // 只读翻文件：像真的一样先搜再读（assistant 消息里的 tool_use）
    if (flag('--allowedTools') === 'Read,Glob,Grep') {
      out({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: '矩阵' } }] } })
      out({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: '找到了' }, { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: process.cwd() + '/笔记.md' } }] } })
      parts.push(`放行 ${flag('--allowedTools')}`)
    }
    parts.push(`工具「${flag('--tools')}」`, `轮数 ${flag('--max-turns')}`, `不留记录 ${has('--no-session-persistence') ? '是' : '否'}`)
  }
  parts.push(
    `禁止 ${flag('--disallowedTools')}`,
    `权限 ${flag('--permission-mode')}`,
    `设置 ${argv.includes('--setting-sources=') ? '不读' : `读 ${flag('--setting-sources') ?? '全部'}`}`,
    `只接我们的 MCP ${has('--strict-mcp-config') ? '是' : '否'}`,
    `接着聊 ${resume ?? '否'}`,
    `系统提示 ${flag('--system-prompt')}`,
    `话 ${prompt.replace(/\n/g, '/')}`,
    `effort ${flag('--effort') ?? '没给'}`,
    `附加系统提示 ${flag('--append-system-prompt') ?? '没给'}`,
    `额外设置 ${flag('--settings') ?? '没给'}`,
    `分叉 ${has('--fork-session') ? '是' : '否'}`,
  )
  // 调完工具另起一个文字块
  block()
  for (const p of parts) delta(p + '；')
  out({ type: 'result', subtype: 'success', is_error: false, result: '（结果里的全文）', session_id: session })
}
