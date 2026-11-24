/**
 * 梦游判断（task-h7oy8）：读 AI 的回答、原话核对、过线和拿不准的线、旧「相关：」复查和去掉那一行；
 * 进度记录（判过的不再问）、每晚封顶（到上限停、剩下的下一晚接着）、打断后接着判不重复问。
 */
import { isWikiPrompt } from '../src/shared/wiki-judge'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type DreamReportInternal, dropItem, runDream, takeItem } from '../src/main/dream'
import { fakeJudge, judgeLine, parseJudge, quoteIn, SURE, UNSURE, verdictOf, type Judgement } from '../src/main/dream-judge'
import { DreamInterrupted, dropRelated, humanWhy, rememberChoice, stripShared } from '../src/main/dream-links'
import { emptyLedger, leftTonight, loadLedger, nightOf, noteFp } from '../src/main/dream-ledger'
import { DEFAULT_DREAM, type DreamSettings, judgeOnFamily, normalizeDream, patchDream } from '../src/shared/dream-settings'
import { JUDGE_DEFAULTS } from '../src/shared/dream-judge'

const j = (o: Partial<Judgement>): Judgement => ({ a: 'a.md', b: 'b.md', level: 'same-topic', confidence: 0.9, why: '都讲冰岛', quoteA: '冰岛的火山很多', quoteB: '冰岛位于板块裂谷上', ...o })
const A = '# 冰岛\n\n冰岛的火山很多，几乎每年都有喷发。\n'
const B = '# 地理\n\n冰岛位于板块裂谷上，所以地震多。\n'

describe('读回答、核对原话、过线', () => {
  it('B1、B2 对回候选（评测那一路的回答格式）；档不认识的、多出来的、重复的不算', () => {
    const reply = '```json\n[{"b":2,"kind":"同一主题","confidence":0.8,"reason":"x","quote_a":"q","quote_b":"r"},{"b":1,"kind":"也许","confidence":1},{"b":9,"kind":"无关","confidence":1},{"b":2,"kind":"无关","confidence":1}]\n```'
    expect(parseJudge(reply, 'a.md', ['b.md', 'c.md'])).toEqual([{ a: 'a.md', b: 'c.md', level: 'same-topic', confidence: 0.8, why: 'x', quoteA: 'q', quoteB: 'r' }])
    expect(() => parseJudge('我觉得相关', 'a.md', ['b.md'])).toThrow('AI 没给出能读的判断')
  })

  it('原话逐字核对：空白、标点、markdown 记号不算差别；编出来的、太短的不算', () => {
    expect(quoteIn('冰岛的火山很多,几乎每年都有喷发', A)).toBe(true)
    expect(quoteIn('「冰岛的火山很多」…', A)).toBe(true)
    expect(quoteIn('冰岛的火山特别多', A)).toBe(false)
    expect(quoteIn('冰岛', A)).toBe(false)
  })

  it('同一主题 ≥ 0.8 补双链，0.5 到 0.8 拿不准，0.5 以下不提；同一内容进可能重复；原话对不上作废（线是评测那一路定的）', () => {
    expect(SURE).toBe(0.8)
    expect(UNSURE).toBe(0.5)
    expect(verdictOf(j({ confidence: 0.8 }), A, B)).toBe('link')
    expect(verdictOf(j({ confidence: 0.79 }), A, B)).toBe('unsure')
    expect(verdictOf(j({ confidence: 0.5 }), A, B)).toBe('unsure')
    expect(verdictOf(j({ confidence: 0.49 }), A, B)).toBe('skip')
    expect(verdictOf(j({ level: 'unsure', confidence: 0.3 }), A, B)).toBe('unsure')
    expect(verdictOf(j({ level: 'same-content' }), A, B)).toBe('dup')
    expect(verdictOf(j({ level: 'tangential' }), A, B)).toBe('skip')
    expect(verdictOf(j({ quoteB: '冰岛有很多冰川' }), A, B)).toBe('void')
  })

  it('复查旧的「相关：」：判成无关、沾边又有把握才建议去掉', () => {
    expect(verdictOf(j({ level: 'unrelated', quoteA: '', quoteB: '' }), A, B, true)).toBe('remove')
    expect(verdictOf(j({ level: 'tangential', confidence: 0.6 }), A, B, true)).toBe('skip')
    expect(verdictOf(j({ level: 'same-topic' }), A, B, true)).toBe('skip')
  })

  it('理由里问 AI 时的代号换成人话：A 是这篇，B几 是那篇的名字；C++、A 股这种不动', () => {
    expect(humanWhy('两篇都讲一致性，B5 是 A 的专门回顾', '课程/01-连贯性.md')).toBe('两篇都讲一致性，「01-连贯性」是这篇的专门回顾')
    expect(humanWhy('都讲 C++ 和 GPT-4A 的接口', 'x.md')).toBe('都讲 C++ 和 GPT-4A 的接口')
  })

  it('去掉那一行：只剩它整行去掉（连同梦游加的空行），还有别的只去掉它', () => {
    expect(dropRelated('正文\n\n相关：[[冰岛]]\n', '冰岛')).toBe('正文\n')
    expect(dropRelated('正文\n\n相关：[[冰岛]]、[[火山]]\n', '冰岛')).toBe('正文\n\n相关：[[火山]]\n')
    expect(dropRelated('正文 [[冰岛]]\n', '冰岛')).toBe('正文 [[冰岛]]\n')
  })
})

