import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, waitSaved } from './app'

// 规矩 2：正在编辑时外部改动进来（同步、AI、梦游），正在打的字不丢；冲突的那一版另存一份冲突副本。

const BASE = '# 旅行\n\n第一段。\n\n第二段。\n\n第三段。\n'

/** 一边慢慢打字（每个字 120ms，自动保存一直等不到空闲），一边让外部改文件 */
async function typeWhileExternalWrite(page: import('@playwright/test').Page, text: string, write: () => void) {
  const typing = page.keyboard.type(text, { delay: 120 })
  await page.waitForTimeout(400)
  write()
  await typing
}

test('改的不是一处：外部改动合并进来，正在打的字一个不少，光标还在原处', async () => {
  const run = await launch({ '旅行.md': BASE })
  const { page, vault } = run
  const file = join(vault, '旅行.md')
  try {
    await openNote(page, '旅行')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await typeWhileExternalWrite(page, '正在打的字，外部改动来了也接着打', () =>
      writeFileSync(file, BASE.replace('第三段。', '第三段。AI 补的一句')),
    )
    await expect.poll(() => editorText(page)).toContain('AI 补的一句')
    const shown = await editorText(page)
    expect(shown).toContain('第一段。正在打的字，外部改动来了也接着打')
    await waitSaved(page)
    expect(readFileSync(file, 'utf8')).toBe(
      '# 旅行\n\n第一段。正在打的字，外部改动来了也接着打\n\n第二段。\n\n第三段。AI 补的一句\n',
    )
    await expect(page.locator('.toast-cn')).toContainText('合并')
  } finally {
    await run.close()
  }
})

test('改了同一处：编辑器里的字不动，外部那版另存成冲突副本，磁盘上是你的版本', async () => {
  const run = await launch({ '旅行.md': BASE })
  const { page, vault } = run
  const file = join(vault, '旅行.md')
  const remote = BASE.replace('第二段。', '第二段，同步过来的改动')
  try {
    await openNote(page, '旅行')
    await pane(page).locator('.cm-line', { hasText: '第二段。' }).click()
    await page.keyboard.press('End')
    await typeWhileExternalWrite(page, '我正在改这一段', () => writeFileSync(file, remote))
    await expect(page.locator('.toast-cn')).toContainText('冲突', { timeout: 10_000 })
    expect(await editorText(page)).toContain('第二段。我正在改这一段')
    await waitSaved(page)
    expect(readFileSync(file, 'utf8')).toBe(BASE.replace('第二段。', '第二段。我正在改这一段'))
    const copies = readdirSync(vault).filter((f) => f.startsWith('旅行（冲突 '))
    expect(copies).toHaveLength(1)
    expect(readFileSync(join(vault, copies[0]!), 'utf8')).toBe(remote)
    // 冲突副本也出现在左栏
    await expect(page.locator('.nav .si', { hasText: '旅行（冲突' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('没在改的时候外部改了：编辑器直接换成新的，不写回', async () => {
  const run = await launch({ '旅行.md': BASE })
  const { page, vault } = run
  const file = join(vault, '旅行.md')
  try {
    await openNote(page, '旅行')
    const remote = BASE + '\n第四段，从别的电脑同步来的。\n'
    writeFileSync(file, remote)
    await expect.poll(() => editorText(page)).toContain('第四段')
    await page.waitForTimeout(1200)
    expect(readFileSync(file, 'utf8')).toBe(remote)
    await expect(pane(page).getByTestId('save-state')).toHaveAttribute('data-state', 'saved')
  } finally {
    await run.close()
  }
})
