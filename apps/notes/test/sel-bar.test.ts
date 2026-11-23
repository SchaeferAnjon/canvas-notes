/**
 * 选中小条能自定义（task-26nz7）：命令.json 的 bar 读写、三段挪动和条上 5 颗的上限、不弹的网站名单、某一处的小条、提示词的空。
 */
import { describe, expect, it } from 'vitest'
import {
  BAR_CAP,
  barAt,
  barClash,
  barJson,
  barKeyOk,
  defaultBar,
  docItems,
  dropFromBar,
  fillPrompt,
  isDefaultBar,
  moveTo,
  muteSite,
  normalizeBar,
  placeOwn,
  siteKey,
  siteMuted,
  unmuteSite,
} from '../src/shared/sel-bar'
import { commandsJson, defaultCommands, normalizeCommands } from '../src/shared/commands'

const MINE = [
  { id: 'own-hs', name: '用高中生能懂的话讲', where: ['web', 'pdf', 'html', 'doc'] },
  { id: 'own-et', name: '查这个词的词源', where: ['web', 'pdf', 'doc', 'board'] },
]

describe('命令.json 的 bar', () => {
  it('没写是默认的：条上讲解一下、翻译 + 讲一讲、引用、剪藏，⋯ 里只看译文、拷贝；默认的不写进文件', () => {
    const c = normalizeBar(undefined)
    expect(c).toEqual(defaultBar())
    expect(isDefaultBar(c)).toBe(true)
    expect(barJson(c)).toBeNull()
    expect(commandsJson(normalizeCommands({ version: 1 }))).not.toContain('"bar"')
  })

  it('读写往返不变；不认识的 id 去掉，一颗只在一段里，漏了的自带的补回去', () => {
    const raw = { on: ['explain', 'quote', 'own-hs', 'clip', 'bogus', 'quote'], more: ['only', 'own-et', 'copy'], off: ['translate'], enabled: false, offSites: [{ site: 'zh.d2l.ai', at: '2026-11-22' }] }
    const c = normalizeBar(raw)
    expect(c.on).toEqual(['explain', 'quote', 'own-hs', 'clip'])
    expect(c.off).toEqual(['translate'])
    expect(c.enabled).toBe(false)
    expect(normalizeBar(barJson(c))).toEqual(c)
    // 整份命令.json 往返：别的字段不动
    const file = { version: 1, keys: { 'own-hs': '⌥G' }, own: [], bar: raw, slash: { order: ['ocr'] } }
    const cfg = normalizeCommands(file)
    expect(normalizeCommands(JSON.parse(commandsJson(cfg)))).toEqual(cfg)
    expect(JSON.parse(commandsJson(cfg)).bar).toEqual(barJson(c))
    const thin = normalizeBar({ on: ['explain'] })
    expect(thin.on).toEqual(['explain', 'translate', 'quote', 'clip'])
    expect(thin.more).toEqual(['only', 'copy'])
  })

  it('条上超过 5 颗：多出来的挪到 ⋯ 最前面', () => {
    const c = normalizeBar({ on: ['explain', 'translate', 'quote', 'clip', 'own-hs', 'own-et'], more: ['only', 'copy'] })
    expect(c.on).toHaveLength(BAR_CAP)
    expect(c.more[0]).toBe('own-et')
  })

  it('名单按网站记：去掉协议、www、路径；旧的只写网站的也认', () => {
    expect(siteKey('https://www.zh.d2l.ai/chapter/x.html')).toBe('zh.d2l.ai')
    expect(siteKey('YouTube.com')).toBe('youtube.com')
    expect(siteKey('  ')).toBe('')
    const c = normalizeBar({ offSites: ['zh.d2l.ai', { site: 'https://youtube.com/watch', at: '2026-11-20' }, 'zh.d2l.ai'] })
    expect(c.offSites).toEqual([
      { site: 'zh.d2l.ai', at: '' },
      { site: 'youtube.com', at: '2026-11-20' },
    ])
  })
})

describe('三段挪动、上限', () => {
  it('挪到条上第几颗、收进 ⋯、不出现（放最前）', () => {
    let c = defaultBar()
    c = moveTo(c, 'copy', 'on', 1)!
    expect(c.on).toEqual(['explain', 'copy', 'translate', 'quote', 'clip'])
    expect(c.more).toEqual(['only'])
    c = moveTo(c, 'translate', 'off')!
    expect(c.off).toEqual(['translate'])
    c = moveTo(c, 'only', 'off')!
    expect(c.off).toEqual(['only', 'translate'])
  })

  it('条上满了（5 颗，自带的也算）还往上放：拦住；条上自己挪位置不拦', () => {
    let c = moveTo(defaultBar(), 'copy', 'on')!
    expect(c.on).toHaveLength(5)
    expect(moveTo(c, 'only', 'on')).toBeNull()
    c = moveTo(c, 'copy', 'on', 0)!
    expect(c.on[0]).toBe('copy')
  })

  it('放进一颗自己的：想放条上、满了收进 ⋯；删掉这条命令时从表里拿掉', () => {
    let r = placeOwn(defaultBar(), 'own-hs', 'on')
    expect(r.zone).toBe('on')
    r = placeOwn(r.config, 'own-et', 'on')
    expect(r.zone).toBe('more')
    expect(r.config.more).toEqual(['only', 'copy', 'own-et'])
    expect(dropFromBar(r.config, 'own-et').more).toEqual(['only', 'copy'])
  })
})

