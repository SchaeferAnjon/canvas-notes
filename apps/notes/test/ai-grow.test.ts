import { describe, expect, it } from 'vitest'
import { capOf, catchUpStep, GROW_CHARS, GROW_MAX_MS, GROW_STEP, GROW_TICK, growStep, hiddenRanges, type LineAt, type Seg, shownAt, trimSpan, unitsOf } from '../src/shared/ai-grow'

/** 一篇字里的行（和 CodeMirror 的 doc.lineAt 一样：行首、行尾不含换行） */
const linesOf =
  (doc: string): LineAt =>
  (pos) => {
    const from = doc.lastIndexOf('\n', pos - 1) + 1
    const nl = doc.indexOf('\n', pos)
    return { from, to: nl === -1 ? doc.length : nl }
  }

/** 藏起来以后看得见的字（藏掉 [from, to) 那几截） */
function seen(doc: string, ranges: { from: number; to: number }[]): string {
  let out = ''
  let at = 0
  for (const r of ranges) {
    out += doc.slice(at, r.from)
    at = r.to
  }
  return out + doc.slice(at)
}

describe('节奏：照原型每 60 毫秒 2 个字，长的加速、4 秒内显完', () => {
  it('短的照原型：2 个字一下', () => {
    expect(GROW_TICK).toBe(60)
    expect(GROW_STEP).toBe(2)
    expect(growStep(75)).toBe(2)
    expect(growStep(130)).toBe(2)
  })
  it('长的加速：一下多出几个，GROW_MAX_MS 里显完', () => {
    for (const n of [300, 800, 2000]) {
      const step = growStep(n)
      expect(step).toBeGreaterThan(2)
      expect(Math.ceil(n / step) * GROW_TICK).toBeLessThanOrEqual(GROW_MAX_MS)
    }
  })
  it('边收边写：落下的少照原型 2 个，落下的多 1.5 秒内追上', () => {
    expect(catchUpStep(3)).toBe(2)
    expect(catchUpStep(250)).toBe(10)
  })
  it('显到 cap 就一下全显', () => {
    expect(shownAt(1, 2, 100, 300)).toBe(2)
    expect(shownAt(49, 2, 100, 300)).toBe(98)
    expect(shownAt(50, 2, 100, 300)).toBe(300)
    expect(shownAt(0, 2, 100, 300)).toBe(0)
  })
})

describe('一次写进来很多：一个字一个字显到约 800 字（整段算），后面的一下子全显', () => {
  it('不到 800 字：全都一个字一个字显', () => {
    const text = '第一段。\n\n第二段。'
    const segs: Seg[] = [{ from: 0, to: text.length }]
    expect(capOf(segs, () => text)).toBe(text.length)
  })
  it('跨过 800 的那一段打完，后面的段不等', () => {
    const para = '字'.repeat(300)
    const text = [para, para, para, para].join('\n\n')
    const segs: Seg[] = [{ from: 0, to: text.length }]
    const cap = capOf(segs, () => text)
    // 前三段（含两个空行）是 904，第三段跨过 800：打完第三段为止
    expect(cap).toBe(3 * 300 + 3 * 2)
    expect(cap).toBeGreaterThanOrEqual(GROW_CHARS)
    expect(cap).toBeLessThan(unitsOf(segs))
  })
  it('一整块（表格、图片）只算 1 个', () => {
    const segs: Seg[] = [{ from: 0, to: 10 }, { from: 10, to: 500, atom: true }, { from: 500, to: 520 }]
    expect(unitsOf(segs)).toBe(10 + 1 + 20)
  })
})

describe('藏哪几截：不跨块地藏，整行没显的连前面的换行一起藏，不留空行、不带出标题样子', () => {
  it('往末尾续写一节：一开始只看得见原来的字，一点点长出来，长完和写进去的一样', () => {
    const old = '# 书摘\n\n> 摘录。\n'
    const add = '## 评价\n\n开篇很克制。\n\n第二段。'
    const doc = old + '\n' + add + '\n'
    const from = doc.indexOf('##')
    const segs: Seg[] = [{ from, to: from + add.length }]
    const lineAt = linesOf(doc)
    // 一个字都没显：和写进来之前一样（最后那个换行留着）
    expect(seen(doc, hiddenRanges(segs, 0, lineAt))).toBe(old + '\n')
    // 显了「## 评」：标题那一行自己一行，下面的还藏着
    expect(seen(doc, hiddenRanges(segs, 4, lineAt))).toBe(old + '\n## 评\n')
    // 显到第一段一半
    const half = add.indexOf('克制')
    expect(seen(doc, hiddenRanges(segs, half, lineAt))).toBe(old + '\n## 评价\n\n开篇很\n')
    // 全显
    expect(hiddenRanges(segs, add.length, lineAt)).toEqual([])
  })
  it('插在两段中间的一段（以换行结尾）：没显的时候下面那段照样是自己一行，不并上来', () => {
    const doc = 'A\n\nB 新的一段\n\nC\n'
    const from = doc.indexOf('B')
    const segs: Seg[] = [{ from, to: doc.indexOf('C') }]
    const lineAt = linesOf(doc)
    expect(seen(doc, hiddenRanges(segs, 0, lineAt))).toBe('A\n\nC\n')
    expect(seen(doc, hiddenRanges(segs, 3, lineAt))).toBe('A\n\nB 新\nC\n')
  })
  it('改写一行中间的几个字：前后没改的字一直看得见', () => {
    const doc = '残差网络的核心是捷径，所以能叠一百多层。\n'
    const from = doc.indexOf('捷径')
    const segs: Seg[] = [{ from, to: from + 2 }]
    expect(seen(doc, hiddenRanges(segs, 0, linesOf(doc)))).toBe('残差网络的核心是，所以能叠一百多层。\n')
    expect(seen(doc, hiddenRanges(segs, 1, linesOf(doc)))).toBe('残差网络的核心是捷，所以能叠一百多层。\n')
  })
  it('一整块：没显到时整块藏着，显到就整块出来', () => {
    const doc = '前面\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n后面\n'
    const t0 = doc.indexOf('|')
    const t1 = doc.indexOf('\n\n后面')
    const segs: Seg[] = [{ from: t0, to: t1, atom: true }]
    expect(seen(doc, hiddenRanges(segs, 0, linesOf(doc)))).toBe('前面\n\n\n后面\n')
    expect(hiddenRanges(segs, 1, linesOf(doc))).toEqual([])
  })
  it('上一行是整块画的（表格）：不往它那一行接', () => {
    const doc = '| a |\n| - |\n新的一行\n'
    const from = doc.indexOf('新')
    const segs: Seg[] = [{ from, to: from + 4 }]
    const r = hiddenRanges(segs, 0, linesOf(doc), (p) => p < from)
    expect(r).toEqual([{ from, to: from + 4 }])
  })
  it('几截挨着的藏成一截，按文档顺序', () => {
    const doc = 'xx一二三四五六\n'
    const segs: Seg[] = [
      { from: 2, to: 5 },
      { from: 5, to: 8 },
    ]
    expect(hiddenRanges(segs, 1, linesOf(doc))).toEqual([{ from: 3, to: 8 }])
  })
})

describe('trimSpan：竖线挂在写进来的字上，不算头尾的空行', () => {
  it('去掉头尾空白', () => {
    expect(trimSpan('\n\n## 评价\n\n第一段。\n', 10)).toEqual({ from: 12, to: 12 + '## 评价\n\n第一段。'.length })
  })
  it('全是空白：没有', () => {
    expect(trimSpan('\n\n  \n', 3)).toBeNull()
  })
})
