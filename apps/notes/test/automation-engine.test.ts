/**
 * 自动化的引擎（main/automation-engine.ts）：每种触发、每种动作、不连锁、按钮能触发、补跑、出错停下、撤回、存规则、试跑、一句话填规则。
 * 真的临时 Git 库，假 AI、假钟；每次跑以后看盘上的字、提交、记录那一行。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { aiCellWrites, type AutoRule, baseContext, parseAutomations, parseBaseDoc, parseLog, setAutomation } from '@cn/format'
import { afterEach, describe, expect, it } from 'vitest'
import { ACCOUNT_BASE } from '../../../packages/format/test/automation-samples'
import type { AiRowRequest } from '../src/main/ai-column'
import { AutoEngine, type EngineDeps, putWeekBlock, weekBlock } from '../src/main/automation-engine'
import type { AutoDone, AutoPrefs } from '../src/shared/automation'
import { Vault } from '../src/main/vault'

const roots: string[] = []
const engines: AutoEngine[] = []
afterEach(() => {
  for (const e of engines.splice(0)) e.stop()
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
const g = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })

const DOC = '生活/2026 记账.md'
const row = (金额: number, 收支: string, 分类?: string, 日期 = '2026-11-20') => `---\n日期: ${日期}\n金额: ${金额}\n收支: ${收支}\n${分类 ? `分类: ${分类}\n` : ''}---\n`

/** 记账库：设计页那一块，加几条规则（不要设计页那三条时给 src） */
function makeVault(src = ACCOUNT_BASE, extra: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'cn-auto-'))
  roots.push(base)
  const root = join(base, '库')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  g(root, 'config', 'user.name', 'T')
  g(root, 'config', 'user.email', 't@example.com')
  const files: Record<string, string> = {
    [DOC]: `# 2026 记账\n\n\`\`\`base\n${src}\n\`\`\`\n`,
    '生活/账目/外卖.md': row(41, '支出', '餐饮'),
    '生活/账目/工资.md': row(12000, '收入', '工资'),
    ...extra,
  }
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', '样本')
  return root
}

interface World {
  root: string
  v: Vault
  e: AutoEngine
  clock: { now: Date }
  seen: Record<string, string>
  notes: string[]
  events: { ch: string; payload: unknown }[]
  asks: string[]
  prefs: AutoPrefs
  answer: { text: string }
}

async function world(root: string, o: Partial<EngineDeps> = {}): Promise<World> {
  const v = new Vault(root)
  await v.list()
  const w: World = { root, v, e: null as unknown as AutoEngine, clock: { now: new Date('2026-11-22T10:00:00') }, seen: {}, notes: [], events: [], asks: [], prefs: { on: true, missed: 'once', notify: false }, answer: { text: '十一月支出 41，最多是餐饮。' } }
  w.e = new AutoEngine({
    vault: () => v,
    now: () => w.clock.now,
    prefs: () => w.prefs,
    lastSeen: (r) => w.seen[r] ?? null,
    setLastSeen: (r, t) => (w.seen[r] = t),
    ask: async (_s, prompt) => {
      w.asks.push(prompt)
      return { text: w.answer.text, by: '假 AI' }
    },
    aiRow: async (vv: Vault, req: AiRowRequest) => {
      const doc = parseBaseDoc(req.src)
      doc.props[req.col] = req.def!
      const text = (await vv.read(req.path)).text
      const ctx = baseContext(doc, [{ path: req.path, text }])
      const value = req.def!.output === 'note' ? '1. 一题' : '交通'
      const ws = aiCellWrites(ctx, { path: req.path, col: req.col, value, by: '假 AI', read: '读了', noteText: null })
      for (const x of ws) await vv.write(x.path, x.after, x.before)
      return { ok: true, writes: ws, value, by: '假 AI', read: '读了', chars: 1, source: '' }
    },
    notify: (title, body) => w.notes.push(`${title}：${body}`),
    tell: () => {},
    emit: (ch, payload) => w.events.push({ ch, payload }),
    settleMs: 0,
    ...o,
  })
  engines.push(w.e)
  await w.e.scan(true)
  return w
}

