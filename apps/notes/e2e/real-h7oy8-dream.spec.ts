// 在任意一个库（CN_REAL_VAULT，给的必须是一份拷贝、已经 git init 提交过）上用真的 AI 梦游一晚（task-h7oy8）：只做补双链和可能重复，
// 判断照设置 › 梦游「AI判断补双链」（CN_REAL_ENGINE、CN_REAL_MODEL、CN_REAL_EFFORT，默认 Claude Code · Sonnet · Medium），每晚上限 CN_REAL_CAP（默认 500）。
// 跑完把报告 JSON、这晚的账、截图放进 CN_SHOTS。要联网、花额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" \
//     CN_REAL_AI=1 CN_REAL_VAULT=<库的拷贝> CN_SHOTS=<截图目录> npx playwright test e2e/real-h7oy8-dream.spec.ts
// 设置目录默认在库旁边的 user-data（CN_REAL_USERDATA 能换）：判断进度记在那里，同一份设置目录再跑一次就是「第二晚」，接着判剩下的。
import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { leftView } from './app'

const VAULT = process.env.CN_REAL_VAULT ?? ''
test.skip(!process.env.CN_REAL_AI || !VAULT, '真 AI、真库才跑：CN_REAL_AI=1 CN_REAL_VAULT=<库的拷贝>')
test.setTimeout(4 * 3600_000)

test('真库上梦游一晚：补双链和可能重复，报告、账和截图存下来', async () => {
  const userData = process.env.CN_REAL_USERDATA || join(dirname(VAULT), 'user-data')
  const shots = process.env.CN_SHOTS || join(dirname(VAULT), 'shots')
  mkdirSync(shots, { recursive: true })
  mkdirSync(userData, { recursive: true })
  const settingsFile = join(userData, 'settings.json')
  const old = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {}
  const judge = { engine: process.env.CN_REAL_ENGINE || 'claude', model: process.env.CN_REAL_MODEL || 'sonnet', effort: process.env.CN_REAL_EFFORT || 'medium' }
  writeFileSync(
    settingsFile,
    JSON.stringify({
      ...old,
      // 按意思找默认关着（真库建 bge-m3 索引要几个小时，和梦游抢 CPU）；CN_REAL_SEMANTIC=1 开（索引建好了才有向量那一路）
      editor: { ...(old.editor ?? {}), semantic: process.env.CN_REAL_SEMANTIC === '1' },
      dream: { auto: false, steps: { file: false, rename: false, week: false, viz: false, attach: false, dup: true, video: true, link: true }, nightCap: Number(process.env.CN_REAL_CAP) || 500, judge },
    }),
  )
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: VAULT, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(dirname(VAULT), 'trash'), CN_ICLOUD_CONTAINER: join(dirname(VAULT), 'icloud') },
  })
  const page = await app.firstWindow()
  try {
    await expect(page.locator('.vault b')).toBeVisible({ timeout: 60_000 })
    const t0 = Date.now()
    const report = await page.evaluate(() => window.cn.dreamNow())
    const ms = Date.now() - t0
    writeFileSync(join(shots, 'report.json'), JSON.stringify({ ms, report }, null, 2))
    const j = report.judge
    console.log(`梦游一晚：${Math.round(ms / 1000)} 秒；判断 ${JSON.stringify(j)}；条目 ${report.items.map((i) => i.group).join(',')}`)
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.getByTestId('dream-summary')).toBeVisible()
    await page.screenshot({ path: join(shots, 'report.png') })
    for (const g of ['link', 'unsure', 'recheck', 'dup'] as const) {
      const it = report.items.find((i) => i.group === g)
      if (!it) continue
      await panel.getByTestId('dream-item').filter({ hasText: it.title }).filter({ hasText: it.sub }).first().click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(shots, `report-${g}.png`) })
    }
  } finally {
    await app.close()
  }
})
