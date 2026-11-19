// 旁支（CN-90，方向 A「照 Dispatch 旁支」）的后端：界面是下一段做的，这里按界面会发的请求真发（window.cnReading.ask 带 side）。
// 第一问从这份 PDF 主对话的会话分叉、会话号另起一个；同一条旁支接着问接着它自己的会话；主对话的会话一直不动。
import { expect, test, type Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AskRequest } from '../src/shared/reading'
import { launch, openAi, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })

test('旁支：reading:ask 带 side 时第一问从主对话分叉（会话号另起），同一条旁支接着问接着它自己的；两条旁支各是各的；主对话的会话不动', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  const sessions = () => {
    const dir = join(run.userData, 'reading')
    const f = readdirSync(dir).find((n) => n.endsWith('.sessions.json'))!
    return JSON.parse(readFileSync(join(dir, f), 'utf8')) as { sessions: Record<string, string>; sides?: Record<string, Record<string, string>> }
  }
  const askSide = (id: number, side: AskRequest['side'], text = '为什么减掉门槛，而不是清零？') =>
    page.evaluate(
      ([id, pdf, side, text]) =>
        window.cnReading.ask({ id: id as number, pdf: pdf as string, hash: 'x', engine: 'claude', thread: { id: '.canvas-notes/对话/第3讲-p1-1.md', page: 1, createdAt: Date.now() }, text: text as string, images: [], pageText: '', pages: 3, side: side as AskRequest['side'] }),
      [id, PDF, side, text] as const,
    )
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    // 主对话先问一句：有了主对话的会话
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('给我讲讲这一页')
    await box.press('Enter')
    await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).toContainText('新会话', { timeout: 15_000 })
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible()
    expect(sessions().sessions.claude).toBe('fake-read-claude')

    const history = '【那一轮】他问：给我讲讲这一页\n你答：水位一到门槛就发一个 spike，再减掉一个门槛的量'
    const first = await askSide(9101, { id: 'side-1', history })
    expect(first.error).toBeUndefined()
    expect(first.text).toContain('旁支，从 fake-read-claude 分叉')
    expect(first.text).toContain('没读全文')
    expect(sessions().sides).toEqual({ 'side-1': { claude: 'fake-side-claude-1' } })
    expect(sessions().sessions.claude).toBe('fake-read-claude')

    // 同一条旁支接着问：接着它自己的会话
    const again = await askSide(9102, { id: 'side-1', history }, '那门槛是多少？')
    expect(again.text).toContain('接着聊')
    expect(again.text).not.toContain('分叉')
    expect(sessions().sides!['side-1']).toEqual({ claude: 'fake-side-claude-1' })

    // 另开一条旁支：又从主对话分叉，会话号又是新的
    const other = await askSide(9103, { id: 'side-2', history })
    expect(other.text).toContain('旁支，从 fake-read-claude 分叉')
    expect(sessions().sides).toEqual({ 'side-1': { claude: 'fake-side-claude-1' }, 'side-2': { claude: 'fake-side-claude-2' } })

    // 主对话接着问：还是主对话自己的会话
    await box.fill('还是不懂')
    await box.press('Enter')
    await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).toContainText('接着聊', { timeout: 15_000 })
    expect(sessions().sessions.claude).toBe('fake-read-claude')

    // 旁支编号不对的不发
    const bad = await page.evaluate((pdf) => window.cnReading.ask({ id: 9104, pdf, hash: 'x', engine: 'claude', thread: { id: '.canvas-notes/对话/第3讲-p1-1.md', page: 1, createdAt: Date.now() }, text: '问', images: [], pageText: '', pages: 3, side: { id: '../x', history: '' } }).then(() => '', (e: Error) => e.message), PDF)
    expect(bad).toContain('AI 参数不对')
  } finally {
    await run.close()
  }
})
