/**
 * 待办首页收齐全库的待办（画布今日地基，和画布今日同一份 @cn/tasks）：
 * - 提示块里的「> - [ ]」在首页里，勾掉时「> 」留着
 * - 行尾带 ^块编号 的日子认得出（标题干净），勾掉时 ✅ 在块编号前面
 * - 滴答同步抄进三篇日记的同一条只一行，写着「3处」；勾掉三篇一起勾，撤回三篇回到原来的字节
 * - [/] 进行中半格、[-] 取消一道横线
 * 一律真点；无头（CN_E2E=1）、临时库。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, pane, type Running } from './app'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return iso(d)
}
const T0 = day(0)
const Y5 = day(-5)

const D1 = '日记/a-第一天.md'
const D2 = '日记/b-第二天.md'
const D3 = '日记/c-第三天.md'
const HW = '课程/作业.md'
const COPY = `- [ ] 🚗 驾照刷题 📅 ${Y5} ^dida-6a98574d`
const VAULT: Record<string, string> = {
  [D1]: `# 第一天\n\n${COPY}\n- [x] meeting ✅ ${Y5} ^dida-6a97eec6\n`,
  [D2]: `# 第二天\n\n${COPY}\n`,
  [D3]: `# 第三天\n\n${COPY}\n`,
  [HW]: `# 作业\n\n> [!todo] 这周要交\n> - [ ] Q1 读完 11 个原子 📅 ${T0}\n\n- [/] 做了一半的实验 📅 ${T0}\n- [-] 不做的那一条\n- [ ] 导图主题 📅 ${T0} <!-- id=k1 -->\n`,
}

const read = (run: Running, p: string) => readFileSync(join(run.vault, p), 'utf8')
const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const home = (page: Page) => pane(page).getByTestId('todo-home')
const toast = (page: Page) => page.getByTestId('toast')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const row = (scope: Locator, title: string) => scope.locator('.td-r').filter({ has: scope.page().locator('.td-t', { hasText: new RegExp(`^${esc(title)}$`) }) })
const titles = (scope: Locator) => scope.locator('.td-r .td-t').allTextContents()

test('待办首页：提示块里的、行尾带块编号 / 注释的都在，标题干净；三篇日记里的驾照刷题只一行，写着 3 处；进行中半格', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await bar(page).getByRole('button', { name: '待办', exact: true }).click()
    const today = home(page).locator('[data-part="今天组"]')
    await expect(row(today, '🚗 驾照刷题')).toHaveCount(1)
    expect(await titles(today)).toEqual(expect.arrayContaining(['🚗 驾照刷题', 'Q1 读完 11 个原子', '做了一半的实验', '导图主题']))
    expect((await titles(home(page))).some((t) => /📅|\^dida|<!--/.test(t))).toBe(false)
    expect((await titles(home(page))).filter((t) => t === '🚗 驾照刷题')).toHaveLength(1)
    await expect(row(today, '🚗 驾照刷题').locator('.td-dup')).toHaveText('3处')
    await expect(row(today, '做了一半的实验').getByRole('checkbox')).toHaveClass(/half/)
    await expect(row(today, '做了一半的实验').getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed')
    // 今天 4 条（含过期 1 条）：抄了三遍的只算一条
    await expect(home(page).getByTestId('tdh-meta')).toContainText('今天4条（含过期1条）')
  } finally {
    await run.close()
  }
})

test('勾掉抄了三遍的驾照刷题：三篇各只改那一行（✅ 在 ^块编号前面），撤回三篇回到原来的字节；提示块里的勾掉「> 」留着', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await bar(page).getByRole('button', { name: '待办', exact: true }).click()
    const before = [D1, D2, D3].map((p) => read(run, p))
    await row(home(page), '🚗 驾照刷题').getByRole('checkbox').click()
    const done = `- [x] 🚗 驾照刷题 📅 ${Y5} ✅ ${T0} ^dida-6a98574d`
    await expect.poll(() => [D1, D2, D3].map((p) => read(run, p))).toEqual(before.map((b) => b.replace(COPY, done)))
    await expect(toast(page).locator('span').first()).toHaveText('勾掉了「🚗 驾照刷题」，3处一起勾上了')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => [D1, D2, D3].map((p) => read(run, p))).toEqual(before)

    const hw = read(run, HW)
    await row(home(page), 'Q1 读完 11 个原子').getByRole('checkbox').click()
    await expect.poll(() => read(run, HW)).toBe(hw.replace(`> - [ ] Q1 读完 11 个原子 📅 ${T0}`, `> - [x] Q1 读完 11 个原子 📅 ${T0} ✅ ${T0}`))
  } finally {
    await run.close()
  }
})
