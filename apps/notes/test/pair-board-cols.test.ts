// 配对笔记切到白板：问过 AI 一处一列（2026-11-23 用户：「每个问话作为一列吧，旁支的话可以作为主对话放在对话那一列」）。
// 列头是那一节的标题；卡是链接和框的图、一问一答（回答的后半截按小标题分几张）、旁支（排在它那一问下面）、小结；那一页「划的线」并进来。
// 只切看法不写字；挪整列只在标题前面多一行位置，配对笔记认回来的每一节一个字不变。
import { describe, expect, it } from 'vitest'
import { parseReadingNote, placeColumn, splitDoc } from '@cn/format'
import { PB_MD, PB_NOTE } from '../e2e/fixtures/paired-board'

const cols = (t: string) => splitDoc(t).columns.map((c) => [c.title, c.ask, c.cards.map((u) => u.ask?.part ?? u.kind)])

describe('配对笔记一处一列', () => {
  it('每一处一列；旁支跟在它那一问后面；划线并进那一页；没问过的那页划线自己一列、自己写的照旧', () => {
    expect(cols(PB_MD)).toEqual([
      ['第 1 页 · 线性映射的定义', true, ['top', 'qa', 'more', 'more', 'side', 'side', 'qa', 'side', 'recap']],
      ['第 2 页 · 加法条件', true, ['top', 'qa', 'recap', 'marks']],
      ['第 4 页 · 核与像', true, ['top', 'qa', 'recap', 'marks']],
      ['第 5 页 · 划的线', false, ['marks']],
      ['我的总结', false, ['text']],
    ])
    const b = splitDoc(PB_MD)
    const [p1, p2, p4] = b.columns
    expect(p1!.page).toBe(1)
    // 第一问带着第一个小标题那一段；第二个小标题起另起一张
    expect(p1!.cards[1]!.text).toBe('> [!question] 这块在讲什么？\n\n### 一句话\n\n线性映射就是保持加法和数乘的映射。')
    expect(p1!.cards[2]!.text.startsWith('#### 两条条件')).toBe(true)
    // 第一条旁支连着接着问的那一轮是一张；第二条（有自己的那一句）另一张
    expect(p1!.cards[4]!.text).toBe('> [!side] 为什么叫「线性」？\n> > 保持加法和数乘\n>\n> 因为直线经过它还是直线，原点不动。\n\n> [!side] 那平移算不算？\n>\n> 不算，平移把原点挪走了。')
    expect(p1!.cards[5]!.text.startsWith('> [!side] 数乘为什么要单独列一条？')).toBe(true)
    // 卡的范围都是原文里的：拼回去和那一节一样（只差中间的空行）
    for (const c of [p1!, p2!, p4!]) for (const u of c.cards) expect(PB_MD.slice(u.from, u.to)).toBe(u.text)
    // 划线：第 2 页的写在问的前面，也进第 2 页那一列
    expect(p2!.cards[3]!.text).toContain('T(u + v) = T(u) + T(v)')
    expect(p4!.cards[3]!.text).toContain('the kernel of T')
    expect(b.total).toBe(9 + 4 + 4 + 1 + 1)
  })

  it('同一页问了两处：划线进第一处', () => {
    const t = PB_MD.replace('## 第 4 页 · 核与像', '## 第 2 页 · 核与像').replace('[第 4 页](第3讲.pdf#page=4)', '[第 2 页](第3讲.pdf#page=2)').replace('## 第 4 页 · 划的线', '## 第 6 页 · 划的线')
    const b = splitDoc(t)
    expect(b.columns.filter((c) => c.page === 2).map((c) => c.cards.filter((u) => u.ask?.part === 'marks').length)).toEqual([1, 0])
  })

  it('按住卡拖走一整列：标题前面多一行位置，配对笔记认回来的每一节一个字不变', () => {
    const b = splitDoc(PB_MD)
    const out = placeColumn(PB_MD, b.columns[0]!, 900, 120)
    expect(out).toBe(PB_MD.replace('## 第 1 页 · 线性映射的定义', '<!-- column id=c1 x=900 y=120 -->\n## 第 1 页 · 线性映射的定义'))
    expect(parseReadingNote(out, PB_NOTE)).toEqual(parseReadingNote(PB_MD, PB_NOTE))
    const again = splitDoc(out)
    expect(again.columns[0]!.place).toMatchObject({ id: 'c1', x: 900, y: 120 })
    expect(again.columns[0]!.cards.map((u) => u.ask?.part)).toEqual(['top', 'qa', 'more', 'more', 'side', 'side', 'qa', 'side', 'recap'])
  })

  it('回答里代码块中的 # 和 > [!side] 不算', () => {
    const t = '# x\n\n## 第 1 页 · 代码\n[第 1 页](a.pdf#page=1) · 10:00 <!-- cn:thread=a-p1-1 -->\n\n> [!question] 看代码\n\n先看这段：\n\n```md\n# 不是标题\n> [!side] 不是旁支\n```\n\n完。\n'
    expect(cols(t)).toEqual([['第 1 页 · 代码', true, ['top', 'qa']]])
  })
})