describe('别人的库：文件夹不叫分类名、日记里抄着同一份任务清单', () => {
  it('好几篇都抄着的行去掉：三篇以上都有的一行、两篇以上都有的任务行；「相关：」行留着', () => {
    const task = '- [ ] 🚗 背诵驾照考试单词与词组 📅 2026-08-26 ^dida-6a8e10d3'
    const m = new Map([
      ['a.md', `# 11-01\n\n## 📌 今天核心\n去健身房练腿。\n${task}\n相关：[[b]]`],
      ['b.md', `# 11-02\n\n## 📌 今天核心\n读完半本书。\n${task.replace('6a8e10d3', 'ffff0000')}`],
      ['c.md', '# 11-03\n\n## 📌 今天核心\n下雨在家。\n相关：[[b]]'],
    ])
    const out = stripShared(m)
    expect(out.get('a.md')).toBe('# 11-01\n\n去健身房练腿。\n相关：[[b]]')
    expect(out.get('b.md')).toBe('# 11-02\n\n读完半本书。')
  })

  it('属性块原样留着：三篇都写「source: weread」也不去掉，正文照旧认得出属性块', () => {
    const m = new Map([
      ['a.md', '---\nsource: weread\n---\n# 甲\n\n甲的正文第一句。'],
      ['b.md', '---\nsource: weread\n---\n# 乙\n\n乙的正文第一句。'],
      ['c.md', '---\nsource: weread\n---\n# 丙\n\n丙的正文第一句。'],
    ])
    expect(stripShared(m).get('a.md')).toBe('---\nsource: weread\n---\n# 甲\n\n甲的正文第一句。')
  })
})

