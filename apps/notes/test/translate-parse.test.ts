// r172「AI 翻译的回答内容不对，然后无法解析」：模型不照「一行一个 JSON」回（前后多说话、一行几个、一个拆成几行、带编号、包进数组）时，
// 以前整批算「格式不对」、字幕只剩原文一行。现在照花括号把每个对象拆出来；边生成边拆也认（一块块吐字的假引擎）。
import { describe, expect, it } from 'vitest'
import { parseWhole, TranslationCache, Translator, type AskFn } from '../src/main/plugins/translate/translator'

const ITEMS = [
  { id: 101, text: '我也希望与中国下一代领导人' },
  { id: 102, text: '建立新的联系' },
  { id: 103, text: '两国建交30多年了' },
]
const WANT: [number, string | null][] = [
  [101, 'I also hope, with the next generation of Chinese leaders,'],
  [102, 'to build new ties.'],
  [103, 'The two countries have had diplomatic ties for over 30 years.'],
]
const tr = (id: number) => WANT.find(([i]) => i === id)![1]!
const obj = (id: number) => JSON.stringify({ id, text: tr(id) })

/** 会回多余话的假引擎：照 shape 排；一次吐 7 个字（像真的流式） */
function chatty(shape: (items: number[]) => string): { ask: AskFn; calls: () => number } {
  let n = 0
  return {
    calls: () => n,
    ask: async (_s, prompt, _signal, onText) => {
      n++
      const items = (JSON.parse(prompt.split('\n').pop()!) as { id: number }[]).map((i) => i.id)
      const out = shape(items)
      for (let i = 0; i < out.length; i += 7) onText(out.slice(i, i + 7))
      return out
    },
  }
}

const SHAPES: [string, (ids: number[]) => string][] = [
  ['前后夹着话', (ids) => `好的，下面是译文：\n${ids.map(obj).join('\n')}\n以上就是全部译文，希望有帮助！`],
  ['一个对象拆成几行（缩进排版）', (ids) => ids.map((id) => JSON.stringify({ id, text: tr(id) }, null, 2)).join('\n')],
  ['一行几个，用逗号或空格隔开', (ids) => `${obj(ids[0]!)}, ${obj(ids[1]!)} ${obj(ids[2]!)}`],
  ['每行前面带编号', (ids) => ids.map((id, i) => `${i + 1}. ${obj(id)}`).join('\n')],
  ['前面一句话再接一行数组', (ids) => `Here are the translations: [${ids.map(obj).join(',')}]`],
  ['代码块里的缩进数组', (ids) => '```json\n' + JSON.stringify(ids.map((id) => ({ id: String(id), text: tr(id) })), null, 2) + '\n```'],
  ['用 translation 当键', (ids) => ids.map((id) => JSON.stringify({ id, translation: tr(id) })).join('\n')],
  ['译文里有花括号和引号', (ids) => ids.map((id) => JSON.stringify({ id, text: tr(id) })).join('\n').replace('build new ties', 'build {new} \\"ties\\"')],
]

describe('翻译：模型不照格式回也拆得出来', () => {
  for (const [name, shape] of SHAPES) {
    it(name, async () => {
      const eng = chatty(shape)
      const t = new Translator(eng.ask, new TranslationCache(null))
      const got = new Map<number, string | null>()
      await t.translate(ITEMS, 'en', (id, text) => got.set(id, text), new AbortController().signal)
      // 一次就拆全了：没有因为「漏段」再问一遍
      expect(eng.calls()).toBe(1)
      expect([...got.keys()].sort()).toEqual([101, 102, 103])
      for (const [id, text] of got) expect(text, `第 ${id} 段`).toBeTruthy()
      expect(got.get(101)).toBe(tr(101))
      expect(got.get(103)).toBe(tr(103))
    })
  }

  it('整段拆：坏了的一段跳过，后面的照拆；{"编号":"译文"} 照旧认', () => {
    expect(parseWhole(`{"id":1,"text":"一"}\n{"id":2,"text":"二" oops}\n{"id":3,"text":"三"}`)).toEqual(
      new Map([
        [1, '一'],
        [3, '三'],
      ]),
    )
    expect(parseWhole('{"1":"一","2":"二"}')).toEqual(
      new Map([
        [1, '一'],
        [2, '二'],
      ]),
    )
    expect(parseWhole('好的，我来翻译。')).toEqual(new Map())
  })

  it('真的漏了一段：照旧再问一次，还漏报「格式不对」', async () => {
    const eng = chatty((ids) => `Sure!\n${ids.filter((id) => id !== 102).map(obj).join('\n')}`)
    const t = new Translator(eng.ask, new TranslationCache(null))
    const errs: string[] = []
    await t.translate(ITEMS, 'en', (id, text, e) => text === null && errs.push(`${id}:${e?.code}`), new AbortController().signal)
    expect(eng.calls()).toBe(2)
    expect(errs).toEqual(['102:bad-output'])
  })
})
