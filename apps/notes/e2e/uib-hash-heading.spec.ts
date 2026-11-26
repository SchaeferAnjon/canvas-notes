/**
 * ui-b A3（用户 0.5.13 图 14，朋友第一次试用时发现）：文档里打「#」还没按空格就变成大标题，「#」藏起来、光标那一行一级标题那么高，
 * 文末灰字「输入 / 插入块，或者直接写」挤在它下面叠着光标。根因：lezer 照 CommonMark 把只有「#」的一行认成空的一级标题，
 * 编辑器照语法树画标题、藏记号。改成「# + 空格」才变标题（##、### 同理，偏好「井号加空格才变标题」）；只打「#」和「#标签」照旧是字。
 * 全在测试模式里真打字（keyboard.type）、真按 ⌘Z、中文输入法走 CDP 的 imeSetComposition / insertText、粘贴发真的 paste 事件。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, type Running, waitSaved } from './app'

const NOTE = '收件箱/整理.md'
const TEXT = '# 整理\n\n## 软件问题\n\n- 第一条\n- 第二条\n'

/** 光标那一行：类名、看得见的字、框 */
const caretLine = (page: Page) =>
  page.evaluate(() => {
    const n = document.getSelection()?.focusNode
    const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
    const ln = el?.closest('.cm-line') as HTMLElement | null
    if (!ln) return null
    const r = ln.getBoundingClientRect()
    // 灰字不算这一行的字
    const text = [...ln.childNodes].filter((c) => !(c instanceof HTMLElement && c.matches('.cm-tailline, .cm-blockph'))).map((c) => c.textContent).join('')
    return { cls: ln.className, text, top: r.top, bottom: r.bottom }
  })

/** 屏上看得见的灰字（文末那一行、空块里的）和有字的行、光标那一行有没有叠在一起：叠着的那几对 */
const overlaps = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = []
    const phs = [...document.querySelectorAll<HTMLElement>('.pane:not([hidden]) .cm-tail-ph, .pane:not([hidden]) .cm-blockph')].filter((p) => p.offsetParent && getComputedStyle(p).visibility !== 'hidden')
    const n = document.getSelection()?.focusNode
    const caretEl = ((n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null)?.closest<HTMLElement>('.cm-line')
    // 光标那一行至少一行高：空标题塌成 0 高时，按标题字号画的光标伸到下面去叠着灰字（用户图 14 的样子）
    if (caretEl) {
      const lh = parseFloat(getComputedStyle(caretEl).lineHeight)
      const h = caretEl.getBoundingClientRect().height
      if (h < lh - 1) out.push(`光标那一行塌了：${Math.round(h)} 高，行高 ${Math.round(lh)}`)
    }
    for (const p of phs) {
      const a = p.getBoundingClientRect()
      for (const ln of document.querySelectorAll<HTMLElement>('.pane:not([hidden]) .cm-line')) {
        if (ln.contains(p)) {
          // 灰字画在这一行里：这一行除了灰字不能有字
          const own = [...ln.childNodes].filter((c) => !(c instanceof HTMLElement && c.contains(p))).map((c) => c.textContent).join('')
          if (own.trim()) out.push(`灰字和「${own}」在同一行`)
          continue
        }
        if (!ln.textContent?.trim() && ln !== caretEl) continue
        const b = ln.getBoundingClientRect()
        if (a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`灰字叠着「${ln.textContent}」${ln === caretEl ? '（光标那一行）' : ''}`)
      }
    }
    return out
  })

async function openTail(run: Running) {
  await openNote(run.page, '整理')
  await pane(run.page).locator('.cm-tailline').click()
  const c = await caretLine(run.page)
  expect(c?.text).toBe('')
}

