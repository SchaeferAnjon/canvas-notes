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
  // 冒号并进小标签：「我的评价：」一体，不画成「我的评价 ：」（第 3 轮美学）
  expect(html).toContain('<span class="md-review-tag">我的评价：</span>这句话')
})

it('AI 讲解的提示块：卡头「AI 讲解」一截，后面的引擎 · 模型 · 看了什么单独一截（淡一号、一行省略）', () => {
  const html = renderToStaticMarkup(<Markdown text={'> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 road.is 这一页\n> 冬天默认给钉胎。'} />)
  expect(html).toContain('<span class="md-callout-name">AI 讲解</span><span class="md-callout-meta"> · Claude Code · Opus 5.5 · 看了 road.is 这一页</span>')
})
