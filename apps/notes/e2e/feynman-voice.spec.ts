// 费曼学习的语音输入（设计页第 2 节 21、22 两张图，task-yvabi）：真点麦克风。
// 麦克风是 Chromium 的假麦克风，放 fixtures/voice-zh.wav（`say -v Tingting` 念的一句中文，16 kHz 单声道）；
// Soniox 是本机假的实时听写（fixtures/fake-soniox-rt.ts，端口系统挑），按收到的声音一个字一个字地出，没定的最多 3 个字。
// 费曼那一列（feynman-board）做好前，测的是测试模式才有的「语音输入试验框」（renderer/voice/demo.tsx，照费曼回答框搭）。
import { expect, type Page, test } from '@playwright/test'
import { join } from 'node:path'
import { launch, type Running } from './app'
import { FAKE_RT_KEY, FAKE_RT_TEXT, type FakeSonioxRt, startFakeSonioxRt } from './fixtures/fake-soniox-rt'
import { shotPart, shotTone } from './shots'

const WAV = join(__dirname, 'fixtures/voice-zh.wav')
let fake: FakeSonioxRt

test.beforeAll(async () => {
  fake = await startFakeSonioxRt({ bytesPerChar: 4800 })
})
test.afterAll(async () => {
  await fake.close()
})
test.beforeEach(() => {
  fake.opts.dropAfterChars = undefined
})

const env = (more: Record<string, string> = {}) => ({ CN_SONIOX_RT_URL: fake.url, SONIOX_API_KEY: FAKE_RT_KEY, CN_FAKE_AUDIO: WAV, ...more })

async function open(more: Record<string, string> = {}): Promise<Running> {
  const run = await launch({ 'a.md': '# a\n' }, env(more))
  await shotTone(run.page)
  // 设计复审要的另一套主题（比如深湖 petrol）：CN_VOICE_SKIN=petrol
  if (process.env.CN_VOICE_SKIN) {
    await run.page.evaluate((skin) => window.cn.setSettings({ appearance: { followSystem: false, skin } }), process.env.CN_VOICE_SKIN)
    await run.page.reload()
    await run.page.locator('.vault b').waitFor()
  }
  await run.page.evaluate(() => (window as unknown as { cnDictDemo: () => void }).cnDictDemo())
  await expect(box(run.page)).toBeVisible()
  return run
}

const box = (page: Page) => page.getByRole('dialog', { name: '语音输入试验框' })
const field = (page: Page) => box(page).getByRole('textbox', { name: '回答' })
const mic = (page: Page) => box(page).locator('.dict-mic')
const bar = (page: Page) => box(page).getByTestId('dict-bar')
const live = (page: Page) => box(page).getByTestId('dict-live')
const note = (page: Page) => box(page).getByTestId('dict-note')
const inp = (page: Page) => box(page).locator('.dict-demo-inp')
/** 截一张试验框：鼠标先挪开，不拍到按钮的悬停底色；文件名带上主题 */
async function shot(page: Page, name: string) {
  await page.mouse.move(2, 2)
  await shotPart(box(page), process.env.CN_VOICE_SKIN ? `${name}-${process.env.CN_VOICE_SKIN}` : name)
}
const liveParts = (page: Page) =>
  live(page).evaluate((el) => ({ fin: el.querySelector('.fin')!.textContent!, int: el.querySelector('.int')!.textContent! }))

