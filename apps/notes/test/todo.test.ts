/**
 * 待办三处（左边「待办」格、文件夹首页的待办卡、名字叫「待办」的笔记的任务界面）共用的纯计算（task-pd1d1，原型 05-任务软件/todo-demo.html）：
 * 哪篇算「待办」、按 过期 / 今天 / 明天 / 以后 / 没定日子 分组、行尾日子小块怎么写、按文件夹分组、加一条时下面那行「认出来：…」，
 * 以及文件树、首页文件列表、「最近」里不列名字叫「待办」的笔记。
 */
import { describe, expect, it } from 'vitest'
import type { NoteFile } from '../src/shared/api'
import { buildTree, type FileEntry, hideTodos } from '../src/shared/files'
import { DEFAULT_FILES, normalizeFiles } from '../src/shared/prefs'
import { recentOf } from '../src/shared/recent'
import { kindOf } from '../src/shared/layout'
import { bucketOf, byFolder, byNote, chipText, dayName, doneGroups, INBOX_TODO, isTodoNote, quickHint, todoGroups, type TodoItem, todoNoteOf } from '../src/shared/todo'

const TODAY = '2026-11-22' // 周日，原型里的「今天」
let seq = 0
const t = (title: string, o: Partial<TodoItem> = {}): TodoItem => {
  const path = o.path ?? INBOX_TODO
  const line = o.line ?? ++seq
  return { key: `${path}#${line}`, id: null, path, line, raw: `- [ ] ${title}`, title, done: false, doneDate: null, cancelled: false, date: null, time: null, remind: null, repeat: null, prio: 0, parent: null, ...o }
}

describe('哪篇是「待办」', () => {
  it('只认名字正好是「待办」的那篇（哪个文件夹都算）', () => {
    expect(isTodoNote('收件箱/待办.md')).toBe(true)
    expect(isTodoNote('写作/待办.md')).toBe(true)
    expect(isTodoNote('待办.md')).toBe(true)
    expect(isTodoNote('写作/待办清单.md')).toBe(false)
    expect(isTodoNote('写作/小论文计划.md')).toBe(false)
    expect(isTodoNote('写作/待办/读书.md')).toBe(false)
  })
  it('收件箱/待办.md 不算等着整理的一条（收件箱的数、梦游归类、/整理收件箱 都不碰它）', () => {
    expect(kindOf('收件箱/待办.md').kind).toBe('work')
    expect(kindOf('收件箱/速记 1.md').kind).toBe('inbox')
    expect(kindOf('收件箱/子文件夹/待办.md').kind).toBe('inbox')
  })
  it('文件夹首页加一条写进 <文件夹>/待办.md；左边格子加的进 收件箱/待办.md', () => {
    expect(todoNoteOf('写作')).toBe('写作/待办.md')
    expect(todoNoteOf('课程/ecp')).toBe('课程/ecp/待办.md')
    expect(INBOX_TODO).toBe('收件箱/待办.md')
  })
})

