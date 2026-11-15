import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarkHome, parseArrange } from '../src/main/plugins/bookmarks/home'
import { toneOf } from '../src/shared/favicon'
import { Bookmarks } from '../src/main/web/library'
import {
  addLater,
  ago,
  type Arrange,
  dissolve,
  foldersOf,
  groupBySite,
  mergeTiles,
  moveTile,
  newGroupName,
  normalizeLater,
  putIn,
  quickTiles,
  removeFromGroup,
  renameGroup,
  sortLater,
  takeOut,
} from '../src/shared/plugins/bookmark-home'
import type { Bookmark } from '../src/shared/web-api'

const bm = (id: string, folder = '书签栏'): Bookmark => ({ id, title: id.toUpperCase(), url: `https://${id}.example.com/`, folder, addedMs: 1 })
const START = [bm('a'), bm('b'), bm('c'), bm('d'), bm('x', '其他书签'), bm('y', '书签栏 / 工作'), bm('z', '书签栏 / 工作 / 深')]

/** 像主进程一样把挪动用到书签上 */
const apply = (list: Bookmark[], changes: Arrange[]) => {
  const by = new Map(changes.map((c) => [c.id, c]))
  return list.map((b) => (by.has(b.id) ? { ...b, ...by.get(b.id) } : b))
}
const keys = (list: Bookmark[]) => quickTiles(list).map((t) => (t.kind === 'link' ? t.b.id : `${t.name}[${t.items.map((b) => b.id).join(',')}]`))

