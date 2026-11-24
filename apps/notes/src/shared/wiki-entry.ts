/**
 * 词条页（task-h7oy8，设计页 24-梦游底层 W.4，用户定 C1「只建议，点了才建」）：
 * 梦游建议「库里 3 篇以上提到海德堡、没有讲它的一篇」，你在报告或相关栏顶上点「建词条页」，AI 照库里讲它的那几段起草：
 * 开头两三句导语（每句挂出处，放在 [!ai] 块里，看得出是 AI 写的），下面按意思分组，讲它的段嵌进来（![[B#^块编号]]，活的，原文改了这里跟着变），
 * 只顺带提到的列成一行链接加那一句原话。不抄原文。
 * 问 AI 的话、读回答、拼成 md 都在这里（不依赖 Electron 和 Node）；找段、加块编号、写文件在 main/wiki-entry-main.ts。
 */

export interface EntrySource {
  /** 第几条（1 起） */
  n: number
  title: string
  /** 所在的节 */
  heading: string
  text: string
}

export const ENTRY_SYSTEM = '你替一个人整理笔记库，给库里反复提到的一个东西起草一页词条。只根据给你的原文写，不编造。只输出 JSON。'

export function entryPrompt(name: string, srcs: EntrySource[]): string {
  return `命令：起草词条页
库里好几篇笔记提到「${name}」，还没有专门讲它的一篇。下面是提到它的 ${srcs.length} 段原文。照维基百科词条的样子起草一页，但正文几乎全是库里原有的段落：

- lead：开头两三句导语，说「${name}」是什么、这个人和它有什么关系；每句只能用下面原文里有的事实，src 写依据的是第几段（可以几段）。
- groups：按意思分成两到四组（比如「历史」「生活」「学校」），name 是组名（两到六个字）；items 是这一组收哪几段，embed 写 true 的是认真讲它的段（整段嵌进来），false 的是只顺带提到（列成一行链接加那一句）。
- skip：和「${name}」这个东西其实无关的段（同名的另一个东西、只是课在那里上），不收。
每一段只能出现在一处（某一组或 skip）。

只输出一个 JSON 代码块：
\`\`\`json
{"lead": [{"text": "…", "src": [1]}], "groups": [{"name": "…", "items": [{"n": 1, "embed": true}]}], "skip": [3]}
\`\`\`

${srcs.map((s) => `[${s.n}]《${s.title}》${s.heading ? ` › ${s.heading}` : ''}\n${s.text}`).join('\n\n')}`
}

export const isEntryPrompt = (prompt: string) => /^命令：起草词条页/.test(prompt)

export interface EntryDraft {
  lead: { text: string; src: number[] }[]
  groups: { name: string; items: { n: number; embed: boolean }[] }[]
}

/** 读回答：编号不对的去掉，同一段只留第一次；没有能用的组时 null */
export function parseEntry(reply: string, count: number): EntryDraft | null {
  const blocks = [...reply.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!).reverse()
  const a = reply.indexOf('{')
  const b = reply.lastIndexOf('}')
  if (a >= 0 && b > a) blocks.push(reply.slice(a, b + 1))
  for (const t of blocks) {
    let x: unknown
    try {
      x = JSON.parse(t.trim())
    } catch {
      continue
    }
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= count
    const used = new Set<number>()
    const groups: EntryDraft['groups'] = []
    for (const g of Array.isArray(o.groups) ? o.groups : []) {
      if (!g || typeof g !== 'object') continue
      const r = g as Record<string, unknown>
      const name = String(r.name ?? '').trim().slice(0, 20)
      const items: EntryDraft['groups'][number]['items'] = []
      for (const it of Array.isArray(r.items) ? r.items : []) {
        const n = typeof it === 'number' ? it : (it as Record<string, unknown> | null)?.n
        if (!ok(n) || used.has(n)) continue
        used.add(n)
        items.push({ n, embed: typeof it === 'object' && it !== null ? (it as Record<string, unknown>).embed !== false : true })
      }
      if (name && items.length) groups.push({ name, items })
    }
    if (!groups.length) continue
    const lead = (Array.isArray(o.lead) ? o.lead : [])
      .map((l) => l as Record<string, unknown>)
      .filter((l) => l && typeof l.text === 'string' && l.text.trim())
      .map((l) => ({ text: String(l.text).trim().slice(0, 200), src: (Array.isArray(l.src) ? l.src : []).filter(ok) }))
      .filter((l) => l.src.length)
      .slice(0, 3)
    return { lead, groups: groups.slice(0, 5) }
  }
  return null
}

/** 一段在页里怎么写：嵌进来（![[B#^id]]），或一行链接加那一句 */
export interface EntryPiece {
  /** 链接目标（不带 .md 的名字或路径） */
  target: string
  /** 块编号（不带 ^） */
  id: string
  title: string
  /** 只顺带提到时列的那一句 */
  line: string
}

/** 拼成词条页的 md：属性、标题、[!ai] 导语块（每句挂出处）、按组嵌进来的段 */
export function entryMarkdown(name: string, draft: EntryDraft, pieces: Map<number, EntryPiece>, by: string): string {
  const ref = (n: number) => {
    const p = pieces.get(n)
    return p ? `[[${p.target}#^${p.id}|${p.title}]]` : ''
  }
  const lead = draft.lead.map((l) => `> ${l.text.replace(/[。.]?$/, '')}。（${l.src.map(ref).filter(Boolean).join('、')}）`)
  const out = [`---`, `类型: 词条`, `来源: 梦游建议`, `---`, `# ${name}`, '']
  // 不翻：写进文件的格式
  out.push(`> [!ai] 梦游起草的词条 · ${by}`)
  if (lead.length) out.push(...lead)
  for (const g of draft.groups) {
    const items = g.items.filter((it) => pieces.has(it.n))
    if (!items.length) continue
    out.push('', `## ${g.name}`, '')
    let list = false
    for (const it of items) {
      const p = pieces.get(it.n)!
      if (it.embed) {
        if (list) out.push('')
        out.push(`![[${p.target}#^${p.id}]]`, '')
        list = false
      } else {
        out.push(`- [[${p.target}#^${p.id}|${p.title}]]：${p.line}`)
        list = true
      }
    }
    while (out[out.length - 1] === '') out.pop()
  }
  return out.join('\n') + '\n'
}

