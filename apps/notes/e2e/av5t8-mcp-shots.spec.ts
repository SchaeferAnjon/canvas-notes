/**
 * 设置 › 对外接口（task-av5t8）的对照截图：只在给了 CN_SHOTS 时截（目录）。窗口 1440 × 887（和原型 46 页一样），天青、深湖各一组：
 * 关着、开着（Claude Code 装上并真调过、Codex 找到没装、ParaRead 装着没接上）、翻到底、调用记录。调用是照配置真拉起小程序调的。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { type Page, test } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from './app'

const dir = process.env.CN_SHOTS
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const row = (page: Page, id: string) => dlg(page).locator(`[data-row="${id}"]`)

const FILES = {
  '旅行/36-Travel-MOC.md': '# 旅行 MOC\n\n## 城市攻略\n\n### 法国\n\n- 巴黎\n\n### 德国\n\n- 柏林\n- 慕尼黑\n\n## 相关 MOC\n',
  '旅行/海德堡.md': '# 海德堡\n\n学生监狱在老城，秋天去最好。\n\n- [ ] 订海德堡的车票 📅 2099-01-01\n',
  '课程/欧洲史/Day-001-Geographic-Skeleton.md': '# Day 001\n\n## 海德堡\n\n海德堡大学建于 1386 年。\n',
}

for (const [skin, tone] of [
  ['sky', '天青'],
  ['petrol', '深湖'],
] as const) {
  test(`对外接口对照截图 · ${tone}`, async () => {
    test.skip(!dir, '只在给了 CN_SHOTS 时截')
    test.setTimeout(120_000)
    const home = mkdtempSync(join(tmpdir(), 'cn-mcp-shot-'))
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    for (const c of ['claude', 'codex']) {
      writeFileSync(join(home, '.local/bin', c), '#!/bin/sh\necho 1.0.0\n')
      chmodSync(join(home, '.local/bin', c), 0o755)
    }
    const installed = join(home, 'installed.json')
    writeFileSync(installed, JSON.stringify({ pararead: '0.1.5' }))
    const run = await launch(FILES, { HOME: home, CN_CLI_HOME_ONLY: '1', CLAUDE_CONFIG_DIR: '', CODEX_HOME: '', CN_FAMILY_INSTALLED_FILE: installed })
    const { page } = run
    const shot = async (name: string) => {
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
      await dlg(page).screenshot({ path: join(dir!, `${name}-${tone}.png`) })
    }
    try {
      await page.setViewportSize({ width: 1440, height: 887 })
      await page.evaluate((skin) => window.cn.setSettings({ appearance: { followSystem: false, skin } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()
      await page.keyboard.press('Meta+Comma')
      await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '对外接口', exact: true }).click()
      await row(page, 'mcpOn').waitFor()
      await shot('mcp-off')

      await row(page, 'mcpOn').getByRole('switch').click()
      await row(page, 'mcp-claude-code').getByRole('button', { name: '装上' }).click()
      await row(page, 'mcp-claude-code').getByText('已装上').waitFor()
      const e = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers['canvas-notes'] as { command: string; args: string[]; env: Record<string, string> }
      const c = new Client({ name: 'shots', version: '0' })
      await c.connect(new StdioClientTransport({ command: e.command, args: e.args, env: { PATH: process.env.PATH ?? '', ...e.env } }))
      for (const [name, args] of [
        ['search_notes', { query: '海德堡' }],
        ['read_note', { path: '旅行/36-Travel-MOC.md', outline_only: true }],
        ['read_note', { path: '课程/欧洲史/Day-001-Geographic-Skeleton.md', section: '海德堡' }],
        ['list_tasks', { range: 'week' }],
        ['open_note', { path: '旅行/36-Travel-MOC.md', section: '德国' }],
        ['read_note', { path: '旅行/36-Travel-MOC.md', section: '意大利' }],
      ] as const)
        await c.callTool({ name, arguments: args })
      await c.close()
      await page.keyboard.press('Meta+Comma')
      await page.keyboard.press('Meta+Comma')
      await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '对外接口', exact: true }).click()
      await row(page, 'mcp-claude-code').getByText('7天调了6次').waitFor()
      await shot('mcp-on')
      await dlg(page).locator('.set-body').evaluate((el) => (el.scrollTop = 99999))
      await shot('mcp-on-bottom')
      await row(page, 'mcpLog').getByRole('button', { name: '看记录' }).click()
      await dlg(page).getByRole('list', { name: '今天的调用' }).getByRole('listitem').first().waitFor()
      await shot('mcp-log')
      // 窄的设置（A 风格开成标签、窗口窄）：记录一条折成两行
      await page.setViewportSize({ width: 900, height: 887 })
      await shot('mcp-log-narrow')
    } finally {
      await run.close()
      rmSync(home, { recursive: true, force: true })
    }
  })
}
