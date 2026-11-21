/**
 * 测试用的假引擎（CN_AI_FAKE=1）：不调模型，按用户说的话走一串固定的工具调用。
 * 工具是真的通过 MCP 服务调的（和真引擎走同一条路），字也是一小段一小段吐出来的。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { EngineId } from '../../shared/agent'
import { effortOption, type ModelOption } from '../../shared/ai-features'
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

/** 假的 Codex 模型列表（照 codex 0.163.0 的 model/list 的样子；默认的排第一，两个模型的档不一样） */
export function fakeCodexModels(): ModelOption[] {
  return [
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(effortOption), defaultEffort: 'low' },
    { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'].map(effortOption), defaultEffort: 'medium' },
  ]
}

/** 问里有「公式」时的回答：讲 LIF 神经元的三条公式（同 A 组方案小样里那段），行内 $…$、单独成行的 $$…$$ 都有（CN-89） */
export const FORMULA_ANSWER = [
  'LIF 神经元用「漏、积、发」三步描述一个神经元。',
  '',
  '## 水位怎么变',
  '',
  '$$\\tau_m \\frac{dV_m}{dt} = -V_m(t) + I_s(t) + I_b$$',
  '',
  '- $\\tau_m$ 是漏得多快，$I_s(t)$ 是这一刻进来的电流，$I_b$ 是常开的底水位。',
  '- 拿个数走一遍：$\\tau_m = 10$ ms，$V_m = 0.5$，没有输入时一毫秒漏掉 $0.05$。',
  '',
  '## 什么时候发',
  '',
  '$$',
  'V_m \\ge V_{th} \\;\\Rightarrow\\; V_m \\leftarrow V_m - V_{th},\\quad s(t) = 1',
  '$$',
  '',
  // 这一句公式两边没打空格（真回答常这样）：界面上紧挨汉字那边留 1/8 字宽
  '水位一到门槛$V_{th}$就发一个 spike，再减掉一个门槛的量（不是清零），见 [第 4 页](#page=4)。',
].join('\n')

/** 问的话里带了几块引用的材料（shared/materials.ts 的 withMaterials 写的「我引用的材料…」下面一行一块） */
function materialCount(q: string): number {
  const at = q.indexOf('我引用的材料（')
  return at < 0 ? 0 : (q.slice(at).match(/^[①-⑳] /gm) ?? []).length
}

/**
 * 库里的笔记工具（2026-11-19）：按话里的「」走一个工具，回给用户工具说的那句。认的说法：
 * 新建一篇「标题」放到「文件夹」（写上「正文」）、把「路径」改名为「新名」、把「路径」挪到「文件夹」（「」空着是最外层）、
 * 删掉「路径」、新建文件夹「名字」（放在「上一层」）、在「路径」末尾加上「一段」
 */
async function vaultCommand(said: string, call: (name: string, args: Record<string, unknown>) => Promise<string>): Promise<string | null> {
  const q = [...said.matchAll(/「([^」]*)」/g)].map((m) => m[1]!)
  if (/^新建一篇/.test(said)) return call('note_create', { title: q[0], ...(q[1] !== undefined ? { folder: q[1] } : {}), ...(q[2] !== undefined ? { text: q[2] } : {}) })
  if (/^把「[^」]*」改名为/.test(said)) return call('note_rename', { path: q[0], name: q[1] })
  if (/^把「[^」]*」挪到/.test(said)) return call('note_move', { path: q[0], folder: q[1] ?? '' })
  if (/^删掉「/.test(said)) return call('note_delete', { path: q[0] })
  if (/^新建文件夹「/.test(said)) return call('folder_create', { name: q[0], ...(q[1] !== undefined ? { parent: q[1] } : {}) })
  if (/^在「[^」]*」末尾加上「/.test(said)) return call('note_write', { path: q[0], text: q[1], mode: 'append' })
  // 整篇换掉（新内容从本机的一个文件里读，测试用整篇长笔记）
  if (/^整篇改写「[^」]*」照「/.test(said)) return call('note_write', { path: q[0], text: readFileSync(q[1]!, 'utf8'), mode: 'replace' })
  return null
}

