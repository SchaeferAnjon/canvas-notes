/**
 * 回答下面那排的快捷回复（task-eavzx）：命令.json 的 replies 读写、三段挪动、各处默认几颗、自己的命令当快捷回复、那句里的空；
 * 组件那边一排放得下几颗（fitBar）。
 */
import { describe, expect, it } from 'vitest'
import { fitBar } from '@cn/design/answer-bar'
import { aiCmdJson, aiCmdOf, type Ctx, hiddenHere, replyCtx, slashGroups } from '../src/shared/ai-cmds'
import { commandsJson, defaultCommands, deleteOwn, normalizeCommands } from '../src/shared/commands'
import { defaultReplies, dropReply, fillReply, moveReply, normalizeReplies, placeReply, repliesAt, repliesJson, replyNameOf, type ReplyOwn } from '../src/shared/replies'

const MINE: ReplyOwn[] = [
  { id: 'own-eg', name: '举个例子', where: ['chat'], say: '举个生活里的例子', out: 'here' },
  { id: 'own-quiz', name: '考考我', where: ['pdf', 'web'], say: '就{这条回答}出三道选择题考我', out: 'side' },
]
const names = (xs: { name: string }[]) => xs.map((x) => x.name)

describe('各处默认几颗', () => {
  const d = defaultReplies()
  it('读 PDF 三颗，网页、视频前两颗，AI 对话一颗不放', () => {
    expect(names(repliesAt(d, [], 'pdf').on)).toEqual(['还是不懂', '换个方式讲', '做个可视化'])
    expect(names(repliesAt(d, [], 'web').on)).toEqual(['还是不懂', '换个方式讲'])
    expect(names(repliesAt(d, [], 'video').on)).toEqual(['还是不懂', '换个方式讲'])
    expect(repliesAt(d, [], 'chat').on).toEqual([])
  })
  it('默认的不写进命令.json', () => {
    expect(repliesJson(d)).toBeNull()
    expect(commandsJson(defaultCommands())).not.toContain('replies')
  })
})

describe('加一颗、排序、收进 ⋯、不出现、删', () => {
  it('加一颗排在最后，这一排多一颗；只在勾了的那几处', () => {
    const c = placeReply(defaultReplies(), 'own-eg')
    expect(names(repliesAt(c, MINE, 'chat').on)).toEqual(['举个例子'])
    expect(names(repliesAt(c, MINE, 'pdf').on)).toEqual(['还是不懂', '换个方式讲', '做个可视化'])
    const c2 = placeReply(c, 'own-quiz')
    expect(names(repliesAt(c2, MINE, 'pdf').on)).toEqual(['还是不懂', '换个方式讲', '做个可视化', '考考我'])
    // 已经在表里的不挪
    expect(placeReply(c2, 'own-eg', 'more')).toBe(c2)
  })
  it('挪到最前、收进 ⋯、不出现', () => {
    let c = placeReply(placeReply(defaultReplies(), 'own-eg'), 'own-quiz')
    c = moveReply(c, 'own-quiz', 'on', 0)
    expect(names(repliesAt(c, MINE, 'web').on)).toEqual(['考考我', '还是不懂', '换个方式讲'])
    c = moveReply(c, 'another', 'more')
    expect(names(repliesAt(c, MINE, 'web').on)).toEqual(['考考我', '还是不懂'])
    expect(names(repliesAt(c, MINE, 'web').more)).toEqual(['换个方式讲'])
    c = moveReply(c, 'still', 'off')
    expect(names(repliesAt(c, MINE, 'web').on)).toEqual(['考考我'])
    // 写进去再读回来一样
    expect(normalizeReplies(JSON.parse(JSON.stringify(repliesJson(c))))).toEqual(c)
  })
  it('删掉这条命令：表里跟着拿掉', () => {
    const cfg = { ...defaultCommands(), own: [{ id: 'own-eg', name: '举个例子', kind: 'ai', target: '举个生活里的例子' }], replies: placeReply(defaultReplies(), 'own-eg') }
    const next = deleteOwn(cfg, 'own-eg')
    expect(next.replies.on).toEqual(['still', 'another', 'viz'])
    expect(dropReply(cfg.replies, 'own-eg')).toEqual(next.replies)
  })
  it('坏的、手改错的只留对的；漏了的自带的补回排上；一颗只在一段里', () => {
    expect(normalizeReplies({ on: ['own-eg', 'bogus', 'own-eg'], more: ['still'], off: [3] })).toEqual({ on: ['own-eg', 'another', 'viz'], more: ['still'], off: [] })
    expect(normalizeReplies('x')).toEqual(defaultReplies())
    expect(normalizeCommands({ replies: { on: [], off: ['still', 'another', 'viz'] } }).replies).toEqual({ on: [], more: [], off: ['still', 'another', 'viz'] })
  })
  it('表里有、这台 Mac 上没有的那条（只在另一台的）跳过不画', () => {
    const c = placeReply(defaultReplies(), 'own-gone')
    expect(names(repliesAt(c, MINE, 'pdf').on)).toEqual(['还是不懂', '换个方式讲', '做个可视化'])
  })
})

describe('自己的命令当快捷回复', () => {
  it('reply 读写来回不丢', () => {
    const raw = { id: 'own-eg', name: '举个例子', kind: 'ai', target: '举个生活里的例子', prompt: '举个生活里的例子', write: 'answer', where: [], reply: { where: ['chat', 'pdf', 'nope'], out: 'side' } }
    const c = aiCmdOf(raw, 'vault')!
    expect(c.reply).toEqual({ where: ['chat', 'pdf'], out: 'side' })
    expect(c.where).toEqual([])
    expect(aiCmdOf(aiCmdJson(c), 'vault')).toEqual(c)
  })
  it('没有 reply 的命令照旧没有', () => {
    expect(aiCmdOf({ id: 'own-x', name: 'x', kind: 'ai', target: '一条' }, 'vault')!.reply).toBeUndefined()
  })
})

