/**
 * 设置 › 对外接口（task-av5t8，MCP 第一批）：无头真点设置页，再照写进配置的那一段真拉起小程序 canvas-notes-mcp（stdio，官方 SDK 的客户端）调 6 个工具。
 * 家目录用临时的（HOME、CN_CLI_HOME_ONLY），一键装写进的是临时家目录里的 ~/.claude.json、~/.codex/config.toml，不碰这台 Mac 真的配置。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, type Page, test } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Running } from './app'

const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const nav = (page: Page) => dlg(page).getByRole('navigation', { name: '设置分页' })
const row = (page: Page, id: string) => dlg(page).locator(`[data-row="${id}"]`)
const toast = (page: Page) => dlg(page).getByTestId('settings-toast')
const sw = (page: Page) => row(page, 'mcpOn').getByRole('switch', { name: '让别的AI连进来' })

const MOC = '---\n类型: MOC\n---\n# 旅行 MOC\n\n## 城市攻略\n\n### 法国\n\n- 巴黎\n\n### 德国\n\n- 柏林\n- 慕尼黑\n\n## 相关 MOC\n\n- [[学习MOC]]\n'
const FILES = {
  '旅行/36-Travel-MOC.md': MOC,
  '旅行/海德堡.md': '# 海德堡\n\n学生监狱在老城，秋天去最好。\n\n- [ ] 订海德堡的车票 📅 2099-01-01\n- [ ] 交 EML 作业 📅 2020-01-01\n',
  '课程/欧洲史.md': '# 欧洲史\n\n## 第一讲\n\n海德堡大学建于 1386 年。\n',
}

let home = ''
test.beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cn-mcp-home-'))
  // 临时家目录里放假的 claude、codex 命令：设置页认它们「装着」
  mkdirSync(join(home, '.local/bin'), { recursive: true })
  for (const c of ['claude', 'codex']) {
    writeFileSync(join(home, '.local/bin', c), '#!/bin/sh\necho 1.0.0\n')
    chmodSync(join(home, '.local/bin', c), 0o755)
  }
})
test.afterEach(() => rmSync(home, { recursive: true, force: true }))

const env = () => ({ HOME: home, CN_CLI_HOME_ONLY: '1', CLAUDE_CONFIG_DIR: '', CODEX_HOME: '' })

async function openPage(page: Page) {
  await page.keyboard.press('Meta+Comma')
  await nav(page).getByRole('button', { name: '对外接口', exact: true }).click()
  await expect(dlg(page).getByRole('heading', { name: '对外接口' })).toBeVisible()
}

type Entry = { command: string; args: string[]; env: Record<string, string> }
const claudeEntry = (): Entry => JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers['canvas-notes']

/** 照配置里那一段拉起小程序，连上 */
async function connect(e: Entry, extra: Record<string, string> = {}): Promise<Client> {
  const t = new StdioClientTransport({ command: e.command, args: e.args, env: { PATH: process.env.PATH ?? '', HOME: home, ...e.env, ...extra }, stderr: 'pipe' })
  const c = new Client({ name: 'e2e', version: '0' })
  await c.connect(t)
  return c
}

type Called = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> }
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as Called

const caretLine = (page: Page) =>
  page.evaluate(() => {
    const n = document.getSelection()?.focusNode
    const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
    return el?.closest('.cm-line')?.textContent ?? ''
  })

