// 出卡（task-tz7y3）：卡的字怎么读、怎么判重、怎么核 ChatCards 的规矩；交给 AI 的规矩和 anki-learn 的原话一字不差；笔记里每一问对得上身份
import { cardKey, cardProblems, cardText, doubtItems, parseCardLines, plainLength, turnIds } from '@cn/format'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { L5, L5_SECTIONS } from '../e2e/fixtures/anki'
import { ANKI_LEARN_RULES, CARD_SYSTEM, cardMaterial, READING_RULES } from '../src/main/reading/card-prompt'

describe('出卡规矩和 ChatCards 一致', () => {
  it('交给 AI 的话里有 ChatCards 那四条原话和读 PDF 的补充，一问一行 JSON', () => {
    for (const r of [...ANKI_LEARN_RULES, ...READING_RULES]) expect(CARD_SYSTEM).toContain(`- ${r}`)
    expect(CARD_SYSTEM).toContain('{"id":"编号","q":"问题","a":"答案","more":')
  })
  // ChatCards（原名 Anki Learn，2026-11-22 改名开源）：仓库、模块名改没改都找得到
  const swift = ['anki-learn', 'chatcards', 'ChatCards'].flatMap((d) => ['AnkiLearnCore', 'ChatCardsCore'].map((m) => join(homedir(), 'Documents/Projects', d, 'Core/Sources', m, 'CardMaker.swift'))).find((f) => existsSync(f)) ?? ''
  it.skipIf(!swift)('这台 Mac 上有 anki-learn：那边 CardMaker.swift 的出卡规矩里一字不差还有这四句（那边改了，这边照着改 card-prompt.ts）', () => {
    const src = readFileSync(swift, 'utf8')
    for (const r of ANKI_LEARN_RULES) expect(src).toContain(`- ${r}`)
  })
  it('一问的材料：在哪、小结、原话、旁支问的那一句、回答原文、这一页的字', () => {
    const it2 = doubtItems(L5, L5_SECTIONS[0]!, 5)[1]!
    const m = cardMaterial(2, it2, { course: 'ecp', pageText: 'Subtracting V_th keeps the residue.' })
    expect(m.split('\n').slice(0, 5)).toEqual([
      '【第 2 问】编号：2',
      '课程：ecp　PDF：Lecture05　第 2 页　这一轮：LIF 神经元的三条公式',
      '这一轮的小结：水桶模型：漏、加、到门槛发、发完减门槛。',
      '他问的原话：为什么减掉门槛，而不是清零？',
      '（旁支）他在回答里选中问的那一句：水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量',
    ])
    expect(m).toContain('AI 当时的回答：\n减掉门槛能把超出门槛的那一截留下来')
    expect(m.endsWith('这一页 PDF 上的字：\nSubtracting V_th keeps the residue.')).toBe(true)
  })
})

describe('卡的字', () => {
  it('AI 一行一张：认编号和四样字，代码块围栏、半行、说的别的话跳过；也认 {"cards":[…]}', () => {
    const text = '好的：\n```json\n{"id":"1","q":"问一","a":"答一","more":"甲\\n乙","quote":"原句"}\n{"id":2,"q":"问二","a":"答二","more":["丙","丁"],"quote":""}\n{"id":"3","q":"","a":"没问题不算"}\n{"id":"4","q":"半行'
    expect(parseCardLines(text)).toEqual([
      { id: '1', card: { q: '问一', a: '答一', more: '甲\n乙', quote: '原句' } },
      { id: '2', card: { q: '问二', a: '答二', more: '丙\n丁', quote: '' } },
    ])
    expect(parseCardLines('{"cards":[{"id":"9","q":"Q","a":"A"}]}')).toEqual([{ id: '9', card: { q: 'Q', a: 'A', more: '', quote: '' } }])
    expect(cardText({ q: 'x' })).toBeNull()
  })
  it('判重和 anki-learn CardMaker.key 一样：不管大小写、空白、标点', () => {
    expect(cardKey('Roofline 模型的拐点怎么算？')).toBe(cardKey('roofline模型的拐点怎么算'))
    expect(cardKey('A, b!')).toBe('ab')
  })
  it('数答案的字：汉字一个算一个，英文单词、数字一串算一个，公式记号不算', () => {
    expect(plainLength('漏得慢，记得久。')).toBe(8)
    expect(plainLength('SRAM 读一次约 5 pJ')).toBe(7)
    expect(plainLength('$V_{th}$ 是门槛')).toBe(4)
  })
  it('核规矩：问题有指代、答案超过 40 个字、没有原文摘句、摘句不是原样的，都说出来', () => {
    const ok = { q: 'Roofline 模型的拐点怎么算？', a: '峰值算力除以内存带宽。', more: '', quote: 'knee = peak FLOP/s / bandwidth' }
    expect(cardProblems(ok, '... knee = peak FLOP/s / bandwidth (B/s)')).toEqual([])
    const bad = cardProblems({ q: '这三条公式各在做什么？', a: '一'.repeat(41), more: '1\n2\n3\n4', quote: '编的' }, '材料')
    expect(bad).toEqual([expect.stringMatching(/^问题里有离开那一页看不懂的指代/), expect.stringMatching(/^答案 41 个字，超过 40/), expect.stringMatching(/^补充 4 条，超过 3 条/), expect.stringMatching(/^原文摘句不是材料里原样的一句/)])
  })
})

describe('笔记里每一问的身份', () => {
  it('主对话「q<i>」、旁支「s<i>.<j>.<k>」对得上出卡、送 Anki 用的那一条', () => {
    const s = L5_SECTIONS[0]!
    const ids = turnIds(L5, s)
    const items = doubtItems(L5, s, 5)
    expect([ids.get('q0'), ids.get('s0.0.0'), ids.get('q1')]).toEqual(items.map((x) => x.id))
    expect(items.map((x) => x.section.doubts[0])).toEqual(['给我讲解一下这三条公式', '为什么减掉门槛，而不是清零？', '那 tau 大一点会怎样？'])
  })
  it('「还是不懂」并进上一问：它的位置也指到上一问那一条，回答换成后一版', () => {
    const s = { ...L5_SECTIONS[2]!, qas: [...L5_SECTIONS[2]!.qas!, { q: '还是不懂', a: '再讲一遍：拐点是比值。', sides: [] }] }
    const ids = turnIds(L5, s)
    expect(ids.get('q1')).toBe(ids.get('q0'))
    expect(doubtItems(L5, s, 5)[0]!.answer).toBe('再讲一遍：拐点是比值。')
  })
})
