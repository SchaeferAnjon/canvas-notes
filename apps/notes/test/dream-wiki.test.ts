/**
 * 梦游 Wiki 化（task-h7oy8，设计页 24-梦游底层 W 节，用户定 A1 B1 C1 D1）：
 * 原句里的字链到 B 的整篇 / 那一节 / 那一段、没有标题的段收下时才加块编号、AI 写的标题核对真在 B 里（原型错的 3 条）、
 * 同一段被两条用到只收后一条时补上块编号、撤回一字节不差、词条页建议和点了才建、别名建议。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { onlyBlockIdsAdded, outline } from '@cn/format'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type DreamReportInternal, runDream, takeItem, undo } from '../src/main/dream'
import { loadLedger } from '../src/main/dream-ledger'
import { clausesOf, findHits } from '../src/main/wiki-find'
import { fakeWiki } from '../src/main/wiki-fake'
import { entryFolder, entrySources, planEntry } from '../src/main/wiki-entry-main'
import { DEFAULT_DREAM, type DreamSettings } from '../src/shared/dream-settings'
import { fakeEntry, fakeEntryLinks, isEntryLinkPrompt } from '../src/shared/wiki-entry'
import { isWikiPrompt, parseWiki } from '../src/shared/wiki-judge'
import { fakeJudge, isJudgePrompt } from '../src/main/dream-judge'

const g = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

const TRAIN = '收件箱/2026-10-11.md'
const TRIP = '收件箱/2026-10-18.md'
const DAY1 = '课程/欧洲史/Day-001.md'
const ANAT = '课程/解剖02-练胸.md'
const PLAN = '剪藏/三分化训练计划.md'

function vault(): Record<string, string> {
  return {
    [TRAIN]: '---\ntags: [日记]\n---\n# 2026-10-11\n\n- 训练：胸·三头——杠铃卧推 60kg×6×3、上斜哑铃卧推 26kg×8×3、双杠臂屈伸 自重×5、蝴蝶机夹胸 45kg。\n- 今天晚上去海德堡老城区玩了。\n- 读完《极简欧洲史》第一章。\n',
    [TRIP]: '# 2026-10-18\n\n朋友来了，带他去海德堡老城区走了一圈，桥上人很多。\n',
    [ANAT]:
      '# 解剖02-练胸\n\n胸大肌分锁骨部和胸肋部，练法各不相同。\n\n## 八、动作评述③：杠铃卧推（多关节）\n\n杠铃卧推是胸肌的基础多关节动作，肩胛后缩下沉。\n\n## 九、动作评述④：双杠臂屈伸（多关节） 52:56\n\n双杠臂屈伸身体前倾练胸，直立练三头。\n\n第二段：退阶用辅助器械。\n',
    [PLAN]:
      '# 三分化训练计划\n\n新老派结合的增肌方案，一周三练。\n\n## 补充：胸肩三头技术详解\n\n- 上斜哑铃卧推（辅助）：角度三十度，握距略宽于肩，下落要慢。\n- 绳索下压：大臂夹紧，只动小臂。\n- 侧平举：肘略高于手腕。\n',
    [DAY1]:
      '# Day-001 Geographic Skeleton\n\n## 3. 欧洲的地理骨架\n\n莱茵河从阿尔卑斯山流到北海，沿岸城市一个接一个。\n\n海德堡注脚：1689 年和 1693 年法军两次攻破这里，城堡残垣立在海德堡老城区上方。\n\n多瑙河向东流进黑海，是另一条大动脉。\n',
    '读书/极简欧洲史.md': '# 极简欧洲史\n\n这本书把欧洲两千年讲成三条线：古典、基督教、日耳曼战士。\n',
    '生活/搬家.md': '# 搬家\n\n#地方/海德堡 找房子太难了，海德堡的学生宿舍排队一年。\n',
    '生活/语言班.md': '# 语言班\n\n#地方/海德堡 语言班在老城旁边，每天走过海德堡的老桥。\n',
    '生活/选课.md': '# 选课\n\n海德堡大学的选课系统很难用。\n',
  }
}

describe('切句、找候选（不碰 git）', () => {
  it('一行按句号切；「、」隔开的清单拆成一项项；标题、任务、相关行不算', () => {
    const cs = clausesOf(vault()[TRAIN]!)
    expect(cs.map((c) => c.text)).toEqual(['训练：胸·三头——杠铃卧推 60kg×6×3', '上斜哑铃卧推 26kg×8×3', '双杠臂屈伸 自重×5', '蝴蝶机夹胸 45kg。', '今天晚上去海德堡老城区玩了。', '读完《极简欧洲史》第一章。'])
    expect(clausesOf('# 题\n\n- [ ] 交房租 📅 2026-09-30\n相关：[[x]]\n## 相关\n- [[a]] 讲 a 的一篇很长的笔记\n')).toEqual([])
  })

  it('全库每一段里直接找：名字、标题那一截、关键词三路各给得出', () => {
    const v = vault()
    const cs = clausesOf(v[TRAIN]!)
    const [hits] = findHits(Object.entries(v), [[TRAIN, cs.map((c) => c.text)]])
    // 双杠臂屈伸 → 解剖02 第九节（标题那一截）
    expect(hits![2]!.head[0]).toMatchObject({ path: ANAT, name: '双杠臂屈伸' })
    // 极简欧洲史 → 整篇（名字）
    expect(hits![5]!.name[0]).toMatchObject({ path: '读书/极简欧洲史.md', i: -1 })
    // 上斜哑铃卧推 → 三分化里专讲它的那一条（关键词）
    expect(hits![1]!.kw[0]).toMatchObject({ path: PLAN })
    // 日记、按日子起名的不当 B
    expect(findHits([['2026-10-11.md', '双杠臂屈伸这一段讲了很多很多很多东西。'], ...Object.entries(v)], [[TRAIN, ['双杠臂屈伸']]])[0]![0]!.kw.some((h) => h.path === '2026-10-11.md')).toBe(false)
  })

  it('读回答：编号不对、级别不认识、没写字的去掉', () => {
    const r = parseWiki('```json\n[{"c":1,"links":[{"p":1,"level":"这一节","heading":"九","words":"双杠","quote":"q","confidence":0.9},{"p":9,"level":"整篇","words":"x"},{"p":1,"level":"别的","words":"y"},{"p":1,"level":"整篇","words":""}],"thing":"双杠臂屈伸"},{"c":7,"links":[]}]\n```', 2, () => 2)
    expect(r).toEqual([{ clause: 0, links: [{ cand: 0, level: 'heading', heading: '九', words: '双杠', quote: 'q', confidence: 0.9, reason: '' }], thing: '双杠臂屈伸' }])
    expect(parseWiki('不知道', 1, () => 1)).toBeNull()
  })
})

describe('梦游一整次（样本库）', { timeout: 60_000 }, () => {
  let base: string
  let root: string
  let ledgerFile: string
  const prompts: string[] = []
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'cn-wiki-'))
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
    prompts.length = 0
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  const set: DreamSettings = { ...DEFAULT_DREAM, steps: { ...DEFAULT_DREAM.steps, file: false, rename: false, week: false, viz: false, attach: false, dup: false, video: false } }
  const fake = (wiki: (p: string) => string = fakeWiki) => async (_s: string, p: string) => {
    if (isWikiPrompt(p)) return (prompts.push(p), wiki(p))
    if (isJudgePrompt(p)) return fakeJudge(p)
    return ''
  }
  const run = (wiki?: (p: string) => string) => runDream({ root, scratch: join(base, 'scratch'), ask: async () => '', judge: fake(wiki), judgeBy: '测试 · 假的', ledgerFile, trigger: 'manual', now: new Date(2026, 10, 23, 23, 0), settings: set }) as Promise<DreamReportInternal>

  it('A1：原句里的字链到那一节 / 那一段 / 整篇；B1：链到一段的那段行尾加块编号（只在收下时进 main），B 别的字不动；撤回一字节不差', async () => {
    const before = Object.fromEntries(Object.keys(vault()).map((p) => [p, readFileSync(join(root, p))]))
    const r = await run()
    const items = r.items.filter((i) => i.group === 'link' || i.group === 'unsure')
    const train = items.filter((i) => i.files[0] === TRAIN)
    // 同一行的几处合成一条（分开收时同一行合不上）
    const line1 = train.find((i) => i.wiki!.links.some((l) => l.words === '双杠臂屈伸'))!
    expect(line1.wiki!.links.map((l) => [l.words, l.path, l.level, l.anchor])).toEqual([
      ['杠铃卧推', ANAT, 'heading', '八、动作评述③：杠铃卧推（多关节）'],
      ['上斜哑铃卧推', PLAN, 'block', expect.stringMatching(/^\^[a-z][a-z0-9]{5}$/)],
      ['双杠臂屈伸', ANAT, 'heading', '九、动作评述④：双杠臂屈伸（多关节） 52:56'],
    ])
    // 还没收下：main 上的文件一个字节没动
    for (const [p, b] of Object.entries(before)) expect(readFileSync(join(root, p)).equals(b)).toBe(true)
    await takeItem(root, r, line1.id)
    const a = readFileSync(join(root, TRAIN), 'utf8')
    const id = line1.wiki!.links[1]!.anchor.slice(1)
    expect(a).toContain(
      `- 训练：胸·三头——[[解剖02-练胸#八、动作评述③：杠铃卧推（多关节）|杠铃卧推]] 60kg×6×3、[[三分化训练计划#^${id}|上斜哑铃卧推]] 26kg×8×3、[[解剖02-练胸#九、动作评述④：双杠臂屈伸（多关节） 52:56|双杠臂屈伸]] 自重×5、蝴蝶机夹胸 45kg。`,
    )
    // 只有这一行变了
    expect(a.split('\n').filter((l, i) => l !== vault()[TRAIN]!.split('\n')[i])).toHaveLength(1)
    const plan = readFileSync(join(root, PLAN), 'utf8')
    expect(plan).toContain(`- 上斜哑铃卧推（辅助）：角度三十度，握距略宽于肩，下落要慢。 ^${id}`)
    expect(onlyBlockIdsAdded(vault()[PLAN]!, plan)).toBe(true)
    // 撤回：两个文件回到原样，一字节不差
    await undo(root, r, [line1.id], line1.taken)
    expect(readFileSync(join(root, TRAIN)).equals(before[TRAIN]!)).toBe(true)
    expect(readFileSync(join(root, PLAN)).equals(before[PLAN]!)).toBe(true)
  })

  it('同一段被两篇用到：只收后一条时 B 里也补上块编号，链接不断', async () => {
    const r = await run()
    const hd = r.items.filter((i) => i.wiki?.links.some((l) => l.path === DAY1))
    expect(hd.map((i) => i.files[0]).sort()).toEqual([TRIP, TRAIN].sort())
    const anchors = new Set(hd.map((i) => i.wiki!.links.find((l) => l.path === DAY1)!.anchor))
    expect(anchors.size).toBe(1)
    // 第二条的提交里没碰 Day-001（第一条加过了）
    const second = hd.find((i) => !i.files.includes(DAY1))!
    await takeItem(root, r, second.id)
    const day = readFileSync(join(root, DAY1), 'utf8')
    const id = [...anchors][0]!.slice(1)
    expect(day).toContain(`城堡残垣立在海德堡老城区上方。 ^${id}`)
    expect(outline(day).passages.find((p) => p.id === id)!.text).toContain('海德堡注脚')
    expect(onlyBlockIdsAdded(vault()[DAY1]!, day)).toBe(true)
  })

  it('这一节：只认 AI 写的标题、核对它真在 B 里（原型错的 3 条落在候选给的那一节）；B 里没有那个标题的作废', async () => {
    // AI 说「九」那一节，候选给的是开头那段（没有标题）
    const wiki = (heading: string) => (p: string) => {
      const n = (p.match(/^C\d+：/gm) ?? []).length
      const out = Array.from({ length: n }, (_, i) => ({ c: i + 1, links: [] as unknown[], thing: '' }))
      const k = [...p.matchAll(/^C(\d+)：(.*)$/gm)].find((m) => m[2]!.startsWith('双杠臂屈伸'))
      const pIx = k ? [...p.split(/\n(?=C\d+：)/).find((b) => b.startsWith(`C${k[1]}：`))!.matchAll(/^ {2}P(\d+)（N\d+/gm)][0]![1] : '1'
      if (k) out[Number(k[1]) - 1]!.links.push({ p: Number(pIx), level: '这一节', heading, words: '双杠臂屈伸', quote: '', confidence: 0.92, reason: '那一节专讲它' })
      return '```json\n' + JSON.stringify(out) + '\n```'
    }
    const r = await run(wiki('九 动作评述④ 双杠臂屈伸(多关节) 52:56'))
    const it = r.items.find((i) => i.wiki?.links.some((l) => l.words === '双杠臂屈伸'))!
    // 标题少了标点也认，写进文件的是 B 里真的那个标题
    expect(it.wiki!.links[0]!.anchor).toBe('九、动作评述④：双杠臂屈伸（多关节） 52:56')
    rmSync(ledgerFile)
    const r2 = await run(wiki('十、没有这一节'))
    expect(r2.items.some((i) => i.wiki?.links.some((l) => l.words === '双杠臂屈伸'))).toBe(false)
    expect(r2.wiki!.voided).toBeGreaterThanOrEqual(1)
  })

  it('判过的按 A 的指纹记着：A 没改不再问 AI，照样列出来', async () => {
    const r1 = await run()
    const n = prompts.length
    expect(n).toBeGreaterThan(0)
    const r2 = await run()
    expect(prompts.length).toBe(n)
    expect(r2.wiki).toMatchObject({ asked: 0 })
    expect(r2.items.filter((i) => i.wiki).length).toBe(r1.items.filter((i) => i.wiki).length)
    expect(Object.keys((await loadLedger(ledgerFile)).wiki)).toEqual(expect.arrayContaining([TRAIN, TRIP]))
  })

  it('C1：三篇以上提到、没有讲它的一篇 → 词条页建议（只是建议，没有提交）；点了才建：嵌进讲它的段，要嵌的段加块编号', async () => {
    const r = await run()
    const e = r.items.find((i) => i.group === 'entry')!
    expect(e.entry).toMatchObject({ name: '海德堡' })
    expect(e.entry!.count).toBeGreaterThanOrEqual(4)
    expect(e.commit).toBeNull()
    const texts = new Map(Object.entries(vault()))
    expect(entrySources(texts, '海德堡').map((s) => s.path)).toContain(DAY1)
    const plan = await planEntry({ texts, name: '海德堡', prefer: e.entry!.notes, ask: async (_s, p) => (isEntryLinkPrompt(p) ? fakeEntryLinks(p) : fakeEntry(p)), by: '测试', rand: () => 0.42 })
    // 建好以后提到它的地方链过来：每篇第一处（标签里的不算），同名的另一个东西（海德堡大学）拿不准、不改
    expect(plan.linked.map((l) => l.path).sort()).toEqual(['收件箱/2026-10-11.md', '收件箱/2026-10-18.md', '生活/搬家.md', '生活/语言班.md', '课程/欧洲史/Day-001.md'].sort())
    expect(plan.unsure).toEqual([{ path: '生活/选课.md', words: '海德堡', quote: '海德堡大学的选课系统很难用。' }])
    const after = (p: string) => plan.edits.find((x) => x.path === p)!.after
    // 那一段要嵌进词条页时行尾还多一个块编号（同一次改动）
    expect(after('生活/搬家.md')).toMatch(/^# 搬家\n\n#地方\/海德堡 找房子太难了，\[\[海德堡\]\]的学生宿舍排队一年。( \^[a-z][a-z0-9]{5})?\n$/)
    expect(after('收件箱/2026-10-18.md')).toMatch(/^# 2026-10-18\n\n朋友来了，带他去\[\[海德堡\]\]老城区走了一圈，桥上人很多。( \^[a-z][a-z0-9]{5})?\n$/)
    // 选课那一段可能被嵌进词条页（行尾加块编号），但「海德堡」那几个字不链
    expect(plan.edits.find((x) => x.path === '生活/选课.md')?.after ?? '').not.toContain('[[海德堡')
    // 词条页放库最外层的「词条/」（不再放收件箱）
    expect(plan.path).toBe('词条/海德堡.md')
    expect(plan.text).toMatch(/^---\n类型: 词条\n来源: 梦游建议\n---\n# 海德堡\n\n> \[!ai\] 梦游起草的词条 · 测试\n/)
    expect(plan.text).toMatch(/!\[\[Day-001#\^[a-z][a-z0-9]{5}\]\]/)
    // 去掉链过来的 [[海德堡]]，剩下只多了块编号
    for (const ed of plan.edits) expect(onlyBlockIdsAdded(ed.before, ed.after.split('[[海德堡]]').join('海德堡'))).toBe(true)
    // 已经有这一篇了不再建
    await expect(planEntry({ texts: new Map([...texts, ['生活/海德堡.md', '# 海德堡\n\n一篇。']]), name: '海德堡', ask: async () => '', by: '' })).rejects.toThrow('已经有一篇叫「海德堡」了')
  })

  it('词条页放哪：没有词条文件夹放「词条」；库里有词条 / MOC / Wiki 一类的最外层文件夹用它；梦游.md 里定过的先', () => {
    expect(entryFolder(['收件箱/a.md', '生活/b.md'])).toBe('词条')
    expect(entryFolder(['收件箱/a.md', 'MOC/首页.md'])).toBe('MOC')
    expect(entryFolder(['00-Inbox/a.md', '20 Wiki/x.md'])).toBe('20 Wiki')
    // 推断出两个、用户在梦游.md 里把「卡片盒」定成词条：用用户定的
    const rows = [
      { folder: 'MOC', role: 'wiki' as const, why: '', sure: 'high' as const },
      { folder: '卡片盒', role: 'wiki' as const, why: '', sure: 'high' as const },
    ]
    expect(entryFolder(['MOC/a.md', '卡片盒/b.md'], { rows, guessed: ['MOC'] })).toBe('卡片盒')
  })
})
