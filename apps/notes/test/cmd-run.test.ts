// AI 命令真跑时：交给 AI 的话、读回答、落到文件里只改它说会改的（task-9womr）
import { describe, expect, it } from 'vitest'
import {
  applyLinks,
  applyOcr,
  applyPlan,
  applyThemes,
  applyTodos,
  appendSection,
  boardCards,
  bthemePrompt,
  digestOf,
  docImages,
  docOut,
  fakeCmdAnswer,
  insertTop,
  isoWeek,
  keepFrontmatter,
  linksPrompt,
  ocrPrompt,
  onlyAdded,
  onlyLinksAdded,
  ownPrompt,
  pagesPrompt,
  pagesSection,
  parseColumns,
  parseLinks,
  parseOcr,
  parsePages,
  parsePlan,
  parseQuiz,
  parseReview,
  parseThemes,
  parseTodos,
  parseVkey,
  parseVtext,
  planPrompt,
  quizPrompt,
  quizSection,
  reviewPrompt,
  sameCards,
  sameGroups,
  selectedCard,
  splitBoard,
  splitPrompt,
  todoPrompt,
  placeOnCues,
  quoteAt,
  snapToCue,
  transcript,
  vkeyNote,
  vkeyPrompt,
  vtextPrompt,
  weekNote,
  weekPrompt,
} from '../src/shared/cmd-run'
import { splitDoc, unitKeys } from '@cn/format'

describe('自己存的命令', () => {
  it('提示里有规矩和整篇；改这一篇要整篇放在 markdown 代码块里', () => {
    const p = ownPrompt({ name: '通顺笔记', instruction: '1. 分节\n2. 问答保留原样', title: '第2讲', path: '课程/第2讲.md', text: '# 第2讲\n\n正文', write: 'inplace', images: 2, source: 'doc' })
    expect(p.split('\n').slice(0, 2)).toEqual(['命令：自己的命令', '名字：/通顺笔记'])
    expect(p).toContain('1. 分节\n2. 问答保留原样')
    expect(p).toContain('```markdown')
    expect(p).toContain('2 张图')
  })
  it('读回整篇：代码块里最长那段；没代码块但像一篇笔记的整段；frontmatter 丢了补回去', () => {
    expect(docOut('好的\n```markdown\n# A\n\n正文\n```\n')).toBe('# A\n\n正文\n')
    expect(docOut('# B\n\n正文')).toBe('# B\n\n正文\n')
    expect(docOut('我改不了')).toBeNull()
    expect(keepFrontmatter('---\n类型: 笔记\n---\n# A\n', '# A 改过\n')).toBe('---\n类型: 笔记\n---\n# A 改过\n')
    expect(keepFrontmatter('# A\n', '# A 改过\n')).toBe('# A 改过\n')
  })
  it('假回答：去掉出处行，标题下写照几条改过', () => {
    const out = docOut(fakeCmdAnswer(ownPrompt({ name: 'x', instruction: '1. a\n2. b', title: 't', path: 't.md', text: '# t\n\n—— 出处\n\n正文', write: 'inplace', images: 0, source: 'doc' }))!)!
    expect(out).toBe('# t\n\n（测试：照 2 条规矩改过）\n\n正文\n')
  })
})

describe('截图转成文字：只在图下面加字', () => {
  const doc = '# 笔记\n\n![](../附件/截图 1.png)\n\n正文一段。\n> ![](../附件/截图%202.png)\n![[图三.png|300]]\n![](https://x.com/a.png)\n![](../附件/图.svg)\n```\n![](../附件/代码里.png)\n```\n'
  const imgs = docImages(doc, '课程/笔记.md', (n) => (n === '图三.png' ? '附件/图三.png' : null))
  it('认出库里的位图：相对路径、编码过的、只写名字的；网上的、SVG、代码块里的不算', () => {
    expect(imgs.map((i) => [i.line, i.path])).toEqual([
      [2, '附件/截图 1.png'],
      [5, '附件/截图 2.png'],
      [6, '附件/图三.png'],
    ])
    expect(ocrPrompt({ path: '课程/笔记.md', title: '笔记', doc, images: imgs })).toContain('图2：第 6 行 ![](../附件/截图%202.png)')
  })
  it('字插在图下面（引用里的照引用排），原文一行不少', () => {
    const items = parseOcr(fakeCmdAnswer(ocrPrompt({ path: 'p', title: 't', doc, images: imgs }))!, imgs.length)
    expect(items.map((i) => i.n)).toEqual([1, 2, 3])
    const out = applyOcr(doc, imgs, items)
    expect(onlyAdded(doc, out)).toBe(true)
    expect(out).toContain('![](../附件/截图 1.png)\n\n| 写法 | 意思 |\n| --- | --- |\n| x | 标量 |\n| **x** | 向量 |\n\n正文一段。')
    expect(out).toContain('> ![](../附件/截图%202.png)\n>\n> 图2里的字：测试文字2\n>\n![[图三.png|300]]\n\n图3里的字：测试文字3\n\n![](https://x.com/a.png)')
  })
  it('回答里的编号对不上、空字的不要', () => {
    expect(parseOcr('[{"n":1,"text":"a"},{"n":9,"text":"b"},{"n":2,"text":""}]', 2)).toEqual([{ n: 1, text: 'a' }])
  })
})

