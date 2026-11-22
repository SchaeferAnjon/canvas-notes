import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarkTree } from '../src/main/web/bookmarkkeeper/bookmark-tree'
import { fnv1a, machineIdFrom, merge, QuickBridge, QuickStore, validate } from '../src/main/web/bookmarkkeeper/quick-store'
import { findSource } from '../src/main/web/bookmarkkeeper/source'
import { Bookmarks } from '../src/main/web/library'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-bk-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const rec = (id: string, t: number, d: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'link', title: id, url: `https://${id}.example/`, parent: '', order: 0, deleted: false, t, d, ...extra })

describe('快捷书签仓库（BKCore 格式）', () => {
  it('fnv1a 和 BKCore 算出来一样：这台 Mac 的文件名前缀', () => {
    // BKCore QuickStore.fnv1a("") = 14695981039346656037 的 36 进制
    expect(fnv1a('')).toBe((0xcbf29ce484222325n).toString(36))
    expect(machineIdFrom('  "IOPlatformUUID" = "ABC"\n')).toBe('mac-' + fnv1a('bookmarkkeeper:ABC'))
    expect(machineIdFrom('没有')).toBeNull()
  })

  it('同一个 id 取 t 大的，t 一样比写入方', () => {
    const a = rec('x', 1, 'a')
    const b = rec('x', 2, 'a')
    const c = rec('x', 2, 'b')
    expect(merge({ x: a }, { x: b }).x).toBe(b)
    expect(merge({ x: c }, { x: b }).x).toBe(c)
  })

  it('validate 拦下键和 id 不一致、缺时间戳的记录', () => {
    expect(() => validate({ x: rec('y', 1, 'a') })).toThrow(/id 不一致/)
    expect(() => validate({ x: { id: 'x', d: 'a' } })).toThrow(/时间戳/)
    expect(() => validate([])).toThrow()
    expect(Object.keys(validate({ x: rec('x', 1, 'a') }))).toEqual(['x'])
  })

  it('写自己的文件，读的时候合并别的写入方的文件', () => {
    const q = join(dir, 'QuickLinks')
    mkdirSync(q)
    writeFileSync(join(q, 'mac-other-chrome.json'), JSON.stringify({ schema: 1, writer: 'mac-other-chrome', updated: 1, records: { a: rec('a', 5, 'dev-o'), b: rec('b', 5, 'dev-o') } }))
    writeFileSync(join(q, 'broken.json'), '{')
    const store = new QuickStore(q, 'mac-me-canvasnotes')
    expect(Object.keys(store.load().records).sort()).toEqual(['a', 'b'])
    const rev1 = store.revision()
    const r = store.put({ b: rec('b', 9, 'dev-me', { deleted: true }), c: rec('c', 9, 'dev-me') })
    expect(r.records.b!.deleted).toBe(true)
    expect(Object.keys(r.records).sort()).toEqual(['a', 'b', 'c'])
    expect(r.rev).not.toBe(rev1)
    const own = JSON.parse(readFileSync(join(q, 'mac-me-canvasnotes.json'), 'utf8'))
    expect(own.schema).toBe(1)
    expect(own.writer).toBe('mac-me-canvasnotes')
    expect(Object.keys(own.records).sort()).toEqual(['b', 'c'])
    // 别人的文件一个字节不动
    expect(JSON.parse(readFileSync(join(q, 'mac-other-chrome.json'), 'utf8')).records.b.deleted).toBe(false)
    expect(readdirSync(q).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('iCloud 容器不在：存本机，回答 icloud:false；容器出现后本机的并进去', () => {
    const container = join(dir, 'icloud')
    const local = join(dir, 'local', 'QuickLinks')
    let now = 0
    const bridge = new QuickBridge({ container, localDir: local, writer: () => 'mac-me-canvasnotes', now: () => now })
    const put = bridge.handle({ cmd: 'put', records: { a: rec('a', 1, 'dev') } })
    expect(put).toMatchObject({ ok: true, icloud: false })
    expect(readdirSync(local)).toEqual(['mac-me-canvasnotes.json'])
    mkdirSync(container)
    now = 61_000
    const load = bridge.handle({ cmd: 'load' }) as { ok: boolean; icloud: boolean; records: Record<string, unknown> }
    expect(load.icloud).toBe(true)
    expect(Object.keys(load.records)).toEqual(['a'])
    expect(readdirSync(join(container, 'QuickLinks'))).toEqual(['mac-me-canvasnotes.json'])
    expect(readdirSync(join(dir, 'local')).some((n) => n.startsWith('QuickLinks-merged-into-iCloud-'))).toBe(true)
    expect(bridge.handle({ cmd: 'nope' })).toEqual({ ok: false, error: '未知命令：nope' })
    expect(bridge.handle({ cmd: 'put', records: { a: {} } })).toMatchObject({ ok: false })
  })
})

describe('chrome.bookmarks 的树', () => {
  let lib: Bookmarks
  let tree: BookmarkTree
  beforeEach(() => {
    lib = new Bookmarks(join(dir, 'bookmarks.json'))
    lib.merge([
      { title: 'A', url: 'https://a.example/', folder: '书签栏' },
      { title: 'B', url: 'https://b.example/', folder: '书签栏 / 工作' },
      { title: 'C', url: 'https://c.example/', folder: '其他书签' },
      { title: 'D', url: 'https://d.example/', folder: '自己的' },
    ])
    tree = new BookmarkTree(lib, join(dir, 'folders.json'), () => {})
  })

  it('getTree：0 根下面三个根文件夹，路径摆成树', () => {
    const [root] = tree.getTree()
    expect(root!.children!.map((n) => [n.id, n.title, n.folderType])).toEqual([
      ['1', '书签栏', 'bookmarks-bar'],
      ['2', '其他书签', 'other'],
      ['3', '移动设备书签', 'mobile'],
    ])
    const bar = root!.children![0]!
    expect(bar.children!.map((n) => n.title)).toEqual(['A', '工作'])
    expect(bar.children![1]!.children![0]).toMatchObject({ title: 'B', url: 'https://b.example/', parentId: bar.children![1]!.id, index: 0 })
    // 不在根文件夹里的顶层文件夹挂在「其他书签」下
    expect(root!.children![1]!.children!.map((n) => n.title)).toEqual(['C', '自己的'])
  })

  it('建文件夹、把书签挪进去、排到前面', () => {
    const f = tree.create({ parentId: '1', title: 'AI 整理 / 2026' })
    expect(f).toMatchObject({ title: 'AI 整理／2026', parentId: '1' })
    const a = lib.all().find((b) => b.title === 'A')!
    const c = lib.all().find((b) => b.title === 'C')!
    tree.move(c.id, { parentId: f.id })
    tree.move(a.id, { parentId: f.id, index: 0 })
    expect(lib.all().find((b) => b.id === c.id)!.folder).toBe('书签栏 / AI 整理／2026')
    expect(tree.getChildren(f.id).map((n) => n.title)).toEqual(['A', 'C'])
    // 空文件夹也留得住
    const empty = tree.create({ parentId: '2', title: '空的' })
    expect(tree.getChildren('2').map((n) => n.title)).toContain('空的')
    expect(() => tree.remove(f.id)).toThrow(/不是空的/)
    tree.remove(empty.id)
    expect(tree.getChildren('2').map((n) => n.title)).not.toContain('空的')
  })

  it('文件夹改名：里面的书签路径跟着换；search 按标题、网址找', () => {
    const work = tree.getChildren('1').find((n) => n.title === '工作')!
    const renamed = tree.update(work.id, { title: '上班' })
    expect(renamed.title).toBe('上班')
    expect(lib.all().find((b) => b.title === 'B')!.folder).toBe('书签栏 / 上班')
    expect(tree.search('b.example').map((n) => n.title)).toEqual(['B'])
    expect(tree.search({ title: '上班' }).map((n) => n.id)).toEqual([renamed.id])
    tree.removeTree(renamed.id)
    expect(lib.all().some((b) => b.title === 'B')).toBe(false)
  })

  it('建书签：网址已经有了就是挪那一个', () => {
    const n = tree.create({ parentId: '2', title: 'A again', url: 'https://a.example/' })
    expect(lib.all().filter((b) => b.url === 'https://a.example/')).toHaveLength(1)
    expect(n.parentId).toBe('2')
    const fresh = tree.create({ parentId: '1', index: 0, title: 'E', url: 'https://e.example/' })
    expect(tree.getChildren('1')[0]!.id).toBe(fresh.id)
  })
})

describe('BookmarkKeeper 的文件从哪来', () => {
  const ext = (d: string, name = '书签管家 BookmarkKeeper') => {
    mkdirSync(join(d, 'newtab'), { recursive: true })
    writeFileSync(join(d, 'manifest.json'), JSON.stringify({ name, version: '0.8.0' }))
    writeFileSync(join(d, 'newtab', 'index.html'), '<title>x</title>')
    return d
  }
  it('只用软件自带的那份（测试时用 CN_BOOKMARKKEEPER_DIR 指的）；Chrome 里装的、源码目录里的都不找', () => {
    const bundled = ext(join(dir, 'bundled'))
    expect(findSource({ bundled })).toMatchObject({ dir: bundled, from: 'bundled', version: '0.8.0' })
    const env = ext(join(dir, 'env'))
    expect(findSource({ env, bundled })).toMatchObject({ dir: env, from: 'env' })
    // 指的不是 BookmarkKeeper：还是自带的
    expect(findSource({ env: ext(join(dir, 'other'), '别的插件'), bundled })!.from).toBe('bundled')
    expect(findSource({ bundled: join(dir, 'nope') })).toBeNull()
  })
})

// 新标签页的搜索只搜快捷书签（跟上游 e6a4bbc，task-4xtbp）：用软件自带那份的 shared/fuzzy.js
describe('新标签页搜索快捷书签（searchQuickLinks）', async () => {
  // @ts-expect-error 自带插件的 js 没有类型
  const { searchQuickLinks } = (await import('../resources/bookmarkkeeper/shared/fuzzy.js')) as {
    searchQuickLinks(q: string, list: unknown, limit?: number): { title: string; url: string; path: string }[]
  }
  const QUICK = [
    { title: '黑沙滩', url: 'https://black.example/' },
    { type: 'group', name: '冰岛', items: [{ title: '冰川', url: 'https://glacier.example/' }, { title: '极光', url: 'https://aurora.example/' }] },
  ]
  it('分组里的搜得到、带上分组名；顶层的没有分组名；按分组名搜出组里每一条', () => {
    expect(searchQuickLinks('冰川', QUICK).map((r) => [r.title, r.path])).toEqual([['冰川', '冰岛']])
    expect(searchQuickLinks('黑沙滩', QUICK).map((r) => [r.title, r.path])).toEqual([['黑沙滩', '']])
    expect(searchQuickLinks('冰岛', QUICK).map((r) => r.title).sort()).toEqual(['冰川', '极光'])
  })
  it('快捷书签以外的搜不到；空的不出结果；同一网址只出一次', () => {
    expect(searchQuickLinks('瀑布', QUICK)).toEqual([])
    expect(searchQuickLinks('  ', QUICK)).toEqual([])
    expect(searchQuickLinks('冰川', null)).toEqual([])
    expect(searchQuickLinks('冰川', [{ title: '冰川', url: 'https://glacier.example/' }, QUICK[1]])).toHaveLength(1)
  })
})
