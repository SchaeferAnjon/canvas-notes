// AI 回答用哪种语言（task-zojmg）：用户用什么语言问由代码看字判断，交给 AI 一句直接的话。
// 起因：让 AI 自己判断时，消息里软件加的几行全是中文，真 Claude 在英文界面把「123」答成中文、把中文问的答成英文
import { describe, expect, it } from 'vitest'
import { answerLine, answerRule, wroteIn } from '../src/shared/answer-lang'

describe('wroteIn：用户自己打的话是哪种语言', () => {
  it('看不出语言的（只有数字、符号，字太少，只有链接）是 null', () => {
    for (const s of ['123', '?', '①②', 'ok', '嗯', 'https://example.com/some/path', '[[会议记录]]', '`npm test`']) expect(wroteIn(s), s).toBeNull()
  })

  it('中文、英文、日文、韩文、别的文字', () => {
    expect(wroteIn('二加三等于几？一句话回答。')).toBe('zh')
    expect(wroteIn('What is two plus three? Answer in one short sentence.')).toBe('latin')
    expect(wroteIn('Wie geht es dir heute?')).toBe('latin')
    expect(wroteIn('これは何ですか')).toBe('ja')
    expect(wroteIn('이게 뭐예요')).toBe('ko')
    expect(wroteIn('Что это такое?')).toBe('other')
  })

  it('引的、贴的不算：引号里的、[[双链]]、链接、代码', () => {
    expect(wroteIn('“Dreaming” 是什么意思')).toBe('zh')
    expect(wroteIn('What does “梦游” mean here?')).toBe('latin')
    expect(wroteIn('总结一下 [[Weekly review]]')).toBe('zh')
    expect(wroteIn('看看 https://example.com/what-is-this-page')).toBe('zh')
    expect(wroteIn('Explain `const 名字 = 1` please')).toBe('latin')
  })

  it('夹着几个词的照主体；两种都不少的算 mixed，交给 AI 看语法', () => {
    expect(wroteIn('用 Python 写')).toBe('zh')
    expect(wroteIn('What does 梦游 mean?')).toBe('latin')
    expect(wroteIn('解释一下 attention is all you need 这篇')).toBe('mixed')
    expect(wroteIn('Summarize 会议记录 for me')).toBe('mixed')
  })
})

describe('answerRule：交给 AI 的那一句，用要答的那种语言写', () => {
  it('没有用户的话（命令、框一块问）或看不出：照界面语言，中文界面和以前一样是「用中文回答」', () => {
    expect(answerRule(undefined, 'zh')).toBe('用中文回答')
    expect(answerRule(undefined, 'en')).toBe('Answer in English')
    expect(answerRule('123', 'zh')).toBe('用中文回答')
    expect(answerRule('123', 'en')).toBe('Answer in English')
  })

  it('看得出是别的语言就照它', () => {
    expect(answerRule('二加三等于几？一句话回答。', 'en')).toBe('用中文回答')
    expect(answerRule('What is two plus three?', 'zh')).toBe('Answer in the language the user’s own words are written in (most likely English)')
    expect(answerRule('これは何ですか', 'zh')).toBe('Answer in Japanese, the language the user wrote in')
    expect(answerRule('解释一下 attention is all you need 这篇', 'en')).toContain('句子主体是中文就用中文答')
  })

  it('answerLine：每条消息开头的【语言】，标签不翻，句号跟着那一句的语言', () => {
    expect(answerLine('123', 'en')).toBe('【语言】Answer in English.')
    expect(answerLine('123', 'zh')).toBe('【语言】用中文回答。')
    expect(answerLine('二加三等于几？', 'en')).toBe('【语言】用中文回答。')
  })
})
