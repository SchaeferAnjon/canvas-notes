import { describe, expect, it } from 'vitest'
import { buildRows, type Cursor, cursorAt, defaultIndex, type Group, groupHead, keyIsFinal, rowOf, type RowsInput, step } from '../src/renderer/search/rows'

type C = { name: string; hint?: string; alias?: string; hidden?: boolean; pinned?: boolean; usedRank?: number }

const base = (o: Partial<RowsInput<C>>): RowsInput<C> => ({
  q: '矩阵',
  recent: [],
  pdfNames: [],
  hits: [],
  pdfHits: [],
  meaning: [],
  commands: [],
  url: 'https://www.google.com/search?q=%E7%9F%A9%E9%98%B5',
  looksUrl: false,
  expanded: new Set<Group>(),
  claude: { phase: 'idle' },
  ...o,
})

const kinds = (rows: { kind: string; group: string }[]) => rows.map((r) => `${r.group}:${r.kind}`)
const cmdName = (r: unknown) => (r as { cmd: { name: string } }).cmd.name

describe('⌘K 打字以后的行（cmdk 方案 A：最合适 → 笔记 → 命令 → 笔记和PDF里的字 → 意思相近 → 网页和AI）', () => {
  it('没打字：这里不出行（没打字时的八组在 cmd-layout 里排）', () => {
    expect(buildRows(base({ q: '', recent: ['a.md'], commands: [{ name: '换主题…' }] }))).toEqual([])
  })

  it('排法：最合适一条 → 名字对上的笔记和 PDF → 命令 → 正文和 PDF 页轮流 → 意思相近 → 网页 → 让 Claude 找', () => {
    const rows = buildRows(
      base({
        pdfNames: ['课程/矩阵论.pdf', '课程/别的.pdf'],
        hits: [
          { path: '正文里有.md', snippet: '…矩阵…' },
          { path: '矩阵笔记.md', snippet: '' },
        ],
        pdfHits: [{ path: '课程/第3讲.pdf', page: 4, snippet: '矩阵 A' }],
        meaning: [
          { path: '课程/第3讲.pdf', page: 4, snippet: '重复的，不列', score: 0.9 },
          { path: '课程/第3讲.pdf', page: 5, snippet: '旋转', score: 0.88 },
          { path: '线性映射.md', snippet: '映射', score: 0.86 },
        ],
        commands: [{ name: '矩阵计算器' }, { name: '换主题…' }, { name: '算一下', hint: '矩阵和行列式' }],
      }),
    )
    // 名字开头对上的分数一样：命令先（照小样）；说明里有的命令排在命令组
    expect(kinds(rows)).toEqual(['best:cmd', 'notes:pdfName', 'notes:note', 'cmd:cmd', 'text:note', 'text:pdfPage', 'meaning:meaning', 'meaning:meaning', 'web:url', 'claude:claude'])
    expect(cmdName(rows[0])).toBe('矩阵计算器')
    expect(rows[2]).toMatchObject({ path: '矩阵笔记.md' })
    expect(cmdName(rows[3])).toBe('算一下')
    expect(rows[4]).toMatchObject({ path: '正文里有.md' })
    expect(rows[7]).toMatchObject({ hit: { path: '线性映射.md' } })
    expect(groupHead('best', { q: '矩阵', claudeDone: false, why: '' })).toEqual({ name: '最合适' })
    expect(groupHead('notes', { q: '矩阵', claudeDone: false })).toEqual({ name: '笔记' })
    expect(groupHead('text', { q: '矩阵', claudeDone: false })).toEqual({ name: '笔记和PDF里的字' })
    expect(groupHead('web', { q: '矩阵', claudeDone: false })).toEqual({ name: '网页和AI' })
  })

  it('最合适：名字一样的笔记比只是开头对上的命令合适；最近用过的命令往前；别名打全了排第一', () => {
    const same = buildRows(base({ q: '同步', hits: [{ path: '写作/同步.md', snippet: '' }], commands: [{ name: '同步设置' }] }))
    expect(same[0]).toMatchObject({ group: 'best', kind: 'note', path: '写作/同步.md' })
    const used = buildRows(base({ q: '同步', hits: [{ path: '写作/同步和备份怎么做.md', snippet: '' }], commands: [{ name: '同步', usedRank: 0 }] }))
    expect(used[0]).toMatchObject({ group: 'best', kind: 'cmd' })
    expect(groupHead('best', { q: '同步', claudeDone: false, why: '最近用过' })).toEqual({ name: '最合适', why: '· 最近用过' })
    const alias = buildRows(base({ q: 'tb', hits: [{ path: 'tb.md', snippet: '' }], commands: [{ name: '同步', alias: 'tb' }, { name: 'tb 工具' }] }))
    expect(alias[0]).toMatchObject({ group: 'best', kind: 'cmd', exact: true })
    expect(cmdName(alias[0])).toBe('同步')
    // 只有说明里有的不够格当最合适
    const hint = buildRows(base({ q: '远程', commands: [{ name: '同步', hint: '推到远程仓库' }] }))
    expect(kinds(hint)).toEqual(['cmd:cmd', 'web:url', 'claude:claude'])
  })

  it('藏起的命令打字照样搜得到', () => {
    const rows = buildRows(base({ q: '归档', commands: [{ name: '归档', hint: '很久没改过的', hidden: true }] }))
    expect(rows[0]).toMatchObject({ group: 'best', kind: 'cmd', cmd: { hidden: true } })
  })

  it('每组最多 5 条，多的「还有 N 条」，点开后多给一些但也不全铺开', () => {
    const hits = Array.from({ length: 40 }, (_, i) => ({ path: `n${i}.md`, snippet: '矩阵' }))
    const rows = buildRows(base({ hits }))
    expect(kinds(rows).filter((k) => k.startsWith('text'))).toEqual([...Array(5).fill('text:note'), 'text:more'])
    expect(rows.find((r) => r.kind === 'more')).toMatchObject({ kind: 'more', n: 35 })
    const more = buildRows(base({ hits, expanded: new Set<Group>(['text']) }))
    expect(more.filter((r) => r.group === 'text')).toHaveLength(21)
    expect(more.filter((r) => r.group === 'text')[20]).toMatchObject({ kind: 'more', n: 20 })
  })

  it('明明白白的网址放最前；Claude 找完换成它找到的几条', () => {
    const rows = buildRows(base({ q: 'https://example.com', url: 'https://example.com', looksUrl: true, explicitUrl: true, claude: { phase: 'done', found: [{ path: 'a.pdf', page: 5, why: '因为' }] } }))
    expect(kinds(rows)).toEqual(['web:url', 'claude:found'])
    // 找完一条都没有：还是那一行（显示「也没找到」，回车再找）
    expect(kinds(buildRows(base({ claude: { phase: 'done', found: [] } })))).toEqual(['web:url', 'claude:claude'])
  })

  it('打全了一条命令的名字：这条命令是最合适，搜索结果晚到也挤不掉它（回车总是跑命令）', () => {
    const rows = buildRows(
      base({
        q: '拍一张导图',
        hits: [{ path: '拍一张导图.md', snippet: '拍一张导图' }],
        meaning: [{ path: '别的.md', snippet: '照片', score: 0.9 }],
        commands: [{ name: '拍一张导图' }, { name: '拍一张导图（从文件）' }, { name: '新建笔记' }],
      }),
    )
    expect(rows[0]).toMatchObject({ group: 'best', kind: 'cmd', exact: true, cmd: { name: '拍一张导图' } })
    // 只是名字里有的命令在命令组，打全的那条不重复列
    const cmds = rows.filter((r) => r.kind === 'cmd').map(cmdName)
    expect(cmds).toEqual(['拍一张导图', '拍一张导图（从文件）'])
  })
})

