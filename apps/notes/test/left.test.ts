import { describe, expect, it } from 'vitest'
import { CATEGORY_NAMES } from '../src/shared/categories'
import { cleanLeft, defaultLeft, dropLeft, leftJson, lookOf, moveLeft, normalizeLeft, ownLeft, presetsOn, putLeft, remapLeft, sameAsDefault, setLook, setPresets, shownLeft, takeLeft } from '../src/shared/left'
import { groupLeft } from '../src/shared/categories'
import { normalizePins } from '../src/shared/sidebar'

describe('左栏：摘到活动栏的文件夹和文件夹的图标颜色（.canvas-notes/左栏.json）', () => {
  it('没设过：整套顶级分类摘在左边（收件箱、课程、阅读、剪藏、周记、写作、项目、生活）；新版写过空的「左边」就是都拿下来了', () => {
    expect(normalizeLeft(null)).toEqual({ left: ['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活'], looks: {} })
    expect(normalizeLeft({ 版本: 2, 左边: [] }).left).toEqual([])
    expect(sameAsDefault(defaultLeft())).toBe(true)
  })

  it('分类出来以前的老文件（没写版本）：整套分类补上来排在前面，以前自己摘的别的文件夹接在后面；新版的拿下来的分类不会自己回来', () => {
    expect(normalizeLeft({ 左边: ['课程', '收件箱', '阅读/人类简史'] }).left).toEqual([...CATEGORY_NAMES, '阅读/人类简史'])
    const off = takeLeft(normalizeLeft(null), '写作')
    expect(off.left).not.toContain('写作')
    expect(cleanLeft(off).left).toEqual(off.left)
    expect(normalizeLeft(JSON.parse(leftJson(off))).left).toEqual(off.left)
  })

  it('手改坏的不认：跳出库的路径、. 开头的、重复的、不认识的颜色和图标名都丢掉', () => {
    const c = normalizeLeft({
      版本: 2,
      左边: ['写作', '../外面', '.git', '写作', '/绝对', '素材/冰岛旅行', 3],
      图标: { 写作: { icon: 'edit', color: 'orange' }, 生活: { icon: '<b>', color: '#ff0000' }, '../x': { icon: 'map' }, 书摘: { color: 'purple' } },
    })
    expect(c.left).toEqual(['写作', '素材/冰岛旅行'])
    expect(c.looks).toEqual({ 写作: { icon: 'edit', color: 'orange' }, 书摘: { color: 'purple' } })
  })

  it('放到左边、拿下来、上移下移、拖着排（自己摘的文件夹在同一段）', () => {
    let c = putLeft({ left: ['写作/游记', '剪藏/冰岛旅行'], looks: {} }, '项目/搬家')
    expect(c.left).toEqual(['写作/游记', '剪藏/冰岛旅行', '项目/搬家'])
    expect(putLeft(c, '项目/搬家')).toBe(c)
    c = moveLeft(c, '项目/搬家', -1)
    expect(c.left).toEqual(['写作/游记', '项目/搬家', '剪藏/冰岛旅行'])
    expect(moveLeft(c, '写作/游记', -1)).toBe(c)
    expect(dropLeft(c, '剪藏/冰岛旅行', '写作/游记').left).toEqual(['剪藏/冰岛旅行', '写作/游记', '项目/搬家'])
    expect(dropLeft(c, '写作/游记', null).left).toEqual(['项目/搬家', '剪藏/冰岛旅行', '写作/游记'])
    expect(takeLeft(c, '写作/游记').left).toEqual(['项目/搬家', '剪藏/冰岛旅行'])
  })

  it('上移、下移、拖着排只在活动栏画出来的那一段里挪（收件箱 | 读进来的 | 自己写的 | 自己摘的）', () => {
    let c = putLeft(defaultLeft(), '写作/游记')
    expect(c.left).toEqual(['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活', '写作/游记'])
    // 周记是「自己写的」那段第一个：上移不跨到剪藏那段
    expect(moveLeft(c, '周记', -1)).toBe(c)
    expect(moveLeft(c, '写作', -1).left.slice(4, 8)).toEqual(['写作', '周记', '项目', '生活'])
    // 生活下移：后面只有自己摘的，不挪；自己摘的只有一个，上移下移都不动
    expect(moveLeft(c, '生活', 1)).toBe(c)
    expect(moveLeft(c, '写作/游记', -1)).toBe(c)
    c = putLeft(c, '剪藏/冰岛旅行')
    expect(moveLeft(c, '剪藏/冰岛旅行', -1).left.slice(-2)).toEqual(['剪藏/冰岛旅行', '写作/游记'])
    // 拖：拖到别的段上不挪，同一段里照放
    expect(dropLeft(c, '写作', '课程')).toBe(c)
    expect(dropLeft(c, '生活', '周记').left.slice(4, 8)).toEqual(['生活', '周记', '写作', '项目'])
    // 有人把分类拿下来又放回去（排到了自己摘的后面）：分段照旧，上移跳过自己摘的，挪到同段的上一个前面
    c = putLeft(takeLeft(c, '课程'), '课程')
    expect(groupLeft(c.left)[1]).toEqual(['阅读', '剪藏', '课程'])
    expect(groupLeft(moveLeft(c, '课程', -1).left)[1]).toEqual(['阅读', '课程', '剪藏'])
  })

  it('设图标和颜色、恢复默认；没设过的用默认图标（课程和每门课是书架，收件箱是收件箱）', () => {
    let c = setLook(defaultLeft(), '素材/冰岛旅行', { icon: 'map', color: 'green' })
    expect(lookOf(c, '素材/冰岛旅行')).toEqual({ icon: 'map', color: '#3f8a6e' })
    c = setLook(c, '素材/冰岛旅行', null)
    expect(c.looks).toEqual({})
    // 分类有自己的图标和颜色（课程书架天青、收件箱石板、阅读书绿、剪藏书签紫…），每门课跟课程一样
    expect(lookOf(c, '课程')).toEqual({ icon: 'folder-library', color: '#2e7fa3' })
    expect(lookOf(c, '课程/ecp')).toEqual({ icon: 'folder-library', color: '#2e7fa3' })
    // 阅读里一本书一个文件夹：书、绿；再往下一层是普通文件夹
    expect(lookOf(c, '阅读/人类简史')).toEqual({ icon: 'book', color: '#3f8a6e' })
    expect(lookOf(c, '阅读/人类简史/摘录')).toEqual({ icon: 'folder', color: null })
    expect(lookOf(c, '收件箱')).toEqual({ icon: 'inbox', color: '#5f7380' })
    expect(lookOf(c, '阅读')).toEqual({ icon: 'book', color: '#3f8a6e' })
    expect(lookOf(c, '剪藏')).toEqual({ icon: 'bookmark', color: '#7b62a8' })
    expect(lookOf(c, '素材')).toEqual({ icon: 'folder', color: null })
  })

  it('文件夹改名、删掉：左边和图标跟着换路径或拿掉', () => {
    const c = { left: ['课程', '素材/冰岛旅行', '素材/冰岛旅行/路线'], looks: { '素材/冰岛旅行': { icon: 'map' }, '素材/冰岛旅行/路线': { color: 'sky' as const } } }
    const ren = (p: string) => (p === '素材/冰岛旅行' || p.startsWith('素材/冰岛旅行/') ? '素材/冰岛' + p.slice('素材/冰岛旅行'.length) : undefined)
    expect(remapLeft(c, ren)).toEqual({ left: ['课程', '素材/冰岛', '素材/冰岛/路线'], looks: { '素材/冰岛': { icon: 'map' }, '素材/冰岛/路线': { color: 'sky' } } })
    const del = (p: string) => (p.startsWith('素材/冰岛旅行') ? null : undefined)
    expect(remapLeft(c, del)).toEqual({ left: ['课程'], looks: {} })
  })

  it('写进文件：版本、中文键、两格缩进、换行结尾', () => {
    expect(leftJson({ left: ['课程', '收件箱', '写作'], looks: {} })).toBe('{\n  "版本": 2,\n  "左边": [\n    "课程",\n    "收件箱",\n    "写作"\n  ],\n  "图标": {}\n}\n')
  })

  it('「用预设的分类」关掉（task-wniqx）：图标栏只剩收件箱和自己放上去的几格，收起的分类记在文件里，再打开放回原处', () => {
    let c = putLeft(takeLeft(defaultLeft(), '周记'), '读书笔记')
    expect(presetsOn(c)).toBe(true)
    const off = setPresets(c, false)
    expect(presetsOn(off)).toBe(false)
    expect(shownLeft(off)).toEqual(['收件箱', '读书笔记'])
    expect(groupLeft(shownLeft(off), false)).toEqual([['收件箱'], ['读书笔记']])
    // 自己放上去的几格：不算分类（收件箱也不算）
    expect(ownLeft(c)).toEqual(['读书笔记'])
    // 写进文件：多两项，读回来一样；关着时拖着排、上移下移不分「读进来的 / 自己写的」
    const json = leftJson(off)
    expect(JSON.parse(json)).toMatchObject({ 预设分类: false, 收起的分类: ['课程', '阅读', '剪藏', '写作', '项目', '生活'] })
    expect(normalizeLeft(JSON.parse(json))).toEqual(off)
    // 关着时把「课程」当普通文件夹放到左边：和自己的文件夹一段，能和它换顺序
    c = putLeft(off, '课程')
    expect(shownLeft(c)).toEqual(['收件箱', '读书笔记', '课程'])
    expect(dropLeft(c, '课程', '读书笔记').left).toEqual(['收件箱', '课程', '读书笔记'])
    expect(moveLeft(c, '课程', -1).left).toEqual(['收件箱', '课程', '读书笔记'])
    // 再打开：收起的放回来（拿下来的周记不回来），按分段画回原样
    const on = setPresets(c, true)
    expect(presetsOn(on)).toBe(true)
    expect(groupLeft(shownLeft(on))).toEqual([['收件箱'], ['课程', '阅读', '剪藏'], ['写作', '项目', '生活'], ['读书笔记']])
    expect(leftJson(on)).not.toContain('预设分类')
    // 关着时分类的图标、颜色是普通文件夹；自己设过的照旧
    expect(lookOf(off, '课程')).toEqual({ icon: 'folder', color: null })
    expect(lookOf(off, '收件箱')).toEqual({ icon: 'inbox', color: null })
    expect(lookOf(setLook(off, '阅读', { icon: 'book' }), '阅读')).toEqual({ icon: 'book', color: null })
    expect(lookOf(off, '课程/ecp')).toEqual({ icon: 'folder', color: null })
    expect(lookOf(off, '课程/ecp/讲义')).toEqual({ icon: 'folder', color: null })
    // 文件夹改名、删掉、放回：关着的状态不丢
    expect(presetsOn(remapLeft(off, () => undefined))).toBe(false)
    expect(presetsOn(cleanLeft(off))).toBe(false)
  })

  it('图标栏上自己放的几格能拖到任意一格前面或最后，从树里拖来的文件夹放到第几格就在第几格', () => {
    const c = { left: ['收件箱', '课程', '读书笔记', '工作'], looks: {} }
    expect(putLeft(c, '灵感', '工作').left).toEqual(['收件箱', '课程', '读书笔记', '灵感', '工作'])
    expect(putLeft(c, '灵感', null).left).toEqual(['收件箱', '课程', '读书笔记', '工作', '灵感'])
    expect(putLeft(c, '工作', '读书笔记')).toBe(c)
  })

  it('置顶.json 里文件夹写成「写作/」，和笔记一起认；跳出库的、. 开头的不认', () => {
    expect(normalizePins(['写作/', 'a.md', '../x/', '.git/', '素材/冰岛旅行/', '/', 'b'])).toEqual(['写作/', 'a.md', '素材/冰岛旅行/'])
  })
})
