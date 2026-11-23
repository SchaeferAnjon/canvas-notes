// 梦游的 AI 判断（task-h7oy8）真点一遍：设置 › 梦游里切判断方式、改每晚上限 → 现在梦游，跑到上限停下、报告说还剩几篇；
// 报告里「拿不准，你来定」收下一条、不要一条；旧「相关：」复查去掉一行；夜里自己梦游判到一半睡着了（演一次 suspend），
// 醒来闲下来接着判，判完的不再问。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView } from './app'

/** 25 篇收件箱都提到「冰岛总览」；第 3、7 篇让假 AI 拿不准；剪藏里一篇末尾有一行和它无关的旧「相关：」 */
function vault(): Record<string, string> {
  const towns = ['雷克雅未克', '维克', '赫本', '阿克雷里', '塞济斯菲厄泽', '斯奈山', '黄金圈', '杰古沙龙', '米湖', '胡萨维克']
  const v: Record<string, string> = {
    '冰岛总览.md': '# 冰岛总览\n\n冰岛位于大西洋中脊上，火山、冰川、地热温泉和极光是这里最出名的四样东西。\n',
    '剪藏/冰岛的火山.md': '# 冰岛的火山\n\n冰岛的火山沿着大西洋中脊分布，地热温泉也是火山带来的。\n\n相关：[[马拉松训练]]\n',
    '马拉松训练.md': '# 马拉松训练\n\n每周跑量从三十公里慢慢加到六十公里，长距离慢跑放在周末，配速比比赛慢一分钟。\n',
  }
  for (let i = 1; i <= 25; i++) {
    const unsure = i === 3 || i === 7 ? '（测试判断：冰岛总览=unsure:0.6）\n' : ''
    v[`收件箱/冰岛笔记 ${i}.md`] = `冰岛笔记第 ${i} 篇：第 ${i} 天住在${towns[i % 10]}，看了火山和冰川，晚上泡地热温泉等极光，详见冰岛总览。\n${unsure}`
  }
  return v
}

/** 只开补双链这一样（归类、小结、可视化、挪老图、重复都关），省时间也好数；按意思找关着（向量那一路单元测试里测，这里不等建索引） */
const onlyLinks = (vaultDir: string) => {
  const ud = join(dirname(vaultDir), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ editor: { semantic: false }, dream: { steps: { file: false, rename: false, week: false, viz: false, attach: false, dup: false, video: false } } }))
}

const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const judgeCalls = (log: string) =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { cmd: string; pick: unknown; prompt: string })
        .filter((l) => l.cmd === '梦游判断')
    : []
const notePath = (prompt: string) => {
  const t = /^=== A ===\n标题：(.+)$/m.exec(prompt)![1]!
  return t === '冰岛的火山' ? '剪藏/冰岛的火山.md' : `收件箱/${t}.md`
}

