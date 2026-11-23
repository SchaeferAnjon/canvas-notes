/**
 * iPhone / iPad 问的一问拼成给 AI 的话（task-wwqf0）。Mac 上跑 Claude Code / Codex 用这里拼的；Mac 连不上、走云端时 iPad 自己拼，
 * 照的是同一份（apps/apple/CanvasCore/Sources/CanvasCore/AI/MobileAIPrompt.swift，ai-fixtures 对照），两条路 AI 看到的字一样。
 *
 * 照电脑版的规矩：
 * - 讲解一下、翻译 + 讲一讲的问法和读 PDF 一样（「给我讲解一下」「先把这块翻译成中文，再讲一讲」，reading/prompts.ts 的 askPrompt 那几句）；
 * - 每条消息开头一行【语言】（task-zojmg：默认跟界面语言，用别的语言问就跟着问的语言答）。电脑版后来改成软件看字定、交给 AI 一句直接的话
 *   （shared/answer-lang.ts 的 answerRule），手机这一路和 Swift 那份（MobileAIPrompt.swift）对照着，还是让 AI 自己判断的那句，两边一起改；
 * - 设置 › AI「给AI的长期说明」放在最前面（agent/modes.ts 的 userNoteLine）；
 * - 不接着会话聊：每一问都开新会话，前面聊过的几轮（最近 10 条、每条 600 字）放在最前面（agent/index.ts 的 historyOf）。
 *   所以没有「系统提示改了、旧会话还用旧的」的问题，用不着 AGENT_VERSION 那样记版本；系统提示改了下一问就用上。
 * 这一路只回答、不动手（AI 动手改笔记要先在 iPad 上确认，第二块做）。纯函数，不碰 Electron。
 */
import { MATH_RULE } from '../../shared/reading'
import { CITE_RULE } from '../../shared/cite-rule'

export type AskKind = 'chat' | 'explain' | 'translate' | 'ask' | 'cmd'

export type AskSource =
  | { kind: 'pdf'; title: string; path: string; page: number; pages: number; pageText?: string }
  | { kind: 'web'; title: string; url: string; text?: string }
  | { kind: 'note'; title: string; path: string; text?: string }

export interface AskTurn {
  role: 'user' | 'ai'
  text: string
}

export interface MobileAsk {
  /**
   * chat：AI 对话里问；explain：讲解一下；translate：翻译 + 讲一讲；ask：选中一段以后自己打的问题；
   * cmd：/ 命令（text 是 iPad 照 shared/cmd-run.ts 拼好的整段话：AI 只给要加什么，字由 iPad 拼进笔记、先给他看、点「好」才写）
   */
  kind: AskKind
  /** 自己打的话（chat、ask）；explain、translate 不看它 */
  text: string
  /** 选中的那段字 */
  quote?: string
  /** 在看什么 */
  source?: AskSource
  /** 这一段对话前面几轮 */
  history?: AskTurn[]
  /** 界面语言 */
  lang?: 'zh' | 'en'
  /** 在哪台设备上问的（「iPad」「iPhone」） */
  device?: string
  /** 设置 › AI 的长期说明：Mac 那一路用 Mac 自己设置里的，云端那一路 iPad 带着上一次从 Mac 拿到的 */
  note?: string
  /** 用 Pencil 圈的那一块截图（PNG 的 base64）：和这一问一起给 AI 看 */
  image?: string
}

/** 讲解一下、翻译 + 讲一讲发出去的话（和电脑版读 PDF 一字不差） */
export const EXPLAIN_Q = '给我讲解一下'
export const TRANSLATE_Q = '先把这块翻译成中文，再讲一讲'
export const EXPLAIN_PAGE_Q = '给我讲解一下这一页'

/** AI 对话（不动手）的系统提示 */
export const CHAT_SYSTEM = `你是 Canvas Notes 笔记软件里的助手，帮一个人整理和弄懂自己的笔记。他在 iPhone 或 iPad 上问你，问题经他自己的 Mac 转过来（Mac 连不上时直接发到云端）。

规矩：
- 这一路你只回答，不动手：不改文件、不跑命令、不建任务。要他自己去做的事，写清楚在哪、怎么做。
- 每条消息开头写着他在看什么（PDF 的哪一页、网页、笔记），用得上就用。
- 回答用哪种语言照每条消息开头的【语言】；平实、直接，不客套。不编造他的笔记里没有的事。
- 回答显示在手机上：段落短一点，需要时用小标题和列表。
- ${MATH_RULE}

${CITE_RULE}`

