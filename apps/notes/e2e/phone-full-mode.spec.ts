// 手机全能模式（手机交给 Mac 的 AI 也能用全能模式）：照 iPhone 的做法写的小客户端（src/main/mobile-ai/client.ts）真配对、真走协议，
// Mac 这头是真的软件（假 AI，CN_AI_FAKE=1，工具真经 MCP 调、命令真在库里跑）：
// 全能模式下让 AI 改一篇 → 文件改了、提交了一次、手机撤回得了；删一篇 → 手机先收到「等你点头」，回「不要」不删、回「可以」才删；
// AI 跑 rm 命令（命令行自己的那一步）也一样先问；Mac 右栏顶上写着在等手机点头；设置里关掉这台的全能模式，再问只读、说为什么；
// 关掉 Mac 的窗口（软件还在）照样能改。一律无头（CN_E2E=1）、临时库、临时设置目录。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { ask, confirm, hello, pairWith, type Paired, undo, wantFull } from '../src/main/mobile-ai/client'
import { b64u, type Frame, parsePairLink } from '../src/main/mobile-ai/protocol'
import { launch, openAi, openNote } from './app'

const files = {
  '随手记.md': '# 随手记\n\n一段字。\n',
  '读书/三体.md': '# 三体\n\n黑暗森林是一种猜疑链。\n',
  '草稿.md': '# 草稿\n\n要删的。\n',
}
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const group = (page: Page) => dialog(page).getByRole('group', { name: 'iPhone 和 iPad' })

const textOf = (frames: Frame[]) =>
  frames
    .filter((f): f is Extract<Frame, { t: 'text' }> => f.t === 'text')
    .map((f) => f.d)
    .join('')
/** CN_SHOTS=<目录>：顺手截设置里那几行、右栏顶上那一句（给设计复审看） */
const SHOTS = process.env.CN_SHOTS
const shot = async (page: Page, name: string, el?: ReturnType<Page['locator']>) => {
  if (!SHOTS) return
  await (el ?? page).screenshot({ path: join(SHOTS, `mac-${name}.png`) })
}
const gitLog = (vault: string) => execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')

/** 问一问；那一步在等点头时照 answer 回（null 是不回，等它超时）；返回全部帧和看到的那一帧 ask */
async function askFull(p: Paired, text: string, answer: boolean | null, onAsk?: (f: Frame) => Promise<void>) {
  const nonce = b64u(randomBytes(12))
  let asked: Extract<Frame, { t: 'step' }> | null = null
  const pending: Promise<unknown>[] = []
  const frames = await ask(
    p,
    { kind: 'chat', text, device: 'iPhone', mode: 'full' },
    (f) => {
      if (f.t !== 'step' || f.status !== 'ask') return
      asked = f
      pending.push(
        (async () => {
          await onAsk?.(f)
          if (answer !== null) await confirm(p, nonce, f.id, answer)
        })(),
      )
    },
    { nonce },
  )
  await Promise.all(pending)
  return { frames, asked: asked as Extract<Frame, { t: 'step' }> | null }
}