/** 测试用的起草：导语一句挂第一段；按笔记所在的节分组（没有节的叫「提到它的」）；有那个名字的段嵌进来 */
export function fakeEntry(prompt: string): string {
  const name = /库里好几篇笔记提到「(.+?)」/.exec(prompt)?.[1] ?? ''
  const srcs = [...prompt.matchAll(/^\[(\d+)\]《(.+?)》(?: › (.*))?\n(.*)$/gm)].map((m) => ({ n: Number(m[1]), title: m[2]!, heading: m[3] ?? '', text: m[4]! }))
  const groups = new Map<string, { n: number; embed: boolean }[]>()
  for (const s of srcs) {
    const g = s.heading ? s.heading.replace(/^[\p{P}\p{S}\d\s]+/u, '').slice(0, 8) || '提到它的' : '提到它的'
    ;(groups.get(g) ?? groups.set(g, []).get(g)!).push({ n: s.n, embed: s.text.length > 30 })
  }
  const first = srcs[0]
  const draft = {
    lead: first ? [{ text: `库里有 ${srcs.length} 段提到「${name}」，最早讲它的是《${first.title}》`, src: [first.n] }] : [],
    groups: [...groups].map(([g, items]) => ({ name: g, items })),
    skip: [],
  }
  return '```json\n' + JSON.stringify(draft) + '\n```'
}

// ---------- 建好以后：提到它的地方链过去（2026-11-23 用户定「自动链」） ----------

/** 要判的一句：哪篇、那一句（链接只留字） */
export interface MentionInfo {
  title: string
  text: string
}

/**
 * 问 AI：这几句里提到的「名字」指的是不是词条页讲的那个东西（同名的另一个东西、只是借这个字的都不算）。
 * 给它词条页的导语和收的那几段当依据；回每句一项：是 / 不是 / 拿不准、链哪几个字、把握
 */
export function entryLinkPrompt(name: string, aliases: string[], about: string, ms: MentionInfo[]): string {
  return `命令：词条页链回
库里刚建了一页词条「${name}」${aliases.length ? `（别名：${aliases.join('、')}）` : ''}。下面是这一页讲的东西（导语和收的段落）：
${about}

下面 ${ms.length} 句是库里别的笔记里提到「${name}」${aliases.length ? '或别名' : ''}的地方。对每一句判断：这里说的是不是这页讲的那个东西，要不要把那几个字链到这页。
- "是"：说的就是它。
- "不是"：同名的另一个东西（比如城市和同名的大学、人名和同名的地名），或者只是借这个字（文件夹名、课程名的一截）。
- "拿不准"：看这一句定不了。
words：这一句里要变成链接的那几个字，一字不差从这一句里抄，就是「${name}」或别名那几个字。confidence：0 到 1。

只输出一个 JSON 代码块，每句一项，按 S1、S2… 的顺序：
\`\`\`json
[{"s": 1, "kind": "是", "words": "${name}", "confidence": 0.9}]
\`\`\`

${ms.map((m, i) => `S${i + 1}《${m.title}》：${m.text}`).join('\n')}`
}

export const isEntryLinkPrompt = (prompt: string) => /^命令：词条页链回/.test(prompt)

export interface EntryLinkAnswer {
  index: number
  kind: '是' | '不是' | '拿不准'
  words: string
  confidence: number
}

/** 读回答：编号不对、档不认识的不要 */
export function parseEntryLinks(reply: string, n: number): EntryLinkAnswer[] {
  const blocks = [...reply.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!).reverse()
  const a = reply.indexOf('[')
  const b = reply.lastIndexOf(']')
  if (a >= 0 && b > a) blocks.push(reply.slice(a, b + 1))
  for (const t of blocks) {
    let x: unknown
    try {
      x = JSON.parse(t.trim())
    } catch {
      continue
    }
    if (!Array.isArray(x)) continue
    const out: EntryLinkAnswer[] = []
    x.forEach((y, k) => {
      if (!y || typeof y !== 'object') return
      const o = y as Record<string, unknown>
      const index = typeof o.s === 'number' ? o.s - 1 : typeof o.s === 'string' && /^S?\d+$/i.test(o.s) ? Number(o.s.replace(/^S/i, '')) - 1 : k
      const kind = (['是', '不是', '拿不准'] as const).find((v) => v === o.kind)
      if (index < 0 || index >= n || !kind || out.some((z) => z.index === index)) return
      const c = Number(o.confidence)
      out.push({ index, kind, words: String(o.words ?? '').trim(), confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0 })
    })
    return out
  }
  return []
}

/** 测试用：「名字」后面紧跟「大学」的（同名的另一个东西）判拿不准，其余判是 */
export function fakeEntryLinks(prompt: string): string {
  const name = /刚建了一页词条「(.+?)」/.exec(prompt)?.[1] ?? ''
  const out = [...prompt.matchAll(/^S(\d+)《.*?》：(.*)$/gm)].map((m) => {
    const uni = m[2]!.includes(name + '大学')
    return { s: Number(m[1]), kind: uni ? '拿不准' : '是', words: name, confidence: uni ? 0.6 : 0.9 }
  })
  return '```json\n' + JSON.stringify(out) + '\n```'
}