/** 讲解一下、翻译 + 讲一讲、选一段问（照读 PDF 的 TUTOR_SYSTEM 讲法那几行；这一路不动手） */
export const TUTOR_SYSTEM = `你在 Canvas Notes 里陪一个人读 PDF 课件、网页和笔记。他在 iPhone 或 iPad 上选中一段来问你，问题经他自己的 Mac 转过来（Mac 连不上时直接发到云端）。
把这件事真讲明白：先一句话说清它是什么，再按一条线讲下去：为什么要有它、每一项在干什么、拿一个具体数字或例子走一遍。需要时用小标题和列表。
长短看问题：「讲解一下」要讲透，不怕长；接着问的小问题简短回答。
${MATH_RULE}提到别的页写成 [第 4 页](#page=4)。
他说「还是不懂」「换个方式讲」：上一版就是没讲通，换一个完全不同的角度（比方、画面、具体数字、反例），不要换个说法重复。
这一路你只回答，不动手：不改文件、不跑命令。你的回答会原样写进他这份 PDF（或网页、笔记）配对的那篇笔记。
回答用哪种语言照每条消息开头的【语言】。
${CITE_RULE}`

/** 每条消息开头的【语言】（和 Swift 的 MobileAIPrompt.langLine 同一句） */
export function langLine(lang: 'zh' | 'en' = 'zh'): string {
  return `【语言】默认用${lang === 'en' ? '英文' : '中文'}回答；用户用别的语言问，就用他问的那种语言答。`
}

/** 设置 › AI「给AI的长期说明」（agent/modes.ts 的 userNoteLine 同一句） */
export const noteLine = (note: string) => `【用户的长期说明】每一问都照这个来：\n${note}\n`

/** 前面聊过的几轮（agent/index.ts 的 historyOf 同一个样子） */
export function historyText(turns: AskTurn[] = []): string {
  const recent = turns.filter((t) => t.text).slice(-10)
  if (!recent.length) return ''
  return `之前聊过的（供参考）：\n${recent.map((t) => `${t.role === 'user' ? '用户' : 'AI'}：${t.text.slice(0, 600)}`).join('\n')}`
}

const PAGE_NO_TEXT = '（这一页没有能选的字，是图片或扫描件）'

/** 这一问问的那句：讲解一下、翻译 + 讲一讲是固定的；没选中字的讲解一下是问这一页 */
export function questionOf(a: MobileAsk): string {
  if (a.kind === 'explain') return a.quote || a.image ? EXPLAIN_Q : EXPLAIN_PAGE_Q
  if (a.kind === 'translate') return TRANSLATE_Q
  return a.text.trim()
}

/** 在看什么：一两行（AI 对话里问时） */
function where(s: AskSource | undefined): string {
  if (!s) return ''
  if (s.kind === 'pdf') return `他在看 PDF「${s.title}」第 ${s.page} 页（共 ${s.pages} 页）。这一页的文字：\n<page>\n${s.pageText || PAGE_NO_TEXT}\n</page>`
  if (s.kind === 'web') return `他在看网页「${s.title}」（${s.url}）${s.text ? `，这一屏的字：\n<web>\n${s.text}\n</web>` : '。'}`
  return `他在看笔记「${s.title}」（${s.path}）${s.text ? `，正文：\n<note>\n${s.text}\n</note>` : '。'}`
}

/** 选中一段问（讲解一下、翻译 + 讲一讲、自己打的问题）：照 askPrompt 的说法 */
function readingAsk(a: MobileAsk, q: string): string {
  const s = a.source
  const out: string[] = []
  const picked = a.quote ? `他选中了这段字：「${a.quote}」。` : s?.kind === 'pdf' ? (a.image ? '他在这一页上框了一块，就是附上的图。' : '他问的是整页。') : ''
  if (s?.kind === 'pdf') {
    out.push(`他现在在看第 ${s.page} 页（共 ${s.pages} 页），PDF「${s.title}」。这一页的文字：\n<page>\n${s.pageText || PAGE_NO_TEXT}\n</page>`)
  } else if (s?.kind === 'web') {
    out.push(`他在看网页「${s.title}」（${s.url}）${s.text ? `，选中那段前后的字：\n<web>\n${s.text}\n</web>` : '。'}`)
  } else if (s?.kind === 'note') {
    out.push(`他在看笔记「${s.title}」（${s.path}）${s.text ? `，正文：\n<note>\n${s.text}\n</note>` : '。'}`)
  }
  out.push(`${picked ? picked + '\n' : ''}他说：${q}`)
  return out.join('\n\n')
}

export interface BuiltPrompt {
  system: string
  /** 系统提示附在命令行自己的后面（读 PDF 那样，读用户设置里的讲解偏好），不整个换掉 */
  appendSystem: boolean
  prompt: string
}

