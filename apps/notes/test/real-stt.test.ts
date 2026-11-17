// 真的生成一次字幕（要联网、花钱：一段 19 秒的公开视频，Soniox 约 $0.0005）：CN_REAL_STT=1 才跑。
// 用包里带的 yt-dlp（scripts/fetch-ytdlp.mjs 下好）只下音频，交给真的 Soniox 听写；密钥用环境变量 SONIOX_API_KEY。
// CN_REAL_STT=1 npx vitest run apps/notes/test/real-stt.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloadAudio, findYtDlp, mainLanguage, sonioxTranscribe, tokensToCues } from '../src/main/video/transcribe'

/** YouTube 第一个视频「Me at the zoo」，19 秒，英语 */
const URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'

describe.skipIf(process.env.CN_REAL_STT !== '1')('真的生成字幕', () => {
  it('下音频 → Soniox 听写 → 断成几句英文，时间在 0 到 20 秒之间', async () => {
    const key = process.env.SONIOX_API_KEY
    if (!key) throw new Error('要环境变量 SONIOX_API_KEY')
    const bin = findYtDlp(join(__dirname, '../resources/bin/yt-dlp'))!
    const dir = mkdtempSync(join(tmpdir(), 'cn-real-stt-'))
    try {
      const t0 = Date.now()
      const audio = await downloadAudio({ url: URL, dir, bin, signal: new AbortController().signal })
      const t1 = Date.now()
      const tokens = await sonioxTranscribe(audio, { key, signal: new AbortController().signal })
      const cues = tokensToCues(tokens)
      console.log(`下载 ${t1 - t0} ms，听写 ${Date.now() - t1} ms，${tokens.length} 段 → ${cues.length} 句：`, cues.map((c) => `${c.start.toFixed(1)} ${c.text}`))
      expect(mainLanguage(tokens)).toBe('en')
      expect(cues.length).toBeGreaterThan(1)
      expect(cues.map((c) => c.text).join(' ')).toMatch(/elephant/i)
      expect(cues.every((c) => c.start >= 0 && c.end <= 21 && c.end >= c.start)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