describe('分组：过期 / 今天 / 明天 / 以后 / 没定日子', () => {
  it('按日子分到哪一组', () => {
    expect(bucketOf(t('a', { date: '2026-11-21' }), TODAY)).toBe('over')
    expect(bucketOf(t('a', { date: TODAY }), TODAY)).toBe('today')
    expect(bucketOf(t('a', { date: '2026-11-23' }), TODAY)).toBe('tom')
    expect(bucketOf(t('a', { date: '2026-11-24' }), TODAY)).toBe('later')
    expect(bucketOf(t('a'), TODAY)).toBe('none')
  })
  it('只列没做完的；组里按日子、钟点排（没钟点的在后），空的组不出；勾掉的另算「已完成」', () => {
    const list = [
      t('交 ecp 作业 2', { date: '2026-11-21', time: '23:59', prio: 3 }),
      t('取快递', { date: TODAY, time: '18:00', remind: '准时' }),
      t('回导师邮件', { date: TODAY, time: '10:30' }),
      t('订冰岛租车', { date: '2026-11-23', time: '20:00', remind: '提前1小时' }),
      t('买打印纸'),
      t('交读书报告', { date: '2026-11-20', done: true }),
      t('取消了的', { cancelled: true }),
    ]
    const g = todoGroups(list, TODAY)
    expect(g.groups.map((x) => [x.name, x.items.map((i) => i.title)])).toEqual([
      ['过期', ['交 ecp 作业 2']],
      ['今天', ['回导师邮件', '取快递']],
      ['明天', ['订冰岛租车']],
      ['没定日子', ['买打印纸']],
    ])
    expect(g.done.map((x) => x.title)).toEqual(['交读书报告'])
    expect(g.groups[0]!.red).toBe(true)
    // 过期那组不能拖上去（拖上去改成哪天说不清），别的组都能
    expect(g.groups.map((x) => x.drop)).toEqual([null, TODAY, '2026-11-23', ''])
  })
  it('任务界面：空的今天、明天、以后也出（当落点），空的过期、没定日子不出', () => {
    const g = todoGroups([t('改第二章的开头', { date: '2026-11-24' })], TODAY, { dropEmpty: true })
    expect(g.groups.map((x) => [x.name, x.items.length])).toEqual([
      ['今天', 0],
      ['明天', 0],
      ['以后', 1],
    ])
    expect(g.groups.map((x) => x.drop)).toEqual([TODAY, '2026-11-23', '2026-11-24'])
  })
  it('刚勾掉的（2 秒里的 just）留在原处，不进「已完成」；过了 2 秒就进「已完成」', () => {
    const a = t('读完三篇相关论文', { date: TODAY, done: true, doneDate: TODAY })
    const list = [a, t('回导师邮件', { date: TODAY, time: '10:30' })]
    const g = todoGroups(list, TODAY, { just: new Set([a.key]) })
    expect(g.groups.map((x) => [x.name, x.items.map((i) => i.title)])).toEqual([['今天', ['回导师邮件', '读完三篇相关论文']]])
    expect(g.done).toEqual([])
    const after = todoGroups(list, TODAY)
    expect(after.groups.map((x) => [x.name, x.items.map((i) => i.title)])).toEqual([['今天', ['回导师邮件']]])
    expect(after.done.map((x) => x.title)).toEqual(['读完三篇相关论文'])
  })
  it('勾掉的过期（日历来的那种也一样）不留在「过期」里：过期组只剩没做完的', () => {
    const cal = '生活/日历.md'
    const list = [
      t('Generative Neural Networks（讲课）', { path: cal, date: '2026-10-27', time: '14:00', remind: '准时', done: true, doneDate: '2026-11-20' }),
      t('练车', { path: cal, date: '2026-11-09', time: '14:30', done: true, doneDate: '2026-11-21' }),
      t('给房东发邮件', { path: '生活/WS 2026 27 待办.md', date: '2026-11-19', time: '18:00' }),
    ]
    const g = todoGroups(list, TODAY)
    expect(g.groups.map((x) => [x.name, x.items.map((i) => i.title)])).toEqual([['过期', ['给房东发邮件']]])
    // 已完成：完成日子倒着
    expect(g.done.map((x) => x.title)).toEqual(['练车', 'Generative Neural Networks（讲课）'])
  })
  it('子任务不单列，除非它自己写了日子', () => {
    const p = t('写论文', { line: 1 })
    const g = todoGroups([p, t('找文献', { line: 2, parent: p.key }), t('交初稿', { line: 3, parent: p.key, date: TODAY })], TODAY)
    expect(g.groups.flatMap((x) => x.items.map((i) => i.title))).toEqual(['交初稿', '写论文'])
  })
})

describe('行尾日子小块（原型 chip）', () => {
  it('今天有钟点只写钟点；昨天、明天、一周内写钟点；再远只写哪天', () => {
    expect(chipText(t('a', { date: TODAY, time: '10:30' }), TODAY)).toBe('10:30')
    expect(chipText(t('a', { date: TODAY }), TODAY)).toBe('今天')
    expect(chipText(t('a', { date: '2026-11-21', time: '23:59' }), TODAY)).toBe('昨天 23:59')
    expect(chipText(t('a', { date: '2026-11-23', time: '20:00' }), TODAY)).toBe('明天 20:00')
    expect(chipText(t('a', { date: '2026-11-24' }), TODAY)).toBe('周二')
    expect(chipText(t('a', { date: '2026-11-25', time: '10:00' }), TODAY)).toBe('周三 10:00')
    expect(chipText(t('a', { date: '2026-12-02', time: '10:00' }), TODAY)).toBe('12月2日')
    expect(chipText(t('a'), TODAY)).toBe('')
  })
  it('日子的叫法', () => {
    expect(dayName(TODAY, TODAY)).toBe('今天')
    expect(dayName('2026-11-23', TODAY)).toBe('明天')
    expect(dayName('2026-11-21', TODAY)).toBe('昨天')
    expect(dayName('2026-11-27', TODAY)).toBe('周五')
    expect(dayName('2026-11-15', TODAY)).toBe('11月15日')
  })
})

describe('按文件夹', () => {
  const items = [
    t('复习神经元结构图', { path: '课程/ecp/Lecture05 笔记.md', date: TODAY, time: '11:00' }),
    t('交论文初稿', { path: '写作/小论文计划.md', date: '2026-11-23', time: '15:00' }),
    t('改第二章的开头', { path: '写作/待办.md', date: '2026-11-24' }),
    t('回导师邮件', { path: INBOX_TODO, date: TODAY, time: '10:30' }),
    t('交读书报告', { path: '写作/待办.md', done: true }),
    t('都做完了', { path: '生活/购物.md', done: true }),
  ]
  it('每个文件夹一组：收件箱在前，有「待办」那篇的文件夹在前，名字用 › 连；只有做完的文件夹不出', () => {
    const f = byFolder(items, new Set(['写作/待办.md', INBOX_TODO]))
    expect(f.map((x) => [x.folder, x.name, x.todo, x.open])).toEqual([
      ['收件箱', '收件箱', INBOX_TODO, 1],
      ['写作', '写作', '写作/待办.md', 2],
      ['课程/ecp', '课程 › ecp', null, 1],
    ])
    expect(f[1]!.items.map((x) => x.title)).toEqual(['交论文初稿', '改第二章的开头', '交读书报告'])
  })
})

