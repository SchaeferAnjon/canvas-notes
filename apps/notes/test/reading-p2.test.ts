import { type AskSection, newReadingNote, renderSection } from '@cn/format'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractHtml, vizFileStem, vizTitle, withVizMeta } from '../src/main/reading/prompts'
import { collectDoubts, courseName, readAnkiState, writeAnkiState, writeDoubtsNote } from '../src/main/reading/doubts'
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
    expect(withoutVizMark('讲解。\n\n〔可以做个可视化〕')).toEqual({ text: '讲解。', viz: true })
    expect(withoutVizMark('讲解。')).toEqual({ text: '讲解。', viz: false })
    expect(withoutVizMark('讲解。\n\n〔可以做').text).toBe('讲解。')
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
  it('写 我的疑惑.md；没变不写；送过 Anki 的标出来', async () => {
    expect(await writeDoubtsNote(v, '课程/线性代数')).toBe('课程/线性代数/我的疑惑.md')
    expect(await writeDoubtsNote(v, '课程/线性代数')).toBeNull()
    const md = readFileSync(join(root, '课程/线性代数/我的疑惑.md'), 'utf8')
    expect(md).toContain('## 第3讲 线性映射\n\n- **卡在哪** [第 2 页]')
    await writeAnkiState(v, { sent: { '.canvas-notes/对话/x-p1-1.md': '2026-11-16' }, deckId: 7 })
    expect(await readAnkiState(v)).toEqual({ sent: { '.canvas-notes/对话/x-p1-1.md': '2026-11-16' }, deckId: 7 })
    await writeDoubtsNote(v, '课程/线性代数')
    expect(readFileSync(join(root, '课程/线性代数/我的疑惑.md'), 'utf8')).toContain('- **旋转矩阵怎么来的** [第 5 页](第3讲%20线性映射.pdf#page=5) · 已送 Anki')
    expect(await writeDoubtsNote(v, '收件箱')).toBeNull()
  })
})

describe('送进 Anki（AnkiConnect）', () => {
  let server: Server
  const calls: { action: string; params?: Record<string, unknown> }[] = []
  let models: string[] = []
  let decks: Record<string, number> = { Default: 1 }
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

  it('第一次：建「学习卡 · 问答」（卡片家族 v3）和「知识」牌组，截图存进媒体库，问题一样的不重复加', async () => {
    const { sendCards, noteId, CSS } = await import('../src/main/reading/anki')
    existing.add('旧的问题')
    const card = (id: string, q: string, png?: Buffer) => ({ id, pdf: '课程/线性代数/第3讲 线性映射.pdf', course: '线性代数', question: q, section: sec({ id, page: 5, rect: [0.1, 0.2, 0.3, 0.4] }), ...(png ? { png } : {}) })
    const r = await sendCards([card('a', '旋转矩阵怎么来的', Buffer.from('png')), card('b', '旧的问题')])
    expect(r).toEqual({ added: ['a'], duplicates: ['b'], failed: {}, deck: { name: '知识', id: 42 } })
    const model = calls.find((c) => c.action === 'createModel')!.params!
    expect(model.modelName).toBe('学习卡 · 问答')
    expect((model.css as string).startsWith('/* 卡片家族 v3 */')).toBe(true)
    expect(CSS.startsWith('/* 卡片家族 v3 */')).toBe(true)
    const added = (calls.find((c) => c.action === 'addNotes')!.params!.notes as { deckName: string; fields: Record<string, string>; tags: string[] }[])[0]!
    expect(added.deckName).toBe('知识')
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
    expect(added.fields.Link).toBe('canvas-notes://open?file=%E8%AF%BE%E7%A8%8B%2F%E7%BA%BF%E6%80%A7%E4%BB%A3%E6%95%B0%2F%E7%AC%AC3%E8%AE%B2%20%E7%BA%BF%E6%80%A7%E6%98%A0%E5%B0%84.pdf&amp;page=5&amp;rect=0.1,0.2,0.3,0.4')
    // 第二次：笔记类型已经有了，牌组按 id 认
    calls.length = 0
    await sendCards([card('c', '新问题')], 42)
    expect(calls.map((c) => c.action)).not.toContain('createModel')
    expect(calls.map((c) => c.action)).not.toContain('createDeck')
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