test('总开关默认关；打开后有 socket；Claude Code、Codex 一键装写进临时家目录的配置；照配置真调 6 个工具；调用记录出现；断开、关上以后被拒', async () => {
  test.setTimeout(120_000)
  const run: Running = await launch(FILES, env())
  const { page } = run
  try {
    await openPage(page)
    const sock = join(run.userData, 'mcp.sock')
    const sockPath = Buffer.byteLength(sock) < 100 ? sock : null
    // 默认关：开关关着、装上灰着、没有 socket 文件
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false')
    await expect(row(page, 'mcp-claude-code').getByRole('button', { name: '装上' })).toBeDisabled()
    await expect(dlg(page).locator('.mcp-set .sa-note').first()).toContainText('先打开上面的开关')
    if (sockPath) expect(existsSync(sockPath)).toBe(false)

    await sw(page).click()
    await expect(sw(page)).toHaveAttribute('aria-checked', 'true')
    await expect(toast(page)).toContainText('别的AI能连进来了')
    if (sockPath) {
      await expect.poll(() => existsSync(sockPath)).toBe(true)
      expect(statSync(sockPath).mode & 0o777).toBe(0o600)
    }
    expect(JSON.parse(readFileSync(join(run.userData, 'mcp.json'), 'utf8')).on).toBe(true)

    // Claude Code：装上 → 临时家目录的 ~/.claude.json
    const cc = row(page, 'mcp-claude-code')
    await expect(cc).toContainText('点「装上」写进')
    await cc.getByRole('button', { name: '装上' }).click()
    await expect(toast(page)).toContainText('装上了')
    await expect(cc).toContainText('已装上 · 还没用过')
    await expect(cc.getByRole('combobox', { name: 'Claude Code能做到哪' })).toHaveValue('read')
    await expect(cc.getByRole('combobox', { name: 'Claude Code能做到哪' }).locator('option[value="write"]')).toBeDisabled()
    const entry = claudeEntry()
    expect(entry.env.CN_MCP_KEY).toMatch(/^[\w-]{43}$/)
    expect(entry.env.CN_USER_DATA).toBe(run.userData)
    expect(entry.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(entry.args[0]).toMatch(/out\/main\/mcp-stdio\.js$/)
    expect(statSync(join(home, '.claude.json')).mode & 0o777).toBe(0o600)

    // Codex：装上 → ~/.codex/config.toml
    await row(page, 'mcp-codex').getByRole('button', { name: '装上' }).click()
    await expect(row(page, 'mcp-codex')).toContainText('已装上')
    const toml = readFileSync(join(home, '.codex/config.toml'), 'utf8')
    expect(toml).toContain('[mcp_servers.canvas-notes]')
    expect(toml).not.toContain(entry.env.CN_MCP_KEY) // 每家一把钥匙

    // 照配置拉起小程序：列出 6 个工具，一个个调
    const c = await connect(entry)
    try {
      expect(c.getServerVersion()?.name).toBe('canvas-notes')
      const { tools } = await c.listTools()
      expect(tools.map((t) => t.name)).toEqual(['search_notes', 'read_note', 'list_recent', 'list_tasks', 'list_vaults', 'open_note'])

      const s = await call(c, 'search_notes', { query: '海德堡' })
      expect(s.isError).toBe(false)
      expect((s.structuredContent!.hits as { path: string }[]).map((h) => h.path)).toEqual(['旅行/海德堡.md', '课程/欧洲史.md'])
      expect(JSON.parse(s.content[0]!.text)).toEqual(s.structuredContent)

      const r = await call(c, 'read_note', { path: '旅行/36-Travel-MOC', section: '德国' })
      expect(r.structuredContent).toMatchObject({ lines: [12, 16], text: '### 德国\n\n- 柏林\n- 慕尼黑\n' })

      const rec = await call(c, 'list_recent', {})
      expect((rec.structuredContent!.notes as { path: string }[]).length).toBe(3)
      const tasks = await call(c, 'list_tasks', { range: 'overdue' })
      expect((tasks.structuredContent!.tasks as { text: string }[]).map((x) => x.text)).toEqual(['交 EML 作业'])
      const v = await call(c, 'list_vaults')
      expect(v.structuredContent).toEqual({ vaults: [{ name: '测试库', path: run.vault, open: true }], app_running: true })

      // open_note：画布笔记里打开到那一节，光标在「### 德国」那一行
      const o = await call(c, 'open_note', { path: '旅行/36-Travel-MOC.md', section: '德国' })
      expect(o.structuredContent).toEqual({ opened: true, path: '旅行/36-Travel-MOC.md', line: 12 })
      await expect(page.locator('.tabs .tab.on')).toContainText('36-Travel-MOC')
      await expect.poll(() => caretLine(page)).toContain('德国')
      expect(readFileSync(join(run.vault, '旅行/36-Travel-MOC.md'), 'utf8')).toBe(MOC)

      // 没有这一节：isError，列出有哪些
      const bad = await call(c, 'read_note', { path: '旅行/36-Travel-MOC.md', section: '意大利' })
      expect(bad.isError).toBe(true)
      expect(bad.content[0]!.text).toContain('Sections:')
    } finally {
      await c.close()
    }

    // 钥匙不对：拒了，记一行「不认识的钥匙」
    const wrong = await connect({ ...entry, env: { ...entry.env, CN_MCP_KEY: 'x'.repeat(43) } })
    try {
      const w = await call(wrong, 'search_notes', { query: '海德堡' })
      expect(w.isError).toBe(true)
      expect(w.content[0]!.text).toContain('does not recognize this key')
    } finally {
      await wrong.close()
    }

    // 设置页：开着的页跟着变（调了 7 次），看记录里一行行写着
    await page.keyboard.press('Meta+Comma')
    await openPage(page)
    await expect(row(page, 'mcp-claude-code')).toContainText('7天调了7次')
    await expect(row(page, 'mcpLog')).toContainText('最近7天8次 · 没成2次')
    await row(page, 'mcpLog').getByRole('button', { name: '看记录' }).click()
    await expect(dlg(page).getByRole('heading', { name: '调用记录' })).toBeVisible()
    const list = dlg(page).getByRole('list', { name: '今天的调用' })
    await expect(list.getByRole('listitem')).toHaveCount(8)
    const texts = await list.getByRole('listitem').allInnerTexts()
    expect(texts[0]).toMatch(/不认识的钥匙[\s\S]*search_notes[\s\S]*没成：钥匙不对/)
    expect(texts.join('\n')).toContain('没成：这篇里没有「意大利」一节')
    expect(texts.join('\n')).toContain('在画布笔记里打开《36-Travel-MOC》第12行')
    expect(texts.join('\n')).toContain('读《36-Travel-MOC》「德国」一节')
    expect(texts.join('\n')).toContain('搜「海德堡」· 回了2篇')
    // 只看 Claude Code
    await dlg(page).getByRole('combobox', { name: '哪家AI' }).selectOption('claude-code')
    await expect(list.getByRole('listitem')).toHaveCount(7)
    await dlg(page).locator('.mcp-back').click()
    await expect(row(page, 'mcpOn')).toBeVisible()

    // 断开 Claude Code：配置里拿掉、钥匙作废，再调被拒
    await row(page, 'mcp-claude-code').getByRole('button', { name: '断开' }).click()
    await expect(toast(page)).toContainText('Claude Code断开了')
    expect(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers).toEqual({})
    const gone = await connect(entry)
    try {
      expect((await call(gone, 'list_vaults')).content[0]!.text).toContain('does not recognize this key')
    } finally {
      await gone.close()
    }

    // 关上：socket 没了，Codex 再调回「关着」
    await sw(page).click()
    await expect(sw(page)).toHaveAttribute('aria-checked', 'false')
    if (sockPath) await expect.poll(() => existsSync(sockPath)).toBe(false)
    const m = /CN_MCP_KEY = "([^"]+)"/.exec(readFileSync(join(home, '.codex/config.toml'), 'utf8'))![1]!
    const cx = await connect({ ...entry, env: { ...entry.env, CN_MCP_KEY: m } })
    try {
      expect((await call(cx, 'list_vaults')).content[0]!.text).toContain('turned off')
    } finally {
      await cx.close()
    }
  } finally {
    await run.close()
  }
})

