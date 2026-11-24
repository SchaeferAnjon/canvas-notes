/**
 * 梦游 Wiki 化的 AI 判断（task-h7oy8，设计页 24-梦游底层 W.1 ④）：一篇 A 的几句话一起问一次，每句带全库里找到的几段候选；
 * AI 回：链不链、链哪一段（候选几）、哪一级（整篇 / 这一节 / 这一段）、这一节时那一节的标题（从那篇的标题列表里抄）、
 * A 里哪几个字变成链接、凭 B 的哪一句、把握，外加这句提到的那个东西叫什么（词条页建议用）。
 * 软件逐字核对（dream-wiki.ts）：那几个字真在这句里、那一节真在 B 里、那一句真在 B 里，对不上作废。
 * 原型（真库 40 条对 36 条）错的 3 条是链接落在候选给的那一节、不是 AI 理由里说的那一节：这一版让 AI 自己写标题，软件核对那个标题真在 B 里。
 * 不依赖 Electron 和 Node，评测脚本直接用。改了提示词把 WIKI_VERSION 加一（判过的按版本认、重判）。
 */

/** w1：第一版（原型的提示词 + AI 自己写标题 + thing）；w2：理由里不写代号（真库上一半理由写着「N4 这一节…」） */
export const WIKI_VERSION = 'w2'

export const WIKI_SYSTEM = '你替一个人整理笔记库，像维基百科那样把笔记里提到的东西链到库里讲它的地方。只根据给你的原文判断，不编造。只输出 JSON。'

export type WikiLevel = 'note' | 'heading' | 'block'
export const LEVEL_WORD: Record<WikiLevel, string> = { note: '整篇', heading: '这一节', block: '这一段' }
const LEVEL_OF: Record<string, WikiLevel> = { 整篇: 'note', 这一节: 'heading', 这一段: 'block' }

export interface WikiNoteInfo {
  /** 第几篇（N1、N2…） */
  title: string
  /** 这篇的标题（最多十几个，截短） */
  headings: string[]
}

export interface WikiCandInfo {
  /** 第几篇（notes 里的序号） */
  note: number
  /** 所在的节（没有是空串） */
  heading: string
  text: string
  /** 软件先猜的级别 */
  guess: WikiLevel
}

export interface WikiClauseInfo {
  /** 这句（链接只留字） */
  text: string
  /** A 里这句所在的节 */
  section: string
  cands: WikiCandInfo[]
}

/** 每段候选给 AI 看多少字 */
export const CLIP_P = 280

export function wikiPrompt(a: { title: string; clauses: WikiClauseInfo[]; notes: WikiNoteInfo[] }): string {
  const notes = a.notes
    .map((n, i) => `N${i + 1}《${n.title}》${n.headings.length ? `\n  这篇的标题：${n.headings.join('｜')}` : '（没有小标题）'}`)
    .join('\n')
  const clauses = a.clauses
    .map(
      (c, i) =>
        `C${i + 1}：${c.text}${c.section ? `（A 里所在的节：${c.section}）` : ''}\n` +
        c.cands
          .map((p, j) => `  P${j + 1}（N${p.note + 1}${p.heading ? ` › ${p.heading}` : ''}；软件猜：${LEVEL_WORD[p.guess]}）${p.text.length > CLIP_P ? p.text.slice(0, CLIP_P) + '…' : p.text}`)
          .join('\n'),
    )
    .join('\n\n')
  return `下面是笔记 A《${a.title}》里的 ${a.clauses.length} 句话，每句带几段从库里别的笔记找到的原文（候选 P）。像维基百科那样：A 里提到一个具体的东西（一个动作、一本书或一章、一个地方、一个人、一个概念、一个工具），库里正好有讲它的地方，就把 A 里那几个字变成链接，链过去。

每句判断：
- 链不链：候选讲的就是这句里提到的那个具体的东西，读到这句的人会想点进去看，才链。下面这些不链：只是同一个大领域；字面像、讲的却是另一回事（练胸的「蝴蝶机夹胸」和练肩后束的「反向飞鸟」）；候选只是顺带提一句、只在目录或计划表里列了个名字；地名、人名一样但指的不是同一个（同名的城市和大学）。
- 链哪一级 level：
  - "整篇"：那篇笔记的标题就是这个东西、整篇都在讲它；这个东西自己有一篇笔记时链那一篇，不链总页里提到它的那一行。
  - "这一节"：那篇有一节专讲它（那一节的标题就是它）。heading 写那一节的标题，从 N 后面「这篇的标题」里一字不差抄；候选所在的节讲的是别的、那篇另有一节专讲它时，写那一节。
  - "这一段"：那一节讲别的，只有这一段讲它。
  一句提到几样东西时各链各的；同一样东西几处都对时只挑最贴的一处。
- words：A 这句里要变成链接的那几个字，一字不差从这句里抄，就是那个东西的名字，越短越好（「双杠臂屈伸」，不要带重量、次数）。
- quote：从那段候选原文里一字不差抄一句（10 到 60 个字、不跨行），证明它讲的就是这个东西；"整篇"、"这一节" 可以写那篇或那一节的标题。
- confidence：你对「该链、链对了地方」的把握，0 到 1。很确定 0.9 以上；有点犹豫 0.6 到 0.8；说不准 0.5 左右。
- reason：一句中文，说 B 那里讲的是什么；不要写 N1、P2、C3 这种代号，写名字。
- thing：这句话提到的最主要的那个具体东西叫什么（地名、人名、书名、动作名……照这句里的写法），没有写 ""。链不链都写。

只输出一个 JSON 代码块，每句一项，按 C1、C2… 的顺序；不链的句子 links 写 []：
\`\`\`json
[{"c": 1, "links": [{"p": 2, "level": "这一节", "heading": "…", "words": "…", "quote": "…", "confidence": 0.9, "reason": "…"}], "thing": "…"}]
\`\`\`

=== 候选所在的笔记 ===
${notes}

=== A 里的句子和候选 ===
${clauses}`
}