describe('回车默认选哪一行（第 2 轮：手快回车把笔记名发到网上）', () => {
  it('结果还没回来、只有「去网上搜」和「让 Claude 找」：没有默认行（-1），回车不去网上', () => {
    const rows = buildRows(base({ q: '随手记', url: 'https://www.google.com/search?q=x' }))
    expect(kinds(rows)).toEqual(['web:url', 'claude:claude'])
    expect(defaultIndex(rows)).toBe(-1)
  })
  it('笔记回来了：默认是第一条笔记', () => {
    const rows = buildRows(base({ q: '随手记', hits: [{ path: '随手记.md', snippet: '' }] }))
    expect(rows[defaultIndex(rows)]).toMatchObject({ kind: 'note', path: '随手记.md' })
  })
  it('带 http(s):// 或 www. 的网址、库里没有名字对得上的：默认打开这个网址（用户打的就是网址）', () => {
    for (const q of ['https://example.com', 'www.example.com']) {
      const rows = buildRows(base({ q, url: 'https://example.com', looksUrl: true, explicitUrl: true, hits: [{ path: '正文里提到.md', snippet: q }] }))
      expect(rows[defaultIndex(rows)], q).toMatchObject({ kind: 'url', url: 'https://example.com' })
    }
  })
  it('只有命令对得上：默认是命令，不是网页搜索', () => {
    const rows = buildRows(base({ q: '主题', commands: [{ name: '换主题…' }] }))
    expect(rows[defaultIndex(rows)]).toMatchObject({ kind: 'cmd' })
  })
})

