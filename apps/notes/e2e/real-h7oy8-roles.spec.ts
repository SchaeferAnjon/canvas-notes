// 别人分类法的库上用真的 AI 梦游一晚（task-h7oy8「按用户自己的分类法读懂这个库」）：CN_REAL_VAULT 给一份拷贝（已经 git init 提交过），
// 先在设置 › 梦游「这个库怎么分」看推断的角色（截图），再梦游：归类（照推断的角色、给 AI 每个文件夹的例子）和补双链。
// 报告 JSON、截图放进 CN_SHOTS，拿去和收件箱每篇该去哪（测试库旁边的 truth.json）比。要联网、花额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" \
//     CN_REAL_AI=1 CN_REAL_VAULT=<库的拷贝> CN_SHOTS=<截图目录> CN_REAL_CAP=20 npx playwright test e2e/real-h7oy8-roles.spec.ts
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { leftView } from './app'
import { CAP_CHOICES } from '../src/shared/dream-settings'

const capOf = (n: number) => {
  if (!(CAP_CHOICES as readonly number[]).includes(n)) throw new Error(`CN_REAL_CAP 只能是 ${CAP_CHOICES.join('、')}`)
  return n
}

const VAULT = process.env.CN_REAL_VAULT ?? ''
test.skip(!process.env.CN_REAL_AI || !VAULT, '真 AI、真库才跑：CN_REAL_AI=1 CN_REAL_VAULT=<库的拷贝>')
test.setTimeout(2 * 3600_000)

test('别人分类法的库：推断角色、照它归类和补双链，报告和截图存下来', async () => {
  const userData = process.env.CN_REAL_USERDATA || join(dirname(VAULT), 'user-data')
  const shots = process.env.CN_SHOTS || join(dirname(VAULT), 'shots')
  mkdirSync(shots, { recursive: true })
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      editor: { semantic: false },
      dream: {
        auto: false,
        steps: { file: true, rename: true, link: true, dup: true, week: false, viz: false, attach: false, video: false },
        // 每晚上限只认设置里那几档（20、50、100…），别的数会被当成坏值回到默认 500：先查一遍，免得额度超出预期
        nightCap: capOf(Number(process.env.CN_REAL_CAP) || 20),
        linkMax: 30,
        judge: { via: 'cli', engine: 'claude', model: process.env.CN_REAL_MODEL || 'sonnet', effort: process.env.CN_REAL_EFFORT || 'medium' },
      },
    }),
  )
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: VAULT, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(dirname(VAULT), 'trash'), CN_ICLOUD_CONTAINER: join(dirname(VAULT), 'icloud') },
  })
  const page = await app.firstWindow()
  try {
    await expect(page.locator('.vault b')).toBeVisible({ timeout: 120_000 })
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
    const roles = await page.evaluate(() => window.cn.dreamRoles())
    writeFileSync(join(shots, 'roles.json'), JSON.stringify(roles, null, 2))
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '梦游', exact: true }).click()
    const list = page.getByRole('dialog', { name: '设置' }).getByRole('list', { name: '这个库怎么分' })
    await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 })
    await list.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shots, 'settings-roles.png') })
    await page.keyboard.press('Escape')
    const t0 = Date.now()
    const report = await page.evaluate(() => window.cn.dreamNow())
    const ms = Date.now() - t0
    writeFileSync(join(shots, 'report.json'), JSON.stringify({ ms, report }, null, 2))
    console.log(`梦游一晚：${Math.round(ms / 1000)} 秒；条目 ${report.items.map((i) => i.group).join(',')}`)
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.getByTestId('dream-summary')).toBeVisible()
    await page.screenshot({ path: join(shots, 'report.png') })
  } finally {
    await app.close()
  }
})
