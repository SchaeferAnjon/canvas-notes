import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, editorText, launch, openNote, pane, tabOn, waitSaved } from './app'
import { armMenus, clipboardText, enabledOf, menuLabels, openedMenu, pickMenu, setClipboard } from './menu'

// 右键菜单（DESIGN.v3 第 9 节）：系统原生菜单，测试把弹出换成「记下菜单」，读它的项、点其中一项，其余走真的代码

test('输入框：右键有撤销到全选；剪切、粘贴真的改了输入框和剪贴板', async () => {
  const run = await launch({ 'a.md': '# a\n\n正文\n' })
  const { page } = run
  try {
    await armMenus(run)
    await page.keyboard.press('Meta+j')
    const box = page.getByRole('textbox', { name: '问 AI' })
    await box.fill('整理一下这页')
    await box.selectText()
    await box.click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['撤销', '重做', '剪切', '拷贝', '粘贴', '全选'])
    expect(enabledOf(m, '剪切')).toBe(true)
    await pickMenu(run, '剪切')
    await expect(box).toHaveValue('')
    expect(await clipboardText(run)).toBe('整理一下这页')

    await box.click({ button: 'right' })
    expect(enabledOf(await openedMenu(run), '剪切')).toBe(false)
    await pickMenu(run, '粘贴')
    await expect(box).toHaveValue('整理一下这页')
  } finally {
    await run.close()
  }
})

test('输入框：拼错的词右键给拼写建议，点一个就换掉', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  try {
    await armMenus(run)
    await page.keyboard.press('Meta+j')
    const box = page.getByRole('textbox', { name: '问 AI' })
    await box.click()
    await page.keyboard.type('I recieve ')
    // 系统拼写检查在打完字后一会儿才标出来
    let labels: string[] = []
    await expect
      .poll(async () => {
        await box.click({ button: 'right', position: { x: 30, y: 10 } })
        const m = await openedMenu(run)
        labels = menuLabels(m)
        await run.app.evaluate(() => {
          const g = globalThis as unknown as { cnMenu: { cb?: () => void } | null }
          const cb = g.cnMenu?.cb
          g.cnMenu = null
          cb?.()
        })
        return labels.includes('receive')
      }, { timeout: 15_000 })
      .toBe(true)
    await box.click({ button: 'right', position: { x: 30, y: 10 } })
    await pickMenu(run, 'receive')
    await expect(box).toHaveValue('I receive ')
  } finally {
    await run.close()
  }
})

const DOC = '# 读书\n\n看 [[另一篇]] 和 [官网](https://example.com/x)\n\n第二段文字\n\n第三段 hello world\n'

