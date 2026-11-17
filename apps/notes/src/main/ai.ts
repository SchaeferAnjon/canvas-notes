/**
 * / 命令的一次性问答（不给工具，只读我们放进提示里的笔记）。
 * 用的是这台 Mac 上已经登录的 AI 命令行（AI 浮窗头部选的那家），不另存密钥。
 * CN_AI_FAKE=1 时不调模型，按命令给固定的回答（端到端测试用）。
 */
import type { AiFeature } from '../shared/ai-features'
import { ask as engineAsk, askFast as engineAskFast } from './agent'

/** 用设置 › AI 里这个功能选的引擎问一次（不给工具；/ 命令是 AI 对话，梦游是梦游），onText 边生成边给；CN_AI_FAKE=1 时给固定回答 */
export async function ask(system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void = () => {}, feature: AiFeature = 'chat'): Promise<string> {
  if (process.env.CN_AI_FAKE === '1') {
    const out = fake(prompt)
    onText(out)
    return out
  }
  return engineAsk(system, prompt, signal, onText, feature)
}

/** 用快模型问一次（翻译用）：Claude Code 的 Haiku；CN_AI_FAKE=1 时给固定回答 */
export async function askFast(system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void = () => {}): Promise<string> {
  if (process.env.CN_AI_FAKE === '1') {
    // 假装要想一会儿（CN_AI_FAKE_DELAY_MS，默认 300 毫秒），界面上看得到「翻译中」；一行一行吐，和真模型一样
    await new Promise((r) => setTimeout(r, Number(process.env.CN_AI_FAKE_DELAY_MS) || 300))
    const out = fake(prompt)
    for (const line of out.split(/(?<=\n)/)) onText(line)
    return out
  }
  return engineAskFast(system, prompt, signal, onText)
}

/** 测试用的固定回答：提示第一行是「命令：xxx」 */
function fake(prompt: string): string {
  const cmd = /^命令：(\S+)/.exec(prompt)?.[1]
  const names = [...prompt.matchAll(/^路径：(.+)$/gm)].map((m) => m[1]!)
  switch (cmd) {
    case '总结':
      return '这块白板讲了三件事：住处还没订、极光看哪两晚、还没订的车。'
    case '写成文章':
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
    case '整理收件箱':
      return '```json\n' + JSON.stringify(names.map((path) => ({ path, topic: '旅行' }))) + '\n```'
    case '归类和改名':
      return '```json\n' + JSON.stringify(fakeFiling(prompt)) + '\n```'
    case '按反馈重做归类':
      return '```json\n' + JSON.stringify(fakeRedo(prompt)) + '\n```'
    default:
      return '这是测试回答。'
  }
}

/** 测试用的归类和改名：有课程属性的进那门课（导图改名「第 N 讲 … 导图」），旅行的进 素材/旅行，琐事进 生活，别的拿不准 */
function fakeFiling(prompt: string) {
  const out: { path: string; folder: string; name: string | null; why: string }[] = []
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
    } else if (/极光|冰洞|巴黎/.test(text)) out.push({ path, folder: '素材/旅行', name: null, why: '都是旅行的事' })
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
