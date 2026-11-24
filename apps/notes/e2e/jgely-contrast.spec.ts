/**
 * 面板透明度（task-jgely）两头和默认都看得清：十套主题 × 两张自带窗口背景（极光、冰洞）× 透明度最低 / 默认 / 最高，
 * B 浮岛书桌几个主要页面（首页、文档 + 右栏大纲、白板、数据库表格 + 右栏一条、待办、日历、设置），逐像素量正文 ≥ 7、次要字 ≥ 4.5（量法 e2e/contrast.ts）。
 * 透明度直接改 <html> 的 --isle-p / --isle-n（和设置里拖滑杆、@cn/design/glass 的 applyGlass 一样）；滑杆本身真拖在 jgely-glass.spec.ts。
 * 每页先量一次「实的」（去掉 data-glass，主题本身的实底）：主题实底时就不到线的地方（松绿当前标签名 6.9、设置左栏选中那项 5.4 这类），
 * 半透明时那处正文只要求不比实底差 0.3 以上；别的正文都要 ≥ 7，次要字一律 ≥ 4.5。
 * 很慢（二十次开软件、每次几十张），只在给了 CN_CONTRAST=1 时跑；CN_CONTRAST_LEVELS=0,50,100 换几档（找范围用；CN_CONTRAST_VARS='--isle-far:12%' 顺手改几个 <html> 上的变量试），CN_CONTRAST_OUT=目录 每次开软件存一个 json，
 * CN_CONTRAST_SKINS=sky,petrol 只量几套。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { GLASS_DEFAULT, GLASS_MAX, GLASS_MIN } from '../../../packages/design/src/glass'
import { ECP_DOC, LECTURES } from '../../../packages/format/test/base-samples'
import { acts, launch, leftView, openNote, pane, rail, type Running, tabOn } from './app'
import { measure } from './contrast'
import { ICELAND } from './fixtures/board'
import { DOCS } from './fixtures/ecp-views'

test.skip(process.env.CN_CONTRAST !== '1', '很慢，只在 CN_CONTRAST=1 时跑')

const SOLID = -99
const LEVELS = [SOLID, ...(process.env.CN_CONTRAST_LEVELS ? process.env.CN_CONTRAST_LEVELS.split(',').map(Number) : [GLASS_MIN, GLASS_DEFAULT, GLASS_MAX])]
const ALL = ['mint', 'sky', 'sakura', 'lilac', 'stone', 'pine', 'petrol', 'cocoa', 'ink', 'graphite']
const SKINS = process.env.CN_CONTRAST_SKINS ? process.env.CN_CONTRAST_SKINS.split(',') : ALL
const OUT = process.env.CN_CONTRAST_OUT
/** 窗口背景：默认两张自带照片；CN_CONTRAST_BGS=wall 量主题渐变（浓那档，面板默认就透 25%，最透时透得最多） */
const BGS = process.env.CN_CONTRAST_BGS ? process.env.CN_CONTRAST_BGS.split(',') : ['aurora', 'cave']

const pad = (n: number) => String(n).padStart(2, '0')
const D = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const FILES: Record<string, string | Uint8Array> = {
  '课程/ecp/ecp 课程计划.md': ECP_DOC,
  ...DOCS,
  ...LECTURES,
  '旅行/冰岛.md': ICELAND,
  '写作/小论文计划.md': `# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文 📅 ${D(0)}\n- [ ] 交论文初稿 📅 ${D(1)} 15:00 🔔 提前1小时 ⏫\n- [x] 和导师约时间\n\n## 下周\n\n先把第二章的实验图补上，再改摘要。引用的几篇放在**参考文献**那一节，格式统一成 APA。\n\n> 写作不是把想好的东西抄下来，是在写的时候想清楚。\n\n- 补实验图\n- 改摘要\n`,
  '收件箱/待办.md': `# 待办\n\n- [ ] 交 ecp 作业 2 📅 ${D(-1)} 23:59 🔔 准时 ⏫\n- [ ] 回导师邮件 📅 ${D(0)} 10:30\n- [ ] 取快递 📅 ${D(0)} 18:00 🔔 提前30分钟\n- [ ] 买打印纸\n`,
}

const BODY = 7
const SEC = 4.5

interface Row {
  skin: string
  bg: string
  level: number
  page: string
  where: string
  body: number | null
  sec: number | null
  bodyAt?: string
  secAt?: string
}

