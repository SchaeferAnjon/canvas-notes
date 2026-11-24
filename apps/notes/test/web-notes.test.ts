// 网页的笔记写进正在剪进去的那篇（task-6cxtc）：回到那一段的链接、一问一块 [!ai]、剪藏的来源一行、从那篇里认回来自这个网页的几条。
import { appendAsk, renderAsk, webSrc } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { clipMarkdown } from '../src/shared/layout'
import { findQuote } from '../src/shared/read-anchor'
import { fragmentText, fragmentUrl, parseFragment, samePage, sectionHead, sourceLabel, backLabel } from '../src/shared/web-link'
import { askLabel, webAskBlock, webEntries } from '../src/shared/web-notes'

const PAGE = 'http://127.0.0.1:5173/chapter_preliminaries/pandas.html'
const TITLE = '2.2. 数据预处理 — 动手学深度学习 2.0.0 documentation'
const P1 = '举一个例子，我们首先创建一个人工数据集，并存储在CSV（逗号分隔值）文件 ../data/house_tiny.csv中。以其他格式存储的数据也可以通过类似的方式进行处理。下面我们将数据集按行写入CSV文件中。'

describe('回到网页那一段的链接（#:~:text=那段开头）', () => {
  it('短的一句整句写，中文照写；长的第一句在词边上截到 40 字以内，不截在半个词上、末尾不留标点和空白', () => {
    expect(fragmentText('下面我们将数据集按行写入CSV文件中。')).toBe('下面我们将数据集按行写入CSV文件中。')
    const long = fragmentText(P1)
    expect(long).toBe('举一个例子，我们首先创建一个人工数据集，并存储在CSV（逗号分隔值）文件')
    expect(long.length).toBeLessThanOrEqual(40)
    // 英文：照词截
    const en = fragmentText('In linear algebra, a rotation matrix is a transformation matrix that is used to perform a rotation in Euclidean space.')
    expect(en.length).toBeLessThanOrEqual(40)
    expect(en).toMatch(/^In linear algebra, a rotation matrix is( a)?$/)
    // 空白并成一个
    expect(fragmentText('  典型的方法\n包括插值法和删除法 ')).toBe('典型的方法 包括插值法和删除法')
  })

  it('网址去掉原来的 #…，空格、逗号、横线、括号这些转成 %xx（md 链接不断开，Text Fragments 的分隔符不误认）；认得回来', () => {
    expect(fragmentUrl(`${PAGE}#section`, '下面我们将数据集按行写入CSV文件中。')).toBe(`${PAGE}#:~:text=下面我们将数据集按行写入CSV文件中。`)
    const u = fragmentUrl(PAGE, 'a-b, c (d) & e')
    expect(u).toBe(`${PAGE}#:~:text=a%2Db%2C%20c%20%28d%29%20%26%20e`)
    expect(u).not.toMatch(/[\s()]/)
    expect(parseFragment(u)).toEqual({ page: PAGE, text: 'a-b, c (d) & e' })
    expect(parseFragment(`${PAGE}#:~:text=前文-,下面我们将,写入CSV文件中。,-后文`)).toEqual({ page: PAGE, text: '下面我们将' })
    // 带公式的那段（$…$）：$ \ { } _ ^ 也转，文件里那一行不会被当成行内公式、反斜杠不被当成转义；认得回来
    const tex = String.raw`使用$[\mathbf{X}]_{i, j}$和$x^2$表示`
    const ut = fragmentUrl(PAGE, tex)
    expect(ut.split('#:~:text=')[1]).not.toMatch(/[$\\{}_^]/)
    expect(parseFragment(ut)).toEqual({ page: PAGE, text: tex })
    expect(parseFragment(`${PAGE}#top`)).toBeNull()
    expect(parseFragment('附件/a.png')).toBeNull()
    expect(samePage(`${PAGE}#:~:text=x`, `${PAGE}#later`)).toBe(true)
    expect(samePage(PAGE, PAGE.replace('pandas', 'ndarray'))).toBe(false)
  })

  it('链接上写的字：小标题（去掉 ¶ 和节号后面的点）；剪藏来源「小标题 · 书名」，没有小标题是「这一页 · 网站」', () => {
    expect(sectionHead('2.2.1. 读取数据集¶')).toBe('2.2.1 读取数据集')
    expect(sectionHead('2.2. 数据预处理')).toBe('2.2 数据预处理')
    expect(sectionHead('Rotation matrix')).toBe('Rotation matrix')
    expect(backLabel({ head: '2.2.1. 读取数据集¶', title: TITLE, url: PAGE })).toBe('2.2.1 读取数据集')
    expect(backLabel({ title: TITLE, url: PAGE })).toBe('2.2. 数据预处理')
    expect(sourceLabel({ head: '2.2.1. 读取数据集', title: TITLE, url: PAGE })).toBe('2.2.1 读取数据集 · 动手学深度学习')
    expect(sourceLabel({ title: 'Rotation matrix - Wikipedia', url: 'https://en.wikipedia.org/wiki/Rotation_matrix' })).toBe('Rotation matrix · Wikipedia')
    expect(sourceLabel({ title: '布什', url: 'http://127.0.0.1:1/bush' })).toBe('布什 · 127.0.0.1')
  })
})