describe('补双链：只加链接', () => {
  const doc = '---\n标题: 张量\n---\n# 线代\n\n张量就是多维数组，`张量` 在代码里不算。[[矩阵]]已经链过。\n\n## 张量\n\n再说一次张量和向量。\n'
  it('第一处能加的地方包起来；标题、代码、属性、已有的链接不碰；库里没有的、自己不加', () => {
    const r = applyLinks(doc, [{ text: '张量', note: '张量' }, { text: '向量', note: '向量（线代）' }, { text: '矩阵', note: '矩阵' }, { text: '线代', note: '线代' }, { text: '数组', note: '没有这篇' }], new Set(['张量', '向量（线代）', '矩阵', '线代']), '线代')
    expect(r.added).toEqual(['张量', '向量（线代）'])
    expect(r.text).toContain('# 线代\n\n[[张量]]就是多维数组，`张量` 在代码里不算。')
    expect(r.text).toContain('再说一次张量和[[向量（线代）|向量]]。')
    expect(r.text.startsWith('---\n标题: 张量\n---\n')).toBe(true)
    expect(onlyLinksAdded(doc, r.text)).toBe(true)
    expect(onlyLinksAdded(doc, r.text + '多了字')).toBe(false)
  })
  it('提示列出库里的名字；假回答挑这篇里有的', () => {
    const p = linksPrompt({ path: 'a.md', title: 'a', doc: '讲张量和矩阵', titles: ['张量', '矩阵', '冰岛'] })
    expect(parseLinks(fakeCmdAnswer(p)!)).toEqual([
      { text: '张量', note: '张量' },
      { text: '矩阵', note: '矩阵' },
    ])
  })
})

describe('出几道自测题：只在末尾加一节', () => {
  it('题目露着，答案收在折叠块里；原文是开头那一截', () => {
    const doc = '# 第2讲\n\n## 张量\n\n正文\n'
    const qs = parseQuiz(fakeCmdAnswer(quizPrompt({ path: 'p', title: 't', text: doc }))!)
    expect(qs).toHaveLength(5)
    const out = appendSection(doc, quizSection(qs))
    expect(out.startsWith(doc.trimEnd() + '\n\n## 自测题\n\n1. 测试题1：「张量」讲的是什么？\n\n<details><summary>答案</summary>\n\n测试答案1')).toBe(true)
    expect(out.match(/<details>/g)).toHaveLength(5)
  })
})

describe('插在最上面：属性和一级标题之后、第一节之前', () => {
  it('有一节', () => {
    expect(insertTop('---\na: 1\n---\n# 笔记\n\n## 第 3 页 · x\n\n正文\n', '## 复习提纲\n\n- a')).toBe('---\na: 1\n---\n# 笔记\n\n## 复习提纲\n\n- a\n\n## 第 3 页 · x\n\n正文\n')
  })
  it('一节都没有就接在后面', () => {
    expect(insertTop('# 笔记\n', '## 复习提纲\n\n- a')).toBe('# 笔记\n\n## 复习提纲\n\n- a\n')
  })
})

