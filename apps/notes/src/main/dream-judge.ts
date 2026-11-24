/**
 * 梦游补双链的判断在软件里怎么用（task-h7oy8，设计页 24-梦游底层 2.1、2.2）：找候选 → 判断 → 给证据 → 把握 → 过线才提。
 * 问 AI 的话、读回答、原话核对、过线的线都在 shared/dream-judge.ts（评测那一路调好、在真库上量过的那一份，这里不改字）；
 * 这里管：给 AI 看的正文怎么清（照评测脚本的 cleanText）、候选先后、把回答落成「补双链 / 拿不准 / 可能重复 / 建议去掉旧行 / 不提」，
 * 以及测试用的假判断。纯函数，不碰 Electron，单元测试直接跑。
 */
import { createHash } from 'node:crypto'
import { titleOf } from '../shared/layout'
import { JUDGE_SYSTEM, JUDGE_VERSION as PROMPT_VERSION, type JudgeKind, judgePrompt as sharedPrompt, LINK_ASK, LINK_PASS, LINK_PASS_CODEX, LINK_PASS_HAIKU, linkDecision, parseJudgements, quoteFound } from '../shared/dream-judge'

export { JUDGE_SYSTEM }

export type Level = 'same-content' | 'same-topic' | 'tangential' | 'unrelated' | 'unsure'
const LEVEL_OF: Record<JudgeKind, Level> = { 同一内容: 'same-content', 同一主题: 'same-topic', 只是沾边: 'tangential', 无关: 'unrelated', 拿不准: 'unsure' }
const KIND_OF = Object.fromEntries(Object.entries(LEVEL_OF).map(([k, v]) => [v, k])) as Record<Level, JudgeKind>

/** 把握到这个数才提（补双链、可能重复、建议去掉旧的「相关：」）：评测那一路在真库上定的线 */
export const SURE = LINK_PASS
/** 把握在 UNSURE 到 SURE 之间的进「拿不准，你来定」 */
export const UNSURE = LINK_ASK

/** 判过的一对：a 是被判的这篇，b 是候选 */
export interface Judgement {
  a: string
  b: string
  level: Level
  confidence: number
  why: string
  quoteA: string
  quoteB: string
}

/** 一对判完以后梦游怎么处理 */
export type Verdict =
  /** 补双链 */
  | 'link'
  /** 拿不准，你来定 */
  | 'unsure'
  /** 可能重复（换了语言、换了说法的同一内容） */
  | 'dup'
  /** 旧「相关：」行判成不相关：建议去掉 */
  | 'remove'
  /** 不提（沾边、无关、旧行判下来没问题） */
  | 'skip'
  /** 原话对不上，作废 */
  | 'void'

/** 一篇候选：existing 是这篇末尾已经有「相关：[[它]]」（复查） */
export interface Cand {
  path: string
  text: string
  /** 向量那一路带回来的、最像的那一段（给 AI 看的摘录里一定带上） */
  passage?: string
  existing?: boolean
}

/** 去掉开头的 front matter（属性） */
export const bodyOf = (t: string) => t.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')

const LINK = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g
/** 这些节是链接列表，不是正文（同评测脚本） */
const LINK_SECTION = /^#{1,6}\s*(?:\d+[.、]\s*)?(?:[^\p{L}\p{N}]\s*)?(related|相关|see also|siblings|同层|parent|父笔记|children|子笔记|cross-?ref|关联|与.{0,20}的关系|延伸阅读|backlinks?|反向链接|链接|导航|上一篇|下一篇|prev|next)/iu

/**
 * 给 AI 看、拿来核对原话的正文（照评测脚本 eval/dream-real/vault.ts 的 cleanText，判法在真库上量的就是这样清过的字）：
 * 去掉属性、链接列表那几节、几乎只有链接的行（「相关：[[…]]」也在里面）、注释、图、网址，[[名字]] 换成名字
 */
