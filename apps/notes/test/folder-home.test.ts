import { describe, expect, it } from 'vitest'
import {
  addWidget,
  blankNote,
  bodyChars,
  checkFolderName,
  type Cond,
  foldersOfPaths,
  defaultFolderHome,
  folderKind,
  hideW,
  leadOf,
  moveW,
  normalizeFolderHome,
  NOTES_COND,
  type PropFile,
  removeWidget,
  resizeW,
  runCond,
  showW,
  templateFileOf,
} from '../src/shared/folder-home'

describe('文件夹首页：哪些文件夹有', () => {
  it('课程、项目下面一层，生活、写作本身', () => {
    expect(folderKind('课程/线性代数')).toBe('course')
    expect(folderKind('项目/毕业设计')).toBe('project')
    expect(folderKind('生活')).toBe('life')
    expect(folderKind('写作')).toBe('writing')
    for (const no of ['课程', '项目', '素材', '收件箱', '课程/a/b', '生活/x', '课程/..', '课程/.git', '']) expect(folderKind(no)).toBeNull()
    expect(templateFileOf('course')).toBe('课程/.首页模板.json')
    expect(templateFileOf('life')).toBeNull()
  })

  it('从文件路径认出文件夹（预览里挪进来的新课也算），按 课程、项目、生活、写作 排', () => {
    const paths = ['写作/草稿.md', '课程/线性代数/a.md', '课程/线性代数/b.pdf', '生活/x.md', '项目/论文/c.md', '课程/概率论/第1讲.md', '收件箱/d.md', '课程/e.md', '素材/AI/f.md', '课程/线性代数/图/g.png']
    expect(foldersOfPaths(paths)).toEqual(['课程/概率论', '课程/线性代数', '项目/论文', '生活', '写作'])
  })

  it('新课的名字：不能空、不能带斜杠冒号、不能点开头', () => {
    expect(checkFolderName('数值分析')).toBeNull()
    for (const bad of ['', '  ', 'a/b', 'a\\b', 'a:b', '.git', 'x'.repeat(61)]) expect(checkFolderName(bad)).not.toBeNull()
  })
})

describe('文件夹首页：设置', () => {
  it('默认组件照 spec 9.5 的表', () => {
    const c = defaultFolderHome('course')
    expect(c.order).toEqual(['slides', 'review', 'exam', 'notes', 'doubts', 'viz', 'todo', 'links', 'cal'])
    expect(c.hidden).toEqual(['board', 'text'])
    expect(c.widgets.notes!.cond).toEqual(NOTES_COND)
    expect(defaultFolderHome('project').order).toEqual(['todo', 'progress', 'recent', 'links', 'text'])
    expect(defaultFolderHome('writing').order).toEqual(['drafts', 'clips', 'recent', 'list'])
    expect(defaultFolderHome('life').order).toEqual(['todo', 'calendar', 'recent', 'text'])
  })

  it('坏文件回到默认；不认识的组件、坏条件、坏链接丢掉；组件表里有、排列里没有的收着', () => {
    expect(normalizeFolderHome('{坏', 'life')).toEqual(defaultFolderHome('life'))
    const n = normalizeFolderHome(
      {
        style: 'b',
        icon: 'atom',
        color: '#FF0000',
        order: ['todo', 'nope', 'todo', 'list-2'],
        widgets: {
          todo: { type: 'todo', todos: ['[x] 交作业', 3] },
          'list-2': { type: 'list', cond: { name: '导图', rules: [{ prop: '类型', op: '是其中', value: '导图' }, { prop: '颜色', op: '是', value: '红' }], limit: 999 } },
          links: { type: 'links', links: [{ name: '课程网站', url: 'https://x.edu' }, { name: '坏', url: 'javascript:alert(1)' }] },
          weird: { type: 'weird' },
        },
        sizes: { todo: 4, links: 3 },
      },
      'course',
    )
    expect(n.style).toBe('b')
    expect(n.icon).toBe('atom')
    expect(n.color).toBeNull()
    expect(n.order).toEqual(['todo', 'list-2'])
    expect(n.hidden).toEqual(['links'])
    expect(n.widgets.todo!.todos).toEqual(['[x] 交作业'])
    expect(n.widgets['list-2']!.cond!.rules).toHaveLength(1)
    expect(n.widgets['list-2']!.cond!.limit).toBe(50)
    expect(n.widgets.links!.links).toEqual([{ name: '课程网站', url: 'https://x.edu' }])
    expect(n.sizes).toEqual({ todo: 4 })
  })

  it('组件库里加一个收在抽屉里的：放回来，不另加一个', () => {
    const h = defaultFolderHome('course')
    expect(h.hidden).toEqual(['board', 'text'])
    const r = addWidget({ ...h, widgets: { ...h.widgets, text: { type: 'text', text: '老师：王' } } }, 'text', 'course')
    expect(r.id).toBe('text')
    expect(r.home.hidden).toEqual(['board'])
    expect(r.home.order.at(-1)).toBe('text')
    expect(r.home.widgets.text!.text).toBe('老师：王')
  })

  it('加、删、挪、收起、放回、换大小；按条件列出能加好几个', () => {
    let h = defaultFolderHome('life')
    const a = addWidget(h, 'list', 'life')
    const b = addWidget(a.home, 'list', 'life')
    expect([a.id, b.id]).toEqual(['list', 'list-2'])
    h = b.home
    expect(h.order.slice(-2)).toEqual(['list', 'list-2'])
    h = moveW(h, 'list-2', 'todo')
    expect(h.order[0]).toBe('list-2')
    h = hideW(h, 'calendar')
    expect(h.hidden).toEqual(['calendar'])
    h = showW(h, 'calendar')
    expect(h.order.at(-1)).toBe('calendar')
    h = resizeW(h, 'todo')
    expect(h.sizes.todo).toBe(2)
    h = removeWidget(h, 'todo')
    expect(h.widgets.todo).toBeUndefined()
    expect(h.order).not.toContain('todo')
  })
})

