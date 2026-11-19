import { describe, expect, test } from 'vitest'
import { checkMaterials, countLine, imageNames, markOf, type Material, numberOf, renumberMarks, shiftMarks, withMaterials } from '../src/shared/materials'

const IMG = '0b9d1c62-5a3e-4c1f-9f7a-1d2e3f4a5b6c.png'

describe('输入框里的材料（多段引用方向 B）', () => {
  test('编号 ①…⑳', () => {
    expect(markOf(1)).toBe('①')
    expect(markOf(20)).toBe('⑳')
    expect(markOf(21)).toBe('')
    expect(numberOf('③')).toBe(3)
    expect(numberOf('3')).toBe(0)
  })

  test('删掉一块：它的编号去掉，后面的往前补，光标跟着挪', () => {
    // ①这句和②有关？③这图④，删掉第 2 块
    const r = renumberMarks('①这句和②有关？③这图④', [1, 0, 2, 3])
    expect(r.text).toBe('①这句和有关？②这图③')
    // 原来光标在「有关？」后面（第 8 个字后），删掉的 ② 在它前面：往前挪一格
    expect(r.at(8)).toBe(7)
    expect(r.at(2)).toBe(2)
  })

  test('拖着换顺序：第 3 块拖到最前，字里的编号跟着它走', () => {
    expect(renumberMarks('①这句和②有关？③这图④', [2, 3, 1, 4]).text).toBe('②这句和③有关？①这图④')
  })

  test('比块数大的编号（自己打的）不动；排着的那一问退回来时编号往后挪', () => {
    expect(renumberMarks('①和⑨', [0]).text).toBe('和⑨')
    expect(shiftMarks('①看②', 2, 3)).toBe('④看⑤')
  })

  test('交给 AI 的话：字里照旧是 ①②，材料按同一套编号一行一块（图也叫「图②」），让 AI 提材料时用编号说，不说「第几张」', () => {
    const mats: Material[] = [
      { kind: 'image', name: IMG, src: '粘贴的图' },
      { kind: 'quote', text: '这是讲解', src: 'AI 的回答 · 第 1 页' },
      { kind: 'image', name: IMG, src: '第 2 页 · 我框的', page: 2 },
    ]
    const head = '我引用的材料（字里的 ①② 是它们的位置。回答里提到哪一块就用它的编号说，比如「引文②」「图①」，不要说「第几张图」「第几段」）：'
    expect(withMaterials('这句和②有关？①这图③', mats)).toBe(
      `这句和②有关？①这图③\n\n${head}\n① 图①（粘贴的图；附图里排第 1）\n② 引文②「这是讲解」（AI 的回答 · 第 1 页）\n③ 图③（第 2 页 · 我框的；附图里排第 2）`,
    )
    // 读 PDF 框的那块已经是附图里的第 1 张：材料里的图从第 2 排起
    expect(withMaterials('①', [mats[0]!], 1)).toBe(`①\n\n${head}\n① 图①（粘贴的图；附图里排第 2）`)
    expect(withMaterials('只有字', undefined)).toBe('只有字')
    expect(withMaterials('只有字', [])).toBe('只有字')
    expect(countLine(mats)).toBe('1段引用、2张图')
    expect(countLine([mats[1]!])).toBe('1段引用')
    expect(imageNames(mats)).toEqual([IMG, IMG])
  })

  test('主进程收到的材料查一遍：图只认 pasted/ 里的名字，来源、原文有长度上限', () => {
    expect(checkMaterials(undefined)).toBeUndefined()
    expect(checkMaterials([{ kind: 'quote', text: '一段', src: '《甲》' }, { kind: 'image', name: IMG, src: '粘贴的图', page: 3 }])).toEqual([
      { kind: 'quote', text: '一段', src: '《甲》' },
      { kind: 'image', name: IMG, src: '粘贴的图', page: 3 },
    ])
    expect(() => checkMaterials([{ kind: 'image', name: '../../etc/passwd', src: 'x' }])).toThrow('引用的材料不对')
    expect(() => checkMaterials([{ kind: 'quote', text: 1, src: 'x' }])).toThrow('引用的材料不对')
    expect(() => checkMaterials('不是数组')).toThrow('引用的材料不对')
    expect(() => checkMaterials(Array.from({ length: 21 }, () => ({ kind: 'quote', text: 'a', src: 'b' })))).toThrow('引用的材料不对')
  })
})