describe('那句里的空', () => {
  it('{这条回答}「」括起来，长了截短；没有的空填空', () => {
    expect(fillReply('就{这条回答}出三道题', { answer: '列就是基向量去哪' })).toBe('就「列就是基向量去哪」出三道题')
    expect(fillReply('第{第几页}页：{你问的那句}', { page: '4' })).toBe('第4页：')
    const long = 'x'.repeat(700)
    expect(fillReply('{this answer}', { answer: long })).toBe(`「${'x'.repeat(600)}……」`)
  })
  it('存成快捷回复取前几个字当名字', () => {
    expect(replyNameOf('举个生活里的例子')).toBe('举个生活里的')
    expect(replyNameOf('再讲 一遍。')).toBe('再讲一遍')
  })
})

describe('一排放得下几颗（fitBar）', () => {
  const base = { acts: [52, 76], actsIcon: [24, 24], more: 24, replies: [80, 96, 96, 70] }
  it('够宽：带字、全排上', () => {
    expect(fitBar({ ...base, width: 600 })).toEqual({ icons: false, shown: 4 })
  })
  it('挤一点：左边先收成图标', () => {
    expect(fitBar({ ...base, width: 470 })).toEqual({ icons: true, shown: 4 })
  })
  it('再挤：放不下的快捷回复进 ⋯', () => {
    expect(fitBar({ ...base, width: 300 })).toEqual({ icons: true, shown: 2 })
  })
  it('旁支那种窄处（keepLabels）：功能按钮照样带字，放不下的快捷回复进 ⋯', () => {
    expect(fitBar({ ...base, width: 470, keepLabels: true })).toEqual({ icons: false, shown: 3 })
    expect(fitBar({ ...base, width: 260, keepLabels: true })).toEqual({ icons: false, shown: 1 })
    expect(fitBar({ ...base, width: 200, keepLabels: true })).toEqual({ icons: false, shown: 0 })
    expect(fitBar({ ...base, width: 120, keepLabels: true })).toEqual({ icons: true, shown: 0 })
  })
  it('没有快捷回复：放得下就带字', () => {
    expect(fitBar({ ...base, replies: [], width: 200 })).toEqual({ icons: false, shown: 0 })
    expect(fitBar({ ...base, replies: [], width: 120 })).toEqual({ icons: true, shown: 0 })
  })
})

describe('快捷回复也是一条命令：/ 菜单在它出现的那几处叫得到（task-eavzx A 线）', () => {
  const quiz = aiCmdOf({ id: 'own-quiz', name: '考考我', kind: 'ai', rules: [{ t: '就{这条回答}出三道选择题考我' }], prompt: '就{这条回答}出三道选择题考我', where: [], write: 'answer', reply: { where: ['chat'], out: 'here' } }, 'vault')!
  const pdfOnly = aiCmdOf({ id: 'own-pg', name: '讲这一页', kind: 'ai', rules: [{ t: '给我讲解一下这一页' }], prompt: '给我讲解一下这一页', where: [], write: 'answer', reply: { where: ['pdf'], out: 'here' } }, 'vault')!
  const plain = aiCmdOf({ id: 'own-tidy', name: '整理成通顺笔记', kind: 'ai', rules: [{ t: '整理' }], where: ['doc'], write: 'inplace' }, 'vault')!
  const slash = { hidden: [], order: [] }
  const mineAt = (here: Ctx) =>
    slashGroups({ here, q: '', mine: [quiz, pdfOnly, plain], slash })
      .find((g) => g.key === 'mine')
      ?.items.map((i) => i.name) ?? []

  it('勾了 AI 对话的：AI 对话那一栏看着什么都在（文档、白板、文件夹、什么都没开）；读 PDF 里不在', () => {
    expect(mineAt('doc')).toEqual(['考考我', '整理成通顺笔记'])
    expect(mineAt('none')).toEqual(['考考我'])
    expect(mineAt('folder')).toEqual(['考考我'])
    expect(mineAt('pdf')).toEqual(['讲这一页'])
    expect(mineAt('html')).toEqual(['讲这一页'])
  })
  it('replyCtx：读 PDF 也算 HTML；网页、视频各管各的', () => {
    expect(replyCtx(['pdf'])).toEqual(['pdf', 'html'])
    expect(replyCtx(['web'])).toEqual(['web'])
    expect(replyCtx(['video'])).toEqual(['video'])
    expect(replyCtx([])).toEqual([])
  })
  it('藏起的快捷回复在「藏着的」里', () => {
    expect(hiddenHere({ here: 'none', mine: [quiz], slash: { hidden: ['own-quiz'], order: [] } }).map((i) => i.name)).toEqual(['考考我'])
  })
  it('不再当快捷回复：写回时 reply 写成 undefined，合进原来那条以后就没了（saveAiCmd 靠它拿掉）', () => {
    const { reply: _, ...rest } = quiz
    const merged = { ...aiCmdJson(quiz), ...{ prompt: undefined, out: undefined, from: undefined, reply: undefined, ...aiCmdJson(rest) } }
    const back = JSON.parse(JSON.stringify(merged)) as Record<string, unknown>
    expect(back.reply).toBeUndefined()
    expect(back.prompt).toBe('就{这条回答}出三道选择题考我')
  })
})
