// 微信读书开关对齐、左栏正在看和选中分开（task-cqia6，用户看了说明图：「[图 2] 这里对齐更好一点. [图 3] 这里需要改.」；
// 偏好「设置里下拉要对齐」「正在看和选中分开」）。
// 1. 设置 › 插件：每块的开关贴行右边（离右 12），和同段按钮（微信读书「在右栏打开登录」、拦广告「现在更新」）右边齐，浅色天青、深色深湖都量；
// 2. 左栏文件树：正在看的那篇不铺底，左边一道 2px --acc 竖线、名字 600 强调色，不算进选中；⌘ 点从空开始（照 Obsidian），
//    灰底（--fill2）只给选中的；再 ⌘ 点正在看的那篇它才算进选中（竖线 + 灰底）；Esc 清掉选中，竖线还在；单击照旧是打开、不留选中。
// 设 CN_SHOTS=<目录> 时顺手截改后的图（文件名带 skin）。
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launch, leftView, tabOn, type Running } from './app'
import { skinned } from './fixtures/book-digest'
import { LECTURE } from './fixtures/pdf'

const SHOTS = process.env.CN_SHOTS

async function winShot(run: Running, name: string) {
  if (!SHOTS) return
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })

/** 一个元素右边到它所在那一行（.pair / .wr-acct / .ab-rules）右边的距离 */
const rightGap = (page: Page, sel: string) =>
  page.locator(sel).evaluateAll((els) =>
    els.map((el) => {
      const row = el.parentElement!
      return Math.round(row.getBoundingClientRect().right - el.getBoundingClientRect().right)
    }),
  )

for (const [skin, tone] of [
  ['sky', '浅色天青'],
  ['petrol', '深色深湖'],
] as const) {
  test(`设置 › 插件：开关都贴行右边，离右 12，和「在右栏打开登录」「现在更新」右边齐（${tone}）`, async () => {
    const run = await launch({ 'a.md': '# a\n' }, {}, skinned(skin))
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await page.keyboard.press('Meta+,')
      await expect(dlg(page)).toBeVisible()
      await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '插件', exact: true }).click()
      const we = dlg(page).getByRole('region', { name: '微信读书' })
      const login = we.getByRole('group', { name: '微信读书登录' }).getByRole('button', { name: '在右栏打开登录' })
      await expect(login).toBeVisible()
      // 微信读书三个开关：启用、划线插进左边开着的文档、划线和想法同步进「阅读」
      const wr = await rightGap(page, '.plug-set[aria-label="微信读书"] .pair > .sw-toggle')
      expect(wr).toHaveLength(3)
      expect(wr).toEqual([12, 12, 12])
      // 同段的按钮：右边和开关齐（同一个 x）
      const xs = await page.locator('.plug-set[aria-label="微信读书"] .pair > .sw-toggle, .plug-set[aria-label="微信读书"] .wr-acct > button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)))
      expect(xs).toHaveLength(4)
      expect(new Set(xs).size).toBe(1)
      // 同页别的插件的「启用」开关、拦广告「现在更新」也离右 12
      const all = await rightGap(page, '.plug-set .pair > .sw-toggle')
      expect(all.length).toBeGreaterThanOrEqual(6)
      expect(new Set(all)).toEqual(new Set([12]))
      expect(await rightGap(page, '.plug-set[aria-label="拦广告"] .ab-rules > button')).toEqual([12])
      await winShot(run, `plugins-after-${skin}`)
    } finally {
      await run.close()
    }
  })
}

const ECP = {
  '课程/ecp/考试安排.md': '# 考试安排\n\n6 月 20 日。\n',
  '课程/ecp/期末复习提纲.md': '# 期末复习提纲\n\n- 脉冲神经网络\n',
  '课程/ecp/作业1 讲评.md': '# 作业1 讲评\n\n第 2 题常见错误。\n',
  '课程/ecp/Lecture04.pdf': LECTURE,
  '课程/ecp/Lecture05.pdf': LECTURE,
  '课程/ecp/Lecture06.pdf': LECTURE,
}
const side = (page: Page) => page.locator('aside.side')
const tree = (page: Page) => side(page).getByRole('tree')
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const bar = (page: Page) => side(page).getByRole('toolbar', { name: '选中的' })
const L5 = '课程/ecp/Lecture05.pdf'

