// 英文版第三批（AI 和读）的中英对照图（task-zojmg）：同一份样本库，中文那一遍是中文库，英文那一遍是英文库（分类文件夹英文名、记着库语言），
// 浅色天青、深色深湖，假 AI（CN_AI_FAKE）。只在给了 CN_SHOTS（放图的文件夹）时跑；CN_SHOT_TONE=dark 截深色。窗口 1440 × 887，浮岛书桌。
// 每一步都真点：AI 对话空着（输入框、全能模式那一行）、打 / 的命令菜单、「复制一份再改」开的存成命令那张表、问一句的回答、
// 回答里选一句出的小框（问这句）、就地展开的旁支、读 PDF 的笔记栏（全部 / 只看我问的）、出卡弹窗。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, type Running } from './app'
import { ankiVault, fakeAnki } from './fixtures/anki'
import { cat, enVault, L } from './zojmg-lib'

const DIR = process.env.CN_SHOTS ?? ''
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR, '只在 CN_SHOTS 给了时截图')

type Lang = 'zh' | 'en'

const DOC_BODY = '# Lecture 5 Attention\n\nHow one word "looks at" the other words in a sentence.\n\n## Queries and keys\n\nEach token asks a question and every other token answers.\n'
const ASK = 'Why does attention use softmax?'
const REPLY = 'Softmax turns the raw scores into weights that add up to one. Each word then mixes the other words in proportion to those weights, so the strongest matches count the most.'

/** 样本库：内容是英文（对照的是界面），分类文件夹照这一遍的库语言；读 PDF 那几份用出卡测试的样本（课程/ecp/Lecture05.pdf 和它的笔记） */
function lib(lang: Lang): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = { ...ankiVault(), '课程/Machine Learning/Lecture 5 Attention.md': DOC_BODY }
  return lang === 'en' ? enVault(files) : files
}

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

/** 对照页上标框的几块（有就记） */
const MARKS: Record<string, string> = {
  chat: '[role=complementary][aria-label="AI 对话"], [role=complementary][aria-label="AI chat"]',
  input: '[data-testid="ai-input"]',
  omni: '[data-testid="ai-omni"]',
  sees: '.sees',
  head: '.aih',
  slash: '[data-testid="slash-menu"]',
  savecmd: '.scmd',
  askbox: '.askbox',
  side: '.side-inl',
  notes: '.reading-notes',
  nfil: '.nfil',
  cards: '.cardsdlg',
  toast: '[data-testid="toast"]',
  // 设计复审改的几处
  slashph: '[data-testid="slash-menu"] .ph',
  slashfirst: '[data-testid="slash-menu"] .it[data-sl]',
  writeto: '.sc-frow:has(#sc-l-write)',
  imphead: '.sc-imp .ih',
  tree: '.sc-tree',
  commit: '[data-fact="commit"]',
  sidehead: '.side-inl .sd-head',
  round: '[data-testid="note-round"] .r',
  hint: '.reading-notes .cards-hint',
}

async function shot(page: Page, name: string, lang: Lang) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(DIR, `${name}-${lang}-${TONE}.png`) })
  const m = await page.evaluate(measure)
  const marks: Record<string, number[]> = {}
  for (const [k, sel] of Object.entries(MARKS)) {
    const loc = page.locator(sel).first()
    const r = (await loc.count()) ? await loc.boundingBox({ timeout: 500 }).catch(() => null) : null
    if (r && r.width && r.height) marks[k] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v))
  }
  writeFileSync(join(DIR, `${name}-${lang}-${TONE}.json`), JSON.stringify({ ...m, marks }, null, 1))
}

