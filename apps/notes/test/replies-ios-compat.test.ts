/**
 * 快捷回复的命令库字段电脑版和 iPhone / iPad 版对齐（task-eavzx）：两边读写同一份库里的 .canvas-notes/命令.json。
 * - replies-desktop.json：电脑版这里写出来的样子（这条测试照电脑版的函数生成、逐字节比）；iOS 的 QuickRepliesTests.testDesktopFileCompat 读它、写回字节不变。
 * - replies-ios.json：iOS 加一颗快捷回复写出来的样子（QuickRepliesTests.testIosFileMatchesFixture 逐字节比）；这里电脑版读懂它、写回字节不变。
 * 改了任何一边的写法，两边的测试都会挂。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { aiCmdJson, aiCmdOf, rulesOfPrompt, type AiCmd } from '../src/shared/ai-cmds'
import { commandsJson, defaultCommands, normalizeCommands } from '../src/shared/commands'
import { repliesAt } from '../src/shared/replies'

const FIX = join(__dirname, '../../apple/CanvasCore/Tests/CanvasCoreTests/Fixtures')
const read = (n: string) => readFileSync(join(FIX, n), 'utf8')

/** 电脑版「回答下面那排 › 加一颗」那条命令（同 renderer/replies/store.ts 的 newReplyCmd） */
function replyCmd(id: string, name: string, say: string, where: AiCmd['reply'] extends infer R ? (R extends { where: infer W } ? W : never) : never): AiCmd {
  return { id, name, rules: rulesOfPrompt(say), where: [], write: 'answer', store: 'vault', desc: say.split('\n')[0]!.slice(0, 120), prompt: say, reply: { where, out: 'here' } }
}

it('电脑版写的命令.json：和 replies-desktop.json 逐字节一样（iOS 那边读它）', () => {
  const cfg = defaultCommands()
  cfg.own = [
    aiCmdJson(replyCmd('own-mac1', '举个例子', '给{这条回答}举个生活里的例子', ['chat', 'pdf'])),
    aiCmdJson({ ...replyCmd('own-mac2', '考考我', '出三道题考我\n别给答案', ['web']), reply: { where: ['web'], out: 'side' } }),
  ]
  cfg.replies = { on: ['still', 'own-mac1'], more: ['another', 'own-mac2'], off: ['viz'] }
  expect(commandsJson(cfg)).toBe(read('replies-desktop.json'))
})

it('iOS 写的命令.json（replies-ios.json）：电脑版读懂、写回逐字节不变', () => {
  const text = read('replies-ios.json')
  const cfg = normalizeCommands(JSON.parse(text))
  expect(commandsJson(cfg)).toBe(text)
  const cmds = cfg.own.flatMap((x) => aiCmdOf(x, 'vault') ?? [])
  expect(cmds.map((c) => [c.id, c.name, c.write, c.prompt, c.reply])).toEqual([['own-ios1', '考考我', 'answer', '出一道题考我{这条回答}', { where: ['chat', 'web'], out: 'here' }]])
  const owns = cmds.map((c) => ({ id: c.id, name: c.name, where: c.reply!.where, say: c.prompt!, out: c.reply!.out }))
  expect(repliesAt(cfg.replies, owns, 'chat').on.map((x) => x.id)).toEqual(['still', 'another', 'own-ios1'])
  expect(repliesAt(cfg.replies, owns, 'pdf').on.map((x) => x.id)).toEqual(['still', 'another'])
  expect(repliesAt(cfg.replies, owns, 'pdf').more.map((x) => x.id)).toEqual([])
  expect(cfg.replies).toEqual({ on: ['still', 'another', 'own-ios1'], more: [], off: ['viz'] })
})

it('回答里选中一句的不出现名单（answerSel）：电脑版写的和 answer-sel-desktop.json 逐字节一样（iOS 读它、写回不变）', () => {
  const cfg = defaultCommands()
  cfg.own = [
    aiCmdJson({ id: 'own-mac1', name: '大白话', rules: rulesOfPrompt('用大白话解释{选中的字}'), where: ['doc'], write: 'answer', store: 'vault', desc: '用大白话解释{选中的字}', prompt: '用大白话解释{选中的字}' }),
    aiCmdJson({ id: 'own-mac2', name: '考考我', rules: rulesOfPrompt('出三道题考我'), where: ['doc'], write: 'answer', store: 'vault', desc: '出三道题考我' }),
  ]
  cfg.answerSel = { off: ['own-mac2'] }
  expect(commandsJson(cfg)).toBe(read('answer-sel-desktop.json'))
})