test('文档：双链右键「在新标签打开」、段落「转成 › 待办」、选字「加粗」都真的改了', async () => {
  const run = await launch({ '读书.md': DOC, '另一篇.md': '# 另一篇\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '读书')
    const ed = pane(page).locator('.cm-content')

    await ed.locator('.cm-wikilink', { hasText: '另一篇' }).click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m).slice(0, 3)).toEqual(['打开', '在新标签打开', '拷贝双链'])
    await pickMenu(run, '在新标签打开')
    await expect(tabOn(page)).toHaveText('另一篇')
    await expect(page.getByRole('tab', { name: '读书' })).toHaveCount(1)

    await page.getByRole('tab', { name: '读书' }).getByRole('button').first().click()
    await expect(tabOn(page)).toHaveText('读书')
    await ed.locator('.cm-line', { hasText: '第二段文字' }).click({ button: 'right' })
    const m2 = await openedMenu(run)
    expect(menuLabels(m2)).toEqual(expect.arrayContaining(['撤销', '剪切', '拷贝', '粘贴', '全选', '转成', '问 AI 这一块', '翻译这一块', '复制为 Markdown']))
    expect(menuLabels(m2)).not.toContain('加粗')
    await pickMenu(run, '转成 › 待办')
    await expect.poll(() => editorText(page)).toContain('- [ ] 第二段文字')

    // 选中 hello，右键加粗
    const line = ed.locator('.cm-line', { hasText: '第三段' })
    await line.click()
    await page.keyboard.press('End')
    for (let i = 0; i < 11; i++) await page.keyboard.press('Shift+ArrowLeft')
    // 在选中的字上右键（和人一样）
    const r = await page.evaluate(() => {
      const b = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await page.mouse.click(r.x, r.y, { button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('加粗')
    await pickMenu(run, '加粗')
    // 存进文件里的就是改好的
    await expect.poll(() => readFileSync(join(vault, '读书.md'), 'utf8')).toContain('- [ ] 第二段文字\n\n第三段 **hello world**')
    await waitSaved(page)

    // 复制为 Markdown：没选字时拷的是点着的这一块（带记号）
    await setClipboard(run, '')
    await ed.locator('.cm-line', { hasText: '第二段' }).click()
    await ed.locator('.cm-line', { hasText: '第三段' }).click({ button: 'right' })
    await pickMenu(run, '复制为 Markdown')
    await expect.poll(() => clipboardText(run)).toContain('第三段 **hello world**')
  } finally {
    await run.close()
  }
})

test('文档：网址右键「拷贝链接」；段落「问 AI」把引文放进 AI 输入框；「翻译」在右键的地方弹出译文，能拷贝', async () => {
  const run = await launch({ '读书.md': DOC }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await armMenus(run)
    await openNote(page, '读书')
    const ed = pane(page).locator('.cm-content')
    await ed.locator('.cm-link', { hasText: '官网' }).click({ button: 'right' })
    expect(menuLabels(await openedMenu(run)).slice(0, 4)).toEqual(['打开链接', '在中间栏打开', '用默认浏览器打开', '拷贝链接'])
    await pickMenu(run, '拷贝链接')
    await expect.poll(() => clipboardText(run)).toBe('https://example.com/x')

    await ed.locator('.cm-line', { hasText: '第二段文字' }).click({ button: 'right' })
    await pickMenu(run, '问 AI 这一块')
    // 第 2b 段：这一块成为 AI 输入框顶上那一排的第一块引用（来源「《读书》」），字里是编号 ①
    await expect(page.getByRole('textbox', { name: '问 AI' })).toHaveValue('①')
    await expect(page.getByTestId('ai-mat').locator('.ct')).toHaveText('第二段文字')
    await expect(page.getByTestId('ai-mat').locator('.cs')).toHaveText('《读书》')
    await expect(page.getByRole('textbox', { name: '问 AI' })).toBeFocused()

    await ed.locator('.cm-line', { hasText: '第三段' }).click({ button: 'right' })
    await pickMenu(run, '翻译这一块')
    const tr = page.getByRole('dialog', { name: '译文' })
    await expect(tr).toBeVisible()
    await expect(tr.locator('.tr-pop-text')).not.toHaveText('正在翻译…', { timeout: 15_000 })
    const got = (await tr.locator('.tr-pop-text').textContent())!
    expect(got).toContain('hello world')
    await tr.getByRole('button', { name: '拷贝' }).click()
    await expect(tr).toBeHidden()
    await expect.poll(() => clipboardText(run)).toBe(got)
  } finally {
    await run.close()
  }
})

test('文档里的图：右键有拷贝图片、在访达中显示、拷贝图片地址；拷贝图片真的进了剪贴板', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQEAP2/D/E2JyQKAAAAAElFTkSuQmCC', 'base64')
  const run = await launch({ '图.md': '# 图\n\n![小图](附件/a.png)\n\n后面\n', '附件/a.png': png })
  const { page } = run
  try {
    await armMenus(run)
    await openNote(page, '图')
    const img = pane(page).locator('.cm-image img')
    await expect(img).toBeVisible()
    await img.click({ button: 'right' })
    expect(menuLabels(await openedMenu(run)).slice(0, 3)).toEqual(['拷贝图片', '在访达中显示', '拷贝图片地址'])
    await pickMenu(run, '拷贝图片')
    await expect.poll(() => run.app.evaluate(async ({ clipboard }) => (await clipboard.read()).flatMap((i) => i.types).some((t) => t.startsWith('image/')))).toBe(true)
    await img.click({ button: 'right' })
    await pickMenu(run, '拷贝图片地址')
    await expect.poll(() => clipboardText(run)).toBe('附件/a.png')
    await expect(acts(page)).toBeVisible()
  } finally {
    await run.close()
  }
})
