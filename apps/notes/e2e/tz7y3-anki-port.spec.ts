// 送 Anki 时端口被别的程序占着（task-tz7y3，2026-11-22 用户截图「Anki 的回答读不懂」：`python3 -m http.server 8765` 占着 8765，对 POST 回 501 的 HTML）：
// 照用户那台机器的样子真起一个 python3 -m http.server（端口让系统挑，不碰真的 8765），CN_ANKI_URL 指过去；
// 出卡弹窗点「送进Anki」→ 底下说「…端口被别的程序占着（程序名，进程号…），不是AnkiConnect。关掉它，重启Anki再送。」，选好的卡都还在；
// 关掉它、Anki（假的 AnkiConnect）在同一个端口起来，直接再点「送」就送进去。
// 截对照图：CN_SHOTS=<目录> [CN_SHOT_TONE=dark] npx playwright test e2e/tz7y3-anki-port.spec.ts（浮岛书桌，浅色天青 / 深色深湖）
import { expect, test, type Page } from '@playwright/test'
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, rail, type Running, tabOn } from './app'
import { ankiVault, fakeAnki } from './fixtures/anki'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const dlg = (page: Page) => page.getByRole('dialog', { name: '出卡' })
const squares = (page: Page) => dlg(page).getByRole('group', { name: '每一张' }).getByRole('button')
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })

/** 浮岛书桌，浅色天青 / 深色深湖（只在截图时换） */
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
async function shot(run: Running, name: string) {
  if (!DIR) return
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}

/** 真起一个 python3 -m http.server（和用户机器上占着 8765 的同一个东西），端口让系统挑 */
async function httpServer(dir: string): Promise<{ proc: ChildProcess; port: number }> {
  const proc = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1', '--directory', dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  const port = await new Promise<number>((resolve, reject) => {
    let out = ''
    const t = setTimeout(() => reject(new Error(`python3 -m http.server 10 秒没起来：${out}`)), 10_000)
    proc.stdout!.on('data', (d) => {
      out += d
      const m = /port (\d+)/.exec(out)
      if (m) clearTimeout(t), resolve(Number(m[1]))
    })
    proc.on('exit', (c) => (clearTimeout(t), reject(new Error(`python3 -m http.server 退出了（${c}）：${out}`))))
  })
  return { proc, port }
}

