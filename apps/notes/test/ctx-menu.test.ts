import { describe, expect, it } from 'vitest'
import { editItems, fallbackItems, labelOf, tidy, validItems, type CtxItem, type EditFlags } from '../src/shared/ctx-menu'
import { compile } from '../src/renderer/ctx/menu'
import { moveMenu } from '../src/renderer/ctx/move-menu'

const all: EditFlags = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
const labels = (items: CtxItem[]) => tidy(items).map(labelOf)

describe('输入框的标准菜单', () => {
  it('照 macOS 的顺序：撤销重做、剪切拷贝粘贴、全选', () => {
    expect(labels(editItems(all))).toEqual(['撤销', '重做', '—', '剪切', '拷贝', '粘贴', '—', '全选'])
  })
  it('拼错的词：最多 5 个建议放最上面', () => {
    const items = editItems(all, { word: 'helo', suggestions: ['hello', 'help', 'hero', 'halo', 'hell', 'held'] })
    expect(labels(items).slice(0, 6)).toEqual(['hello', 'help', 'hero', 'halo', 'hell', '—'])
    expect(items[0]).toEqual({ spell: 'hello' })
  })
  it('拼错了但没有建议：一行灰的「没有拼写建议」', () => {
    const items = editItems(all, { word: 'qzxv', suggestions: [] })
    expect(items[0]).toEqual({ id: 'nospell', label: '没有拼写建议', enabled: false })
  })
  it('用不了的灰掉，不拿掉', () => {
    const items = editItems({ ...all, canCut: false, canCopy: false })
    expect(items.find((i) => 'edit' in i && i.edit === 'cut')).toEqual({ edit: 'cut', enabled: false })
  })
})

describe('主进程兜底', () => {
  const base = { isEditable: false, selectionText: '', misspelledWord: '', dictionarySuggestions: [], editFlags: all }
  it('输入框：编辑菜单', () => expect(labels(fallbackItems({ ...base, isEditable: true }))).toContain('粘贴'))
  it('选了字：只有拷贝', () => expect(labels(fallbackItems({ ...base, selectionText: '一段' }))).toEqual(['拷贝']))
  it('别处：不弹', () => expect(fallbackItems(base)).toEqual([]))
})

describe('tidy', () => {
  it('去掉开头、结尾、连着的分隔线，子菜单也去', () => {
    const s: CtxItem = { type: 'separator' }
    const out = tidy([s, { id: 'a', label: 'A' }, s, s, { id: 'b', label: 'B', submenu: [s, { id: 'c', label: 'C' }, s] }, s])
    expect(out).toEqual([{ id: 'a', label: 'A' }, s, { id: 'b', label: 'B', submenu: [{ id: 'c', label: 'C' }] }])
  })
})

describe('validItems', () => {
  it('认得各种项', () => {
    expect(validItems([{ type: 'separator' }, { edit: 'copy' }, { spell: 'x' }, { copyImageAt: { x: 1, y: 2 } }, { id: 'a', label: 'A', submenu: [{ id: 'b', label: 'B' }] }])).toBe(true)
  })
  it('「移到」的文件夹子菜单：文件夹套 5 层、一层 120 个也认（r166：用户库里有 4 层的文件夹，文档「⋯」点了没反应，主进程报「菜单参数不对」）', () => {
    const deep = ['项目', '项目/study project 2', '项目/study project 2/计划与调研', '项目/study project 2/计划与调研/文献', '项目/study project 2/计划与调研/文献/2026']
    const wide = ['剪藏', ...Array.from({ length: 120 }, (_, i) => `剪藏/站点 ${i}`)]
    const { items } = compile([{ label: '打开', run: () => undefined }, { label: '移到', submenu: moveMenu([...deep, ...wide], '收件箱', () => undefined) }])
    expect(validItems(items)).toBe(true)
  })
  it('不认的形状', () => {
    expect(validItems([{ edit: 'format' }])).toBe(false)
    expect(validItems([{ id: 1, label: 'A' }])).toBe(false)
    expect(validItems('a')).toBe(false)
    expect(validItems([{ copyImageAt: { x: '1', y: 2 } }])).toBe(false)
  })
})

describe('界面这边拼菜单', () => {
  it('跳过 false / null，分隔线、编辑项原样，普通项编号并记下 run', () => {
    const hit: string[] = []
    const { items, runs } = compile([
      { label: '打开', run: () => hit.push('open') },
      false,
      '-',
      { edit: 'copy', enabled: false },
      { label: '转成', submenu: [{ label: '待办', run: () => hit.push('todo') }, null] },
      { label: '空子菜单', submenu: [false] },
      { label: '灰的', run: () => undefined, enabled: false, accel: 'CommandOrControl+B' },
    ])
    expect(items).toEqual([
      { id: '0', label: '打开' },
      { type: 'separator' },
      { edit: 'copy', enabled: false },
      { id: '4', label: '转成', submenu: [{ id: '4.0', label: '待办' }] },
      { id: '6', label: '灰的', enabled: false, accel: 'CommandOrControl+B' },
    ])
    runs.get('4.0')!()
    runs.get('0')!()
    expect(hit).toEqual(['todo', 'open'])
    expect(validItems(items)).toBe(true)
  })
})