/** / 命令的系统提示：电脑版 renderer/ai-commands.ts 的 system() 那几句，语言那句照这一问的界面语言（和 Swift 的 cmdSystem 同一句） */
export const cmdSystem = (lang: 'zh' | 'en' = 'zh') => `你是 Canvas Notes 笔记软件里的助手，帮一个人整理和写作自己的笔记。
默认用${lang === 'en' ? '英文' : '中文'}回答；用户用别的语言问，就用他问的那种语言答；平实、直接，不客套，不重复问题。笔记内容在用户消息里，只根据这些内容回答，不编造没有的事。
${MATH_RULE}`

export function buildPrompt(a: MobileAsk): BuiltPrompt {
  // / 命令：话已经照电脑版拼好（命令：… 文件：… 只输出 JSON……），原样交给 AI
  if (a.kind === 'cmd') return { system: cmdSystem(a.lang), appendSystem: false, prompt: a.text }
  const q = questionOf(a)
  const head = [historyText(a.history), a.note?.trim() ? noteLine(a.note.trim()) : '', langLine(a.lang), a.device ? `他在${a.device}上问你。` : ''].filter(Boolean)
  if (a.kind === 'chat') {
    const w = where(a.source)
    return { system: CHAT_SYSTEM, appendSystem: false, prompt: [...head, ...(w ? [w] : []), `用户说：\n${q}`].join('\n\n') }
  }
  return { system: TUTOR_SYSTEM, appendSystem: true, prompt: [...head, readingAsk(a, q)].join('\n\n') }
}

// ---------------------------------------------------------------- 收到的请求查一遍

const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max
const opt = (x: unknown, max: number) => x === undefined || str(x, max)

/** iPad 送来的一问：形状、长度不对的不收（抛错，回 400） */
export function checkAsk(x: unknown): MobileAsk {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const bad = () => new Error('请求不对')
  if (!['chat', 'explain', 'translate', 'ask', 'cmd'].includes(o.kind as string) || !str(o.text, o.kind === 'cmd' ? 120_000 : 20_000)) throw bad()
  // 圈的那一块截图：PNG 的 base64，最多约 4.5 MB
  if (o.image !== undefined && (!str(o.image, 6_000_000) || !/^[A-Za-z0-9+/]+=*$/.test(o.image as string))) throw bad()
  if (!opt(o.quote, 20_000) || !opt(o.note, 4000) || !opt(o.device, 40) || (o.lang !== undefined && o.lang !== 'zh' && o.lang !== 'en')) throw bad()
  if ((o.kind === 'chat' || o.kind === 'ask' || o.kind === 'cmd') && !(o.text as string).trim()) throw bad()
  let history: AskTurn[] | undefined
  if (o.history !== undefined) {
    if (!Array.isArray(o.history) || o.history.length > 40) throw bad()
    history = o.history.map((t: { role?: unknown; text?: unknown }) => {
      if ((t?.role !== 'user' && t?.role !== 'ai') || !str(t.text, 40_000)) throw bad()
      return { role: t.role, text: t.text }
    })
  }
  let source: AskSource | undefined
  if (o.source !== undefined) {
    const s = o.source as Record<string, unknown>
    if (!str(s?.title, 400)) throw bad()
    if (s.kind === 'pdf') {
      if (!str(s.path, 2000) || !Number.isInteger(s.page) || !Number.isInteger(s.pages) || (s.page as number) < 1 || !opt(s.pageText, 60_000)) throw bad()
      source = { kind: 'pdf', title: s.title as string, path: s.path as string, page: s.page as number, pages: s.pages as number, ...(s.pageText ? { pageText: s.pageText as string } : {}) }
    } else if (s.kind === 'web') {
      if (!str(s.url, 4000) || !/^https?:\/\//i.test(s.url as string) || !opt(s.text, 60_000)) throw bad()
      source = { kind: 'web', title: s.title as string, url: s.url as string, ...(s.text ? { text: s.text as string } : {}) }
    } else if (s.kind === 'note') {
      if (!str(s.path, 2000) || !opt(s.text, 60_000)) throw bad()
      source = { kind: 'note', title: s.title as string, path: s.path as string, ...(s.text ? { text: s.text as string } : {}) }
    } else throw bad()
  }
  return {
    kind: o.kind as AskKind,
    text: o.text as string,
    ...(o.quote ? { quote: o.quote as string } : {}),
    ...(source ? { source } : {}),
    ...(history ? { history } : {}),
    ...(o.lang ? { lang: o.lang as 'zh' | 'en' } : {}),
    ...(o.device ? { device: o.device as string } : {}),
    ...(o.note ? { note: o.note as string } : {}),
    ...(o.image ? { image: o.image as string } : {}),
  }
}