test('端口被 python3 -m http.server 占着：送的时候说是哪个程序占着、选好的卡留着；关掉它、Anki 起来后直接再点「送」就送进去', async () => {
  test.setTimeout(120_000)
  const www = mkdtempSync(join(tmpdir(), 'cn-port-'))
  const { proc, port } = await httpServer(www)
  let anki: Awaited<ReturnType<typeof fakeAnki>> | null = null
  const run = await launch(ankiVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: `http://127.0.0.1:${port}`, CN_FAKE_CARD_MS: '40' }, DIR ? look : undefined)
  const { page, app } = run
  try {
    if (DIR) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('Lecture05')
    await page.locator('.pal-row', { hasText: 'Lecture05.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText('Lecture05.pdf')
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await notes(page).getByRole('tab', { name: '只看我问的' }).click()
    await notes(page).getByRole('button', { name: '出卡 · 6问' }).click()
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了/, { timeout: 20_000 })

    // 第 1 张不送、第 2 张改问题：送不成以后这些都还在
    await page.keyboard.press(' ')
    await page.keyboard.press('e')
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('LIF 发完 spike 为什么减门槛、不清零？')
    await page.keyboard.press('Enter')
    await expect(dlg(page).locator('.df .cnt')).toHaveText('要送5张 · 不送1张')
    const send = dlg(page).getByRole('button', { name: '送进Anki · 5张' })
    await send.click()

    // 底下一行：不说「读不懂」，说端口被谁占着
    const err = dlg(page).locator('.warnrow.err')
    await expect(err).toBeVisible({ timeout: 10_000 })
    const text = (await err.textContent())!
    expect(text).not.toContain('读不懂')
    const m = new RegExp(`^${port}端口被别的程序占着（(.+)，进程号(\\d+)），不是AnkiConnect。关掉它，重启Anki再送。$`).exec(text)
    expect(m, text).not.toBeNull()
    // 写出来的进程号就是那个 python3 -m http.server
    const pid = Number(m![2])
    expect(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })).toContain('http.server')
    expect(m![1]!.toLowerCase()).toContain('python')
    // 选好的卡都还在：第 1 张不送、第 2 张是改过的问题，「送」照样能点；没弹 Anki 没开的那一行
    await expect(dlg(page).locator('.df .cnt')).toHaveText('要送5张 · 不送1张')
    await expect(squares(page).first()).toHaveClass(/\bskip\b/)
    await expect(send).toBeEnabled()
    await expect(dlg(page).getByTestId('anki-off')).toHaveCount(0)
    await squares(page).nth(1).click()
    await expect(dlg(page).locator('.paper .pq')).toHaveText('LIF 发完 spike 为什么减门槛、不清零？')
    await shot(run, 'port-busy')

    // 关掉它（只杀自己起的那个），Anki 在同一个端口起来：直接再点「送」
    proc.kill()
    if (pid !== proc.pid) process.kill(pid)
    await new Promise((r) => proc.once('exit', r))
    anki = await fakeAnki({ port })
    await send.click()
    await expect(page.getByTestId('toast')).toContainText('已送进Anki · 5张')
    await expect(dlg(page)).toHaveCount(0)
    expect(anki.notes).toHaveLength(5)
    expect(anki.notes.map((n) => n.fields.Question)).toContain('LIF 发完 spike 为什么减门槛、不清零？')
  } finally {
    await run.close()
    if (proc.exitCode === null && !proc.killed) proc.kill()
    await anki?.close()
    rmSync(www, { recursive: true, force: true })
  }
})

test('「怎么装」多一行：8765端口被占时怎么办，「复制命令」拷的是查端口的那条命令', async () => {
  // Anki 没开（连上就断）：「Anki没开着」那一行点「怎么装」
  const anki = await fakeAnki({ down: true })
  const run = await launch(ankiVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '20' }, DIR ? look : undefined)
  const { page, app } = run
  try {
    if (DIR) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('Lecture05')
    await page.locator('.pal-row', { hasText: 'Lecture05.pdf' }).first().click()
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await notes(page).getByRole('tab', { name: '只看我问的' }).click()
    await notes(page).getByRole('button', { name: '出卡 · 6问' }).click()
    await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了/, { timeout: 20_000 })
    await dlg(page).getByRole('button', { name: '送进Anki · 6张' }).click()
    await dlg(page).getByTestId('anki-off').getByRole('button', { name: '怎么装' }).click()
    const row = dlg(page).getByTestId('howto-port')
    await expect(row.locator('b')).toHaveText('8765端口被占时')
    await expect(row.locator('span')).toHaveText('复制命令贴进终端，看是哪个程序占着；关掉它，再重启Anki')
    // 和上面三行的字对齐（左边留着点的位置）
    const lefts = await dlg(page).locator('.howto .hrow b').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().left)))
    expect(new Set(lefts).size).toBe(1)
    // 拷的字记下来，不碰这台 Mac 真的剪贴板
    await page.evaluate(() => {
      const w = window as unknown as { copied: string[] }
      w.copied = []
      navigator.clipboard.writeText = async (s: string) => void w.copied.push(s)
    })
    await row.getByRole('button', { name: '复制命令' }).click()
    await expect(row.getByRole('button', { name: '拷好了' })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual(['lsof -nP -iTCP:8765 -sTCP:LISTEN'])
    await shot(run, 'howto-port')
  } finally {
    await run.close()
    await anki.close()
  }
})
