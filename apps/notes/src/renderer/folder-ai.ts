/**
 * 文件夹页空对话的建议（D 组小样 A「周记」：把这周的周记总结成三句话 · 收件箱里和周记有关的挪进来 · 照上周的样子开一篇 2026-W48）。
 * 只放软件真做得到的：写小结（读这几篇问一次 AI）、归类（AI 挑收件箱里有关的，你点同意才挪，一次提交可撤回）、
 * 新建（照最新那篇的属性和小节开一篇空的，不问 AI）。做不到的（收件箱空着、认不出下一篇叫什么）不放。纯函数，界面在 AiPanel。
 */
import type { CodiconName } from '@cn/design'
import type { NoteFile } from '../shared/api'
import { previewOf, titleOf } from '../shared/layout'
import { t } from '../shared/i18n'

export type FolderSugKind = 'sum' | 'file' | 'new'
export interface FolderSug {
  kind: FolderSugKind
  icon: CodiconName
  text: string
}

const WEEK = /^(\d{4})-W(\d{1,2})$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 这一年有几个 ISO 周：1 月 1 日是星期四，或闰年 1 月 1 日是星期三，就是 53 周 */
function weeksIn(year: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay()
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return jan1 === 4 || (leap && jan1 === 3) ? 53 : 52
}

/** 下一篇叫什么：周号（2026-W47 → 2026-W48）、日期（换成今天）、末尾的编号（第3讲 → 第4讲）；认不出是 null */
export function nextName(name: string, day: string): string | null {
  const w = WEEK.exec(name)
  if (w) {
    const y = Number(w[1])
    const n = Number(w[2])
    return n >= weeksIn(y) ? `${y + 1}-W01` : `${y}-W${String(n + 1).padStart(2, '0')}`
  }
  if (DATE.test(name)) return name === day ? null : day
  const m = /^(.*?)(\d+)(\D*)$/.exec(name)
  if (!m) return null
  return m[1] + String(Number(m[2]) + 1).padStart(m[2]!.length, '0') + m[3]
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const inside = (folder: string, p: string) => p.startsWith(folder + '/')
const weekKey = (title: string) => {
  const w = WEEK.exec(title)
  return w ? Number(w[1]) * 100 + Number(w[2]) : -1
}

/** 直接放在这个文件夹里的文档（白板、子文件夹里的不算）里最新的一篇：周记按周号，别的按修改时间 */
export function latestNote(folder: string, notes: readonly NoteFile[]): NoteFile | null {
  const own = notes.filter((n) => dirOf(n.path) === folder && n.path.endsWith('.md') && !n.board)
  if (!own.length) return null
  const weeks = own.filter((n) => WEEK.test(titleOf(n.path)))
  if (weeks.length) return weeks.reduce((a, b) => (weekKey(titleOf(b.path)) > weekKey(titleOf(a.path)) ? b : a))
  return own.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a))
}

const isWeekly = (latest: NoteFile | null) => !!latest && WEEK.test(titleOf(latest.path))

/** 「总结」读哪几篇：周记只读这周那篇；别的文件夹读最近改的 20 篇（子文件夹里的也算） */
export function sumTargets(folder: string, notes: readonly NoteFile[]): NoteFile[] {
  const latest = latestNote(folder, notes)
  if (isWeekly(latest)) return [latest!]
  return notes
    .filter((n) => inside(folder, n.path) && n.path.endsWith('.md') && !n.board)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 20)
}

/** 这个文件夹页空对话里的建议（最多三颗，照小样的顺序：总结、挪进来、开一篇） */
export function folderSugs(folder: string, notes: readonly NoteFile[], day: string): FolderSug[] {
  const name = folder.split('/').pop() || folder
  const latest = latestNote(folder, notes)
  const weekly = isWeekly(latest)
  const out: FolderSug[] = []
  if (sumTargets(folder, notes).length) out.push({ kind: 'sum', icon: 'notebook', text: weekly ? t('把这周的{name}总结成三句话', { name }) : t('把「{name}」总结成三句话', { name }) })
  if (notes.some((n) => n.kind === 'inbox')) out.push({ kind: 'file', icon: 'inbox', text: t('收件箱里和{name}有关的挪进来', { name }) })
  const from = latest ? titleOf(latest.path) : null
  const next = from ? nextName(from, day) : null
  if (from && next && !notes.some((n) => n.path === `${folder}/${next}.md`))
    out.push({ kind: 'new', icon: 'new-file', text: weekly ? t('照上周的样子开一篇 {name}', { name: next }) : t('照「{from}」的样子开一篇「{name}」', { from, name: next }) })
  return out
}

