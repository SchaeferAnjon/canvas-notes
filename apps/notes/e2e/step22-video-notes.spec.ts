// 看视频记笔记（录屏 CN-69 / 70 / 74 / 80 / 81）：时刻块照视频方向 A 的稿子（截图 170×96、没字幕时一句提示）；
// 中间没开文档时记一刻自动新建一篇；「未命名」里第一次记这个视频就改名成视频名；没字幕的视频菜单里「生成字幕」。
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube），AI 是假的（CN_AI_FAKE）。
import { expect, test, type Page } from '@playwright/test'
import type { Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus as gitStatusOf, launch, leftView, openNote, pane, rail, tabOn } from './app'
import { FAKE_NO_SUBS_ID, FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { shotTone, shotWindow } from './shots'

let server: Server
let base: string

test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const env = (more: Record<string, string> = {}) => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: base, ...more })

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function openVideo(page: Page, id = FAKE_VIDEO_ID) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${id}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
}

async function seek(page: Page, sec: number) {
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = ${sec}; v.pause(); return true })()`)
  await expect.poll(async () => Math.round(Number(await guest(page, 'document.querySelector("video").currentTime')))).toBe(sec)
}


/** 时刻块的几处尺寸：截图多大、块的右边框在不在正文里面、正文有没有横向滚动 */
async function momentBox(page: Page) {
  const block = pane(page).locator('.cm-vmoment[data-part="时刻块"]').last()
  await expect(block).toBeVisible()
  return block.evaluate((b) => {
    const shot = b.querySelector('.shot')!.getBoundingClientRect()
    const content = b.closest('.cm-content')!.getBoundingClientRect()
    const scroller = b.closest('.cm-scroller')!
    const r = b.getBoundingClientRect()
    return { w: Math.round(shot.width), h: Math.round(shot.height), inside: r.right <= content.right + 0.5, hscroll: scroller.scrollWidth > scroller.clientWidth + 1 }
  })
}

/** 这个视频站记进这一篇（同「记到这篇」：剪藏去处规则 2026-11-25 起记下这一刻照这个网站的去处，中间开着的那篇不算） */
const pickNote = (page: Page, path: string) => page.evaluate(([o, p]) => localStorage.setItem('cn.webTarget', JSON.stringify({ [o!]: p })), [base, path])
/** 视频条「记到」里明确选「新建一篇」（用视频标题新建、在中间打开；剪藏去处规则以后要明确选才这样） */
async function pickNew(page: Page) {
  await strip(page).getByRole('button', { name: /^记到 / }).click()
  await web(page).getByRole('menu', { name: '记到哪' }).getByRole('menuitemradio', { name: /新建一篇/ }).click()
}

test('CN-74 时刻块照稿子：截图 170×96；有字幕时原文、译文、「› 前后 4 行」；没字幕时一句「这一秒没有字幕。生成字幕后自动补上原文和译文。」；块不出正文', async () => {
  const run = await launch({ '第3讲 笔记.md': '# 第3讲 笔记\n\n线性 = 直线变完还是直线。\n' }, env())
  const { page } = run
  try {
    await shotTone(page)
    await pickNote(page, '第3讲 笔记.md')
    await openNote(page, '第3讲 笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    // 有字幕的视频
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    await seek(page, 7)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('· 00:07')
    // 光标挪开，块画成卡片
    await pane(page).getByText('线性 = 直线变完还是直线。').click()
    const withSubs = pane(page).locator('.cm-vmoment[data-part="时刻块"]').last()
    await expect(withSubs.locator('.o')).toHaveText('Watch where i-hat lands.')
    await expect(withSubs.locator('.t')).toHaveText('译文：Watch where i-hat lands.')
    await expect(withSubs.locator('.more')).toHaveText('› 前后4行')
    expect(await momentBox(page)).toEqual({ w: 170, h: 96, inside: true, hscroll: false })

    // 没字幕的视频：块里那一句，「生成字幕」是能点的字
    await pane(page).getByText('线性 = 直线变完还是直线。').click()
    await page.keyboard.press('Meta+End')
    await openVideo(page, FAKE_NO_SUBS_ID)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('没有字幕', { timeout: 15_000 })
    await seek(page, 3)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('· 00:03')
    await pane(page).getByText('线性 = 直线变完还是直线。').click()
    const none = pane(page).locator('.cm-vmoment[data-part="时刻块"]').last()
    await expect(none.locator('.none')).toHaveText('这一秒没有字幕。生成字幕后自动补上原文和译文。')
    await expect(none.locator('.none').getByRole('button', { name: '生成字幕' })).toBeVisible()
    expect(await momentBox(page)).toEqual({ w: 170, h: 96, inside: true, hscroll: false })
    await shotWindow(run, 'cn74-moment')
  } finally {
    await run.close()
  }
})

const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const commits = (vault: string) => execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
const webview = (page: Page) => web(page).locator('webview.on')
const focusedTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? '')
const TITLE = 'Linear transformations and matrices'

test('CN-70 中间开着 HTML 时按 ⌥S：新建《视频标题》在中间打开，插视频卡和这一刻；再按进同一篇；焦点一直在视频上', async () => {
  const run = await launch({ '课程/ecp/加速器为何又快又省.html': '<!doctype html><title>加速器</title><h1>加速器为何又快又省</h1>' }, env())
  const { page, vault } = run
  try {
    await shotTone(page)
    await leftView(page, '文件')
    await page.getByRole('tree', { name: '全部文件' }).getByRole('button', { name: '展开 ecp' }).click()
    await page.getByRole('tree', { name: '全部文件' }).getByRole('treeitem').filter({ hasText: /^加速器为何又快又省/ }).click()
    await expect(tabOn(page)).toHaveText('加速器为何又快又省')
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    // 剪藏去处规则：没另选时记进收件箱里这个视频那篇、不打开；要新建一篇在中间打开得在「记到」里明确选
    await expect(strip(page).getByRole('button', { name: /^记到 / })).toHaveAttribute('aria-label', `记到 ${TITLE}`)
    await pickNew(page)
    await expect(strip(page).getByRole('button', { name: /^记到 / })).toHaveAttribute('aria-label', `记到 新建《${TITLE}》`)
    await seek(page, 7)
    // 焦点在视频网页里按 ⌥S（和人一样）
    await webview(page).focus()
    await page.keyboard.press('Alt+KeyS')
    await expect(page.locator('.vtoast')).toContainText(`新建了《${TITLE}》，记了00:07`)
    await expect(tabOn(page)).toHaveText(TITLE)
    // 开新标签不抢键盘：焦点还在视频上
    // （测试窗口不显示，网页拿不到真焦点，按前是 body；按后也不能落进编辑器）
    await page.waitForTimeout(300)
    expect(['webview', 'body']).toContain(await focusedTag(page))
    const path = `收件箱/${TITLE}.md`
    await expect.poll(() => commits(vault)).toContain(`视频：记下 00:07《${TITLE}》→ ${TITLE}`)
    const md = read(vault, path)
    expect(md.startsWith(`---\n视频: ${base}/watch?v=${FAKE_VIDEO_ID}\n---\n\n# ${TITLE}\n\n<!-- video video=youtube:${FAKE_VIDEO_ID} -->`)).toBe(true)
    expect(md).toContain(`<!-- moment video=youtube:${FAKE_VIDEO_ID} t=7`)
    // 视频条「记到」还是明确选的「新建一篇」（这个视频记住），再按进的就是这一篇
    await expect(strip(page).getByRole('button', { name: /^记到 / })).toHaveAttribute('aria-label', `记到 新建《${TITLE}》`)
    await shotWindow(run, 'cn70-new-doc')
    // 再按一次：进同一篇，不再新建
    await seek(page, 13)
    await webview(page).focus()
    await page.keyboard.press('Alt+KeyS')
    await expect(page.locator('.vtoast')).toContainText(`记进了《${TITLE}》 · 00:13`)
    await expect.poll(() => (read(vault, path).match(/<!-- moment /g) ?? []).length).toBe(2)
    expect(existsSync(join(vault, `收件箱/${TITLE} 2.md`))).toBe(false)
    expect(['webview', 'body']).toContain(await focusedTag(page))
  } finally {
    await run.close()
  }
})

