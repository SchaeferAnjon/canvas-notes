import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gitStatus, launch, pane, rail, leftView } from './app'
import { fakeNotesFolder, type FakeNote } from './fixtures/apple-notes'

// 导入旧笔记（task-ibu60）：⌘K「导入旧笔记…」/ 设置 › 库 → 选来源（备忘录 / Markdown 文件夹）→ 选文件夹 → 导入（进度、结果）
// → 一次提交、能撤回 → 现在梦游 → 报告里归类和改名 → 预览 → 收下。备忘录用测试造的数据库（CN_NOTES_DIR），不碰真的备忘录；
// AI 用假引擎（CN_AI_FAKE=1，按「原文件夹」分：学习/xx → 课程/xx，生活 → 生活，随手记里的拿不准）。

const SHOTS = process.env.CN_SHOTS_DIR
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: join(SHOTS, `${name}.png`) }))
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

const sheet = (page: Page) => page.getByRole('dialog', { name: '导入旧笔记' })
const panel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })
const side = (page: Page) => page.locator('aside.side')
const bar = (page: Page) => page.getByTestId('preview-bar')

function darkSettings(vault: string) {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'pine' } }))
}

/** 测试用的备忘录：学习/线性代数 3 条（勾选清单、图片、表格）、生活 2 条 + 1 条上锁、随手记 1 条 */
function notesData(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'cn-e2e-notes-')), 'group.com.apple.notes')
  const d = (s: string) => new Date(s)
  const notes: FakeNote[] = [
    {
      folder: '线性代数',
      created: d('2023-03-01T09:30:00'),
      modified: d('2023-03-02T21:15:00'),
      paras: [
        { text: '第4讲 特征值', style: 0 },
        { text: '看懂定义', style: 103, done: true },
        { text: '做习题 4.2', style: 103 },
        { image: 'IMG_2201.jpeg', bytes: readFileSync(join(__dirname, 'fixtures/handwritten-map.jpg')) },
        { table: [['名词', '意思'], ['特征值', 'Av=λv 里的 λ']] },
      ],
    },
    { folder: '线性代数', created: d('2023-03-08T09:30:00'), modified: d('2023-03-08T10:00:00'), paras: [{ text: 'Jordan 标准形 没懂', style: 0 }, { text: '为什么不能对角化也能写成 J？' }] },
    { folder: '线性代数', created: d('2023-03-15T09:30:00'), modified: d('2023-03-15T10:00:00'), paras: [{ text: '小测 第3、4讲', style: 0 }, { text: '下周二' }] },
    { folder: '生活', created: d('2022-10-01T08:00:00'), modified: d('2022-10-01T08:00:00'), paras: [{ text: '超市', style: 0 }, { text: '牛奶', style: 103 }, { text: '鸡蛋', style: 103, done: true }] },
    { folder: '生活', created: d('2022-10-02T08:00:00'), modified: d('2022-10-02T08:00:00'), paras: [{ text: '10月房租水电', style: 0 }, { text: '房租 3200，电 128' }] },
    { folder: '生活', locked: true, created: d('2022-10-03T08:00:00'), modified: d('2022-10-03T08:00:00'), paras: [{ text: '密码' }] },
    { folder: '随手记', created: d('2022-11-01T08:00:00'), modified: d('2022-11-01T08:00:00'), paras: [{ text: '随便记一下', style: 0 }, { text: 'ok' }] },
  ]
  fakeNotesFolder(dir, [{ name: '学习' }, { name: '线性代数', parent: '学习' }, { name: '生活' }, { name: '随手记' }, { name: '最近删除', type: 1 }], notes)
  return dir
}

async function openFromPalette(page: Page, shotName?: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('导入旧笔记')
  await expect(page.getByRole('option', { name: /导入旧笔记…/ })).toBeVisible()
  if (shotName) await shot(page, shotName)
  await page.getByRole('option', { name: /导入旧笔记…/ }).click()
  await expect(sheet(page)).toBeVisible()
}

