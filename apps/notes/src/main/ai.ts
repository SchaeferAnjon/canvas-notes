/**
 * / 命令的一次性问答（不给工具，只读我们放进提示里的笔记）。
 * 用的是这台 Mac 上已经登录的 AI 命令行（AI 浮窗头部选的那家），不另存密钥。
 * CN_AI_FAKE=1 时不调模型，按命令给固定的回答（端到端测试用）。
 */
import { appendFileSync } from 'node:fs'
import type { EngineId } from '../shared/agent'
import type { AiFeature } from '../shared/ai-features'
import { fakeCmdAnswer } from '../shared/cmd-run'
import { fakeDistill } from '../shared/distill'
import { ask as engineAsk, askFast as engineAskFast, askWith, chatRun } from './agent'
import { fakeJudge, isJudgePrompt } from './dream-judge'
import type { EngineImage } from './agent/engines'

/**
 * 这一问用哪家、哪个模型、想多久（/ 命令照 AI 输入框底行选的走，task-0fhyo）；images：一起给的图（截图转成文字）。
 * 不给 pick 时照旧用设置 › AI 里这个功能选的
 */
export interface AskWith {
  pick?: { engine: EngineId; model?: string; effort?: string }
  images?: EngineImage[]
}

/** 用设置 › AI 里这个功能选的引擎问一次（不给工具；/ 命令是 AI 对话，梦游是梦游），onText 边生成边给；CN_AI_FAKE=1 时给固定回答 */
export async function ask(system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void = () => {}, feature: AiFeature = 'chat', w: AskWith = {}): Promise<string> {
  if (process.env.CN_AI_FAKE === '1') {
    // 测试看每一问用的哪一家、哪一档（task-0fhyo）、交给 AI 的是什么话：CN_FAKE_PICK_LOG 给了就一问记一行
    if (process.env.CN_FAKE_PICK_LOG) appendFileSync(process.env.CN_FAKE_PICK_LOG, JSON.stringify({ cmd: isJudgePrompt(prompt) ? '梦游判断' : (/^命令：(\S+)/.exec(prompt)?.[1] ?? ''), feature, pick: w.pick ?? null, prompt }) + '\n')
    failOnce(prompt)
    // 梦游判断（task-h7oy8）：一篇想一会儿（CN_FAKE_JUDGE_MS，默认不等），测「睡眠打断后接着判」时停得下
    if (isJudgePrompt(prompt)) {
      const ms = Number(process.env.CN_FAKE_JUDGE_MS ?? 0)
      if (ms > 0)
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, ms)
          signal.addEventListener('abort', () => (clearTimeout(t), rej(Object.assign(new Error('停下了'), { name: 'AbortError' }))), { once: true })
        })
      if (signal.aborted) throw Object.assign(new Error('停下了'), { name: 'AbortError' })
      const out = fakeJudge(prompt)
      onText(out)
      return out
    }
    // 数据库 AI 列（task-i921u）：一格想一会儿（CN_FAKE_AICOL_MS，默认 400 毫秒），看得到「在写」、按 esc 停得下
    if (/^命令：数据库AI列/.test(prompt)) {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, Number(process.env.CN_FAKE_AICOL_MS ?? 400))
        signal.addEventListener('abort', () => (clearTimeout(t), rej(Object.assign(new Error('停下了'), { name: 'AbortError' }))), { once: true })
      })
      const out = fakeAiColumn(prompt)
      onText(out)
      return out
    }
    let out = fakeCmdAnswer(prompt) ?? (/^命令：提炼规矩/.test(prompt) ? fakeDistill(prompt) : fake(prompt))
    // 测试看输入框选的模型和想多久真的交到了引擎这一层（task-0fhyo）：照引擎真会拿到的说出来
    if (process.env.CN_FAKE_SAY_PICK === '1' && w.pick) {
      const r = chatRun(w.pick.engine, w.pick)
      out += `\n（${w.pick.engine} · 模型：${r.model ?? '默认'} · effort：${r.effort ?? '默认'}${w.images?.length ? ` · 图 ${w.images.length} 张` : ''}）`
    }
    // 文档里 / 菜单的「AI 写一段」「AI 总结这页」：和真的命令行一样边生成边给（每 4 个字隔 CN_FAKE_SAY_MS，默认 25 毫秒），
    // 测试看字在编辑器里一点点长出来、中途停下（task-6kun1）
    if (/^命令：(写一段|总结这页)/.test(prompt)) {
      for (const part of out.match(/[^]{1,4}/gu) ?? []) {
        if (signal.aborted) throw Object.assign(new Error('停下了'), { name: 'AbortError' })
        onText(part)
        await new Promise((r) => setTimeout(r, Number(process.env.CN_FAKE_SAY_MS ?? 25)))
      }
      if (signal.aborted) throw Object.assign(new Error('停下了'), { name: 'AbortError' })
      return out
    }
    onText(out)
    return out
  }
  if (w.pick) return askWith(system, prompt, signal, onText, w.pick, w.images ?? [])
  return engineAsk(system, prompt, signal, onText, feature)
}

