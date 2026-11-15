/**
 * 测试用的假引擎（CN_AI_FAKE=1）：不调模型，按用户说的话走一串固定的工具调用。
 * 工具是真的通过 MCP 服务调的（和真引擎走同一条路），字也是一小段一小段吐出来的。
 */
import type { EngineId } from '../../shared/agent'
import { type Engine, LABELS } from './engines'

async function mcp(url: string, token: string, method: string, params: unknown, id = 1): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`MCP ${method} 回了 ${res.status}`)
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: { message: string } }
  if (body.error) throw new Error(body.error.message)
  return body.result!
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function fakeEngine(id: EngineId): Engine {
  return {
    id,
    label: LABELS[id],
    async run(r) {
      const said = /用户说：\n([\s\S]*)$/.exec(r.prompt)?.[1]?.trim() ?? r.prompt
      let text = ''
      const say = async (s: string) => {
        for (const part of s.match(/.{1,4}/gsu) ?? []) {
          if (r.signal.aborted) throw Object.assign(new Error('停下了'), { name: 'AbortError' })
          text += part
          r.onText(part)
          await sleep(25)
        }
      }
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        if (!r.mcp) throw new Error('这一轮没给工具')
        const res = await mcp(r.mcp.url, r.mcp.token, 'tools/call', { name, arguments: args })
        const out = (res.content as { text: string }[])[0]?.text ?? ''
        if (res.isError) throw new Error(out)
        return out
      }
      if (r.mcp) await mcp(r.mcp.url, r.mcp.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } })

      const url = /https?:\/\/\S+/.exec(said)?.[0]
      if (url && /打开/.test(said)) {
        await say('好，我在右栏打开它。')
        await call('web_open', { url })
        const page = await call('web_read')
        const title = /^标题：(.*)$/m.exec(page)?.[1] ?? ''
        await say(`\n\n打开了，网页标题是「${title}」。`)
      } else if (/^整理当前白板/.test(said)) {
        await call('board_list')
        await call('board_arrange', { mode: 'columns' })
        await say('按列排整齐了。')
      } else if (/卡片/.test(said) && /排/.test(said)) {
        const items = [...said.matchAll(/「([^」]+)」/g)].map((m) => m[1]!)
        const cards = items.length ? items : ['订机票', '订租车', '看极光']
        await call('board_list')
        await say(`我加 ${cards.length} 张卡片，`)
        for (const c of cards) await call('board_add_card', { text: c })
        const mode = /按列/.test(said) ? 'columns' : 'grid'
        await call('board_arrange', { mode })
        await say(`再${mode === 'grid' ? '按网格' : '按列'}排整齐。好了。`)
      } else if (/插入/.test(said)) {
        const what = /「([^」]+)」/.exec(said)?.[1] ?? 'AI 插入的一段'
        await call('doc_read')
        await call('doc_insert', { text: what })
        await say('插好了。')
      } else {
        await say(`这是测试回答（${LABELS[id]}）。`)
      }
      return { text, session: `fake-${id}` }
    },
  }
}
