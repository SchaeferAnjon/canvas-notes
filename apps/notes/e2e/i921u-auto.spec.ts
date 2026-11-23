/**
 * 自动化（task-i921u「当……就……」）在真软件里（测试模式无头、假 AI）：
 * - 在表格里真点格子、真打字改「金额」：规则「大额支出提醒」跑了（系统通知、加待办），一次提交、记录一行；
 *   它改的「分类」不再触发「交报销单」（不连锁）；底层契约 window.cn.auto 列得出、开关只换一行、一句话填规则、撤回；
 * - 深链 canvas-notes://automation/run?name=周记：新建本周那篇（照模板、AI 本周摘要块）、发通知、加一条「写周记」；
 * - Mac 关着错过的：打开时补跑一次，记录里一行「补跑」。
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isoWeekOf, parseLog, stampText } from '@cn/format'
import { launch, openNote, pane } from './app'

const BASE = `filters:
  and:
    - file.inFolder("生活/账目")
properties:
  分类:
    type: text
views:
  - type: table
    name: 全部
    order:
      - file.name
      - 金额
      - 收支
      - 分类
automations:
  - name: 大额支出提醒
    when: [{added: true}, {changed: 金额}]
    if: {and: [收支 == "支出", 金额 > 500]}
    do:
      - notify: 这笔有点大：{{名字}} {{金额}}
      - set: {分类: 报销}
  - name: 交报销单
    when: {changed: 分类, to: 报销}
    do:
      - todo: 交报销单：{{名字}} {{金额}}
        file: 生活/待办.md
        date: 下周一 9:00`

const DOC = '生活/2026 记账.md'
const FILES: Record<string, string> = {
  [DOC]: `# 2026 记账\n\n\`\`\`base\n${BASE}\n\`\`\`\n\n月底看一眼摘要。\n`,
  '生活/账目/外卖.md': '---\n金额: 41\n收支: 支出\n分类: 餐饮\n---\n',
  '生活/账目/工资.md': '---\n金额: 12000\n收支: 收入\n分类: 工资\n---\n',
}
const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' })
const logOf = (vault: string) => {
  const dir = join(vault, '.canvas-notes/自动化记录')
  if (!existsSync(dir)) return []
  return parseLog(execFileSync('cat', [...execFileSync('ls', [dir], { encoding: 'utf8' }).trim().split('\n').map((n) => join(dir, n))], { encoding: 'utf8' }))
}
const screen = (run: { app: import('@playwright/test').ElectronApplication }) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('|'))

test('改格子触发规则：发通知、改分类、一次提交、记一行；自动化改的分类不再触发「交报销单」；契约：列出、开关、一句话填规则、撤回', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_AUTO_SETTLE_MS: '400' })
  const { page, vault } = run
  try {
    await openNote(page, '2026 记账')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    // 真点「外卖」那一行的金额格，打 620，回车
    await db.locator('tbody tr', { hasText: '外卖' }).locator('td').nth(1).dblclick()
    const box = db.locator('input.base-in[aria-label="外卖 · 金额"]')
    await box.fill('620')
    await box.press('Enter')
    await expect.poll(() => read(vault, '生活/账目/外卖.md'), { timeout: 40_000 }).toContain('分类: 报销')
    expect(read(vault, '生活/账目/外卖.md')).toBe('---\n金额: 620\n收支: 支出\n分类: 报销\n---\n')
    await expect.poll(() => screen(run), { timeout: 40_000 }).toContain('系统通知：大额支出提醒：这笔有点大：外卖 620')
    await expect.poll(() => logOf(vault).length, { timeout: 40_000 }).toBe(1)
    const [e] = logOf(vault)
    expect(e).toMatchObject({ rule: '大额支出提醒', by: 'auto', why: '「外卖」的「金额」改成了「620」', ok: true, files: ['生活/账目/外卖.md'], did: ['发了通知「这笔有点大：外卖 620」', '把「分类」改成「报销」（《外卖》）'] })
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('自动化「大额支出提醒」：发了通知「这笔有点大：外卖 620」；把「分类」改成「报销」（《外卖》）\n')
    // 这一次的提交里只有分类那一行（金额是用户改的，先单独提交）
    expect(git(vault, 'show', '--format=', '-U0', 'HEAD', '--', '生活/账目/外卖.md').split('\n').filter((l) => /^[-+][^-+]/.test(l))).toEqual(['-分类: 餐饮', '+分类: 报销'])
    // 不连锁：自动化写的「分类: 报销」不触发「交报销单」
    await page.waitForTimeout(1500)
    expect(existsSync(join(vault, '生活/待办.md'))).toBe(false)
    expect(logOf(vault)).toHaveLength(1)

    // 契约：列出这个数据库的两条，一句话、跑过几次
    const where = `${DOC}#0`
    const listing = await page.evaluate((w) => window.cn.auto.list(w), where)
    expect(listing.rules.map((r) => [r.rule.name, r.runs, r.sentence])).toEqual([
      ['大额支出提醒', 1, '当 新加一条，或 「金额」改了 · 如果 收支 是 支出 且 金额 > 500 · 就 发通知「这笔有点大：名字 金额」，再 把「分类」改成「报销」'],
      ['交报销单', 0, '当 「分类」改成「报销」 · 就 加一条待办「交报销单：名字 金额」'],
    ])
    // 开关：只换那一条的 on: false 一行，一次提交
    const before = read(vault, DOC)
    expect(await page.evaluate((w) => window.cn.auto.toggle({ where: w, index: 0 }, false), where)).toMatchObject({ ok: true })
    expect(read(vault, DOC)).toBe(before.replace('  - name: 大额支出提醒\n', '  - name: 大额支出提醒\n    on: false\n'))
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('自动化：改了「大额支出提醒」\n')
    // 一句话填规则（假 AI 认「报销」），存进去接在最后
    const said = await page.evaluate((w) => window.cn.auto.fromSentence({ sentence: '分类改成报销，就提醒我下周一交报销单', where: w }), where)
    expect(said).toMatchObject({ ok: true, rule: { name: '交报销单 2', when: [{ on: 'changed', prop: '分类', to: '报销' }] }, problems: [] })
    // 用户改「工资」的分类成报销：交报销单（用户改的照样触发）
    await db.locator('tbody tr', { hasText: '工资' }).locator('td').nth(3).dblclick()
    const cat = db.locator('input.base-in[aria-label="工资 · 分类"]')
    await cat.fill('报销')
    await cat.press('Enter')
    await expect.poll(() => (existsSync(join(vault, '生活/待办.md')) ? read(vault, '生活/待办.md') : ''), { timeout: 40_000 }).toContain('- [ ] 交报销单：工资 12000 📅')
    // 撤回这一次：待办那一篇回到没有
    const id = logOf(vault).find((x) => x.rule === '交报销单')!.id
    expect(await page.evaluate((i) => window.cn.auto.undo(i), id)).toEqual({ ok: true, hash: expect.any(String) })
    expect(existsSync(join(vault, '生活/待办.md'))).toBe(false)
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('撤回自动化「交报销单」\n')
    const rows = await page.evaluate(() => window.cn.auto.log({}))
    expect(rows.find((r) => r.id === id)!.undone).toBe(true)
  } finally {
    await run.close()
  }
})

test('深链跑周记：新建本周那篇（模板、AI 本周摘要块）、发通知、加一条「写周记」，一次提交', async () => {
  const run = await launch({ '课程/第3讲.md': '# 第3讲\n\n边际产量先升后降。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault, app } = run
  try {
    await app.evaluate(({ app: a }) => a.emit('open-url', { preventDefault() {} }, 'canvas-notes://automation/run?name=%E5%91%A8%E8%AE%B0'))
    const w = isoWeekOf(new Date())
    const title = `${w.year}-W${String(w.week).padStart(2, '0')}`
    const note = `周记/${title}.md`
    await expect.poll(() => existsSync(join(vault, note)), { timeout: 40_000 }).toBe(true)
    await expect.poll(() => logOf(vault).length, { timeout: 40_000 }).toBe(1)
    const text = read(vault, note)
    expect(text).toMatch(new RegExp(`^---\\n这一周: \\d+月\\d+日—\\d+月\\d+日\\n来自: 自动化「周记」\\n---\\n# ${title}\\n\\n> \\[!ai\\] AI 本周摘要 · `))
    expect(text).toContain('## 这周最想记住的')
    expect(read(vault, '周记/待办.md')).toContain(`- [ ] 写周记 [[${title}]] 📅`)
    expect(await screen(run)).toContain('系统通知：周记：这周的周记建好了')
    expect(logOf(vault)[0]).toMatchObject({ rule: '周记', where: 'lib', by: 'link', ok: true })
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^自动化「周记」：新建了《/)
    expect(git(vault, 'status', '--porcelain')).toBe('')
    // 在软件里打开这一篇：AI 块画成带标志的块
    await openNote(page, title)
    await expect(pane(page).locator('.cm-content')).toContainText('AI 本周摘要')
  } finally {
    await run.close()
  }
})

test('Mac 关着错过的：打开时补跑一次（错过三次也只补一次），记录里写「补跑」', async () => {
  const lib = '# 自动化\n\n```yaml\n- name: 每天提醒记账\n  when: {every: day, at: "21:00"}\n  do:\n    - todo: 记今天的账\n      file: 生活/待办.md\n      date: 今天 21:30\n```\n'
  const run = await launch({ '.canvas-notes/自动化.md': lib }, { CN_AI_FAKE: '1' }, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'automation.json'), JSON.stringify({ prefs: { on: true, missed: 'once', notify: true }, seen: { [vault]: stampText(new Date(Date.now() - 3 * 864e5)) } }))
  })
  const { vault } = run
  try {
    await expect.poll(() => logOf(vault).length, { timeout: 40_000 }).toBe(1)
    const [e] = logOf(vault)
    expect(e).toMatchObject({ rule: '每天提醒记账', by: 'missed', why: '每天 21:00那次 Mac 关着，打开后补跑', ok: true })
    expect(read(vault, '生活/待办.md').match(/记今天的账/g)).toHaveLength(1)
  } finally {
    await run.close()
  }
})

test('还没有规则的数据库块：一句话填规则、试跑照这一块的列，{{名字}} {{金额}} 填上，不当成库里的；存第一条', async () => {
  const plain = 'filters:\n  and:\n    - file.inFolder("生活/账目")\nviews:\n  - type: table\n    name: 全部'
  const run = await launch({ [DOC]: `# 2026 记账\n\n\`\`\`base\n${plain}\n\`\`\`\n`, '生活/账目/外卖.md': FILES['生活/账目/外卖.md']! }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    const where = `${DOC}#0`
    const said = await page.evaluate((w) => window.cn.auto.fromSentence({ sentence: '分类改成报销，就提醒我下周一交报销单', where: w }), where)
    expect(said).toMatchObject({ ok: true, rule: { name: '交报销单' }, problems: [] })
    if (!said.ok) throw new Error(said.error)
    const t = await page.evaluate(({ w, r }) => window.cn.auto.trial({ where: w, rule: r as never }), { w: where, r: JSON.parse(JSON.stringify(said.rule)) as unknown })
    expect(t.problems).toEqual([])
    expect(t.path).toBe('生活/账目/外卖.md')
    expect(t.steps[0]).toMatch(/^在「生活\/待办」加一条「交报销单：外卖 41」（[^ ）]+ 09:00 提醒）$/)
    expect(await page.evaluate(({ w, r }) => window.cn.auto.save({ where: w, index: null, rule: r as never }), { w: where, r: JSON.parse(JSON.stringify(said.rule)) as unknown })).toMatchObject({ ok: true, ref: { where, index: 0 }, problems: [] })
    expect(read(vault, DOC)).toContain('automations:\n  - name: 交报销单\n    when: {changed: 分类, to: 报销}\n')
    expect(git(vault, 'status', '--porcelain')).toBe('')
  } finally {
    await run.close()
  }
})
