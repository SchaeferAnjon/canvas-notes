/** 稍后读写成画布今日的待办行：加、勾上、再加改回没勾、认画布今日里勾上的 */
import { scanTasks } from '@cn/tasks'
import { describe, expect, it } from 'vitest'
import { addLater, doneLater, itemIdOf, itemUrl, LATER_HEAD, laterLine, laterTasks } from '../src/later'

describe('稍后读进画布今日', () => {
  it('一行的写法：@cn/tasks 认得出的待办，标题是「读：」加链到画布订阅那一篇的链接', () => {
    const l = laterLine('a_1b2c', '提示词 [缓存] 省下的钱')
    expect(l).toBe('- [ ] 读：[提示词 缓存 省下的钱](canvas-feeds://item/a_1b2c)')
    const t = scanTasks(l)[0]!
    expect(t.task.title).toBe('读：[提示词 缓存 省下的钱](canvas-feeds://item/a_1b2c)')
    expect(itemIdOf(itemUrl('a_1b2c'))).toBe('a_1b2c')
    expect(itemIdOf('canvas-feeds://item/../x')).toBeNull()
    expect(itemIdOf('https://example.test/')).toBeNull()
  })

  it('没有这一篇时新建；同一篇不加第二行；读完勾上带今天；又点稍后读改回没勾', () => {
    let text = addLater(null, 'a_1', '第一篇', '2026-11-25')
    expect(text).toBe(`${LATER_HEAD}- [ ] 读：[第一篇](canvas-feeds://item/a_1)\n`)
    text = addLater(text, 'a_2', '第二篇', '2026-11-25')
    expect(addLater(text, 'a_1', '第一篇', '2026-11-25')).toBe(text)
    expect(laterTasks(text).map((x) => x.id)).toEqual(['a_1', 'a_2'])
    text = doneLater(text, 'a_1', '2026-11-25')
    expect(text).toContain('- [x] 读：[第一篇](canvas-feeds://item/a_1) ✅ 2026-11-25\n- [ ] 读：[第二篇]')
    expect(laterTasks(text).filter((x) => x.done).map((x) => x.id)).toEqual(['a_1'])
    text = addLater(text, 'a_1', '第一篇', '2026-11-26')
    expect(text).toContain('- [ ] 读：[第一篇](canvas-feeds://item/a_1)\n')
  })

  it('用户自己在这篇里写的字、别的待办都不动', () => {
    const mine = '# 稍后读\n\n我自己的话。\n\n- [ ] 买菜\n'
    const text = addLater(mine, 'a_9', '一篇', '2026-11-25')
    expect(text).toBe('# 稍后读\n\n我自己的话。\n\n- [ ] 买菜\n- [ ] 读：[一篇](canvas-feeds://item/a_9)\n')
    expect(doneLater(text, 'a_9', '2026-11-25')).toContain('- [ ] 买菜\n- [x] 读：')
  })
})