describe('进度和每晚上限', () => {
  it('指纹不算属性和「相关：」行：收下一条双链不会让这篇重判', () => {
    expect(noteFp('---\na: 1\n---\n正文\n\n相关：[[x]]\n')).toBe(noteFp('正文\n'))
    expect(noteFp('正文改了\n')).not.toBe(noteFp('正文\n'))
  })

  it('早上 6 点换一晚；今晚还能问几次', () => {
    expect(nightOf(new Date(2026, 10, 24, 1, 0))).toBe('2026-11-23')
    expect(nightOf(new Date(2026, 10, 24, 7, 0))).toBe('2026-11-24')
    const l = emptyLedger()
    l.nights['2026-11-23'] = { asked: 18, notes: 18 }
    expect(leftTonight(l, new Date(2026, 10, 24, 2, 0), 20)).toBe(2)
    expect(leftTonight(l, new Date(2026, 10, 24, 9, 0), 20)).toBe(20)
  })

  it('设置：判断用哪家、模型、每晚上限读回来一项项检查；旧设置里的本地模型丢掉', () => {
    expect(DEFAULT_DREAM.judge).toEqual({ engine: 'claude', model: 'sonnet', effort: 'medium' })
    expect(DEFAULT_DREAM.nightCap).toBe(500)
    expect(normalizeDream({ judge: { via: 'x', engine: 'nope', model: 'a b;rm' }, nightCap: 7 })).toMatchObject({ judge: DEFAULT_DREAM.judge, nightCap: 500 })
    // 以前选过本地模型的：读回来是走订阅的那一家（via、local 不再有）
    expect(normalizeDream({ judge: { via: 'local', engine: 'claude', model: 'haiku', effort: 'low', local: 'qwen3-4b-2507-q4km' } }).judge).toEqual({ engine: 'claude', model: 'haiku', effort: 'low' })
    const s = patchDream(DEFAULT_DREAM, { judge: { model: 'haiku' }, nightCap: 20 })
    expect(s.judge).toEqual({ ...DEFAULT_DREAM.judge, model: 'haiku' })
    expect(s.nightCap).toBe(20)
  })

  it('设置里换到 Codex：它的模型表里有推荐的那个就默认选它，没有就用 Codex 自己的默认', () => {
    const rec = JUDGE_DEFAULTS.codex!
    const codexModels = [{ id: '' }, { id: rec.model }, { id: 'gpt-x' }]
    expect(judgeOnFamily(DEFAULT_DREAM.judge, { engine: 'codex' }, codexModels)).toEqual({ engine: 'codex', model: rec.model, effort: rec.effort })
    expect(judgeOnFamily(DEFAULT_DREAM.judge, { engine: 'codex' }, [{ id: '' }])).toEqual({ engine: 'codex', model: '', effort: '' })
    // 换回 Claude Code：Sonnet · Medium
    expect(judgeOnFamily({ engine: 'codex', model: 'gpt-x', effort: 'low' }, { engine: 'claude', model: 'opus' }, [{ id: 'sonnet' }, { id: 'opus' }])).toEqual({ engine: 'claude', model: 'sonnet', effort: 'medium' })
    // 没有推荐的那一家照选择器给的
    expect(judgeOnFamily(DEFAULT_DREAM.judge, { engine: 'gemini' }, [{ id: '' }])).toEqual({ engine: 'gemini', model: '', effort: '' })
    // Codex 推荐的是 GPT-6.1 Terra · Medium；自动连的线：Sonnet 0.8，Haiku 0.85，Codex 0.95
    expect(rec).toEqual({ model: 'gpt-6.1-terra', effort: 'medium' })
    expect(judgeLine({ engine: 'claude', model: 'sonnet' }).pass).toBe(0.8)
    expect(judgeLine({ engine: 'claude', model: 'haiku' }).pass).toBe(0.85)
    expect(judgeLine({ engine: 'codex', model: 'gpt-6.1-terra' }).pass).toBe(0.95)
  })
})

/** 问 AI 的话里只有名字：路径换成名字再比 */
const name = (p: string) => p.replace(/\.md$/, '').split('/').pop()!
const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

/** 25 篇收件箱，每篇都和「冰岛总览」讲同一件事（各自一句独有的话，免得互相是重复） */
function vault(): Record<string, string> {
  const v: Record<string, string> = {
    '冰岛总览.md': '# 冰岛总览\n\n冰岛位于大西洋中脊上，火山、冰川、地热温泉和极光是这里最出名的四样东西。\n',
    '剪藏/冰岛的火山.md': '# 冰岛的火山\n\n冰岛的火山沿着大西洋中脊分布，地热温泉也是火山带来的。\n\n相关：[[马拉松训练]]\n',
    '马拉松训练.md': '# 马拉松训练\n\n每周跑量从三十公里慢慢加到六十公里，长距离慢跑放在周末，配速比比赛慢一分钟。\n',
  }
  const towns = ['雷克雅未克', '维克', '赫本', '阿克雷里', '塞济斯菲厄泽', '斯奈山', '黄金圈', '杰古沙龙', '米湖', '胡萨维克']
  for (let i = 1; i <= 25; i++) v[`收件箱/冰岛笔记 ${i}.md`] = `冰岛笔记第 ${i} 篇：第 ${i} 天住在${towns[i % 10]}，看了火山和冰川，晚上泡地热温泉等极光，详见冰岛总览。\n`
  return v
}

