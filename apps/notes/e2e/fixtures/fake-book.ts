/**
 * 本机一本假的在线书（照 zh.d2l.ai 排：一章一个网址、Sphinx 的标题「2.1. 数据操作 — 动手学深度学习 2.0.0 documentation」、
 * 小标题后面带「¶」）：长网页，滚得到中间某一段。2.1 那一章照 zh.d2l.ai 的 MDL 排法：窗口不滚，里面一块固定高的正文区滚，
 * 顶上一条固定的头；前言、2.2 是普通的整页滚动。changed 打开时 2.1 整章改写过（模拟网站改了版，上次那段的字对不上）。
 */
import { createServer, type Server } from 'node:http'

export interface FakeBook {
  base: string
  /** 网站改版了：2.1 的每一段都换了说法 */
  changed: boolean
  /** 一共被要过几次页（看软件有没有去网上） */
  hits: string[]
  close(): Promise<void>
}

export const BOOK = '动手学深度学习'
const SUFFIX = ' — 动手学深度学习 2.0.0 documentation'

/** 2.1 里要滚到的那一段（测试拿它看回没回到那段） */
export const TARGET = '和 Python 的列表一样，张量里的元素可以用索引访问：第一个元素的索引是 0，最后一个是 -1；也可以指定范围取出一段。'
export const TARGET_HEAD = '2.1.4. 索引和切片'
/** 2.2 里往下滚到的那一段 */
export const TARGET2 = '对数值列，可以用同一列的均值替换缺失值；对类别值或离散值，可以把缺失值看作一个类别，单独编码。'
export const TARGET2_HEAD = '2.2.2. 处理缺失值'

const FILL = [
  '这一段用来把网页撑长：真书里这里是一段讲解，读的人会边看边在旁边的笔记里记下要点。',
  '张量的很多运算和 NumPy 的数组一样，但它们能放到 GPU 上算，还能自动求导，这是深度学习框架的两样本事。',
  '读到这里可以停下来，在笔记里写一句自己的理解，再接着往下看下一小节。',
  '为了让例子能跑，这里的代码都可以直接复制到 Jupyter 记事本里运行，结果和书上印的一样。',
  '如果哪一步没看懂，先把形状打印出来，很多问题都出在形状对不上。',
]

