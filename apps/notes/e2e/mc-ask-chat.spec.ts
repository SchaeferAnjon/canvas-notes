// MeetCaption 问 AI 的对话在画布笔记里接着问（2026-11-25 MeetCaption 问 AI 方案 B，apps/meetcaption/src/agent）：
// MeetCaption 把这节课问的对话存进画布笔记的对话目录（userData/ai/chats/<库>/，同一个 AgentStore），地方是那篇上课记录（file:<路径>）。
// 画布笔记打开那篇上课记录，AI 对话里就是那段对话（引用的字幕是一块材料、回答里的〔时间〕照字写），能接着问，问的也存在同一个地方（MeetCaption 那边也看得到）。
// 对话从哪来：给了 MC_HANDOFF（MeetCaption 的 e2e scripts/e2e/ask-agent.mjs 留下的 handoff.json）就搬那一次真跑出来的；没给用这里照 MeetCaption 写法拼的一段。
// 给了 CN_SHOTS（目录）时截一张交付图。
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AgentStore } from '../src/main/agent/store'
import type { StoredMsg } from '../src/shared/agent'
import { launch, openNote } from './app'
import { MC_FILES, REC_A } from './fixtures/meetcaption'

test.setTimeout(180_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const PLACE = `file:${REC_A}`
const TITLE = REC_A.split('/').pop()!.replace(/\.md$/, '')

/** 照 MeetCaption 存的样子（src/agent/index.ts 的 ask）：你问的那句带引用的字幕（材料），回答带谁答的、步骤 */
const FIXTURE: StoredMsg[] = [
  { id: 1, role: 'user', time: Date.UTC(2026, 10, 4, 8, 40), text: '刚才讲了什么', mats: [{ kind: 'quote', text: 'An approximate adder trades accuracy for power.', src: '字幕 09:40' }] },
  {
    id: 2,
    role: 'ai',
    time: Date.UTC(2026, 10, 4, 8, 40, 20),
    text: '刚才老师说近似加法器用一点精度换功耗〔09:40〕，下一步讲 CDM8 乘法器。',
    engine: 'claude',
    by: 'Claude Code · Opus 5.5',
    steps: [{ id: 's1', label: '读最近 5 分钟的字幕', status: 'ok' }],
  },
]

function handoffMsgs(): StoredMsg[] {
  const f = process.env.MC_HANDOFF
  if (!f) return FIXTURE
  const h = JSON.parse(readFileSync(f, 'utf8')) as { vault: string; notesData: string; place: string }
  return new AgentStore(join(h.notesData, 'ai')).chat(h.vault, h.place).msgs
}

test('MeetCaption 在这节课问的对话：画布笔记打开那篇上课记录就看得到，能接着问，问的存回同一个地方', async () => {
  const msgs = handoffMsgs()
  const firstAsk = msgs.find((m) => m.role === 'user')!.text!
  let userData = ''
  const run = await launch(MC_FILES, { CN_AI_FAKE: '1' }, (vault) => {
    // MeetCaption 那边写的：画布笔记设置目录里的同一个对话目录（launch 起软件前写好）
    userData = join(dirname(vault), 'user-data')
    new AgentStore(join(userData, 'ai')).saveMsgs(vault, PLACE, TITLE, msgs)
  })
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    // 截交付图时换主题（CN_SKIN=mint 浅、petrol 深）
    const skin = process.env.CN_SKIN
    if (skin) {
      await page.evaluate((s) => window.cn.setSettings({ appearance: { followSystem: false, skin: s } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()
    }
    const tag = skin ? `-${skin}` : ''
    await openNote(page, TITLE)
    await page.keyboard.press('Meta+j')
    await expect(chat(page).getByTestId('ai-conv')).toHaveText(TITLE)
    await expect(chat(page).locator('.um').first()).toContainText(firstAsk)
    const answers = chat(page).getByTestId('ai-msg')
    await expect(answers.first().locator('.txt')).toContainText(msgs.find((m) => m.role === 'ai')!.text!.slice(0, 8))
    if (process.env.CN_SHOTS) await chat(page).screenshot({ path: join(process.env.CN_SHOTS, `notes-接着问前${tag}.png`) })

    // 接着问：画布笔记的 AI（假引擎）答，存回同一个地方
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('再讲细一点')
    await box.press('Enter')
    await expect(answers.last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 30_000 })
    if (process.env.CN_SHOTS) await chat(page).screenshot({ path: join(process.env.CN_SHOTS, `notes-接着问${tag}.png`) })
    await expect
      .poll(() => new AgentStore(join(userData, 'ai')).chat(vault, PLACE).msgs.filter((m) => m.role === 'user').map((m) => m.text))
      .toEqual([...msgs.filter((m) => m.role === 'user').map((m) => m.text), '再讲细一点'])
  } finally {
    await run.close()
  }
})