for (const tone of ['light', 'dark'] as const) {
  test(`备忘录：⌘K 打开、选文件夹、导入、提交；现在梦游、预览、收下（${tone === 'light' ? '浅色' : '深色'}）`, async () => {
    const data = notesData()
    const run = await launch({ '课程/线性代数/第1讲.md': '# 第1讲\n' }, { CN_AI_FAKE: '1', CN_NOTES_DIR: data, CN_IMPORT_DELAY_MS: '150' }, tone === 'dark' ? darkSettings : undefined)
    const { page, vault } = run
    try {
      await openFromPalette(page, `import-0-palette-${tone}`)
      // ① 选来源
      await expect(sheet(page).locator('.mm-steps .now')).toHaveText('1选来源')
      await expect(sheet(page).getByRole('button', { name: /^备忘录/ })).toBeVisible()
      await expect(sheet(page).getByRole('button', { name: /^Markdown文件夹/ })).toBeVisible()
      await shot(page, `import-1-source-${tone}`)
      await sheet(page).getByRole('button', { name: /^备忘录/ }).click()

      // ② 选文件夹：带层级、篇数、上锁的；不列最近删除；默认全选
      const list = sheet(page).getByRole('group', { name: '要导入的文件夹' })
      await expect(list.locator('.imp-row:not(.all) .nm')).toHaveText(['生活', '随手记', '学习', '线性代数'])
      await expect(list.locator('.imp-row', { hasText: '生活' }).locator('.tag')).toHaveText('1条上锁')
      await expect(sheet(page).getByTestId('import-summary')).toHaveText('选了3个文件夹 · 6条 · 2个图片和附件')
      // 随手记不要
      await list.getByRole('checkbox', { name: '随手记' }).uncheck()
      await expect(sheet(page).getByTestId('import-summary')).toHaveText('选了2个文件夹 · 5条 · 2个图片和附件')
      await expect(sheet(page)).toContainText('上了锁的1条读不了，会跳过')
      await shot(page, `import-2-folders-${tone}`)
      const before = Number(git(vault, 'rev-list', '--count', 'HEAD').trim())
      await sheet(page).getByRole('button', { name: '导入5条' }).click()

      // ③ 进度，然后结果
      await expect(sheet(page).getByTestId('import-progress')).toContainText(/在读 · \d\/5条/)
      await shot(page, `import-3-progress-${tone}`)
      const result = sheet(page).getByTestId('import-result')
      await expect(result).toContainText('从备忘录导入了5条', { timeout: 15_000 })
      await expect(result).toContainText('进了收件箱/导入/备忘录/ · 1个图片和附件')
      await expect(sheet(page).getByRole('list', { name: '没导全的' })).toContainText('1条上了锁，没导')
      await expect(sheet(page).getByRole('button', { name: '现在就让梦游整理' })).toHaveClass(/btn-primary/)
      await shot(page, `import-4-done-${tone}`)

      // 库里：一次提交；笔记带原来的属性、勾选清单、图片、表格；修改时间是原来的
      expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)
      expect(git(vault, 'log', '-1', '--format=%s')).toBe('导入旧笔记：从备忘录导入 5 条\n')
      expect(gitStatus(vault)).toBe('')
      const la = readFileSync(join(vault, '收件箱/导入/备忘录/学习/线性代数/第4讲 特征值.md'), 'utf8')
      expect(la).toContain('created: 2023-03-01 09:30\nupdated: 2023-03-02 21:15\n来源: 备忘录\n原文件夹: 学习/线性代数\n')
      expect(la).toContain('- [x] 看懂定义\n- [ ] 做习题 4.2\n\n![](../../../../../附件/导入/备忘录/第4讲%20特征值.jpeg)\n\n| 名词 | 意思 |')
      expect(existsSync(join(vault, '附件/导入/备忘录/第4讲 特征值.jpeg'))).toBe(true)
      expect(existsSync(join(vault, '收件箱/导入/备忘录/随手记'))).toBe(false)

      // 现在梦游 → 右栏报告：按原文件夹分进 课程/线性代数 和 生活
      await sheet(page).getByRole('button', { name: '现在就让梦游整理' }).click()
      await expect(sheet(page)).toHaveCount(0)
      await expect(panel(page).getByTestId('dream-summary')).toContainText('收下才合进main', { timeout: 30_000 })
      const file = panel(page).getByRole('region', { name: '归类和改名' })
      await expect(file.locator('.dsub')).toHaveText(['课程/线性代数3条收下这组', '生活2条收下这组'])
      await file.getByRole('button', { name: '在树里看' }).click()
      await expect(bar(page)).toContainText('5处挪动和改名')
      // 点「预览」左栏换到「文件」页；「最近」页里也是改好后的样子
      await expect(page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await leftView(page, '最近')
      // 左栏：收件箱里留影子「挪到 …」，新出现的文件夹「生活」标「新」（导入的笔记修改时间是原来的，不进「这周动过的」）
      await expect(side(page).getByRole('group', { name: '收件箱 · 挪走的' }).locator('.pv-ghost', { hasText: '第4讲 特征值' })).toHaveText('第4讲 特征值挪到线性代数')
      // 「文件」树里也是改好后的样子：新出现的文件夹「生活」
      await leftView(page, '文件')
      await expect(page.getByRole('tree', { name: '全部文件' }).getByRole('treeitem', { level: 2 }).locator('.truncate', { hasText: /^生活$/ })).toBeVisible()
      await leftView(page, '最近')
      await shot(page, `import-5-preview-${tone}`)
      await bar(page).getByRole('button', { name: '收下这5处' }).click()
      await expect(bar(page)).toHaveCount(0)
      expect(existsSync(join(vault, '课程/线性代数/第4讲 特征值.md'))).toBe(true)
      // 挪过去以后图片链接跟着改，还指得到
      const moved = readFileSync(join(vault, '课程/线性代数/第4讲 特征值.md'), 'utf8')
      expect(moved).toContain('![](../../附件/导入/备忘录/第4讲%20特征值.jpeg)')
      expect(gitStatus(vault)).toBe('')
    } finally {
      await run.close()
      rmSync(dirname(data), { recursive: true, force: true })
    }
  })
}