function sections(changed: boolean): { h: string; ps: string[] }[] {
  const re = (s: string) => (changed ? `（改版后的说法）${s.split('').reverse().join('')}` : s)
  const fill = (tag: string) => FILL.map((s, i) => re(`${tag} 第${i + 1}段：${s}`))
  return [
    { h: '2.1.1. 入门', ps: [re('张量表示一个由数值组成的数组，这个数组可能有多个维度。只有一个轴的张量叫向量，有两个轴的叫矩阵。'), ...fill('入门')] },
    { h: '2.1.2. 运算符', ps: [re('我们想做的不只是读写数据，还要在数据上做数学运算。最简单也最有用的是按元素运算。'), ...fill('运算符')] },
    { h: '2.1.3. 广播机制', ps: [re('形状不同的两个张量也能按元素运算，这时会用到广播机制：先适当复制元素，让它们形状相同。'), ...fill('广播')] },
    { h: TARGET_HEAD, ps: [re(TARGET), re('除了读，还可以通过指定索引把元素写进矩阵。想给多个元素赋同一个值，只要索引出它们，再一起赋值。'), ...fill('索引')] },
    { h: '2.1.5. 节省内存', ps: [re('运行一些操作可能会为新结果分配内存。比如 Y = X + Y 会让 Y 指向新分配的内存。'), ...fill('内存')] },
    { h: '2.1.6. 小结', ps: [re('深度学习存储和操作数据的主要接口是张量，它提供基本数学运算、广播、索引、切片这些功能。'), ...fill('小结')] },
  ]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const headH = (h: string, n: 1 | 2) => `<h${n}>${esc(h)}<a class="headerlink" href="#">¶</a></h${n}>`

/** 2.1：MDL 的排法（窗口不滚，正文区滚；顶上 64 高的头固定着） */
function ndarray(changed: boolean, base: string): string {
  const body = sections(changed)
    .map((s) => headH(s.h, 2) + s.ps.map((p) => `<p>${esc(p)}</p>`).join(''))
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>2.1. 数据操作${SUFFIX}</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;font:15px/1.85 -apple-system,"PingFang SC",sans-serif;color:#1b1f23}
.mdl-layout__header{position:fixed;left:0;right:0;top:0;height:64px;background:#2196f3;color:#fff;display:flex;align-items:center;padding:0 20px;font-size:18px;z-index:2}
main.mdl-layout__content{position:absolute;top:64px;left:0;right:0;bottom:0;overflow-y:auto}
.page{max-width:760px;padding:18px 30px 260px}
h1{font-size:26px} h2{font-size:19px;margin:26px 0 8px} a.headerlink{color:#ccc;margin-left:6px;text-decoration:none}
</style></head><body>
<header class="mdl-layout__header">2.1. 数据操作</header>
<main class="mdl-layout__content"><div class="page">
${headH('2.1. 数据操作', 1)}
<p>${esc(changed ? '（改版后的说法）开头一段也换了写法。' : '为了完成各种数据操作，我们需要某种方法来存储和操作数据。通常要做两件事：一是获取数据，二是读进计算机以后做处理。')}</p>
${body}
<p><a id="next" href="${base}/chapter_preliminaries/pandas.html">下一页：2.2. 数据预处理</a></p>
</div></main></body></html>`
}

/** 普通整页滚动的一章 */
function plain(title: string, secs: { h: string; ps: string[] }[], next: string | null): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}${SUFFIX}</title>
<style>body{margin:0;font:15px/1.85 -apple-system,"PingFang SC",sans-serif;color:#1b1f23}.page{max-width:760px;padding:18px 30px 300px}h2{font-size:19px}a.headerlink{color:#ccc;margin-left:6px;text-decoration:none}</style>
</head><body><div class="page">${headH(title, 1)}${secs.map((s) => headH(s.h, 2) + s.ps.map((p) => `<p>${esc(p)}</p>`).join('')).join('')}${next ? `<p><a id="next" href="${next}">下一页</a></p>` : ''}</div></body></html>`
}

export async function fakeBook(): Promise<FakeBook> {
  const book: FakeBook = { base: '', changed: false, hits: [], close: async () => {} }
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!
    book.hits.push(path)
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (path === '/') return res.end(plain(BOOK, [{ h: '目录', ps: ['前言', '2.1. 数据操作', '2.2. 数据预处理'] }], `${book.base}/chapter_preface/index.html`))
    if (path === '/chapter_preface/index.html')
      return res.end(
        plain(
          '前言',
          [
            { h: '关于本书', ps: ['这本书想让深度学习平易近人，同时教给你概念、背景和代码。', ...FILL.map((s, i) => `前言 第${i + 1}段：${s}`)] },
            { h: '内容和结构', ps: ['全书大致分三部分：基础和预备知识、现代深度学习技术、可伸缩性和应用。', ...FILL.map((s, i) => `结构 第${i + 1}段：${s}`)] },
          ],
          `${book.base}/chapter_preliminaries/ndarray.html`,
        ),
      )
    if (path === '/chapter_preliminaries/ndarray.html') return res.end(ndarray(book.changed, book.base))
    if (path === '/chapter_preliminaries/pandas.html')
      return res.end(
        plain(
          '2.2. 数据预处理',
          [
            { h: '2.2.1. 读取数据集', ps: ['先创建一个人工数据集，存在 CSV 文件里。每行是一个数据样本。', ...FILL.map((s, i) => `读取 第${i + 1}段：${s}`)] },
            { h: TARGET2_HEAD, ps: ['“NaN” 项代表缺失值。处理缺失的数据，典型的方法有插值法和删除法。', TARGET2, ...FILL.map((s, i) => `缺失 第${i + 1}段：${s}`)] },
            { h: '2.2.3. 转换为张量格式', ps: ['现在所有条目都是数值类型，可以把它们转换成张量格式。', ...FILL.map((s, i) => `转换 第${i + 1}段：${s}`)] },
          ],
          null,
        ),
      )
    res.statusCode = 404
    res.end('<title>没有这一页</title>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  book.base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  book.close = () => new Promise<void>((r) => server.close(() => r()))
  return book
}