/** 透明度 v（SOLID 是「实的」：去掉 data-glass，看主题本身实底时这些字有多少，好分清是不是透出来造成的） */
async function level(page: Page, v: number) {
  await page.evaluate(([v, vars]) => {
    document.documentElement.toggleAttribute('data-glass', v !== -99)
    const st = document.documentElement.style
    if (v === 50 || v === -99) {
      st.removeProperty('--isle-p')
      st.removeProperty('--isle-n')
    } else {
      st.setProperty('--isle-p', String(v))
      st.setProperty('--isle-n', String(((v - 50) * 12) / 50))
    }
    for (const kv of (vars as string).split(';').filter(Boolean)) {
      const [k, x] = kv.split(':')
      st.setProperty(k!, x!)
    }
  }, [v, process.env.CN_CONTRAST_VARS ?? ''] as const)
  await page.waitForTimeout(200)
}

for (const skin of SKINS) {
  for (const bg of BGS) {
    test(`对比度：${skin} · ${bg}`, async () => {
      test.setTimeout(400_000)
      const run: Running = await launch(FILES, { CN_AI_FAKE: '1' }, (vault) => {
        const ud = join(dirname(vault), 'user-data')
        mkdirSync(ud, { recursive: true })
        writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: bg, wallMove: false, wallMix: 'rich' } }))
      })
      const { page } = run
      const rows: Row[] = []
      const each = async (name: string) => {
        await page.mouse.move(720, 880)
        for (const v of LEVELS) {
          await level(page, v)
          const m = await measure(run)
          for (const [where, r] of Object.entries(m.byWhere)) rows.push({ skin, bg, level: v, page: name, where, ...r })
        }
        await level(page, GLASS_DEFAULT)
      }
      try {
        await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
        await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
        await expect(page.locator('html')).toHaveAttribute('data-glass', '')

        await page.getByRole('button', { name: '首页', exact: true }).first().click()
        await page.waitForTimeout(600)
        await each('首页')

        await openNote(page, '小论文计划')
        await rail(page).getByRole('button', { name: /^大纲/ }).click()
        await page.waitForTimeout(400)
        await each('文档 + 大纲')
        await rail(page).getByRole('button', { name: /^大纲/ }).click()

        await openNote(page, '冰岛')
        await acts(page).getByRole('tab', { name: '白板' }).click()
        await expect(pane(page).locator('[data-testid="doc-board"], [data-testid="board"]').first()).toBeVisible()
        await each('白板')

        await openNote(page, 'ecp 课程计划')
        await pane(page).locator('[data-part="数据库块"]').getByRole('button', { name: '第3讲 生产', exact: true }).click()
        await expect(page.locator('.rpeek .rec-body .cm-content')).toContainText('短期只有劳动能变')
        await each('数据库 + 一条')

        await leftView(page, '最近')
        const bar = page.getByRole('navigation', { name: '左栏' })
        await bar.getByRole('button', { name: '待办', exact: true }).click()
        await expect(tabOn(page)).toHaveText('待办')
        await each('待办')
        await bar.getByRole('button', { name: '日历', exact: true }).click()
        // 那道红色的「现在」线跟着钟走：傍晚它正好横穿 18:00 那块待办的字，量出来 1.x（实底也一样），和面板透不透无关，量之前藏起来
        await page.addStyleTag({ content: '.cal-now { display: none !important }' })
        await page.waitForTimeout(500)
        await each('日历')

        await page.keyboard.press('Meta+Comma')
        const set = page.getByRole('dialog', { name: '设置' })
        await expect(set).toBeVisible()
        await set.getByRole('button', { name: '外观' }).first().click()
        await page.waitForTimeout(300)
        await each('设置 · 外观')
        await page.keyboard.press('Escape')
        // 量完先存（机器忙时退出偶尔超时，量好的不丢）
        if (OUT) {
          mkdirSync(OUT, { recursive: true })
          writeFileSync(join(OUT, `${skin}-${bg}.json`), JSON.stringify(rows, null, 1))
        }
      } finally {
        await run.close()
      }
      const solid = (r: Row) => rows.find((s) => s.level === SOLID && s.page === r.page && s.where === r.where)
      const under = (v: number | null, need: number, base: number | null | undefined) => v !== null && v < need && (base == null || base >= need || v < base - 0.3)
      // 次要字一律 ≥ 4.5（实底时 B 的次要字是原来的 --t2 / --t3，本来就比岛上的 --isle-t2 / --isle-t3 淡，不拿它比）
      const bad = rows.filter((r) => r.level !== SOLID && (under(r.body, BODY, solid(r)?.body) || (r.sec !== null && r.sec < SEC)))
      expect(bad.map((r) => `透明度 ${r.level} · ${r.page} · ${r.where}：正文 ${r.body} ${r.bodyAt ?? ''} 次要 ${r.sec} ${r.secAt ?? ''}（实底 ${solid(r)?.body} / ${solid(r)?.sec}）`)).toEqual([])
    })
  }
}