describe('一问一块 [!ai]', () => {
  const back = { text: '2.2.1 读取数据集 ↩', url: fragmentUrl(PAGE, '下面我们将数据集按行写入CSV文件中。') }

  it('讲解一下：块头「讲解一下 · 哪家 · 模型 · 回到那段的链接」，引着那句，再是回答（空行照样留在块里）', () => {
    expect(askLabel('给我讲解一下')).toBe('讲解一下')
    expect(askLabel('先把这块翻译成中文，再讲一讲')).toBe('翻译 + 讲一讲')
    expect(askLabel('插值法和删除法\n各适合什么时候？')).toBe('你问：插值法和删除法 各适合什么时候？')
    expect(webAskBlock({ label: '讲解一下', by: 'Claude Code · Opus 5.5', links: [back], quotes: ['下面我们将数据集按行写入CSV文件中。'], answer: '这段在准备练习用的数据。\n\n后面用 pandas 读回来。' })).toBe(
      `> [!ai] 讲解一下 · Claude Code · Opus 5.5 · [2.2.1 读取数据集 ↩](${back.url})\n> > 下面我们将数据集按行写入CSV文件中。\n>\n> 这段在准备练习用的数据。\n>\n> 后面用 pandas 读回来。`,
    )
  })

  it('自己问、引了两段：每段前面 ①②；框一块问的放截图；链接上的字没有方括号', () => {
    const two = { text: '2.2.2 处理缺失值 ↩', url: fragmentUrl(PAGE, '典型的方法包括插值法和删除法') }
    expect(webAskBlock({ label: '你问：①和②有什么关系？', by: 'Claude Code', links: [back, two], quotes: ['下面我们将', '典型的方法包括插值法和删除法'], answer: '回答。' })).toBe(
      `> [!ai] 你问：①和②有什么关系？ · Claude Code · [2.2.1 读取数据集 ↩](${back.url}) · [2.2.2 处理缺失值 ↩](${two.url})\n> > ① 下面我们将\n> > ② 典型的方法包括插值法和删除法\n>\n> 回答。`,
    )
    expect(webAskBlock({ label: '讲解一下', by: 'Codex', links: [{ text: '[注] 小节', url: back.url }], quotes: [], image: '附件/网页/127.0.0.1 p1.png', answer: '图里是一段代码。' })).toBe(
      `> [!ai] 讲解一下 · Codex · [注  小节](${back.url})\n> ![我框的](附件/网页/127.0.0.1%20p1.png)\n>\n> 图里是一段代码。`,
    )
  })
})

