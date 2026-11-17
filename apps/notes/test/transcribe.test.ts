// 没字幕的视频生成字幕（CN-69）：yt-dlp 只下音频、Soniox 异步听写（假的本机服务）、断句、存成 WebVTT 再读回来
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cuesToVtt, downloadAudio, mainLanguage, parseVtt, sonioxTranscribe, sttPath, tokensToCues } from '../src/main/video/transcribe'
import { type FakeSoniox, startFakeSoniox, STT_LINES, sttTokens } from '../e2e/fixtures/fake-soniox'

const FAKE_YTDLP = join(__dirname, '../e2e/fixtures/fake-ytdlp.mjs')

describe('断句', () => {
  it('中文一个字一段：句号问号处断成一句，时间是第一个字到最后一个字', () => {
    const cues = tokensToCues(sttTokens())
    expect(cues.map((c) => c.text)).toEqual(STT_LINES)
    expect(cues[1]).toMatchObject({ start: 3 })
    expect(cues[1]!.end).toBeCloseTo(3 + 2.6 * ([...STT_LINES[1]!].length - 1) / [...STT_LINES[1]!].length + 0.1, 1)
    expect(mainLanguage(sttTokens())).toBe('zh')
  })
  it('英文半个词一段：拼回空格；停顿超过 0.8 秒也断；太长在逗号处断', () => {
    const t = (text: string, s: number) => ({ text, start_ms: s, end_ms: s + 200, language: 'en' })
    const toks = [t('Hel', 0), t('lo', 200), t(' world', 400), t(' again', 2000), t('.', 2200), t(' A', 3000), ...Array.from({ length: 40 }, (_, i) => t(i === 30 ? ' word,' : ' word', 3200 + i * 100)), t(' end', 7400)]
    const cues = tokensToCues(toks)
    expect(cues[0]).toEqual({ start: 0, end: 0.6, text: 'Hello world' })
    expect(cues[1]).toMatchObject({ text: 'again.', start: 2 })
    expect(cues.some((c) => c.text.endsWith('word,'))).toBe(true)
    expect(cues.slice(2).every((c) => c.text.length <= 100)).toBe(true)
    // 硬断不拆开半个词（真 Soniox 给过「reall」「y」两段）
    const long = [t('A', 0), ...Array.from({ length: 13 }, (_, i) => t(' really', 100 + i * 100)), t(' reall', 1400), t('y', 1500), t(' long', 1600)]
    expect(tokensToCues(long).every((c) => !/reall$/.test(c.text) && !/^y\b/.test(c.text))).toBe(true)
    // 半个词中间停了一下也不拆
    expect(tokensToCues([t('They', 0), t(' reall', 200), t('y', 1500), t(' are', 1700)]).map((c) => c.text)).toEqual(['They really are'])
  })
})

describe('WebVTT', () => {
  it('写出来再读回来一样；开头记语言和来源', () => {
    const cues = tokensToCues(sttTokens())
    const vtt = cuesToVtt(cues, { lang: 'zh', source: 'soniox' })
    expect(vtt.startsWith('WEBVTT\n\nNOTE lang=zh source=soniox\n\n00:00:00.000 --> 00:00:')).toBe(true)
    const back = parseVtt(vtt)
    expect(back.lang).toBe('zh')
    expect(back.cues.map((c) => c.text)).toEqual(STT_LINES)
    expect(back.cues[1]!.start).toBe(3)
    expect(sttPath({ site: 'youtube', id: 'abc' })).toBe('.canvas-notes/字幕/youtube-abc.vtt')
    expect(sttPath({ site: 'bilibili', id: 'BV1', p: 2 })).toBe('.canvas-notes/字幕/bilibili-BV1-p2.vtt')
  })
})

describe('下载音频（假的 yt-dlp）', () => {
  let dir: string
  beforeAll(() => {
    chmodSync(FAKE_YTDLP, 0o755)
    dir = mkdtempSync(join(tmpdir(), 'cn-stt-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  it('只要音频、给出下好的文件；出错时说 yt-dlp 的原话', async () => {
    const f = await downloadAudio({ url: 'https://www.youtube.com/watch?v=abcdefghijk', dir, bin: FAKE_YTDLP, signal: new AbortController().signal })
    expect(f).toBe(join(dir, 'audio.m4a'))
    await expect(downloadAudio({ url: 'https://www.youtube.com/watch?v=fail', dir: mkdtempSync(join(tmpdir(), 'cn-stt-')), bin: FAKE_YTDLP, signal: new AbortController().signal })).rejects.toThrow('音频没下载下来：[youtube] fail: Video unavailable')
  })
  it('B 站分到腾讯 EdgeOne 那家 CDN（不带 Range 回 567）：分段下，照样下得下来', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cn-stt-'))
    try {
      const f = await downloadAudio({ url: 'https://www.bilibili.com/video/BV1edgeone00?cdn=edgeone', dir: d, bin: FAKE_YTDLP, signal: new AbortController().signal })
      expect(f).toBe(join(d, 'audio.m4a'))
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})

describe('Soniox 听写（本机假服务）', () => {
  let fake: FakeSoniox
  let dir: string
  beforeAll(async () => {
    fake = await startFakeSoniox()
    dir = mkdtempSync(join(tmpdir(), 'cn-stt-'))
    await downloadAudio({ url: 'x', dir, bin: FAKE_YTDLP, signal: new AbortController().signal })
  })
  afterAll(() => {
    fake.server.close()
    rmSync(dir, { recursive: true, force: true })
  })
  it('上传 → 建转写 → 等完成 → 取结果 → 删掉云端的转写和文件', async () => {
    const tokens = await sonioxTranscribe(join(dir, 'audio.m4a'), { key: 'test-soniox-key', base: fake.base, signal: new AbortController().signal, pollMs: 10 })
    expect(tokensToCues(tokens).map((c) => c.text)).toEqual(STT_LINES)
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/files',
      'POST /v1/transcriptions',
      'GET /v1/transcriptions/tr-1',
      'GET /v1/transcriptions/tr-1',
      'GET /v1/transcriptions/tr-1/transcript',
      'DELETE /v1/transcriptions/tr-1',
      'DELETE /v1/files/file-1',
    ])
    expect(fake.requests.every((r) => r.auth === 'Bearer test-soniox-key')).toBe(true)
  })
  it('密钥不对：说「到设置 › AI 里重新填」', async () => {
    await expect(sonioxTranscribe(join(dir, 'audio.m4a'), { key: 'wrong-key-123', base: fake.base, signal: new AbortController().signal })).rejects.toThrow('Soniox 密钥不对：到设置 › AI 里重新填')
  })
  it('连不上 Soniox：原话前面带「连不上 Soniox」和系统给的原因（界面据此说是网络问题）', async () => {
    // 端口 9 fetch 直接拒（bad port），和评审用的地址一样；再试一个关掉的端口（连接被拒）
    await expect(sonioxTranscribe(join(dir, 'audio.m4a'), { key: 'test-soniox-key', base: 'http://127.0.0.1:9', signal: new AbortController().signal })).rejects.toThrow(/^连不上 Soniox：fetch failed \(bad port\)$/)
    const srv = createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as AddressInfo).port
    await new Promise((r) => srv.close(r))
    await expect(sonioxTranscribe(join(dir, 'audio.m4a'), { key: 'test-soniox-key', base: `http://127.0.0.1:${port}`, signal: new AbortController().signal })).rejects.toThrow(/^连不上 Soniox：fetch failed \(ECONNREFUSED\)$/)
  })
})
