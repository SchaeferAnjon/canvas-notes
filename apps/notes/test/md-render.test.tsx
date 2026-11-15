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