describe('拆成白板卡片：新建一块白板，原文不动', () => {
  it('有小标题：照小标题分列，一块一张卡', () => {
    const b = splitBoard({ title: '第2讲', doc: '# 第2讲\n\n开头一段\n\n## 张量\n\n张量是数组\n\n- 一\n- 二\n\n## 广播\n\n形状不同时\n' })
    expect(b).toBe('---\ntype: board\nfrom: "[[第2讲]]"\n---\n开头一段\n\n## 张量\n\n张量是数组\n\n- 一\n- 二\n\n## 广播\n\n形状不同时\n')
    const cols = splitDoc(b).columns.map((c) => [c.title, c.cards.length])
    expect(cols).toEqual([
      [null, 1],
      ['张量', 2],
      ['广播', 1],
    ])
  })
  it('没有小标题：照 AI 分的列，没分到的进「其他」', () => {
    const doc = '# 随手记\n\n一\n\n二\n\n三\n'
    const p = splitPrompt({ path: 'a.md', title: '随手记', cards: ['一', '二', '三'] })
    const cols = parseColumns(fakeCmdAnswer(p)!, 3)
    expect(cols).toEqual([
      { name: '前一半', items: [1, 2] },
      { name: '后一半', items: [3] },
    ])
    expect(splitBoard({ title: '随手记', doc, columns: [{ name: 'A', items: [2] }] })).toBe('---\ntype: board\nfrom: "[[随手记]]"\n---\n## A\n\n二\n\n## 其他\n\n一\n\n三\n')
  })
})

describe('白板排成计划：只挪卡、加列', () => {
  const board = '---\ntype: board\n---\n## 想法\n\n订机票\n\n看极光\n\n## 杂\n\n写游记\n\n买雪地靴\n'
  it('加三列在最左边，卡挪进去，待办加方框；卡一张没少、字没改', () => {
    const cards = boardCards(board)
    expect(cards.map((c) => [c.n, c.col])).toEqual([
      [1, '想法'],
      [2, '想法'],
      [3, '杂'],
      [4, '杂'],
    ])
    const plan = parsePlan(fakeCmdAnswer(planPrompt({ path: 'b.md', title: 'b', cards, today: '2026-11-21' }))!, cards.length)
    const out = applyPlan(board, plan)
    expect(splitDoc(out).columns.map((c) => [c.title, c.cards.map((u) => u.text.trim())])).toEqual([
      ['这周', ['**待办**\n- [ ] 订机票', '**待办**\n- [ ] 买雪地靴']],
      ['下周', ['看极光']],
      ['以后', ['**待办**\n- [ ] 写游记']],
      ['想法', []],
      ['杂', []],
    ])
    expect(sameCards(board, out)).toBe(true)
    expect(sameCards(board, out.replace('看极光', '看极光吧'))).toBe(false)
  })
  it('一样的字有两张：一张张挪，不挪错', () => {
    const b2 = '## A\n\n买菜\n\n买菜\n'
    const out = applyPlan(b2, new Map([[2, { col: '下周' as const, todo: false }]]))
    expect(splitDoc(out).columns.map((c) => [c.title, c.cards.length])).toEqual([
      ['这周', 0],
      ['下周', 1],
      ['以后', 0],
      ['A', 1],
    ])
  })
  it('计划拆成待办：一张待办卡接在选中那张后面，原来那张不动', () => {
    const b = splitDoc(board)
    const keys = unitKeys(b)
    const key = keys.get(b.columns.find((c) => c.title === '想法')!.cards[0]!)!
    expect(selectedCard(board, key)?.unit.text).toBe('订机票')
    const todos = parseTodos(fakeCmdAnswer(todoPrompt({ path: 'b.md', card: '订机票', col: '想法' }))!)
    expect(todos).toHaveLength(3)
    const out = applyTodos(board, key, todos)
    expect(splitDoc(out).columns.find((c) => c.title === '想法')!.cards.map((u) => u.text.trim())).toEqual(['订机票', `**待办**\n- [ ] ${todos[0]}\n- [ ] ${todos[1]}\n- [ ] ${todos[2]}`, '看极光'])
    expect(onlyAdded(board, out)).toBe(true)
  })
})