/** 新的一篇照哪篇、叫什么、放哪 */
export function newTarget(folder: string, notes: readonly NoteFile[], day: string): { from: NoteFile; name: string; path: string } | null {
  const from = latestNote(folder, notes)
  const name = from ? nextName(titleOf(from.path), day) : null
  return from && name ? { from, name, path: `${folder}/${name}.md` } : null
}

/**
 * 照上一篇的样子：属性留着（日期换成今天），小节标题和「- 书：」这种开头留着，内容清空；第一行标题换成新名字。
 * 不问 AI：同一个样子，马上就有
 */
export function skeleton(text: string, from: string, to: string, day: string): string {
  let fm = ''
  let body = text
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4)
    if (end > 0) {
      fm = text
        .slice(0, end + 5)
        .split('\n')
        .map((l) => l.replace(/^(\s*[^:\s][^:]*:\s*["']?)\d{4}-\d{2}-\d{2}/, `$1${day}`))
        .join('\n')
      body = text.slice(end + 5)
    }
  }
  const kept: { k: 'h' | 'l'; s: string }[] = []
  for (const line of body.split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      kept.push({ k: 'h', s: h[1]!.length === 1 && h[2]!.trim() === from ? `# ${to}` : line })
      continue
    }
    const l = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?[^：:\n*]{1,12}(?:\*\*)?[：:])/.exec(line)
    if (l) kept.push({ k: 'l', s: l[1]! })
  }
  let out = ''
  kept.forEach((x, i) => {
    if (i) out += x.k === 'l' && kept[i - 1]!.k === 'l' ? '\n' : '\n\n'
    out += x.s
  })
  return fm + (out ? out + '\n' : '')
}

/** 「把这周的周记总结成三句话」交给 AI 的话 */
export function folderSumPrompt(folder: string, items: { path: string; text: string }[]): string {
  const ctx = items.map((c) => `<note path="${c.path}">\n${c.text.slice(0, 4000)}\n</note>`).join('\n\n')
  // 不翻：给 AI 的提示词
  return `命令：文件夹小结\n文件夹：${folder}\n\n请把下面这几篇读一遍，用三句话总结：每句一件事，先说最要紧的、还没定的。只输出这三句话。\n\n${ctx}`
}

/** 「收件箱里和周记有关的挪进来」交给 AI 的话：文件夹、里面已有的几篇、收件箱每一条 */
export function fileInPrompt(folder: string, items: { path: string; text: string }[], have: string[]): string {
  // 不翻：给 AI 的提示词
  const list = items.map((i) => `路径：${i.path}\n内容：${previewOf(i.text, 300)}`).join('\n\n')
  // 不翻：给 AI 的提示词
  return `命令：挪进文件夹\n文件夹：${folder}\n这个文件夹里已有：${have.join('、') || '（还没有）'}\n\n下面是收件箱里的东西。挑出和这个文件夹讲的是一回事、该放进去的；拿不准的不要列。
只输出一个 JSON 代码块：["收件箱/…"]\n\n${list}`
}

/** 从回答里取要挪进来的路径（只要收件箱里真有的） */
export function parseFileIn(reply: string, inbox: readonly NoteFile[]): string[] {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(reply) ?? /(\[[\s\S]*\])/.exec(reply)
  if (!m) throw new Error(t('AI没给出能用的方案'))
  const raw = JSON.parse(m[1]!) as unknown
  if (!Array.isArray(raw)) throw new Error(t('AI没给出能用的方案'))
  const paths = new Set(inbox.map((n) => n.path))
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && paths.has(x)))]
}
