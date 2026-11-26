// 手机全能模式真连一遍：本机起画布笔记（测试模式、临时库、临时设置目录，窗口不上屏），iPad 模拟器里的画布笔记扫码配对它、
// AI 对话头上切全能模式、问一句新建笔记，测试库里真出现那一篇、提交成一次「AI：… · 从iPad」。
// 要先编好 iOS 的测试包（xcodebuild build-for-testing … -derivedDataPath <dd>），模拟器由 xcodebuild 无头起（不开 Simulator.app 的窗口）：
//   CN_SIM=<模拟器 id> CN_SIM_DD=<derivedData> [CN_SIM_VAULT=<iOS 样例库>] npx playwright test e2e/sim-phone-full.spec.ts
// 默认假 AI（CN_AI_FAKE=1，按「新建一篇「标题」放到「文件夹」写上「正文」」走库里的笔记工具）；
// CN_REAL_AI=1 用本机订阅的 Claude Code 真问「在收件箱新建一篇测试」（去掉父会话的 CLAUDECODE、CLAUDE_CODE_*、CLAUDE_API_KEY_*、
// CN_TEST_ANTHROPIC_API_KEY，留 CLAUDE_CONFIG_DIR；跑完删这次的会话记录）。CN_SHOTS=<目录> 存两边的截图。
import { expect, test } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from './app'

const SIM = process.env.CN_SIM
const DD = process.env.CN_SIM_DD
const REAL = process.env.CN_REAL_AI === '1'
test.skip(!SIM || !DD, '要 iPad 模拟器和编好的 iOS 测试包：CN_SIM、CN_SIM_DD')
test.setTimeout(20 * 60_000)

const APPLE = join(__dirname, '../../apple')
const ASK = REAL ? '在收件箱新建一篇测试' : '新建一篇「测试」放到「收件箱」写上「手机全能模式真连一遍」'

test(`手机全能模式真连：iPad 模拟器切全能模式问「${ASK}」，测试库里真出现那一篇（${REAL ? '真 Claude Code' : '假 AI'}）`, async () => {
  const env: Record<string, string> = { CN_MAC_NAME: '测试 Mac' }
  if (REAL) {
    // 像从访达打开的软件一样：不带父会话（Claude Code 终端）的这几样
    for (const k of Object.keys(process.env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || /^CLAUDE_API_KEY_\d$/.test(k) || k === 'CN_TEST_ANTHROPIC_API_KEY') delete process.env[k]
    env.CN_AI_MODEL = 'sonnet'
  } else env.CN_AI_FAKE = '1'
  const run = await launch({ '收件箱/.gitkeep': '', '随手记.md': '# 随手记\n\n一段字。\n' }, env)
  const { page, vault } = run
  const work = mkdtempSync(join(tmpdir(), 'cn-sim-'))
  let control: ReturnType<typeof createServer> | null = null
  try {
    // 设置 › AI：打开「让iPhone / iPad用这台Mac的AI」，拿二维码里的配对链接
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const group = page.getByRole('dialog', { name: '设置' }).getByRole('group', { name: 'iPhone 和 iPad' })
    await group.getByRole('switch', { name: '让iPhone / iPad用这台Mac的AI' }).click()
    const qr = group.getByRole('img', { name: '配对二维码' })
    await expect(qr).toBeVisible()
    const link = (await qr.getAttribute('data-link'))!
    // 模拟器里的 UI 测试从这个控制端口拿配对链接（同假 Mac 的 /link）；别的摆布假 Mac 的路径在这里什么都不做
    control = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(req.url?.startsWith('/link') ? { link } : {}))
    })
    await new Promise<void>((r) => control!.listen(0, '127.0.0.1', r))
    const port = (control.address() as AddressInfo).port
    // 手机这头的库：iOS 样例库（只是让 App 打开个库，问的是 Mac 上的测试库）
    const phoneVault = process.env.CN_SIM_VAULT ?? join(work, '手机库')
    if (!process.env.CN_SIM_VAULT) execFileSync('node', [join(APPLE, 'scripts/make-sample-vault.mjs'), phoneVault, '--bare', join(work, 'remote.git')])
    const shots = process.env.CN_SHOTS ?? ''
    const out = await new Promise<string>((resolve) => {
      const p = spawn(
        'nice',
        ['xcodebuild', 'test-without-building', '-project', join(APPLE, 'CanvasNotes.xcodeproj'), '-scheme', 'CanvasNotes', '-destination', `id=${SIM}`, '-derivedDataPath', DD!, '-only-testing:CanvasNotesUITests/AIUITests/testRealMacFullModeNewNote'],
        {
          env: {
            ...process.env,
            TEST_RUNNER_CN_FAKE_MAC_CONTROL: `http://127.0.0.1:${port}`,
            TEST_RUNNER_CN_CLOUD_BASE: 'http://127.0.0.1:9',
            TEST_RUNNER_CN_VAULT: phoneVault,
            TEST_RUNNER_CN_REAL_MAC_ASK: ASK,
            TEST_RUNNER_CN_REAL_MAC_WAIT: REAL ? '300' : '60',
            TEST_RUNNER_CN_REAL_TAG: REAL ? 'claude' : 'fake',
            TEST_RUNNER_CN_SHOTS: shots,
            TEST_RUNNER_CN_SKIN: 'sky',
          },
        },
      )
      let text = ''
      p.stdout.on('data', (d) => (text += d))
      p.stderr.on('data', (d) => (text += d))
      p.on('close', () => resolve(text))
    })
    const lines = out.split('\n').filter((l) => /Test Case .*(passed|failed)|error:|\*\* TEST/.test(l))
    console.log(lines.join('\n'))
    expect(out).toContain('** TEST EXECUTE SUCCEEDED **')
    // Mac 这头：收件箱里真多了一篇，提交成一次「AI：… · 从iPad」
    const made = readdirSync(join(vault, '收件箱')).filter((f) => f.endsWith('.md'))
    console.log(`收件箱：${made.join('、')}\n${made.map((f) => readFileSync(join(vault, '收件箱', f), 'utf8')).join('\n---\n')}`)
    expect(made.length).toBe(1)
    if (!REAL) expect(readFileSync(join(vault, '收件箱/测试.md'), 'utf8')).toContain('手机全能模式真连一遍')
    const log = execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
    console.log(`提交：${log[0]}`)
    expect(log[0]).toMatch(/^AI：.* · 从iPad$/)
    if (shots) await page.screenshot({ path: join(shots, `mac-sim-${REAL ? 'claude' : 'fake'}.png`) })
  } finally {
    control?.close()
    rmSync(work, { recursive: true, force: true })
    await run.close()
    // 只删这次的 Claude 会话记录（按临时库路径起名的那个文件夹）
    if (REAL) {
      const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
      const mine = vault.replace(/[^A-Za-z0-9]/g, '-')
      if (existsSync(projects)) for (const d of readdirSync(projects)) if (d.includes(mine.slice(-24))) rmSync(join(projects, d), { recursive: true, force: true })
    }
  }
})