describe('第 3 轮：像网址的笔记名、意思相近的门槛、按第几个本地结果记选中', () => {
  const urlish = (q: string, o: Partial<RowsInput<C>> = {}) => base({ q, url: `https://${q.toLowerCase()}`, looksUrl: true, ...o })

  it('readme.md / Node.js / v0.4.0：网页那一行不是默认，也不放最前；有同名笔记就默认开笔记', () => {
    for (const [q, path] of [
      ['readme.md', 'readme.md'],
      ['Node.js', 'Node.js.md'],
      ['v0.4.0', 'v0.4.0 发版.md'],
    ]) {
      const rows = buildRows(urlish(q!, { hits: [{ path: path!, snippet: '' }] }))
      expect(rows[0], q).toMatchObject({ kind: 'note', path })
      expect(rows[defaultIndex(rows)], q).toMatchObject({ kind: 'note', path })
      expect(rows.find((r) => r.kind === 'url'), q).toMatchObject({ group: 'web', url: `https://${q!.toLowerCase()}` })
    }
    const pdf = buildRows(urlish('Lecture06.pdf', { pdfNames: ['课程/Lecture06.pdf'] }))
    expect(pdf[defaultIndex(pdf)]).toMatchObject({ kind: 'pdfName', path: '课程/Lecture06.pdf' })
  })

  it('像网址、库里又没有的（readme.md 还没搜出来、foo.bar）：没有默认，回车不上网', () => {
    for (const q of ['readme.md', 'foo.bar', 'Lecture06.pdf']) {
      const rows = buildRows(urlish(q))
      expect(kinds(rows), q).toEqual(['web:url', 'claude:claude'])
      expect(defaultIndex(rows), q).toBe(-1)
    }
  })

  it('明明白白的网址、但库里有名字对得上的：默认开笔记，网址排到网页那一组', () => {
    const rows = buildRows(base({ q: 'www.example.com', url: 'https://www.example.com', looksUrl: true, explicitUrl: true, hits: [{ path: 'www.example.com.md', snippet: '' }] }))
    expect(kinds(rows)).toEqual(['best:note', 'web:url', 'claude:claude'])
    expect(defaultIndex(rows)).toBe(0)
  })

  it('字面没结果：意思相近的都不过门槛就不默认（-1）；过门槛的那条是默认；只有命令对得上时默认是命令', () => {
    const weak = [
      { path: 'readme.md', snippet: '说明', score: 0.86 },
      { path: '随手记.md', snippet: '正文', score: 0.85 },
    ]
    const none = buildRows(base({ q: '特斯拉股价', meaning: weak }))
    expect(kinds(none)).toEqual(['meaning:meaning', 'meaning:meaning', 'web:url', 'claude:claude'])
    expect(defaultIndex(none)).toBe(-1)
    const sure = buildRows(base({ q: '周末去哪玩', meaning: [{ path: '生活/周末.md', snippet: '爬山', score: 0.9, sure: true }, ...weak] }))
    expect(sure[defaultIndex(sure)]).toMatchObject({ kind: 'meaning', hit: { path: '生活/周末.md' } })
    const cmd = buildRows(base({ q: '主题', meaning: weak, commands: [{ name: '换主题…' }] }))
    expect(cmd[defaultIndex(cmd)]).toMatchObject({ kind: 'cmd' })
  })

  it('结果没出齐时按的 ↓ 先记着（keyIsFinal 为 false），出齐了再按：和等结果出来再按落在同一行', () => {
    const empty = buildRows(base({ q: '线性代数' }))
    expect(keyIsFinal(empty, null, 1, { text: false, all: false })).toBe(false)
    expect(keyIsFinal(empty, null, 'enter', { text: false, all: false })).toBe(false)
    const two = buildRows(base({ q: '线性代数', hits: [{ path: '线性代数复习.md', snippet: '' }, { path: '线性代数习题.md', snippet: '' }] }))
    // 文字回来了、起点和落点都在文字那一组：不用等意思相近
    expect(keyIsFinal(two, null, 1, { text: true, all: false })).toBe(true)
    expect(two[rowOf(two, step(two, null, 1)!)]).toMatchObject({ kind: 'note', path: '线性代数习题.md' })
    // 已经在最后一条文字结果上再按 ↓：后到的意思相近会排在下面，得等出齐
    expect(keyIsFinal(two, { local: 1 }, 1, { text: true, all: false })).toBe(false)
    expect(keyIsFinal(two, { local: 1 }, -1, { text: true, all: false })).toBe(true)
    // 只有一条：↓ 停在它上面
    const one = buildRows(base({ q: '线性代数', hits: [{ path: '线性代数复习.md', snippet: '' }] }))
    expect(one[rowOf(one, step(one, null, 1)!)]).toMatchObject({ kind: 'note' })
  })

  it('第 4 轮：没把握的意思相近键盘选不中：早按 ↓、晚按 ↓、不按，都不选中，回车不做事；鼠标悬停也不算选中', () => {
    const weak = [
      { path: 'readme.md', snippet: '说明', score: 0.86 },
      { path: '代码托管.md', snippet: '正文', score: 0.85 },
    ]
    const rows = buildRows(base({ q: '特斯拉股价', meaning: weak }))
    expect(defaultIndex(rows)).toBe(-1)
    // 晚按（出齐了再按）
    expect(step(rows, null, 1)).toBeNull()
    expect(step(rows, null, -1)).toBeNull()
    // 早按：结果没回来时记成 ↓，出齐了再按，和晚按一样
    const early = buildRows(base({ q: '特斯拉股价' }))
    expect(keyIsFinal(early, null, 1, { text: false, all: false })).toBe(false)
    expect(step(rows, null, 1)).toEqual(step(rows, null, 1))
    // 以前早按记成 { local: 1 }：现在第 1 个键盘能选的也落不到没把握的那条上
    expect(rowOf(rows, { local: 1 })).toBe(-1)
    expect(rows.map((_, i) => cursorAt(rows, i))).toEqual([null, null, { web: true }, { claude: true }])
  })

  it('↓ ↑ 只在键盘能选的本地结果里挪：跳过没把握的意思相近，到头停住；网页、Claude 那两行用 ⌘↵ ⌥↵ 或鼠标', () => {
    const rows = buildRows(
      base({
        q: '周末',
        hits: [{ path: '周末计划.md', snippet: '' }],
        meaning: [
          { path: '爬山.md', snippet: '', score: 0.86 },
          { path: '生活/周末.md', snippet: '', score: 0.9, sure: true },
        ],
        commands: [{ name: '周末模式' }],
      }),
    )
    // 名字开头都对上：命令和笔记一样合适，命令先（照小样），笔记在「笔记」组
    expect(kinds(rows)).toEqual(['best:cmd', 'notes:note', 'meaning:meaning', 'meaning:meaning', 'web:url', 'claude:claude'])
    const seen: string[] = []
    let c: Cursor | null = null
    for (let i = 0; i < 5; i++) {
      c = step(rows, c, 1)
      const r = rows[rowOf(rows, c!)]!
      seen.push(r.kind === 'note' ? r.path : r.kind === 'meaning' ? r.hit.path : r.kind)
    }
    expect(seen).toEqual(['周末计划.md', '生活/周末.md', '生活/周末.md', '生活/周末.md', '生活/周末.md'])
    expect(rows[rowOf(rows, step(rows, { local: 1 }, -1)!)]).toMatchObject({ kind: 'cmd' })
    // 鼠标挪到网页那一行后再按 ↓：回到第一条本地结果
    expect(step(rows, { web: true }, 1)).toEqual({ local: 0 })
  })

  it('第 4 轮：打的像网址 / 域名，只有名字对得上的才默认；正文里有的键盘挪得到但不默认，意思相近的一律没把握', () => {
    const urlish = (q: string, o: Partial<RowsInput<C>> = {}) => base({ q, url: `https://${q}`, looksUrl: true, ...o })
    const sure = [{ path: 'example.org.md', snippet: '同名笔记', score: 0.95, sure: true }]
    const com = buildRows(urlish('example.com', { meaning: sure }))
    expect(defaultIndex(com)).toBe(-1)
    expect(com.find((r) => r.kind === 'meaning')).toMatchObject({ hit: { sure: false } })
    expect(step(com, null, 1)).toBeNull()
    const gh = buildRows(urlish('github.com', { hits: [{ path: '代码托管.md', snippet: '仓库放在 github.com 上' }] }))
    expect(defaultIndex(gh)).toBe(-1)
    expect(gh[rowOf(gh, step(gh, null, 1)!)]).toMatchObject({ kind: 'note', path: '代码托管.md' })
    const org = buildRows(urlish('example.org', { hits: [{ path: 'example.org.md', snippet: '' }, { path: '链接.md', snippet: 'example.org' }] }))
    expect(org[defaultIndex(org)]).toMatchObject({ kind: 'note', path: 'example.org.md' })
    // 不像网址的照旧：过了门槛的意思相近、正文里有的都能默认
    const plain = buildRows(base({ q: '矩阵的特征值', meaning: [{ path: '线性代数复习.md', snippet: '', score: 0.9, sure: true }] }))
    expect(plain[defaultIndex(plain)]).toMatchObject({ kind: 'meaning' })
  })

  it('选中记的是身份：前面再长出结果也不跑；回车等结果的规则：鼠标选了网页那一行马上走', () => {
    const later = buildRows(base({ q: '随手', hits: [{ path: '随手记.md', snippet: '' }], meaning: [{ path: '别的.md', snippet: '', score: 0.9, sure: true }] }))
    expect(later[rowOf(later, { web: true })]).toMatchObject({ kind: 'url' })
    expect(later[rowOf(later, { local: 0 })]).toMatchObject({ kind: 'note', path: '随手记.md' })
    expect(keyIsFinal(later, { web: true }, 'enter', { text: false, all: false })).toBe(true)
    expect(keyIsFinal(later, { web: true }, 1, { text: false, all: false })).toBe(false)
    // 默认是文字结果：文字回来了就能回车，不等意思相近
    expect(keyIsFinal(later, null, 'enter', { text: true, all: false })).toBe(true)
    // 默认还没有：等出齐（意思相近可能有一条过门槛的）
    const none = buildRows(base({ q: '随手' }))
    expect(keyIsFinal(none, null, 'enter', { text: true, all: false })).toBe(false)
    expect(keyIsFinal(none, null, 'enter', { text: true, all: true })).toBe(true)
  })

  it('PDF 里的字还没回来（搜索进程刚起、在载模型）：默认是命令、名字对上的笔记就能回车；默认在「笔记和PDF里的字」那一组的要等它（task-wuv05）', () => {
    const cmds = [{ name: '拍一张导图' }, { name: '新建白板' }]
    const cmd = buildRows(base({ q: '拍一张导图', commands: cmds }))
    expect(cmd[defaultIndex(cmd)]).toMatchObject({ kind: 'cmd', group: 'best' })
    expect(keyIsFinal(cmd, null, 'enter', { text: true, pdf: false, all: false })).toBe(true)
    // 笔记还没回来：照旧等（名字对上的笔记可能比命令分高）
    expect(keyIsFinal(cmd, null, 'enter', { text: false, pdf: false, all: false })).toBe(false)
    // 默认是正文命中：PDF 页会和它轮流排进同一组，等 PDF 回来
    const body = buildRows(base({ q: '特征值', hits: [{ path: '复习.md', snippet: '特征值' }] }))
    expect(body[defaultIndex(body)]).toMatchObject({ kind: 'note', group: 'text' })
    expect(keyIsFinal(body, null, 'enter', { text: true, pdf: false, all: false })).toBe(false)
    expect(keyIsFinal(body, null, 'enter', { text: true, pdf: true, all: false })).toBe(true)
  })
})