/** 像编辑器存一篇那样写（Vault 的全文缓存跟着变），然后让引擎扫、等跑完 */
async function edit(w: World, path: string, text: string) {
  const cur = existsSync(join(w.root, path)) ? (await w.v.read(path)).text : ''
  const r = await w.v.write(path, text, cur)
  expect(r.ok).toBe(true)
  await w.e.scan(false)
  await w.e.idle()
}

const log = (root: string) => parseLog(['2026-11'].map((m) => (existsSync(join(root, `.canvas-notes/自动化记录/${m}.jsonl`)) ? readFileSync(join(root, `.canvas-notes/自动化记录/${m}.jsonl`), 'utf8') : '')).join(''))
const subjects = (root: string) => g(root, 'log', '--format=%s').trim().split('\n')
const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8')
const dones = (w: World) => w.events.filter((x) => x.ch === 'auto:done').map((x) => x.payload as AutoDone)

describe('触发', () => {
  it('新加一条 + 如果（分类为空）→ AI 写这一格：写了分类、记一行、一次提交；有分类的新一条不跑', async () => {
    const root = makeVault()
    const w = await world(root)
    await edit(w, '生活/账目/机场打车.md', row(620, '支出'))
    const text = read(root, '生活/账目/机场打车.md')
    expect(text).toContain('分类: 交通')
    expect(text).toMatch(/AI填的: \[?分类\]?/)
    const [e] = log(root)
    expect(e).toMatchObject({ rule: '自动猜分类', by: 'auto', why: '新加了「机场打车」', ok: true, undoable: true, path: '生活/账目/机场打车.md', files: ['生活/账目/机场打车.md'] })
    expect(e!.did).toEqual(['AI 写了「分类」：交通（《机场打车》）'])
    expect(subjects(root)[0]).toBe('自动化「自动猜分类」：AI 写了「分类」：交通（《机场打车》）')
    // 用户新建的那一条（没提交的字）先单独提交，这一次的提交里只有 AI 写的
    expect(subjects(root)[1]).toMatch(/机场打车/)
    expect(g(root, 'status', '--porcelain')).toBe('')
    await edit(w, '生活/账目/午饭.md', row(30, '支出', '餐饮'))
    expect(log(root)).toHaveLength(1)
  })

  it('新加一条要停手够久才算：还在填的时候不跑', async () => {
    const root = makeVault()
    const w = await world(root, { settleMs: 60_000 })
    await edit(w, '生活/账目/机场打车.md', row(620, '支出'))
    expect(log(root)).toHaveLength(0)
  })

  it('某一列改成某个值（分类 → 报销）→ 加一条待办，下周一 9:00 提醒；改成别的不跑', async () => {
    const root = makeVault()
    const w = await world(root)
    await edit(w, '生活/账目/外卖.md', row(41, '支出', '餐饮').replace('餐饮', '零食'))
    expect(log(root)).toHaveLength(0)
    await edit(w, '生活/账目/外卖.md', row(41, '支出', '报销'))
    expect(read(root, '生活/待办.md')).toBe('# 待办\n\n- [ ] 交报销单：外卖 41 📅 2026-11-23 09:00 🔔 准时\n')
    expect(log(root)[0]).toMatchObject({ rule: '交报销单', why: '「外卖」的「分类」改成了「报销」', did: ['在「生活/待办」加了一条「交报销单：外卖 41」（明天 09:00 提醒）'] })
  })

  it('不连锁：自动化改的分类不再触发别的自动化；按钮改的、用户改的照样触发', async () => {
    const src = setAutomation(
      'filters:\n  and:\n    - file.inFolder("生活/账目")\nproperties:\n  报了:\n    type: button\n    do:\n      - set: {分类: 报销}',
      null,
      { name: '大额算报销', on: true, when: [{ on: 'changed', prop: '金额' }], if: null, missed: null, do: [{ do: 'set', values: { 分类: '报销' } }] },
    )
    const all = setAutomation(src, null, parseAutomations(ACCOUNT_BASE)[1]!)
    const root = makeVault(all)
    const w = await world(root)
    await edit(w, '生活/账目/外卖.md', row(410, '支出', '餐饮'))
    expect(read(root, '生活/账目/外卖.md')).toContain('分类: 报销')
    await w.e.scan(false)
    await w.e.idle()
    expect(log(root).map((x) => x.rule)).toEqual(['大额算报销'])
    expect(existsSync(join(root, '生活/待办.md'))).toBe(false)
    // 按钮
    await edit(w, '生活/账目/工资.md', row(12000, '收入', '工资'))
    const started = await w.e.button(`${DOC}#0`, '报了', '生活/账目/工资.md', false)
    expect(started).toHaveProperty('run')
    await w.e.idle()
    await w.e.scan(false)
    await w.e.idle()
    expect(log(root).map((x) => [x.rule, x.by])).toEqual([
      ['大额算报销', 'auto'],
      ['报了', 'button'],
      ['交报销单', 'auto'],
    ])
    expect(read(root, '生活/待办.md')).toContain('交报销单：工资 12000')
  })

  it('定时：到点跑一次；同一个钟点不跑第二次', async () => {
    const root = makeVault('filters:\n  and:\n    - file.inFolder("生活/账目")')
    const w = await world(root)
    await w.e.writeRule('lib', { set: { index: null, rule: { name: '每天提醒记账', on: true, when: [{ on: 'every', every: 'day', at: '21:00' }], if: null, missed: null, do: [{ do: 'todo', text: '记今天的账', file: '生活/待办.md', date: '今天 21:30' }] } } })
    w.seen[root] = '2026-11-22T20:59:30'
    w.clock.now = new Date('2026-11-22T21:00:10')
    await w.e.tick()
    await w.e.idle()
    w.seen[root] = '2026-11-22T20:59:30'
    await w.e.tick()
    await w.e.idle()
    const runs = log(root).filter((x) => x.rule === '每天提醒记账')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ by: 'auto', why: '每天 21:00', slot: '2026-11-22T21:00:00' })
    expect(read(root, '生活/待办.md')).toContain('- [ ] 记今天的账 📅 2026-11-22 21:30 🔔 准时')
  })

  it('补跑：Mac 关了三天，每天 21:00 的只补最近一次；skip 的记一行跳过；头一回开不补', async () => {
    const root = makeVault('filters:\n  and:\n    - file.inFolder("生活/账目")')
    const w = await world(root)
    const r: AutoRule = { name: '每天提醒记账', on: true, when: [{ on: 'every', every: 'day', at: '21:00' }], if: null, missed: null, do: [{ do: 'notify', text: '记账' }] }
    await w.e.writeRule('lib', { set: { index: null, rule: r } })
    await w.e.writeRule('lib', { set: { index: null, rule: { ...r, name: '跳过的', missed: 'skip' } } })
    w.clock.now = new Date('2026-11-22T09:00:00')
    await w.e.tick()
    expect(log(root)).toHaveLength(0)
    w.clock.now = new Date('2026-11-25T09:00:00')
    await w.e.tick()
    await w.e.idle()
    const l = log(root).filter((x) => x.rule !== '周记')
    expect(l.map((x) => [x.rule, x.by, x.slot, !!x.skipped])).toEqual([
      ['跳过的', 'missed', '2026-11-24T21:00:00', true],
      ['每天提醒记账', 'missed', '2026-11-24T21:00:00', false],
    ])
    expect(l[1]!.why).toBe('每天 21:00那次 Mac 关着，打开后补跑')
    expect(w.notes).toEqual(['每天提醒记账：记账'])
  })

  it('到了某一列的日子：前一天 9:00，那一条跑；别的日子的不跑', async () => {
    const src = setAutomation('filters:\n  and:\n    - file.inFolder("生活/账目")', null, { name: '到期提醒', on: true, when: [{ on: 'date', prop: '截止', before: 1, at: '9:00' }], if: null, missed: null, do: [{ do: 'notify', text: '{{名字}} 明天到期' }] })
    const root = makeVault(src, { '生活/账目/房租.md': '---\n截止: 2026-11-24\n---\n', '生活/账目/水费.md': '---\n截止: 2026-12-10\n---\n' })
    const w = await world(root)
    w.seen[root] = '2026-11-23T08:59:00'
    w.clock.now = new Date('2026-11-23T09:00:30')
    await w.e.tick()
    await w.e.idle()
    expect(w.notes).toEqual(['到期提醒：房租 明天到期'])
    expect(log(root)[0]).toMatchObject({ path: '生活/账目/房租.md', slot: '生活/账目/房租.md|2026-11-23T09:00:00', undoable: false, files: [] })
  })

  it('总开关关着：改了也不跑', async () => {
    const root = makeVault()
    const w = await world(root)
    w.prefs.on = false
    await edit(w, '生活/账目/外卖.md', row(41, '支出', '报销'))
    expect(log(root)).toHaveLength(0)
  })
})

