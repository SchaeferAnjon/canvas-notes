// AI 这一轮提交没成功（2026-11-26 用户截图：「改好了，提交没成功：第4次也没提交上，pathspec '收件箱/Spaced repetition is an.md' did not match any file(s) known to git」）。
// 那一轮 AI 改了一篇、把几条测试剪藏删进废纸篓，答的途中每 10 分钟的自动提交先把这些改动（连删除）收走了；这一轮结束时按自己的清单再提交，
// 清单里删掉的那个文件已经不在工作区也不在暂存区，git commit 报 pathspec，「再提交一次」点几次都一样，「撤回」也对不上这一轮。
// 这里照样走一遍：全能模式（默认开）、假 AI 照脚本改一篇、删两条、歇几秒（自动提交调成每 1.5 秒一次）、再改一下；
// 修好以后：这一轮不报错、一次「AI：…」提交带上全部改动（自动提交这期间不碰它），「撤回」一下全回来。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openAi } from './app'

const SHOTS = process.env.CN_SHOTS_DIR
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' }).trim()

const files = {
  '收件箱/读书清单.md': '# 读书清单\n\n- 《思考，快与慢》\n',
  '收件箱/Spaced repetition is an.md': '# Spaced repetition is an\n\n剪藏测试一。\n',
  '收件箱/测试剪藏 2.md': '# 测试剪藏 2\n\n剪藏测试二。\n',
  '随手记.md': '# 随手记\n\n一段字。\n',
}

test('AI 一轮里删文件、答的途中自动提交来了：不报「提交没成功」，这一轮一次提交带上全部改动，撤回一下全回来', async () => {
  test.setTimeout(120_000)
  const script = join(mkdtempSync(join(tmpdir(), 'cn-race-')), 'script.json')
  writeFileSync(
    script,
    JSON.stringify([
      {
        say: '把测试剪藏收拾掉',
        steps: [
          { tool: 'note_write', args: { path: '收件箱/读书清单.md', text: '- 《原则》', mode: 'append' } },
          { tool: 'note_delete', args: { path: '收件箱/Spaced repetition is an.md' } },
          { tool: 'note_delete', args: { path: '收件箱/测试剪藏 2.md' } },
          // 歇 4 秒：自动提交（每 10「分钟」，一分钟调成 150 毫秒）这期间会来两三次
          { wait: 4000 },
          { tool: 'note_write', args: { path: '收件箱/读书清单.md', text: '- 《穷查理宝典》', mode: 'append' } },
          { say: '收拾好了：加了两本书，两条测试剪藏移到了废纸篓。' },
        ],
      },
    ]),
  )
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SCRIPT: script, CN_MINUTE_MS: '150' })
  const { page, vault } = run
  try {
    const before = git(vault, 'rev-parse', 'HEAD')
    await openAi(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('把测试剪藏收拾掉')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg).toContainText('收拾好了')
    // 答完以后的样子（修前修后对照用：修前这里没有改动卡和撤回）
    if (SHOTS) {
      await page.waitForTimeout(2500)
      await page.screenshot({ path: join(SHOTS, 'race-0-答完.png') })
    }
    // 等这一轮的提交落下（改动卡出来）
    await expect(msg.getByTestId('ai-change')).toBeVisible({ timeout: 15_000 })
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'race-1-改好了.png') })
    // 不报「提交没成功」
    await expect(msg).not.toContainText('提交没成功')
    await expect(msg).not.toContainText('pathspec')
    // 这一轮之后只有一次提交带着这三个文件，是「AI：…」那次（途中的自动提交没把它们收走）
    const commits = git(vault, 'log', '--format=%H%x09%s', `${before}..HEAD`).split('\n').filter(Boolean)
    const touching = commits.filter((c) => git(vault, 'show', '--name-only', '--format=', c.split('\t')[0]!).split('\n').some((p) => /读书清单|Spaced repetition|测试剪藏 2/.test(p)))
    expect(touching).toHaveLength(1)
    expect(touching[0]!.split('\t')[1]).toMatch(/^AI：/)
    const inAi = git(vault, 'show', '--name-status', '--format=', touching[0]!.split('\t')[0]!).split('\n').sort()
    expect(inAi).toEqual(['D\t收件箱/Spaced repetition is an.md', 'D\t收件箱/测试剪藏 2.md', 'M\t收件箱/读书清单.md'])
    expect(readFileSync(join(vault, '收件箱/读书清单.md'), 'utf8')).toContain('《穷查理宝典》')

    // 撤回这一轮：两条剪藏回来、读书清单回到原样
    await msg.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回', { timeout: 15_000 })
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'race-2-撤回了.png') })
    expect(existsSync(join(vault, '收件箱/Spaced repetition is an.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/测试剪藏 2.md'))).toBe(true)
    expect(readFileSync(join(vault, '收件箱/读书清单.md'), 'utf8')).toBe(files['收件箱/读书清单.md'])
  } finally {
    await run.close()
  }
})