/** 用快模型问一次（翻译用）：Claude Code 的 Haiku；CN_AI_FAKE=1 时给固定回答 */
export async function askFast(system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void = () => {}): Promise<string> {
  if (process.env.CN_AI_FAKE === '1') {
    // 假装要想一会儿（CN_AI_FAKE_DELAY_MS，默认 300 毫秒），界面上看得到「翻译中」；一行一行吐，和真模型一样
    await new Promise((r) => setTimeout(r, Number(process.env.CN_AI_FAKE_DELAY_MS) || 300))
    failOnce(prompt)
    const out = fake(prompt)
    for (const line of out.split(/(?<=\n)/)) onText(line)
    return out
  }
  return engineAskFast(system, prompt, signal, onText)
}

/** CN_AI_FAKE_FAIL=视频摘要:1：这个命令前 1 次报错（演 AI 出错，测重试；/ 命令也认，比如 视频要点带时间:1） */
const failed = new Map<string, number>()
function failOnce(prompt: string) {
  const [cmd, times] = (process.env.CN_AI_FAKE_FAIL ?? '').split(':')
  if (!cmd || /^命令：(\S+)/.exec(prompt)?.[1] !== cmd) return
  const n = failed.get(cmd) ?? 0
  if (n >= (Number(times) || Infinity)) return
  failed.set(cmd, n + 1)
  throw new Error('Claude Code 退出了（1）：测试用的失败')
}

/** 同一列同一条问了几次（重跑换一组题） */
const aiColAsked = new Map<string, number>()

/**
 * 测试用的数据库 AI 列回答：照「放成」答（练习题三道、单选「中」、多选两个词、数字、一句话），题目照那一条正文的第一句出；
 * 同一条再问一次换一组（重跑看得出换了）
 */
