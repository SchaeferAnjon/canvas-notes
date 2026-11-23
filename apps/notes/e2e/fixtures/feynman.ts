/**
 * 费曼学习（task-yvabi 方向 B，② 白板上讲的界面）的样本库：照设计页 16-费曼学习 的原型——
 * 一块导图白板「导图 · 线性代数 2.3」（导图三支：标量和向量、矩阵乘法、范数，下面四张剪自同一页的卡），
 * 一块文档白板「线性代数 2.3 白板」（一列「2.3.10 范数」四张剪藏卡、一列「矩阵乘法」两张、空白处一张子白板卡），
 * 一份 PDF「第2周 习题.pdf」、一篇别的笔记。两块白板都和网页 BOOK_URL 配成一对（属性 read-along）。
 */
import { lecturePdf } from './pdf'

export const MAP_PATH = '课程/导图 · 线性代数 2.3.md'
export const BOARD_PATH = '课程/线性代数 2.3 白板.md'
export const PDF_PATH = '课程/第2周 习题.pdf'
export const NOTE_PATH = '课程/第2周 笔记.md'
export const SUB_PATH = '课程/范数的例子.md'

/** 配对的网页（测试里起一个本机小服务器，换掉这个占位） */
export const BOOK_HOST = '__BOOK__'

const clip = (text: string) => `> ${text}\n—— [zh.d2l.ai](${BOOK_HOST}/linear-algebra.html)`

export const MAP = `---
type: board
白板样式: 导图
read-along: ${BOOK_HOST}/
---
# 导图 · 线性代数 2.3

- 线性代数 2.3
  - 标量和向量
    - 向量就是一列数
  - 矩阵乘法
    - AB 是做 m 次矩阵乘向量
    - 别和 Hadamard 积（按元素乘）混
  - 范数
    - 量向量有多大，不管有几维
    - f(αx) = |α| f(x)
    - 三角不等式 f(x+y) ≤ f(x) + f(y)
    - 非负 f(x) ≥ 0
    - L2：平方和开根 · L1：绝对值之和

<!-- card id=k1 x=40 y=620 w=300 -->
${clip('范数表示一个向量有多大，不涉及维度，只看分量的大小。')}

<!-- card id=k2 x=370 y=620 w=300 -->
${clip('按常数 α 缩放向量，范数按 |α| 缩放：f(αx) = |α| f(x)')}

<!-- card id=k3 x=40 y=760 w=300 -->
${clip('三角不等式：f(x + y) ≤ f(x) + f(y)')}

<!-- card id=k4 x=370 y=760 w=300 -->
${clip('范数必须非负：f(x) ≥ 0')}
`

export const BOARD = `---
type: board
read-along: ${BOOK_HOST}/
---
# 线性代数 2.3 白板

## 2.3.10 范数

${clip('范数表示一个向量有多大，不涉及维度，只看分量的大小。')}

${clip('按常数 α 缩放向量，范数按 |α| 缩放：f(αx) = |α| f(x)')}

${clip('三角不等式：f(x + y) ≤ f(x) + f(y)')}

${clip('范数必须非负：f(x) ≥ 0')}

## 矩阵乘法

矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积，再把结果拼在一起。

> 矩阵-矩阵乘法可以简单地称为矩阵乘法，不应与“Hadamard积”混淆。

<!-- card id=s1 x=700 y=420 -->
[[范数的例子]]

<!-- card id=p1 x=1010 y=420 -->
![[第2周 习题.pdf]]
`

export const SUB = `---
type: board
所属白板: "[[线性代数 2.3 白板]]"
---
# 范数的例子

(3, 4) 的 L2 范数是 5，L1 范数是 7。
`

export const NOTE = `# 第2周 笔记

这一周讲了矩阵乘法和范数。
`

export function feynmanFiles(book: string): Record<string, string | Uint8Array> {
  const put = (s: string) => s.split(BOOK_HOST).join(book)
  return {
    [MAP_PATH]: put(MAP),
    [BOARD_PATH]: put(BOARD),
    [SUB_PATH]: SUB,
    [NOTE_PATH]: NOTE,
    [PDF_PATH]: lecturePdf([
      { title: '2.3.1 Scalars and vectors', lines: ['A scalar is a tensor with one element.', 'A vector is a list of numbers.'] },
      { title: '2.3.8 Matrix multiplication', lines: ['AB is m matrix-vector products put side by side.'] },
      { title: '2.3.10 Norms', lines: ['A norm tells how big a vector is.', 'f(ax) = |a| f(x)', 'f(x + y) <= f(x) + f(y)', 'f(x) >= 0'] },
    ]),
  }
}

/** 配对网页的那一页（本机小服务器给） */
export const BOOK_PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>2.3. 线性代数 — 动手学深度学习 2.0.0 documentation</title>
<style>body{font:15px/1.75 -apple-system,"PingFang SC",sans-serif;margin:0;color:#222}header{background:#2196f3;color:#fff;padding:12px 18px;font-size:18px}main{padding:14px 20px}h3{color:#2196f3;font-weight:500}.eq{text-align:center;font-style:italic;font-family:serif;font-size:17px}</style></head>
<body><header>2.3. 线性代数</header><main><h3>2.3.10. 范数</h3>
<p>线性代数中最有用的一些运算符是范数（norm）。非正式地说，向量的范数是表示一个向量有多大。这里考虑的大小（size）概念不涉及维度，而是分量的大小。</p>
<p>在线性代数中，向量范数是将向量映射到标量的函数 f。给定任意向量 x，向量范数要满足一些属性。第一个性质是：如果我们按常数因子 α 缩放向量的所有元素，其范数也会按相同常数因子的绝对值缩放：</p>
<p class="eq">f(αx) = |α| f(x).　(2.3.10)</p>
<p>第二个性质是熟悉的三角不等式：</p><p class="eq">f(x + y) ≤ f(x) + f(y).　(2.3.11)</p>
<p>第三个性质简单地说范数必须是非负的：</p><p class="eq">f(x) ≥ 0.　(2.3.12)</p></main></body></html>`