describe('快捷书签 = 书签栏和它的一级子文件夹', () => {
  it('书签栏里的书签一格一个，子文件夹是一个分组（更深的算进去），其他书签不出现', () => {
    expect(keys(START)).toEqual(['a', 'b', 'c', 'd', '工作[y,z]'])
  })

  it('拖一个到另一个上：新建「书签栏 / 新分组」把两个挪进去，放在被拖到的位置；再拖一个进分组', () => {
    let l = apply(START, mergeTiles(quickTiles(START), 'd', 'b', newGroupName(START)))
    expect(keys(l)).toEqual(['a', '新分组[b,d]', 'c', '工作[y,z]'])
    expect(l.find((b) => b.id === 'd')!.folder).toBe('书签栏 / 新分组')
    l = apply(l, mergeTiles(quickTiles(l), 'a', 'f:书签栏 / 新分组', 'x'))
    expect(keys(l)).toEqual(['新分组[b,d,a]', 'c', '工作[y,z]'])
    // 名字被占了就加数字
    expect(newGroupName(l)).toBe('新分组 2')
    // 分组不能拖进别的格子
    expect(mergeTiles(quickTiles(l), 'f:书签栏 / 新分组', 'c', 'n')).toEqual([])
  })

  it('拖到两格之间排序，分组也能挪', () => {
    let l = apply(START, moveTile(quickTiles(START), 'd', 'a', false))
    expect(keys(l)).toEqual(['d', 'a', 'b', 'c', '工作[y,z]'])
    l = apply(l, moveTile(quickTiles(l), 'f:书签栏 / 工作', 'a', true))
    expect(keys(l)).toEqual(['d', 'a', '工作[y,z]', 'b', 'c'])
    // 更深的文件夹不动
    expect(l.find((b) => b.id === 'z')!.folder).toBe('书签栏 / 工作 / 深')
  })

  it('移出分组放在分组后面；解散分组回到原位；改名连同更深的文件夹', () => {
    let l = apply(START, removeFromGroup(quickTiles(START), 'f:书签栏 / 工作', 'y'))
    expect(keys(l)).toEqual(['a', 'b', 'c', 'd', '工作[z]', 'y'])
    expect(l.find((b) => b.id === 'y')!.folder).toBe('书签栏')
    l = apply(l, renameGroup(l, '书签栏 / 工作', '冰岛/南岸'))
    expect(l.find((b) => b.id === 'z')!.folder).toBe('书签栏 / 冰岛／南岸 / 深')
    l = apply(l, dissolve(quickTiles(l), 'f:书签栏 / 冰岛／南岸'))
    expect(keys(l)).toEqual(['a', 'b', 'c', 'd', 'z', 'y'])
    expect(renameGroup(l, '书签栏 / 不存在', ' ')).toEqual([])
  })

  it('移出快捷书签挪到其他书签；加到快捷书签排在最后', () => {
    let l = apply(START, takeOut(['b']))
    expect(keys(l)).toEqual(['a', 'c', 'd', '工作[y,z]'])
    l = apply(l, putIn(quickTiles(l), l.find((b) => b.id === 'x')!))
    expect(keys(l)).toEqual(['a', 'c', 'd', '工作[y,z]', 'x'])
  })

  it('书签库一次挪好几个，写一次盘；不认识的 id 跳过；参数检查', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cn-arr-'))
    try {
      const file = join(dir, 'bookmarks.json')
      writeFileSync(file, JSON.stringify(START))
      let writes = 0
      const lib = new Bookmarks(file, () => writes++)
      lib.arrange([{ id: 'a', folder: '书签栏 / 新分组', order: 1 }, { id: 'nope', order: 2 }, { id: 'b', order: 0 }])
      expect(writes).toBe(1)
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Bookmark[]
      expect(saved.find((b) => b.id === 'a')).toMatchObject({ folder: '书签栏 / 新分组', order: 1 })
      expect(saved.find((b) => b.id === 'b')).toMatchObject({ folder: '书签栏', order: 0 })
      lib.arrange([{ id: 'b', order: 0 }])
      expect(writes).toBe(1)
      expect(() => parseArrange([{ id: 1 }])).toThrow('参数不对')
      expect(() => parseArrange([{ id: 'a', order: Infinity }])).toThrow('参数不对')
      expect(parseArrange([{ id: 'a', folder: '书签栏', extra: 1 }])).toEqual([{ id: 'a', folder: '书签栏' }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('稍后再看、打开的标签、文件夹', () => {
  it('同网址再存一次挪到最前、去掉勾；看完的排在后面', () => {
    let l = addLater([], { url: 'https://a.com/1', title: '一' }, 10, 'i1')
    l = addLater(l, { url: 'https://a.com/2', title: '' }, 20, 'i2')
    expect(l.map((x) => [x.id, x.title])).toEqual([
      ['i2', 'https://a.com/2'],
      ['i1', '一'],
    ])
    l = l.map((x) => (x.id === 'i2' ? { ...x, done: true } : x))
    expect(sortLater(l).map((x) => x.id)).toEqual(['i1', 'i2'])
    l = addLater(l, { url: 'https://a.com/2', title: '二' }, 30, 'new')
    expect(l[0]).toEqual({ id: 'i2', url: 'https://a.com/2', title: '二', addedMs: 30 })
    expect(() => addLater(l, { url: 'file:///etc/passwd', title: '' }, 1, 'z')).toThrow('只能存 http(s) 网页')
    expect(normalizeLater([{ id: 'a', url: 'javascript:1' }, { id: 'b', url: 'https://b.com', done: 'yes' }, 'x'])).toEqual([{ id: 'b', url: 'https://b.com', title: 'https://b.com', addedMs: 0 }])
  })

  it('打开的标签按网站分组，标签多的在前；文件夹按书签栏在前', () => {
    const tabs = [{ url: 'https://www.a.com/1' }, { url: 'https://b.com/1' }, { url: 'https://b.com/2' }, { url: 'https://a.com/2' }, { url: 'https://c.com/' }]
    expect(groupBySite(tabs).map((g) => [g.site, g.tabs.length])).toEqual([
      ['a.com', 2],
      ['b.com', 2],
      ['c.com', 1],
    ])
    expect(foldersOf(START).map((f) => [f.path, f.count])).toEqual([
      ['书签栏', 4],
      ['书签栏 / 工作', 1],
      ['书签栏 / 工作 / 深', 1],
      ['其他书签', 1],
    ])
  })

  it('几天前', () => {
    const now = Date.UTC(2026, 10, 15, 12)
    expect(ago(0, now)).toBe('')
    expect(ago(now - 3600_000, now)).toBe('今天')
    expect(ago(now - 86400_000, now)).toBe('昨天')
    expect(ago(now - 5 * 86400_000, now)).toBe('5 天前')
  })
})

describe('网站小图标多深', () => {
  const px = (b: number, g: number, r: number, a: number, n: number) => Uint8Array.from(Array.from({ length: n }, () => [b, g, r, a]).flat())
  it('很黑的是 dark（深色主题垫白底），很白的是 light，几乎透明的是 empty，透明的像素不算', () => {
    expect(toneOf(px(20, 20, 20, 255, 256))).toBe('dark')
    expect(toneOf(px(250, 250, 250, 255, 256))).toBe('light')
    expect(toneOf(px(40, 120, 230, 255, 256))).toBe('mid')
    expect(toneOf(px(0, 0, 0, 0, 256))).toBe('empty')
    expect(toneOf(Uint8Array.from([...px(0, 0, 0, 0, 200), ...px(10, 10, 10, 255, 56)]))).toBe('dark')
    expect(toneOf(Uint8Array.from([...px(0, 0, 0, 0, 250), ...px(10, 10, 10, 255, 6)]))).toBe('empty')
  })
})

describe('稍后再看存在插件文件夹', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cn-bkh-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('存进 home.json，重开还在；坏参数拒掉；文件被手改坏也能读', () => {
    const file = join(dir, 'home.json')
    const h = new BookmarkHome(file)
    expect(h.get()).toEqual({ later: [] })
    const { later } = h.addLater({ url: 'https://a.com/', title: '甲' }, 5)
    h.setLaterDone(later[0]!.id, true)
    expect(new BookmarkHome(file).get().later).toEqual([{ id: later[0]!.id, url: 'https://a.com/', title: '甲', addedMs: 5, done: true }])
    expect(new BookmarkHome(file).setLaterDone(later[0]!.id, false).later[0]!.done).toBeUndefined()
    expect(new BookmarkHome(file).removeLater(later[0]!.id).later).toEqual([])
    expect(() => h.addLater({ url: 3, title: '' })).toThrow('参数不对')
    writeFileSync(file, JSON.stringify({ later: [{ id: 'z', url: 'https://z.com' }, { id: 'bad' }] }))
    expect(new BookmarkHome(file).get()).toEqual({ later: [{ id: 'z', url: 'https://z.com', title: 'https://z.com', addedMs: 0 }] })
  })
})
