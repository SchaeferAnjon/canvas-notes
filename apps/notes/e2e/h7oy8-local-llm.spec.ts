/**
 * 本地模型（task-h7oy8）：设置 › 梦游里那张卡真点一遍（下载 → 进度 → 取消 → 继续下载 → 已下好；换模型）；
 * window.cn.llmDownload 的进度事件一路到 ready；localAsk 在 CN_AI_FAKE=1 下转给梦游的假回答，并记一行 feature: 'local'。
 * 无头（CN_E2E=1）、CN_AI_FAKE=1 假下载不联网、CN_LLM_DIR 临时目录。卡在设置 › 梦游「AI判断补双链」选了本地模型时出来。
 * CN_SHOTS=<目录> 时另截交付图（浅色、深色各四种状态）。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'

const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const card = (page: Page) => page.getByTestId('llm-card')

let tmp = ''
test.beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cn-llm-e2e-'))
})
test.afterEach(() => rmSync(tmp, { recursive: true, force: true }))

async function start(env: Record<string, string> = {}, skin?: { skin: string; dark: boolean }): Promise<Running> {
  const run = await launch({ '收件箱/一篇.md': '# 一篇\n\n正文\n' }, { CN_AI_FAKE: '1', CN_LLM_DIR: join(tmp, 'llm'), CN_FAKE_PICK_LOG: join(tmp, 'pick.log'), ...env }, (vault) => {
    if (!skin) return
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: skin.skin, frame: 'b' } }))
  })
  return run
}

async function openCard(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '梦游', exact: true }).click()
  await expect(dialog(page).getByTestId('dream-set-now')).toBeVisible()
  // 「AI判断补双链」选「本地模型」，下面出这张卡
  await dialog(page).getByRole('radiogroup', { name: 'AI判断走哪条路' }).getByRole('radio', { name: /本地模型/ }).click()
  await expect(card(page)).toHaveAttribute('data-phase', /./)
  await card(page).scrollIntoViewIfNeeded()
}

test('设置里那张卡：下载、看进度、取消、继续下载、已下好；换模型', async () => {
  // 假下载 8 秒、停一次再接着下，加上启动、退出：机器忙时会超过默认的 60 秒
  test.setTimeout(120_000)
  const run = await start({ CN_FAKE_LLM_MS: '8000' })
  const { page } = run
  try {
    await openCard(page)
    const c = card(page)
    await expect(c).toHaveAttribute('data-phase', 'missing')
    await expect(c.getByTestId('llm-model')).toHaveValue('qwen3-4b-2507-q4km')
    await expect(c.getByTestId('llm-needs')).toContainText(/下载一次2\.5 GB，以后不联网 · 跑起来约占3\.9 GB内存（这台Mac \d+ GB）/)
    await expect(c.getByTestId('llm-needs')).toContainText(`存在${join(tmp, 'llm')}`)
    // Apple 芯片的 Mac 上不提芯片
    await expect(c).not.toContainText('Apple芯片')
    await expect(c.getByTestId('llm-state')).toContainText('还没下载')
    await expect(c.getByTestId('llm-download')).toHaveText('下载2.5 GB')
    // 在访达中显示：测试模式只记下来
    await c.getByRole('button', { name: '在访达中显示' }).click()
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('\n'))).toContain(`打开 ${join(tmp, 'llm')}`)

    // 点「下载2.5 GB」：进度条走起来，写着已下多少 / 2.5 GB、百分比 · 速度
    await c.getByTestId('llm-download').click()
    await expect(c).toHaveAttribute('data-phase', 'downloading')
    await expect(c.getByTestId('llm-state')).toContainText(/正在下载 · \d+(\.\d)? [MG]B \/ 2\.5 GB/)
    await expect(c.getByTestId('llm-progress')).toHaveText(/^\d+% · \d+ MB\/s$/)
    // 下载中不能换模型
    await expect(c.getByTestId('llm-model')).toBeDisabled()
    await expect.poll(async () => Number(/(\d+)%/.exec((await c.getByTestId('llm-progress').textContent()) ?? '')?.[1] ?? 0)).toBeGreaterThan(10)

    // 取消：回到没下好，写着下了一部分，按钮变「继续下载」
    await c.getByTestId('llm-cancel').click()
    await expect(c).toHaveAttribute('data-phase', 'missing')
    await expect(c.getByTestId('llm-state')).toContainText(/下了一部分 · \d+(\.\d)? [MG]B \/ 2\.5 GB/)
    await expect(c.getByTestId('llm-state')).toContainText('已下的留着，接着下不从头来')
    await expect(c.getByTestId('llm-download')).toHaveText('继续下载')
    const stopped = (await page.evaluate(() => window.cn.llmStatus())).got!

    // 继续下载：从停下的地方接着走，经过校验，到「已下好」
    const phases: string[] = []
    await page.exposeFunction('cnSeen', (p: string) => phases.push(p))
    await page.evaluate(() => window.cn.onLlm((s) => (window as unknown as { cnSeen(p: string): void }).cnSeen(`${s.phase}:${s.got ?? 0}`)))
    await c.getByTestId('llm-download').click()
    await expect(c).toHaveAttribute('data-phase', 'ready', { timeout: 15_000 })
    await expect(c.getByTestId('llm-state')).toContainText('已下好 · 2.5 GB')
    const firstGot = Number(phases.find((p) => p.startsWith('downloading:'))!.split(':')[1])
    expect(firstGot).toBeGreaterThanOrEqual(stopped)
    expect(phases.some((p) => p.startsWith('verifying'))).toBe(true)
    expect(existsSync(join(tmp, 'llm', 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'))).toBe(true)

    // 换小一档：那个还没下；选择记在设置目录里
    await c.getByTestId('llm-model').selectOption('qwen3-1.7b-q8')
    await expect(c).toHaveAttribute('data-phase', 'missing')
    await expect(c.getByTestId('llm-download')).toHaveText('下载1.8 GB')
    await expect(c).toContainText('小一档')
    expect(JSON.parse(readFileSync(join(run.userData, 'local-llm.json'), 'utf8'))).toEqual({ model: 'qwen3-1.7b-q8' })
    // 换回来：已下好
    await c.getByTestId('llm-model').selectOption('qwen3-4b-2507-q4km')
    await expect(c).toHaveAttribute('data-phase', 'ready')
  } finally {
    await run.close()
  }
})

test('window.cn.llmDownload 的进度事件一路到 ready；localAsk 走梦游的假回答并记下走的是本地', async () => {
  const run = await start({ CN_FAKE_LLM_MS: '1000' })
  const { page, app } = run
  try {
    // 没下好时 localAsk 也转给假回答（CN_AI_FAKE=1 不看文件）；记一行 feature: local
    const answer = await app.evaluate(async () => {
      const g = globalThis as unknown as { cnLocalLlm: { ask(s: string, p: string, o: { signal: AbortSignal; json?: boolean }): Promise<string> } }
      return g.cnLocalLlm.ask('你是判断两篇笔记关系的助手', '命令：梦游判断\n两篇笔记……', { signal: new AbortController().signal, json: true })
    })
    expect(typeof answer).toBe('string')
    const log = readFileSync(join(tmp, 'pick.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { feature: string; model?: string; json?: boolean })
    expect(log[0]).toMatchObject({ feature: 'local', model: 'qwen3-4b-2507-q4km', json: true })
    expect(log[1]).toMatchObject({ feature: 'dream' })

    const seen = await page.evaluate(
      () =>
        new Promise<{ phases: string[]; final: string; pcts: number[] }>((resolve) => {
          const phases: string[] = []
          const pcts: number[] = []
          const off = window.cn.onLlm((s) => {
            if (phases.at(-1) !== s.phase) phases.push(s.phase)
            if (s.phase === 'downloading' && s.total) pcts.push(Math.floor(((s.got ?? 0) / s.total) * 100))
          })
          void window.cn.llmDownload().then((s) => {
            off()
            resolve({ phases, final: s.phase, pcts })
          })
        }),
    )
    expect(seen.final).toBe('ready')
    expect(seen.phases).toEqual(['downloading', 'verifying', 'ready'])
    // 进度一路往上
    expect(seen.pcts.length).toBeGreaterThan(3)
    expect([...seen.pcts].sort((a, b) => a - b)).toEqual(seen.pcts)
    expect(await page.evaluate(() => window.cn.llmStatus())).toMatchObject({ phase: 'ready', model: 'qwen3-4b-2507-q4km', dir: join(tmp, 'llm') })
  } finally {
    await run.close()
  }
})

// 交付图：CN_SHOTS=<目录> 时才跑
test('交付图：四种状态，浅色天青、深色深湖', async () => {
  test.skip(!process.env.CN_SHOTS, '只在 CN_SHOTS 给了时截图')
  test.setTimeout(240_000)
  const out = process.env.CN_SHOTS!
  mkdirSync(out, { recursive: true })
  for (const [name, skin] of [
    ['light', { skin: 'sky', dark: false }],
    ['dark', { skin: 'petrol', dark: true }],
  ] as const) {
    rmSync(join(tmp, 'llm'), { recursive: true, force: true })
    const run = await start({ CN_FAKE_LLM_MS: '12000' }, skin)
    const { page } = run
    try {
      await page.setViewportSize({ width: 1280, height: 860 })
      await openCard(page)
      const c = card(page)
      const shot = (s: string) => c.screenshot({ path: join(out, `${name}-${s}.png`) })
      const area = async (s: string) => {
        const box = (await c.boundingBox())!
        await page.screenshot({ path: join(out, `${name}-${s}-page.png`), clip: { x: box.x - 40, y: box.y - 300, width: box.width + 80, height: box.height + 340 } })
      }
      await shot('1-missing')
      await area('1-missing')
      await c.getByTestId('llm-download').click()
      await expect.poll(async () => Number(/(\d+)%/.exec((await c.getByTestId('llm-progress').textContent()) ?? '')?.[1] ?? 0), { timeout: 15_000 }).toBeGreaterThan(30)
      await shot('2-downloading')
      await area('2-downloading')
      await c.getByTestId('llm-cancel').click()
      await expect(c.getByTestId('llm-download')).toHaveText('继续下载')
      await shot('3-partial')
      await page.evaluate(() => window.cn.llmDownload())
      await expect(c).toHaveAttribute('data-phase', 'ready')
      await shot('4-ready')
      await area('4-ready')
    } finally {
      await run.close()
    }
  }
})
