/**
 * 「打开再保存文件不变」用的样本：各种容易被改坏的写法。单元测试和端到端测试共用。
 */
const enc = (s: string) => new TextEncoder().encode(s)

const frontmatterBoard = `---
type: board
links:
  - a1 -> a2
---
# 冰岛自驾

<!-- card id=a1 x=120 y=300 w=280 color=yellow -->
> 冰洞只在冬天开放，要跟向导进去
> —— [Ice caves](https://example.com/ice)

<!-- card id=a2 x=460 y=300 w=280 -->
2.27 和 2.28 的住处还没订。

<!-- column id=c1 x=800 y=80 w=280 title="要订的" -->
<!-- card id=a4 in=c1 -->
- [ ] 车
- [x] 机票

<!-- columns widths=40,30,30 -->
左栏……
<!-- col -->
中栏……
<!-- col -->
右栏……
<!-- /columns -->

<!-- card id=a3 没有配对的注释也要原样留着
[[所思所想]] 和 ^abc123 块编号
`

/** 读 PDF 的笔记做成一篇长文档（新格式，CN-93–96）：问题原话、回答原文（公式、表格、标题）、旁支、脚注、小结，后面跟一段旧格式和自己写的一段 */
const readingDoc = `---
类型: 笔记
课程: ecpc
第几讲: 5
来源: "[[Lecture05.pdf]]"
日期: 2026-11-19
AI填的: 课程, 第几讲
进度: 28/43
---

# Lecture05 笔记

## 第 28 页 · LIF 神经元的三条公式
[第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6) · 20:21 <!-- cn:thread=Lecture05-p28-1 -->

![我框的|268](附件/Lecture05/p28-1.png)

> [!question] 给我讲解一下

**一句话：LIF 神经元就是一个会漏水的水桶。**

### 第一条：水位怎么变

$$\\tau_m \\frac{dV_m}{dt} = -V_m(t) + I_s(t) + I_b$$

| 步 | 水位 |
|---|---|
| 1 | 0.200 |

> [!side] 为什么减掉门槛，而不是清零？
> > 水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量
>
> 水位冲到 1.3 时，减掉 1 还剩 0.3。

> [!side] 那门槛是多少？
>
> 这一页设成 1。

> [!question] [^p28-1-1]和[^p28-1-2]说的是一回事吗？

是一回事。

> [!recap] LIF 用「漏、积、发」三步描述神经元；另问了为什么不清零。

[^p28-1-1]: 「水位一到门槛就发一个 spike」 AI的回答 · 第28页
[^p28-1-2]: ![粘贴的图|180](附件/Lecture05/p28-1-m2.png)

[可视化 · LIF 水桶](LIF%20水桶.html) · [[第4讲 脉冲网络]]

## 第 30 页 · 以前记的一段
[第 30 页](Lecture05.pdf#page=30) · 20:30

> [!question] 我的疑惑
> 整块没看懂：第 30 页框的这块

> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 30 页
> 先看图，再看公式。

[完整对话 · 1 轮](.canvas-notes/对话/Lecture05-p30-1.md)

## 我自己记的

考试要考。
`

export const FIXTURES: Record<string, Uint8Array> = {
  'Lecture05 笔记.md': enc(readingDoc),
  'plain.md': enc('# 所思所想\n\n最近在看纳瓦尔宝典。\n\n**财富**是靠专长、杠杆。\n'),
  'no-trailing-newline.md': enc('最后一行没有换行'),
  'trailing-spaces.md': enc('行尾两个空格  \n\t缩进用 tab\n\n\n\n多个空行\n   '),
  'crlf.md': enc('# Windows 换行\r\n\r\n第一段\r\n第二段\r\n'),
  'bom.md': new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# 带 BOM 的文件\n\n内容\n')]),
  'bom-crlf.md': new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# BOM 加 CRLF\r\n内容\r\n')]),
  'mixed-eol.md': enc('混用换行\r\n这一行是 LF\n这一行是 CRLF\r\n'),
  'emoji-cjk.md': enc('表情 👨‍👩‍👧‍👦 和 𠮷 和组合字 é́\n全角，标点。「引号」\n'),
  'board.md': enc(frontmatterBoard),
  'html-and-tables.md': enc('| a | b |\n|---|:-:|\n| 1 | 2 |\n\n<details><summary>折叠</summary>\n\n里面\n\n</details>\n\n```js\nconst x = 1\r\n```\n'),
  'empty.md': new Uint8Array(),
  'only-newlines.md': enc('\n\n\n'),
  'lone-cr.md': enc('老 Mac 换行\r第二行\r'),
  'invalid-utf8.md': new Uint8Array([...enc('坏字节：'), 0xff, 0xfe, ...enc('\n')]),
}
