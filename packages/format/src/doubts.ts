/**
 * 我的疑惑：一个文件夹（一门课）里所有读 PDF 笔记问过的地方汇成一个清单，按讲分组。
 * 每一处是一条：问题（我的疑惑第一行）、讲通的讲法、页码、我框的图。考前看这个，也从这里送进 Anki。
 * 清单另存成 `<文件夹>/我的疑惑.md`（随笔记一起更新、跟着 Git 走），是给人看的副本，数据以各篇笔记为准。
 */
import { type AskSection, lectureOf, linkFrom } from './reading-note'
import { formatPdfAnchor } from './pdf-link'
import { setProp } from './props'

export interface DoubtItem {
  /** 笔记里那一段的身份（完整对话的路径） */
  id: string
  /** PDF 在库里的路径 */
  pdf: string
  /** 第几讲（没有就按文件名排） */
  lecture?: number
  section: AskSection
}

export interface DoubtGroup {
  /** PDF 路径 */
  key: string
  /** 「第 3 讲 · 第3讲 线性映射」或 PDF 名 */
  title: string
  lecture?: number
  items: DoubtItem[]
}

export const DOUBTS_NAME = '我的疑惑.md'

const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')

/** 这一条的问题：我的疑惑第一行，没有就是小标题 */
export const questionOf = (s: AskSection) => s.doubts[0] ?? s.title

/** 按讲（再按 PDF 名）分组，组里按页、再按问的时间排 */
export function groupDoubts(items: DoubtItem[]): DoubtGroup[] {
  const groups = new Map<string, DoubtGroup>()
  for (const it of items) {
    let g = groups.get(it.pdf)
    if (!g) {
      const lec = it.lecture ?? lectureOf(it.pdf)
      g = { key: it.pdf, title: lec !== undefined && !/第\s*\d+\s*讲/.test(stem(it.pdf)) ? `第 ${lec} 讲 · ${stem(it.pdf)}` : stem(it.pdf), ...(lec !== undefined ? { lecture: lec } : {}), items: [] }
      groups.set(it.pdf, g)
    }
    g.items.push(it)
  }
  const list = [...groups.values()]
  for (const g of list) g.items.sort((a, b) => a.section.page - b.section.page || (a.section.time ?? '').localeCompare(b.section.time ?? ''))
  return list.sort((a, b) => (a.lecture ?? 1e9) - (b.lecture ?? 1e9) || a.title.localeCompare(b.title, 'zh'))
}

/** 我的疑惑.md 的全文；sent 是已经送进 Anki 的那几条 */
export function doubtsNote(folder: string, course: string, items: DoubtItem[], sent: ReadonlySet<string>): string {
  const note = `${folder ? folder + '/' : ''}${DOUBTS_NAME}`
  let head = setProp('', '类型', '我的疑惑')
  if (course) head = setProp(head, '课程', course)
  const out = [`${head}\n# 我的疑惑`, '', `${course || '这个文件夹'} · ${items.length} 条。软件按这里各篇读 PDF 的笔记自动汇总，要改就改笔记里那一段。`]
  for (const g of groupDoubts(items)) {
    out.push('', `## ${g.title}`, '')
    for (const it of g.items) {
      const s = it.section
      const page = `[第 ${s.page} 页](${linkFrom(note, it.pdf)}${formatPdfAnchor({ file: it.pdf, page: s.page, rect: s.rect }).replace(/^[^#]*/, '')})`
      out.push(`- **${questionOf(s).replace(/\s+/g, ' ')}** ${page}${sent.has(it.id) ? ' · 已送 Anki' : ''}`)
      const good = s.good.replace(/\s+/g, ' ').trim()
      if (good) out.push(`  ${good}`)
    }
  }
  return out.join('\n') + '\n'
}