describe('动作', () => {
  it('新建一条（照这一条抄几列、日期设今天）、在右栏打开它', async () => {
    const root = makeVault()
    const w = await world(root)
    const r = await w.e.button(`${DOC}#0`, '再记一笔', '生活/账目/外卖.md', true)
    await w.e.idle()
    const d = dones(w)[0]!
    expect(r).toEqual({ run: d.run })
    expect(d.open).toBe('生活/账目/外卖 2.md')
    expect(read(root, '生活/账目/外卖 2.md')).toBe('---\n金额: 41\n分类: 餐饮\n收支: 支出\n日期: 2026-11-22\n---\n')
  })

  it('先问一句：没确认交回那句话，不跑', async () => {
    const src = 'filters:\n  and:\n    - file.inFolder("生活/账目")\nproperties:\n  删了:\n    type: button\n    do:\n      - ask: 真的要标成作废吗？\n      - set: {分类: 作废}'
    const root = makeVault(src)
    const w = await world(root)
    expect(await w.e.button(`${DOC}#0`, '删了', '生活/账目/外卖.md', false)).toEqual({ ask: '真的要标成作废吗？' })
    expect(log(root)).toHaveLength(0)
    await w.e.button(`${DOC}#0`, '删了', '生活/账目/外卖.md', true)
    await w.e.idle()
    expect(read(root, '生活/账目/外卖.md')).toContain('分类: 作废')
  })

  it('AI 新建一篇笔记并关联、AI 写摘要（读本月的几条，建在「生活/记账/账单摘要」）', async () => {
    const src = setAutomation(ACCOUNT_BASE, null, { name: '出题', on: true, when: [{ on: 'added' }], if: null, missed: null, do: [{ do: 'ai', ai: 'note', prop: '笔记', prompt: '写一段说明', folder: '生活/说明' }] })
    const root = makeVault(src)
    const w = await world(root)
    const month = w.e.places.find((p) => p.where === `${DOC}#0`)!.rules.findIndex((r) => r.name === '月底写账单摘要')
    await w.e.runNow({ where: `${DOC}#0`, index: month }, undefined)
    await w.e.idle()
    const sum = '生活/记账/账单摘要/2026-11 月底写账单摘要.md'
    expect(read(root, sum)).toBe('---\n数据库: "[[2026 记账]]"\n来自: 自动化「月底写账单摘要」\n---\n# 2026-11 月底写账单摘要\n\n> [!ai] AI 摘要 · 假 AI · 读了 2 条\n> 十一月支出 41，最多是餐饮。\n')
    expect(w.asks[0]).toMatch(/^命令：自动化写摘要/)
    expect(w.asks[0]).toContain('- 外卖：日期 2026-11-20，金额 41，收支 支出，分类 餐饮')
    const n = w.e.places.find((p) => p.where === `${DOC}#0`)!.rules.findIndex((r) => r.name === '出题')
    await w.e.runNow({ where: `${DOC}#0`, index: n }, '生活/账目/外卖.md')
    await w.e.idle()
    expect(read(root, '生活/账目/外卖.md')).toContain('笔记: "[[外卖 笔记]]"')
    expect(existsSync(join(root, '生活/说明/外卖 笔记.md'))).toBe(true)
  })

  it('运行一条存过的命令：交给界面（auto:command）；认不出的一步报错，自动跑的那条写 on: false 停下', async () => {
    const src = setAutomation(
      setAutomation('filters:\n  and:\n    - file.inFolder("生活/账目")', null, { name: '整理一下', on: true, when: [{ on: 'changed', prop: '金额' }], if: null, missed: null, do: [{ do: 'command', command: '/整理成通顺笔记' }] }),
      null,
      { name: '发网钩', on: true, when: [{ on: 'changed', prop: '收支' }], if: null, missed: null, do: [{ do: 'notify', text: '先通知' }, { do: 'unknown', key: 'webhook', raw: { webhook: 'x' } }] },
    )
    const root = makeVault(src)
    const w = await world(root)
    await edit(w, '生活/账目/外卖.md', row(42, '支出', '餐饮'))
    expect(w.events.find((x) => x.ch === 'auto:command')!.payload).toMatchObject({ command: '/整理成通顺笔记', path: '生活/账目/外卖.md' })
    await edit(w, '生活/账目/外卖.md', row(42, '收入', '餐饮'))
    const bad = log(root).find((x) => x.rule === '发网钩')!
    expect(bad).toMatchObject({ ok: false, error: '认不出这一步「webhook」，去改写法', did: ['发了通知「先通知」'], files: [DOC] })
    expect(dones(w).pop()!.paused).toBe(true)
    expect(read(root, DOC)).toContain('  - name: 发网钩\n    on: false\n')
    expect(subjects(root)[0]).toBe('自动化「发网钩」：发了通知「先通知」')
  })

  it('周记：新建本周那篇（照模板，2026-W47），AI 写进「AI 本周摘要」块，发通知、加一条待办；再跑不新建、只补新的事', async () => {
    const root = makeVault('filters:\n  and:\n    - file.inFolder("生活/账目")', { '课程/第3讲.md': '# 第3讲\n\n- [x] 交小论文提纲 ✅ 2026-11-20\n' })
    const w = await world(root, {
      weekFacts: async () => ({ week: '2026-W47', from: '2026-11-16', to: '2026-11-22', notes: [{ path: '课程/第3讲.md', title: '第3讲', excerpt: '' }], books: [] }),
    })
    w.answer.text = '## 这周写了、剪了什么\n- 课程笔记「第3讲」'
    // 周记默认关着：用户在设置 › 自动化里打开（改的就是库里那一条）
    const weekly = (await w.e.listing(w.prefs)).rules.find((r) => r.builtIn === 'week')!.rule
    await w.e.writeRule('lib', { set: { index: 0, rule: { ...weekly, on: true } } })
    w.seen[root] = '2026-11-22T19:59:00'
    w.clock.now = new Date('2026-11-22T20:00:05')
    await w.e.tick()
    await w.e.idle()
    const p = '周记/2026-W47.md'
    const text = read(root, p)
    expect(text).toBe(
      '---\n这一周: 11月16日—11月22日\n来自: 自动化「周记」\n---\n# 2026-W47\n\n> [!ai] AI 本周摘要 · 假 AI · 读了这周改过的1篇、做完的1条待办\n> ## 这周写了、剪了什么\n> - 课程笔记「第3讲」\n\n## 这周最想记住的\n\n## 下周想做\n\n- [ ] \n',
    )
    expect(w.asks[0]).toContain('这周做完的待办（1 条）：\n- 交小论文提纲')
    expect(w.asks[0]).toContain('**这周写了、剪了什么**')
    expect(w.asks[0]).toContain('- [[第3讲]]（课程/第3讲.md）')
    expect(w.notes).toEqual(['周记：这周的周记建好了'])
    expect(read(root, '周记/待办.md')).toBe('# 待办\n\n- [ ] 写周记 [[2026-W47]] 📅 2026-11-22 21:00 🔔 准时\n')
    expect(log(root)[0]).toMatchObject({ rule: '周记', where: 'lib', by: 'auto', ok: true })
    expect(subjects(root)[0]).toMatch(/^自动化「周记」：新建了《2026-W47》/)
    // 再跑一次（现在跑一次）：这周那篇已经有了，只补新的一行，你写的字不动
    await w.v.write(p, text.replace('## 这周最想记住的\n\n', '## 这周最想记住的\n\n我自己写的一句\n'), text)
    w.answer.text = '- 课程笔记「第3讲」\n- 记了 3 笔账'
    await w.e.runNow({ where: 'lib', index: 0 }, undefined)
    await w.e.idle()
    const again = read(root, p)
    expect(again).toContain('> - 课程笔记「第3讲」\n>\n> - 记了 3 笔账\n')
    expect(again).toContain('我自己写的一句')
    expect(existsSync(join(root, '周记/2026-W47 2.md'))).toBe(false)
  })

  it('周记默认关着：周日 20:00 过了、打开也不补跑，不建周记、不加待办、不提交', async () => {
    const root = makeVault('filters:\n  and:\n    - file.inFolder("生活/账目")')
    const w = await world(root)
    const before = subjects(root).length
    w.seen[root] = '2026-11-22T12:00:00'
    w.clock.now = new Date('2026-11-23T09:00:00')
    await w.e.tick()
    await w.e.idle()
    expect(existsSync(join(root, '周记'))).toBe(false)
    expect(existsSync(join(root, '.canvas-notes/自动化记录'))).toBe(false)
    expect(subjects(root)).toHaveLength(before)
  })

  it('测试模式（builtInClock: false）：没有自动化.md 时自带的到点不跑；测试自己写了自动化.md 打开周记才跑', async () => {
    const root = makeVault('filters:\n  and:\n    - file.inFolder("生活/账目")')
    const w = await world(root, { builtInClock: false, weekFacts: async () => ({ week: '2026-W47', from: '2026-11-16', to: '2026-11-22', notes: [], books: [] }) })
    w.seen[root] = '2026-11-22T19:59:00'
    w.clock.now = new Date('2026-11-22T20:00:05')
    await w.e.tick()
    await w.e.idle()
    expect(existsSync(join(root, '周记'))).toBe(false)
    const weekly = (await w.e.listing(w.prefs)).rules.find((r) => r.builtIn === 'week')!.rule
    await w.e.writeRule('lib', { set: { index: 0, rule: { ...weekly, on: true } } })
    w.seen[root] = '2026-11-22T19:59:00'
    await w.e.tick()
    await w.e.idle()
    expect(existsSync(join(root, '周记/2026-W47.md'))).toBe(true)
    expect(log(root).pop()).toMatchObject({ rule: '周记', by: 'auto', ok: true })
  })

  it('整理收件箱：交给梦游的归类；没给的时候报错', async () => {
    const root = makeVault('filters:\n  and:\n    - file.inFolder("生活/账目")')
    const w = await world(root, { tidyInbox: async () => ({ did: '收件箱 2 篇挪进了「课程」', files: [] }) })
    await w.e.writeRule('lib', { set: { index: 1, rule: { ...(await w.e.listing(w.prefs)).rules.find((r) => r.builtIn === 'inbox')!.rule, on: true } } })
    await w.e.runNow({ where: 'lib', index: 1 }, undefined)
    await w.e.idle()
    expect(log(root).pop()).toMatchObject({ rule: '整理收件箱', did: ['收件箱 2 篇挪进了「课程」'], ok: true })
  })
})

