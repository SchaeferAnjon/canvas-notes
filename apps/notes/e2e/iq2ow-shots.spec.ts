/**
 * 「最近删掉的」挪到图标栏底部一格（task-iq2ow）的交付图：CN_SHOTS=目录 时截，浅色天青、深色深湖，B 和 A。
 * 每种截四张：平常（1440×900，左栏「文件」）、点开「最近删掉的」看一条、指着一行、矮窗口（600 高）。
 * 改前、改后同一个脚本：改前没有那一格时点文件树最底下那一行。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'
import { trashHistory, TRASH_VAULT } from './fixtures/trash-vault'

const SHOTS = process.env.CN_SHOTS
const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })

function look(frame: 'a' | 'b', skin: string) {
  return (vault: string) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame, winBg: 'aurora' } }))
    trashHistory(vault)
  }
}

async function height(run: Running, h: number) {
  await run.app.evaluate(({ BrowserWindow }, h) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, h), h)
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(h)
  await run.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

test.describe('交付图', () => {
  test.skip(!SHOTS, '只在截交付图时跑（CN_SHOTS=目录）')
  for (const [frame, tone, skin] of [
    ['b', 'light', 'sky'],
    ['b', 'dark', 'petrol'],
    ['a', 'light', 'sky'],
    ['a', 'dark', 'petrol'],
  ] as const) {
    test(`${frame.toUpperCase()} ${tone}：平常、点开最近删掉的、矮窗口`, async () => {
      test.setTimeout(120_000)
      const run = await launch(TRASH_VAULT, {}, look(frame, skin))
      const { page, app } = run
      const shot = async (name: string, keepMouse = false) => {
        if (!keepMouse) await page.mouse.move(700, 400)
        await page.waitForTimeout(450)
        const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
        mkdirSync(SHOTS!, { recursive: true })
        writeFileSync(join(SHOTS!, `${name}.png`), Buffer.from(b64, 'base64'))
      }
      try {
        await height(run, 900)
        await bar(page).getByRole('button', { name: '文件', exact: true }).click()
        const tree = page.getByRole('tree', { name: '全部文件' })
        await expect(tree).toBeVisible()
        // 改前：文件树最底下那一行，滚到看得见
        const row = tree.getByRole('button', { name: /^最近删掉的/ })
        if (await row.count()) await row.scrollIntoViewIfNeeded()
        await shot(`${frame}-${tone}-1-files`)
        const cell = bar(page).getByTestId('ab-trash')
        if (await cell.count()) await cell.click()
        else await row.click()
        const item = page.getByRole('listitem').filter({ hasText: '旧的读书计划' }).first()
        await item.click()
        await expect(page.getByRole('region', { name: '删掉前的样子' })).toContainText('巴菲特传')
        await shot(`${frame}-${tone}-2-trash`)
        // 指着一行：「看一看」「放回」
        await page.getByRole('listitem').filter({ hasText: '随手记' }).first().hover()
        await shot(`${frame}-${tone}-2b-hover`, true)
        for (let h = 900; h >= 600; h -= 50) await height(run, h)
        await shot(`${frame}-${tone}-3-600`)
      } finally {
        await run.close()
      }
    })
  }
})