/** 量：被截掉的、按钮和标签折了行的、还露着的中文（用户的字也在里面，人工分） */
function measure() {
  const HAN = /\p{Script=Han}/u
  const out: { cut: { text: string; why: string; box: number[] }[]; wrap: { text: string; box: number[] }[]; han: string[] } = { cut: [], wrap: [], han: [] }
  const vis = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  const box = (r: DOMRect) => [r.x, r.y, r.width, r.height].map((v) => Math.round(v))
  const han = new Set<string>()
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const r = el.getBoundingClientRect()
    if (!vis(r)) continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').replace(/\s+/g, ' ').trim()
    const cs = getComputedStyle(el)
    if (own && HAN.test(own) && cs.visibility !== 'hidden') han.add(own.slice(0, 60))
    const ph = (el as HTMLInputElement).placeholder
    if (ph && HAN.test(ph)) han.add('[提示字] ' + ph)
    if (!own && !ph) continue
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && cs.visibility !== 'hidden')
      out.cut.push({ text: (own || ph).slice(0, 80), why: cs.textOverflow === 'ellipsis' ? '省略号' : '裁掉', box: box(r) })
    const clickable = /^(BUTTON|A|LABEL)$/.test(el.tagName) || ['tab', 'menuitem', 'radio', 'option'].includes(el.getAttribute('role') ?? '')
    if (clickable && cs.whiteSpace !== 'nowrap') {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
      const tops = new Set<number>()
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !(n.textContent ?? '').trim()) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const x of range.getClientRects()) tops.add(Math.round(x.top))
      }
      if (tops.size > 1 && r.height > lh * 1.6) out.wrap.push({ text: own.slice(0, 80), box: box(r) })
    }
  }
  out.han = [...han]
  return out
}

/** ⌘K 打名字、回车开第一个 */
async function open(page: Page, lang: Lang, title: string, tab = title) {
  await page.keyboard.press('Meta+k')
  const pal = page.getByRole('dialog', { name: L(lang, '搜索和命令', 'Search and commands') })
  await expect(pal).toBeVisible()
  await pal.getByRole('textbox').first().fill(title)
  await expect(pal.getByRole('option').first()).toContainText(title)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tab-on')).toHaveText(tab)
}

/** 在 scope 里用鼠标从 from 拖到 to（真拖） */
async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(a!)
        const j = n.data.indexOf(b!, i)
        if (i < 0 || j < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, j + b!.length)
        const rs = r.getClientRects()
        const f = rs[0]!
        const l = rs[rs.length - 1]!
        return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
      }
      throw new Error('没找到那一句')
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