describe('读 PDF：每页讲什么、复习提纲', () => {
  it('每页一句，带回到那一页的链接', () => {
    const p = pagesPrompt({ pdf: 'L5.pdf', pages: ['注意力机制', '', 'Softmax'] })
    const m = parsePages(fakeCmdAnswer(p)!, 3)
    expect(m.size).toBe(3)
    expect(pagesSection(m, (n) => `L5.pdf#page=${n}`)).toBe('## 每页讲什么\n\n- [第 1 页](L5.pdf#page=1)：测试：第1页讲「注意力机制」\n- [第 2 页](L5.pdf#page=2)：测试：第2页讲「（这一页没有字）」\n- [第 3 页](L5.pdf#page=3)：测试：第3页讲「Softmax」')
  })
  it('复习提纲按页排', () => {
    const items = parseReview(fakeCmdAnswer(reviewPrompt({ pdf: 'L5.pdf', qas: [{ page: 7, q: '为什么要除以根号 d', a: '防止 softmax 饱和' }, { page: 3, q: 'Q K V 是什么', a: '三个投影' }] }))!)
    expect(items.map((x) => x.page)).toEqual([7, 3])
  })
})

describe('视频：要点带时间、字幕整理成一篇', () => {
  const cues = Array.from({ length: 12 }, (_x, i) => [i * 10, i * 10 + 9, `sentence ${i}`, `第${i}句`] as const)
  it('每一句前面写它自己的时间（task-fw1f3：以前二十秒并一段、只写段首）', () => {
    expect(transcript(cues).split('\n').slice(0, 3)).toEqual(['[00:00] sentence 0', '[00:10] sentence 1', '[00:20] sentence 2'])
    const c3 = [[0, 1.4, 'A.', '甲'], [1.5, 2.9, 'B.', '乙']] as const
    expect(transcript(c3, true)).toBe('[00:00] A.\n（译文）甲\n[00:01] B.\n（译文）乙')
  })
  it('长视频：先并成十秒、三十秒一行（时间写这一行第一句的），还长就每行只留开头，从头到尾都在', () => {
    // 两个小时，每 2 秒一句英文
    const long = Array.from({ length: 3600 }, (_x, i) => [i * 2, i * 2 + 1.9, `This is spoken sentence number ${i} of the long lecture today.`, ''] as const)
    const ten = transcript(long.slice(0, 1350))
    expect(ten.split('\n')[1]).toMatch(/^\[00:10\] This is spoken sentence number 5 /)
    const all = transcript(long)
    const rows = all.split('\n')
    // 30 秒一行，两个小时 240 行，最后一行是最后那 30 秒
    expect(rows).toHaveLength(240)
    expect(rows[1]).toMatch(/^\[00:30\] This is spoken sentence number 15 .*…$/)
    expect(rows[239]).toMatch(/^\[1:59:30\] This is spoken sentence number 3585 /)
    expect(all.length / 3).toBeLessThanOrEqual(30_000)
    // 中文按字算：一个半小时、每 3 秒一句十来个字的，每句照样带自己的时间
    const zh = Array.from({ length: 1800 }, (_x, i) => [i * 3, i * 3 + 2.9, `今天讲第${i}句线性变换的内容`, ''] as const)
    expect(transcript(zh).split('\n')).toHaveLength(1800)
  })
  it('AI 照抄的原话找得到就用那一句的时间（真 Claude Code 把 1:40 讲的写成了 00:38），找不到用它给的时间', () => {
    const c = [[38, 42, 'matrix-vector multiplication that doesn’t rely', ''], [98.4, 103, 'think of each vector as a point,', ''], [103, 108, 'the tip of the arrow.', ''], [135, 140, 'all lines must remain lines', '']] as const
    const items = parseVkey('[{"t":"00:38","q":"each vector as a point","text":"向量看成点"},{"t":"00:38","q":"All lines MUST remain  lines","text":"直线还是直线"},{"t":"01:43","q":"point, the tip of","text":"跨两句"},{"t":"00:39","q":"没有这句","text":"找不到原话"}]', 200)
    expect(placeOnCues(items, c).map((x) => [x.t, x.text])).toEqual([
      [38, '找不到原话'],
      [98, '向量看成点'],
      [98, '跨两句'],
      [135, '直线还是直线'],
    ])
    expect(quoteAt('abc', c)).toBeNull()
  })
  it('AI 给的时间落到它说的那一句开头', () => {
    expect(snapToCue(20, cues)).toBe(20)
    expect(snapToCue(27, cues)).toBe(20)
    expect(snapToCue(29.5, cues)).toBe(30)
    expect(snapToCue(3, [[5, 6, 'a', '']])).toBe(3)
  })
  it('要点按时间排，每条能点回那一秒', () => {
    const items = parseVkey(fakeCmdAnswer(vkeyPrompt({ title: '线性代数', cues }))!, 120)
    expect(items.length).toBeGreaterThanOrEqual(5)
    expect(parseVkey('[{"t":"01:05","text":"a"},{"t":999,"text":"太晚"}]', 120)).toEqual([{ t: 65, text: 'a' }])
    const note = vkeyNote({ title: '线性代数', url: 'https://www.youtube.com/watch?v=x', items: [{ t: 65, text: '矩阵是变换' }], at: (t) => `https://www.youtube.com/watch?v=x&t=${t}s` })
    expect(note).toBe('---\n来源: https://www.youtube.com/watch?v=x\n---\n# 线性代数 要点\n\n- [01:05](https://www.youtube.com/watch?v=x&t=65s) 矩阵是变换\n')
  })
  it('假视频那样三秒一句、带译文：也整理得出来', () => {
    const lines = ['Welcome to linear transformations.', 'A matrix moves every vector.', 'Watch where i-hat lands.']
    const c3 = lines.map((t, i) => [i * 3, i * 3 + 2.8, t, `译文：${t}`] as const)
    const p = vtextPrompt({ title: 'x', cues: c3, tr: true })
    expect(parseVtext(fakeCmdAnswer(p)!).map((x) => x.t)).toEqual([0, 6])
  })
  it('字幕整理：原文一段、译文一段', () => {
    const paras = parseVtext(fakeCmdAnswer(vtextPrompt({ title: 't', cues, tr: true }))!)
    expect(paras[0]).toMatchObject({ t: 0, orig: 'sentence 0 sentence 1' })
    expect(paras[1]).toMatchObject({ t: 20, orig: 'sentence 2 sentence 3' })
  })
})

