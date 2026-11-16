/**
 * 右栏「大纲」的条目（纯函数，单元测试在 test/outline.test.ts）：
 * - 文档：md 的 # 标题（代码块里的不算），带行号，点了编辑器跳过去；
 * - 白板：列（标题）和有标题的卡片（卡片第一行是 # 标题或整行加粗），列里的卡片缩进一层。
 */
export interface OutlineItem {
  text: string
  depth: number
  /** 文档：标题在第几行（从 0 数）；白板：卡片或列的 id */
  line?: number
  id?: string
  /** PDF：第几页 */
  page?: number
}

export function docOutline(md: string): OutlineItem[] {
  const out: OutlineItem[] = []
  let fence = false
  let front = false
  const lines = md.split('\n')
  lines.forEach((l, i) => {
    if (i === 0 && l.trim() === '---') return void (front = true)
    if (front) {
      if (l.trim() === '---') front = false
      return
    }
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (fence) return
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) out.push({ text: m[2]!, depth: m[1]!.length, line: i })
  })
  const min = Math.min(...out.map((o) => o.depth))
  return out.map((o) => ({ ...o, depth: o.depth - min }))
}

const ATTR = (s: string, k: string) => new RegExp(`\\b${k}=(?:"([^"]*)"|(\\S+))`).exec(s)

export function boardOutline(md: string): OutlineItem[] {
  const cols: (OutlineItem & { cards: OutlineItem[] })[] = []
  const loose: OutlineItem[] = []
  const lines = md.split('\n')
  lines.forEach((l, i) => {
    const col = /^<!--\s*column\s+(.*?)\s*-->\s*$/.exec(l)
    if (col) {
      const id = ATTR(col[1]!, 'id')
      const title = ATTR(col[1]!, 'title')
      cols.push({ text: (title?.[1] ?? title?.[2] ?? '').trim() || '未命名的列', depth: 0, id: id?.[1] ?? id?.[2], cards: [] })
      return
    }
    const card = /^<!--\s*card\s+(.*?)\s*-->\s*$/.exec(l)
    if (!card) return
    const first = (lines.slice(i + 1).find((x) => x.trim() !== '') ?? '').trim()
    const t = /^#{1,6}\s+(.+)$/.exec(first)?.[1] ?? /^\*\*(.+)\*\*$/.exec(first)?.[1]
    const id = ATTR(card[1]!, 'id')
    const inCol = ATTR(card[1]!, 'in')
    const item = { text: t ?? first.replace(/^[-*>]\s*/, '').slice(0, 40), depth: 0, id: id?.[1] ?? id?.[2] }
    if (!item.text || item.text.startsWith('<!--')) return
    const c = inCol && cols.find((x) => x.id === (inCol[1] ?? inCol[2]))
    if (c) c.cards.push({ ...item, depth: 1 })
    else if (t) loose.push(item)
  })
  return [...loose, ...cols.flatMap(({ cards, ...c }) => [c, ...cards])]
}
