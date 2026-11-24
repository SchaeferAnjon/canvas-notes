import { type AskSection, newReadingNote, renderSection, withDerived } from '@cn/format'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractHtml, vizFileStem, vizTitle, withVizMeta } from '../src/main/reading/prompts'
import { collectAsked, collectDoubts, courseName, readAnkiState, writeAnkiState } from '../src/main/reading/doubts'
import { Vault } from '../src/main/vault'
import { askedUpTo, withoutVizMark } from '../src/shared/reading'

const sec = (over: Partial<AskSection>): AskSection => ({
  id: '.canvas-notes/对话/x-p1-1.md',
  file: '',
  page: 1,
  title: '标题',
  figures: [],
  doubts: ['卡在哪'],
  good: '讲通的讲法',
  points: ['一', '二'],
  failed: [],
  rounds: 1,
  links: [],
  ...over,
})

describe('做个可视化', () => {
  it('回答最后那行标记：界面上去掉，记下这一处适合做；边生成时半截的标记也藏起来', () => {
    expect(withoutVizMark('讲解。\n\n〔可以做个可视化〕')).toEqual({ text: '讲解。', viz: true, figure: null, pre: false })
    expect(withoutVizMark('讲解。')).toEqual({ text: '讲解。', viz: false, figure: null, pre: false })
    expect(withoutVizMark('讲解。\n\n〔可以做').text).toBe('讲解。')
    // 前置知识那一行（前置知识标签）：去掉，记下这一问讲的是论文外的知识；和可视化标记一起也行；半截的也藏
    expect(withoutVizMark('大 O 是……\n\n〔前置知识〕')).toEqual({ text: '大 O 是……', viz: false, figure: null, pre: true })
    expect(withoutVizMark('大 O 是……\n\n〔前置知识〕\n〔可以做个可视化〕')).toMatchObject({ text: '大 O 是……', viz: true, pre: true })
    expect(withoutVizMark('大 O 是……\n\n〔前置').text).toBe('大 O 是……')
    // 配图的框那一行（CN-60）：也去掉，框交给记笔记用
    expect(withoutVizMark('讲解。\n\n〔可以做个可视化〕\n〔配图 0.1,0.4,0.6,0.3 · 结构图〕')).toEqual({ text: '讲解。', viz: true, figure: { rect: [0.1, 0.4, 0.6, 0.3], caption: '结构图' }, pre: false })
  })
  it('从回答里取出 HTML（包在代码块里也行），标题取 <title>，文件名去掉不能用的字', () => {
    const html = '<!doctype html><html><head><title>旋转矩阵 · 拖动角度看基向量</title></head><body>x</body></html>'
    expect(extractHtml('好的：\n```html\n' + html + '\n```\n')).toBe(html)
    expect(extractHtml('没有网页')).toBeNull()
    expect(vizTitle(html, '默认')).toBe('旋转矩阵 · 拖动角度看基向量')
    expect(vizFileStem('旋转矩阵 · 拖动角度看基向量')).toBe('旋转矩阵')
    expect(vizFileStem('a/b:c')).toBe('a b c')
  })
  it('属性写进 <head> 的 meta', () => {
    const out = withVizMeta('<html><head><title>t</title></head></html>', { 类型: '可视化', 课程: '线性代数', 第几讲: '' })
    expect(out).toContain('<head>\n<meta name="类型" content="可视化">\n<meta name="课程" content="线性代数"><title>')
    expect(out).not.toContain('第几讲')
  })
  it('问到第几页：问过的最大页码', () => {
    expect(askedUpTo([])).toBe(0)
    expect(askedUpTo([{ id: 'a', page: 3, createdAt: 0 }, { id: 'b', page: 7, createdAt: 0 }])).toBe(7)
  })
})

