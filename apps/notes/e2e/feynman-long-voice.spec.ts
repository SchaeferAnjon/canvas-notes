// 费曼「聊到底」里的连着说（design/feynman-long/notes.md 第 7 节，task-l97l4 第③条线）：真点麦克风。
// 麦克风是 Chromium 的假麦克风（fixtures/voice-zh.wav，循环放），Soniox 是本机假的实时听写（fixtures/fake-soniox-rt.ts，端口系统挑，
// 每一段连接从头「听」出 FAKE_RT_TEXT 那一句，说完就不再出新字），AI 是 CN_AI_FAKE 的假学生（CN_FAKE_FEYNMAN_MS 假装想多久）。
// 白板里直接写一节带 "mode":"long" 的费曼注释（还没开讲），点「开始讲」。
// CN_FY_LONG_SHOTS=<目录> 时截图（07-连着说、08-听写停一下、09-没声音停了），CN_FY_LONG_SKIN=petrol 换深湖、文件名加 -petrol。
import { expect, type Locator, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addRound, findRounds } from '../src/shared/feynman/doc'
import { fakeExtract } from '../src/shared/feynman/fake'
import { parseExtract } from '../src/shared/feynman/prompts'
import { newMeta } from '../src/shared/feynman/round'
import { launch, pane, type Running } from './app'
import { openBoard } from './fixtures/board-doc'
import { FAKE_RT_KEY, FAKE_RT_TEXT, type FakeSonioxRt, startFakeSonioxRt } from './fixtures/fake-soniox-rt'

const WAV = join(__dirname, 'fixtures/voice-zh.wav')
const PATH = '课程/范数白板.md'
const SHOTS = process.env.CN_FY_LONG_SHOTS
const SKIN = process.env.CN_FY_LONG_SKIN

let fake: FakeSonioxRt
test.beforeAll(async () => {
  fake = await startFakeSonioxRt({ bytesPerChar: 4800 })
})
test.afterAll(async () => {
  await fake.close()
})

/** 一块白板，文末一节还没开讲的「费曼 · 范数」；long：聊到底 */
function files(long: boolean): Record<string, string> {
  const p = parseExtract(fakeExtract('', { scope: 'point', topic: '范数' }))[0]!
  const m = newMeta({ topic: p.topic, scope: 'point', points: p.points, myths: p.myths, from: [{ kind: 'word', word: '范数' }], cover: [], basisLine: '', by: 'Claude Code · Opus 5.5' }, { today: '2026-11-24', id: 'f-voice' })
  const board = '---\ntype: board\n---\n# 范数白板\n\n## 范数\n\n> 范数表示一个向量有多大，不涉及维度，只看分量的大小。\n'
  return { [PATH]: addRound(board, { ...m, status: 'draft', ...(long ? { mode: 'long' as const } : {}) }) }
}

async function open(long: boolean, env: Record<string, string> = {}): Promise<Running> {
  const run = await launch(files(long), { CN_AI_FAKE: '1', CN_FAKE_FEYNMAN_MS: '3000', CN_SONIOX_RT_URL: fake.url, SONIOX_API_KEY: FAKE_RT_KEY, CN_FAKE_AUDIO: WAV, ...env })
  const { page } = run
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  if (SHOTS) {
    await page.evaluate((skin) => window.cn.setSettings({ appearance: { followSystem: false, skin } }), SKIN ?? 'mint')
    await page.reload()
    await page.locator('.vault b').waitFor()
  }
  await openBoard(page, '范数白板')
  await expect(col(page)).toBeVisible()
  await col(page).getByTestId('fy-begin').click()
  await expect(answer(page)).toBeVisible()
  return run
}

const col = (page: Page) => pane(page).getByTestId('fy-col')
const answer = (page: Page) => col(page).getByTestId('fy-answer')
const field = (page: Page) => answer(page).locator('textarea')
const mic = (page: Page) => answer(page).locator('.dict-mic')
const bar = (page: Page) => answer(page).getByTestId('dict-bar')
const live = (page: Page) => answer(page).getByTestId('dict-live')
const note = (page: Page) => answer(page).getByTestId('dict-note')
const fin = (page: Page) => live(page).locator('.fin').textContent()
const said = (page: Page) => live(page).evaluate((el) => el.querySelector('.fin')!.textContent! + el.querySelector('.int')!.textContent!)
const mine = (run: Running) => findRounds(readFileSync(join(run.vault, PATH), 'utf8'))[0]!.entries.filter((e) => e.kind === 'me').map((e) => e.text)
const meOnBoard = (c: Locator) => c.getByTestId('fy-mine')

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
  await col(page).screenshot({ path: join(SHOTS, `${name}${SKIN ? '-' + SKIN : ''}.png`) })
}

