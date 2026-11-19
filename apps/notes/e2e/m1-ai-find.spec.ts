// CN-87（M1 录屏 0:25）：Mac 上装了 Codex，引擎菜单里就要能选。
// 从访达打开的软件 PATH 只有 /usr/bin:/bin；codex 只在 .zshrc 加进 PATH 的目录里：启动后在后台跑一次登录 shell 取 PATH，找得到、能选。
// 找到了但运行不了和没装分开说；「装在别处？指定位置…」选 Codex.app 用包里带的 codex，记在 userData/ai/settings.json。
// 找命令是真的（CN_REAL_FIND=1），跑的还是假引擎（CN_AI_FAKE=1），不碰这台 Mac 上真的 AI。
import { expect, test } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch } from './app'

function script(p: string, body: string) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

test('CN-87：PATH 只有 /usr/bin:/bin、codex 只在 .zshrc 加的目录里：找得到、写着 ~/my-tools/bin、菜单里能选；运行不了的说原因；指定 Codex.app 用包里的', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cn-e2e-home-'))
  const codex = join(home, 'my-tools/bin/codex')
  script(codex, 'echo "codex-cli 9.9.9-test"')
  writeFileSync(join(home, '.zshrc'), 'echo "zshrc 里打印的字"\nexport PATH="$HOME/my-tools/bin:$PATH"\n')
  const run = await launch({ '甲.md': '# 甲\n' }, { CN_AI_FAKE: '1', CN_REAL_FIND: '1', PATH: '/usr/bin:/bin', HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh' })
  const { page } = run
  const info = (again = false) => page.evaluate(async (a) => (await window.cn.aiEngines(a)).engines.find((e) => e.id === 'codex')!, again)
  try {
    await expect.poll(info, { timeout: 15_000 }).toMatchObject({ path: codex, where: '~/my-tools/bin' })
    expect((await info()).broken).toBeUndefined()

    // 菜单里真点得到：选 Codex，问一句是 Codex 答的
    await page.keyboard.press('Meta+j')
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    await ai.getByTestId('ai-engine').click()
    const item = page.getByRole('menu', { name: 'AI 引擎' }).getByRole('menuitemradio').filter({ hasText: 'Codex' })
    await expect(item).toBeEnabled()
    await item.click()
    await expect(ai.getByTestId('ai-engine')).toHaveText('Codex')
    await ai.getByRole('textbox', { name: '问 AI' }).fill('你好')
    await ai.getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Codex）。', { timeout: 15_000 })

    // 找到了但运行不了（比如升级到一半）：和没装分开说，菜单里这一项不能选
    script(codex, 'echo "dyld: Library not loaded: libssl.3.dylib" >&2\nexit 134')
    const broken = await info(true)
    expect(broken).toMatchObject({ path: null, where: '~/my-tools/bin', broken: '运行 codex --version 出错（退出码 134）：dyld: Library not loaded: libssl.3.dylib' })
    expect(broken.hint).toContain('运行不了')
    await ai.getByTestId('ai-engine').click()
    await expect(page.getByRole('menu', { name: 'AI 引擎' }).getByRole('menuitemradio').filter({ hasText: 'Codex' })).toBeDisabled()
    await page.keyboard.press('Escape')

    // 装在别处？指定位置…：选 Codex.app（系统选文件框换成直接给这个包），用包里带的 codex，记进设置
    const app = join(home, 'Apps/Codex.app')
    script(join(app, 'Contents/Resources/codex'), 'echo "codex-cli 10.0.0"')
    await run.app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
    }, app)
    const picked = await page.evaluate(() => window.cn.aiPickCli('codex'))
    expect(picked).toMatchObject({ id: 'codex', path: join(app, 'Contents/Resources/codex'), where: '在 Codex.app 里找到', custom: true })
    expect(JSON.parse(readFileSync(join(run.userData, 'ai/settings.json'), 'utf8')).cli).toEqual({ codex: join(app, 'Contents/Resources/codex') })
    await expect.poll(info).toMatchObject({ path: join(app, 'Contents/Resources/codex'), where: '在 Codex.app 里找到' })
    await ai.getByTestId('ai-engine').click()
    await expect(page.getByRole('menu', { name: 'AI 引擎' }).getByRole('menuitemradio').filter({ hasText: 'Codex' })).toBeEnabled()
    await page.keyboard.press('Escape')

    // 选了个不能运行的文件：不收，说清楚
    writeFileSync(join(home, 'readme.txt'), '不是命令行')
    await run.app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
    }, join(home, 'readme.txt'))
    const err = await page.evaluate(() => window.cn.aiPickCli('codex').then(() => '', (e: Error) => e.message))
    expect(err).toContain('选的不是能运行的 codex')
    // 取消：什么都不变
    await run.app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog
    })
    expect(await page.evaluate(() => window.cn.aiPickCli('codex'))).toBeNull()
    expect((await info()).path).toBe(join(app, 'Contents/Resources/codex'))
  } finally {
    await run.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('CN-87：测试模式的假命令行能演「没找到」「运行不了」（CN_AI_FAKE_CLI），在哪找到照真的样子写', async () => {
  const run = await launch({ '甲.md': '# 甲\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_CLI: 'codex=missing,gemini=broken' })
  const { page } = run
  try {
    const engines = await page.evaluate(async () => (await window.cn.aiEngines()).engines)
    expect(engines.map((e) => [e.id, e.path, e.where, e.broken ?? ''])).toEqual([
      ['claude', '/fake/claude', '~/.local/bin', ''],
      ['codex', null, '没找到', ''],
      ['gemini', null, '/opt/homebrew/bin', '运行 gemini --version 出错（退出码 1）：测试用的坏命令行'],
      ['opencode', '/fake/opencode', '~/.opencode/bin', ''],
    ])
    expect(engines[1]!.hint).toContain('没找到 codex 命令')
  } finally {
    await run.close()
  }
})