describe('我的疑惑（库里）', () => {
  const root = mkdtempSync(join(tmpdir(), 'cn-doubts-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, '课程/线性代数')
  mkdirSync(dir, { recursive: true })
  const pdf = '课程/线性代数/第3讲 线性映射.pdf'
  const note = '课程/线性代数/第3讲 线性映射 笔记.md'
  writeFileSync(join(root, pdf), '%PDF')
  writeFileSync(join(root, '课程/线性代数/第1讲 向量.pdf'), '%PDF')
  writeFileSync(join(root, note), newReadingNote(pdf) + '\n' + renderSection(sec({ file: pdf, page: 5, doubts: ['旋转矩阵怎么来的'] }), note) + '\n' + renderSection(sec({ id: '.canvas-notes/对话/x-p2-1.md', file: pdf, page: 2 }), note))
  const v = new Vault(root)

  it('一个文件夹里各篇笔记问过的每一处，带第几讲；没有笔记的 PDF 不算', async () => {
    const items = await collectDoubts(v, '课程/线性代数')
    expect(items.map((i) => [i.pdf, i.lecture, i.section.page])).toEqual([
      [pdf, 3, 5],
      [pdf, 3, 2],
    ])
    expect(courseName('课程/线性代数')).toBe('线性代数')
    expect(courseName('收件箱')).toBe('收件箱')
  })
  it('送过 Anki 的记号存在 .canvas-notes/anki.json（「我的疑惑」2026-11-20 起不再是文件，汇总页、课程首页直接读笔记）', async () => {
    await writeAnkiState(v, { sent: { '.canvas-notes/对话/x-p1-1.md': '2026-11-16' }, deckId: 7 })
    expect(await readAnkiState(v)).toEqual({ sent: { '.canvas-notes/对话/x-p1-1.md': '2026-11-16' }, deckId: 7 })
    expect(existsSync(join(root, '课程/线性代数/我的疑惑.md'))).toBe(false)
  })
  it('出卡的范围（task-tz7y3）：一门课连子文件夹里的 PDF 都算，一份 PDF 只看它的笔记，整个库全算', async () => {
    mkdirSync(join(root, '课程/线性代数/第五讲'), { recursive: true })
    const sub = '课程/线性代数/第五讲/第5讲 行列式.pdf'
    writeFileSync(join(root, sub), '%PDF')
    writeFileSync(join(root, '课程/线性代数/第五讲/第5讲 行列式 笔记.md'), newReadingNote(sub) + '\n' + renderSection(sec({ id: '.canvas-notes/对话/第5讲-p1-1.md', file: sub, page: 1, doubts: ['行列式是什么'] }), '课程/线性代数/第五讲/第5讲 行列式 笔记.md'))
    const course = await collectAsked(v, { kind: 'folder', folder: '课程/线性代数' })
    expect(course.some((i) => i.pdf === sub)).toBe(true)
    expect((await collectDoubts(v, '课程/线性代数')).some((i) => i.pdf === sub)).toBe(false)
    expect((await collectAsked(v, { kind: 'pdf', pdf: sub })).map((i) => i.section.doubts[0])).toEqual(['行列式是什么'])
    expect((await collectAsked(v, { kind: 'vault' })).length).toBe(course.length)
  })
  it('新格式的笔记一问一条：主对话、旁支里问的原话各一条（「还是不懂」并进上一问），旁支那条带着被问的那句', async () => {
    const pdf2 = '课程/线性代数/第4讲 特征值.pdf'
    const note2 = '课程/线性代数/第4讲 特征值 笔记.md'
    writeFileSync(join(root, pdf2), '%PDF')
    const doc = withDerived(
      sec({
        id: '.canvas-notes/对话/第4讲 特征值-p3-1.md',
        file: pdf2,
        page: 3,
        qas: [
          { q: '给我讲解一下', a: '**特征向量**转完方向不变。\n\n后面。', sides: [{ quote: '转完方向不变', turns: [{ q: '为什么方向不变？', a: '因为只被拉长。' }] }] },
          { q: '还是不懂', a: '换个方式：看图。', sides: [] },
        ],
        recap: '特征向量转完方向不变。',
      }),
    )
    writeFileSync(join(root, note2), newReadingNote(pdf2) + '\n' + renderSection(doc, note2))
    const items = (await collectDoubts(v, '课程/线性代数')).filter((i) => i.pdf === pdf2)
    expect(items.map((i) => [i.section.doubts[0], i.section.good, i.quote ?? '', i.lecture])).toEqual([
      ['给我讲解一下', '换个方式：看图。', '', 4],
      ['为什么方向不变？', '因为只被拉长。', '转完方向不变', 4],
    ])
    expect(items[0]!.id).toBe('.canvas-notes/对话/第4讲 特征值-p3-1.md')
  })
})

describe('送进 Anki（AnkiConnect）', () => {
  let server: Server
  const calls: { action: string; params?: Record<string, unknown> }[] = []
  let models: string[] = []
  let decks: Record<string, number> = { Default: 1 }
  /** Anki 里「学习卡 · 问答」现在的样式（别的软件装的旧一版 v2） */
  let styling = '/* 卡片家族 v2 */\n.card {}'
  const existing = new Set<string>()
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        const { action, params } = JSON.parse(body) as { action: string; params?: Record<string, unknown> }
        calls.push({ action, ...(params ? { params } : {}) })
        const ok = (result: unknown) => res.end(JSON.stringify({ result, error: null }))
        if (action === 'version') return ok(6)
        if (action === 'modelNames') return ok(models)
        if (action === 'createModel') return (models.push(params!.modelName as string), ok({}))
        if (action === 'modelFieldNames') return ok(['Question', 'Answer', 'More', 'Quote', 'Image', 'Label', 'Source', 'Link', 'ID'])
        if (action === 'modelStyling') return ok({ css: styling })
        if (action === 'updateModelStyling') return ((styling = (params!.model as { css: string }).css), ok(null))
        if (action === 'updateModelTemplates') return ok(null)
        if (action === 'deckNamesAndIds') return ok(decks)
        if (action === 'createDeck') return ((decks = { ...decks, [params!.deck as string]: 42 }), ok(42))
        if (action === 'storeMediaFile') return ok(params!.filename)
        if (action === 'canAddNotesWithErrorDetail') {
          const notes = params!.notes as { fields: { Question: string } }[]
          return ok(notes.map((n) => (existing.has(n.fields.Question) ? { canAdd: false, error: 'cannot create note because it is a duplicate' } : { canAdd: true })))
        }
        if (action === 'addNotes') return ok((params!.notes as unknown[]).map((_, i) => 100 + i))
        res.end(JSON.stringify({ result: null, error: `unsupported action ${action}` }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    process.env.CN_ANKI_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => server.close())

  it('第一次：建「学习卡 · 问答」（卡片家族 v3）和这门课的牌组「课程::线性代数」，截图存进媒体库，问题一样的不重复加；出卡改写过的用改写的字', async () => {
    const { sendCards, noteId, CSS, deckFor } = await import('../src/main/reading/anki')
    existing.add('旧的问题')
    const card = (id: string, q: string, png?: Buffer) => ({ id, pdf: '课程/线性代数/第3讲 线性映射.pdf', course: '线性代数', question: q, section: sec({ id, page: 5, rect: [0.1, 0.2, 0.3, 0.4] }), ...(png ? { png } : {}) })
    const r = await sendCards([card('a', '旋转矩阵怎么来的', Buffer.from('png')), card('b', '旧的问题')])
    expect(r).toEqual({ added: ['a'], duplicates: ['b'], failed: {}, decks: ['课程::线性代数::第3讲 线性映射'], notes: { a: 100 } })
    expect(calls.find((c) => c.action === 'createDeck')!.params).toEqual({ deck: '课程::线性代数::第3讲 线性映射' })
    // 牌组规则（2026-11-22 用户：「这个命名就跟目录来」）：课程/<课>/ 下面的文件夹整条进牌组名，直接放在课里的用 PDF 的名字；
    // 不按 PDF 书签分章；不在课程里的进「知识」
    expect(deckFor('课程/ecp/Week 2/Lecture05.pdf')).toBe('课程::ecp::Week 2')
    expect(deckFor('课程/ecp/Week 2/补充材料/论文.pdf')).toBe('课程::ecp::Week 2::补充材料')
    expect(deckFor('课程/ecp/Lecture05.pdf')).toBe('课程::ecp::Lecture05')
    expect(deckFor('课程/a::b/Week 1/c::d/x.pdf')).toBe('课程::a：b::Week 1::c：d')
    // 不在课程里：跟着所在文件夹走（ParaRead 联动），库的最外层进「知识」
    expect(deckFor('阅读/论文.pdf')).toBe('阅读')
    expect(deckFor('阅读/论文/BST.pdf')).toBe('阅读::论文')
    expect(deckFor('BST.pdf')).toBe('知识')
    expect('chapterAt' in (await import('../src/main/reading/anki'))).toBe(false)
    const model = calls.find((c) => c.action === 'createModel')!.params!
    expect(model.modelName).toBe('学习卡 · 问答')
    expect((model.css as string).startsWith('/* 卡片家族 v3 */')).toBe(true)
    expect(CSS.startsWith('/* 卡片家族 v3 */')).toBe(true)
    const added = (calls.find((c) => c.action === 'addNotes')!.params!.notes as { deckName: string; fields: Record<string, string>; tags: string[] }[])[0]!
    expect(added.deckName).toBe('课程::线性代数::第3讲 线性映射')
    expect(added.tags).toEqual(['来自::Canvas_Notes', '主题::线性代数', '主题::第3讲_线性映射'])
    expect(added.fields).toMatchObject({
      Question: '旋转矩阵怎么来的',
      Answer: '讲通的讲法',
      More: '<ul><li>一</li><li>二</li></ul>',
      Image: `<img class="lead" src="${noteId('a')}.png">`,
      Label: 'Canvas Notes · 线性代数',
      Source: '第3讲 线性映射 · 第 5 页',
      ID: noteId('a'),
    })
    // 公式（task-o48fa）：Anki 的 MathJax 认 \(…\)、\[…\]，$…$ 照文档里的认法换过去；钱数、代码照旧
    const { html } = await import('../src/main/reading/anki')
    expect(html('设 $x_i$ 是第 $i$ 个，花 $5 和 $6，`$a$`\n$$\ny=x^2\n$$')).toBe('设 \\(x_i\\) 是第 \\(i\\) 个，花 $5 和 $6，<code>$a$</code><br>\\[y=x^2\\]')
    // 旁支里问的那条：「原文」那一栏是被问的那句
    const { fieldsFor } = await import('../src/main/reading/anki')
    expect(fieldsFor({ ...card('d', '为什么方向不变？'), quote: '转完方向不变' }).Quote).toBe('转完方向不变')
    expect(fieldsFor({ ...card('d', '为什么方向不变？'), section: { ...sec({}), doubts: ['为什么方向不变？'], points: [], good: '因为只被拉长。' } }).More).toBe('')
    expect(added.fields.Link).toBe('canvas-notes://open?file=%E8%AF%BE%E7%A8%8B%2F%E7%BA%BF%E6%80%A7%E4%BB%A3%E6%95%B0%2F%E7%AC%AC3%E8%AE%B2%20%E7%BA%BF%E6%80%A7%E6%98%A0%E5%B0%84.pdf&amp;page=5&amp;rect=0.1,0.2,0.3,0.4')
    // 第二次：笔记类型已经有了、牌组也有了；Anki 里的样式是旧一版（v2）就换成 v3（只往新的换）；同一批里问题一样（不管空白标点）的只送第一张
    calls.length = 0
    const r2 = await sendCards([
      { ...card('c', '原话'), card: { q: '旋转矩阵 R 的第一列是什么？', a: '把 e₁ 转过去的样子', more: '一\n二', quote: '列就是基向量去哪' } },
      { ...card('e', '原话二'), card: { q: '旋转矩阵R的第一列是什么', a: '同上', more: '', quote: '' } },
    ])
    expect(r2.added).toEqual(['c'])
    expect(r2.duplicates).toEqual(['e'])
    expect(calls.map((c) => c.action)).not.toContain('createModel')
    expect(calls.map((c) => c.action)).not.toContain('createDeck')
    expect(calls.map((c) => c.action)).toContain('updateModelStyling')
    expect(styling.startsWith('/* 卡片家族 v3 */')).toBe(true)
    const c2 = (calls.find((c) => c.action === 'addNotes')!.params!.notes as { fields: Record<string, string> }[])[0]!.fields
    expect(c2).toMatchObject({ Question: '旋转矩阵 R 的第一列是什么？', Answer: '把 e₁ 转过去的样子', More: '<ul><li>一</li><li>二</li></ul>', Quote: '列就是基向量去哪' })
    // 再送一次：Anki 里已经是 v3，不再换
    calls.length = 0
    await sendCards([card('f', '又一个')])
    expect(calls.map((c) => c.action)).not.toContain('updateModelStyling')
  })

  it('Anki 没开：说清楚怎么办', async () => {
    const { call } = await import('../src/main/reading/anki')
    const saved = process.env.CN_ANKI_URL
    // 模块里已经读过网址，这里直接关掉服务器试
    await new Promise<void>((r) => server.close(() => r()))
    await expect(call('version')).rejects.toThrow('Anki 没开着，或者没装 AnkiConnect 插件')
    process.env.CN_ANKI_URL = saved
  })
})