describe('全部、已完成（左栏两种分法）', () => {
  it('全部：一个文件夹下面按笔记分，「待办」那篇在前；有日子的在前、没写日子的在后；做完的不列', () => {
    const items = [
      t('买打印纸', { path: '生活/购物.md' }),
      t('交房租', { path: '生活/购物.md', date: '2026-11-30' }),
      t('打疫苗', { path: '生活/待办.md' }),
      t('早做完了', { path: '生活/购物.md', done: true }),
    ]
    expect(byNote(items).map((n) => [n.name, n.items.map((x) => x.title)])).toEqual([
      ['待办', ['打疫苗']],
      ['购物', ['交房租', '买打印纸']],
    ])
  })
  it('已完成：按完成那天一组，倒着排；没写完成日子的一组在最后', () => {
    const items = [
      t('a', { done: true, doneDate: '2026-11-20' }),
      t('b', { done: true, doneDate: TODAY }),
      t('c', { done: true }),
      t('d', { done: true, doneDate: TODAY }),
      t('没做完'),
    ]
    expect(doneGroups(items, TODAY).map((g) => [g.name, g.items.map((x) => x.title)])).toEqual([
      ['今天', ['b', 'd']],
      ['周五', ['a']],
      ['没写完成日子', ['c']],
    ])
  })
})

describe('加一条时下面那行（原型 hintQa）', () => {
  it('认出日子钟点和标题，写加进哪', () => {
    expect(quickHint('明天下午三点交论文', TODAY, '收件箱')).toBe('认出来：明天 15:00 · 「交论文」 · 回车加进收件箱')
    expect(quickHint('买打印纸', TODAY, '收件箱')).toBe('认出来：没定日子 · 「买打印纸」 · 回车加进收件箱')
    expect(quickHint('每周日 倒垃圾', TODAY, '收件箱')).toBe('认出来：今天 · 每周日 · 「倒垃圾」 · 回车加进收件箱')
    expect(quickHint('   ', TODAY, '收件箱')).toBe('')
  })
})

describe('文件树、首页文件列表、「最近」里不列名字叫「待办」的笔记', () => {
  const files: FileEntry[] = [
    { path: '收件箱', kind: 'dir', mtimeMs: 0 },
    { path: '收件箱/待办.md', kind: 'md', mtimeMs: 5 },
    { path: '写作', kind: 'dir', mtimeMs: 0 },
    { path: '写作/待办.md', kind: 'md', mtimeMs: 4 },
    { path: '写作/小论文计划.md', kind: 'md', mtimeMs: 3 },
  ]
  it('hideTodos 给它们记上 hidden，树里不画、篇数不算；别的不动', () => {
    const marked = hideTodos(files)
    expect(marked.filter((f) => f.hidden).map((f) => f.path)).toEqual(['收件箱/待办.md', '写作/待办.md'])
    const tree = buildTree(marked)
    const w = tree.find((n) => n.name === '写作')!
    expect(w.children.map((c) => c.name)).toEqual(['小论文计划.md'])
    expect(w.count).toBe(1)
    expect(tree.find((n) => n.name === '收件箱')!.count).toBe(0)
    // 没有要藏的就原样还回去（不换新数组，界面不跟着重画）
    const none = files.filter((f) => !f.path.endsWith('待办.md'))
    expect(hideTodos(none)).toBe(none)
    // 开关打开：照常画
    expect(buildTree(files).find((n) => n.name === '写作')!.count).toBe(2)
  })
  it('「最近」：hideTodo 时不列', () => {
    const n = (path: string): NoteFile => ({ path, mtimeMs: Date.now(), createdMs: Date.now(), kind: 'work' })
    const notes = [n('写作/待办.md'), n('写作/小论文计划.md')]
    const all = recentOf(notes, { pins: [], now: Date.now(), archiveDays: 0 })
    expect(all.total).toBe(2)
    const m = recentOf(notes, { pins: ['写作/待办.md'], now: Date.now(), archiveDays: 0, hideTodo: true })
    expect(m.total).toBe(1)
    expect(m.pinned).toEqual([])
    expect(m.groups.flatMap((g) => g.items.map((x) => x.path))).toEqual(['写作/小论文计划.md'])
  })
})

describe('设置 › 文件：文件树里显示待办（默认关）、每篇记住用哪种看法', () => {
  it('默认不显示；记住的看法只留 md 路径和三种看法', () => {
    expect(DEFAULT_FILES.showTodo).toBe(false)
    expect(DEFAULT_FILES.noteViews).toEqual({})
    const f = normalizeFiles({ showTodo: true, noteViews: { '写作/待办.md': 'doc', '写作/小论文计划.md': 'task', 'x.md': 'nope', 'y.pdf': 'task', '../z.md': 'task' } })
    expect(f.showTodo).toBe(true)
    expect(f.noteViews).toEqual({ '写作/待办.md': 'doc', '写作/小论文计划.md': 'task' })
    expect(normalizeFiles({ showTodo: 'yes' }).showTodo).toBe(false)
  })
})