test('画布笔记没开着：小程序直接读库里的文件、自己记一行；open_note 在后台拉起画布笔记、等它连上再交过去', async () => {
  test.setTimeout(120_000)
  const run = await launch(FILES, env())
  const { page } = run
  await openPage(page)
  await sw(page).click()
  await row(page, 'mcp-claude-code').getByRole('button', { name: '装上' }).click()
  await expect(row(page, 'mcp-claude-code')).toContainText('已装上')
  const entry = claudeEntry()
  let t = Date.now()
  const lap = (what: string) => (console.log(`[用时] ${what} ${Date.now() - t}ms`), (t = Date.now()))
  await run.close({ keep: true })
  lap('关软件')
  try {
    const c = await connect(entry)
    try {
      lap('连上小程序')
      const s = await call(c, 'search_notes', { query: '慕尼黑' })
      lap('没开软件时搜一次')
      expect(s.isError).toBe(false)
      expect(s.structuredContent).toMatchObject({ hits: [{ path: '旅行/36-Travel-MOC.md', section: '旅行 MOC/城市攻略/德国', line: 15 }], meaning: 'off: Canvas Notes is not running, so only words were searched' })
      const v = await call(c, 'list_vaults')
      expect(v.structuredContent).toMatchObject({ app_running: false, vaults: [{ name: '测试库', open: true }] })
      const r = await call(c, 'read_note', { path: '课程/欧洲史', section: '第一讲' })
      expect(r.structuredContent!.text).toBe('## 第一讲\n\n海德堡大学建于 1386 年。\n')
    } finally {
      await c.close()
    }
    const month = new Date().toISOString().slice(0, 7)
    const lines = readFileSync(join(run.userData, 'mcp-calls', `${month}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { tool: string; offline?: boolean; client: string })
    expect(lines.slice(-3).map((l) => [l.tool, l.offline, l.client])).toEqual([
      ['search_notes', true, 'claude-code'],
      ['list_vaults', true, 'claude-code'],
      ['read_note', true, 'claude-code'],
    ])

    // open_note：拉起「画布笔记」（测试里换成一个假的：在 socket 上听一条、记下来、照软件的样子回）
    const sock = join(run.userData, 'mcp.sock').length < 100 ? join(run.userData, 'mcp.sock') : null
    test.skip(!sock, '临时目录太深，socket 在系统临时目录里，这条只在短路径下测')
    const got = join(home, 'got.json')
    const fake = join(home, 'fake-app.cjs')
    writeFileSync(
      fake,
      `const net = require('node:net'); const fs = require('node:fs');
       setTimeout(() => {
         const srv = net.createServer((s) => { let b = ''; s.on('data', (d) => { b += d; if (!b.includes('\\n')) return;
           const r = JSON.parse(b); fs.writeFileSync(${JSON.stringify(got)}, JSON.stringify(r));
           s.end(JSON.stringify({ id: r.id, ok: true, result: { text: '{"opened":true}', isError: false, structured: { opened: true, path: r.args.path, line: 12 } } }) + '\\n');
           setTimeout(() => { srv.close(); process.exit(0) }, 100) }) });
         srv.listen(${JSON.stringify(sock)});
       }, 1500);`,
    )
    const c2 = await connect(entry, { CN_MCP_LAUNCH: `"${process.execPath}" "${fake}"` })
    try {
      const t0 = Date.now()
      const o = await call(c2, 'open_note', { path: '旅行/36-Travel-MOC.md', section: '德国' })
      expect(o.structuredContent).toEqual({ opened: true, path: '旅行/36-Travel-MOC.md', line: 12 })
      expect(Date.now() - t0).toBeGreaterThan(1400)
      expect(JSON.parse(readFileSync(got, 'utf8'))).toMatchObject({ key: entry.env.CN_MCP_KEY, tool: 'open_note', args: { path: '旅行/36-Travel-MOC.md', section: '德国' } })
    } finally {
      await c2.close()
    }
  } finally {
    rmSync(join(run.vault, '..'), { recursive: true, force: true })
  }
})

test('ParaRead 装着：接上写一份接法、断开删掉；没装的 MeetCaption 点「去看看」到软件家族；别的 AI 拷贝配置（测试里不碰剪贴板）', async () => {
  const installed = join(home, 'installed.json')
  writeFileSync(installed, JSON.stringify({ pararead: '0.1.5' }))
  const run = await launch(FILES, { ...env(), CN_FAMILY_INSTALLED_FILE: installed })
  const { page } = run
  try {
    await openPage(page)
    await sw(page).click()
    const pr = row(page, 'mcp-pararead')
    await expect(pr).toContainText('已装 0.1.5 · 接上后它能找你的笔记')
    await pr.getByRole('button', { name: '接上' }).click()
    await expect(pr).toContainText('已接上')
    const f = join(run.userData, 'mcp-clients/pararead.json')
    expect(JSON.parse(readFileSync(f, 'utf8')).mcpServers['canvas-notes'].env.CN_MCP_KEY).toMatch(/^[\w-]{43}$/)
    await pr.getByRole('button', { name: '断开' }).click()
    await expect(pr).toContainText('接上后它能找你的笔记')
    expect(existsSync(f)).toBe(false)

    const other = row(page, 'mcp-other')
    await other.getByRole('button', { name: '拷贝 别的AI 的配置' }).click()
    await expect(toast(page)).toContainText('拷好了')
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())).toContain('拷贝配置 other')
    await expect(other).toContainText('拷过一份配置')
    await expect(other.getByRole('button', { name: '作废钥匙' })).toBeVisible()

    // Claude 桌面版：这一版只拷贝配置
    await expect(row(page, 'mcp-claude-desktop')).toContainText('没找到 Claude 桌面版')
    await expect(row(page, 'mcp-claude-desktop').getByRole('button', { name: '拷贝 Claude 桌面版 的配置' })).toBeEnabled()

    // 自动化：外面怎么跑写着，让外面的 AI 跑灰着
    await expect(dlg(page).locator('.sa-grph', { hasText: '能用深链和命令行跑一条规则' })).toBeVisible()
    const weekly = row(page, 'mcpAuto').locator('.sa-row', { hasText: '周记' })
    await expect(weekly).toContainText('关着 · canvas-notes://automation/run?name=周记')
    await weekly.getByRole('button', { name: '拷贝「周记」的链接' }).click()
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())).toContain('拷贝 canvas-notes://automation/run?name=%E5%91%A8%E8%AE%B0')
    await expect(row(page, 'mcpAutoAi').getByRole('switch')).toBeDisabled()

    await row(page, 'mcp-meetcaption').getByRole('button', { name: '去软件家族看MeetCaption' }).click()
    await expect(dlg(page).getByRole('heading', { name: '软件家族' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('侧栏多了「对外接口」（AI 那段第二项），搜「MCP」跳到这一页', async () => {
  const run = await launch(FILES, env())
  const { page } = run
  try {
    await page.keyboard.press('Meta+Comma')
    await expect(nav(page).locator('.si')).toHaveCount(20)
    await dlg(page).getByRole('textbox', { name: '搜设置' }).fill('MCP')
    await dlg(page).getByRole('textbox', { name: '搜设置' }).press('Enter')
    await expect(dlg(page).getByRole('heading', { name: '对外接口' })).toBeVisible()
  } finally {
    await run.close()
  }
})