test('窗口关了接着在后台导，底下一条小进度；导完提示带「撤回」，撤回是一次反向提交', async () => {
  const data = notesData()
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_NOTES_DIR: data, CN_IMPORT_DELAY_MS: '500' })
  const { page, vault } = run
  try {
    await openFromPalette(page)
    await sheet(page).getByRole('button', { name: /^备忘录/ }).click()
    await sheet(page).getByRole('button', { name: '导入6条' }).click()
    await expect(sheet(page).getByTestId('import-progress')).toBeVisible()
    await sheet(page).getByRole('button', { name: '在后台导' }).click()
    await expect(sheet(page)).toHaveCount(0)
    const pill = page.getByTestId('import-pill')
    await expect(pill).toContainText(/正在导入备忘录 · \d \/ 6/)
    await shot(page, 'import-6-pill-light')
    // 导完：提示，点「撤回」
    const toast = page.getByTestId('import-toast')
    await expect(toast).toContainText('导入了6条，在收件箱/导入/备忘录', { timeout: 15_000 })
    await expect(pill).toHaveCount(0)
    await shot(page, 'import-7-toast-light')
    const n = Number(git(vault, 'rev-list', '--count', 'HEAD').trim())
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect(page.getByTestId('toast')).toContainText('撤回了这次导入')
    expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(n + 1)
    expect(existsSync(join(vault, '收件箱/导入'))).toBe(false)
    expect(existsSync(join(vault, '附件/导入'))).toBe(false)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
    rmSync(dirname(data), { recursive: true, force: true })
  }
})

test('Markdown 文件夹：从设置 › 库进；附件拷过来、[[链接]] 留着；再导一次，导过的跳过', async () => {
  const src = join(mkdtempSync(join(tmpdir(), 'cn-e2e-md-')), '旧库')
  const put = (p: string, s: string) => {
    mkdirSync(dirname(join(src, p)), { recursive: true })
    writeFileSync(join(src, p), s)
  }
  put('.obsidian/app.json', '{}')
  put('assets/图.png', 'png')
  put('课程/线代/第一讲.md', '---\ntags: [线代]\n---\n# 第一讲\n\n![[图.png]]\n下一讲：[[课程/线代/第二讲|第二讲]]\n')
  put('课程/线代/第二讲.md', '第二讲\n')
  put('日记.md', '今天\n')
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_IMPORT_DIR: src })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '库' }).click()
    await expect(page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '导入旧笔记…' })).toBeVisible()
    await shot(page, 'import-0-settings-light')
    await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '导入旧笔记…' }).click()
    await expect(page.getByRole('dialog', { name: '设置' })).toHaveCount(0)
    await sheet(page).getByRole('button', { name: /^Markdown文件夹/ }).click()
    const list = sheet(page).getByRole('group', { name: '要导入的文件夹' })
    await expect(list.locator('.imp-row:not(.all) .nm')).toHaveText(['旧库', '课程', '线代', 'assets'])
    await expect(sheet(page).getByTestId('import-summary')).toHaveText('选了3个文件夹 · 3篇 · 1个图片和附件')
    await shot(page, 'import-8-md-folders-light')
    await sheet(page).getByRole('button', { name: '导入3篇' }).click()
    await expect(sheet(page).getByTestId('import-result')).toContainText('从「旧库」导入了3篇')
    // 有 .obsidian 的整个库：原来的文件夹原样放在库的最外层（task-wniqx）
    const one = readFileSync(join(vault, '课程/线代/第一讲.md'), 'utf8')
    expect(one).toContain('tags: [线代]\n')
    expect(one).toContain('来源: 旧库\n原文件夹: 课程/线代\n')
    expect(one).toContain('![](../../附件/导入/旧库/assets/图.png)\n下一讲：[[第二讲|第二讲]]\n')
    expect(existsSync(join(vault, '日记.md'))).toBe(true)
    expect(readdirSync(join(vault, '附件/导入/旧库/assets'))).toEqual(['图.png'])
    await sheet(page).getByRole('button', { name: '关闭' }).click()

    // 再导一次：导过的标出来，一条都不会多
    await openFromPalette(page)
    await sheet(page).getByRole('button', { name: /^Markdown文件夹/ }).click()
    await expect(sheet(page).locator('.imp-row', { hasText: '线代' }).locator('.tag')).toHaveText('2篇导过')
    await expect(sheet(page).getByTestId('import-summary')).toHaveText('选了0个文件夹 · 0篇')
    await expect(sheet(page).getByRole('button', { name: '导入0篇' })).toBeDisabled()
  } finally {
    await run.close()
    rmSync(dirname(src), { recursive: true, force: true })
  }
})
