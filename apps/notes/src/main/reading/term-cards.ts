/**
 * 出卡的另一种来源「划成定义的」（ParaRead 联动，设计 20-pararead联动「划线颜色带含义」：绿 · 定义「出卡时默认勾上：正面是词，背面是原句和讲解」）：
 * 配对笔记里键 def 的每一条一张，默认勾上，字是现成的（不问 AI）：正面「「词」是什么意思？」，背面是这一页 PDF 里含这个词的那一句
 * （读过的 PDF 有全文缓存；没有就写划的那段原文），原文写划的那段。牌组规矩照别的卡（跟着目录来）。
 */
import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { type AskSection, blocksText, type CardText, type Highlight, highlightsOf, lectureOf, notePathFor, prop } from '@cn/format'
import type { CardScope } from '../../shared/reading'
import { pdfHash, readTextCache } from '../pdf-text-cache'
import type { Vault } from '../vault'
import type { CardInput } from './anki'
import { pdfsUnder } from './doubts'

/** 定义的键（DEFAULT_KINDS 里绿的那一种） */
const DEF = 'def'

export interface TermItem {
  id: string
  pdf: string
  lecture?: number
  h: Highlight
  /** 这一页里含这个词的那一句（没有全文缓存时是空的） */
  sentence: string
}

/** 一页的字里含 term 的那一句（按 . ! ? 。！？ 断句，空白不算） */
export function sentenceOf(page: string, term: string): string {
  const flat = page.replace(/\s+/g, ' ')
  const want = term.replace(/\s+/g, ' ').trim()
  const at = flat.indexOf(want)
  if (at < 0 || !want) return ''
  const before = flat.slice(0, at)
  const start = Math.max(...['. ', '! ', '? ', '。', '！', '？'].map((m) => before.lastIndexOf(m) + (before.lastIndexOf(m) < 0 ? 0 : m.length)), 0)
  const after = flat.slice(at + want.length)
  const ends = [/[.!?](\s|$)/, /[。！？]/].map((re) => re.exec(after)).filter((m): m is RegExpExecArray => !!m).map((m) => m.index + 1)
  const end = at + want.length + (ends.length ? Math.min(...ends) : after.length)
  return flat.slice(start, end).trim().slice(0, 400)
}

export const termCardId = (pdf: string, h: Highlight) => `${notePathFor(pdf)}#hl=${h.id}`

export function termCard(it: TermItem): CardText {
  return { q: `「${it.h.text}」是什么意思？`, a: it.sentence || it.h.text, more: '', quote: `「${it.h.text}」` } // 不翻：写进卡的字跟笔记
}

/** 出卡的范围里划成定义的每一条 */
export async function collectTerms(v: Vault, scope: CardScope): Promise<TermItem[]> {
  if (scope.kind === 'feynman') return []
  const pdfs = scope.kind === 'pdf' ? [scope.pdf] : await pdfsUnder(v, scope.kind === 'folder' ? scope.folder : '')
  const out: TermItem[] = []
  for (const pdf of pdfs) {
    const note = notePathFor(pdf)
    let text: string
    try {
      text = (await v.read(note)).text
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
    const hs = highlightsOf(text, note).filter((h) => h.key === DEF)
    if (!hs.length) continue
    let pages: string[] = []
    try {
      const cache = readTextCache(app.getPath('userData'), pdfHash(await readFile(v.abs(pdf))))
      pages = cache?.pages.map((b) => blocksText(b)) ?? []
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    const lec = Number(prop(text, '第几讲')) // 不翻：文件里的属性键
    const lecture = Number.isFinite(lec) && lec > 0 ? lec : lectureOf(pdf)
    for (const h of hs) out.push({ id: termCardId(pdf, h), pdf, ...(lecture !== undefined ? { lecture } : {}), h, sentence: sentenceOf(pages[h.page - 1] ?? '', h.text) })
  }
  return out
}

/** 送进 Anki 的那几张：出卡弹窗里过过的字为准；「打开原文」回到 PDF 那一页那一块 */
export function termInputs(items: TermItem[], course: (pdf: string) => string, want: Map<string, CardText>): CardInput[] {
  return items.flatMap((it) => {
    const card = want.get(it.id)
    if (!card) return []
    const section = { id: it.id, file: it.pdf, page: it.h.page, ...(it.h.rect ? { rect: it.h.rect } : {}), title: it.h.text, figures: [], doubts: [card.q], good: card.a, points: [], failed: [], rounds: 0, links: [] } as AskSection
    return [{ id: it.id, pdf: it.pdf, course: course(it.pdf), section, question: card.q, card }]
  })
}