describe('书摘按主题分节：只挪顺序、加小标题', () => {
  const digest = '---\n类型: 书摘\nbookId: "1"\n---\n# 红楼\n\n## 第一回\n\n> 甲\n\n我的评价：好\n\n> 乙\n> 乙二\n\n## 第二回\n\n> 丙\n\n微信读书的想法：嗯\n\n## 想法\n\n> 丁\n\n微信读书的想法：x\n'
  it('一段划线连同下面的想法、评价是一组；想法、书评两节原样在最后', () => {
    const d = digestOf(digest)!
    expect(d.groups.map((g) => g.text)).toEqual(['> 甲\n\n我的评价：好', '> 乙\n> 乙二', '> 丙\n\n微信读书的想法：嗯'])
    expect(d.tail).toBe('## 想法\n\n> 丁\n\n微信读书的想法：x')
    const themes = parseThemes(fakeCmdAnswer(bthemePrompt({ title: '红楼', groups: d.groups }))!, 3)
    const out = applyThemes(d, themes)
    expect(out).toBe('---\n类型: 书摘\nbookId: "1"\n---\n# 红楼\n\n## 测试主题一\n\n> 甲\n\n我的评价：好\n\n> 丙\n\n微信读书的想法：嗯\n\n## 测试主题二\n\n> 乙\n> 乙二\n\n## 想法\n\n> 丁\n\n微信读书的想法：x\n')
    expect(sameGroups(digest, out)).toBe(true)
    expect(sameGroups(digest, out.replace('我的评价：好', '我的评价：很好'))).toBe(false)
  })
})

describe('写这周的周记', () => {
  it('第几周照 ISO 算', () => {
    expect(isoWeek(new Date(2026, 10, 21))).toBe('2026-W47')
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53')
  })
  it('周记草稿：属性、一级标题是周，正文是 AI 写的', () => {
    const w = { week: '2026-W47', from: '2026-11-16', to: '2026-11-22', notes: [{ path: '课程/a.md', title: 'a', excerpt: '张量' }], books: [] }
    const body = fakeCmdAnswer(weekPrompt(w))!
    expect(weekNote(w, body)).toBe('---\n类型: 周记\n日期: 2026-11-22\n---\n# 2026-W47 周记\n\n## 这周做了什么\n\n- 改了 [[a]]\n\n## 读了什么\n\n- 测试：读了一些\n\n## 下周想做什么\n\n- 测试：接着做\n')
  })
})
