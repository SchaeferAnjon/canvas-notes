// 截图（薄荷，供交付页）：AI 回答里选中一句的小菜单列出自己的 AI 命令（收着、「更多…」展开）、设置 › 回答下面那排「回答里选中一句」那一节、加一颗的「在哪能用」。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库。真点的断言在 selcmd-answer.spec.ts。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { join } from 'node:path'
import { launch, openAi, openNote } from './app'

const WEEK = '周记/2026-W47.md'
const WEEK_TEXT = '# 2026-W47\n\n周一：第5讲的作业开了个头。\n\n周三：早上开始跑步，5 公里。\n'
const CMDS = '.canvas-notes/命令.json'
const SENT = '周三开始每天早上跑步，三次都坚持下来了。'

const ai = (id: string, name: string, prompt: string) => ({ id, name, kind: 'ai', target: `1. ${prompt}`, rules: [{ t: prompt }], where: ['doc'], write: 'answer', desc: prompt, prompt })
const CMDS_TEXT =
  JSON.stringify(
    {
      version: 1,
      own: [
        ai('own-plain', '大白话', '用大白话解释{选中的字}'),
        ai('own-quiz', '考考我', '就这句出一道题考我'),
        ai('own-hidden', '藏起的', '这条去掉了勾'),
        ai('own-ex', '举个例子', '给{选中的字}举个生活里的例子'),
        ai('own-why', '为什么', '为什么会这样'),
        ai('own-en', '翻成英文', '把{选中的字}翻成英文'),
        ai('own-more', '再深一层', '往下再讲深一层'),
      ],
      answerSel: { off: ['own-hidden'] },
    },
    null,
    2,
  ) + '\n'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })

/** 在 scope 里用鼠标从 from 拖到 to（真拖，选区是浏览器自己算的；同 side-inline.spec） */
async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let s: [Node, number] | null = null
      let e: [Node, number] | null = null
      while (w.nextNode()) {
        const n = w.currentNode as Text
        if (!s && n.data.includes(a!)) s = [n, n.data.indexOf(a!)]
        if (s && n.data.includes(b!, s[0] === n ? s[1] : 0)) {
          e = [n, n.data.indexOf(b!, s[0] === n ? s[1] : 0) + b!.length]
          break
        }
      }
      const r = document.createRange()
      r.setStart(s![0], s![1])
      r.setEnd(e![0], e![1])
      ;(s![0] as Text).parentElement!.scrollIntoView({ block: 'center' })
      const rs = r.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}


const DIR = process.env.CN_SHOT_DIR ?? '/private/tmp/canvas-notes-visual/92-回答里选中放自定义命令'

test('截图：薄荷，小菜单（收着、更多展开）、设置那一节', async () => {
  test.setTimeout(180_000)
  const run = await launch({ [WEEK]: WEEK_TEXT, [CMDS]: CMDS_TEXT }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.evaluate(() => window.cn.setSettings({ appearance: { followSystem: false, skin: 'mint' } }))
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'mint')
    await openNote(page, '2026-W47')
    await openAi(page)
    const panel = chat(page)
    const ta = panel.getByRole('textbox', { name: '问 AI' })
    await ta.fill('把这周的周记总结成三句话')
    await ta.press('Enter')
    const txt = panel.getByTestId('ai-msg').last().locator('.txt')
    await expect(txt).toContainText('周三开始每天早上跑步', { timeout: 15_000 })
    await expect(panel.getByRole('button', { name: '发送' })).toBeVisible()
    await selectText(page, txt, '周三开始', '下来了。')
    await expect(askbox(page)).toBeVisible()
    await page.waitForTimeout(300)
    const aside = (await panel.boundingBox())!
    await page.screenshot({ path: join(DIR, '1-小条.png') })
    await page.screenshot({ path: join(DIR, '1-小条-近看.png'), clip: { x: aside.x, y: aside.y + 200, width: aside.width, height: 560 } })
    await askbox(page).getByRole('button', { name: '更多' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(DIR, '2-⋯展开-近看.png'), clip: { x: aside.x, y: aside.y + 200, width: aside.width, height: 640 } })
    await askbox(page).getByRole('menuitem', { name: '调整…' }).click()
    const sec = page.getByRole('dialog', { name: '设置' }).getByTestId('replies-sel')
    await expect(sec).toBeInViewport()
    await page.waitForTimeout(1800)
    await page.screenshot({ path: join(DIR, '3-设置-回答里选中一句.png') })
    await sec.getByRole('checkbox', { name: '大白话' }).click()
    await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '加一颗' }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(DIR, '4-加一颗-在哪能用.png') })
  } finally {
    await run.close()
  }
})
