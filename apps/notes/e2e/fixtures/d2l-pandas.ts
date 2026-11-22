/**
 * 本机一本假的「动手学深度学习」（照 zh.d2l.ai 的 2.2 数据预处理排：顶上一条蓝色的头、Sphinx 的标题「2.2. 数据预处理 — 动手学深度学习 2.0.0 documentation」、
 * 小标题后面带「¶」、一段代码）。选中小条、网页的笔记写进那篇（task-6cxtc）的测试和对照截图都用它，字照设计稿那几段。不上网。
 */
import { createServer, type Server } from 'node:http'

export interface D2l {
  base: string
  pandas: string
  ndarray: string
  close(): Promise<void>
}

const SUFFIX = ' — 动手学深度学习 2.0.0 documentation'

/** 2.2.1 读取数据集下面那一段（剪藏、讲解一下的那段） */
export const P1 = '举一个例子，我们首先创建一个人工数据集，并存储在CSV（逗号分隔值）文件 ../data/house_tiny.csv中。以其他格式存储的数据也可以通过类似的方式进行处理。下面我们将数据集按行写入CSV文件中。'
/** P1 的最后一句（讲解一下选它） */
export const P1_LAST = '下面我们将数据集按行写入CSV文件中。'
/** 2.2.2 处理缺失值下面那一段（引用选其中一句） */
export const P2 = '注意，“NaN”项代表缺失值。为了处理缺失的数据，典型的方法包括插值法和删除法，其中插值法用一个替代值弥补缺失值，而删除法则直接忽略缺失值。在这里，我们将考虑插值法。'
export const P2_PART = '典型的方法包括插值法和删除法'

const CODE = `import os

os.makedirs(os.path.join('..', 'data'), exist_ok=True)
data_file = os.path.join('..', 'data', 'house_tiny.csv')
with open(data_file, 'w') as f:
    f.write('NumRooms,Alley,Price\\n')  # 列名
    f.write('NA,Pave,127500\\n')  # 每行表示一个数据样本`

const FILL = [
  '要从创建的CSV文件中加载原始数据集，我们导入pandas包并调用read_csv函数。该数据集有四行三列。其中每行描述了房间数量（“NumRooms”）、巷子类型（“Alley”）和房屋价格（“Price”）。',
  '通过位置索引iloc，我们将data分成inputs和outputs，其中前者为data的前两列，而后者为data的最后一列。对于inputs中缺少的数值，我们用同一列的均值替换“NaN”项。',
  '对于inputs中的类别值或离散值，我们将“NaN”视为一个类别。由于“巷子类型”（“Alley”）列只接受两种类型的类别值“Pave”和“NaN”，pandas可以自动将此列转换为两列。',
  '现在inputs和outputs中的所有条目都是数值类型，它们可以转换为张量格式。当数据采用张量格式后，可以通过在2.1节中引入的那些张量函数来进一步操作。',
  '这一段用来把网页撑长：真书里这里是一段讲解，读的人会边看边在旁边的笔记里记下要点。',
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const h = (t: string, n: 1 | 2) => `<h${n}>${esc(t)}<a class="headerlink" href="#">¶</a></h${n}>`

const STYLE = `<style>
body{margin:0;font:17px/2.05 -apple-system,"PingFang SC",sans-serif;color:#1b1f23;background:#fff}
.mdl-layout__header{position:sticky;top:0;height:64px;background:#2196f3;color:#fff;display:flex;align-items:center;gap:22px;padding:0 24px;font-size:21px;z-index:2}
.mdl-layout__header i{font-style:normal;font-size:24px}
.page{max-width:760px;padding:18px 34px 420px 46px}
h1{font-size:30px;color:#2196f3;margin:18px 0 10px} h2{font-size:30px;color:#2196f3;margin:34px 0 10px}
a.headerlink{color:#ccc;margin-left:6px;text-decoration:none;font-size:16px}
pre{background:#f7f7f7;padding:18px 24px;font:14px/1.75 Menlo,monospace;box-shadow:0 1px 3px rgba(0,0,0,.12);white-space:pre}
</style>`

function pandas(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>2.2. 数据预处理${SUFFIX}</title>${STYLE}</head><body>
<header class="mdl-layout__header"><i>≡</i>2.2. 数据预处理</header>
<div class="page">
${h('2.2. 数据预处理', 1)}
<p>为了能用深度学习来解决现实世界的问题，我们经常从预处理原始数据开始，而不是从那些准备好的张量格式数据开始。在Python中常用的数据分析工具中，我们通常使用pandas软件包。</p>
${h('2.2.1. 读取数据集', 2)}
<p id="p1">${esc(P1)}</p>
<pre>${esc(CODE)}</pre>
<p>${esc(FILL[0]!)}</p>
${h('2.2.2. 处理缺失值', 2)}
<p id="p2">${esc(P2)}</p>
<p>${esc(FILL[1]!)}</p>
<p>${esc(FILL[2]!)}</p>
${h('2.2.3. 转换为张量格式', 2)}
<p id="p3">${esc(FILL[3]!)}</p>
<p>${esc(FILL[4]!)}</p>
</div></body></html>`
}

function ndarray(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>2.1. 数据操作${SUFFIX}</title>${STYLE}</head><body>
<header class="mdl-layout__header"><i>≡</i>2.1. 数据操作</header>
<div class="page">
${h('2.1. 数据操作', 1)}
${h('2.1.1. 入门', 2)}
<p id="n1">张量表示一个由数值组成的数组，这个数组可能有多个维度。只有一个轴的张量叫向量，有两个轴的叫矩阵。</p>
<p>${esc(FILL[4]!)}</p>
</div></body></html>`
}

export async function d2l(): Promise<D2l> {
  const out: D2l = { base: '', pandas: '', ndarray: '', close: async () => {} }
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (path === '/chapter_preliminaries/pandas.html') return res.end(pandas())
    if (path === '/chapter_preliminaries/ndarray.html') return res.end(ndarray())
    res.statusCode = 404
    res.end('<title>没有这一页</title>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  out.base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  out.pandas = `${out.base}/chapter_preliminaries/pandas.html`
  out.ndarray = `${out.base}/chapter_preliminaries/ndarray.html`
  out.close = () => new Promise<void>((r) => server.close(() => r()))
  return out
}