describe('撤回', () => {
  it('撤回一次：那一篇回到原样、一次提交、记录多一行；再撤回说撤回过了；只发通知的收不回', async () => {
    const root = makeVault()
    const w = await world(root)
    await edit(w, '生活/账目/外卖.md', row(41, '支出', '报销'))
    const e = log(root)[0]!
    expect(await w.e.undo(e.id)).toMatchObject({ ok: true })
    expect(existsSync(join(root, '生活/待办.md'))).toBe(false)
    expect(subjects(root)[0]).toBe('撤回自动化「交报销单」')
    expect(log(root).pop()).toMatchObject({ undo: e.id })
    expect(await w.e.undo(e.id)).toEqual({ ok: false, error: '这一次已经撤回了' })
    // 只剩用户自己改的那一篇没提交（软件的自动提交会收它）
    expect(g(root, 'status', '--porcelain')).toBe(' M 生活/账目/外卖.md\n')
  })
  it('后来又改过那一篇：撤回不了，什么都不动', async () => {
    const root = makeVault()
    const w = await world(root)
    await edit(w, '生活/账目/外卖.md', row(41, '支出', '报销'))
    const e = log(root)[0]!
    await edit(w, '生活/待办.md', read(root, '生活/待办.md') + '- [ ] 我加的\n')
    expect(await w.e.undo(e.id)).toEqual({ ok: false, error: '《待办》后来又改过，撤回不了' })
    expect(read(root, '生活/待办.md')).toContain('我加的')
  })
})

