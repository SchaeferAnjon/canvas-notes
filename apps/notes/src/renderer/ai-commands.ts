import { addSection, aiBlock, appendBlock, attr, findBlocks, freshId, hasOldLayout, insertInColumn, isMindmap, newBlock, newId, num, parseBoard, removeUnits, replaceMdBlocks, serializeBoard, splitDoc, summaryCallout, tagLine, unitKeys } from '@cn/format'
import type { DreamReport } from '../shared/api'
import { INBOX, titleOf } from '../shared/layout'
import { BRAND } from '../shared/brand'
import { MATH_RULE } from '../shared/reading'
import { CITE_RULE } from '../shared/cite-rule'
import { DOC_BOARD_RULES } from '@cn/format'
import { builtinByName } from '../shared/ai-cmds'
import { answerRule } from '../shared/answer-lang'
import { t } from '../shared/i18n'

/** AI 能做的 / 命令 */
export interface Command {
  name: string
  desc: string
}

/** 原来就有的 8 条（AiPanel 里各自的跑法）；说明和 / 菜单同一句（shared/ai-cmds.ts 的 BUILTINS，task-9womr） */
// 不翻：交给 AI 的命令名（BUILTINS 的身份，画的地方 t(name)）
export const COMMANDS: Command[] = ['整理收件箱', '整理当前白板', '总结这块白板', '写成文章', '翻译', '找重复', '剪藏这一页', '现在梦游'].map((name) => ({ name, desc: builtinByName(name)!.desc }))

/** /现在梦游 跑完的一句话：整理了几条、分几组、每组几条 */
export function dreamSummary(report: DreamReport, labels: Record<string, string>): { text: string; items: number; groups: number } {
  const counts = new Map<string, number>()
  for (const it of report.items) counts.set(it.group, (counts.get(it.group) ?? 0) + 1)
  const parts = [...counts].map(([g, n]) => t('{group}{n}', { group: labels[g] ?? g, n }))
  const head = report.items.length
    ? t('梦游跑完了：整理了{n}条，分{k}组（{parts}）。改动在{branch}分支上，收下才算数。', { n: report.items.length, k: counts.size, parts: parts.join(' · '), branch: report.branch })
    : t('梦游跑完了，没什么要整理的。')
  const notes = report.notes.length ? `\n${report.notes.join('\n')}` : ''
  return { text: head + notes, items: report.items.length, groups: counts.size }
}

/** /整理当前白板 交给引擎时说的话（引擎用 board_* 工具动手） */
// 不翻：给 AI 的提示词
export const TIDY_BOARD = `整理当前白板：先用 board_list 看这块白板上所有卡片和列；按内容分成几组（3 到 6 组），每组用 board_add_column 建一列（已有合适的列就用它），列名写这组讲什么；用 board_put_in_column 把卡片放进去；最后 board_arrange 按列排整齐。不删卡片，不改卡片内容。做完用一两句话说分了哪几组。

${DOC_BOARD_RULES}`

/** 回答的语言跟界面语言（task-zojmg），所以每次现取；提到库里的东西写成链接（task-3e53q） */
// 不翻：给 AI 的提示词
export const system = () => `你是 ${BRAND.name} 笔记软件里的助手，帮一个人整理和写作自己的笔记。
${answerRule()}；平实、直接，不客套，不重复问题。笔记内容在用户消息里，只根据这些内容回答，不编造没有的事。
${MATH_RULE}
${CITE_RULE}`

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function summaryPrompt(path: string, text: string): string {
  // 不翻：给 AI 的提示词
  return `命令：总结\n文件：${path}\n\n请把下面这块白板（或这篇笔记）读一遍，用三到五句话总结：每句一件事，先说最要紧的、还没定的。只输出这几句话。\n\n<note>\n${text}\n</note>`
}