test('CN-70 撤回刚新建的那一篇：文件没了', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    await pickNew(page)
    await seek(page, 4)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText(`新建了《${TITLE}》`)
    expect(existsSync(join(vault, `收件箱/${TITLE}.md`))).toBe(true)
    await page.locator('.vtoast').getByRole('button', { name: '撤回' }).click()
    await expect(page.locator('.vtoast')).toContainText('撤回了')
    await expect.poll(() => existsSync(join(vault, `收件箱/${TITLE}.md`))).toBe(false)
  } finally {
    await run.close()
  }
})

test('CN-80 在「未命名 3」里第一次记这个视频：这篇改名成视频名、加属性「视频: <网址>」；起过名字的不动；明确选「收件箱」只往那篇追加', async () => {
  const run = await launch({ '未命名 3.md': '# 未命名 3\n\n先记一句。\n', '第3讲 笔记.md': '# 第3讲 笔记\n\n线性。\n' }, env())
  const { page, vault } = run
  try {
    await shotTone(page)
    await pickNote(page, '未命名 3.md')
    await openNote(page, '未命名 3')
    await pane(page).getByText('先记一句。').click()
    await page.keyboard.press('Meta+End')
    await openVideo(page)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('英→中', { timeout: 15_000 })
    await seek(page, 7)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText(`记进了《${TITLE}》 · 00:07`)
    await expect(tabOn(page)).toHaveText(TITLE)
    await expect.poll(() => existsSync(join(vault, '未命名 3.md'))).toBe(false)
    await expect.poll(() => gitStatusOf(vault)).toBe('')
    const md = read(vault, `${TITLE}.md`)
    expect(md.startsWith(`---\n视频: ${base}/watch?v=${FAKE_VIDEO_ID}\n---\n# ${TITLE}\n\n先记一句。`)).toBe(true)
    expect(md).toContain(`<!-- moment video=youtube:${FAKE_VIDEO_ID} t=7`)
    await shotWindow(run, 'cn80-renamed')

    // 起过名字的：不改名、不加属性
    await pickNote(page, '第3讲 笔记.md')
    await openNote(page, '第3讲 笔记')
    await pane(page).getByText('线性。').click()
    await seek(page, 10)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('记进了《第3讲 笔记》 · 00:10')
    await expect.poll(() => read(vault, '第3讲 笔记.md')).toContain('<!-- moment ')
    expect(read(vault, '第3讲 笔记.md').startsWith('# 第3讲 笔记\n')).toBe(true)

    // 「记到」里明确选收件箱：只往「收件箱/<视频标题>.md」追加，不打开
    await strip(page).getByRole('button', { name: /^记到 / }).click()
    // 「记到哪（这个视频记住）」四样里的「收件箱」（task-sta8n），悬停看得到完整路径
    const inboxItem = web(page).getByRole('menu', { name: '记到哪' }).getByRole('menuitemradio', { name: '收件箱', exact: true })
    await expect(inboxItem).toHaveAttribute('title', `收件箱/${TITLE}.md`)
    await inboxItem.click()
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText(`记进了《${TITLE}》`)
    await expect.poll(() => existsSync(join(vault, `收件箱/${TITLE}.md`))).toBe(true)
    await expect(tabOn(page)).toHaveText('第3讲 笔记')
  } finally {
    await run.close()
  }
})
