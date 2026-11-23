// 真 Soniox 实时听写（费曼的语音输入，task-yvabi），只在 CN_REAL_STT=1 时跑：
//   SONIOX_API_KEY=… CN_REAL_STT=1 npx playwright test e2e/real-feynman-voice.spec.ts
// 假麦克风放 fixtures/voice-zh.wav（`say -v Tingting` 念的「范数就是向量的长度。比如三四这个向量，长度是五。」5.2 秒，后面静音 2.5 秒），
// 点麦克风说 8 秒再点停，看出来的字对不对。一次约 8 秒音频（stt-rt-v6 每小时 $0.12，不到一分钱）。密钥不打印。
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { launch } from './app'

test.skip(process.env.CN_REAL_STT !== '1' || !process.env.SONIOX_API_KEY, '要上网、真听写：CN_REAL_STT=1 且有 SONIOX_API_KEY 才跑')

test('真 Soniox：边说边出字，灰字变黑，停了字留在框里', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_REAL_STT: '1', CN_SONIOX_RT_URL: '', CN_FAKE_AUDIO: join(__dirname, 'fixtures/voice-zh.wav') })
  const { page } = run
  try {
    await page.evaluate(() => (window as unknown as { cnDictDemo: () => void }).cnDictDemo())
    const box = page.getByRole('dialog', { name: '语音输入试验框' })
    await box.locator('.dict-mic').click()
    await expect(box.getByTestId('dict-bar')).toContainText('听写中 · Soniox')
    const seen: { fin: string; int: string; at: number }[] = []
    const t0 = Date.now()
    while (Date.now() - t0 < 8_000) {
      const p = await box.getByTestId('dict-live').evaluate((el) => ({ fin: el.querySelector('.fin')!.textContent!, int: el.querySelector('.int')!.textContent! }))
      if (!seen.length || seen.at(-1)!.fin !== p.fin || seen.at(-1)!.int !== p.int) seen.push({ ...p, at: Date.now() - t0 })
      await page.waitForTimeout(100)
    }
    await box.locator('.dict-mic').click()
    await expect(box.getByTestId('dict-bar')).toBeHidden({ timeout: 15_000 })
    const text = await box.getByRole('textbox', { name: '回答' }).inputValue()
    const note = await box.getByTestId('dict-note').textContent()
    console.log('[真 Soniox] 边说边出（毫秒 · 黑 | 灰）：\n' + seen.map((s) => `${s.at} · ${s.fin} | ${s.int}`).join('\n'))
    console.log('[真 Soniox] 停了以后框里：' + text)
    console.log('[真 Soniox] 下面一行：' + note)
    expect(seen.some((s) => s.int.length > 0)).toBe(true)
    expect(text).toContain('向量的长度')
    expect(note).toBe('听写好了：能直接改，改好了再发')
  } finally {
    await run.close()
  }
})