test('设置里切判断方式、每晚最多判 20 篇 → 现在梦游：判 20 篇停下，报告说还剩 6 篇明晚接着', async () => {
  test.setTimeout(150_000)
  const run = await launch(vault(), { CN_AI_FAKE: '1', CN_FAKE_PICK_LOG: '' }, onlyLinks)
  const log = join(run.userData, 'picks.jsonl')
  await run.app.evaluate((_e, p) => (process.env.CN_FAKE_PICK_LOG = p), log)
  const { page, userData } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '梦游', exact: true }).click()
    const dlg = dialog(page)
    const via = dlg.getByRole('radiogroup', { name: 'AI判断走哪条路' })
    await expect(via.getByRole('radio')).toHaveCount(2)
    await expect(via.getByRole('radio', { name: /走订阅/ })).toHaveAttribute('aria-checked', 'true')
    await expect(dlg.getByTestId('dream-judge-detail')).toContainText('哪家、哪个模型、想多久')
    await dlg.getByTestId('dream-judge-detail').scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('settings-judge-cli.png') })
    // 切到本地模型、再切回来：存进设置文件
    await via.getByRole('radio', { name: /本地模型/ }).click()
    await expect(via.getByRole('radio', { name: /本地模型/ })).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).dream.judge.via).toBe('local')
    await page.screenshot({ path: test.info().outputPath('settings-judge-local.png') })
    await via.getByRole('radio', { name: /走订阅/ }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).dream.judge.via).toBe('cli')
    // 每晚上限 20
    await dlg.getByRole('combobox', { name: '每晚最多判几篇' }).selectOption('20')
    await expect.poll(() => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).dream.nightCap).toBe(20)

    await dlg.getByTestId('dream-set-now').getByRole('button', { name: '现在梦游' }).click()
    await expect(dlg.getByTestId('dream-judge-last')).toContainText('到了每晚20篇的上限，还剩6篇明晚接着', { timeout: 60_000 })
    const calls = judgeCalls(log)
    expect(calls).toHaveLength(20)
    // 判断用的是设置里这一档（默认 Claude Code · Sonnet · Medium），不是梦游那一行
    expect(calls[0]!.pick).toEqual({ engine: 'claude', model: 'sonnet', effort: 'medium' })
    expect(new Set(calls.map((c) => notePath(c.prompt))).size).toBe(20)
    await page.screenshot({ path: test.info().outputPath('settings-judge-last.png') })

    // 报告摘要写这晚的账
    await page.keyboard.press('Escape')
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.getByTestId('dream-judge')).toContainText('补双链：Claude Code · Sonnet · Medium判了20篇、问了20次AI；到了每晚20篇的上限，还剩6篇明晚接着。')
    await expect(panel.getByTestId('dream-group-by').first()).toHaveText('Sonnet · Medium判的')
    await page.screenshot({ path: test.info().outputPath('report-capped.png') })
  } finally {
    await run.close()
  }
})

test('报告里「拿不准，你来定」收下一条、不要一条；旧「相关：」复查点「去掉这行」；点的都记下', async () => {
  test.setTimeout(150_000)
  const run = await launch(vault(), { CN_AI_FAKE: '1' }, onlyLinks)
  const { page, vault: dir, userData } = run
  try {
    await page.evaluate(() => window.cn.dreamNow())
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.locator('.dg').filter({ hasText: '拿不准，你来定' })).toContainText('2条', { timeout: 60_000 })
    await expect(panel.locator('.dg').filter({ hasText: '旧「相关：」复查' })).toContainText('1条')

    // 拿不准的一条：展开看理由、两边原话、把握，点「收下」→ 那篇末尾多一行
    const u3 = panel.getByTestId('dream-item').filter({ hasText: '冰岛笔记 3' })
    await u3.click()
    const detail = panel.getByTestId('dream-detail')
    await expect(detail.getByTestId('dream-evidence')).toContainText('「冰岛笔记第 3 篇：')
    await expect(detail.getByTestId('dream-evidence')).toContainText('判成拿不准 · 把握 0.60 · 原话软件逐字核对过')
    await page.screenshot({ path: test.info().outputPath('report-unsure.png') })
    await detail.getByRole('button', { name: '收下', exact: true }).click()
    await expect(u3).toContainText('已收下')
    await expect.poll(() => readFileSync(join(dir, '收件箱/冰岛笔记 3.md'), 'utf8')).toMatch(/\n\n相关：\[\[冰岛总览\]\]\n$/)

    // 另一条点「不要」：文件不动，这一对记进「不再建议」
    const u7 = panel.getByTestId('dream-item').filter({ hasText: '冰岛笔记 7' })
    await u7.click()
    await panel.getByTestId('dream-detail').getByRole('button', { name: '不要', exact: true }).click()
    await expect(u7).toContainText('已丢掉')
    expect(readFileSync(join(dir, '收件箱/冰岛笔记 7.md'), 'utf8')).not.toContain('相关：')

    // 复查：旧「相关：[[马拉松训练]]」判成无关，点「去掉这行」才删
    const rc = panel.getByTestId('dream-item').filter({ hasText: '冰岛的火山' })
    await expect(rc).toContainText('相关：[[马拉松训练]] · 无关')
    expect(readFileSync(join(dir, '剪藏/冰岛的火山.md'), 'utf8')).toContain('相关：[[马拉松训练]]')
    await rc.click()
    await page.screenshot({ path: test.info().outputPath('report-recheck.png') })
    await panel.getByTestId('dream-detail').getByRole('button', { name: '去掉这行' }).click()
    await expect(rc).toContainText('已收下')
    await expect.poll(() => readFileSync(join(dir, '剪藏/冰岛的火山.md'), 'utf8')).toBe('# 冰岛的火山\n\n冰岛的火山沿着大西洋中脊分布，地热温泉也是火山带来的。\n')

    // 点的都记下：不要的那一对进不再建议；三次选择进本机评测集
    const ledgers = readdirSync(join(userData, 'dream')).filter((f) => f.endsWith('.ledger.json'))
    const ledger = JSON.parse(readFileSync(join(userData, 'dream', ledgers[0]!), 'utf8'))
    expect(ledger.rejected).toEqual(['冰岛总览.md\0收件箱/冰岛笔记 7.md'])
    const evalDir = join(userData, 'dream-eval')
    const fp = readdirSync(evalDir)[0]!
    const labels = readFileSync(join(evalDir, fp, 'labels.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(labels.map((l) => [l.group, l.choice, l.a])).toEqual([
      ['unsure', 'link', '收件箱/冰岛笔记 3.md'],
      ['unsure', 'no-link', '收件箱/冰岛笔记 7.md'],
      ['recheck', 'remove', '剪藏/冰岛的火山.md'],
    ])
  } finally {
    await run.close()
  }
})