test('点一下开始、再点一下停：框红边、顶上听写中 · Soniox 和音量条用时，灰字变黑接在打的字后面；停了字留在框里、光标在末尾能直接改，一按键提示就收起', async () => {
  const run = await open()
  const { page } = run
  try {
    await field(page).click()
    await page.keyboard.type('先打几个字：')
    await mic(page).click()
    await expect(bar(page)).toContainText('听写中 · Soniox')
    await expect(bar(page)).toContainText('再点一下停')
    await expect(inp(page)).toHaveClass(/dict-rec/)
    // 红边真画出来了（不被框自己的灰边盖掉）：边框色就是 --red-t
    const [border, red] = await inp(page).evaluate((el) => {
      const probe = el.appendChild(document.createElement('i'))
      probe.style.color = 'var(--red-t)'
      const r = [getComputedStyle(el).borderTopColor, getComputedStyle(probe).color]
      probe.remove()
      return r
    })
    expect(border).toBe(red)
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(field(page)).toBeHidden()
    // 灰字：没定的几个字
    await expect.poll(async () => (await liveParts(page)).int.length, { timeout: 10_000 }).toBeGreaterThan(0)
    const first = await liveParts(page)
    const said1 = first.fin + first.int
    expect(FAKE_RT_TEXT.startsWith(said1)).toBe(true)
    // 灰的和黑的颜色不一样
    const colors = await live(page).evaluate((el) => [getComputedStyle(el.querySelector('.fin')!).color, getComputedStyle(el.querySelector('.int')!).color])
    expect(colors[0]).not.toBe(colors[1])
    // 刚才灰的那几个字后来都定下来（黑）
    await expect.poll(async () => (await liveParts(page)).fin.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(said1.length)
    expect((await liveParts(page)).fin.startsWith(said1)).toBe(true)
    // 开始前打的字在前面
    await expect(live(page)).toContainText('先打几个字：' + said1)
    // 强调色光标跟在灰字后面
    expect(await live(page).evaluate((el) => { const c = el.querySelector('.dict-caret') as HTMLElement; return [c.previousElementSibling?.className, c.getBoundingClientRect().width > 0] })).toEqual(['int', true])
    // 音量条动了（假麦克风真在送那句话）、用时在走
    await expect.poll(() => bar(page).locator('.dict-lv i').evaluateAll((els) => Math.max(...els.map((e) => (e as HTMLElement).offsetHeight))), { timeout: 5_000 }).toBeGreaterThan(5)
    await expect(bar(page).locator('.dict-tm')).toHaveText(/^0:0[1-9]$/, { timeout: 5_000 })
    await expect.poll(async () => (await liveParts(page)).fin.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(8)
    await shot(page, '21-说的时候')

    await mic(page).click()
    await expect(bar(page)).toBeHidden()
    await expect(field(page)).toBeVisible()
    await expect(inp(page)).not.toHaveClass(/dict-rec/)
    const v = await field(page).inputValue()
    expect(v.startsWith('先打几个字：' + FAKE_RT_TEXT.slice(0, 8))).toBe(true)
    expect(FAKE_RT_TEXT.startsWith(v.slice('先打几个字：'.length))).toBe(true)
    await expect(note(page)).toHaveText('听写好了：能直接改，改好了再发')
    // 光标在末尾、焦点在框里：直接打字接着改
    expect(await field(page).evaluate((el: HTMLTextAreaElement) => [document.activeElement === el, el.selectionStart, el.selectionEnd])).toEqual([true, v.length, v.length])
    await shot(page, '22-说完能改')
    await page.keyboard.press('Backspace')
    await expect(note(page)).toBeHidden()
    await page.keyboard.type('。')
    await expect(field(page)).toHaveValue(v.slice(0, -1) + '。')
    // 假 Soniox 那边：密钥在头里、配置对、收到了有声音的音频、说完发了空帧
    const c = fake.conns.at(-1)!
    expect(c.auth).toBe(`Bearer ${FAKE_RT_KEY}`)
    expect(c.config).toMatchObject({ model: 'stt-rt-v6', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1, enable_endpoint_detection: true, context: { terms: ['范数', '向量', '三角不等式'] } })
    expect(c.loud).toBe(true)
    expect(c.ended).toBe(true)
  } finally {
    await run.close()
  }
})

test('按住说、松手停（按住超过半秒）；光标在字中间时说的接在光标处', async () => {
  const run = await open()
  const { page } = run
  try {
    await field(page).fill('甲乙')
    await field(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1, 1))
    const b = (await mic(page).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await expect(bar(page)).toContainText('松手停', { timeout: 3_000 })
    await expect.poll(async () => (await liveParts(page)).fin.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3)
    await page.mouse.up()
    await expect(bar(page)).toBeHidden()
    const v = await field(page).inputValue()
    expect(v.startsWith('甲' + FAKE_RT_TEXT.slice(0, 3))).toBe(true)
    expect(v.endsWith('乙')).toBe(true)
    // 光标停在说的字末尾（乙前面）
    expect(await field(page).evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(v.length - 1)
    expect(fake.conns.at(-1)!.ended).toBe(true)

    // 短按（点一下）不算按住：松手后还在听写，再点一下才停
    await mic(page).click()
    await page.waitForTimeout(800)
    await expect(bar(page)).toContainText('再点一下停')
    await mic(page).click()
    await expect(bar(page)).toBeHidden()
  } finally {
    await run.close()
  }
})

test('说的时候点「讲完了」：先停下听写、等最后的字定稿，再发出去', async () => {
  const run = await open()
  const { page } = run
  try {
    await mic(page).click()
    await expect.poll(async () => (await liveParts(page)).fin.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(4)
    await box(page).getByRole('button', { name: /讲完了/ }).click()
    const sent = box(page).getByTestId('dict-sent')
    await expect(sent).toHaveCount(1)
    const text = await sent.textContent()
    // 发出去的是定稿后的整段（没定的灰字也定下来了），框空了、听写停了
    expect(text!.length).toBeGreaterThanOrEqual(4)
    expect(FAKE_RT_TEXT.startsWith(text!)).toBe(true)
    await expect(bar(page)).toBeHidden()
    await expect(field(page)).toHaveValue('')
    expect(fake.conns.at(-1)!.ended).toBe(true)
  } finally {
    await run.close()
  }
})

test('说到一半网断了：说人话、已经说出来的字留在框里能改', async () => {
  const run = await open()
  const { page } = run
  try {
    fake.opts.dropAfterChars = 5
    await mic(page).click()
    await expect(note(page)).toHaveText('网络断了，听写停了；说过的字都在框里', { timeout: 10_000 })
    await expect(note(page).locator('.dict-msg')).toHaveAttribute('title', /连接断了/)
    await expect(bar(page)).toBeHidden()
    await expect(field(page)).toHaveValue(FAKE_RT_TEXT.slice(0, 5))
    await shot(page, '24-断线')
    await page.keyboard.type('X')
    await expect(note(page)).toBeHidden()
    await expect(field(page)).toHaveValue(FAKE_RT_TEXT.slice(0, 5) + 'X')
  } finally {
    await run.close()
  }
})

test('没填 Soniox 密钥：麦克风还在，点了出「先在设置里填 Soniox 密钥 →」，点了跳到设置那一行（说明改成两处都用）；填错的密钥说密钥不对，填对了就能说', async () => {
  const run = await open({ SONIOX_API_KEY: '' })
  const { page } = run
  try {
    await expect(mic(page)).toBeVisible()
    await mic(page).click()
    await expect(note(page)).toHaveText('先在设置里填 Soniox 密钥 →')
    await expect(bar(page)).toBeHidden()
    await expect(field(page)).toBeVisible()
    await shot(page, '23-没密钥')
    await note(page).getByRole('button', { name: '先在设置里填 Soniox 密钥 →' }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    const keyBox = dialog.getByRole('textbox', { name: 'Soniox 密钥' })
    await expect(keyBox).toBeInViewport()
    await expect(dialog.locator('[data-row="soniox"]')).toContainText('生成字幕和费曼的语音输入都用它')
    await keyBox.fill('wrong-key')
    await keyBox.press('Enter')
    await expect(dialog.getByTestId('stt-key-state')).toContainText('已填')
    await page.keyboard.press('Meta+,')
    await expect(dialog).toBeHidden()

    await mic(page).click()
    await expect(note(page)).toContainText('Soniox 密钥不对或过期了，听写停了', { timeout: 10_000 })
    await expect(note(page).locator('.dict-msg')).toHaveAttribute('title', /401/)
    await expect(note(page).getByRole('button', { name: '到设置里换一个 →' })).toBeVisible()

    await note(page).getByRole('button', { name: '到设置里换一个 →' }).click()
    await keyBox.fill(FAKE_RT_KEY)
    await keyBox.press('Enter')
    await expect(dialog.getByTestId('stt-key-state')).toContainText('-key')
    await page.keyboard.press('Meta+,')
    await mic(page).click()
    await expect.poll(async () => (await liveParts(page)).fin.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    await mic(page).click()
    await expect(note(page)).toHaveText('听写好了：能直接改，改好了再发')
  } finally {
    await run.close()
  }
})

test('系统设置里没给麦克风权限：说清去哪里开，「打开系统设置 →」打开麦克风那一页', async () => {
  const run = await open({ CN_E2E_MIC: 'denied' })
  const { page, app } = run
  try {
    await mic(page).click()
    await expect(note(page)).toContainText('没有麦克风权限，听不到你说话')
    await expect(note(page).locator('.dict-msg')).toHaveAttribute('title', '系统设置 › 隐私与安全性 › 麦克风，打开 Canvas Notes')
    await shot(page, '25-没麦克风权限')
    await note(page).getByRole('button', { name: '打开系统设置 →' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('\n'))).toContain('Privacy_Microphone')
  } finally {
    await run.close()
  }
})