describe('按条件列出', () => {
  const now = new Date(2026, 10, 16, 12)
  const f = (path: string, props: Record<string, string>, daysAgo = 30): PropFile => ({ path, props, mtimeMs: now.getTime() - daysAgo * 86400_000 })
  const files = [
    f('课程/线性代数/第3讲 导图.md', { 类型: '导图', 第几讲: '3' }, 0),
    f('课程/线性代数/第5讲 导图.md', { 类型: '导图', 第几讲: '5' }, 2),
    f('课程/线性代数/第1讲 笔记.md', { 类型: '笔记', 第几讲: '1' }),
    f('课程/线性代数/第2讲.pdf', { 类型: '课件', 第几讲: '2' }),
    f('课程/线性代数/草稿.md', { draft: 'true' }),
  ]
  it('类型是其中、第几讲 ≥、按第几讲排', () => {
    // 没写类型的 md（草稿.md）也算笔记，没有第几讲排在最后
    expect(runCond(files, NOTES_COND, now).map((x) => x.props['第几讲'])).toEqual(['5', '3', '1', undefined])
    const c: Cond = { ...NOTES_COND, rules: [{ prop: '类型', op: '是其中', value: '导图' }, { prop: '第几讲', op: '≥', value: '4' }], sort: { prop: '第几讲', dir: 'asc' } }
    expect(runCond(files, c, now).map((x) => x.path)).toEqual(['课程/线性代数/第5讲 导图.md'])
  })
  it('改过在这周、满足任一、草稿', () => {
    const week: Cond = { ...NOTES_COND, rules: [{ prop: '改过', op: '在', value: '今天' }, { prop: '草稿', op: '是', value: '是' }], all: false, sort: { prop: '名字', dir: 'asc' } }
    expect(runCond(files, week, now).map((x) => x.path)).toEqual(['课程/线性代数/草稿.md', '课程/线性代数/第3讲 导图.md'])
    expect(runCond(files, { ...week, rules: [] }, now)).toHaveLength(5)
  })
  it('标题下那一句：几讲、几个文件、问到第几讲；项目这周改了几个；写作几篇草稿、这个月写完几篇', () => {
    expect(leadOf('course', files, now)).toBe('课程 · 4讲 · 5个文件')
    expect(leadOf('course', [...files, f('课程/线性代数/第4讲.pdf', { 类型: '课件', 第几讲: '4', 问到: '7', 页数: '10' })], now)).toBe('课程 · 5讲 · 6个文件 · 问到第4讲')
    expect(leadOf('course', [], now)).toBe('课程 · 还没有文件')
    // 名字认不出第几讲的课件 PDF 也算一讲（左栏按 PDF 数「0/5 讲」，两处对得上）
    expect(leadOf('course', [...files, f('课程/线性代数/坏的.pdf', { 类型: '课件' })], now)).toBe('课程 · 5讲 · 6个文件')
    expect(leadOf('project', files, now)).toBe('项目 · 5个文件 · 这周改了1个')
    expect(leadOf('writing', files, now)).toBe('写作 · 1篇草稿 · 这个月写完2篇')
    expect(leadOf('life', files, now)).toBe('生活 · 5个文件')
  })
  it('没写类型的 md 算笔记，进「笔记和导图」；白板不算', () => {
    const hand = f('课程/ecp/Lecture05 笔记.md', { 进度: '5/5' }, 1)
    const board = f('课程/ecp/板.md', { type: 'board' }, 1)
    expect(runCond([hand, board], NOTES_COND, now).map((x) => x.path)).toEqual(['课程/ecp/Lecture05 笔记.md'])
  })
  it('新建了还没写字的「未命名」算草稿，不算「这个月写完」', () => {
    const blank = (p: string): PropFile => ({ ...f(p, {}, 0), blank: true })
    const all = [...files, blank('写作/未命名.md'), blank('写作/未命名 2.md')]
    expect(leadOf('writing', all, now)).toBe('写作 · 3篇草稿 · 这个月写完2篇')
    expect(blankNote('# 未命名\n\n')).toBe(true)
    expect(blankNote('---\n草稿: 否\n---\n# 未命名\n')).toBe(true)
    expect(blankNote('')).toBe(true)
    expect(blankNote('# 冰岛\n\n第一句。\n')).toBe(false)
  })
  it('写作首页：白板不进「草稿」也不进「写完的」；字数只算正文的字，不算图片地址、白板位置行、网址', () => {
    const long = '这是一篇写完了的长文章。'.repeat(12)
    const board = { ...f('写作/选题墙.md', { type: 'board' }, 0), chars: 400 }
    const pic = { ...f('写作/截图一张.md', {}, 0), chars: bodyChars('# 截图一张\n\n![](https://images.example.com/2026/11/Screenshot-2026-11-17-at-10.00.00-very-long-name.png)\n') }
    const done = { ...f('写作/长文.md', {}, 0), chars: bodyChars(`# 长文\n\n${long}\n`) }
    expect(pic.chars).toBe(0)
    expect(bodyChars('<!-- card id=c1 x=0 y=0 w=280 -->\n短\n[看这里](https://example.com/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t) https://example.com/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(4)
    expect(leadOf('writing', [board, pic, done], now)).toBe('写作 · 1篇草稿 · 这个月写完1篇')
    // 第 4 轮：只有双链（[[…]]、![[…]]）、只有代码块的不算写了字
    const links = Array.from({ length: 30 }, (_, i) => `[[参考笔记第${i}篇]]`).join(' ')
    expect(bodyChars(`# 双链多\n\n${links}\n\n![[配图.png]]\n`)).toBe(0)
    expect(bodyChars('# 代码块\n\n```js\n' + 'console.log("hello world");\n'.repeat(10) + '```\n\n~~~\nmore code here\n~~~\n')).toBe(0)
    expect(bodyChars('# 混着\n\n正文三个字\n\n```\ncode\n```\n\n见[[别处]]。\n')).toBe(7)
    const doneCond: Cond = { ...NOTES_COND, rules: [{ prop: '草稿', op: '是', value: '否' }], sort: { prop: '名字', dir: 'asc' } }
    expect(runCond([board, pic, done], doneCond, now).map((x) => x.path)).toEqual(['写作/长文.md'])
    const draftCond: Cond = { ...doneCond, rules: [{ prop: '草稿', op: '是', value: '是' }] }
    expect(runCond([board, pic, done], draftCond, now).map((x) => x.path)).toEqual(['写作/截图一张.md'])
  })
  it('同一讲的几篇按名字排，不管文件先后', () => {
    const same = [f('课程/线性代数/第3讲 线性映射.md', { 类型: '笔记', 第几讲: '3' }, 1), f('课程/线性代数/第3讲 补充.md', { 类型: '笔记', 第几讲: '3' }, 5)]
    expect(runCond(same, NOTES_COND, now).map((x) => x.path)).toEqual(['课程/线性代数/第3讲 补充.md', '课程/线性代数/第3讲 线性映射.md'])
    expect(runCond([...same].reverse(), NOTES_COND, now).map((x) => x.path)).toEqual(['课程/线性代数/第3讲 补充.md', '课程/线性代数/第3讲 线性映射.md'])
  })
})
