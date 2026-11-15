import { appendBlock, attr, newBlock, newId, num, parseBoard, serializeBoard } from '@cn/format'
import type { DreamReport, NoteFile } from '../shared/api'
import { CLIPS, previewOf, titleOf } from '../shared/layout'
import { BRAND } from '../shared/brand'

/** AI 能做的 / 命令 */
export interface Command {
  name: string
  desc: string
}

export const COMMANDS: Command[] = [
  { name: '整理收件箱', desc: '给收件箱里的东西找主题，你点同意才挪，一次提交可撤回' },
  { name: '总结这块白板', desc: '把当前这块白板或这篇读一遍，写成几句话' },
  { name: '写成文章', desc: '按白板从左到右、从上到下写成一篇文档草稿' },
  { name: '翻译', desc: '翻译文档里选中的那段；没选就翻整篇' },
  { name: '找重复', desc: '找出库里内容差不多的笔记和剪藏' },
  { name: '剪藏当前网页', desc: '把右栏开着的整个网页剪进收件箱' },
  { name: '现在梦游', desc: '不等夜里，现在把收件箱整理一遍，出一份梦游报告' },
]

/**
 * 还在别的同事那里做的命令：功能做好后在 window.cn 上加这个方法（preload 和 shared/api.ts），这里就会调它。
 * 方法还没有时浮窗里显示「这条命令还在做」。参数是 { webUrl }（右栏开着的网址，没开是 null）；
 * 返回一句话（字符串）就显示出来，否则显示「做好了」。
 * /找重复、/现在梦游 已经接上（AiPanel 里的 findDuplicates、dreamNow）。
 */
export const PENDING_COMMANDS: Record<string, string> = {
  剪藏当前网页: 'clipCurrentPage',
}

/** /现在梦游 跑完的一句话：整理了几条、分几组、每组几条 */
export function dreamSummary(report: DreamReport, labels: Record<string, string>): { text: string; items: number; groups: number } {
  const counts = new Map<string, number>()
  for (const it of report.items) counts.set(it.group, (counts.get(it.group) ?? 0) + 1)
  const parts = [...counts].map(([g, n]) => `${labels[g] ?? g} ${n}`)
  const head = report.items.length
    ? `梦游跑完了：整理了 ${report.items.length} 条，分 ${counts.size} 组（${parts.join(' · ')}）。改动在 ${report.branch} 分支上，收下才算数。`
    : '梦游跑完了，没什么要整理的。'
  const notes = report.notes.length ? `\n${report.notes.join('\n')}` : ''
  return { text: head + notes, items: report.items.length, groups: counts.size }
}

export const SYSTEM = `你是 ${BRAND.name} 笔记软件里的助手，帮一个人整理和写作自己的笔记。
用中文回答，平实、直接，不客套，不重复问题。笔记内容在用户消息里，只根据这些内容回答，不编造没有的事。`

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

export function translatePrompt(text: string): string {
  return `命令：翻译\n\n把下面的文字翻译过来：中文翻成英文，其他语言翻成中文。只输出译文。\n\n<text>\n${text}\n</text>`
}

export function inboxPrompt(items: { path: string; text: string }[], topics: string[]): string {
  const list = items.map((i) => `路径：${i.path}\n内容：${previewOf(i.text, 300)}`).join('\n\n')
  return `命令：整理收件箱\n\n下面是收件箱里的东西。给每一条选一个主题（素材文件夹名），优先用已有的主题：${topics.join('、') || '（还没有）'}。
没把握的那条就不要列出来。主题名短一点（2 到 6 个字）。
只输出一个 JSON 代码块：[{"path": "收件箱/…", "topic": "主题"}]\n\n${list}`
}

export function askPrompt(question: string, context: { path: string; text: string }[]): string {
  const ctx = context.map((c) => `<note path="${c.path}">\n${c.text}\n</note>`).join('\n\n')
  return `命令：问答\n\n${ctx ? `能看到的笔记：\n${ctx}\n\n` : ''}问题：${question}`
}

/** 从回答里取 JSON 代码块 */
export function parseMoves(reply: string, inbox: NoteFile[]): { path: string; topic: string }[] {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(reply) ?? /(\[[\s\S]*\])/.exec(reply)
  if (!m) throw new Error('AI 没给出能用的整理方案')
  const raw = JSON.parse(m[1]!) as unknown
  if (!Array.isArray(raw)) throw new Error('AI 没给出能用的整理方案')
  const paths = new Set(inbox.map((n) => n.path))
  return raw
    .filter((x): x is { path: string; topic: string } => typeof x?.path === 'string' && typeof x?.topic === 'string')
    .filter((x) => paths.has(x.path) && x.topic.trim() && !/[\\/:]/.test(x.topic))
    .map((x) => ({ path: x.path, topic: x.topic.trim() }))
}

export const topicFolder = (topic: string) => `${CLIPS}/${topic}`

/** 总结存成卡片：放在白板左下角，标上「AI 总结的」和日期 */
export function withSummaryCard(boardText: string, summary: string): { text: string; id: string } {
  const doc = parseBoard(boardText)
  const free = doc.blocks.filter((b) => b.kind === 'card' && !attr(b, 'in'))
  const x = free.length ? Math.min(...free.map((b) => num(b, 'x', 0))) : 80
  const y = free.length ? Math.max(...doc.blocks.filter((b) => !attr(b, 'in')).map((b) => num(b, 'y', 0))) + 240 : 80
  const id = newId(doc)
  return { text: serializeBoard(appendBlock(doc, newBlock('card', { id, x, y, w: 300, ai: today() }, summary))), id }
}

export function draftText(boardPath: string, article: string): string {
  return `---\ndraft: true\nfrom: "[[${titleOf(boardPath)}]]"\n---\n${article.replace(/<!--[\s\S]*?-->\n?/g, '').trim()}\n`
}