export function judgeText(raw: string): string {
  const out: string[] = []
  let skip = 0
  let fence = false
  for (const line of bodyOf(raw.replace(/^﻿/, '')).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = fence ? null : /^(#{1,6})\s/.exec(line)
    if (h) {
      const level = h[1]!.length
      if (skip && level > skip) continue
      skip = LINK_SECTION.test(line) ? level : 0
      if (skip) continue
    } else if (skip) continue
    if ([...line.matchAll(LINK)].length && line.replace(LINK, '').replace(/[\s\-*+>|·•,，、:：;；()（）[\]【】—–]+/g, '').replace(/^相关/, '').length < 12) continue
    out.push(line)
  }
  return out
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(LINK, (_m, name: string, alias?: string) => alias?.trim() || name.trim().split('/').pop()!.replace(/\.md$/i, ''))
    .replace(/\[([^\]]*)\]\((?:https?:|\.|\/)[^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>\n]{1,200}>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 候选的先后按 A、B 两篇的名字定一个固定的乱序（设计页：防 AI 偏向前面那篇；固定是为了重跑结果一样） */
export function shuffled<T extends { path: string }>(a: string, cands: T[]): T[] {
  const h = (p: string) => createHash('sha1').update(a + '\0' + p).digest('hex')
  return [...cands].sort((x, y) => h(x.path).localeCompare(h(y.path)))
}

/** 向量那一路找到的最像那一段不在开头的摘录里：接到正文最前面，AI 一定看得到 */
const withPassage = (text: string, passage: string | undefined, max: number) => (passage && text.length > max && !text.slice(0, max).includes(passage.slice(0, 40)) ? `${passage.slice(0, Math.floor(max / 2))}……\n${text}` : text)

/** 问 AI 的那段话（shared 那一份）；ids 是 B1、B2… 对应的候选路径 */
export function judgePrompt(note: { path: string; text: string }, cands: Cand[]): { prompt: string; ids: string[] } {
  const list = shuffled(note.path, cands)
  const prompt = sharedPrompt(
    { title: titleOf(note.path), text: judgeText(note.text) },
    list.map((c) => ({ title: titleOf(c.path), text: withPassage(judgeText(c.text), c.passage, 1000) })),
  )
  return { prompt, ids: list.map((c) => c.path) }
}

/** 这段话是不是梦游判断（测试的假 AI 认它、记它） */
export const isJudgePrompt = (prompt: string) => /^下面是一篇笔记 A 和 \d+ 篇候选 B/.test(prompt)

/** 读 AI 的回答：每个 B 一条；没回的不算（当没判，下次再问）；一条都读不出来算没判成 */
export function parseJudge(reply: string, a: string, ids: string[]): Judgement[] {
  const got = parseJudgements(reply, ids.length)
  if (!got.length && ids.length) throw new Error('AI 没给出能读的判断')
  return got.map((j) => ({ a, b: ids[j.index]!, level: LEVEL_OF[j.kind], confidence: j.confidence, why: j.reason.trim().slice(0, 200), quoteA: j.quoteA.trim(), quoteB: j.quoteB.trim() }))
}

/** 原话真在原文里（不管空白和标点，至少 6 个字） */
export const quoteIn = (quote: string, text: string) => quoteFound(quote, judgeText(text))

/** 这一路判断的线（评测那一路在真库上定的）：pass 是自动连的把握线（Haiku 偏乐观提到 0.85，Codex 更满提到 0.95） */
export interface JudgeLine {
  pass: number
}
export const DEFAULT_LINE: JudgeLine = { pass: LINK_PASS }
export function judgeLine(j: { engine: string; model: string }): JudgeLine {
  if (j.engine === 'codex') return { pass: LINK_PASS_CODEX }
  return { pass: /haiku/i.test(j.model) ? LINK_PASS_HAIKU : LINK_PASS }
}

/** 判完一对怎么处理：过线才提，原话对不上作废（设计页 2.2「过线」；线和核对照 shared 的 linkDecision） */
export function verdictOf(j: Judgement, aText: string, bText: string, existing = false, line: JudgeLine = DEFAULT_LINE): Verdict {
  return verdictAt(j, aText, bText, existing, line.pass)
}

function verdictAt(j: Judgement, aText: string, bText: string, existing: boolean, pass: number): Verdict {
  if (existing) {
    // 复查旧的「相关：」：判成沾边、无关又有把握才建议去掉；理由要有，原话不强求（不相干的两篇本来抄不出相干的话）
    return (j.level === 'unrelated' || j.level === 'tangential') && j.confidence >= pass && j.why ? 'remove' : 'skip'
  }
  const a = judgeText(aText)
  const b = judgeText(bText)
  if (j.level === 'same-content') {
    if (!quoteFound(j.quoteA, a) || !quoteFound(j.quoteB, b)) return 'void'
    return j.confidence >= pass ? 'dup' : j.confidence >= UNSURE ? 'unsure' : 'skip'
  }
  const d = linkDecision({ index: 0, kind: KIND_OF[j.level], reason: j.why, quoteA: j.quoteA, quoteB: j.quoteB, confidence: j.confidence }, a, b, pass)
  if (d === 'link') return 'link'
  if (d === 'ask') return 'unsure'
  // 同一主题、把握够却抄不出原话：作废（和不提分开数）
  return j.level === 'same-topic' && j.confidence >= UNSURE && (!quoteFound(j.quoteA, a) || !quoteFound(j.quoteB, b)) ? 'void' : 'skip'
}

/** 一档的中文名（报告里写） */
export const LEVEL_NAME: Record<Level, string> = {
  'same-content': '同一内容',
  'same-topic': '同一主题',
  tangential: '只是沾边',
  unrelated: '无关',
  unsure: '拿不准',
}

/** 判断结果按这个版本认：提示词、判法变了整库重判（花额度） */
export const JUDGE_VERSION = `p${PROMPT_VERSION}`

/**
 * 测试用的判断（CN_AI_FAKE=1 和单元测试）：
 * - 笔记里写着「（测试判断：极光预报=same-topic:0.9；巴黎=unsure:0.6）」的照写的判（名字是候选的标题）；
 * - 没写的按两篇共同的词（英文词、中文两个字一片，去掉很常见的）：两篇的词一半以上（至少 8 个）相同算同一内容 0.9，
 *   中文三片以上或两个以上相同的英文专名算同一主题 0.9，否则无关 0.9。原话各取两篇正文的第一句（原样），核对得上。
 */
export function fakeJudge(prompt: string): string {
  const blocks = [...prompt.matchAll(/^=== (A|B\d+) ===\n标题：(.+)\n正文：\n([\s\S]*?)(?=\n\n=== B\d+ ===|(?![\s\S]))/gm)].map((m) => ({ id: m[1]!, title: m[2]!, text: m[3]! }))
  const a = blocks.find((b) => b.id === 'A')
  if (!a) return '```json\n[]\n```'
  const said = new Map<string, [Level, number]>()
  for (const m of a.text.matchAll(/测试判断：([^）)]+)/g))
    for (const part of m[1]!.split(/[；;]/)) {
      const x = /^\s*(.+?)=([a-z-]+):([\d.]+)\s*$/.exec(part)
      if (x) said.set(x[1]!, [x[2] as Level, Number(x[3])])
    }
  const first = (t: string) =>
    (t.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.includes('测试判断') && !l.startsWith('标签：')) ?? '')
      .split(/(?<=[。！？.!?])/)[0]!
      .replace(/…$/, '')
      .trim()
      .slice(0, 50)
  const words = (t: string) => {
    const s = new Set<string>()
    const body = t.replace(/^#+ .*$/gm, '')
    // 英文只算 6 个字母以上、不是常用词的（假判断不能因为 the、which、between 这种词连上）
    const common = new Set(['between', 'during', 'through', 'because', 'however', 'without', 'within', 'around', 'should', 'another', 'before', 'people', 'called', 'number', 'second', 'including', 'several', 'became', 'important'])
    for (const w of body.toLowerCase().match(/[a-z]{6,}/g) ?? []) if (!common.has(w)) s.add(w)
    for (const run of body.match(/\p{Script=Han}+/gu) ?? []) for (let i = 0; i + 1 < run.length; i++) s.add(run.slice(i, i + 2))
    for (const w of ['测试', '判断', '相关', '这个', '一个', '我们', '他们', '没有', '什么', '可以', '就是', '还是']) s.delete(w)
    return s
  }
  // 名字一样不等于讲同一件事：B 的标题不算进 A 的词里
  const wa = (b: string) => words(a.text.split(b).join(' '))
  const pairs = blocks
    .filter((b) => b.id !== 'A')
    .map((b) => {
      const pick = said.get(b.title)
      const A = wa(b.title)
      const B = words(b.text)
      const shared = [...B].filter((w) => A.has(w)).length
      const same = shared >= 8 && shared / Math.max(1, A.size, B.size) >= 0.5
      // 英文长文之间碰巧同几个词的多：英文只看两篇都有的专名（句中大写的词，Feynman、Claude），两个以上算同一主题；中文两字片 3 个
      const en = [...B].filter((w) => A.has(w) && /^[a-z]/.test(w)).length
      const names = (t: string) => new Set([...t.matchAll(/(?<=[a-z,;] )([A-Z][a-z]{3,})/g)].map((m) => m[1]!))
      const na = names(a.text)
      const topic = shared - en >= 3 || [...names(b.text)].filter((w) => na.has(w)).length >= 2
      const [level, confidence] = pick ?? (same ? ['same-content', 0.9] : topic ? ['same-topic', 0.9] : ['unrelated', 0.9])
      const quotes = level === 'same-topic' || level === 'same-content' || level === 'unsure'
      return {
        b: Number(b.id.slice(1)),
        kind: KIND_OF[level],
        reason: level === 'unrelated' ? `「${b.title}」讲的是别的事` : level === 'same-content' ? '两篇大半是同一段内容' : `两篇都讲「${b.title}」那件事`,
        quote_a: quotes ? first(a.text) : '',
        quote_b: quotes ? first(b.text) : '',
        confidence,
      }
    })
  return '```json\n' + JSON.stringify(pairs) + '\n```'
}
