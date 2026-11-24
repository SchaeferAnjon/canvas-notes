// 待办默认提醒（2026-11-24 用户定）：AI 建带钟点的待办默认写「🔔 准时」，用户说了提前多久照说的写，说了不要提醒就不写。
// 假 AI（CN_AI_FAKE=1）用笔记工具在末尾加一行待办（它不懂规矩，不写 🔔），这一轮结束软件补上，和 AI 的改动同一次提交。
// 一律无头（CN_E2E=1）、临时库、临时设置目录。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openAi, openNote } from './app'

const TODO = '本周.md'
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).getByRole('button', { name: '停下' })).toBeHidden({ timeout: 20_000 })
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 20_000 })
}

test('AI 在笔记里建带钟点的待办：没写 🔔 的补「🔔 准时」、写了提前 1 小时的照写、说了不要提醒的不补、没钟点的不补', async () => {
  const run = await launch({ [TODO]: '# 本周\n\n- [ ] 原来的 📅 2026-11-25 10:00\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const disk = () => readFileSync(join(vault, TODO), 'utf8')
  const git = (...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
  try {
    await openNote(page, '本周')
    await openAi(page)
    await ask(page, `在「${TODO}」末尾加上「- [ ] 交报告 📅 2026-11-25 08:00」`)
    await expect.poll(disk).toMatch(/- \[ \] 交报告 📅 2026-11-25 08:00 🔔 准时\n?$/)
    // 同一次提交「AI：…」，工作区干净；编辑器拿到的也是补好的
    expect(git('log', '-1', '--format=%s')).toMatch(/^AI：/)
    expect(git('status', '--porcelain')).toBe('')
    await expect.poll(() => editorText(page)).toContain('交报告 📅 2026-11-25 08:00 🔔 准时')
    // 原来就有的那一条不动
    expect(disk()).toContain('- [ ] 原来的 📅 2026-11-25 10:00\n')

    await ask(page, `在「${TODO}」末尾加上「- [ ] 开组会 📅 2026-11-25 14:00 🔔 提前1小时」`)
    await expect.poll(disk).toContain('开组会 📅 2026-11-25 14:00 🔔 提前1小时')
    expect(disk()).not.toContain('提前1小时 🔔')

    await ask(page, `在「${TODO}」末尾加上「- [ ] 买菜 📅 2026-11-25 18:00」，不要提醒`)
    await expect.poll(disk).toContain('买菜 📅 2026-11-25 18:00')
    expect(disk()).not.toMatch(/买菜 📅 2026-11-25 18:00 🔔/)

    await ask(page, `在「${TODO}」末尾加上「- [ ] 寄快递 📅 2026-11-26」`)
    await expect.poll(disk).toContain('寄快递 📅 2026-11-26')
    expect(disk()).not.toMatch(/寄快递 📅 2026-11-26 🔔/)
    expect(git('status', '--porcelain')).toBe('')
  } finally {
    await run.close()
  }
})
