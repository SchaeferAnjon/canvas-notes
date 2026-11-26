/**
 * r172 A6、A7：命令行没装、装了运行不了时不再只回一句「没答出来 / 中途退出了」，设置 › AI「各家命令行」能一键安装、修复、更新。
 * - A7：claude 装坏了（--version 都跑不起来）又没有别的 AI：右栏上手卡说「运行不了」、那一条是「修复Claude Code」；
 *   claude 用着用着坏了：那一问的回答处是「Claude Code装了但运行不了」引导卡，点「修复」重装、修好接着发刚才那句；
 *   claude -p 没吐字就退出、auth status 说没登录：认成没登录，出登录卡（不是「中途退出了」）。
 * - A6：没装的「安装」、运行不了的「修复」、有新版的「更新」：装的命令照官方（Claude Code、Codex、OpenCode 的安装脚本，Gemini CLI 要 Node.js），
 *   装的时候说明那一行写进度，没装上一句人话 +「看原话」（输出最后几十行）。
 * 不真装：CN_CLI_INSTALL_RECORDER 指向这里写的记录器（记下 家、install|repair、本来要跑的命令，照测试给的片段「装好」或「装不上」）。
 * 假命令行 packages/ai-engines/test/fixtures/fake-cli.mjs 放在临时家目录，只在家目录里找，不碰这台 Mac 上真的命令行。
 */
import { expect, test, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openNote } from './app'

const FAKE = join(__dirname, '../../../packages/ai-engines/test/fixtures/fake-cli.mjs')
const files = { '随手记.md': '# 随手记\n\n一段字。\n' }
const ANSWER = /^这是假 Claude Code 2\.1\.330 的回答/
const BROKEN = 'echo "dyld[1]: Library not loaded: /opt/homebrew/opt/node/lib/libnode.dylib" >&2\nexit 134'

function script(p: string, body: string) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