test('A3 文末打「#」还是字，加空格才变一级标题；##、### 一样；灰字不和光标、字叠着；存盘是原样的 md', async () => {
  const run = await launch({ [NOTE]: TEXT })
  const { page, vault } = run
  try {
    await openTail(run)
    await page.keyboard.type('#')
    let c = (await caretLine(page))!
    expect(c.cls).not.toContain('cm-h')
    expect(c.text).toBe('#')
    expect(await overlaps(page)).toEqual([])
    // 加空格：变一级标题，「# 」藏起来，打的字是标题
    await page.keyboard.type(' ')
    c = (await caretLine(page))!
    expect(c.cls).toContain('cm-h1')
    expect(c.text).toBe('')
    expect(await overlaps(page)).toEqual([])
    await page.keyboard.type('新的一节')
    c = (await caretLine(page))!
    expect(c.cls).toContain('cm-h1')
    expect(c.text).toBe('新的一节')
    expect(await overlaps(page)).toEqual([])
    await waitSaved(page)
    expect(readFileSync(join(vault, NOTE), 'utf8')).toBe(TEXT + '\n# 新的一节\n')

    // ## 和 ### ：回车到下面新起一段再打
    for (const [mark, h] of [['##', 'cm-h2'], ['###', 'cm-h3']] as const) {
      await page.keyboard.press('Enter')
      await page.keyboard.type(mark)
      c = (await caretLine(page))!
      expect(c.cls, mark).not.toContain('cm-h')
      expect(c.text, mark).toBe(mark)
      expect(await overlaps(page), mark).toEqual([])
      await page.keyboard.type(' 小节')
      c = (await caretLine(page))!
      expect(c.cls, mark).toContain(h)
      expect(c.text, mark).toBe('小节')
    }
    await waitSaved(page)
    expect(readFileSync(join(vault, NOTE), 'utf8')).toBe(TEXT + '\n# 新的一节\n\n## 小节\n\n### 小节\n')

    // 「#标签」：普通的字，「#」露着
    await page.keyboard.press('Enter')
    await page.keyboard.type('#标签')
    c = (await caretLine(page))!
    expect(c.cls).not.toContain('cm-h')
    expect(c.text).toBe('#标签')
    expect(await overlaps(page)).toEqual([])

    // 空的一行引文（「> 」）也是只剩藏起来的记号：同样不能塌成 0 高、光标叠着灰字
    await page.keyboard.press('Enter')
    await page.keyboard.type('> ')
    c = (await caretLine(page))!
    expect(c.cls).toContain('cm-quote')
    expect(await overlaps(page)).toEqual([])
  } finally {
    await run.close()
  }
})

test('A3 中文输入法：「#」从输入法上屏还是字，空格以后拼音上屏的字是标题；撤回一步步回去不剩标题样子', async () => {
  const run = await launch({ [NOTE]: TEXT })
  const { page, vault } = run
  try {
    await openTail(run)
    const cdp = await page.context().newCDPSession(page)
    // 输入法里先是「#」组字，再上屏
    await cdp.send('Input.imeSetComposition', { text: '#', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '#' })
    let c = (await caretLine(page))!
    expect(c.cls).not.toContain('cm-h')
    expect(c.text).toBe('#')
    expect(await overlaps(page)).toEqual([])
    await page.keyboard.type(' ')
    c = (await caretLine(page))!
    expect(c.cls).toContain('cm-h1')
    // 拼音组字中：标题照样是标题
    await cdp.send('Input.imeSetComposition', { text: 'biao ti', selectionStart: 7, selectionEnd: 7 })
    c = (await caretLine(page))!
    expect(c.cls).toContain('cm-h1')
    await cdp.send('Input.insertText', { text: '标题' })
    c = (await caretLine(page))!
    expect(c.cls).toContain('cm-h1')
    expect(c.text).toBe('标题')
    expect(await overlaps(page)).toEqual([])
    await waitSaved(page)
    expect(readFileSync(join(vault, NOTE), 'utf8')).toBe(TEXT + '\n# 标题\n')

    // 撤回：每一步都不能是「#」藏着的空标题，灰字不叠字
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Meta+z')
      await page.waitForTimeout(150)
      const t = await editorText(page)
      seen.push(t.slice(TEXT.length))
      const lines = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.pane:not([hidden]) .cm-line.cm-h')].map((l) => l.textContent ?? ''),
      )
      // 文里的两个标题之外，只要还有「# 」开头的一行，就该画成标题；只剩「#」的不画
      const shouldBe = t.split('\n').filter((l) => /^#{1,6}[ \t]/.test(l)).length
      expect(lines.length, `撤回第 ${i + 1} 下：${JSON.stringify(t)}`).toBe(shouldBe)
      expect(await overlaps(page), `撤回第 ${i + 1} 下`).toEqual([])
      if (t === TEXT) break
    }
    expect(await editorText(page), `撤回走过：${JSON.stringify(seen)}`).toBe(TEXT)
    await waitSaved(page)
    expect(readFileSync(join(vault, NOTE), 'utf8')).toBe(TEXT)
  } finally {
    await run.close()
  }
})

test('A3 粘贴：「# 标题」是标题，只有「#」是字', async () => {
  const run = await launch({ [NOTE]: TEXT })
  const { page, vault } = run
  const paste = (text: string) =>
    page.evaluate((text) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, text)
  try {
    await openTail(run)
    await paste('#')
    let c = (await caretLine(page))!
    expect(c.cls).not.toContain('cm-h')
    expect(c.text).toBe('#')
    expect(await overlaps(page)).toEqual([])
    await page.keyboard.press('Backspace')
    await paste('# 粘来的标题')
    c = (await caretLine(page))!
    expect(c.cls).toContain('cm-h1')
    expect(c.text).toBe('粘来的标题')
    expect(await overlaps(page)).toEqual([])
    await waitSaved(page)
    expect(readFileSync(join(vault, NOTE), 'utf8')).toBe(TEXT + '\n# 粘来的标题\n')
  } finally {
    await run.close()
  }
})
