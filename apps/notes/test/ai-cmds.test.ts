// AI 命令的目录、/ 菜单分组、自己存的命令、影响卡（task-9womr，小样 canvas-notes-commands/v2/proto-c2.html 的点击记录逐条对上）
import { describe, expect, it } from 'vitest'
import {
  type AiCmd,
  aiCmdJson,
  aiCmdOf,
  BUILTINS,
  cleanName,
  descOf,
  emptySlash,
  hiddenHere,
  impactOf,
  instructionOf,
  moveInGroup,
  sameAsBuiltin,
  saveProblem,
  slashGroups,
  tagsOf,
  whereCtx,
} from '../src/shared/ai-cmds'
import { commandsJson, normalizeCommands } from '../src/shared/commands'

const mine: AiCmd = {
  id: 'own-tidy',
  name: '整理成通顺笔记',
  rules: [{ t: '按书的章节分节，每节一个「##」小标题', e: '改后多了 4 个小标题' }, { t: '问答保留原样' }, { t: '不要这条', off: true }],
  where: ['doc'],
  write: 'inplace',
  store: 'vault',
  desc: '照「学习笔记」4 轮前后的对比提炼，每次先给你看',
  from: { path: '课程/study project/学习笔记.md', title: '学习笔记', rounds: 4, place: 'file:课程/study project/学习笔记.md' },
}

const names = (g: ReturnType<typeof slashGroups>) => g.map((x) => x.title).join('｜')
const count = (g: ReturnType<typeof slashGroups>) => g.reduce((s, x) => s + x.items.length, 0)

describe('自带的命令', () => {
  it('20 条，名字不重，12 条新加的都在', () => {
    expect(BUILTINS).toHaveLength(20)
    expect(new Set(BUILTINS.map((b) => b.name)).size).toBe(20)
    for (const n of ['截图转成文字', '补双链', '出几道自测题', '拆成白板卡片', '白板排成计划', '计划拆成待办', '这份课件每页讲什么', '我问过的收成复习提纲', '视频要点带时间', '字幕整理成一篇', '书摘按主题分节', '写这周的周记'])
      expect(BUILTINS.some((b) => b.name === n)).toBe(true)
  })
  it('不经 AI 的两条用自己的图标，别的画引擎标志', () => {
    expect(BUILTINS.filter((b) => b.icon).map((b) => b.name)).toEqual(['剪藏这一页', '找重复'])
  })
})

