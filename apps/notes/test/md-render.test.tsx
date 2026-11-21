import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Markdown } from '../src/renderer/md-render'

it('AI 回答里的 md 显示成列表、加粗、标题和代码，不留 ** 和 - 记号', () => {
  const html = renderToStaticMarkup(
    <Markdown text={'我按时间顺序分了四列：\n- **地理与概况**：吉萨金字塔\n- **前王朝时期**：标题卡\n\n## 小结\n1. 第一\n2. 第二\n\n```\ncode\n```\n> 引文 `x`'} />,
  )
  expect(html).not.toContain('**')
  expect(html).toContain('<ul class="md-list"><li><b>地理与概况</b>：吉萨金字塔</li>')
  expect(html).toContain('<ol class="md-list">')
  expect(html).toContain('class="md-h md-h2">小结</div>')
  expect(html).toContain('<pre class="md-code"><code>code</code></pre>')
  expect(html).toContain('<blockquote class="md-quote">引文 <code>x</code></blockquote>')
})

it('AI 回答里的表格排成 <table>，单元格里照常认加粗；分隔行没到之前按段落显示（CN-29）', () => {
  const md = '翻译如下：\n\n| 左：原文 | 右：译文 |\n|---|:---:|\n| **physics-inspired** | 受物理启发 |\n| data-driven | 基于数据 |\n\n后面一段'
  const html = renderToStaticMarkup(<Markdown text={md} />)
  expect(html).toContain('<div class="md-table"><table>')
  expect(html).toContain('<th>左：原文</th>')
  expect(html).toContain('<td><b>physics-inspired</b></td>')
  expect(html).toContain('<td style="text-align:center">受物理启发</td>')
  expect(html).not.toContain('|---')
  expect(html).toContain('<p class="md-p">后面一段</p>')
  // 边生成边显示：只到表头，分隔行还没来 → 还是一段字，不出表
  const half = renderToStaticMarkup(<Markdown text={'| 左 | 右 |'} />)
  expect(half).not.toContain('<table>')
  expect(half).toContain('| 左 | 右 |')
})

it('白板卡片和文档同一套行内写法：==高亮== 画成荧光底、~~删除线~~、「我的评价」小标签，不露记号（第 1 轮美学）', () => {
  const html = renderToStaticMarkup(<Markdown text={'我的评价：这句话被反复印证，==出门永远带防风外套==，~~两驱~~。'} />)
  expect(html).not.toContain('==')
  expect(html).not.toContain('~~')
  expect(html).toContain('<mark class="md-hl">出门永远带防风外套</mark>')
  expect(html).toContain('<s>两驱</s>')
  // 小标签和文档里一样（书摘的新样子，review.ts）：文件里的冒号不画；没挂在引文下面，不画弯钩
  expect(html).toContain('<div class="md-attached" data-kind="me"><span class="md-review-tag">我的评价</span>这句话')
})

it('引文下面挂着的「微信读书的想法：」「我的评价」：标签小块，挂在引文下面的画弯钩（hooked），一段接一段；「微信读书的想法」不带冒号、中间隔了别的段落都不算', () => {
  const html = renderToStaticMarkup(
    <Markdown text={'> 接到叔叔谋反的消息。\n\n微信读书的想法：御驾亲征这一下。\n\n**我的评价**：先动手的人说了算。\n\n别的一段。\n\n我的评价：没挂在引文下面。\n\n微信读书的想法 不带冒号'} />,
  )
  expect(html).toContain('<blockquote class="md-quote">接到叔叔谋反的消息。</blockquote>')
  expect(html).toContain('<div class="md-attached hooked" data-kind="wr"><span class="md-review-tag wr">微信读书的想法</span>御驾亲征这一下。</div>')
  expect(html).toContain('<div class="md-attached hooked" data-kind="me"><span class="md-review-tag">我的评价</span>先动手的人说了算。</div>')
  expect(html).toContain('<div class="md-attached" data-kind="me"><span class="md-review-tag">我的评价</span>没挂在引文下面。</div>')
  expect(html).toContain('<p class="md-p">微信读书的想法 不带冒号</p>')
  // 开头就是标签段：前面没有引文，不画弯钩
  expect(renderToStaticMarkup(<Markdown text={'我的评价：开头一段'} />)).toContain('<div class="md-attached" data-kind="me">')
})

