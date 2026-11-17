import { describe, expect, it } from 'vitest'
import { detailsHead, moveUnit, placeUnit, resetLayout, splitDoc, unplaceUnit } from '../src/doc-board'

export const LECTURE = `# Lecture05 笔记

读 PDF 时记的。

## 这一讲讲什么

这一讲从为什么要专用硬件讲起。

### 九层结构

- 上三层是软件
- 下三层是电路

## 第 3 页 · 计算栈的九层结构

> [!question] 我的疑惑
> 九层是哪九层？

> [!success] 讲通的讲法（第 1 版）
> 从应用到物理。

## 第 5 页 · 加速器为何又快又省

> [!question] 我的疑惑
> 为什么省电？

## 用代码验证

各跑一遍：

\`\`\`python
print(1)
\`\`\`

***

| 方法 | 时间 |
|---|---|
| CPU | 3s |
`

export const TRAVEL = `# 冰岛十天环岛

## 出发前

还没订完的：

- [ ] 租车
- [x] 机票

![黑沙滩](附件/a.png)

![冰川](附件/b.png)

> 冰岛的天气五分钟一变。
—— [旅行杂志](https://example.com)

## 路线

<!-- video video=youtube:abc -->
![雷克雅未克](附件/v.jpg)
[雷克雅未克](https://www.youtube.com/watch?v=abc)
频道 · 08:55

<!-- moment video=youtube:abc t=12 -->
![00:12](附件/m.jpg)
[▶ 00:12 · 雷克雅未克](https://www.youtube.com/watch?v=abc&t=12s)
> **00:12 第一站**

第一天：雷克雅未克。
`

const cardsOf = (t: string) => splitDoc(t).columns.map((c) => [c.title, c.cards.map((u) => u.kind)])