/** 测试写好的一段多轮对话（CN_FAKE_ROUNDS）：用户说的那句、改哪一篇、换成哪个文件里的字、AI 回的那句 */
function fakeRounds(): { say: string; path: string; file: string; reply?: string }[] {
  const f = process.env.CN_FAKE_ROUNDS
  return f ? (JSON.parse(readFileSync(f, 'utf8')) as { say: string; path: string; file: string; reply?: string }[]) : []
}

/** 问「用的什么模型」时说的：模型和 effort 都说出来（测试看设置、输入框底行选的真的传到了引擎，CN-44、CN-91） */
const modelSaid = (r: { model?: string; effort?: string }) => `模型：${r.model ?? '没指定'}，effort：${r.effort ?? '没指定'}`

export function fakeEngine(id: EngineId): Engine {
  let sides = 0
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
        // 停下以后不再调工具（真的命令行被停下时进程就结束了）
        if (r.signal.aborted) throw Object.assign(new Error('停下了'), { name: 'AbortError' })
        if (!r.mcp) throw new Error('这一轮没给工具')
        const res = await mcp(r.mcp.url, r.mcp.token, 'tools/call', { name, arguments: args })
        const out = (res.content as { text: string }[])[0]?.text ?? ''
        if (res.isError) throw new Error(out)
        return out
      }
      if (r.mcp) await mcp(r.mcp.url, r.mcp.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } })

      // 读 PDF：后台的两件小活，这一轮的标题和一句小结（只出 JSON）；小结里写主对话、旁支各问了几句（测试看每答完一次都重写）
      if (r.prompt.includes('输出 JSON：')) {
        await sleep(Number(process.env.CN_FAKE_NOTE_MS ?? 400))
        const page = /第 (\d+) 页/.exec(r.prompt)?.[1] ?? '1'
        const main = (r.prompt.match(/^【他】/gm) ?? []).length
        const side = (r.prompt.match(/^【他·旁支】/gm) ?? []).length
        const json = { title: `测试小标题 p${page}`, recap: `测试小结：主对话问了 ${main} 句${side ? `，旁支问了 ${side} 句` : ''}。` }
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
      // 测试设置 › AI「给AI的长期说明」真的带进了这一问（AI 对话、读 PDF 都在最前面）
      if (said.includes('复述长期说明')) {
        const note = /【用户的长期说明】每一问都照这个来：\n([\s\S]*?)\n/.exec(r.prompt)?.[1]
        await say(note ? `长期说明：${note}` : '没有长期说明')
        return { text, session: r.session }
      }
      // 读 PDF：框一块问、追问
      if (r.prompt.includes('他说：')) {
        const q = /他说：([\s\S]*)$/.exec(r.prompt)?.[1]?.trim() ?? ''
        const page = /他现在在看第 (\d+) 页/.exec(r.prompt)?.[1] ?? '?'
        // 旁支（CN-90）：从给的会话分叉，会话号另起一个；接着聊就还是给的那个
        const fork = !!(r.fork && r.session)
        const session = fork ? `fake-side-${id}-${++sides}` : (r.session ?? `fake-read-${id}`)
        // 引用的材料（多段引用方向 B）：「我引用的材料…」下面一行一块
        const mats = materialCount(q)
        const seen = [`第 ${page} 页`, `图 ${r.images?.length ?? 0} 张`, ...(mats ? [`材料 ${mats} 块`] : []), r.prompt.includes('<pdf>') || r.history?.includes('<pdf>') ? '读过全文' : '没读全文', fork ? `旁支，从 ${r.session} 分叉` : r.session ? '接着聊' : '新会话', ...(r.prompt.includes('<answer>') ? ['带了上一问的回答'] : []), ...(r.prompt.includes('<subs>') ? ['带了字幕'] : [])]
        // 测试设置 › AI 选的模型真的传到了引擎（CN-44）
        if (q.includes('用的什么模型')) {
          await say(modelSaid(r))
          return { text, session }
        }
        // 读 PDF 时也能动手（2026-11-19）：「新建一篇「…」放到「…」」这些走库里的笔记工具
        const did = await vaultCommand(q, call).catch((e: Error) => `没做成：${e.message}`)
        if (did !== null) {
          await say(`${did}。`)
          return { text, session }
        }
        // 旁支（CN-90）：回答里写问的是哪一句、从哪分叉；问里有「公式」照样答带 LaTeX 的
        if (/这是一条旁支|接着这条旁支问/.test(r.prompt) && !q.includes('公式')) {
          const quote = /他选中的那句：「(.*)」|问的还是「(.*)」这句/.exec(r.prompt)
          await say(`#### 旁支的回答\n\n这是旁支的回答（${seen.join('，')}）：讲「${(quote?.[1] ?? quote?.[2] ?? '').slice(0, 12)}」，问的是「${q}」。\n\n第二段：门槛减掉，不清零。`)
          return { text, session }
        }
        // 测试出错的说法（CN-75）：照录屏里的原话报错
        if (q.includes('假装被拦'))
          throw new Error(
            "API Error: Opus 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). Please try rephrasing your request. Details: [reasoning_extraction] Request ID: req_011FAKE Message ID: msg_01FAKE",
          )
        // 测试表格（CN-29）：左右对照翻译
        if (q.includes('对照表'))
          await say('翻译：\n\n| 原文 | 译文 |\n|---|---|\n| **physics-inspired** machine learning | 受物理启发的机器学习 |\n| data-driven surrogate models for partial differential equations | 偏微分方程的数据驱动代理模型 |\n| [第 2 页](#page=2) | 见第 2 页 |\n\n就这些。')
        // 测试公式（CN-89）：行内的、单独成行的 LaTeX，回答区用 KaTeX 排
        else if (q.includes('公式'))
          await say(FORMULA_ANSWER)
        else if (/还是不懂|换个方式/.test(q)) await say(`换个方式讲（${seen.join('，')}）：先别看公式，看图。`)
        else await say(`这是讲解（${seen.join('，')}）。用你在 [第 2 页](#page=2) 弄懂的那条：列就是基向量去哪。\n\n〔可以做个可视化〕`)
        // 配图的框（CN-60）：测试里给一个固定的框
        if (process.env.CN_FAKE_FIGURE_MARK && r.images?.length && r.prompt.includes('〔配图')) await say(`\n${process.env.CN_FAKE_FIGURE_MARK}`)
        return { text, session }
      }

      // 一轮做到一半断了（像 Claude Code 中途退出、按了停下）：读了一样、说了半句就断，会话号照真的样子跟着错误给出来；
      // 「接着做」时说清是不是接着那个会话
      if (said.includes('做到一半就断') || said.includes('慢慢做')) {
        r.onStep?.({ id: 'r1', tool: 'Read', input: { file_path: join(r.cwd, '附件/截图 9.png') }, status: 'run' })
        r.onStep?.({ id: 'r1', tool: 'Read', input: { file_path: join(r.cwd, '附件/截图 9.png') }, status: 'ok' })
        await say('正在把这篇按章节重排')
        const session = r.session ?? `fake-cut-${id}`
        // 慢慢做：跑着一条命令，一直到用户按停下（这一步不会再报做完）
        if (said.includes('慢慢做')) r.onStep?.({ id: 'b1', tool: 'Bash', input: { command: 'python3 /tmp/fix.py' }, status: 'run' })
        while (said.includes('慢慢做') && !r.signal.aborted) await sleep(50)
        throw Object.assign(r.signal.aborted ? Object.assign(new Error('停下了'), { name: 'AbortError' }) : new Error('Claude Code 退出了（143）'), { session })
      }
      if (/^接着做/.test(said)) {
        await say(r.session ? `接着会话 ${r.session} 做完了。` : '这是新会话，不记得刚才做到哪。')
        return { text, session: r.session ?? `fake-${id}` }
      }
      // 旁支（task-4edsc，AI 对话、文档里 AI 讲解块的）：回答里写问的是哪一句、从哪分叉（文档里的没有会话可分叉，是新会话）
      if (/这是一条旁支|接着这条旁支问/.test(r.prompt)) {
        const quote = /他选中的那句：「(.*)」|问的还是「(.*)」这句/.exec(r.prompt)
        const fork = !!(r.fork && r.session)
        const session = r.session && !fork ? r.session : `fake-side-${id}-${++sides}`
        const how = fork ? `旁支，从 ${r.session} 分叉` : r.session ? '接着聊' : `新会话${r.history ? '，带了那段讲解' : ''}`
        await say(`#### 旁支的回答\n\n这是旁支的回答（${how}）：讲「${(quote?.[1] ?? quote?.[2] ?? '').slice(0, 12)}」，问的是「${said}」。\n\n第二段：说完了。`)
        return { text, session }
      }
      // AI 对话里要几句话的回答（选一句开旁支用）：周记总结成三句话
      if (/总结成三句话/.test(said)) {
        await say('这周主要在赶第5讲的作业，注意力机制那部分花了两个晚上才弄懂。\n\n周三开始每天早上跑步，三次都坚持下来了。\n\n下周要把论文计划的第一节写完，并约导师见一面。')
        return { text, session: r.session ?? `fake-${id}` }
      }
      // 右下角 AI 浮窗也能演被拦（同读 PDF 那条）：看出错那一句在浮窗里的样子
      if (said.includes('假装被拦'))
        throw new Error("API Error: Opus 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). Please try rephrasing your request. Request ID: req_011FAKE")
      // 左栏选了好几个交给 AI（task-0tgz2）：照话里交来的那几篇答；「合成一篇」真用 note_create 建一篇（一次提交、能撤回）
      if (/选中的这几篇/.test(said)) {
        const picked = /问的「选中的这几篇」就是它们[^：]*：(.*)$/m.exec(r.prompt)?.[1]?.split('、') ?? []
        if (!picked.length) {
          await say('没收到选中的是哪几篇。')
          return { text, session: `fake-${id}` }
        }
        if (/合成一篇/.test(said)) {
          const names = picked.map((p) => p.split('/').pop()!.replace(/\.md$/, ''))
          await call('note_create', { title: '合成的笔记', text: names.map((n) => `## ${n}\n`).join('\n') })
          await say(`合成好了：《合成的笔记》，来自${picked.length}篇。`)
        } else await say(`这是测试回答（选中的${picked.length}篇：${picked.join('、')}）。`)
        return { text, session: `fake-${id}` }
      }
      const did = await vaultCommand(said, call).catch((e: Error) => `没做成：${e.message}`)
      if (did !== null) {
        await say(`${did}。`)
        return { text, session: `fake-${id}` }
      }
      // 照写好的稿子演一段多轮对话（CN_FAKE_ROUNDS 指向一个 JSON：[{say, path, file, reply}]）：说到那句，就把那一篇整篇换成 file 里的字
      // （「存成命令」的测试：好几轮才把一篇改成想要的样子）
      const round = fakeRounds().find((x) => said.includes(x.say))
      if (round) {
        await call('note_write', { path: round.path, text: readFileSync(round.file, 'utf8'), mode: 'replace' })
        await say(round.reply ?? '改好了。')
        return { text, session: `fake-${id}` }
      }
      // 现在是什么模式：照引擎拿到的开关和话里开头那一行【模式】说（测试看开关真的传到了引擎）
      if (/什么模式/.test(said)) {
        const line = /【模式】(全能模式[开关]着)/.exec(r.prompt)?.[1] ?? '没写'
        await say(`引擎拿到的：全能模式${r.omni ? '开着' : '关着'}；话里写的：${line}。`)
        return { text, session: `fake-${id}` }
      }
      // 全能模式：像 Claude Code 自己用 Write 那样直接写一个文件（不走我们的工具），报成步骤；关着就说做不了、请用户打开全能模式
      if (/^(自己写文件|跑命令写文件)「/.test(said)) {
        // 跑命令写：像 Claude Code 用 Bash 跑 python 那样写（步骤是「跑命令」，看不出改了哪个文件）
        const bash = said.startsWith('跑命令')
        const [file, body] = [...said.matchAll(/「([^」]*)」/g)].map((m) => m[1]!)
        if (!r.omni) {
          await say('全能模式关着，我不能自己写文件。请在 AI 输入框下面打开「全能模式」再说一次。')
          return { text, session: `fake-${id}` }
        }
        const abs = file!.startsWith('/') ? file! : join(r.cwd, file!)
        const step = bash ? { tool: 'Bash', input: { command: 'python3 /tmp/fix.py' } } : { tool: 'Write', input: { file_path: abs } }
        r.onStep?.({ id: 'w1', ...step, status: 'run' })
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, body ?? '')
        // CN_FAKE_OWN_MS：写完多等一会儿再答（测试在这一会儿里往编辑器里打字，看提交里不带用户的字）
        await sleep(Number(process.env.CN_FAKE_OWN_MS ?? 0))
        r.onStep?.({ id: 'w1', ...step, status: 'ok' })
        await say(`写好了 ${file}。`)
        return { text, session: `fake-${id}` }
      }
      // 全能模式：像 Claude Code 自己用 Edit 那样，过一会儿（CN_FAKE_OWN_MS）直接在一篇末尾加一行（用户正在编辑器里打这一篇的字）
      if (/^过一会儿在「[^」]*」末尾加「/.test(said) && r.omni) {
        const [file, line] = [...said.matchAll(/「([^」]*)」/g)].map((m) => m[1]!)
        const abs = join(r.cwd, file!)
        r.onStep?.({ id: 'e1', tool: 'Edit', input: { file_path: abs }, status: 'run' })
        await sleep(Number(process.env.CN_FAKE_OWN_MS ?? 0))
        writeFileSync(abs, `${readFileSync(abs, 'utf8').replace(/\s*$/, '')}\n\n${line}\n`)
        r.onStep?.({ id: 'e1', tool: 'Edit', input: { file_path: abs }, status: 'ok' })
        await say(`加好了。`)
        return { text, session: `fake-${id}` }
      }
      const url = /https?:\/\/\S+/.exec(said)?.[0]
      if (url && /打开/.test(said)) {
        await say('好，我在右栏打开它。')
        await call('web_open', { url })
        const page = await call('web_read')
        const title = /^标题：(.*)$/m.exec(page)?.[1] ?? ''
        await say(`\n\n打开了，网页标题是「${title}」。`)
      } else if (/剪/.test(said) && /网页/.test(said)) {
        // 网页里的几段剪进收件箱：一段一段去找、选中、剪（每段一个 web_clip，指针挨个去拿）
        const parts = [...said.matchAll(/「([^」]+)」/g)].map((m) => m[1]!)
        await say(`我把这${parts.length || 1}段剪进收件箱。`)
        if (!parts.length) await call('web_clip', {})
        for (const p of parts) await call('web_clip', { text: p })
        await say('剪好了。')
      } else if (/^整理当前白板/.test(said)) {
        await call('board_list')
        await call('board_arrange', { mode: 'columns' })
        await say('按列排整齐了。')
      } else if (/^加一张卡「/.test(said)) {
        // 只加一张卡：先看白板，再加（流光只亮这一张）
        await call('board_list')
        await call('board_add_card', { text: /「([^」]+)」/.exec(said)![1] })
        await say('加好了，在最后一节。')
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
        const mats = materialCount(said)
        await say(/用的什么模型/.test(said) ? `${modelSaid(r)}（${LABELS[id]}）` : `这是测试回答（${LABELS[id]}${r.images?.length ? `，图 ${r.images.length} 张` : ''}${mats ? `，材料 ${mats} 块` : ''}）。`)
      }
      return { text, session: `fake-${id}` }
    },
  }
}