describe('存规则、试跑、一句话', () => {
  it('存、开关、删：只换那几行，一次提交；列表里一句话、跑过几次', async () => {
    const root = makeVault()
    const w = await world(root)
    const before = read(root, DOC)
    const r = await w.e.writeRule(`${DOC}#0`, { set: { index: 1, rule: { ...parseAutomations(ACCOUNT_BASE)[1]!, on: false } } })
    expect(r).toMatchObject({ ok: true, ref: { where: `${DOC}#0`, index: 1 }, problems: [] })
    expect(read(root, DOC)).toBe(before.replace('  - name: 交报销单\n', '  - name: 交报销单\n    on: false\n'))
    expect(subjects(root)[0]).toBe('自动化：改了「交报销单」')
    const l = await w.e.listing(w.prefs)
    const info = l.rules.find((x) => x.rule.name === '自动猜分类')!
    expect(info).toMatchObject({ kind: 'base', place: '2026 记账', sentence: '当 新加一条 · 如果 分类 为空 · 就 AI 写「分类」这一格', runs: 0, problems: [] })
    expect(l.rules.find((x) => x.rule.name === '月底写账单摘要')!.next).toBe('2026-11-30T21:00:00')
    expect(l.rules.filter((x) => x.kind === 'library').map((x) => [x.rule.name, x.builtIn])).toEqual([
      ['周记', 'week'],
      ['整理收件箱', 'inbox'],
    ])
    expect(l.buttons).toEqual([{ where: `${DOC}#0`, doc: DOC, place: '2026 记账', col: '再记一笔', steps: expect.any(Array) }])
    await w.e.writeRule(`${DOC}#0`, { remove: 2 })
    expect(parseAutomations(read(root, DOC).match(/```base\n([\s\S]*?)\n```/)![1]!).map((x) => x.name)).toEqual(['自动猜分类', '交报销单'])
    // 库里的：还没有 自动化.md 时开关一条，照自带的建出来
    await w.e.writeRule('lib', { set: { index: 1, rule: { ...l.rules.find((x) => x.builtIn === 'inbox')!.rule, on: true } } })
    expect(read(root, '.canvas-notes/自动化.md')).toContain('- name: 整理收件箱\n  when: {every: day, at: "22:00"}')
    expect(g(root, 'status', '--porcelain')).toBe('')
  })

  it('试跑：说清会做什么，不写文件', async () => {
    const root = makeVault()
    const w = await world(root)
    const reimb = parseAutomations(ACCOUNT_BASE)[1]!
    const t = await w.e.trial(`${DOC}#0`, reimb, '生活/账目/外卖.md')
    expect(t).toEqual({ path: '生活/账目/外卖.md', why: '拿《外卖》试：合条件', fits: true, steps: ['在「生活/待办」加一条「交报销单：外卖 41」（明天 09:00 提醒）'], problems: [] })
    expect(g(root, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(root, '.canvas-notes'))).toBe(false)
  })

  it('一句话 → 规则：AI 回的 YAML 读成规则；重名的加个 2；没认出给一句错', async () => {
    const root = makeVault()
    const w = await world(root)
    w.answer.text = '```yaml\n- name: 交报销单\n  when: {changed: 分类, to: 报销}\n  do:\n    - todo: 交报销单：{{名字}} {{金额}}\n      date: 下周一 9:00\n```'
    const r = await w.e.fromSentence('分类改成报销就提醒我下周一交报销单', `${DOC}#0`, new AbortController().signal)
    expect(r).toMatchObject({ ok: true, rule: { name: '交报销单 2' }, sentence: '当 「分类」改成「报销」 · 就 加一条待办「交报销单：名字 金额」', problems: [], by: '假 AI' })
    expect(w.asks[0]).toContain('- 分类（select：餐饮、工资）')
    w.answer.text = '嗯'
    expect(await w.e.fromSentence('随便', `${DOC}#0`, new AbortController().signal)).toEqual({ ok: false, error: 'AI 这次没填出规则，换个说法再试一次' })
  })

  it('还没有规则、也没有按钮列的数据库块：试跑、一句话填规则、存第一条都照这一块的列（不当成库里的）', async () => {
    const plain = 'filters:\n  and:\n    - file.inFolder("生活/账目")\nviews:\n  - type: table\n    name: 全部'
    const root = makeVault(plain)
    const w = await world(root)
    const where = `${DOC}#0`
    expect(w.e.places.map((p) => p.where)).toEqual(['lib'])
    const reimb = parseAutomations(ACCOUNT_BASE)[1]!
    expect(await w.e.trial(where, reimb, '生活/账目/外卖.md')).toEqual({ path: '生活/账目/外卖.md', why: '拿《外卖》试：合条件', fits: true, steps: ['在「生活/待办」加一条「交报销单：外卖 41」（明天 09:00 提醒）'], problems: [] })
    w.answer.text = '```yaml\n- name: 交报销单\n  when: {changed: 分类, to: 报销}\n  do:\n    - notify: 交 {{名字}}\n```'
    const r = await w.e.fromSentence('分类改成报销就通知我', where, new AbortController().signal)
    expect(r).toMatchObject({ ok: true, rule: { name: '交报销单' }, problems: [] })
    expect(w.asks[0]).toContain('- 分类（select：餐饮、工资）')
    expect(w.asks[0]).not.toContain('库里的')
    expect(await w.e.writeRule(where, { set: { index: null, rule: reimb } })).toMatchObject({ ok: true, ref: { where, index: 0 }, problems: [] })
    expect(read(root, DOC)).toBe(`# 2026 记账\n\n\`\`\`base\n${plain}\nautomations:\n  - name: 交报销单\n    when: {changed: 分类, to: 报销}\n    do:\n      - todo: 交报销单：{{名字}} {{金额}}\n        file: 生活/待办.md\n        date: 下周一 9:00\n\`\`\`\n`)
    expect(await w.e.trial(`${DOC}#3`, reimb)).toMatchObject({ path: null, problems: ['没有「分类」这一列'] })
  })

  it('按名字跑（深链、命令行）：找得到就跑，没有、重名给一句', async () => {
    const root = makeVault()
    const w = await world(root)
    expect(await w.e.runByName('没有这条')).toEqual({ error: '没有叫「没有这条」的规则' })
    const r = await w.e.runByName('交报销单', '2026 记账')
    expect(r).toHaveProperty('run')
    await w.e.idle()
    expect(log(root)[0]).toMatchObject({ rule: '交报销单', by: 'link' })
  })
})

