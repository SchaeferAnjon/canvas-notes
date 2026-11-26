import { describe, expect, it } from 'vitest'
import { cardText } from '../src/renderer/doc-board/card-text'

describe('cardText：白板上改完一张卡，最后几下回车留下的尾巴不进文件', () => {
  it('待办打完最后一项按了回车：空的一项去掉', () => {
    expect(cardText('- [ ] 一项\n- [ ] 二项\n- [ ] ')).toBe('- [ ] 一项\n- [ ] 二项')
    expect(cardText('- [ ] 一项\n- [x] ')).toBe('- [ ] 一项')
    expect(cardText('- 甲\n- ')).toBe('- 甲')
    expect(cardText('1. 甲\n2. ')).toBe('1. 甲')
  })

  it('一句话后面按了几下回车：空行去掉', () => {
    expect(cardText('你好\nsecond\n\n')).toBe('你好\nsecond')
    expect(cardText('一段\n  \n\t\n')).toBe('一段')
  })

  it('引文、提示块末尾空的「> 」去掉', () => {
    expect(cardText('> 一段引文\n> ')).toBe('> 一段引文')
    expect(cardText('> [!note] 提示\n> 正文\n>\n\n')).toBe('> [!note] 提示\n> 正文')
  })

  it('中间的空行、空的一项不动；有字的最后一行不动', () => {
    expect(cardText('- [ ] 一项\n- [ ] \n- [ ] 三项')).toBe('- [ ] 一项\n- [ ] \n- [ ] 三项')
    expect(cardText('甲\n\n乙')).toBe('甲\n\n乙')
    expect(cardText('```js\nlet a = 1\n```')).toBe('```js\nlet a = 1\n```')
    expect(cardText('末尾两个空格换行  ')).toBe('末尾两个空格换行  ')
  })

  it('整张都是空的：交回空串（调的人当成一个字没写）', () => {
    expect(cardText('- [ ] ')).toBe('')
    expect(cardText('\n\n')).toBe('')
  })
})
