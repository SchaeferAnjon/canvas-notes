// 「存成命令」的提炼：提示、读 AI 的回答、依据落在第几行、只改这一篇照提交算、测试用的假回答（task-9womr）
import { describe, expect, it } from 'vitest'
import { anchorLine, anchorLines, type DistillInput, distillPrompt, fakeDistill, jsonIn, parseDistill, scopeRule } from '../src/shared/distill'

export const BEFORE = `# 学习笔记

教材：《动手学深度学习》，PyTorch 版。

> 任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。

—— 前言 — 动手学深度学习 2.0.0 documentation

> （1）以特定方式提出问题的动机；（2）给定建模方法的数学。

—— 前言 — 动手学深度学习 2.0.0 documentation

![](附件/截图 1.png)

> 张量表示一个由数值组成的数组。

—— 2.1. 数据操作 — 动手学深度学习 2.0.0 documentation

![](附件/截图 2.png)

**问** 广播什么时候发生

**答** 形状不同、但能扩展成一样时。
`

export const AFTER = `# 学习笔记：动手学深度学习

教材：《动手学深度学习》，PyTorch 版。

## 前言

出处：动手学深度学习 · 前言

> 任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。

要真正用好深度学习，得同时懂四样东西。

## 2.1 数据操作

出处：动手学深度学习 · 2.1 节

张量就是多维数组。

| 写法 | 意思 |
| --- | --- |
| x | 标量 |

**问** 广播什么时候发生

**答** 形状不同、但能扩展成一样时。
`

const input: DistillInput = {
  path: '课程/学习笔记.md',
  title: '学习笔记',
  before: BEFORE,
  after: AFTER,
  asks: ['整理当前页面', '继续', '我没看到你改动啊 你是怎么改的? 图片的话都转成文字', '就是那种通顺的 可读的. 现在还是太乱了.'],
  commits: [
    { hash: '3a370f4', ask: '整理当前页面', files: [{ path: '课程/学习笔记.md', added: 105, removed: 123 }] },
    { hash: '5b1e0c2', ask: '继续', files: [{ path: '课程/学习笔记.md', added: 41, removed: 12 }] },
  ],
}

describe('提炼规矩', () => {
  it('提示里有这几轮说的话、改前改后的全文，要 JSON', () => {
    const p = distillPrompt(input)
    expect(p.split('\n')[0]).toBe('命令：提炼规矩')
    expect(p).toContain('2. 继续')
    expect(p).toContain('<before>\n# 学习笔记\n')
    expect(p).toContain('<after>\n# 学习笔记：动手学深度学习\n')
    expect(p).toContain('只输出 JSON')
  })
  it('读回答：依据只留那一篇里真有的；只改这一篇不收 AI 的，照提交另加一条', () => {
    const ans = '好的：\n```json\n' + JSON.stringify({
      rules: [
        { rule: '按章节分节，每节一个「##」小标题', evidence: '改后多了 2 个小标题', before: [], after: ['## 前言', '## 2.1 数据操作', '## 不存在的标题'] },
        { rule: '只改这一篇', evidence: 'x', before: [], after: [] },
        { rule: '问答保留原样', evidence: '1 组问答一字没改', before: ['**问** 广播什么时候发生'], after: ['**问** 广播什么时候发生'] },
      ],
      unused: ['继续', '我没看到你改动啊 你是怎么改的?', '没说过的话'],
    }) + '\n```'
    const d = parseDistill(ans, input)
    expect(d.rules.map((r) => r.t)).toEqual(['按章节分节，每节一个「##」小标题', '问答保留原样', '只改这一篇：不新建、不挪、不删别的文件'])
    expect(d.rules[0]!.after).toEqual(['## 前言', '## 2.1 数据操作'])
    expect(d.rules[2]).toMatchObject({ scope: true, e: '2 轮的 2 次提交都只改了「学习笔记.md」' })
    expect(d.unused).toEqual(['继续', '我没看到你改动啊 你是怎么改的?'])
  })
  it('有一轮改了别的文件：不加只改这一篇', () => {
    expect(scopeRule({ path: 'a.md', commits: [{ hash: '1', ask: 'x', files: [{ path: 'a.md', added: 1, removed: 0 }, { path: 'b.md', added: 1, removed: 0 }] }] })).toBeNull()
    expect(scopeRule({ path: 'a.md', commits: [] })).toBeNull()
  })
  it('依据落在第几行：整行一样的先认，同一句出现几次依次往下找，去掉 # > 也认', () => {
    expect(anchorLine(AFTER, '## 前言')).toBe(5)
    expect(anchorLine(AFTER, '前言')).toBe(5)
    expect(anchorLines(BEFORE, ['—— 前言 — 动手学深度学习 2.0.0 documentation', '—— 前言 — 动手学深度学习 2.0.0 documentation'])).toEqual([7, 11])
    expect(anchorLine(AFTER, '没有这一句')).toBeNull()
  })
  it('回答里的 JSON：代码块、前后带话、数组都认', () => {
    expect(jsonIn('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(jsonIn('看了一下：{"a":2} 就这些')).toEqual({ a: 2 })
    expect(jsonIn('[1,2]')).toEqual([1, 2])
    expect(jsonIn('没有')).toBeNull()
  })
  it('测试用的假回答真比一遍：小标题、出处、图、引文、问答五条，依据都找得到；太短的话算没用上', () => {
    const d = parseDistill(fakeDistill(distillPrompt(input)), input)
    expect(d.rules.map((r) => r.t)).toEqual([
      '按书的章节分节，每节一个「##」小标题',
      '同一个出处只写一次，放在节头',
      '图里的内容写成文字：表格写成表格；原图留在附件里',
      '每节先用一两句话讲清楚，原文只留要紧的一句',
      '问答保留原样',
      '只改这一篇：不新建、不挪、不删别的文件',
    ])
    expect(d.rules[0]!.after).toEqual(['## 前言', '## 2.1 数据操作'])
    expect(d.rules[1]!.before).toHaveLength(3)
    expect(d.rules[2]!.before).toEqual(['![](附件/截图 1.png)', '![](附件/截图 2.png)'])
    expect(d.unused).toEqual(['继续', '我没看到你改动啊 你是怎么改的?'])
    expect(d.name).toBe('整理成通顺笔记')
  })
})