describe('周记那一块', () => {
  it('没有就插在第一个 ## 前面；有了只补新的几行', () => {
    const t = '---\n这一周: x\n---\n# 2026-W47\n\n## 这周最想记住的\n'
    const a = putWeekBlock(t, '- 一', '假 AI', '读了 1 篇')
    expect(a).toBe('---\n这一周: x\n---\n# 2026-W47\n\n> [!ai] AI 本周摘要 · 假 AI · 读了 1 篇\n> - 一\n\n## 这周最想记住的\n')
    expect(weekBlock(a)!.text).toBe('- 一')
    expect(putWeekBlock(a, '- 一', '假 AI', '读了 1 篇')).toBe(a)
    expect(putWeekBlock(a, '- 一\n- 二', '假 AI', '读了 1 篇')).toContain('> - 一\n>\n> - 二\n')
  })
})

describe('命令行', () => {
  it('scripts/automation.mjs run <名字> --where <数据库> --print：打出深链（不加 --print 时用 open -g 发给软件）', () => {
    const out = execFileSync('node', [join(__dirname, '../scripts/automation.mjs'), 'run', '交报销单', '--where', '2026 记账', '--print'], { encoding: 'utf8' }).trim()
    expect(out).toBe('canvas-notes://automation/run?name=%E4%BA%A4%E6%8A%A5%E9%94%80%E5%8D%95&where=2026%20%E8%AE%B0%E8%B4%A6')
    const u = new URL(out)
    expect([u.hostname, u.pathname, u.searchParams.get('name'), u.searchParams.get('where')]).toEqual(['automation', '/run', '交报销单', '2026 记账'])
  })
})