describe('文档切到白板：分卡（方向 A）', () => {
  it('Lecture05 笔记：名字不成卡；开头一组没有列头；## 是列，### 是小标题；连着的「问过 AI」合成一列；冒号那句带上代码块；分隔线是空隙', () => {
    const b = splitDoc(LECTURE)
    expect(b.title).toBe('Lecture05 笔记')
    expect(cardsOf(LECTURE)).toEqual([
      [null, ['text']],
      ['这一讲讲什么', ['text', 'list']],
      ['问过 AI', ['ask', 'ask']],
      ['用代码验证', ['code', 'gap', 'table']],
    ])
    expect(b.columns[1]!.cards[1]!.sub).toBe('九层结构')
    expect(b.columns[3]!.cards[0]!.text).toBe('各跑一遍：\n\n```python\nprint(1)\n```')
    expect(b.columns[2]!.ask).toBe(true)
    expect(b.columns[2]!.cards[0]!.text.startsWith('## 第 3 页 · 计算栈的九层结构')).toBe(true)
  })

  it('旅行稿：冒号那句带上待办；连着的图合成图集；视频后面的时刻挂在视频卡下面', () => {
    expect(cardsOf(TRAVEL)).toEqual([
      ['出发前', ['todo', 'images', 'quote']],
      ['路线', ['video', 'text']],
    ])
    const video = splitDoc(TRAVEL).columns[1]!.cards[0]!
    expect(video.moments).toHaveLength(1)
    expect(video.moments![0]!.text.startsWith('<!-- moment video=youtube:abc t=12 -->')).toBe(true)
  })

  it('套着的折叠块（外层两行写法套内层）：外层整块一张卡，不露出外层的 HTML', () => {
    const doc = '# 折叠丁\n\n<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n最里面。\n\n</details>\n\n</details>\n\n后面一段。\n'
    const cols = splitDoc(doc).columns
    const units = cols.flatMap((c) => c.cards)
    expect(units.map((u) => u.kind)).toEqual(['details', 'text'])
    expect(units[0]!.text).toBe('<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n最里面。\n\n</details>\n\n</details>')
  })

  it('折叠块 <details> 到 </details> 整块一张卡，不拆成标签、正文、收尾三张；不配对的照普通块', () => {
    const doc = '# 冰岛\n\n## 问过 AI\n\n> [!warning] 注意\n> 买保险。\n\n<details><summary>没讲通 · 第 1 版</summary>\n\n旧讲法：钉胎像钉鞋。\n\n### 里面的小标题\n\n- 一\n- 二\n\n</details>\n\n后面一段。\n'
    expect(cardsOf(doc)).toEqual([['问过 AI', ['callout', 'details', 'text']]])
    const d = splitDoc(doc).columns[0]!.cards[1]!
    expect(d.text.startsWith('<details><summary>没讲通 · 第 1 版</summary>')).toBe(true)
    expect(d.text.endsWith('</details>')).toBe(true)
    expect(d.sub).toBeUndefined()
    // 没有 </details>：开头那行照 html 块，后面照常分卡
    expect(cardsOf('# 冰岛\n\n## 甲\n\n<details><summary>半截</summary>\n\n正文。\n')).toEqual([['甲', ['details', 'text']]])
  })

  it('斜杠插入的折叠块（空的、写了字的）和读 PDF 写的「没讲通 · 第 N 版」都是整块一张卡', () => {
    const slashEmpty = '<details><summary>收起的内容</summary>\n\n\n\n</details>'
    const slashFilled = '<details><summary>收起的内容</summary>\n\n第一段。\n\n- 一条\n- 两条\n\n</details>'
    const failed = '<details><summary>没讲通 · 第 2 版：用公式推，没听懂</summary>\n\n先写 Ax = λx，再移项……\n\n</details>'
    for (const block of [slashEmpty, slashFilled, failed]) {
      const doc = `# 笔记\n\n## 一节\n\n前面一段。\n\n${block}\n\n后面一段。\n`
      expect(cardsOf(doc)).toEqual([['一节', ['text', 'details', 'text']]])
      expect(splitDoc(doc).columns[0]!.cards[1]!.text).toBe(block)
    }
  })

  it('两行写的 <details>（下一行 <summary>）也是一张卡；</details> 下一行紧贴着写的字单独一张卡（文档里也画在折叠块外面）', () => {
    const doc = '# 预算\n\n## 一节\n\n<details>\n<summary>旧的预算</summary>\n\nY\n\n</details>\n收尾一段。\n'
    expect(cardsOf(doc)).toEqual([['一节', ['details', 'text']]])
    const [d, t] = splitDoc(doc).columns[0]!.cards
    expect(d!.text).toBe('<details>\n<summary>旧的预算</summary>\n\nY\n\n</details>')
    expect(t!.text).toBe('收尾一段。')
  })

  it('<details> 和 <summary> 中间空一行、<summary> 写成好几行：也是一张折叠卡（第 4 轮）', () => {
    for (const head of ['<details>\n\n<summary>旧的预算</summary>', '<details>\n<summary>\n旧的预算\n</summary>', '<details><summary>旧的\n预算</summary>']) {
      const doc = `# 预算\n\n## 一节\n\n${head}\n\nY\n\n</details>\n\n收尾一段。\n`
      expect(cardsOf(doc)).toEqual([['一节', ['details', 'text']]])
      expect(splitDoc(doc).columns[0]!.cards[0]!.text).toBe(`${head}\n\nY\n\n</details>`)
    }
  })

  it('detailsHead：认一行、两行、中间空行、多行 summary；标题里有空行、summary 不在开头的不认', () => {
    const at = (t: string) => detailsHead(t.split('\n'), 0)
    expect(at('<details><summary>甲</summary>')).toEqual({ title: '甲', open: false, lines: 1 })
    expect(at('<details open>\n<summary>乙</summary>')).toEqual({ title: '乙', open: true, lines: 2 })
    expect(at('<details>\n\n<summary>丙</summary>\n\n正文')).toEqual({ title: '丙', open: false, lines: 3 })
    expect(at('<details>\n<summary>\n  丁 丁\n</summary>\n正文')).toEqual({ title: '丁 丁', open: false, lines: 4 })
    expect(at('<details><summary>戊\n续</summary>')).toEqual({ title: '戊 续', open: false, lines: 2 })
    expect(at('<details>\n<summary>己\n\n正文</summary>')).toBeNull()
    expect(at('<details>\n正文\n<summary>庚</summary>')).toBeNull()
    expect(at('<details>\n\n正文')).toBeNull()
  })

  it('用 # 分节的文档：# 就是列', () => {
    expect(cardsOf('# 一\n\n甲\n\n# 二\n\n乙\n')).toEqual([
      ['一', ['text']],
      ['二', ['text']],
    ])
  })

  it('336 段的长文档：12 节每节 28 段，切得出、一张不漏', () => {
    const long = '# 全学期\n\n' + Array.from({ length: 12 }, (_, s) => `## 第 ${s + 1} 讲\n\n` + Array.from({ length: 28 }, (_, p) => `第 ${s + 1} 讲第 ${p + 1} 段。`).join('\n\n')).join('\n\n') + '\n'
    const b = splitDoc(long)
    expect(b.columns).toHaveLength(12)
    expect(b.total).toBe(336)
    expect(b.columns.every((c) => c.cards.length === 28)).toBe(true)
  })
})

