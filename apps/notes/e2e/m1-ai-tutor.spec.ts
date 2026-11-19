// CN-89（M1 录屏 0:57）讲透：读 PDF 问 AI 时起的 claude 不再整个换掉系统提示。
// 不用假引擎，用一个假的 claude 命令行（test/fixtures/fake-claude.mjs，放在临时家目录的 ~/.local/bin）：
// 软件真的去找它、真的起它，它把收到的参数记下来（像 ps 看子进程），再把参数说回来当回答。
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, tabOn, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })

test('CN-89：AI 回答里的公式用 KaTeX 排好（行内的、单独成行的），字里不露 $；单独成行的居中、比正文大一点、放不下自己横着滚不撑宽右栏；天青、深湖两套主题字色都跟着主题', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  // 本机记着的这份 PDF 的对话（换主题要重新载入界面，等整段回答存好再换）
  const saved = () => {
    const dir = join(run.userData, 'reading')
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.sessions.json'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('')
  }
  try {
    for (const skin of ['mint', 'sky', 'petrol'] as const) {
      // 先在默认主题下问（问完存在本机），再换天青、深湖各看一遍
      if (skin !== 'mint') {
        await expect.poll(saved, { timeout: 10_000 }).toContain('（不是清零），见 [第 4 页](#page=4)。')
        await page.evaluate((s) => window.cn.setSettings({ appearance: { followSystem: false, skin: s } }), skin)
        await page.reload()
        await page.locator('.vault b').waitFor()
      }
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
      await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
      await expect(tabOn(page)).toHaveText('第3讲.pdf')
      await openAi(page)
      if (skin === 'mint') {
        const box = ai(page).getByRole('textbox', { name: '问 AI' })
        await box.fill('这几个公式讲一下')
        await box.press('Enter')
        await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
      }
      const msg = ai(page).getByTestId('reading-msg').last()
      await expect(msg.locator('.mblock')).toHaveCount(2, { timeout: 15_000 })
      await expect(msg.locator('.mi')).toHaveCount(7)
      expect(await msg.locator('.txt').innerText()).not.toContain('$')
      await expect(msg.locator('.pg')).toHaveText('第 4 页')
      const m = await msg.evaluate((el) => {
        const px = (e: Element | null) => parseFloat(getComputedStyle(e!).fontSize)
        const p = el.querySelector('.md-list li')!
        const block = el.querySelector<HTMLElement>('.mblock')!
        const panel = el.closest('aside')!
        return {
          font: document.fonts.check('16px KaTeX_Main'),
          inline: px(p.querySelector('.mi .katex')) / px(p),
          block: px(block.querySelector('.katex')),
          body: px(el.querySelector('.md-p')),
          centered: getComputedStyle(block.querySelector('.katex-display')!).textAlign,
          fits: block.scrollWidth <= block.clientWidth + 1 || getComputedStyle(block).overflowX === 'auto',
          panelFits: panel.scrollWidth <= panel.clientWidth + 1,
          color: getComputedStyle(block.querySelector('.katex')!).color === getComputedStyle(el.querySelector('.md-p')!).color,
          // 「门槛$V_{th}$就发」没打空格：两边各留 1/8 字宽；打了空格的不留
          tight: [...el.querySelectorAll('.mi.gl.gr')].map((e) => [getComputedStyle(e).marginLeft, getComputedStyle(e).marginRight].join(' ')),
          spaced: getComputedStyle(p.querySelector('.mi')!).marginLeft,
        }
      })
      if (process.env.CN_SHOTS) console.log(`量到（${skin}）`, JSON.stringify(m))
      expect(m.font).toBe(true)
      expect(m.inline).toBeCloseTo(1.05, 2)
      expect(m.block).toBeGreaterThan(m.body)
      expect(m.centered).toBe('center')
      expect(m.fits).toBe(true)
      expect(m.panelFits).toBe(true)
      expect(m.color).toBe(true)
      expect(m.tight).toEqual(['1.625px 1.625px'])
      expect(m.spaced).toBe('0px')
      if (process.env.CN_SHOTS) {
        // 交付对照图：默认 340 宽截一张；再把右栏拉到和小样一样的 564 宽截一张（对照用）
        await ai(page).screenshot({ path: join(process.env.CN_SHOTS, `app-公式-${skin}.png`) })
        const w = (await ai(page).boundingBox())!.width
        await widenRight(page, 564 - w)
        await page.waitForTimeout(300)
        await ai(page).screenshot({ path: join(process.env.CN_SHOTS, `app-公式-${skin}-564.png`) })
      }
    }
  } finally {
    await run.close()
  }
})

function script(p: string, body: string) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

