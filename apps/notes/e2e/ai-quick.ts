/**
 * AI 空对话输入框上面那排快捷命令（task-0tgz2）：露着的直接点；收进「⋯」的先点「⋯」再点那一行（跟人一样）
 */
import { expect, type Locator } from '@playwright/test'

/** 这一格（AI 对话或读 PDF 那一格）里所有快捷命令的字，露着的和收进「⋯」的都算，按顺序 */
export async function quickTexts(cell: Locator): Promise<string[]> {
  return cell.getByTestId('ai-quick').locator('.qc:not(.more)').allTextContents()
}

export async function pickQuick(cell: Locator, text: string) {
  const chip = cell.getByTestId('ai-quick').locator('.qc:not(.more):visible').filter({ hasText: text })
  if (await chip.count()) return chip.click()
  await cell.getByTestId('ai-quick').getByRole('button', { name: '更多命令' }).click()
  const menu = cell.page().getByRole('menu', { name: '更多命令' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem').filter({ hasText: text }).click()
}
