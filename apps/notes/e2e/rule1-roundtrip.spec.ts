import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeNote } from '@cn/format'
import { FIXTURES } from '../../../packages/format/test/fixtures'
import { gitStatus, launch, openNote, pane, waitSaved } from './app'

// 规矩 1：一篇笔记打开、什么都不改、保存，文件一个字节都不变（Git 里没有假改动）。
test('打开再保存文件不变：每个样本打开、⌘S、打一个字再删掉、等自动保存，Git 状态仍然干净', async () => {
  const run = await launch(FIXTURES)
  const { page, vault } = run
  try {
    for (const [name, bytes] of Object.entries(FIXTURES)) {
      const title = name.replace(/\.md$/, '')
      await openNote(page, title)
      await pane(page).locator('.cm-content').click()
      await page.keyboard.press('Meta+s')
      if (!decodeNote(bytes).meta.readOnly) {
        await page.keyboard.type('x')
        await expect(pane(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Meta+s')
        await waitSaved(page)
      } else {
        // 只读文件：打字不进去
        await page.keyboard.type('x')
        await expect(pane(page).locator('.tool .meta').first()).toContainText('只读')
      }
      expect(Buffer.from(readFileSync(join(vault, name))).equals(Buffer.from(bytes)), name).toBe(true)
    }
    // 关掉所有标签（关的时候会再保存一次），之后仍然一个字节都不变
    while ((await page.locator('.tab').count()) > 0) await page.locator('.tab.on .x').click()
    await page.waitForTimeout(1200)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('真改了字就写回，CRLF 和 BOM 照旧', async () => {
  const run = await launch({ 'bom-crlf.md': FIXTURES['bom-crlf.md']! })
  const { page, vault } = run
  try {
    await openNote(page, 'bom-crlf')
    await pane(page).locator('.cm-line', { hasText: '内容' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('加了几个字')
    await waitSaved(page)
    const bytes = readFileSync(join(vault, 'bom-crlf.md'))
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString('utf8')).toBe('# BOM 加 CRLF\r\n内容加了几个字\r\n')
  } finally {
    await run.close()
  }
})
