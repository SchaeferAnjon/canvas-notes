import { appendBlock, attr, freshId, hasOldLayout, isMindmap, newBlock, newId, num, parseBoard, serializeBoard, splitDoc, summaryCallout, tagLine } from '@cn/format'
import type { DreamReport } from '../shared/api'
import { INBOX, titleOf } from '../shared/layout'
import { BRAND } from '../shared/brand'
import { MATH_RULE } from '../shared/reading'
import { DOC_BOARD_RULES } from '@cn/format'
import { builtinByName } from '../shared/ai-cmds'

/** AI 能做的 / 命令 */
export interface Command {
  name: string
  desc: string
}

/** 原来就有的 8 条（AiPanel 里各自的跑法）；说明和 / 菜单同一句（shared/ai-cmds.ts 的 BUILTINS，task-9womr） */
export const COMMANDS: Command[] = ['整理收件箱', '整理当前白板', '总结这块白板', '写成文章', '翻译', '找重复', '剪藏这一页', '现在梦游'].map((name) => ({ name, desc: builtinByName(name)!.desc }))

/** /现在梦游 跑完的一句话：整理了几条、分几组、每组几条 */
export function dreamSummary(report: DreamReport, labels: Record<string, string>): { text: string; items: number; groups: number } {
  const counts = new Map<string, number>()
  for (const it of report.items) counts.set(it.group, (counts.get(it.group) ?? 0) + 1)
  const parts = [...counts].map(([g, n]) => `${labels[g] ?? g}${n}`)
  const head = report.items.length
    ? `梦游跑完了：整理了${report.items.length}条，分${counts.size}组（${parts.join(' · ')}）。改动在${report.branch}分支上，收下才算数。`
    : '梦游跑完了，没什么要整理的。'
  const notes = report.notes.length ? `\n${report.notes.join('\n')}` : ''
  return { text: head + notes, items: report.items.length, groups: counts.size }
}

/** /整理当前白板 交给引擎时说的话（引擎用 board_* 工具动手） */
export const TIDY_BOARD = `整理当前白板：先用 board_list 看这块白板上所有卡片和列；按内容分成几组（3 到 6 组），每组用 board_add_column 建一列（已有合适的列就用它），列名写这组讲什么；用 board_put_in_column 把卡片放进去；最后 board_arrange 按列排整齐。不删卡片，不改卡片内容。做完用一两句话说分了哪几组。

${DOC_BOARD_RULES}`

export const SYSTEM = `你是 ${BRAND.name} 笔记软件里的助手，帮一个人整理和写作自己的笔记。
用中文回答，平实、直接，不客套，不重复问题。笔记内容在用户消息里，只根据这些内容回答，不编造没有的事。
${MATH_RULE}`

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function summaryPrompt(path: string, text: string): string {
  return `命令：总结\n文件：${path}\n\n请把下面这块白板（或这篇笔记）读一遍，用三到五句话总结：每句一件事，先说最要紧的、还没定的。只输出这几句话。\n\n<note>\n${text}\n</note>`
}

export function articlePrompt(path: string, text: string): string {
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
  return `命令：翻译\n\n把下面的文字翻译过来：中文翻成英文，其他语言翻成中文。只输出译文。\n\n<text>\n${translateText(text)}\n</text>`
}

export function askPrompt(question: string, context: { path: string; text: string }[]): string {
  const ctx = context.map((c) => `<note path="${c.path}">\n${c.text}\n</note>`).join('\n\n')
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
  return `${at > 0 ? boardPath.slice(0, at) : INBOX}/${titleOf(boardPath)}：文章草稿.md`
}

export function draftText(boardPath: string, article: string): string {
  return `---\ndraft: true\nfrom: "[[${titleOf(boardPath)}]]"\n---\n${article.replace(/<!--[\s\S]*?-->\n?/g, '').trim()}\n`
}
