/**
 * bug 一批 1125b 之 10：右栏 AI 顶上「这是在《s》问的 · 切到《情绪识别…》」。
 * 存的地方名是全的（胶囊上就是「study project 2」）；是那一行排不开：右边「切到《X》的 AI ⌥⌘J」按钮 flex: none 不让，
 * 「这是在《」「》问的」也不让，地方名只剩几像素。这里守着：名字取的是全名，按钮能缩、左边那句给按钮只留最小的一截，窄时按钮换短句。
 * 真排出来露多宽在 e2e/ai-away-name.spec.ts 量。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { placeOf } from '../src/renderer/ai-place'

const css = readFileSync(join(__dirname, '../src/renderer/ai.css'), 'utf8')
/** 这个选择器那一块里写的声明（同一个选择器写了几块的都算上，后写的盖前面的） */
function rule(sel: string): Record<string, string> {
  const out: Record<string, string> = {}
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const m of css.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g')))
    for (const d of m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
      const i = d.indexOf(':')
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim()
    }
  return out
}

describe('「这是在《X》问的」那一行', () => {
  it('地方名取的是全名，不在取名时截', () => {
    expect(placeOf({ id: 'a', type: 'folder', folder: '项目/study project 2' }).label).toBe('study project 2')
    const long = '情绪识别与可穿戴生理信号多模态数据集调研笔记第二版'
    expect(placeOf({ id: 'a', type: 'note', path: `项目/study project 2/${long}.md` }).label).toBe(long)
  })

  it('右边「切到…⌥⌘J」按钮放不下时能缩（以前 flex: none，名字被挤成一个字母）', () => {
    expect(rule('.away button').flex).toBe('none')
    const stay = rule('.away.stay button')
    expect(stay.flex).toBe('0 1 auto')
    expect(stay['min-width']).toBe('0')
  })

  it('左边那句先拿够，只给按钮留最小一截；名字放不下才截、带省略号', () => {
    const tx = rule('.away.stay .tx')
    expect(tx.flex).toBe('none')
    expect(tx['max-width']).toMatch(/^calc\(100% - /)
    const nm = rule('.away .tx .nm')
    expect(nm).toMatchObject({ overflow: 'hidden', 'text-overflow': 'ellipsis', 'min-width': '0' })
  })

  it('右栏窄时按钮换短句（data-short 画出来），不截动作的字、藏起快捷键', () => {
    const narrow = css.slice(css.indexOf('@container (max-width: 340px)'))
    expect(narrow).toMatch(/\.away\.stay button::before\s*\{\s*content: attr\(data-short\)/)
    expect(narrow).toMatch(/\.away\.stay button \.lb,\s*\.away\.stay button \.k\s*\{\s*display: none/)
    expect(rule('.away.stay')['container-type']).toBe('inline-size')
  })
})
