/**
 * 本机起的带公式、代码块的假网页（不连外网）：照 zh.d2l.ai「2.3 线性代数」排好以后的样子手写 DOM——
 * MathJax 3（mjx-container + 读屏用的 MathML，里面有 TeX 注解）、MathJax 2（显示的 span 后面跟 <script type="math/tex">）、
 * KaTeX（.katex 里 .katex-mathml 的注解）、d2l 的代码页签（PYTORCH 显示、MXNET 藏着）、Sphinx 的式号（div.math 里的 span.eqno「(2.3.7)¶」）。
 * 网址带 ?dark 是深色网页（看小条在深色底上分不分得出边）
 */
import { createServer } from 'node:http'

const hideMml = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)'
const mj3 = (tex: string, shown: string, display = false) =>
  `<mjx-container class="MathJax" jax="CHTML"${display ? ' display="true" style="display:block;text-align:center;margin:1em 0"' : ''}><mjx-math aria-hidden="true">${shown}</mjx-math><mjx-assistive-mml style="${hideMml}"><math${display ? ' display="block"' : ''}><semantics><mi>${shown}</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></mjx-assistive-mml></mjx-container>`
const katex = (tex: string, shown: string) =>
  `<span class="katex"><span class="katex-mathml" style="${hideMml}"><math><semantics><mrow><mi>${shown}</mi></mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${shown}</span></span>`
const mj2 = (id: number, tex: string, shown: string, display = false) =>
  display
    ? `<div class="MathJax_Display"><span class="MathJax" id="MathJax-Element-${id}-Frame">${shown}</span></div><script type="math/tex; mode=display" id="MathJax-Element-${id}">${tex}</script>`
    : `<span class="MathJax" id="MathJax-Element-${id}-Frame">${shown}</span><script type="math/tex" id="MathJax-Element-${id}">${tex}</script>`

export const MATRIX = String.raw`\mathbf{A}=\begin{bmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{bmatrix}`
/** 剪下来的块级公式：Sphinx 的式号写成 \tag */
export const TAGGED = String.raw`${MATRIX} \tag{2.3.7}`

const page = (dark: boolean) => `<!doctype html><html><head><meta charset="utf-8"><title>2.3. 线性代数 — 动手学深度学习 2.0.0 documentation</title>
<style>body{margin:0;font:17px/2 -apple-system,"PingFang SC",sans-serif}.page{max-width:760px;padding:18px 34px 300px 46px}pre{background:#f7f7f7;padding:12px}
.math{position:relative}.eqno{float:right;line-height:2}.headerlink{visibility:hidden;margin-left:4px}
${dark ? 'body{background:#1e1f22;color:#dcdde1}pre{background:#2b2d31;color:#dcdde1}' : ''}</style></head>
<body><div class="page">
<h2 id="h-mat">2.3.3. 矩阵</h2>
<p id="m1">我们可以通过行索引（${mj3('i', 'i')}）和列索引（${mj3('j', 'j')}）来访问矩阵中的标量元素。</p>
<p id="m2">通过指定两个分量${katex('m', 'm')}和${katex('n', 'n')}来创建一个形状为${katex(String.raw`m\times n`, 'm×n')}的矩阵。</p>
<div class="math notranslate nohighlight" id="equation-mat"><span class="eqno">(2.3.7)<a class="headerlink" href="#equation-mat">¶</a></span>${mj3(MATRIX, 'A=[a11 a12; a21 a22]', true)}</div>
<p id="m3">当调用函数来实例化张量时，我们可以指定形状。</p>
<div class="mdl-tabs"><div class="mdl-tabs__panel is-active" id="tab-pt"><div class="highlight-python notranslate"><div class="highlight"><pre>import torch
x = torch.arange(12)</pre></div></div></div><div class="mdl-tabs__panel" id="tab-mx" style="display:none"><div class="highlight-python notranslate"><div class="highlight"><pre>from mxnet import np</pre></div></div></div></div>
<p id="m4">上面的代码创建了一个行向量。</p>
<h2 id="h-mj2">2.3.4. 张量</h2>
<p id="t1">向量${mj2(1, 'x_i', 'xi')}的长度称为维数，求和写成</p>
${mj2(2, String.raw`\sum_{i=1}^n x_i`, 'Σ xi', true)}
<p id="t2">这就是向量的和。</p>
</div></body></html>`

export interface MathSite {
  base: string
  url: string
  close(): Promise<void>
}

export async function mathSite(): Promise<MathSite> {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(page(/[?&]dark\b/.test(req.url ?? '')))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { base, url: `${base}/chapter_preliminaries/linear-algebra.html`, close: () => new Promise<void>((r) => server.close(() => r())) }
}