async function walk(lang: Lang) {
  const dir = mkdtempSync(join(tmpdir(), 'cn-zojmg3-'))
  // 假 AI 的一轮：问那句，回那一段（这一篇整篇换成原样，正文不变）
  writeFileSync(join(dir, 'same.md'), DOC_BODY)
  const docPath = `${cat(lang, '课程')}/Machine Learning/Lecture 5 Attention.md`
  writeFileSync(join(dir, 'rounds.json'), JSON.stringify([{ say: ASK, path: docPath, file: join(dir, 'same.md'), reply: REPLY }]))
  const anki = await fakeAnki({})
  const run: Running = await launch(lib(lang), { CN_AI_FAKE: '1', CN_LANG: lang, CN_FAKE_ROUNDS: join(dir, 'rounds.json'), CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '60' }, look)
  const { page, app } = run
  // AI 那一格的名字在 AiPanel.tsx（别的分支正改着，还没抽），英文界面照旧叫「AI 对话」
  const chat = page.getByRole('complementary', { name: /^(AI 对话|AI chat)$/ })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await page.waitForTimeout(800)

    // 1 AI 对话空着：头、看得到、输入框提示字、全能模式那一行
    await open(page, lang, 'Lecture 5 Attention')
    await openAi(page)
    const ta = chat.getByRole('textbox', { name: L(lang, '问 AI', 'Ask AI') })
    await expect(ta).toBeVisible()
    await shot(page, 'ai-empty', lang)

    // 2 打 / 的命令菜单
    await ta.fill('/')
    await expect(page.getByTestId('slash-menu')).toBeVisible()
    await shot(page, 'ai-slash', lang)

    // 3 一条自带命令的小菜单「复制一份再改…」开存成命令那张表
    const first = page.getByTestId('slash-menu').locator('.it[data-sl]').first()
    await first.hover()
    await first.locator('.more').click()
    await page.getByRole('menuitem', { name: L(lang, '复制一份再改…', 'Copy and edit…') }).click()
    await expect(page.locator('.scmd')).toBeVisible()
    await shot(page, 'save-cmd', lang)
    await page.keyboard.press('Escape')
    await expect(page.locator('.scmd')).toHaveCount(0)
    await ta.fill('')

    // 4 问一句：回答
    await ta.fill(ASK)
    await ta.press('Enter')
    const msg = chat.getByTestId('ai-msg').last()
    await expect(msg).toContainText('Softmax turns', { timeout: 60_000 })
    await expect(chat.getByRole('button', { name: L(lang, '停下', 'Stop') })).toHaveCount(0, { timeout: 60_000 })
    // 回答下面那一排（task-83vl3，合进 dev 后补的英文）
    await expect(msg.getByTestId('ai-ans-acts').getByRole('button')).toHaveText([L(lang, '拷贝', 'Copy'), L(lang, '插进文档', 'Insert into doc'), ''])
    await shot(page, 'ai-answer', lang)

    // 5 回答里选一句：小框「问这句」
    await selectText(page, msg.locator('.txt'), 'Each word', 'the most.')
    const askbox = page.getByRole('dialog', { name: L(lang, '选中的这句', 'Selected sentence') })
    await expect(askbox).toBeVisible()
    await shot(page, 'askbox', lang)

    // 6 问这句（空着回车开旁支自己打），旁支里再空着回车问默认那一句：就地展开的旁支（假 AI 答完）
    await askbox.getByRole('textbox', { name: L(lang, '问这句', 'Ask about this') }).press('Enter')
    const side = chat.getByRole('region', { name: L(lang, '旁支', 'Side thread') })
    await expect(side).toBeVisible()
    // 空着回车：问的是旁支默认那一句
    await side.getByRole('textbox', { name: L(lang, '问 AI', 'Ask AI') }).press('Enter')
    await expect(side.getByTestId('side-msg').last()).not.toContainText(L(lang, '在答…', 'Answering…'), { timeout: 60_000 })
    // 答完才拍：回答下面出「放进主对话」那一排（第一次拍的中文图停在还在答的时候，和英文图对不上）
    await expect(side.getByRole('group', { name: L(lang, '这条回答', 'This answer') })).toBeVisible({ timeout: 60_000 })
    await shot(page, 'side', lang)
    await side.getByRole('button', { name: L(lang, '收起旁支', 'Close side thread') }).first().click()

    // 7 读 PDF 的笔记栏：全部、只看我问的
    await open(page, lang, 'Lecture05', 'Lecture05.pdf')
    const notes = page.getByRole('complementary', { name: L(lang, '笔记', 'Notes'), exact: true })
    // 右边竖条的名字、笔记那一格的悬停名字在 App.tsx（别的分支正改着）：中英都认
    const railNav = page.getByRole('navigation', { name: /^(右栏|Right sidebar)$/ })
    if (!(await notes.isVisible())) await railNav.getByRole('button', { name: /^(笔记|Notes)/ }).first().click()
    await expect(notes).toBeVisible()
    await shot(page, 'notes', lang)
    await notes.getByRole('tab', { name: L(lang, '只看我问的', 'Mine') }).click()
    await shot(page, 'notes-mine', lang)

    // 8 出卡：AI（假的）改好每一问，一张张过
    await notes.getByTestId('cards-open').click()
    const dlg = page.getByRole('dialog', { name: L(lang, '出卡', 'Make cards') })
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('.dh .sub')).toHaveText(lang === 'en' ? /ready/ : /^改好了/, { timeout: 60_000 })
    await shot(page, 'cards', lang)
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
    await anki.close()
  }
}

test('第三批画面：中文', async () => {
  test.setTimeout(600_000)
  mkdirSync(DIR, { recursive: true })
  await walk('zh')
})

test('第三批画面：英文', async () => {
  test.setTimeout(600_000)
  mkdirSync(DIR, { recursive: true })
  await walk('en')
})