test('聊到底点一下麦克风是连着说：⌘↵ 发出去听写不停；学生在想时听写停一下、字不进框；问完接着听，新字进下一轮的框；esc 先停听写（列不暂停），再按才暂停', async () => {
  test.setTimeout(150_000)
  const run = await open(true, { CN_FAKE_FEYNMAN_MS: '6000' })
  const { page } = run
  try {
    const conns0 = fake.conns.length
    await mic(page).click()
    // 左边只写「听写中」，右边「⌘↵ 发这一轮 · esc 停」整句不截
    await expect(bar(page).locator(':scope > span').first()).toHaveText('听写中')
    await expect(bar(page).locator('.dict-hint')).toHaveText('⌘↵ 发这一轮 · esc 停')
    expect(
      await bar(page).evaluate((b) => {
        const h = b.querySelector<HTMLElement>('.dict-hint')!
        return h.scrollWidth <= h.clientWidth && h.getBoundingClientRect().right <= b.getBoundingClientRect().right
      }),
    ).toBe(true)
    await expect(answer(page)).toHaveClass(/dict-rec/)
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'true')
    // 条上只有点是红的：字 --t2、右边 --t3；框边 --red-t
    const look = await answer(page).evaluate((el) => {
      const probe = (v: string) => {
        const i = el.appendChild(document.createElement('i'))
        i.style.color = `var(${v})`
        const c = getComputedStyle(i).color
        i.remove()
        return c
      }
      const b = el.querySelector('.dict-bar')!
      return {
        text: getComputedStyle(b).color,
        hint: getComputedStyle(b.querySelector('.dict-hint')!).color,
        dot: getComputedStyle(b.querySelector('.dict-dot')!).backgroundColor,
        border: getComputedStyle(el).borderTopColor,
        t2: probe('--t2'),
        t3: probe('--t3'),
        red: probe('--red-t'),
      }
    })
    expect(look).toMatchObject({ text: look.t2, hint: look.t3, dot: look.red, border: look.red })
    await expect.poll(async () => ((await fin(page)) ?? '').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(8)
    await shot(page, '07-连着说')

    // ⌘↵：这一段定稿发出去，听写不停（条还在、麦克风还按着），学生在想时停一下
    await page.keyboard.press('Meta+Enter')
    await expect(col(page).getByTestId('fy-thinking')).toBeVisible()
    await expect(bar(page)).toContainText('听写停一下 · 等它问完')
    await expect(bar(page)).toHaveAttribute('data-held', '')
    // esc 这时先停听写：右边写「esc 停听写」，「学生在想…」那行不出「停下 esc」
    await expect(bar(page).locator('.dict-hint')).toHaveText('esc 停听写')
    await expect(col(page).getByTestId('fy-thinking')).not.toContainText('停下 esc')
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(field(page)).toBeDisabled()
    await expect(field(page)).toHaveValue('')
    await expect(answer(page)).not.toHaveClass(/dict-rec/)
    await expect.poll(() => mine(run).length, { timeout: 8_000 }).toBe(1)
    const sent = mine(run)[0]!
    expect(sent.length).toBeGreaterThanOrEqual(8)
    expect(FAKE_RT_TEXT.startsWith(sent)).toBe(true)
    await expect(meOnBoard(col(page)).first()).toContainText(sent)
    // 这一段收了尾（发了说完的空帧）；想的这会儿（学生想 6 秒）麦克风关着：不再连 Soniox、框里没字
    expect(fake.conns[conns0]!.ended).toBe(true)
    const connsHeld = conns0 + 1
    await shot(page, '08-听写停一下')
    await page.waitForTimeout(1_000)
    await expect(col(page).getByTestId('fy-thinking')).toBeVisible()
    expect(fake.conns.length).toBe(connsHeld)
    await expect(field(page)).toHaveValue('')

    // 问完：自动接着听，新连一段，说的字进下一轮的框（从头，不带上一轮的字）
    await expect(col(page).getByTestId('fy-thinking')).toBeHidden({ timeout: 15_000 })
    await expect(bar(page)).not.toHaveAttribute('data-held', '', { timeout: 10_000 })
    await expect(bar(page).locator(':scope > span').first()).toHaveText('听写中')
    await expect.poll(() => fake.conns.length, { timeout: 10_000 }).toBe(connsHeld + 1)
    await expect.poll(async () => ((await fin(page)) ?? '').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4)
    const now = await said(page)
    expect(FAKE_RT_TEXT.startsWith(now)).toBe(true)
    await expect(live(page)).not.toContainText(sent + FAKE_RT_TEXT.slice(0, 2))
    expect(mine(run).length).toBe(1)

    // esc：先停听写，字留在框里，列不暂停
    await page.keyboard.press('Escape')
    await expect(bar(page)).toBeHidden({ timeout: 10_000 })
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(field(page)).toBeEnabled()
    const kept = await field(page).inputValue()
    expect(kept.length).toBeGreaterThanOrEqual(4)
    expect(FAKE_RT_TEXT.startsWith(kept)).toBe(true)
    await expect(col(page)).toHaveAttribute('data-status', 'talking')
    await expect(col(page).getByTestId('fy-paused')).toHaveCount(0)
    expect(fake.conns.at(-1)!.ended).toBe(true)
    // 停了以后不会自己再连
    const connsStop = fake.conns.length
    await page.waitForTimeout(800)
    expect(fake.conns.length).toBe(connsStop)
    // 再按一次 esc：照旧暂停这一轮
    await page.keyboard.press('Escape')
    await expect(col(page).getByTestId('fy-paused')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('聊到底：按住说、松手停照旧是一次；点一下连着说，没声音到时长（测试里改短）自动停，框下面「两分钟没声音，听写停了」', async () => {
  test.setTimeout(120_000)
  const run = await open(true, { CN_DICT_IDLE_MS: '1500' })
  const { page } = run
  try {
    // 按住说：「松手停」，松手就停，不连着（回答框在白板下沿外时先滚过去，像人那样；鼠标按的是原始坐标，不会自己滚）
    await mic(page).scrollIntoViewIfNeeded()
    const b = (await mic(page).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await expect(bar(page)).toContainText('松手停', { timeout: 5_000 })
    await expect(bar(page)).toContainText('听写中 · Soniox')
    await expect.poll(async () => ((await fin(page)) ?? '').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3)
    await page.mouse.up()
    await expect(bar(page)).toBeHidden({ timeout: 10_000 })
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'false')
    await expect(note(page)).toHaveText('听写好了：能直接改，改好了再发')
    const v = await field(page).inputValue()
    expect(FAKE_RT_TEXT.startsWith(v)).toBe(true)
    await field(page).fill('')

    // 点一下：连着说；那一句「听」完以后 1.5 秒没新字，自动停
    const conns0 = fake.conns.length
    await mic(page).click()
    await expect(bar(page).locator(':scope > span').first()).toHaveText('听写中')
    await expect.poll(async () => ((await fin(page)) ?? '').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4)
    await expect(note(page)).toHaveText('两分钟没声音，听写停了', { timeout: 20_000 })
    await expect(bar(page)).toBeHidden()
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'false')
    // 说过的那一整句都在框里，能直接改；没自己再连
    await expect(field(page)).toHaveValue(FAKE_RT_TEXT)
    expect(fake.conns.length).toBe(conns0 + 1)
    expect(fake.conns.at(-1)!.ended).toBe(true)
    await shot(page, '09-没声音停了')
    await page.waitForTimeout(800)
    expect(fake.conns.length).toBe(conns0 + 1)
    await expect(col(page)).toHaveAttribute('data-status', 'talking')
    // 听写停了再发：「学生在想…」那行照旧有「停下 esc」
    await col(page).getByTestId('fy-send').click()
    await expect(col(page).getByTestId('fy-thinking')).toContainText('停下 esc')
  } finally {
    await run.close()
  }
})

test('三轮模式：点麦克风还是原来那样，「讲完了」先停听写再发，发了就停，问完不自己接着听', async () => {
  test.setTimeout(120_000)
  const run = await open(false)
  const { page } = run
  try {
    await mic(page).click()
    await expect(bar(page)).toContainText('听写中 · Soniox')
    await expect(bar(page)).toContainText('再点一下停')
    await expect(bar(page)).not.toContainText('连着说')
    await expect.poll(async () => ((await fin(page)) ?? '').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4)
    // 「讲完了」：先停听写、等定稿再发（照旧）
    await col(page).getByTestId('fy-send').click()
    await expect(col(page).getByTestId('fy-thinking')).toBeVisible()
    await expect(answer(page)).toHaveCount(0)
    await expect.poll(() => mine(run).length, { timeout: 8_000 }).toBe(1)
    expect(FAKE_RT_TEXT.startsWith(mine(run)[0]!)).toBe(true)
    const conns = fake.conns.length
    expect(fake.conns.at(-1)!.ended).toBe(true)
    await expect(answer(page)).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1_000)
    await expect(bar(page)).toHaveCount(0)
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'false')
    expect(fake.conns.length).toBe(conns)
    await expect(field(page)).toHaveValue('')
  } finally {
    await run.close()
  }
})