describe('文档切到白板：写回', () => {
  it('拖进别的列：文档里这段也挪进那一节，别的字一个不动', () => {
    const b = splitDoc(TRAVEL)
    const quote = b.columns[0]!.cards[2]!
    const out = moveUnit(TRAVEL, quote, b.columns[1]!, null)
    expect(out).toBe(TRAVEL.replace('> 冰岛的天气五分钟一变。\n—— [旅行杂志](https://example.com)\n\n', '') + '\n> 冰岛的天气五分钟一变。\n—— [旅行杂志](https://example.com)\n')
    expect(cardsOf(out)).toEqual([
      ['出发前', ['todo', 'images']],
      ['路线', ['video', 'text', 'quote']],
    ])
    // 同一列里往上挪：插到这张前面
    const b2 = splitDoc(TRAVEL)
    const up = moveUnit(TRAVEL, b2.columns[0]!.cards[2]!, b2.columns[0]!, b2.columns[0]!.cards[0]!)
    expect(cardsOf(up)[0]).toEqual(['出发前', ['quote', 'todo', 'images']])
    expect(up.length).toBe(TRAVEL.length)
  })

  it('「问过 AI」那一列不能往里放', () => {
    const b = splitDoc(LECTURE)
    expect(() => moveUnit(LECTURE, b.columns[1]!.cards[0]!, b.columns[2]!, null)).toThrow('问过 AI')
  })

  it('拖到空白处：只在这段前面多一行位置，正文顺序不变；它在白板上单独摆，记得在哪一节；再拖改坐标；摆回原样去掉', () => {
    const b = splitDoc(TRAVEL)
    const out = placeUnit(TRAVEL, b.columns[0]!.cards[2]!, 900, 120.4)
    expect(out).toBe(TRAVEL.replace('> 冰岛的天气', '<!-- card id=d1 x=900 y=120 -->\n> 冰岛的天气'))
    const p = splitDoc(out)
    expect(p.columns[0]!.cards.map((u) => u.kind)).toEqual(['todo', 'images'])
    expect(p.placed).toHaveLength(1)
    expect(p.placed[0]).toMatchObject({ kind: 'quote', section: '出发前', place: { id: 'd1', x: 900, y: 120 } })
    const moved = placeUnit(out, p.placed[0]!, 40, 60)
    expect(moved).toBe(TRAVEL.replace('> 冰岛的天气', '<!-- card id=d1 x=40 y=60 -->\n> 冰岛的天气'))
    expect(unplaceUnit(moved, splitDoc(moved).placed[0]!)).toBe(TRAVEL)
    expect(resetLayout(moved)).toBe(TRAVEL)
    // 拖出来的卡再拖进列：位置行一起拿掉，正文挪过去
    const back = moveUnit(moved, splitDoc(moved).placed[0]!, splitDoc(moved).columns[1]!, null)
    expect(back).not.toContain('<!-- card')
    expect(cardsOf(back)[1]).toEqual(['路线', ['video', 'text', 'quote']])
  })

  it('文档里的位置行只管后面那一张卡（后面的段落不会被吞进去）', () => {
    const t = '## 一\n\n<!-- card id=d1 x=10 y=20 -->\n甲\n\n乙\n'
    const b = splitDoc(t)
    expect(b.placed.map((u) => u.text)).toEqual(['甲'])
    expect(b.columns[0]!.cards.map((u) => u.text)).toEqual(['乙'])
  })
})