function fakeAiColumn(prompt: string): string {
  const name = /^这一条：(.+)$/m.exec(prompt)?.[1] ?? ''
  const kind = /^放成：(.+)$/m.exec(prompt)?.[1] ?? ''
  const body = /<<<\n([\s\S]*?)\n>>>/.exec(prompt)?.[1] ?? ''
  const first = (body.replace(/^#+.*$/gm, '').split(/[。！？\n]/).map((x) => x.trim()).find(Boolean) ?? name).slice(0, 24)
  const key = `${/^列名：(.+)$/m.exec(prompt)?.[1] ?? ''}|${name}`
  const n = (aiColAsked.get(key) ?? 0) + 1
  aiColAsked.set(key, n)
  const again = n > 1 ? `（第 ${n} 组）` : ''
  if (/^一篇笔记/.test(kind)) return `1. ${first}，为什么？${again}\n2. 《${name}》里最重要的一个词是什么？\n3. 举一个生活里的例子说明这一讲。`
  if (/^从选项里挑/.test(kind)) return ['易', '中', '难'][((/第[12]讲/.test(name) ? 0 : /第[34]讲/.test(name) ? 1 : 2) + n - 1) % 3]!
  if (/^1 到 3 个/.test(kind)) return `${name.split(' ').pop()}、${n > 1 ? '复习' : '入门'}`
  if (/^只写一个数/.test(kind)) return String(name.length + n - 1)
  return `${first}${again}`
}

/** 测试用的固定回答：提示第一行是「命令：xxx」 */
/** 假 AI 把一句话填成规则（照原型那四句；别的说法回一条「新加一条就通知」） */
function fakeAutoRule(said: string): string {
  const yaml = (lines: string[]) => '```yaml\n' + lines.join('\n') + '\n```'
  if (/报销/.test(said)) return yaml(['- name: 交报销单', '  when: {changed: 分类, to: 报销}', '  do:', '    - todo: 交报销单：{{名字}} {{金额}}', '      file: 生活/待办.md', '      date: 下周一 9:00'])
  const big = /超过\s*(\d+)/.exec(said)
  if (big) return yaml(['- name: 大额支出提醒', '  when: [{added: true}, {changed: 金额}]', `  if: {and: [收支 == "支出", 金额 > ${big[1]}]}`, '  do:', '    - notify: 这笔有点大：{{名字}} {{金额}}'])
  if (/每周日/.test(said)) return yaml(['- name: 提醒记账', '  when: {every: week, day: 日, at: "21:00"}', '  missed: once', '  do:', '    - todo: 记这周的账', '      file: 生活/待办.md', '      date: 今天 21:00'])
  if (/每月最后一天|月底/.test(said)) return yaml(['- name: 月底写账单摘要', '  when: {every: month, day: last, at: "21:00"}', '  missed: once', '  do:', '    - ai: summary', '      rows: 日期.month == today().month', '      prompt: 收入、支出、结余，花得最多的三类', '      folder: 生活/记账/账单摘要'])
  return yaml(['- name: 新加就通知', '  when: {added: true}', '  do:', `    - notify: ${said.slice(0, 20) || '新加了一条'}`])
}

function fake(prompt: string): string {
  const cmd = /^命令：(\S+)/.exec(prompt)?.[1]
  switch (cmd) {
    // 自动化「先说一句」（task-i921u）：照原型「比如」里那四句认关键词，回同一种 YAML
    case '自动化规则':
      return fakeAutoRule(/用户说的：\n([\s\S]*)$/.exec(prompt)?.[1]?.trim() ?? '')
    case '自动化写摘要': {
      const n = (prompt.match(/^- /gm) ?? []).length
      return `这段时间一共 ${n} 条。（测试：自动化写的摘要）`
    }
    case '总结':
      return '这块白板讲了三件事：住处还没订、极光看哪两晚、还没订的车。'
    case '写成文章':
      // 演 AI 回一句拒绝话（白板上只有「（测试：太少）」那张卡）
      if (prompt.includes('（测试：太少）')) return '白板上的内容太少，写不成一篇文章。'
      return '# 冰岛自驾\n\n## 出发前先定\n\n住处还没订。\n\n> 冰洞只在冬天开放。\n—— [Ice caves](https://www.safetravel.is/ice-caves)\n'
    case '翻译段落': {
      // 每段回一行 JSON：「译文：」加原文开头（测试按这个认）
      const items = JSON.parse(/^段落：\n([\s\S]*)$/m.exec(prompt)?.[1] ?? '[]') as { id: number; text: string }[]
      return items.map((it) => JSON.stringify({ id: it.id, text: `译文：${it.text.slice(0, 40)}` })).join('\n') + '\n'
    }
    case '翻译':
      return '（译文）Seek wealth, not money or status.'
    case '视频摘要':
      return '00:00 开场：这一集讲线性变换\n00:05 矩阵可以读成空间的变换\n00:12 只要知道两个基向量落在哪\n'
    case '梦游可视化': {
      const page = /第 (\d+) 页/.exec(prompt)?.[1] ?? '1'
      return '```html\n<!doctype html><html><head><meta charset="utf-8"><title>旋转矩阵 · 拖动角度看基向量</title></head><body><h1>第 ' + page + ' 页 · 拖动角度</h1><input type="range" aria-label="角度" min="0" max="360" value="30"></body></html>\n```'
    }
    case '本周小结':
      return '这周主要在准备冰岛自驾，收件箱里多了几条极光和巴黎的剪藏，还没整理。'
    case '写一段':
      // 和流光原型 A2「写一段」同一段（并排对照图用）
      if (/要写的：.*SAGE/.test(prompt)) return '为什么先读 SAGE：它和 C72 用的是同一批睡眠数据，数字可以直接对照。先看它的 Fig. 2，弄清每个方块在做什么，再回来读 C72 就快得多。'
      // 「写长一段」：两段、一百多字（看字一点点长出来、中途停下）；别的照旧一句
      if (/要写的：写长一段/.test(prompt))
        return '开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说过了一些年兄妹俩回头谈起它，一下子定下了整本书的视角。孩子当时的天真和成年人回忆时的距离叠在一起。\n\n“事情就开始了”这一句把源头指向迪尔和怪人拉德利，先抛一个悬念，让人想往下读。'
      return '这是测试回答。'
    case '总结这页':
      return '这一页记了冰岛自驾要先定的三件事：住处、租车和看极光的两晚。住处还没订，车要四驱。极光看预报再定是哪两晚。'
    case '文件夹小结':
      return '这周主要在读 ECP 的第 5 讲。冰岛的机票订好了。住宿还没定。'
    case '挪进文件夹': {
      // 内容里写着这个文件夹名字的那几条
      const folder = /^文件夹：(.+)$/m.exec(prompt)?.[1]?.split('/').pop() ?? ''
      const hits = prompt
        .split(/\n\n(?=路径：)/)
        .filter((b) => folder && /^内容：[\s\S]*/m.exec(b)?.[0].includes(folder))
        .map((b) => /^路径：(.+)$/m.exec(b)![1]!)
      return '```json\n' + JSON.stringify(hits) + '\n```'
    }
    case '归类和改名':
      return '```json\n' + JSON.stringify(fakeFiling(prompt)) + '\n```'
    case '整理这几张':
    case '整理这几段': {
      // AI整理（task-5ryf9）：写着「矩阵」的放一组，别的一组；白板上两张以上写着「矩阵」的头两张合成一张，补一句小结
      const items = [...prompt.matchAll(/^\[(\d+)\]\n([\s\S]*?)(?=\n\n\[\d+\]\n|$)/gm)].map((m) => ({ n: Number(m[1]), text: m[2]! }))
      const mx = items.filter((x) => x.text.includes('矩阵')).map((x) => x.n)
      const rest = items.filter((x) => !x.text.includes('矩阵')).map((x) => x.n)
      const groups = [...(mx.length ? [{ title: '矩阵乘法', items: mx }] : []), ...(rest.length ? [{ title: '其他', items: rest }] : [])]
      if (cmd === '整理这几段') return '```json\n' + JSON.stringify({ sections: groups.map((g) => ({ title: g.title, blocks: g.items })), drop: [] }) + '\n```'
      return '```json\n' + JSON.stringify({ groups: groups.map((g) => ({ title: g.title, cards: g.items })), merge: mx.length >= 2 ? [mx.slice(0, 2)] : [], drop: [], summary: '这几张讲了矩阵乘法和别的几件事。' }) + '\n```'
    }
    case '按反馈重做归类':
      return '```json\n' + JSON.stringify(fakeRedo(prompt)) + '\n```'
    default:
      return '这是测试回答。'
  }
}

/**
 * 测试用的归类和改名（梦游和 /整理收件箱 都问这个）：有课程属性的、内容里写着已有那门课的进那门课（导图改名「第 N 讲 … 导图」），
 * 旅行的进 剪藏/旅行，要写进周记的进 周记，琐事进 生活，别的拿不准
 */
function fakeFiling(prompt: string) {
  const out: { path: string; folder: string; name: string | null; why: string }[] = []
  const courses = (/优先用已有的：(.+?)。/.exec(prompt)?.[1] ?? '').split('、').filter((f) => f.startsWith('课程/')).map((f) => f.slice(3))
  for (const block of prompt.split(/\n\n(?=路径：)/)) {
    const path = /^路径：(.+)$/m.exec(block)?.[1]
    if (!path) continue
    const props = /^属性：(.+)$/m.exec(block)?.[1] ?? ''
    const text = /^内容：([\s\S]*)$/m.exec(block)?.[1] ?? ''
    const course = /课程: ([^；]+)/.exec(props)?.[1]
    const lecture = /第几讲: (\d+)/.exec(props)?.[1]
    // 导入的旧笔记：按原文件夹（学习/xx → 课程/xx，工作/xx → 项目/xx，生活 → 生活），「杂」里的拿不准
    const orig = /原文件夹: ([^；]+)/.exec(props)?.[1]
    if (orig && !/杂/.test(orig)) {
      const last = orig.split('/').pop()!
      const folder = /^学习/.test(orig) ? `课程/${last}` : /^工作/.test(orig) ? `项目/${last}` : '生活'
      out.push({ path, folder, name: null, why: `旧笔记在「${orig}」里，放进 ${folder}。` })
    } else if (course) {
      const map = /类型: 导图/.test(props)
      out.push({ path, folder: `课程/${course}`, name: map ? `第${lecture ?? '?'}讲 ${course} 导图` : null, why: `属性里写着课程「${course}」${lecture ? `、第${lecture}讲` : ''}，放进这门课。` })
    } else if (courses.some((c) => text.includes(c))) {
      const c = courses.find((x) => text.includes(x))!
      out.push({ path, folder: `课程/${c}`, name: null, why: `讲的是「${c}」这门课，放进这门课。` })
    } else if (/极光|冰洞|巴黎/.test(text)) out.push({ path, folder: '剪藏/旅行', name: null, why: '都是旅行的事' })
    else if (/周记/.test(text)) out.push({ path, folder: '周记', name: null, why: '要写进周记的' })
    else if (/花市|周末|买菜|房租/.test(text)) out.push({ path, folder: '生活', name: text.replace(/\s+/g, '').slice(0, 6), why: '日常的事，放生活' })
  }
  return out
}

/** 测试用的按反馈重做：说「写作」的把生活里的挪去写作，说「留在收件箱」的都挪回去，说「名字太长」的名字截短 */
function fakeRedo(prompt: string) {
  const said = /用户看了以后说：「([^」]*)」/.exec(prompt)?.[1] ?? ''
  const out: { path: string; folder: string; name: string | null; why: string }[] = []
  for (const block of prompt.split(/\n\n(?=路径：)/)) {
    const path = /^路径：(.+)$/m.exec(block)?.[1]
    const now = /^现在：挪到 (.+)，名字「(.*)」$/m.exec(block)
    if (!path || !now) continue
    const [, folder, name] = now
    if (/留在收件箱/.test(said)) out.push({ path, folder: '收件箱', name: null, why: '你说先留着' })
    else if (/写作/.test(said) && folder === '生活') out.push({ path, folder: '写作', name: name!, why: '你说这类放写作' })
    else if (/名字太长/.test(said)) out.push({ path, folder: folder!, name: name!.slice(0, 4), why: '名字改短了' })
  }
  return out
}
