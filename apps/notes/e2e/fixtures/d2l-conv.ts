/**
 * 本机起的假网页（不连外网）：照 zh.d2l.ai「6.1 从全连接层到卷积」MathJax 3.2 排好以后的样子精简手写——
 * 公式是 span.math 里的 mjx-container：画出来的字在 mjx-c 的 ::before 里（选不出字，浏览器选区的字里只剩换行），
 * 读屏用的 mjx-assistive-mml 藏着、不能选，里面的 MathML 没有 TeX 注解（真网页就是这样，原文只在主世界的
 * MathJax.startup.document.math 里）；块级公式在 div.math 里，旁边是 Sphinx 的式号 span.eqno「(6.1.1)¶」；末尾一个 Sphinx 代码块。
 */
import { createServer } from 'node:http'

interface F {
  tex: string
  /** 画出来的样子（::before 里，选不出来） */
  shown: string
  /** 藏着的 MathML 里的字 */
  mml: string
  display?: boolean
}

export const X = String.raw`\mathbf{X}`
export const H = String.raw`\mathbf{H}`
export const XIJ = String.raw`[\mathbf{X}]_{i, j}`
export const HIJ = String.raw`[\mathbf{H}]_{i, j}`
export const EQ = String.raw`\begin{split}\begin{aligned} \left[\mathbf{H}\right]_{i, j} &= [\mathbf{U}]_{i, j} + \sum_k \sum_l[\mathsf{W}]_{i, j, k, l}  [\mathbf{X}]_{k, l}\\ &=  [\mathbf{U}]_{i, j} +
\sum_a \sum_b [\mathsf{V}]_{i, j, a, b}  [\mathbf{X}]_{i+a, j+b}.\end{aligned}\end{split}`

const all: F[] = []
const m = (f: F) => {
  all.push(f)
  const attr = f.display ? ' display="true" style="display:block;text-align:center;margin:1em 0;position:relative"' : ' style="position:relative"'
  const c = f.shown.split('').map((ch) => `<mjx-c data-c="${ch}"></mjx-c>`).join('')
  const mml = `<math xmlns="http://www.w3.org/1998/Math/MathML"${f.display ? ' display="block"' : ''}><mrow><mi>${f.mml}</mi></mrow></math>`
  const box = `<mjx-container class="MathJax" jax="CHTML" tabindex="0"${attr}><mjx-math class="MJX-TEX" aria-hidden="true"${f.display ? ' display="true"' : ''}><mjx-mi>${c}</mjx-mi></mjx-math><mjx-assistive-mml unselectable="on" display="${f.display ? 'block' : 'inline'}">${mml}</mjx-assistive-mml></mjx-container>`
  return f.display ? box : `<span class="math notranslate nohighlight">${box}</span>`
}
const x = () => m({ tex: X, shown: 'X', mml: 'X' })
const h = () => m({ tex: H, shown: 'H', mml: 'H' })

function body(): string {
  all.length = 0
  return `<h2 id="h612">6.1.2. 多层感知机的限制<a class="headerlink" href="#h612">¶</a></h2>
<p id="p1">首先，多层感知机的输入是二维图像${x()}，其隐藏表示${h()}在数学上是一个矩阵，在代码中表示为二维张量。
其中${x()}和${h()}具有相同的形状。
为了方便理解，我们可以认为，无论是输入还是隐藏表示都拥有空间结构。</p>
<p id="p2">使用${m({ tex: XIJ, shown: '[X]i,j', mml: '[X]i,j' })}和${m({ tex: HIJ, shown: '[H]i,j', mml: '[H]i,j' })}分别表示输入图像和隐藏表示中位置（${m({ tex: 'i', shown: 'i', mml: 'i' })},${m({ tex: 'j', shown: 'j', mml: 'j' })}）处的像素。
为了使每个隐藏神经元都能接收到每个输入像素的信息，我们将参数从权重矩阵（如同我们先前在多层感知机中所做的那样）替换为四阶权重张量${m({ tex: String.raw`\mathsf{W}`, shown: 'W', mml: 'W' })}。假设${m({ tex: String.raw`\mathbf{U}`, shown: 'U', mml: 'U' })}包含偏置参数，我们可以将全连接层形式化地表示为</p>
<div class="math notranslate nohighlight" id="equation-why-conv-0">
<span class="eqno">(6.1.1)<a class="headerlink" href="#equation-why-conv-0">¶</a></span>${m({ tex: EQ, shown: '[H]i,j = [U]i,j + ΣkΣl[W]i,j,k,l[X]k,l', mml: '[H]i,j=[U]i,j+∑k∑l[W]i,j,k,l[X]k,l', display: true })}</div>
<p id="p3">其中，从${m({ tex: String.raw`\mathsf{W}`, shown: 'W', mml: 'W' })}到${m({ tex: String.raw`\mathsf{V}`, shown: 'V', mml: 'V' })}的转换只是形式上的转换，因为在这两个四阶张量的元素之间存在一一对应的关系。我们只需重新索引下标。</p>
<p id="p4">这一段没有公式，旁边的段落剪过以后它不该被标。</p>
<div class="highlight-python notranslate"><div class="highlight"><pre id="code1"><span></span><span class="kn">import</span> <span class="nn">torch</span>
<span class="kn">from</span> <span class="nn">torch</span> <span class="kn">import</span> <span class="n">nn</span>
</pre></div></div>`
}

const page = () => {
  const b = body()
  // 主世界里的 MathJax 3（软件的 tagMathJax 从这里读原文）：math 按网页里的先后，typesetRoot 是那个 mjx-container
  const list = JSON.stringify(all.map((f) => ({ tex: f.tex, display: !!f.display })))
  return `<!doctype html><html><head><meta charset="utf-8"><title>6.1. 从全连接层到卷积 — 动手学深度学习 2.0.0 documentation</title>
<style>body{margin:0;font:16px/2 -apple-system,"PingFang SC",sans-serif;color:#222}.page{padding:18px 28px 600px 40px}
h2{color:#2196f3;font-weight:400}.headerlink{visibility:hidden;margin-left:4px}.math{position:relative}.eqno{float:right;line-height:2}
mjx-container{display:inline-block;font-family:"Times New Roman",serif;font-size:118%}mjx-container mjx-c::before{content:attr(data-c)}
mjx-math{display:inline-block;white-space:nowrap}
mjx-assistive-mml{position:absolute!important;top:0;left:0;clip:rect(1px,1px,1px,1px);padding:1px 0 0 0!important;border:0!important;display:block!important;width:auto!important;overflow:hidden!important;-webkit-user-select:none;user-select:none}</style></head>
<body><div class="page">${b}</div>
<script>window.MathJax={version:'3.2.2',startup:{document:{math:${list}.map((f,i)=>({math:f.tex,display:f.display,typesetRoot:document.querySelectorAll('mjx-container')[i]}))}}}</script>
</body></html>`
}

export interface D2lSite {
  base: string
  url: string
  close(): Promise<void>
}

export async function d2lConv(): Promise<D2lSite> {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(page())
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { base, url: `${base}/chapter_convolutional-neural-networks/why-conv.html`, close: () => new Promise<void>((r) => server.close(() => r())) }
}
