// 对话区不横滚（用户截图 r139：右栏 AI 整理 study project 2，步骤行「把《…》挪进『项目/study project 2/论文/情绪识别 Emo』」很长，
// 整个对话区往右滚出去，左边被切掉）。原因：步骤行的动作字 white-space: nowrap 且不让缩，一长行撑宽整列。
// 修好以后：步骤行、路径、命令按字折行（长路径在 / 后面断），对话区 scrollWidth == clientWidth，横着拨不动；代码块在自己框里横滚。
// 无头、假 AI、临时库；CN_SHOTS=目录 时把薄荷截图写进去。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote } from './app'

const TITLE = '多模态情绪识别综述阅读笔记：从面部表情、语音韵律到生理信号的融合方法比较与实验复现记录'
const FOLDER = '项目/study project 2/论文/情绪识别 Emo/' + Array(20).fill('很长的一层文件夹名字').join('/')
// 200 字符没空格的标题（命令、库外路径在步骤行里本来就截到 40 来字，标题不截）
const NOSPACE = ('torch.tensor(inputs.to_numpy(dtype=float)).reshape(-1,1)' + '_').repeat(4).slice(0, 200)
const files = {
  [`${NOSPACE}.md`]: '# 长名字\n',
  '学习笔记.md': '# 学习笔记\n\n一段字。\n',
  [`收件箱/${TITLE}.md`]: `# ${TITLE}\n\n三条路。\n`,
  [`${FOLDER}/占位.md`]: '# 占位\n',
}
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
}

/** 对话列表、每一步那一行、回答正文、代码块：宽度和伸出去多少 */
function measure(chat: Locator) {
  return chat.locator('.msgs').evaluate((list) => {
    const cs = getComputedStyle(list)
    const right = list.getBoundingClientRect().right - parseFloat(cs.paddingRight)
    const textOut = (el: Element) => {
      let max = -Infinity
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.parentElement?.closest('pre')) continue
        const r = document.createRange()
        r.selectNodeContents(n)
        for (const b of r.getClientRects()) max = Math.max(max, b.right - right)
      }
      return Math.round(max)
    }
    return {
      list: { sw: list.scrollWidth, cw: list.clientWidth, ox: cs.overflowX },
      steps: [...list.querySelectorAll<HTMLElement>('[data-testid="ai-step"]')].map((s) => ({
        text: (s.textContent ?? '').length,
        h: Math.round(s.getBoundingClientRect().height),
        right: Math.round(s.getBoundingClientRect().right - right),
        textRight: textOut(s),
      })),
      txt: [...list.querySelectorAll('.am .txt')].map(textOut),
      pres: [...list.querySelectorAll('pre')].map((p) => ({ sw: p.scrollWidth, cw: p.clientWidth, right: Math.round(p.getBoundingClientRect().right - right) })),
    }
  })
}

async function send(page: Page, chat: Locator, text: string) {
  const box = chat.getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
}

test('右栏 AI：300 字的挪动步骤、200 字没空格的命令、库外长路径都折行，对话区不横滚；宽代码块在自己框里横滚', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await openNote(page, '学习笔记')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    // 真走一次我们的挪动工具：步骤行是「把《…》挪进『…』」
    await send(page, chat, `把「收件箱/${TITLE}.md」挪到「${FOLDER}」`)
    await expect(chat.getByTestId('ai-step').first()).toContainText('挪进')
    // 假 AI 跑一条 200 字符没空格的命令、读一个库外 300 字符的路径、回一个很宽的代码块
    await send(page, chat, `长步骤行「${NOSPACE}.md」`)
    await expect(chat.getByTestId('ai-msg').last().locator('.txt')).toContainText('短的一行')

    const m = await measure(chat)
    console.log(JSON.stringify(m))
    expect(m.list.ox).toBe('hidden')
    expect(m.list.sw).toBe(m.list.cw)
    // 四条步骤：挪动那条约 300 字、跑命令（200 字符的命令截成 40 来字）、读库外 300 字符的路径（从左截成 44）、读 200 字符没空格的那篇；
    // 长的两条折成了好几行，四条的字和整行都不伸出对话区
    expect(m.steps.length).toBe(4)
    expect(m.steps[0]!.text).toBeGreaterThan(250)
    expect(m.steps[3]!.text).toBeGreaterThan(200)
    expect(m.steps[0]!.h).toBeGreaterThan(24 * 3)
    expect(m.steps[3]!.h).toBeGreaterThan(24 * 2)
    for (const s of m.steps) {
      expect(s.right).toBeLessThanOrEqual(0)
      expect(s.textRight).toBeLessThanOrEqual(0)
    }
    for (const r of m.txt) expect(r).toBeLessThanOrEqual(0)
    // 代码块：照原样一行（不折），比框宽，在自己框里横滚，框不伸出对话区
    expect(m.pres.length).toBe(1)
    expect(m.pres[0]!.sw).toBeGreaterThan(m.pres[0]!.cw)
    expect(m.pres[0]!.right).toBeLessThanOrEqual(0)

    // 挪动那一步的长路径在 / 后面（或路径里的空格处）断，不在一段文件夹名中间断
    await chat.getByTestId('ai-step').first().scrollIntoViewIfNeeded()
    const cut = await chat.getByTestId('ai-step').first().locator('.sl').evaluate((code) => {
      const text = code.textContent ?? ''
      const walk = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
      const ends: string[] = []
      let lastTop = -1
      let prev = ''
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const s = n.textContent ?? ''
        for (let i = 0; i < s.length; i++) {
          const r = document.createRange()
          r.setStart(n, i)
          r.setEnd(n, i + 1)
          const top = Math.round(r.getBoundingClientRect().top)
          if (lastTop >= 0 && top > lastTop) ends.push(prev)
          lastTop = top
          prev = s[i]!
        }
      }
      return { len: text.length, ends }
    })
    console.log(JSON.stringify(cut))
    // 标题那段在标点后断（、》），路径那段每一行都断在 / 或空格后面，不在「很长的一层文件夹名字」中间断
    expect(cut.ends.filter((c) => c === '/').length).toBeGreaterThan(5)
    expect(cut.ends.every((c) => c === '/' || c === ' ' || '、，：》'.includes(c))).toBe(true)

    // 真拨：在步骤行上横着拨，对话区不动；在代码块上横着拨，代码块自己滚
    const list = chat.locator('.msgs')
    await chat.getByTestId('ai-step').nth(1).hover()
    await page.mouse.wheel(300, 0)
    await page.waitForTimeout(150)
    expect(await list.evaluate((el) => el.scrollLeft)).toBe(0)
    const pre = chat.locator('.am pre')
    await pre.scrollIntoViewIfNeeded()
    await pre.hover()
    await page.mouse.wheel(200, 0)
    await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    expect(await list.evaluate((el) => el.scrollLeft)).toBe(0)

    await chat.getByTestId('ai-step').first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const dir = process.env.CN_SHOTS
    const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
    writeFileSync(dir ? join(dir, 'ai-step-nowrap-mint.png') : test.info().outputPath('ai-step-nowrap-mint.png'), Buffer.from(b64, 'base64'))
  } finally {
    await run.close()
  }
})
