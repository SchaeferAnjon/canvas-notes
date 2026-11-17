import { describe, expect, it } from 'vitest'
import { nameNotice, safeName } from '../src/shared/file-name'

describe('起名后底部说的那句', () => {
  it('原样存下：不说话', () => {
    expect(nameNotice('冰岛机票', '冰岛机票', '条')).toBeNull()
    expect(nameNotice('  两边空格 ', '两边空格', '篇')).toBeNull()
  })

  it('只是去掉了不能当文件名的字：说清哪几个字、换成了什么，不说重名', () => {
    expect(nameNotice('为什么?', '为什么', '篇')).toBe('「?」不能用在文件名里，已换成「为什么」')
    expect(nameNotice('冰岛:机票?', '冰岛 机票', '条')).toBe('「:」「?」不能用在文件名里，已换成「冰岛 机票」')
    expect(nameNotice('机票/酒店', '机票 酒店', '条')).toBe('「/」不能用在文件名里，已换成「机票 酒店」')
  })

  it('标题跟着改名时 / : 先换成「-」：按传进来的 clean 比', () => {
    expect(nameNotice('a/b:c?', 'a-b-c', '篇', safeName('a-b-c?'))).toBe('「/」「:」「?」不能用在文件名里，已换成「a-b-c」')
  })

  it('去掉了字又撞了名：两样都说', () => {
    expect(nameNotice('为什么?', '为什么 2', '篇')).toBe('「?」不能用在文件名里，已换成「为什么 2」（「为什么」已经有了）')
  })

  it('真撞了名：说已经有', () => {
    expect(nameNotice('慢慢走', '慢慢走 2', '篇')).toBe('已经有一篇叫「慢慢走」了，这篇存成「慢慢走 2」')
    expect(nameNotice('已有一条', '已有一条 2', '条')).toBe('已经有一条叫「已有一条」了，这条存成「已有一条 2」')
  })
})
