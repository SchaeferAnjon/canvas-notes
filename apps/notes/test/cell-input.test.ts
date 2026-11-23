/** 数字格自己认数（task-cle3x）：写进文件的数和 packages/format 读数用的一样；不是数的不收 */
import { describe, expect, it } from 'vitest'
import { numText } from '../src/renderer/base/cell-input'

describe('numText', () => {
  it('数照原样收，前后空格去掉', () => {
    expect(numText('2011')).toBe('2011')
    expect(numText(' -3.25 ')).toBe('-3.25')
    expect(numText('0')).toBe('0')
  })
  it('空着给空（清掉这一格）', () => {
    expect(numText('')).toBe('')
    expect(numText('   ')).toBe('')
  })
  it('中文输入法打出来的全角数字、中文标点下的「。」换成半角', () => {
    expect(numText('２０１３')).toBe('2013')
    expect(numText('－１．５')).toBe('-1.5')
    expect(numText('3。5')).toBe('3.5')
  })
  it('不是数的不收：字母、中文数字、半截、千分位、科学记数', () => {
    for (const s of ['20x3', 'abc', '二〇一一', '-', '1.', '.5', '1,000', '1e3', '+5', '2011 年']) expect(numText(s)).toBeNull()
  })
})
