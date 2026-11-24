// 旁支里问一句时交给 AI 的话（task-4edsc：AI 对话、文档里 AI 讲解块的旁支）
import { describe, expect, it } from 'vitest'
import { sideTurnPrompt } from '@cn/ai-engines'
import { sideName } from '../src/renderer/side/name'

describe('旁支的话', () => {
  it('对话里的第一问：说是旁支、那一轮问的原话、选中的那句；接着问只说接着这条旁支；最后一行「用户说：」后面是原话', () => {
    expect(sideTurnPrompt({ first: true, quote: '周三开始每天早上跑步。', ask: '把这周的周记总结成三句话', question: '几点跑的？' })).toBe(
      '（这是一条旁支：他在你前面的一个回答里选中了一句另问，问完回到主对话，主对话照旧。）\n那一轮他问的是：把这周的周记总结成三句话\n他选中的那句：「周三开始每天早上跑步。」\n用户说：\n几点跑的？',
    )
    expect(sideTurnPrompt({ first: false, quote: '周三开始每天早上跑步。', question: '下周呢？' })).toBe('（接着这条旁支问，问的还是「周三开始每天早上跑步。」这句。）\n用户说：\n下周呢？')
  })
  it('文档里的讲解：说在哪选的、讲解在前面', () => {
    expect(sideTurnPrompt({ first: true, quote: 'V 加起来', where: '文档《第5讲》里 AI 写的讲解', question: '讲讲这句' })).toBe(
      '（这是一条旁支：他在文档《第5讲》里 AI 写的讲解里选中了一句另问；那段讲解在前面。）\n他选中的那句：「V 加起来」\n用户说：\n讲讲这句',
    )
  })
})

describe('旁支的名字（原型 nameOf）', () => {
  it('改过的；问的第一句（去掉末尾的问号，16 字）；「讲讲这句」用那一句的头 8 个字；还没问过是「新旁支」', () => {
    const msgs = (q: string) => [{ role: 'user', text: q }]
    expect(sideName({ name: '改过', quote: 'x', msgs: msgs('问') })).toBe('改过')
    expect(sideName({ quote: 'x', msgs: msgs('为什么是基向量？') })).toBe('为什么是基向量')
    expect(sideName({ quote: 'x', msgs: msgs('一二三四五六七八九十一二三四五六七八') })).toBe('一二三四五六七八九十一二三四五六…')
    expect(sideName({ quote: '这也是为什么后来挖矿全换成了 ASIC。', msgs: msgs('讲讲这句') })).toBe('这也是为什么后来…')
    expect(sideName({ quote: '列就是基向量去哪', msgs: msgs('讲讲这句') })).toBe('列就是基向量去哪')
    expect(sideName({ quote: 'x', msgs: [] })).toBe('新旁支')
  })

  it('英文按整词截，连省略号 18 个字符（选的那一句、问的第一句都是）；中文照旧按字截；空着问 Explain this 也用那一句', () => {
    const msgs = (q: string) => [{ role: 'user', text: q }]
    const quote = 'Each word then mixes the other words in proportion to those weights.'
    expect(sideName({ quote, msgs: msgs('讲讲这句') })).toBe('Each word then…')
    expect(sideName({ quote, msgs: msgs('Explain this') })).toBe('Each word then…')
    expect(sideName({ quote: 'x', msgs: msgs('Why do the weights add up to one?') })).toBe('Why do the…')
    expect(sideName({ quote: 'x', msgs: msgs('Why softmax?') })).toBe('Why softmax')
    expect(sideName({ quote: 'Short quote.', msgs: msgs('讲讲这句') })).toBe('Short quote.')
    // 一个词就超了才在词中间截；截在逗号后面的把逗号去掉
    expect(sideName({ quote: 'Supercalifragilisticexpialidocious words', msgs: msgs('讲讲这句') })).toBe('Supercalifragilis…')
    expect(sideName({ quote: 'One, two, three, four, five, six', msgs: msgs('讲讲这句') })).toBe('One, two, three…')
    // 夹着汉字的按中文规矩
    expect(sideName({ quote: 'Roofline 的拐点是算力和带宽', msgs: msgs('讲讲这句') })).toBe('Roofline…')
  })
})
