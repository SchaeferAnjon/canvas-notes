/**
 * 面板透明度（task-jgely）交付图：同一页（文档 + 左栏 + 右栏大纲）透明度最低 / 默认 / 最高三张，浅色天青、深色深湖各一套；
 * 设置 › 外观里那一行（默认、拖到最透、A 时灰着）。透明度是真拖设置里的滑杆拉的，不是直接改变量。
 * 只在给了 CN_SHOTS 时跑：CN_SHOTS=目录
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { GLASS_MAX, GLASS_MIN } from '../../../packages/design/src/glass'
import { launch, openNote, rail, type Running } from './app'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const pad = (n: number) => String(n).padStart(2, '0')
const D = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const FILES = {
  '写作/小论文计划.md': `# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文 📅 ${D(0)}\n- [ ] 交论文初稿 📅 ${D(1)} 15:00 🔔 提前1小时 ⏫\n- [x] 和导师约时间\n\n## 下周\n\n先把第二章的实验图补上，再改摘要。引用的几篇放在**参考文献**那一节，格式统一成 APA。\n\n> 写作不是把想好的东西抄下来，是在写的时候想清楚。\n\n- 补实验图\n- 改摘要\n- 查重\n`,
  '旅行/冰岛.md': '# 冰岛\n\n冰洞只在冬天开放，必须跟导游进去，提前两周订。\n',
  '收件箱/待办.md': `# 待办\n\n- [ ] 回导师邮件 📅 ${D(0)} 10:30\n- [ ] 买打印纸\n`,
}

async function png(run: Running, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  await run.page.mouse.move(720, 880)
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }, clip) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(clip)).toPNG().toString('base64'), clip)
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** 设置 › 外观，翻到「面板透明度」那一行 */
async function openLook(page: Page) {
  await page.keyboard.press('Meta+Comma')
  const set = page.getByRole('dialog', { name: '设置' })
  await expect(set).toBeVisible()
  await set.getByRole('button', { name: '外观' }).first().click()
  const slider = set.getByRole('slider', { name: '面板透明度' })
  await slider.scrollIntoViewIfNeeded()
  return { set, slider }
}

/** 真拖滑杆到 v：从滑块现在的位置按住，挪到 v 对应的那一点 */
async function dragTo(page: Page, slider: ReturnType<Page['getByRole']>, v: number) {
  const b = (await slider.boundingBox())!
  const at = (x: number) => b.x + 7 + ((x - GLASS_MIN) / (GLASS_MAX - GLASS_MIN)) * (b.width - 14)
  const cur = Number(await slider.inputValue())
  await page.mouse.move(at(cur), b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(at(v), b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(slider).toHaveValue(String(v))
}

for (const skin of ['sky', 'petrol'] as const) {
  test(`透明度三档：${skin}`, async () => {
    test.setTimeout(150_000)
    mkdirSync(DIR!, { recursive: true })
    const run = await launch(FILES, {}, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
      await openNote(page, '小论文计划')
      await rail(page).getByRole('button', { name: /^大纲/ }).click()
      await page.waitForTimeout(400)
      await png(run, `glass-${skin}-default`)

      const { set, slider } = await openLook(page)
      const row = set.locator('[data-row="glass"]')
      const box = async () => {
        const a = (await row.boundingBox())!
        const n = (await set.locator('.gl-note').boundingBox())!
        return { x: Math.round(a.x - 24), y: Math.round(a.y - 150), width: Math.round(a.width + 48), height: Math.round(n.y + n.height - a.y + 170) }
      }
      await png(run, `row-${skin}-default`, await box())
      await dragTo(page, slider, GLASS_MAX)
      await png(run, `row-${skin}-max`, await box())
      await page.keyboard.press('Escape')
      await expect(set).toBeHidden()
      await png(run, `glass-${skin}-max`)

      const o = await openLook(page)
      await dragTo(page, o.slider, GLASS_MIN)
      await page.keyboard.press('Escape')
      await expect(o.set).toBeHidden()
      await png(run, `glass-${skin}-min`)
    } finally {
      await run.close()
    }
  })
}

test('A 照 VS Code 时那一行灰着', async () => {
  test.setTimeout(90_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'none' } }))
  })
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    const { set } = await openLook(run.page)
    const row = set.locator('[data-row="glass"]')
    const a = (await row.boundingBox())!
    await png(run, 'row-none-off', { x: Math.round(a.x - 24), y: Math.round(a.y - 150), width: Math.round(a.width + 48), height: 240 })
  } finally {
    await run.close()
  }
})
