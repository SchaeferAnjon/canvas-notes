/**
 * 交付对照图（新建入口方案 A）：软件摆成设计页 149 效果图那样（同一个样本库、开三篇、中间停在收件箱首页、1440×900），整窗截：
 * 悬停「+」、点小箭头出菜单、「放进 ⌄」挑文件夹、左栏收起时。薄荷、深湖各截 B 浮岛书桌和 A 照 VS Code。
 * 只在截交付图时跑：CN_SHOTS=目录。平时跳过。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, openNote, type Running } from './app'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const NOTES = ['冰岛自驾行程', '组会准备', '游记草稿']
const files: Record<string, string> = {
  '收件箱/冰岛自驾行程.md': '# 冰岛自驾行程\n\n2 月 21 日落地雷克雅未克，租车走南岸。\n',
  '收件箱/组会准备.md': '# 组会准备\n\n下周讲 LIF 神经元。\n',
  '收件箱/动手学深度学习.md': '# 动手学深度学习\n\n第 3 章线性回归，下周看完。\n',
  '收件箱/待办.md': '# 待办\n\n- [ ] 订 2 月的机票\n',
  '写作/游记草稿.md': '# 游记草稿\n\n冰河湖边的风很大。\n',
  '课程/线性代数/第3讲 线性映射 笔记.md': '# 第3讲 线性映射 笔记\n\n线性映射保持加法和数乘。\n',
  '阅读/巴菲特传.md': '# 巴菲特传\n\n第一部分：泡沫。\n',
  '生活/健身计划.md': '# 健身计划\n\n周二、周四、周六。\n',
}

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

for (const frame of ['b', 'a'] as const)
  for (const skin of ['mint', 'petrol'] as const)
    test(`新建入口 ${frame} ${skin}`, async () => {
      test.setTimeout(120_000)
      mkdirSync(DIR!, { recursive: true })
      const tag = `${frame}-${skin}`
      const run = await launch(files, {}, (vault) => {
        const ud = join(dirname(vault), 'user-data')
        mkdirSync(ud, { recursive: true })
        writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame } }))
      })
      const { page } = run
      const plus = page.locator('.titlebar').getByRole('button', { name: '新建文档', exact: true })
      const chev = page.locator('.titlebar').getByRole('button', { name: '新建白板、数据库…' })
      try {
        await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
        for (const n of NOTES) await openNote(page, n)
        await leftView(page, '收件箱')
        await expect(page.getByTestId('tab-on')).toHaveText('收件箱')

        await plus.hover()
        await expect(page.getByTestId('tooltip')).toBeVisible()
        await shot(run, `plus-${tag}`)

        await page.mouse.move(700, 600)
        await chev.click()
        await expect(page.getByRole('dialog', { name: '新建', exact: true })).toBeVisible()
        await shot(run, `menu-${tag}`)

        await page.locator('.ne-chip').click()
        await expect(page.getByRole('dialog', { name: '移到' })).toBeVisible()
        await shot(run, `pick-${tag}`)
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')

        await page.locator('.titlebar').getByRole('button', { name: '收起左栏' }).click()
        await expect(page.locator('aside.side')).toBeHidden()
        await chev.click()
        await expect(page.getByRole('dialog', { name: '新建', exact: true })).toBeVisible()
        await shot(run, `collapsed-${tag}`)
      } finally {
        await run.close()
      }
    })
