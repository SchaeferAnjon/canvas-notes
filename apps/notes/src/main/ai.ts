/**
 * / 命令的一次性问答（不给工具，只读我们放进提示里的笔记）。
 * 用的是这台 Mac 上已经登录的 AI 命令行（AI 浮窗头部选的那家），不另存密钥。
 * CN_AI_FAKE=1 时不调模型，按命令给固定的回答（端到端测试用）。
 */
import { ask as engineAsk, askFast as engineAskFast } from './agent'

/** 用 AI 浮窗里选的引擎问一次（不给工具），onText 边生成边给；CN_AI_FAKE=1 时给固定回答 */
export async function ask(system: string, prompt: string, signal: AbortSignal, onText: (delta: string) => void = () => {}): Promise<string> {
  if (process.env.CN_AI_FAKE === '1') {
    const out = fake(prompt)
    onText(out)
    return out
  }
  return engineAsk(system, prompt, signal, onText)
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
    case '本周小结':
      return '这周主要在准备冰岛自驾，收件箱里多了几条极光和巴黎的剪藏，还没整理。'
    case '整理收件箱':
      return '```json\n' + JSON.stringify(names.map((path) => ({ path, topic: '旅行' }))) + '\n```'
    default:
      return '这是测试回答。'
  }
}