/** 一行的样子：底色、左边那道竖线（::before 的宽和颜色）、名字的字重和颜色，和主题的 --fill2、--acc、--acc-t 比（鼠标先挪开，不量悬停的底） */
const look = async (page: Page, path: string) => {
  await page.mouse.move(900, 880)
  return tree(page)
    .locator(`[data-path="${path}"]`)
    .evaluate((el) => {
      const probe = document.createElement('i')
      document.body.append(probe)
      const color = (v: string) => ((probe.style.color = `var(${v})`), getComputedStyle(probe).color)
      const want = { fill2: color('--fill2'), acc: color('--acc'), accT: color('--acc-t') }
      probe.remove()
      const s = getComputedStyle(el)
      const b = getComputedStyle(el, '::before')
      const name = getComputedStyle(el.querySelector('.truncate')!)
      return {
        bg: s.backgroundColor,
        bar: b.content !== 'none' && b.content !== 'normal' ? { w: b.width, c: b.backgroundColor } : null,
        weight: name.fontWeight,
        nameColor: name.color,
        selected: el.getAttribute('aria-selected'),
        current: el.getAttribute('aria-current'),
        want,
      }
    })
}

for (const [skin, tone] of [
  ['sky', '浅色天青'],
  ['petrol', '深色深湖'],
] as const) {
  test(`左栏：开着 Lecture05 → ⌘ 点 3 篇是「已选3个」、灰底 3 行、Lecture05 只有竖线；再 ⌘ 点它「已选4个」；Esc 清掉、竖线还在（${tone}）`, async () => {
    const run = await launch(ECP, {}, skinned(skin))
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await leftView(page, '文件')
      if ((await row(page, '课程').getAttribute('aria-expanded')) !== 'true') await row(page, '课程').locator('.ft-tw').click()
      await row(page, 'ecp').locator('.ft-tw').click()
      // 单击 Lecture05：打开它，不留选中（底下没有「已选」）
      await row(page, 'Lecture05').click()
      await expect(tabOn(page)).toHaveText('Lecture05.pdf')
      await expect(bar(page)).toHaveCount(0)
      await expect(tree(page).locator('.ft-row.sel')).toHaveCount(0)
      let l5 = await look(page, L5)
      expect(l5.bg).toBe('rgba(0, 0, 0, 0)')
      expect(l5.bar).toEqual({ w: '2px', c: l5.want.acc })
      expect(l5.weight).toBe('600')
      expect(l5.nameColor).toBe(l5.want.accT)
      expect(l5.selected).toBe('false')
      expect(l5.current).toBe('page')

      // ⌘ 点三篇：从空开始，不把正在看的算进来
      for (const n of ['考试安排', '期末复习提纲', '作业1 讲评']) await row(page, n).click({ modifiers: ['Meta'] })
      await expect(bar(page).locator('b')).toHaveText('已选3个')
      await expect(tree(page).locator('.ft-row.sel')).toHaveCount(3)
      await expect(tree(page).locator('[role=treeitem][aria-selected="true"]')).toHaveCount(3)
      for (const n of ['考试安排', '期末复习提纲', '作业1 讲评']) {
        const s = await look(page, `课程/ecp/${n}.md`)
        expect(s.bg).toBe(s.want.fill2)
        expect(s.bar).toBeNull()
      }
      l5 = await look(page, L5)
      expect(l5.bg).toBe('rgba(0, 0, 0, 0)')
      expect(l5.bar).toEqual({ w: '2px', c: l5.want.acc })
      // 中间还是 Lecture05
      await expect(tabOn(page)).toHaveText('Lecture05.pdf')
      await winShot(run, `tree-after-3-${skin}`)

      // 再 ⌘ 点 Lecture05：这时它也算选中（竖线 + 灰底）
      await row(page, 'Lecture05').click({ modifiers: ['Meta'] })
      await expect(bar(page).locator('b')).toHaveText('已选4个')
      await expect(tree(page).locator('.ft-row.sel')).toHaveCount(4)
      l5 = await look(page, L5)
      expect(l5.bg).toBe(l5.want.fill2)
      expect(l5.bar).toEqual({ w: '2px', c: l5.want.acc })
      expect(l5.selected).toBe('true')
      await winShot(run, `tree-after-4-${skin}`)

      // Esc：选中清掉，竖线还在
      await page.keyboard.press('Escape')
      await expect(bar(page)).toHaveCount(0)
      await expect(tree(page).locator('.ft-row.sel')).toHaveCount(0)
      l5 = await look(page, L5)
      expect(l5.bg).toBe('rgba(0, 0, 0, 0)')
      expect(l5.bar).toEqual({ w: '2px', c: l5.want.acc })

      // 单击另一篇：打开它，正在看换过去，不留选中
      await row(page, '考试安排').click()
      await expect(tabOn(page)).toHaveText('考试安排')
      await expect(tree(page).locator('.ft-row.sel')).toHaveCount(0)
      await expect(tree(page).locator('.ft-row.on')).toHaveCount(1)
      expect((await look(page, '课程/ecp/考试安排.md')).current).toBe('page')
      expect((await look(page, L5)).bar).toBeNull()
    } finally {
      await run.close()
    }
  })
}