describe('那篇里来自这一页的几条', () => {
  const ndarray = 'http://127.0.0.1:5173/chapter_preliminaries/ndarray.html'
  const clip = clipMarkdown(P1, '2.2.1 读取数据集 · 动手学深度学习', fragmentUrl(PAGE, P1))
  const explain = webAskBlock({ label: '讲解一下', by: 'Claude Code · Opus 5.5', links: [{ text: '2.2.1 读取数据集 ↩', url: fragmentUrl(PAGE, '下面我们将数据集按行写入CSV文件中。') }], quotes: ['下面我们将数据集按行写入CSV文件中。'], answer: '回答。' })
  const asked = webAskBlock({ label: '你问：插值法和删除法各适合什么时候？', by: 'Claude Code', links: [{ text: '2.2.2 处理缺失值 ↩', url: fragmentUrl(`${PAGE}#later`, '典型的方法包括插值法和删除法') }], quotes: ['典型的方法包括插值法和删除法'], answer: '回答。' })
  const other = webAskBlock({ label: '讲解一下', by: 'Claude Code', links: [{ text: '2.1.1 入门 ↩', url: fragmentUrl(ndarray, '张量表示一个由数值组成的数组') }], quotes: ['张量表示一个由数值组成的数组'], answer: '回答。' })
  const md = `# 学习笔记\n\n${clip}\n\n${explain}\n\n我的理解：先造一个小表。\n\n${asked}\n\n${other}\n\n> 普通的引文\n—— [别处](https://example.com/a)\n\n\`\`\`\n> [!ai] 讲解一下 · [代码里的不算 ↩](${fragmentUrl(PAGE, 'x')})\n\`\`\`\n`

  it('认出剪藏、讲解一下、你问三条（别的网页、普通引文、代码块里的不算）；标题、小标题、引着的原文、第几行', () => {
    const got = webEntries(md, PAGE)
    expect(got.map((e) => [e.kind, e.label, e.title, e.head])).toEqual([
      ['clip', '剪藏', '「举一个例子，我们首先创建一个人工数据集，并存储在CSV…」', '2.2.1 读取数据集'],
      ['ask', '讲解一下', '讲解一下「下面我们将数据集按行写入CSV文件中。」', '2.2.1 读取数据集'],
      ['ask', '你问', '插值法和删除法各适合什么时候？', '2.2.2 处理缺失值'],
    ])
    expect(got.map((e) => e.quote)).toEqual([P1, '下面我们将数据集按行写入CSV文件中。', '典型的方法包括插值法和删除法'])
    expect(got.map((e) => e.text)).toEqual([fragmentText(P1), '下面我们将数据集按行写入CSV文件中。', '典型的方法包括插值法和删除法'])
    const lines = md.split('\n')
    expect(lines[got[0]!.line]).toBe(`> ${P1}`)
    expect(lines[got[1]!.line]).toMatch(/^> \[!ai\] 讲解一下/)
    expect(new Set(got.map((e) => e.key)).size).toBe(3)
    // keyAt：key 那一行在第几行（讲解一下、你问是块头；剪藏是来源「—— […](…)」那一行，不是引文第一行），查 git 里那一行的时间用
    expect(got.map((e) => lines[e.keyAt] + '\n1')).toEqual(got.map((e) => e.key))
    expect(lines[got[0]!.keyAt]).toMatch(/^—— \[2\.2\.1 读取数据集 · 动手学深度学习\]/)
    expect(got[0]!.keyAt).toBeGreaterThan(got[0]!.line)
    expect(got[1]!.keyAt).toBe(got[1]!.line)
    expect(webEntries(md, ndarray).map((e) => e.title)).toEqual(['讲解一下「张量表示一个由数值组成的数组」'])
    expect(webEntries('# 空\n', PAGE)).toEqual([])
  })

  it('新写法的一问：认成「问的」，不算剪藏；旁支、别的网页不算；点一条回到那一段', () => {
    const NOTE = '学习/学习笔记.md'
    const key = `read:web:${PAGE}`
    const at = { heading: '2.2. 数据预处理' }
    const passage = '下面我们将数据集按行写入CSV文件中。'
    let ai = '# 学习笔记\n'
    ai = appendAsk(ai, NOTE, { key, msg: 2, th: 'web-1', q: '给我讲解一下', a: '回答。', quote: passage, src: webSrc(NOTE, '2.2.1 读取数据集 · 动手学深度学习 ↩', fragmentUrl(PAGE, passage)) }, at)
    ai = appendAsk(ai, NOTE, { key, msg: 4, th: 'web-1', q: '为什么要按行写？', a: '回答二。', side: { quote: '按行', parent: '给我讲解一下', of: 2 } }, at)
    ai = appendAsk(ai, NOTE, { key, msg: 6, th: 'web-2', q: '插值法和删除法各适合什么时候？', a: '回答三。', src: webSrc(NOTE, '2.2.2 处理缺失值 ↩', fragmentUrl(PAGE, '典型的方法包括插值法和删除法')) }, at)
    ai = appendAsk(ai, NOTE, { key, msg: 8, th: 'web-3', q: '给我讲解一下', a: '别处。', quote: '张量', src: webSrc(NOTE, '2.1.1 入门 ↩', fragmentUrl(ndarray, '张量')) }, at)
    const got = webEntries(ai, PAGE)
    expect(got.map((e) => [e.kind, e.label, e.title, e.head])).toEqual([
      ['ask', '讲解一下', `讲解一下「${passage}」`, '2.2.1 读取数据集'],
      ['ask', '你问', '插值法和删除法各适合什么时候？', '2.2.2 处理缺失值'],
    ])
    expect(got[0]!.url).toBe(fragmentUrl(PAGE, passage))
    expect(got[0]!.quote).toBe(passage)
    const lines = ai.split('\n')
    expect(lines[got[0]!.line]).toBe('### 给我讲解一下')
    expect(got.map((e) => lines[e.keyAt] + '\n1')).toEqual(got.map((e) => e.key))
    expect(webEntries(ai, ndarray).map((e) => e.label)).toEqual(['讲解一下'])
  })
})