describe('不弹的网站', () => {
  it('名单上的网站下面每一页、每个子域名都不弹；拿掉又弹', () => {
    let c = muteSite(defaultBar(), 'https://zh.d2l.ai/x', '2026-11-22')
    expect(c.offSites).toEqual([{ site: 'zh.d2l.ai', at: '2026-11-22' }])
    expect(siteMuted(c, 'https://zh.d2l.ai/chapter_preliminaries/pandas.html')).toBe(true)
    expect(siteMuted(c, 'https://cn.zh.d2l.ai/')).toBe(true)
    expect(siteMuted(c, 'https://d2l.ai/')).toBe(false)
    expect(muteSite(c, 'zh.d2l.ai', '2026-11-23')).toBe(c)
    c = unmuteSite(c, 'zh.d2l.ai')
    expect(siteMuted(c, 'https://zh.d2l.ai/')).toBe(false)
  })
})

describe('某一处的小条', () => {
  it('网页：剪藏在竖线后面，自己的在竖线前面；PDF 没有剪藏；只在另一台 Mac 上的命令跳过不画', () => {
    const c = normalizeBar({ on: ['explain', 'translate', 'quote', 'clip', 'own-hs'], more: ['only', 'own-et', 'own-gone', 'copy'] })
    const web = barAt(c, MINE, 'web')
    expect(web.main.map((x) => x.id)).toEqual(['explain', 'translate', 'quote', 'own-hs'])
    expect(web.tail.map((x) => x.id)).toEqual(['clip'])
    expect(web.more.map((x) => x.id)).toEqual(['only', 'own-et', 'copy'])
    const pdf = barAt(c, MINE, 'pdf')
    expect(pdf.tail).toEqual([])
    expect(pdf.more.map((x) => x.id)).toEqual(['own-et', 'copy'])
    expect(barAt(c, MINE, 'html').more.map((x) => x.id)).toEqual(['copy'])
  })

  it('文档：条上和 ⋯ 里勾了「文档」的几颗（自带的都不在文档里）', () => {
    const c = normalizeBar({ on: ['explain', 'translate', 'quote', 'clip', 'own-hs'], more: ['only', 'own-et', 'copy'] })
    expect(docItems(c, MINE).map((x) => x.name)).toEqual(['用高中生能懂的话讲', '查这个词的词源'])
    expect(docItems(moveTo(c, 'own-hs', 'off')!, MINE).map((x) => x.id)).toEqual(['own-et'])
  })
})

describe('提示词和键', () => {
  it('填空：中文、英文写法都认；没写 {选中的字} 时说要接在最后', () => {
    const v = { sel: 'CSV 文件', title: '2.2. 数据预处理', url: 'zh.d2l.ai/x', head: '2.2.1. 读取数据集' }
    expect(fillPrompt('用高中生能听懂的话讲{选中的字}', v)).toEqual({ text: '用高中生能听懂的话讲CSV 文件', tail: false })
    expect(fillPrompt('Explain {selection} from {page title}', v)).toEqual({ text: 'Explain CSV 文件 from 2.2. 数据预处理', tail: false })
    expect(fillPrompt('{上面的小标题}这一节讲了什么', v)).toEqual({ text: '2.2.1. 读取数据集这一节讲了什么', tail: true })
  })

  it('自己那颗的键：带 ⌘ ⌃，或 ⌥ 加字母；撞了条上哪一颗说它的名字', () => {
    expect(barKeyOk('⌥G')).toBe(true)
    expect(barKeyOk('⌥⇧G')).toBe(true)
    expect(barKeyOk('⇧⌘↵')).toBe(true)
    expect(barKeyOk('G')).toBe(false)
    expect(barKeyOk('⌥↵')).toBe(false)
    const items = [
      { id: 'explain', name: '讲解一下', key: '↵' },
      { id: 'quote', name: '引用', key: '⌘↵' },
      { id: 'own-hs', name: '用高中生能懂的话讲', key: '⌥G' },
    ]
    expect(barClash('⌘↵', items, 'own-new')).toEqual({ id: 'quote', name: '引用' })
    expect(barClash('⌥G', items, 'own-hs')).toBeNull()
  })

  it('命令.json 里自己那颗的 ⌥ 加字母键读得回来（别的命令照旧要带 ⌘ ⌃）', () => {
    const c = normalizeCommands({ keys: { 'own-hs': '⌥G', 'new-note': '⌥N' } })
    expect(c.keys).toEqual({ 'own-hs': '⌥G' })
    expect(defaultCommands().keys).toEqual({})
  })
})