/** 临时家目录：bins 里每一家 'fake'（假命令行，状态在 fake-state/<家>.json）或一段 sh；记录器和它的片段在 rec/ */
function home(bins: Record<string, string>, states: Record<string, object> = {}) {
  const h = mkdtempSync(join(tmpdir(), 'cn-e2e-home-'))
  const state = join(h, 'fake-state')
  const rec = join(h, 'rec')
  mkdirSync(state)
  mkdirSync(rec)
  const fakeBody = (name: string) => `exec "${process.execPath}" "${FAKE}" ${name} "$@"`
  const bin = (name: string) => join(h, name === 'opencode' ? '.opencode/bin' : '.local/bin', name)
  for (const [name, body] of Object.entries(bins)) script(bin(name), body === 'fake' ? fakeBody(name) : body)
  for (const [name, st] of Object.entries(states)) writeFileSync(join(state, `${name}.json`), JSON.stringify(st))
  // 记录器：记一行「家 \t 装法 \t 命令」，再跑测试给这一家的片段（装好：写一个能用的假命令行；装不上：报错退出）
  script(join(rec, 'install'), `printf '%s\\t%s\\t%s\\n' "$1" "$2" "$3" >> "${rec}/calls.log"\necho "Downloading $1…"\nif [ -f "${rec}/$1.sh" ]; then . "${rec}/$1.sh"; fi\nexit 0`)
  /** 这一家「装好」：命令行换成假的（能跑） */
  const fixes = (name: string) => writeFileSync(join(rec, `${name}.sh`), `mkdir -p "${dirname(bin(name))}"\nprintf '#!/bin/sh\\n${fakeBody(name).replace(/"/g, '\\"')}\\n' > "${bin(name)}"\nchmod 755 "${bin(name)}"\necho "Installed ${name}"\n`)
  /** 这一家「装不上」 */
  const fails = (name: string, said: string, code = 6) => writeFileSync(join(rec, `${name}.sh`), `echo "${said}" >&2\nexit ${code}\n`)
  const calls = () => {
    try {
      return readFileSync(join(rec, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
    } catch {
      return []
    }
  }
  const env = { HOME: h, ZDOTDIR: h, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', CN_REAL_FIND: '1', CN_CLI_HOME_ONLY: '1', FAKE_CLI_STATE: state, CN_CLI_INSTALL_RECORDER: join(rec, 'install'), CN_LOCAL_BASE_OLLAMA: 'http://127.0.0.1:9', CN_LOCAL_BASE_LMSTUDIO: 'http://127.0.0.1:9' }
  return { h, bin, env, fixes, fails, calls, setBody: (name: string, body: string) => script(bin(name), body), done: () => rmSync(h, { recursive: true, force: true }) }
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const cli = (page: Page, id: string) => dialog(page).getByRole('group', { name: '各家命令行' }).locator(`[data-row="cli${id.charAt(0).toUpperCase()}${id.slice(1)}"]`)
const claudeInfo = (page: Page) => page.evaluate(async () => (await window.cn.aiEngines()).engines.find((e) => e.id === 'claude')!)

async function ask(page: Page, q: string) {
  await openNote(page, '随手记')
  await page.keyboard.press('Meta+j')
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(q)
  await box.press('Enter')
}

async function openAiSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
  await expect(dialog(page).getByTestId('ai-default')).toBeVisible()
}

test('A7：claude 装坏了、又没有别的 AI：右栏上手卡说运行不了，「修复Claude Code」照官方装法重装，问话接着发、有回答', async () => {
  const f = home({ claude: BROKEN }, { claude: { loggedIn: true } })
  const run = await launch(files, f.env)
  const { page } = run
  try {
    await expect.poll(async () => (await claudeInfo(page)).broken ?? '', { timeout: 15_000 }).toContain('退出码 134')
    await ask(page, '讲讲这一段')
    const card = chat(page).getByTestId('ai-setup')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByTestId('setup-lead')).toHaveText('这台Mac上的Claude Code运行不了，也没找到Codex、Gemini或OpenCode。修好它，或者选别的一种接上。')
    // 没有去问坏掉的 claude（不再是「中途退出了」）
    await expect(chat(page).getByTestId('ai-error')).toHaveCount(0)
    await expect(card.getByTestId('setup-cc')).toContainText('修复Claude Code')
    await card.getByTestId('setup-cc').click()
    f.fixes('claude')
    await card.getByTestId('setup-cc-install').click()
    await expect(card.getByTestId('setup-cc-login')).toBeEnabled({ timeout: 15_000 })
    expect(f.calls()).toEqual([['claude', 'repair', 'curl -fsSL https://claude.ai/install.sh | bash']])
    await card.getByTestId('setup-cc-login').click()
    await chat(page).getByTestId('setup-start').click()
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText(ANSWER, { timeout: 15_000 })
    await expect(chat(page).locator('.um')).toHaveText(['讲讲这一段'])
  } finally {
    await run.close()
    f.done()
  }
})

test('A7：claude 用着用着坏了：那一问的回答处是「装了但运行不了」引导卡（不是「中途退出了」），点「修复」修好接着发', async () => {
  test.setTimeout(120_000)
  const f = home({ claude: 'fake' }, { claude: { loggedIn: true } })
  const run = await launch(files, f.env)
  const { page } = run
  try {
    await expect.poll(async () => (await claudeInfo(page)).path ?? '', { timeout: 15_000 }).toBe(f.bin('claude'))
    // 右栏 AI 开着、用着时 claude 坏了（升级到一半、Node 被删）：先开好 AI 再弄坏它。
    // 命令行文件换了（修改时间变了）以后，软件下一次列各家时在后台重跑 --version；开 AI 那一下就会列一次。先弄坏再开，后台那次常常抢在问之前
    // 认出坏了，就成了「开之前就坏了」那种（出三选一上手卡，见上一条），不是这一条要测的（以前这样写，8 次挂 3 次）
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await expect(box).toBeVisible()
    await page.waitForTimeout(500)
    f.setBody('claude', BROKEN)
    await box.fill('讲讲这一段')
    await box.press('Enter')
    const card = chat(page).getByTestId('ai-login')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toHaveAttribute('data-mode', 'repair')
    await expect(card.locator('h3')).toHaveText('Claude Code装了但运行不了')
    await expect(chat(page)).not.toContainText('中途退出了')
    // 软件随后也认出它运行不了（没有能用的 AI 了）：不再在下面叠一张三选一卡
    await expect.poll(async () => (await claudeInfo(page)).broken ?? '', { timeout: 15_000 }).toContain('退出码 134')
    await page.waitForTimeout(500)
    await expect(chat(page).getByTestId('ai-setup')).toHaveCount(0)
    await expect(card.getByTestId('login-install')).toHaveText('修复')
    f.fixes('claude')
    await card.getByTestId('login-install').click()
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText(ANSWER, { timeout: 15_000 })
    await expect(chat(page).locator('.um')).toHaveText(['讲讲这一段'])
    expect(f.calls()).toEqual([['claude', 'repair', 'curl -fsSL https://claude.ai/install.sh | bash']])
  } finally {
    await run.close()
    f.done()
  }
})

test('A7：claude -p 什么都没吐就退出、auth status 说没登录：认成没登录、出登录卡', async () => {
  // --version 正常、-p 没输出退出 0、auth status 回没登录的 JSON（老版本没登录时就是这样）
  const silent = `case "$1" in --version) echo "2.1.330 (Claude Code)";; auth) echo '{"loggedIn": false, "authMethod": "none"}'; exit 1;; *) cat > /dev/null; exit 0;; esac`
  const f = home({ claude: silent })
  const run = await launch(files, f.env)
  const { page } = run
  try {
    await ask(page, '你好')
    const card = chat(page).getByTestId('ai-login')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toHaveAttribute('data-mode', 'login')
    await expect(chat(page)).not.toContainText('中途退出了')
  } finally {
    await run.close()
    f.done()
  }
})

test('A6：设置 › AI 各家命令行：没装的「安装」、运行不了的「修复」，照官方命令装在家目录；装的时候写进度；没装上一句人话 +「看原话」', async () => {
  test.setTimeout(150_000)
  // claude、opencode、gemini 没装；codex 装坏了；临时家目录里没有 npm、brew
  const f = home({ codex: BROKEN })
  // 盯着命令行（版本、自查）：装好以后那一行读出版本，和发布包一样
  const run = await launch(files, { ...f.env, CN_ENGINE_WATCH: '1' })
  const { page } = run
  try {
    await openAiSettings(page)
    await expect(cli(page, 'codex')).toContainText('找到了，运行不了', { timeout: 15_000 })
    // 按钮：没装的「安装」、运行不了的「修复」；不再有「怎么装」
    await expect(cli(page, 'claude').getByRole('button')).toHaveText(['安装'])
    await expect(cli(page, 'codex').getByRole('button')).toHaveText(['修复'])
    await expect(cli(page, 'gemini').getByRole('button')).toHaveText(['安装'])
    await expect(cli(page, 'opencode').getByRole('button')).toHaveText(['安装'])
    await expect(dialog(page).getByRole('button', { name: '怎么装' })).toHaveCount(0)

    // 安装 Claude Code：记录器慢一点，看得到进度那一行
    f.fixes('claude')
    writeFileSync(join(f.env.HOME, 'rec', 'claude.sh'), `echo "Verifying checksum…"\nsleep 1\n` + readFileSync(join(f.env.HOME, 'rec', 'claude.sh'), 'utf8'))
    await cli(page, 'claude').getByTestId('cli-install-claude').click()
    // 转圈的那颗「安装中」：不灰掉（字看得清），点不了；说明那一行是命令行的输出（等宽）
    await expect(cli(page, 'claude').getByTestId('cli-busy-claude')).toHaveText('安装中')
    await expect(cli(page, 'claude').getByTestId('cli-busy-claude')).toHaveAttribute('aria-busy', 'true')
    await expect(cli(page, 'claude').getByTestId('cli-desc-claude').locator('code')).toContainText(/Verifying checksum…|Downloading claude…|curl -fsSL https:\/\/claude\.ai\/install\.sh/)
    // 装好以后重新找一遍、读版本、自查（四家一起，机器忙时要一会儿）
    await expect(cli(page, 'claude').getByTestId('cli-desc-claude')).toContainText('2.1.330', { timeout: 45_000 })
    await expect(cli(page, 'claude').getByRole('button')).toHaveText(['检查更新'])
    await expect(page.getByText('Claude Code装好了')).toBeVisible()

    // 修复 Codex：照官方安装脚本重装，修好了写版本
    f.fixes('codex')
    await cli(page, 'codex').getByTestId('cli-repair-codex').click()
    await expect(cli(page, 'codex').getByTestId('cli-desc-codex')).toContainText('0.163.0', { timeout: 45_000 })
    await expect(page.getByText('Codex修好了')).toBeVisible()

    // OpenCode 装不上（连不上下载的地方）：一句人话 +「看原话」展开输出、能拷贝
    f.fails('opencode', 'curl: (6) Could not resolve host: opencode.ai')
    await cli(page, 'opencode').getByTestId('cli-install-opencode').click()
    await expect(cli(page, 'opencode').getByTestId('cli-desc-opencode')).toContainText('没装上：连不上下载的地方，看看网络再试一次', { timeout: 15_000 })
    await expect(cli(page, 'opencode').getByRole('button', { name: '安装' })).toBeEnabled()
    await expect(cli(page, 'opencode').getByTestId('cli-log-opencode')).toHaveText('看原话')
    await cli(page, 'opencode').getByTestId('cli-log-opencode').click()
    await expect(cli(page, 'opencode').getByTestId('cli-log-opencode')).toHaveText('收起原话')
    await expect(cli(page, 'opencode').locator('.aipk-cli-log')).toContainText('curl: (6) Could not resolve host: opencode.ai')
    await expect(cli(page, 'opencode').locator('.aipk-cli-log')).toContainText('$ curl -fsSL https://opencode.ai/install | bash')

    // Gemini CLI：家里没有 npm、brew，说先装 Node.js（不跑任何命令）
    await cli(page, 'gemini').getByTestId('cli-install-gemini').click()
    await expect(cli(page, 'gemini').getByTestId('cli-desc-gemini')).toContainText('没装上：Gemini CLI要先有Node.js：到 nodejs.org 装好Node.js，再点「安装」', { timeout: 15_000 })

    // 记录器收到的：每家官方的命令，都不带 sudo
    expect(f.calls()).toEqual([
      ['claude', 'install', 'curl -fsSL https://claude.ai/install.sh | bash'],
      ['codex', 'repair', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'],
      ['opencode', 'install', 'curl -fsSL https://opencode.ai/install | bash'],
    ])
  } finally {
    await run.close()
    f.done()
  }
})

test('A6：Gemini CLI 家里有 npm：装到 ~/.local（npm install -g --prefix ~/.local），不碰要 sudo 的全局目录', async () => {
  const f = home({ npm: 'echo npm' })
  const run = await launch(files, f.env)
  const { page } = run
  try {
    await openAiSettings(page)
    await cli(page, 'gemini').getByTestId('cli-install-gemini').click()
    // 记录器没把 gemini 装上：装完还是没找到
    await expect(cli(page, 'gemini').getByTestId('cli-desc-gemini')).toContainText('没装上：装完还是没找到gemini', { timeout: 15_000 })
    expect(f.calls()).toEqual([['gemini', 'install', 'npm install -g --prefix ~/.local @google/gemini-cli@latest']])
  } finally {
    await run.close()
    f.done()
  }
})

test('A6：有新版时按钮是「更新」，点了跑它官方的更新，跑完写「更新好了」', async () => {
  const f = home({ codex: 'fake' }, { codex: { update: { to: '0.164.0' } } })
  const server: Server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if ((req.url ?? '').includes('@openai/codex')) return res.end(JSON.stringify({ version: '0.164.0' }))
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const run = await launch(files, { ...f.env, CN_ENGINE_WATCH: '1', CN_NPM_REGISTRY: `http://127.0.0.1:${port}` })
  const { page } = run
  try {
    await openAiSettings(page)
    await expect(cli(page, 'codex')).toContainText('有新版 0.164.0', { timeout: 20_000 })
    const btn = cli(page, 'codex').getByRole('button', { name: '更新到 0.164.0' })
    await expect(btn).toHaveText('更新')
    await btn.click()
    await expect(page.getByText('Codex更新好了：0.163.0 → 0.164.0')).toBeVisible({ timeout: 20_000 })
    await expect(cli(page, 'codex')).toContainText('0.164.0')
  } finally {
    await run.close()
    server.close()
    f.done()
  }
})

// ---------------------------------------------------------------- 交付对照图（CN_SHOTS=<目录>，CN_SHOT_STAGE=before|after）
for (const skin of ['mint', 'graphite']) {
  test(`对照图：${skin} 的各家命令行（安装 / 修复 / 正在装 / 没装上 + 看原话）和右栏「装了但运行不了」卡（CN_SHOTS）`, async () => {
    const dir = process.env.CN_SHOTS
    test.skip(!dir, '只在截交付图时跑（CN_SHOTS=目录）')
    const stage = process.env.CN_SHOT_STAGE ?? 'after'
    const f = home({ codex: BROKEN, gemini: BROKEN, claude: 'fake' }, { claude: { loggedIn: true } })
    const look = (vault: string) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    }
    const run = await launch(files, { ...f.env, CN_ENGINE_WATCH: '1' }, look)
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 820))
      await openAiSettings(page)
      const group = dialog(page).getByRole('group', { name: '各家命令行' })
      await expect(cli(page, 'codex')).toContainText('找到了，运行不了', { timeout: 15_000 })
      await page.mouse.move(0, 0)
      await page.waitForTimeout(400)
      await group.screenshot({ path: join(dir!, `${stage}-cli-${skin}.png`) })
      if (stage !== 'after') return
      // 正在修 Codex（记录器慢 3 秒）、OpenCode 没装上并展开详情
      writeFileSync(join(f.env.HOME, 'rec', 'codex.sh'), 'echo "Downloading codex 0.172.0 for aarch64-apple-darwin…"\nsleep 3\nexit 1\n')
      f.fails('opencode', 'curl: (6) Could not resolve host: opencode.ai')
      await cli(page, 'opencode').getByTestId('cli-install-opencode').click()
      await expect(cli(page, 'opencode').getByTestId('cli-log-opencode')).toBeVisible({ timeout: 15_000 })
      await cli(page, 'opencode').getByTestId('cli-log-opencode').click()
      await cli(page, 'codex').getByTestId('cli-repair-codex').click()
      await expect(cli(page, 'codex').getByTestId('cli-desc-codex')).toContainText('Downloading codex', { timeout: 10_000 })
      await page.waitForTimeout(300)
      await group.screenshot({ path: join(dir!, `after-cli-busy-${skin}.png`) })
      await page.keyboard.press('Escape')
      // 右栏：claude 用着用着坏了
      f.setBody('claude', BROKEN)
      await ask(page, '讲讲这一段')
      // 软件先认出它运行不了就是上手卡的「修复Claude Code」，先问到了就是那一问的「装了但运行不了」卡：两种都截
      await expect(chat(page).locator('[data-testid="ai-login"][data-mode="repair"]').or(chat(page).getByTestId('ai-setup'))).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(400)
      await chat(page).screenshot({ path: join(dir!, `after-repair-card-${skin}.png`) })
    } finally {
      await run.close()
      f.done()
    }
  })
}