it('CN-89 AI 回答里的公式用 KaTeX 排：行内 $…$、单独成行的 $$…$$（一行写完或上下两行 $$ 夹着）；不露 $ 记号', () => {
  const md = '水位 $V(t)$ 按 $\\tau \\frac{dV}{dt} = -V$ 漏掉。\n\n$$V(t) = V_0 e^{-t/\\tau}$$\n\n多行的：\n\n$$\n\\sum_{i=1}^{n} w_i x_i\n$$\n\n- 列表里 **加粗 $x^2$** 也排\n\n| 量 | 公式 |\n|---|---|\n| 门槛 | $V_{th}$ |'
  const html = renderToStaticMarkup(<Markdown text={md} math />)
  // 行内两个、单独成行两个（一行写完的、上下两行夹着的），列表里加粗里一个，表格里一个
  expect(html.match(/class="mi"/g)?.length).toBe(4)
  expect(html.match(/class="mblock"/g)?.length).toBe(2)
  expect(html.match(/class="katex-display"/g)?.length).toBe(2)
  expect(html).toContain('<b>加粗 <span class="mi">')
  expect(html).not.toMatch(/\$[^<]*\$/)
  expect(html).toContain('<annotation encoding="application/x-tex">V(t) = V_0 e^{-t/\\tau}</annotation>')
  expect(html).toContain('<annotation encoding="application/x-tex">\\sum_{i=1}^{n} w_i x_i</annotation>')
})

it('CN-89 公式紧挨着汉字（AI 没打空格）时两边留 1/8 字宽（DESIGN.md「字体」的中西文间距；KaTeX 是 inline-block，autospace 加不上）；打了空格、挨着英文或标点的不加', () => {
  const html = renderToStaticMarkup(<Markdown text={'水位一到门槛$V_{th}$就发，门槛 $V_{th}$ 照旧，a$x$b，（$y$）'} math />)
  const spans = [...html.matchAll(/<span class="(mi[^"]*)"/g)].map((m) => m[1])
  expect(spans).toEqual(['mi gl gr', 'mi', 'mi', 'mi'])
})

it('CN-89 公式：钱数「$5 和 $10」、代码里的 $HOME、没配上的半截 $ 都照原样；边生成边显示只到 $$ 开头时先按字显示；写错的原文标红色波浪', () => {
  const html = renderToStaticMarkup(<Markdown text={'一杯 $5，两杯 $10，`echo $HOME` 照旧。还没写完的 $x'} math />)
  expect(html).not.toContain('class="mi"')
  expect(html).toContain('一杯 $5，两杯 $10，<code>echo $HOME</code> 照旧。还没写完的 $x')
  const half = renderToStaticMarkup(<Markdown text={'公式：\n\n$$\nV = IR'} math />)
  expect(half).not.toContain('mblock')
  expect(half).toContain('V = IR')
  // 坏的 LaTeX 不抛错：原文照写，标红色波浪（math-err），悬停说哪里错
  const bad = renderToStaticMarkup(<Markdown text={'坏的 $\\frac{a$ 公式'} />)
  expect(bad).toContain('坏的 <span class="math-err" title="公式写错了：')
  expect(bad).toContain('>$\\frac{a$</span> 公式')
})

it('task-o48fa 白板卡片、文档切成的白板这些自己写的字也排公式（同一个认法，钱数照旧不排）；\\$ 显示成 $', () => {
  const card = renderToStaticMarkup(<Markdown text={'卡片里写 $x$，花了 $5 和 $6，价格 \\$7'} />)
  expect(card.match(/class="mi"/g)?.length).toBe(1)
  expect(card).toContain('，花了 $5 和 $6，价格 $7')
})

it('task-o48fa 截图那几种：$x_i$, $\\mathbf{x}_i$ 两个公式（中间的 _ 不当斜体）；\\(…\\)、\\[…\\]；单独成行的写错了也不崩', () => {
  const md = '- $x_i$, $\\mathbf{x}_i$：向量 $\\mathbf{x}$ 第 $i$ 个元素\n- $\\mathcal{A}\\setminus\\mathcal{B}$：相减\n\n设 \\(a^2\\) 是\n\n\\[\nb^2\n\\]\n\n$$\n\\frac{1}{\n$$'
  const html = renderToStaticMarkup(<Markdown text={md} />)
  expect(html.match(/class="mi"/g)?.length).toBe(6)
  expect(html).not.toContain('<i>')
  expect(html.match(/class="mblock"/g)?.length).toBe(2)
  expect(html).toContain('<annotation encoding="application/x-tex">b^2</annotation>')
  expect(html).toContain('class="math-err"')
  // 只有写错的那一个露原文
  expect(html.replace(/<span class="math-err"[^>]*>[^<]*<\/span>/g, '')).not.toMatch(/\$[^<]*\$/)
})

it('AI 讲解的提示块：卡头「AI 讲解」一截，后面的引擎 · 模型 · 看了什么单独一截（淡一号、一行省略）', () => {
  const html = renderToStaticMarkup(<Markdown text={'> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 road.is 这一页\n> 冬天默认给钉胎。'} />)
  expect(html).toContain('<span class="md-callout-name">AI 讲解</span><span class="md-callout-meta"> · Claude Code · Opus 5.5 · 看了 road.is 这一页</span>')
})