/** 这段话是不是梦游 Wiki 判断（测试的假 AI 认它） */
export const isWikiPrompt = (prompt: string) => /^下面是笔记 A《.*》里的 \d+ 句话/.test(prompt)

export interface WikiAnswer {
  /** 第几句（0 起） */
  clause: number
  links: { cand: number; level: WikiLevel; heading: string; words: string; quote: string; confidence: number; reason: string }[]
  thing: string
}

function jsonArray(reply: string): unknown[] | null {
  const tries = [...reply.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!).reverse()
  const a = reply.indexOf('[')
  const b = reply.lastIndexOf(']')
  if (a >= 0 && b > a) tries.push(reply.slice(a, b + 1))
  for (const t of tries) {
    try {
      const x: unknown = JSON.parse(t.trim())
      if (Array.isArray(x)) return x
    } catch {
      // 下一种
    }
  }
  return null
}

/** 读回答：坏的、缺的那几句不给（当没判，下次再问）；一句都读不出来是 null */
export function parseWiki(reply: string, clauses: number, cands: (c: number) => number): WikiAnswer[] | null {
  const arr = jsonArray(reply)
  if (!arr) return null
  const out: WikiAnswer[] = []
  arr.forEach((x, k) => {
    if (!x || typeof x !== 'object') return
    const o = x as Record<string, unknown>
    const c = typeof o.c === 'number' ? o.c - 1 : typeof o.c === 'string' && /^C?\d+$/i.test(o.c) ? Number(o.c.replace(/^C/i, '')) - 1 : k
    if (c < 0 || c >= clauses || out.some((y) => y.clause === c)) return
    const links: WikiAnswer['links'] = []
    for (const l of Array.isArray(o.links) ? o.links : []) {
      if (!l || typeof l !== 'object') continue
      const r = l as Record<string, unknown>
      const p = typeof r.p === 'number' ? r.p - 1 : typeof r.p === 'string' && /^P?\d+$/i.test(r.p) ? Number(r.p.replace(/^P/i, '')) - 1 : -1
      const level = LEVEL_OF[String(r.level ?? '')]
      const conf = Number(r.confidence)
      if (p < 0 || p >= cands(c) || !level || typeof r.words !== 'string' || !r.words.trim()) continue
      links.push({ cand: p, level, heading: String(r.heading ?? '').trim(), words: r.words.trim(), quote: String(r.quote ?? '').trim(), confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0, reason: String(r.reason ?? '').trim().slice(0, 200) })
    }
    out.push({ clause: c, links: links.slice(0, 4), thing: typeof o.thing === 'string' ? o.thing.trim().slice(0, 30) : '' })
  })
  return out
}