test('CN-89：读 PDF 问一句，起的 claude 带 --append-system-prompt（读 PDF 那几条）、读用户设置 user、关掉 hooks、--effort high；讲法改过的旧会话不再接着聊；AI 浮窗动手那条照旧整个换掉系统提示', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cn-e2e-home-'))
  const argvFile = join(home, 'claude-argv.jsonl')
  script(join(home, '.local/bin/claude'), `exec "${process.execPath}" "${join(__dirname, '../test/fixtures/fake-claude.mjs')}" "$@"`)
  // 这台 Mac 上真装着的 codex、gemini、opencode 不让它找到（不起真的）：同名的坏命令行排在前面
  for (const c of ['codex', 'gemini', 'opencode']) script(join(home, '.local/bin', c), 'exit 1')
  // 登录 shell 只给临时家目录和系统目录
  script(join(home, 'shell'), 'PATH="$HOME/.local/bin:/usr/bin:/bin"; export PATH\nexec /bin/sh -c "$2"')
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n', [PDF]: LECTURE }, { HOME: home, ZDOTDIR: home, SHELL: join(home, 'shell'), PATH: '/usr/bin:/bin', FAKE_CLAUDE_ARGV: argvFile })
  const { page, vault } = run
  const calls = () => readFileSync(argvFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
  const at = (args: string[], f: string) => args[args.indexOf(f) + 1]
  try {
    // 这份 PDF 有一个旧讲法时开的会话（没有版本号）：接着聊会沿用旧的系统提示，所以不该再接着聊
    for (const root of new Set([vault, realpathSync(vault)])) {
      const key = createHash('sha1').update(root + '\0' + PDF).digest('hex').slice(0, 16)
      mkdirSync(join(run.userData, 'reading'), { recursive: true })
      writeFileSync(join(run.userData, 'reading', `${key}.sessions.json`), JSON.stringify({ sessions: { claude: 'old-tutor' }, fullIn: { claude: 'old-tutor' } }))
    }
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('这一页讲的是什么')
    await box.press('Enter')
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.txt')).toContainText('附加系统提示 你在 Canvas Notes 里陪一个人读 PDF 课件。', { timeout: 20_000 })
    await expect(msg.locator('.read')).toContainText('Claude Code · Opus 5.5 · High')

    const tutor = calls().filter((a) => a.includes('--append-system-prompt'))
    expect(tutor).toHaveLength(1)
    const t = tutor[0]!
    expect(at(t, '--append-system-prompt')).toMatch(/^你在 Canvas Notes 里陪一个人读 PDF 课件。[\s\S]*公式用 LaTeX：行内写 \$…\$，\$ 里面紧贴公式、开头结尾都不留空格[\s\S]*单独一行的写 \$\$…\$\$。/)
    expect(t).not.toContain('--system-prompt')
    expect(at(t, '--setting-sources')).toBe('user')
    expect(JSON.parse(at(t, '--settings')!)).toEqual({ disableAllHooks: true })
    expect(t).toContain('--strict-mcp-config')
    expect(at(t, '--effort')).toBe('high')
    expect(at(t, '--model')).toBe('claude-opus-5-5')
    expect(at(t, '--tools')).toBe('')
    // 旧讲法的会话没接着聊（开了新的，全文和最近几轮补在话里）
    expect(t).not.toContain('--resume')
    expect(t).not.toContain('old-tutor')

    // 再问一句：接着刚开的新会话聊
    await box.fill('再讲细一点')
    await box.press('Enter')
    await expect(ai(page).getByTestId('reading-msg')).toHaveCount(2)
    await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).toContainText('接着聊 c-new', { timeout: 20_000 })
    const again = calls().filter((a) => a.includes('--append-system-prompt'))
    expect(again).toHaveLength(2)
    expect(at(again[1]!, '--resume')).toBe('c-new')

    // 别处的 AI 对话动手那条照旧（同一格，AI 开着就还开着）：系统提示整个换掉、一个设置都不读、给我们的工具；effort 也是 High
    await openNote(page, '随手记')
    await openAi(page)
    const float = page.getByRole('complementary', { name: 'AI 对话' })
    await float.getByRole('textbox', { name: '问 AI' }).fill('你好')
    await float.getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(float.getByTestId('ai-msg').last().locator('.txt')).toContainText('设置 不读', { timeout: 20_000 })
    const agent = calls().find((a) => a.includes('--mcp-config'))!
    expect(at(agent, '--system-prompt')).toMatch(/^你是 Canvas Notes 笔记软件里的助手/)
    expect(agent).toContain('--setting-sources=')
    expect(agent).not.toContain('--append-system-prompt')
    expect(at(agent, '--effort')).toBe('high')
  } finally {
    await run.close()
    rmSync(home, { recursive: true, force: true })
  }
})