describe('一晚到上限停下、剩下的下一晚接着、打断了接着判不重复问', { timeout: 60_000 }, () => {
  let base: string
  let root: string
  let ledgerFile: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'cn-judge-'))
    root = join(base, '库')
    ledgerFile = join(base, 'ledger.json')
    mkdirSync(root)
    g(root, 'init', '-q', '-b', 'main')
    g(root, 'config', 'user.name', 'Test')
    g(root, 'config', 'user.email', 'test@example.com')
    for (const [p, t] of Object.entries(vault())) {
      mkdirSync(dirname(join(root, p)), { recursive: true })
      writeFileSync(join(root, p), t)
    }
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', '样本')
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  const only = (s: Partial<DreamSettings>): DreamSettings => ({ ...DEFAULT_DREAM, ...s, steps: { ...DEFAULT_DREAM.steps, file: false, rename: false, week: false, viz: false, attach: false, dup: false, video: false } })
  /** 记下每一问问的是哪篇 */
  const asked: string[] = []
  const judge = async (_s: string, p: string) => {
    if (isWikiPrompt(p)) return '```json\n[]\n```'
    asked.push(/^=== A ===\n标题：(.+)$/m.exec(p)![1]!)
    return fakeJudge(p)
  }
  const run = (s: Partial<DreamSettings>, now: Date, signal?: AbortSignal) =>
    runDream({ root, scratch: join(base, 'scratch'), ask: async () => '', judge, judgeBy: '测试 · 假的', ledgerFile, trigger: 'manual', now, settings: only(s), judgeParallel: 2, ...(signal ? { signal } : {}) })

  it('上限 20：判 20 篇停下，报告说还剩几篇；第二晚只判剩下的，判过的不再问', async () => {
    asked.length = 0
    const night1 = new Date(2026, 10, 23, 23, 0)
    const r1 = await run({ nightCap: 20, linkMax: 100 }, night1)
    expect(asked.length).toBe(20)
    expect(r1.judge).toMatchObject({ by: '测试 · 假的', asked: 20, cap: 20, capped: true, left: 6, sources: ['关键词', '标题'] })
    // 同一晚再跑：额度用完，一问不问，判过的照样列出来
    asked.length = 0
    const r1b = await run({ nightCap: 20, linkMax: 100 }, new Date(2026, 10, 24, 2, 0))
    expect(asked).toEqual([])
    expect(r1b.judge).toMatchObject({ asked: 0, left: 6, capped: true })
    expect(r1b.items.filter((i) => i.group === 'link').length).toBe(r1.items.filter((i) => i.group === 'link').length)
    // 第二晚：只问剩下的 6 篇，一篇不重复
    const first = new Set(Object.keys((await loadLedger(ledgerFile)).done).map(name))
    asked.length = 0
    const r2 = await run({ nightCap: 20, linkMax: 100 }, new Date(2026, 10, 24, 23, 0))
    expect(asked.length).toBe(6)
    expect(asked.filter((p) => first.has(p))).toEqual([])
    expect(r2.judge).toMatchObject({ asked: 6, left: 0, capped: false })
  })

  it('判到一半被打断（睡眠）：判完的记着，接着跑只问没判的', async () => {
    asked.length = 0
    const stop = new AbortController()
    const slow = async (s: string, p: string) => {
      if (isWikiPrompt(p)) return '```json\n[]\n```'
      await judge(s, p)
      if (asked.length === 5) stop.abort()
      return fakeJudge(p)
    }
    await expect(runDream({ root, scratch: join(base, 'scratch'), ask: async () => '', judge: slow, judgeBy: 'x', ledgerFile, trigger: 'idle', now: new Date(2026, 10, 23, 23, 0), settings: only({}), judgeParallel: 1, signal: stop.signal })).rejects.toBeInstanceOf(DreamInterrupted)
    const done = Object.keys((await loadLedger(ledgerFile)).done).map(name)
    expect(done.length).toBeGreaterThanOrEqual(4)
    // 打断留下的半截分支：下次梦游前清掉
    asked.length = 0
    const r = await run({}, new Date(2026, 10, 24, 0, 30))
    expect(asked.filter((p) => done.includes(p))).toEqual([])
    expect(asked.length).toBe(26 - done.length)
    expect(r.judge!.cached).toBe(done.length)
  })

  it('复查旧「相关：」：判成无关的列成「建议去掉」，收下才删那一行；丢掉过的一对以后不再提', async () => {
    const r = (await run({}, new Date(2026, 10, 23, 23, 0))) as DreamReportInternal
    const rc = r.items.filter((i) => i.group === 'recheck')
    expect(rc.map((i) => [i.title, i.sub])).toEqual([['冰岛的火山', '相关：[[马拉松训练]] · 无关']])
    expect(readFileSync(join(root, '剪藏/冰岛的火山.md'), 'utf8')).toContain('相关：[[马拉松训练]]')
    await takeItem(root, r, rc[0]!.id)
    expect(readFileSync(join(root, '剪藏/冰岛的火山.md'), 'utf8')).toBe('# 冰岛的火山\n\n冰岛的火山沿着大西洋中脊分布，地热温泉也是火山带来的。\n')
    // 丢掉一条补双链：这一对记进「不再建议」，下次不再提
    const link = r.items.find((i) => i.group === 'link' && i.state === 'pending')!
    await dropItem(root, r, link.id)
    await rememberChoice(ledgerFile, link, 'drop')
    const r2 = await run({}, new Date(2026, 10, 24, 23, 0))
    expect(r2.items.some((i) => i.group === 'link' && i.title === link.title && i.sub === link.sub)).toBe(false)
  })

  it('向量那一路找来的候选也一起问，报告写用了哪几路', async () => {
    const prompts: string[] = []
    const judge2 = async (_s: string, p: string) => (isWikiPrompt(p) ? '```json\n[]\n```' : (prompts.push(p), fakeJudge(p)))
    const related = async (paths: string[]) => ({ model: 'bge-m3-int8', map: new Map(paths.map((p) => [p, [{ path: '马拉松训练.md', score: 0.5, mine: '', theirs: '每周跑量从三十公里慢慢加到六十公里' }]])) })
    const r = await runDream({ root, scratch: join(base, 'scratch'), ask: async () => '', judge: judge2, judgeBy: 'x', trigger: 'manual', now: new Date(2026, 10, 23, 23, 0), settings: only({}), similar: { links: async () => [], duplicates: async () => [], related } })
    expect(r.judge!.sources).toEqual(['关键词', '向量（bge-m3-int8）', '标题'])
    expect(prompts.find((p) => p.includes('标题：冰岛笔记 1\n'))).toContain('标题：马拉松训练')
  })

  it('Obsidian 搬来的库：00-Inbox、40-Clippings 里也补双链；日记只靠抄着的任务清单像，不连', async () => {
    const task = (i: number) => `- [ ] 💻 开发网页时：把Eagle也集成到个人主页里能看到 📅 2026-08-06 ^dida-${i}`
    const files: Record<string, string> = {
      '00-Inbox/冰岛火山随手记.md': '去蓝湖泡温泉，硅藻泥面膜和二氧化硅让池水呈乳蓝色，印象最深；门票要提前在官网订。\n',
      '40-Clippings/蓝湖温泉.md': '# 蓝湖温泉\n\n蓝湖是地热电站排出的海水形成的池子，二氧化硅和硅藻泥让池水呈乳蓝色，门票需提前在官网预订。\n',
    }
    for (let d = 1; d <= 6; d++) files[`00-Inbox/2026-11-0${d}.md`] = `# 2026-11-0${d}\n\n## ✅ 任务\n\n${[1, 2, 3, 4].map(task).join('\n')}\n- [ ] 🚗 背诵驾照考试单词与词组 📅 2026-08-26 ^dida-9\n\n## 📌 今天核心\n\n第 ${d} 天：${['练腿', '读书', '下雨在家', '去超市', '写周报', '看电影'][d - 1]}。\n`
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(dirname(join(root, p)), { recursive: true })
      writeFileSync(join(root, p), t)
    }
    g(root, 'add', '-A')
    g(root, 'commit', '-qm', 'obsidian')
    const r = await run({}, new Date(2026, 10, 23, 23, 0))
    const links = r.items.filter((i) => i.group === 'link' || i.group === 'unsure').map((i) => `${i.title} ${i.sub}`)
    // 两个不叫分类名的文件夹里的笔记都补上了双链（以前一条都不补）
    expect(links.some((l) => l.startsWith('冰岛火山随手记 '))).toBe(true)
    expect(links.some((l) => l.startsWith('蓝湖温泉 ') || l.includes('[[蓝湖温泉]]'))).toBe(true)
    expect(links.filter((l) => /^2026-11-0\d/.test(l))).toEqual([])
  })

  it('拿不准的单列一组：带理由、把握和两边原话，收下就补上那一行', async () => {
    const p = '收件箱/冰岛笔记 3.md'
    writeFileSync(join(root, p), readFileSync(join(root, p), 'utf8') + '（测试判断：冰岛总览=unsure:0.6）\n')
    g(root, 'commit', '-qam', '改一篇')
    const r = (await run({}, new Date(2026, 10, 23, 23, 0))) as DreamReportInternal
    const u = r.items.filter((i) => i.group === 'unsure')
    expect(u.map((i) => [i.title, i.sub])).toEqual([['冰岛笔记 3', '↔ [[冰岛总览]] · 把握 0.60']])
    expect(u[0]!.judged).toMatchObject({ level: 'unsure', confidence: 0.6, a: { path: p, quote: expect.stringContaining('冰岛笔记第 3 篇') }, b: { path: '冰岛总览.md' } })
    await takeItem(root, r, u[0]!.id)
    // 写法照 Wiki 那节 A1：原句里「冰岛总览」那几个字变成链接，不加「相关：」行
    const after = readFileSync(join(root, p), 'utf8')
    expect(after).toContain('详见[[冰岛总览]]。')
    expect(after).not.toContain('相关：')
  })
})