test('手机全能模式：改一篇提交、能撤回；删文件、跑 rm 先在手机上点头（不要不删、可以才删），Mac 右栏显示在等；设置里关掉这台只读；关了窗口照样能改', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_MAC_NAME: '测试 Mac' })
  const { page, vault } = run
  try {
    // 设置 › AI：打开「让iPhone / iPad用这台Mac的AI」，扫码配对
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    await group(page).getByRole('switch', { name: '让iPhone / iPad用这台Mac的AI' }).click()
    const qr = group(page).getByRole('img', { name: '配对二维码' })
    await expect(qr).toBeVisible()
    const link = parsePairLink((await qr.getAttribute('data-link'))!)
    const phone = await pairWith(link, `http://127.0.0.1:${link.port}`, '小手机', 'iPhone')
    // 这台设备一行里有「全能模式」开关（默认开），下面一句风险说明
    const row = group(page).locator('[data-row^="mobileAiDev-"]')
    const full = row.getByRole('switch', { name: 'iPhone「小手机」能用全能模式' })
    await expect(full).toHaveAttribute('aria-checked', 'true')
    await expect(group(page).getByTestId('mobile-ai-risk')).toHaveText(/^风险：开着全能模式时，拿着这台配好设备的人能让这台Mac的AI读写文件、跑命令、上网/)
    await shot(page, 'settings-devices', group(page))
    await page.keyboard.press('Escape')

    // 在吗：Mac 右栏全能模式默认开着，这台能用全能模式
    expect(await hello(phone)).toMatchObject({ t: 'hello', omni: true, full: true })

    // 1. 改一篇：文件改了，提交了一次「AI：… · 从iPhone」，手机收到改了哪些文件和提交号
    const edit = await askFull(phone, '在「随手记.md」末尾加上「手机上加的一行」', null)
    expect(edit.frames[0]).toMatchObject({ t: 'meta', mode: 'full' })
    expect(edit.asked).toBeNull()
    expect(readFileSync(join(vault, '随手记.md'), 'utf8')).toContain('手机上加的一行')
    const changed = edit.frames.find((f): f is Extract<Frame, { t: 'changed' }> => f.t === 'changed')!
    expect(changed.files).toEqual([{ path: '随手记.md', kind: '改' }])
    expect(changed.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(gitLog(vault)[0]).toBe('AI：在「随手记.md」末尾加上「手机上加的一行」 · 从iPhone')
    // 步骤行和 Mac 右栏同一个说法
    expect(edit.frames.filter((f) => f.t === 'step').map((f) => (f as { label: string }).label)).toContain('在《随手记》末尾加一段')
    expect(edit.frames.at(-1)).toMatchObject({ t: 'done' })
    // 撤回：那一次撤掉，字没了
    expect(await undo(phone, changed.commit!)).toMatchObject({ t: 'ok' })
    expect(readFileSync(join(vault, '随手记.md'), 'utf8')).not.toContain('手机上加的一行')
    expect(gitLog(vault)[0]).toMatch(/^撤回AI：在「随手记.md」末尾/)

    // 2. 删一篇：先在手机上等点头；等着的时候 Mac 右栏顶上写着；回「不要」不删
    await openAi(page)
    const no = await askFull(phone, '删掉「草稿.md」', false, async () => {
      await expect(page.getByTestId('mobile-ai-waiting')).toHaveText('iPhone「小手机」上的 AI 在等那边点头：删掉《草稿》')
      await shot(page, 'panel-waiting', page.getByRole('complementary', { name: 'AI 对话' }))
    })
    expect(no.asked).toMatchObject({ status: 'ask', label: '等你点头：删掉《草稿》', yes: '可以，删除' })
    expect(existsSync(join(vault, '草稿.md'))).toBe(true)
    expect(no.frames.some((f) => f.t === 'changed')).toBe(false)
    expect(no.frames.find((f) => f.t === 'step' && f.status === 'err')).toMatchObject({ detail: '没点头' })
    await expect(page.getByTestId('mobile-ai-waiting')).toHaveCount(0)
    // 回「可以」才删，删了的提交成一次
    const yes = await askFull(phone, '删掉「草稿.md」', true)
    expect(yes.asked).toMatchObject({ label: '等你点头：删掉《草稿》' })
    expect(existsSync(join(vault, '草稿.md'))).toBe(false)
    expect(yes.frames.find((f) => f.t === 'changed')).toMatchObject({ files: [{ path: '草稿.md', kind: '删' }] })

    // 3. 命令行自己跑 rm（Bash 那一步）：也先问；不要就不跑
    const rm = await askFull(phone, '跑命令「rm 读书/三体.md」', false)
    expect(rm.asked).toMatchObject({ label: '等你点头：删：rm 读书/三体.md', yes: '可以，删除' })
    expect(existsSync(join(vault, '读书/三体.md'))).toBe(true)
    expect(textOf(rm.frames)).toContain('没跑')
    // 在做、等点头、没做成是同一行（同一个编号，手机上那一行换样子，不多出一行）
    expect(new Set(rm.frames.filter((f) => f.t === 'step').map((f) => (f as { id: string }).id)).size).toBe(1)
    expect(rm.frames.filter((f) => f.t === 'step').at(-1)).toMatchObject({ status: 'err', label: '跑命令', code: 'rm 读书/三体.md', detail: '没点头' })
    const rmYes = await askFull(phone, '跑命令「rm 读书/三体.md」', true)
    expect(rmYes.asked).not.toBeNull()
    expect(existsSync(join(vault, '读书/三体.md'))).toBe(false)
    expect(rmYes.frames.find((f) => f.t === 'changed')).toMatchObject({ files: [{ path: '读书/三体.md', kind: '删' }] })

    // 4. 设置里关掉这台的全能模式：要了也只读，meta 里写为什么
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    await full.click()
    await expect(full).toHaveAttribute('aria-checked', 'false')
    expect(await hello(phone)).toMatchObject({ full: false, no: 'device' })
    const ro = await ask(phone, { kind: 'chat', text: '在「随手记.md」末尾加上「不该加上」', mode: 'full' })
    expect(ro[0]).toMatchObject({ t: 'meta', mode: 'read', why: '这台iPhone在 Mac 的设置 › AI 里关了全能模式，这次只读', no: 'device' })
    expect(readFileSync(join(vault, '随手记.md'), 'utf8')).not.toContain('不该加上')
    await page.keyboard.press('Escape')

    // 4b. 手机上点「请 Mac 打开」：Mac 窗口底下一句「iPhone「小手机」想打开全能模式 · 不要 · 允许」，不自己收；点「允许」打开这台的开关，再问是全能模式
    expect(await wantFull(phone, 'device')).toMatchObject({ t: 'ok' })
    const bar = page.getByTestId('toast')
    await expect(bar.getByTestId('toast-text')).toHaveText('iPhone「小手机」想打开全能模式')
    await expect(bar.getByRole('button', { name: '不要' })).toBeVisible()
    await shot(page, 'want-full', bar)
    // 10 秒以后还在（别的提示 6 秒、带撤回的 10 秒就收）
    await page.waitForTimeout(11_000)
    await expect(bar.getByTestId('toast-text')).toHaveText('iPhone「小手机」想打开全能模式')
    // 中间来了别的提示（关掉一个标签「关掉了「随手记」· 撤回」）：那条收起以后这一句回来，手机那边不会白等
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+w')
    await expect(bar.getByTestId('toast-text')).toHaveText('关掉了「随手记」')
    await expect(page.getByTestId('toast').getByTestId('toast-text')).toHaveText('iPhone「小手机」想打开全能模式', { timeout: 20_000 })
    await page.getByTestId('toast').getByRole('button', { name: '允许' }).click()
    await expect(page.getByTestId('toast')).toHaveCount(0)
    expect(await hello(phone)).toMatchObject({ full: true })
    expect(await hello(phone)).not.toHaveProperty('no')
    const granted = await ask(phone, { kind: 'chat', text: '现在是什么模式', mode: 'full' })
    expect(granted[0]).toMatchObject({ t: 'meta', mode: 'full' })
    // 本来就能用：回 already，Mac 上不再弹
    expect(await wantFull(phone, 'device')).toMatchObject({ t: 'ok', already: true })
    await expect(page.getByTestId('toast')).toHaveCount(0)
    // 记进 main.log：每次来问按哪种答、Mac 上点了什么（用户说「手机上只读」时有据可查）
    const mainLog = readFileSync(join(run.userData, 'logs', 'main.log'), 'utf8')
    expect(mainLog).toContain('[phone-ai] iPhone「小手机」问了一问（chat，只读：全能模式挡在 device）')
    expect(mainLog).toContain('[phone-ai] iPhone「小手机」想打开全能模式：Mac 上点了允许')

    // 5. 关掉窗口（软件还在跑）：照样能改、提交
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()))
    await expect.poll(() => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
    const closed = await askFull(phone, '在「随手记.md」末尾加上「窗口关着加的」', null)
    expect(closed.frames[0]).toMatchObject({ t: 'meta', mode: 'full' })
    expect(closed.frames.at(-1)).toMatchObject({ t: 'done' })
    expect(readFileSync(join(vault, '随手记.md'), 'utf8')).toContain('窗口关着加的')
    expect(gitLog(vault)[0]).toBe('AI：在「随手记.md」末尾加上「窗口关着加的」 · 从iPhone')
  } finally {
    await run.close()
  }
})
