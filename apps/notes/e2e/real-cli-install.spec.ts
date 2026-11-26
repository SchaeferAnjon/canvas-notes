/**
 * r172 A6 真跑（CN_REAL_CLI=1 才跑，要网）：这台 Mac 上装着的几家命令行在设置 › AI 点「检查更新」，真去官方发布的地方读新版本（不真更新）；
 * 没装的那家不装，只核它的官方安装脚本、下载地址回 200、是那一家的脚本。
 *   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_CLI=1 npx playwright test e2e/real-cli-install.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { launch } from './app'

test.skip(!process.env.CN_REAL_CLI, '真跑才跑：CN_REAL_CLI=1')

const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const cli = (page: Page, id: string) => dialog(page).getByRole('group', { name: '各家命令行' }).locator(`[data-row="cli${id.charAt(0).toUpperCase()}${id.slice(1)}"]`)

/** 官方安装脚本：地址、脚本里该有的那一家自己的下载地址 */
const SCRIPTS: Record<string, { url: string; has: RegExp }> = {
  claude: { url: 'https://claude.ai/install.sh', has: /downloads\.claude\.ai/ },
  codex: { url: 'https://chatgpt.com/codex/install.sh', has: /openai\/codex/ },
  opencode: { url: 'https://opencode.ai/install', has: /anomalyco\/opencode|\.opencode\/bin/ },
}

test('装着的「检查更新」真去读新版本；没装的只核官方安装脚本和下载地址', async () => {
  test.setTimeout(180_000)
  // 测试实例默认不连网：给出官方发布的地方（同 real-engines.spec.ts）
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_ENGINE_WATCH: '1', CN_NPM_REGISTRY: 'https://registry.npmjs.org', CN_CLAUDE_DIST: 'https://downloads.claude.ai/claude-code-releases' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    await expect(dialog(page).getByTestId('ai-default')).toBeVisible()
    const engines = await page.evaluate(async () => (await window.cn.aiEngines(true)).engines.filter((e) => ['claude', 'codex', 'gemini', 'opencode'].includes(e.id)).map((e) => ({ id: e.id, path: e.path, broken: e.broken ?? null })))
    for (const e of engines) {
      const row = cli(page, e.id)
      if (e.path) {
        const btn = row.getByRole('button', { name: '检查更新' })
        if (await btn.count()) {
          await btn.click()
          await expect(row.getByRole('button', { name: '正在查…' })).toHaveCount(0, { timeout: 60_000 })
        }
        const info = await page.evaluate(async (id) => (await window.cn.aiEngines()).engines.find((x) => x.id === id)!, e.id)
        console.log(`[${e.id}] ${e.path} · ${await row.getByTestId(`cli-desc-${e.id}`).innerText()} · 新版 ${info.latest ?? '没有'} · ${info.latestNote ?? '读到了'} · 更新命令 ${info.updateWith && 'text' in info.updateWith ? info.updateWith.text : JSON.stringify(info.updateWith)}`)
        // 读新版本那一步没出错（latestNote 是「没查成：…」那一句）
        expect(info.latestNote ?? '').not.toMatch(/没查|连不上|没连上|不连网/)
      } else {
        console.log(`[${e.id}] 没装或运行不了：${e.broken ?? '没找到'} · 按钮 ${await row.getByRole('button').first().innerText()}`)
      }
      const s = SCRIPTS[e.id]
      if (s) {
        const res = await fetch(s.url, { signal: AbortSignal.timeout(15_000) })
        expect(res.status).toBe(200)
        expect(await res.text()).toMatch(s.has)
      }
    }
    // Gemini CLI 走 npm：包在、要的 Node 版本
    const g = (await (await fetch('https://registry.npmjs.org/@google/gemini-cli/latest', { signal: AbortSignal.timeout(15_000) })).json()) as { version: string; engines?: { node?: string } }
    console.log(`[gemini] npm 上最新 ${g.version}，要 Node ${g.engines?.node}`)
    expect(g.version).toMatch(/^\d+\.\d+\.\d+/)
  } finally {
    await run.close()
  }
})
