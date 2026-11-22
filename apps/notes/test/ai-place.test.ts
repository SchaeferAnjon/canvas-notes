// AI 对话跟着地方走（D 组 CN-132）：每一页是哪个地方、「看得到」怎么写、能动手做什么；发给 AI 的那一行认得文件夹
import { describe, expect, it } from 'vitest'
import { describeContext } from '../src/main/agent/context'
import { bookName, folderCount, placeOf, readKey, readLabel, readSrc, seenOf } from '../src/renderer/ai-place'
import type { FileEntry } from '../src/shared/files'
import { CLIPS } from '../src/shared/layout'

const f = (path: string, kind: FileEntry['kind'] = 'md'): FileEntry => ({ path, kind, mtimeMs: 0 })
const opts = { board: false, inbox: 3, count: () => 1 }

describe('每一页是哪个地方', () => {
  it('文件、文件夹、首页、收件箱各是一个地方；剪藏的一个主题和它那个文件夹是同一个', () => {
    expect(placeOf({ id: 'a', type: 'note', path: '周记/2026-W47.md' })).toEqual({ key: 'file:周记/2026-W47.md', label: '2026-W47' })
    expect(placeOf({ id: 'a', type: 'folder', folder: '课程/线代' })).toEqual({ key: 'folder:课程/线代', label: '线代' })
    expect(placeOf({ id: 'a', type: 'home' })).toEqual({ key: 'home', label: '首页' })
    expect(placeOf({ id: 'a', type: 'inbox' })).toEqual({ key: 'inbox', label: '收件箱' })
    expect(placeOf({ id: 'a', type: 'topic', topic: '冰岛旅行' }).key).toBe(placeOf({ id: 'b', type: 'folder', folder: `${CLIPS}/冰岛旅行` }).key)
    expect(placeOf({ id: 'a', type: 'web', url: 'https://www.example.com/a', title: '' })).toEqual({ key: 'page:https://www.example.com/a', label: 'example.com' })
    expect(placeOf(null)).toEqual({ key: 'none', label: '空白页' })
  })

  it('读 PDF 那一套按来源存：菜单里的 key 是 read:<来源>，名字是带扩展名的文件名，网页上问的是网页标题', () => {
    expect(readKey('课程/线代/第3讲.pdf')).toBe('read:课程/线代/第3讲.pdf')
    expect(readSrc('read:web:https://a.com/x')).toBe('web:https://a.com/x')
    expect(readSrc('folder:周记')).toBeNull()
    expect(readLabel('课程/线代/第3讲.pdf')).toBe('第3讲.pdf')
    expect(readLabel('旋转矩阵.html')).toBe('旋转矩阵.html')
    expect(readLabel('web:https://www.youtube.com/watch?v=1', 'Linear maps')).toBe('Linear maps')
    expect(readLabel('web:https://www.youtube.com/watch?v=1')).toBe('youtube.com')
  })
})

describe('看得到、能动手', () => {
  it('文件夹页写「文件夹：周记 · 1篇」，首页写「首页」，文档、白板、收件箱各写各的；没有一页写「没打开笔记」', () => {
    expect(seenOf({ id: 'a', type: 'folder', folder: '周记' }, opts)).toEqual({ see: '文件夹：周记 · 1篇', hands: '整理、归类、写小结' })
    expect(seenOf({ id: 'a', type: 'home' }, opts)).toEqual({ see: '首页', hands: '整理收件箱、开白板' })
    expect(seenOf({ id: 'a', type: 'inbox' }, opts)).toEqual({ see: '收件箱3条', hands: '整理收件箱、开白板' })
    expect(seenOf({ id: 'a', type: 'note', path: '随手记.md' }, opts)).toEqual({ see: '文档：随手记', hands: '改写、插入、挪块' })
    expect(seenOf({ id: 'a', type: 'note', path: '冰岛自驾.md' }, { ...opts, board: true })).toEqual({ see: '白板：冰岛自驾', hands: '挪卡片、排成列、合并' })
    expect(seenOf({ id: 'a', type: 'recent' }, opts)).toEqual({ see: '最近', hands: null })
    expect(seenOf(null, opts).see).toBe('空白页')
    const tabs = [{ id: 'a', type: 'archive' }, { id: 'c', type: 'oldimages', item: 'x' }] as const
    for (const t of tabs) expect(seenOf(t, opts).see).not.toContain('没打开笔记')
  })

  it('文件夹里几篇和文件夹首页头上同一个数：md、PDF、HTML 都算，子文件夹里的也算，文件夹本身不算', () => {
    const files = [f('周记', 'dir'), f('周记/2026-W47.md'), f('周记/旧', 'dir'), f('周记/旧/2026-W46.md'), f('周记/票.pdf', 'pdf'), f('随手记.md')]
    expect(folderCount('周记', files)).toBe(3)
    expect(folderCount('周记/旧', files)).toBe(1)
    expect(folderCount('没有的', files)).toBe(0)
  })
})

describe('发给 AI 的「当前标签」那一行', () => {
  const web = { open: false, url: null }
  it('文件夹：名字、路径、里面几篇', () => {
    expect(describeContext({ tab: { type: 'folder', title: '线代', path: '课程/线代', count: 4 }, web })).toBe('当前标签：文件夹「线代」的首页（课程/线代，里面4篇）\n右栏网页：没开')
  })
  it('别的页写它是什么（以前一律写「没有打开的标签」）；真没开标签才那么写', () => {
    expect(describeContext({ tab: { type: 'none', title: '最近' }, web }).split('\n')[0]).toBe('当前标签：最近')
    expect(describeContext({ tab: { type: 'none', title: '' }, web }).split('\n')[0]).toBe('当前标签：没有打开的标签')
    expect(describeContext({ tab: { type: 'note', title: '随手记', path: '随手记.md', mode: 'doc' }, web: { open: true, url: 'https://a.com' } })).toBe('当前标签：文档「随手记」（随手记.md）\n右栏网页：开着，https://a.com')
  })
})

describe('书摘（D 组小样「书摘：趣说明朝276年」）', () => {
  const tab = { id: 'a', type: 'note', path: '阅读/趣说明朝276年（微信读书出品）.md' } as const
  it('书名去掉「（微信读书出品）」这类尾巴；没有尾巴的照旧', () => {
    expect(bookName('趣说明朝276年（微信读书出品）')).toBe('趣说明朝276年')
    expect(bookName('三体 (全集)')).toBe('三体')
    expect(bookName('明朝那些事儿')).toBe('明朝那些事儿')
    // 整个名字就是括号：不去成空的
    expect(bookName('（无题）')).toBe('（无题）')
  })
  it('开着的是书摘：「看得到」写「书摘：书名」，对话胶囊也是短书名；能动手同文档', () => {
    expect(seenOf(tab, { ...opts, digest: true })).toEqual({ see: '书摘：趣说明朝276年', hands: '改写、插入、挪块' })
    expect(placeOf(tab, true)).toEqual({ key: 'file:阅读/趣说明朝276年（微信读书出品）.md', label: '趣说明朝276年' })
    // 不是书摘的文档照旧写全名
    expect(seenOf(tab, opts).see).toBe('文档：趣说明朝276年（微信读书出品）')
    expect(placeOf(tab).label).toBe('趣说明朝276年（微信读书出品）')
  })
})