describe('剪藏那篇里新写法的一问：来源在 ① 引文上', () => {
  it('引文的来源回到这一页的认成「你问」，quote 是引的那段；别的网页的不认', () => {
    const passage = '下面我们将数据集按行写入CSV文件中。'
    const md = '# 学习笔记\n\n我自己打的字。\n\n' + renderAsk({ key: 'read:web:x', msg: 3, th: 'web-1', q: '①这部分看不懂是说什么', a: '回答。', mats: [{ kind: 'quote', text: passage, src: '2.2.1 读取数据集 · 动手学深度学习 ↩', href: fragmentUrl(PAGE, passage) }] }, '学习/学习笔记.md')
    const got = webEntries(md, PAGE)
    expect(got.map((e) => [e.kind, e.label, e.title, e.head, e.quote])).toEqual([['ask', '你问', '①这部分看不懂是说什么', '2.2.1 读取数据集', passage]])
    expect(webEntries(md, 'https://zh.d2l.ai/chapter_preliminaries/ndarray.html')).toEqual([])
  })
})

describe('网页上找回选中的那几句', () => {
  const blocks = ['2.2.1. 读取数据集', P1, "import os\nos.makedirs(...)", '注意，“NaN”项代表缺失值。为了处理缺失的数据，典型的方法包括插值法和删除法，其中插值法用一个替代值弥补缺失值。']
  it('在段落中间也找得到（给第几块、从哪到哪）；一整段对不上时拿第一句；网页改了几个字照样找回；对不上是 null', () => {
    expect(findQuote(blocks, '下面我们将数据集按行写入CSV文件中。')).toEqual({ index: 1, start: P1.indexOf('下面'), end: P1.length, how: 'exact' })
    expect(findQuote(blocks, '典型的方法包括插值法和删除法')?.index).toBe(3)
    expect(findQuote(blocks, blocks[3] + '\n\n下一段的字，不在这一块里。')?.index).toBe(3)
    const fuzzy = findQuote(blocks, '下面我们把数据集按行写进CSV文件中。')
    expect(fuzzy).toMatchObject({ index: 1, how: 'fuzzy' })
    expect(findQuote(blocks, '完全不相干的一句话，哪里都没有。')).toBeNull()
  })
})