describe('/ 菜单分组（照小样的点击记录）', () => {
  it('文档里：我的命令｜这一篇｜整个库，一共 12 条，第一条是我的命令', () => {
    const g = slashGroups({ here: 'doc', q: '', mine: [mine], slash: emptySlash() })
    expect(names(g)).toBe('我的命令｜这一篇｜整个库')
    expect(count(g)).toBe(12)
    expect(g[0]!.items[0]!.name).toBe('整理成通顺笔记')
    expect(g[1]!.items.map((x) => x.name)).toEqual(['截图转成文字', '补双链', '出几道自测题', '拆成白板卡片', '总结这块白板', '翻译'])
    expect(g[2]!.items.map((x) => x.name)).toEqual(['写这周的周记', '整理收件箱', '剪藏这一页', '找重复', '现在梦游'])
  })
  it('白板 12 条，我的命令在这里用不了时写一行为什么', () => {
    const g = slashGroups({ here: 'board', q: '', mine: [mine], slash: emptySlash() })
    expect(names(g)).toBe('我的命令｜这块白板｜整个库')
    expect(count(g)).toBe(12)
    expect(g[0]!.ph).toBe('「整理成通顺笔记」在这里用不了：它只选了文档')
  })
  it('PDF 9 条、视频 8 条、书摘 11 条', () => {
    const pdf = slashGroups({ here: 'pdf', q: '', mine: [mine], slash: emptySlash() })
    expect(names(pdf)).toBe('我的命令｜这份 PDF｜整个库')
    expect(count(pdf)).toBe(9)
    const video = slashGroups({ here: 'video', q: '', mine: [mine], slash: emptySlash() })
    expect(names(video)).toBe('我的命令｜这个视频｜整个库')
    expect(count(video)).toBe(8)
    const book = slashGroups({ here: 'book', q: '', mine: [mine], slash: emptySlash() })
    expect(names(book)).toBe('我的命令｜这本书的书摘｜整个库')
    expect(count(book)).toBe(11)
    expect(book[0]!.items[0]!.name).toBe('整理成通顺笔记')
  })
  it('还没存过：我的命令写「调出满意的样子后点…」', () => {
    const g = slashGroups({ here: 'doc', q: '', mine: [], slash: emptySlash() })
    expect(g[0]!.ph).toBe('调出满意的样子后点「存成命令」，就会在这里')
    expect(count(g)).toBe(11)
  })
  it('打「周」只剩整个库那一条，不写灰字', () => {
    const g = slashGroups({ here: 'doc', q: '周', mine: [mine], slash: emptySlash() })
    expect(names(g)).toBe('整个库')
    expect(g[0]!.items.map((x) => x.name)).toEqual(['写这周的周记'])
  })
  it('右栏开着网页时，选了网页的命令在文档里也能用', () => {
    const web = { ...mine, id: 'own-web', name: '网页摘要', where: ['web' as const] }
    expect(slashGroups({ here: 'doc', q: '', mine: [web], slash: emptySlash() })[0]!.items).toHaveLength(0)
    expect(slashGroups({ here: 'doc', also: ['web'], q: '', mine: [web], slash: emptySlash() })[0]!.items.map((x) => x.name)).toEqual(['网页摘要'])
  })
  it('藏起的不列、列在「藏着的」里；换过顺序的排在前面', () => {
    const slash = { hidden: ['ocr'], order: ['translate-not-here', 'tr', 'link'] }
    const g = slashGroups({ here: 'doc', q: '', mine: [], slash })
    expect(g[1]!.items.map((x) => x.id)).toEqual(['tr', 'link', 'quiz', 'split', 'sum'])
    expect(hiddenHere({ here: 'doc', mine: [], slash }).map((x) => x.name)).toEqual(['截图转成文字'])
    expect(hiddenHere({ here: 'board', mine: [], slash })).toEqual([])
  })
  it('往前挪一格：这一组的新顺序排在最前', () => {
    expect(moveInGroup([], ['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveInGroup(['x', 'a'], ['a', 'b'], 'a', 1)).toEqual(['b', 'a', 'x'])
    expect(moveInGroup([], ['a', 'b'], 'a', -1)).toEqual([])
  })
})

describe('自己存的 AI 命令', () => {
  it('标签：改这一篇（黄）· 先给你看 · 能撤回；只回答没有后两颗', () => {
    expect(tagsOf(mine)).toEqual([['改这一篇', 'w'], ['先给你看'], ['能撤回']])
    expect(tagsOf({ write: 'beside' })[0]).toEqual(['新建：放在旁边', 'nw'])
    expect(tagsOf({ write: 'answer' })).toEqual([['只回答']])
  })
  it('说明是勾着的几条，编号', () => {
    expect(instructionOf(mine.rules)).toBe('1. 按书的章节分节，每节一个「##」小标题\n2. 问答保留原样')
  })
  it('存进命令.json 再读回来一样；⌘K 的命令表照旧认它（kind: ai）', () => {
    const json = aiCmdJson(mine)
    expect(json.target).toBe(instructionOf(mine.rules))
    const cfg = normalizeCommands({ version: 1, own: [json], slash: { hidden: ['ocr'], order: ['own-tidy'] } })
    expect(cfg.own).toHaveLength(1)
    expect(aiCmdOf(cfg.own[0], 'vault')).toEqual(mine)
    expect(cfg.slash).toEqual({ hidden: ['ocr'], order: ['own-tidy'] })
    // 写回去：slash 也在，不认识的字段原样
    const back = JSON.parse(commandsJson({ ...cfg, rest: { future: 1 } })) as Record<string, unknown>
    expect(back.slash).toEqual({ hidden: ['ocr'], order: ['own-tidy'] })
    expect(back.future).toBe(1)
  })
  it('只有 target 的旧写法拆成一行一条规矩；坏的读成 null', () => {
    const c = aiCmdOf({ id: 'own-a', name: '短一点', kind: 'ai', target: '1. 每段不超过三句\n2. 去掉口头禅' }, 'local')
    expect(c?.rules.map((r) => r.t)).toEqual(['每段不超过三句', '去掉口头禅'])
    expect(c?.store).toBe('local')
    expect(aiCmdOf({ id: 'own-a', name: '', kind: 'ai', target: 'x' }, 'vault')).toBeNull()
    expect(aiCmdOf({ id: 'own-a', name: 'x', kind: 'open', target: 'x' }, 'vault')).toBeNull()
  })
  it('第二行说明：照哪篇几轮提炼，或者头一条规矩', () => {
    expect(descOf(mine.rules, mine.from)).toBe('照「学习笔记」4 轮前后的对比提炼，每次先给你看')
    expect(descOf([{ t: '去掉口头禅' }], undefined, 'answer')).toBe('去掉口头禅')
  })
  it('在哪能用：文档也算书摘，网页也算视频', () => {
    expect(whereCtx(['doc', 'web'])).toEqual(['doc', 'book', 'web', 'video'])
  })
  it('存不了的原因、重名、名字不带空白', () => {
    expect(saveProblem({ rules: [{ t: 'a', off: true }], name: 'x', where: ['doc'] })).toBe('一条规矩都没勾：没有说明可存')
    expect(saveProblem({ rules: [{ t: 'a' }], name: ' ', where: ['doc'] })).toBe('名字空着')
    expect(saveProblem({ rules: [{ t: 'a' }], name: 'x', where: [] })).toBe('「在哪能用」一处都没选')
    expect(saveProblem({ rules: [{ t: 'a' }], name: 'x', where: ['doc'] })).toBeNull()
    expect(sameAsBuiltin('翻译')).toBe(true)
    expect(cleanName('通顺 笔记\n')).toBe('通顺笔记')
  })
})

describe('影响卡（照小样第 11–16 步）', () => {
  const base = { name: '通顺笔记', where: ['doc' as const], write: 'inplace' as const, store: 'vault' as const, example: '第2讲 预备知识', folder: '课程/study project', who: 'Claude Code · Opus 5.5 · High' }
  it('改这一篇', () => {
    const m = impactOf(base)
    expect(m.after?.map((r) => [r.name, r.mark])).toEqual([
      ['课程/study project', undefined],
      ['第2讲 预备知识.md', 'mod'],
    ])
    expect(m.cap).toBe('就在原文上改，不新建文件')
    expect(m.touch).toBe('只有这一个文件；跑的时候全能模式不开')
    expect(m.commit).toBe('1 次「AI：/通顺笔记 · 第2讲 预备知识」，回答下面能撤回')
    expect(m.store).toBe('库里的 .canvas-notes/命令.json，跟 Git 走，换台 Mac 也在')
    expect(m.appear).toBe('文档里打 /，{k:search}「让AI做」')
    expect(m.locked).toBe(true)
  })
  it('新建放旁边、进收件箱、只回答', () => {
    expect(impactOf({ ...base, write: 'beside' }).after?.map((r) => r.name)).toEqual(['课程/study project', '第2讲 预备知识.md', '第2讲 预备知识：整理稿.md'])
    expect(impactOf({ ...base, write: 'inbox' }).cap).toBe('新建进收件箱，原文不动；梦游以后再建议归到哪')
    const a = impactOf({ ...base, write: 'answer' })
    expect(a.after).toBeNull()
    expect(a.commit).toBe('没有提交')
    expect(a.preview).toBe('不用：只在对话里回答')
    expect(a.touch).toBe('什么都不写，只读这一篇和它的图')
  })
  it('勾了网页又选改这一篇：提醒那时新建进收件箱；一处都没选那一格是空的', () => {
    const m = impactOf({ ...base, where: ['doc', 'web'] })
    expect(m.appear).toBe('文档里打 /、网页上右键「问 AI」，{k:search}「让AI做」')
    expect(m.note).toBe('在网页上用时没有「这一篇」可改：那时新建一篇进收件箱')
    expect(impactOf({ ...base, where: [] }).appear).toBeNull()
    expect(impactOf({ ...base, store: 'local' }).store).toBe('只在这台 Mac 上，不进库、不进历史')
  })
})