export function articlePrompt(path: string, text: string): string {
  // 不翻：给 AI 的提示词
  return `命令：写成文章\n文件：${path}\n\n把下面这块白板按从左到右、从上到下的顺序写成一篇文章草稿（Markdown）。
第一行是「# 标题」，按内容分几个「## 小节」。剪来的素材（> 引文 加「—— [标题](网址)」那种）原样保留成引文和来源行，不要改写原文。
不要输出排版注释（<!-- -->），不要加文章以外的说明。\n\n<board>\n${text}\n</board>`
}

/** 交给 AI 翻的字：去掉属性（source、created 这些是软件记的，不是正文，task-n1ffi）和文档里藏着的位置行、注释 */
export function translateText(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n?/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

export function translatePrompt(text: string): string {
  // 不翻：给 AI 的提示词
  return `命令：翻译\n\n把下面的文字翻译过来：中文翻成英文，其他语言翻成中文。只输出译文。\n\n<text>\n${translateText(text)}\n</text>`
}

export function askPrompt(question: string, context: { path: string; text: string }[]): string {
  const ctx = context.map((c) => `<note path="${c.path}">\n${c.text}\n</note>`).join('\n\n')
  // 不翻：给 AI 的提示词
  return `命令：问答\n\n${ctx ? `能看到的笔记：\n${ctx}\n\n` : ''}问题：${question}`
}

/**
 * 总结存成卡片，标上「AI 总结的」和日期。2026-11-21 起白板就是这篇文档：放在最左一组最前面（标题下面），
 * 前面一行只记编号和日期的 `<!-- card id=… ai=日期 -->`（文档里藏着），白板卡底画「AI 总结的 · 日期」；
 * 以前写法的白板（导图、撤回了转写法的）照旧放在左下角。
 * 正文写成 `> [!ai] AI 总结 · 哪家 · 哪个模型` 提示块（task-5yp97，用户看图选的「选法 1」）：和 AI 讲解卡一套，能选一句开旁支；by 是「Claude Code · Opus 5.5」
 */
export function withSummaryCard(boardText: string, summary: string, by?: string): { text: string; id: string } {
  const card = summaryCallout(summary.trim(), by)
  if (!isMindmap(boardText) && !hasOldLayout(boardText)) {
    const b = splitDoc(boardText)
    const id = freshId(boardText, 's')
    const body = `${tagLine(id, { ai: today() })}\n${card}`
    const lead = b.columns[0]
    // 最左一组（第一节之前）有卡：插在它前面；没有：插在第一个列标题前面（白板上就是最左一组），一列都没有就加在文末
    const at = lead && !lead.head && lead.cards[0] ? (lead.cards[0].place?.from ?? lead.cards[0].tag?.from ?? lead.cards[0].from) : lead?.head ? (lead.place?.from ?? lead.head.from) : null
    if (at === null) return { text: boardText.replace(/\n*$/, '\n\n') + body + '\n', id }
    const before = boardText.slice(0, at)
    return { text: before + (before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') + body + '\n\n' + boardText.slice(at), id }
  }
  const doc = parseBoard(boardText)
  const free = doc.blocks.filter((b) => b.kind === 'card' && !attr(b, 'in'))
  const x = free.length ? Math.min(...free.map((b) => num(b, 'x', 0))) : 80
  const y = free.length ? Math.max(...doc.blocks.filter((b) => !attr(b, 'in')).map((b) => num(b, 'y', 0))) + 240 : 80
  const id = newId(doc)
  return { text: serializeBoard(appendBlock(doc, newBlock('card', { id, x, y, w: 300, ai: today() }, card))), id }
}

/**
 * /写成文章 的草稿放在哪：白板所在的文件夹（「在哪个文件夹里做的就放哪个文件夹」）；白板在库最外层时进收件箱（新笔记先进收件箱），
 * 在收件箱里的本来就在收件箱。重名由主进程 vault.create 加「 2」，不覆盖
 */
export function draftPath(boardPath: string): string {
  const at = boardPath.lastIndexOf('/')
  // 不翻：写进库里的文件名
  return `${at > 0 ? boardPath.slice(0, at) : INBOX}/${titleOf(boardPath)}：文章草稿.md`
}

export function draftText(boardPath: string, article: string): string {
  return `---\ndraft: true\nfrom: "[[${titleOf(boardPath)}]]"\n---\n${article.replace(/<!--[\s\S]*?-->\n?/g, '').trim()}\n`
}

// ---------- AI整理选中的几张、几段（task-5ryf9，白板、文档操作条的「AI整理」） ----------

/** AI 回的整理办法（编号从 1 起，是交给它的第几样） */
export interface TidyPlan {
  /** 白板：分成几组（列）；文档：分成几小节 */
  groups: { title: string; items: number[] }[]
  /** 白板：讲同一件事的几张合成一张（字不改，前面一行 merge 注释） */
  merge: number[][]
  /** 重复的，去掉 */
  drop: number[]
  /** 白板：一句小结（写进去时包成带 AI 标志的 [!ai] 块） */
  summary: string
}

/** 交给 AI 的话（不翻：给 AI 的提示词）。where：白板是几张卡，文档是几段 */
export function tidyPrompt(where: 'board' | 'doc', title: string, items: readonly string[]): string {
  const list = items.map((x, i) => `[${i + 1}]\n${x.trim()}`).join('\n\n')
  // 不翻：给 AI 的提示词
  if (where === 'board')
    // 不翻：给 AI 的提示词
    return `命令：整理这几张\n白板：《${title}》\n\n把下面这${items.length}张卡重新归类、排好、起标题。规矩：
1. 分成 1 到 5 组，每组一个短标题（不超过 12 个字），说这一组讲什么；组的先后、组里卡的先后按讲的顺序排。
2. 卡只用编号说，卡里的字一个不改、不改写，不编没有的内容。
3. 几乎一样的卡（重复的）只留一张，别的编号写进 drop；讲同一件事、最好放成一张的两三张写进 merge（合成一张，字不改）。
4. 补一句小结（不超过 40 个字），说这几张合起来讲了什么。
5. 每张卡都要出现在某一组里（drop 的除外）。只回一段 JSON，不要别的话：
{"groups":[{"title":"组名","cards":[1,3]}],"merge":[[2,4]],"drop":[5],"summary":"一句小结"}

卡：
${list}`
  // 不翻：给 AI 的提示词
  return `命令：整理这几段\n文档：《${title}》\n\n把下面这${items.length}段理顺：排成讲得通的先后、按讲的事分成几小节加小标题、去掉重复的。规矩：
1. 分成 1 到 4 小节，每节一个短的小标题（不超过 12 个字）；只有一节、又不用标题时 title 写空字符串。
2. 段只用编号说，段里的字一个不改、不改写，不编没有的内容。
3. 几乎一样的段（重复的）只留一段，别的编号写进 drop。
4. 每段都要出现在某一节里（drop 的除外）。只回一段 JSON，不要别的话：
{"sections":[{"title":"小标题","blocks":[2,1]}],"drop":[4]}

段：
${list}`
}

/** 认 AI 回的 JSON：编号不对的扔掉，漏了的补到最后一组，重复的只算一次；一组都认不出是 null */
export function parseTidy(answer: string, n: number): TidyPlan | null {
  const raw = /```(?:json)?\s*([\s\S]*?)```/.exec(answer)?.[1] ?? /\{[\s\S]*\}/.exec(answer)?.[0]
  if (!raw) return null
  let j: Record<string, unknown>
  try {
    j = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const ok = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= n
  const used = new Set<number>()
  const drop = (Array.isArray(j.drop) ? j.drop : []).filter(ok).filter((x) => !used.has(x) && (used.add(x), true))
  const src = Array.isArray(j.groups) ? j.groups : Array.isArray(j.sections) ? j.sections : []
  const groups = src.flatMap((g) => {
    if (!g || typeof g !== 'object') return []
    const o = g as Record<string, unknown>
    const items = (Array.isArray(o.cards) ? o.cards : Array.isArray(o.blocks) ? o.blocks : []).filter(ok).filter((x) => !used.has(x) && (used.add(x), true))
    const title = typeof o.title === 'string' ? o.title.replace(/[\n#]/g, ' ').trim().slice(0, 40) : ''
    return items.length ? [{ title, items }] : []
  })
  if (!groups.length) return null
  const missed = Array.from({ length: n }, (_, i) => i + 1).filter((x) => !used.has(x))
  if (missed.length) groups[groups.length - 1]!.items.push(...missed)
  const inGroups = new Set(groups.flatMap((g) => g.items))
  const merge = (Array.isArray(j.merge) ? j.merge : []).flatMap((m) => {
    if (!Array.isArray(m)) return []
    const set = [...new Set(m.filter(ok).filter((x) => inGroups.has(x)))]
    return set.length >= 2 ? [set] : []
  })
  const summary = typeof j.summary === 'string' ? j.summary.trim().slice(0, 200) : ''
  return { groups, merge, drop, summary }
}

/**
 * 白板上整理好的全文：选中的几张从原处拿掉，按组放进列（列名和已有的一列一样就放进那一列，不然文末新起一节）；
 * 一组里要合成的几张挨着放、前面一行 merge 注释（同「合成一张」，字不改）；第一组最前面放那句小结，包成带 AI 标志的块（偏好「AI 写的一律带框带标志」）
 */
export function tidyBoardText(text: string, keys: readonly string[], plan: TidyPlan, by?: string): string {
  const byKey = new Map([...unitKeys(splitDoc(text))].map(([u, k]) => [k, u]))
  const units = keys.map((k) => byKey.get(k))
  if (units.some((u) => !u)) throw new Error(t('选中的卡在文件里找不到了'))
  const body = (i: number) => text.slice(units[i - 1]!.from, units[i - 1]!.to).trim()
  let out = removeUnits(text, units as NonNullable<(typeof units)[number]>[])
  const level = splitDoc(text).level
  plan.groups.forEach((g, gi) => {
    const pieces: string[] = []
    if (gi === 0 && plan.summary) pieces.push(aiBlock(plan.summary, { ...(by ? { by } : {}) }))
    const done = new Set<number>()
    for (const i of g.items) {
      if (done.has(i)) continue
      const set = plan.merge.find((m) => m[0] === i || m.includes(i))
      if (set && set.every((x) => g.items.includes(x))) {
        for (const x of set) done.add(x)
        pieces.push(tagLine(freshId(out + pieces.join('\n')), { merge: String(set.length) }) + '\n' + set.map(body).join('\n\n'))
      } else {
        done.add(i)
        pieces.push(body(i))
      }
    }
    const piece = pieces.join('\n\n')
    // 不翻：写进文件的列名
    const name = g.title || '整理好的'
    let col = splitDoc(out).columns.find((c) => c.head && !c.ask && c.title === name)
    if (!col) {
      out = addSection(out, name, null, level)
      col = splitDoc(out).columns.at(-1)!
    }
    out = insertInColumn(out, col, null, piece)
  })
  return out
}

/** 文档里整理好的全文：选中的几块拿掉，在第一块那里放进按小节排好的几段（小标题比上面最近的标题低一级） */
export function tidyDocText(text: string, ranges: readonly { from: number; to: number }[], plan: TidyPlan): string {
  const blocks = findBlocks(text)
  const idx = ranges.map((r) => blocks.findIndex((b) => b.from === r.from && b.to === r.to))
  if (idx.some((i) => i < 0)) throw new Error(t('选中的几块在文件里找不到了'))
  const first = Math.min(...idx)
  const above = blocks.slice(0, first).filter((b) => b.kind === 'heading').at(-1)
  const lv = Math.min(6, Math.max(2, (above?.level ?? (above ? /^#+/.exec(text.slice(above.from, above.to))?.[0].length : undefined) ?? 1) + 1))
  const body = (i: number) => text.slice(ranges[i - 1]!.from, ranges[i - 1]!.to).trim()
  const md = plan.groups.map((g) => (g.title ? '#'.repeat(lv) + ' ' + g.title + '\n\n' : '') + g.items.map(body).join('\n\n')).join('\n\n')
  const e = replaceMdBlocks(text, idx, md, blocks)
  return e ? e.text : text
}
