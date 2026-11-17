import { describe, expect, it } from 'vitest'
import { defaultLeft, dropLeft, leftJson, lookOf, moveLeft, normalizeLeft, putLeft, remapLeft, sameAsDefault, setLook, takeLeft } from '../src/shared/left'
import { normalizePins } from '../src/shared/sidebar'

describe('左栏：摘到活动栏的文件夹和文件夹的图标颜色（.canvas-notes/左栏.json）', () => {
  it('没设过：课程、收件箱在左边；写过空的「左边」就是都拿下来了', () => {
    expect(normalizeLeft(null)).toEqual({ left: ['课程', '收件箱'], looks: {} })
    expect(normalizeLeft({ 左边: [] }).left).toEqual([])
    expect(sameAsDefault(defaultLeft())).toBe(true)
  })

  it('手改坏的不认：跳出库的路径、. 开头的、重复的、不认识的颜色和图标名都丢掉', () => {
    const c = normalizeLeft({
      左边: ['写作', '../外面', '.git', '写作', '/绝对', '素材/冰岛旅行', 3],
      图标: { 写作: { icon: 'edit', color: 'orange' }, 生活: { icon: '<b>', color: '#ff0000' }, '../x': { icon: 'map' }, 书摘: { color: 'purple' } },
    })
    expect(c.left).toEqual(['写作', '素材/冰岛旅行'])
    expect(c.looks).toEqual({ 写作: { icon: 'edit', color: 'orange' }, 书摘: { color: 'purple' } })
  })

  it('放到左边、拿下来、上移下移、拖着排', () => {
    let c = putLeft(defaultLeft(), '写作')
    expect(c.left).toEqual(['课程', '收件箱', '写作'])
    expect(putLeft(c, '写作')).toBe(c)
    c = moveLeft(c, '写作', -1)
    expect(c.left).toEqual(['课程', '写作', '收件箱'])
    expect(moveLeft(c, '课程', -1)).toBe(c)
    expect(dropLeft(c, '收件箱', '课程').left).toEqual(['收件箱', '课程', '写作'])
    expect(dropLeft(c, '课程', null).left).toEqual(['写作', '收件箱', '课程'])
    expect(takeLeft(c, '课程').left).toEqual(['写作', '收件箱'])
  })

  it('设图标和颜色、恢复默认；没设过的用默认图标（课程和每门课是书架，收件箱是收件箱）', () => {
    let c = setLook(defaultLeft(), '素材/冰岛旅行', { icon: 'map', color: 'green' })
    expect(lookOf(c, '素材/冰岛旅行')).toEqual({ icon: 'map', color: '#3f8a6e' })
    c = setLook(c, '素材/冰岛旅行', null)
    expect(c.looks).toEqual({})
    expect(lookOf(c, '课程')).toEqual({ icon: 'folder-library', color: null })
    expect(lookOf(c, '课程/ecp').icon).toBe('folder-library')
    expect(lookOf(c, '收件箱').icon).toBe('inbox')
    expect(lookOf(c, '素材').icon).toBe('folder')
  })

  it('文件夹改名、删掉：左边和图标跟着换路径或拿掉', () => {
    const c = { left: ['课程', '素材/冰岛旅行', '素材/冰岛旅行/路线'], looks: { '素材/冰岛旅行': { icon: 'map' }, '素材/冰岛旅行/路线': { color: 'sky' as const } } }
    const ren = (p: string) => (p === '素材/冰岛旅行' || p.startsWith('素材/冰岛旅行/') ? '素材/冰岛' + p.slice('素材/冰岛旅行'.length) : undefined)
    expect(remapLeft(c, ren)).toEqual({ left: ['课程', '素材/冰岛', '素材/冰岛/路线'], looks: { '素材/冰岛': { icon: 'map' }, '素材/冰岛/路线': { color: 'sky' } } })
    const del = (p: string) => (p.startsWith('素材/冰岛旅行') ? null : undefined)
    expect(remapLeft(c, del)).toEqual({ left: ['课程'], looks: {} })
  })

  it('写进文件：中文键、两格缩进、换行结尾', () => {
    expect(leftJson(putLeft(defaultLeft(), '写作'))).toBe('{\n  "左边": [\n    "课程",\n    "收件箱",\n    "写作"\n  ],\n  "图标": {}\n}\n')
  })

  it('置顶.json 里文件夹写成「写作/」，和笔记一起认；跳出库的、. 开头的不认', () => {
    expect(normalizePins(['写作/', 'a.md', '../x/', '.git/', '素材/冰岛旅行/', '/', 'b'])).toEqual(['写作/', 'a.md', '素材/冰岛旅行/'])
  })
})
