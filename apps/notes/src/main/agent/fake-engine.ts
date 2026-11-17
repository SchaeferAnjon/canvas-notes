/**
 * 测试用的假引擎（CN_AI_FAKE=1）：不调模型，按用户说的话走一串固定的工具调用。
 * 工具是真的通过 MCP 服务调的（和真引擎走同一条路），字也是一小段一小段吐出来的。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
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
          // CN_FAKE_SAY_MS：每 4 个字隔多久（测试「答的时候再框一块」要答得慢一点）
          await sleep(Number(process.env.CN_FAKE_SAY_MS ?? 25))
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

      // 读 PDF：后台把一处问答收成笔记的一段（只出 JSON）
      if (r.prompt.includes('输出 JSON：')) {
        await sleep(Number(process.env.CN_FAKE_NOTE_MS ?? 400))
        const page = /第 (\d+) 页/.exec(r.prompt)?.[1] ?? '1'
        const asked = [...r.prompt.matchAll(/^【他】(.*)$/gm)].map((m) => m[1]!)
        const failed = [...r.prompt.matchAll(/"version": (\d+)/g)].map((m) => Number(m[1]))
        const figure = /从 (p\d+-b\d+)/.exec(r.prompt)?.[1] ?? null
        const json = {
          title: `测试小标题 p${page}`,
          doubts: asked.map((q) => (q === '给我讲解一下' ? `整块没看懂：第 ${page} 页框的这块` : q)),
          good: failed.length ? `第 ${failed.length + 1} 版：换成画面来讲，这次讲通了。` : '先看图，再看公式，这样讲通了。',
          points: ['要点一：列就是基向量去哪', '要点二：负号来自往左偏'],
          failed: failed.map((v) => ({ version: v, line: `第 ${v} 版用公式推，没听懂` })),
          figure,
          figureCaption: '这页的图',
          links: [],
        }
        return { text: JSON.stringify(json), session: undefined }
      }
      // 读 PDF：做个可视化（一个能拖的小网页）
      if (r.prompt.includes('做一个单文件 HTML 可视化')) {
        await sleep(Number(process.env.CN_FAKE_VIZ_MS ?? 600))
        const page = /第 (\d+) 页/.exec(r.prompt)?.[1] ?? '1'
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>旋转矩阵 · 拖动角度看基向量</title><style>body{font:14px sans-serif;margin:24px}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}</style></head><body><h1>第 ${page} 页 · 拖动角度</h1><input id="a" type="range" min="0" max="360" value="30" aria-label="角度"><p>角度 <b id="v">30</b>°</p><script>const a=document.getElementById('a');a.oninput=()=>document.getElementById('v').textContent=a.value</script></body></html>`
        return { text: '好的：\n```html\n' + html + '\n```', session: undefined }
      }
      // 让 Claude 帮我找：搜一下、读含有他的话里两个字的那几篇，交一行 JSON
      if (r.prompt.startsWith('帮他在库里找：')) {
        const q = r.prompt.slice('帮他在库里找：'.length).trim()
        const step = Number(process.env.CN_FAKE_FIND_MS ?? 300)
        await sleep(step)
        r.onTool?.('Grep', { pattern: q })
        const pairs = [...q].slice(0, -1).map((c, i) => c + q[i + 1])
        const hits: { path: string; why: string }[] = []
        const walk = (dir: string) => {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.')) continue
            const p = join(dir, e.name)
            if (e.isDirectory()) walk(p)
            else if (e.name.endsWith('.md')) {
              const text = readFileSync(p, 'utf8')
              const pair = pairs.find((w) => text.includes(w))
              if (pair) hits.push({ path: relative(r.cwd, p).split(sep).join('/'), why: `里面写着「${pair}」：${text.slice(text.indexOf(pair), text.indexOf(pair) + 20)}` })
            }
          }
        }
        walk(r.cwd)
        for (const h of hits.slice(0, 3)) {
          await sleep(step)
          r.onTool?.('Read', { file_path: join(r.cwd, h.path) })
        }
        return { text: `翻了一遍。\n${JSON.stringify({ found: hits.slice(0, 5) })}`, session: undefined }
      }
      // 读 PDF：框一块问、追问
      if (r.prompt.includes('他说：')) {
        const q = /他说：([\s\S]*)$/.exec(r.prompt)?.[1]?.trim() ?? ''
        const page = /他现在在看第 (\d+) 页/.exec(r.prompt)?.[1] ?? '?'
        const seen = [`第 ${page} 页`, `图 ${r.images?.length ?? 0} 张`, r.prompt.includes('<pdf>') || r.history?.includes('<pdf>') ? '读过全文' : '没读全文', r.session ? '接着聊' : '新会话', ...(r.prompt.includes('<answer>') ? ['带了上一问的回答'] : []), ...(r.prompt.includes('<subs>') ? ['带了字幕'] : [])]
        // 测试设置 › AI 选的模型真的传到了引擎（CN-44）
        if (q.includes('用的什么模型')) {
          await say(`模型：${r.model ?? '没指定'}`)
          return { text, session: `fake-read-${id}` }
        }
        // 测试出错的说法（CN-75）：照录屏里的原话报错
        if (q.includes('假装被拦'))
          throw new Error(
            "API Error: Opus 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). Please try rephrasing your request. Details: [reasoning_extraction] Request ID: req_011FAKE Message ID: msg_01FAKE",
          )
        // 测试表格（CN-29）：左右对照翻译
        if (q.includes('对照表'))
          await say('翻译：\n\n| 原文 | 译文 |\n|---|---|\n| **physics-inspired** machine learning | 受物理启发的机器学习 |\n| data-driven surrogate models for partial differential equations | 偏微分方程的数据驱动代理模型 |\n| [第 2 页](#page=2) | 见第 2 页 |\n\n就这些。')
        else if (/还是不懂|换个方式/.test(q)) await say(`换个方式讲（${seen.join('，')}）：先别看公式，看图。`)
        else await say(`这是讲解（${seen.join('，')}）。用你在 [第 2 页](#page=2) 弄懂的那条：列就是基向量去哪。\n\n〔可以做个可视化〕`)
        // 配图的框（CN-60）：测试里给一个固定的框
        if (process.env.CN_FAKE_FIGURE_MARK && r.images?.length && r.prompt.includes('〔配图')) await say(`\n${process.env.CN_FAKE_FIGURE_MARK}`)
        return { text, session: `fake-read-${id}` }
      }

      // 右下角 AI 浮窗也能演被拦（同读 PDF 那条）：看出错那一句在浮窗里的样子
      if (said.includes('假装被拦'))
        throw new Error("API Error: Opus 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). Please try rephrasing your request. Request ID: req_011FAKE")
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
        await say(/用的什么模型/.test(said) ? `模型：${r.model ?? '没指定'}（${LABELS[id]}）` : `这是测试回答（${LABELS[id]}${r.images?.length ? `，图 ${r.images.length} 张` : ''}）。`)
      }
      return { text, session: `fake-${id}` }
    },
  }
}