test('夜里自己梦游判到一半睡着了：醒来闲下来接着判，判完的不再问', async () => {
  test.setTimeout(150_000)
  const run = await launch(vault(), { CN_AI_FAKE: '1', CN_FAKE_JUDGE_MS: '400', CN_DREAM_IDLE_SEC: '0', CN_DREAM_CHECK_MS: '1000', CN_DREAM_JUDGE_PARALLEL: '2' }, onlyLinks)
  const log = join(run.userData, 'picks.jsonl')
  await run.app.evaluate((_e, p) => (process.env.CN_FAKE_PICK_LOG = p), log)
  const { app, page, userData } = run
  try {
    // 闲时自己开始梦游；判了 6 篇以上时演一次睡眠
    await expect.poll(() => judgeCalls(log).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(6)
    await app.evaluate(() => (globalThis as unknown as { cnDreamInterrupt: () => void }).cnDreamInterrupt())
    const ledgerOf = () => {
      const f = readdirSync(join(userData, 'dream')).find((x) => x.endsWith('.ledger.json'))
      return f ? JSON.parse(readFileSync(join(userData, 'dream', f), 'utf8')) : null
    }
    await expect.poll(() => readdirSync(join(userData, 'dream')).some((x) => x.endsWith('.resume'))).toBe(true)
    const doneBefore = Object.keys(ledgerOf().done)
    const before = judgeCalls(log).length
    expect(doneBefore.length).toBeGreaterThanOrEqual(4)
    // 醒来：闲下来接着判（有 .resume 时不等「两次之间至少隔」），出报告
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.getByTestId('dream-judge')).toContainText('篇用的是以前判过的结果', { timeout: 60_000 })
    const second = judgeCalls(log).slice(before).map((c) => notePath(c.prompt))
    // 判完的一篇也没再问
    expect(second.filter((p) => doneBefore.includes(p))).toEqual([])
    expect(Object.keys(ledgerOf().done).length).toBe(26)
    expect(readdirSync(join(userData, 'dream')).some((x) => x.endsWith('.resume'))).toBe(false)
    await page.screenshot({ path: test.info().outputPath('report-resumed.png') })
  } finally {
    await run.close()
  }
})
