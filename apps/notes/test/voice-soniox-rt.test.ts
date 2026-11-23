// Soniox 实时听写的客户端（main/voice/soniox-rt.ts）对着本机假服务跑：配置和密钥头对、灰字黑字分得开、说完定稿、
// 密钥错、断线、没回话超时都报成界面认的那几种，不吞。
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_RT_KEY, FAKE_RT_TEXT, type FakeSonioxRt, startFakeSonioxRt } from '../e2e/fixtures/fake-soniox-rt'
import { errorCode, SonioxStream, tidyJoin } from '../src/main/voice/soniox-rt'
import type { DictErrorCode } from '../src/shared/voice-api'

let fake: FakeSonioxRt | null = null
afterEach(async () => {
  await fake?.close()
  fake = null
})

/** 一段「有声音」的 0.1 秒（16 kHz 16 位） */
const loud = () => {
  const a = new Int16Array(1600)
  for (let i = 0; i < a.length; i++) a[i] = Math.round(8000 * Math.sin(i / 5))
  return a.buffer
}

function run(opts: Partial<ConstructorParameters<typeof SonioxStream>[0]> = {}) {
  const got = { final: '', interim: '', seenInterim: [] as string[], error: null as null | { code: DictErrorCode; detail: string } }
  const s = new SonioxStream(
    { url: fake!.url, key: FAKE_RT_KEY, ...opts },
    {
      text(f, i) {
        got.final += f
        got.interim = i
        if (i) got.seenInterim.push(i)
      },
      error(code, detail) {
        got.error = { code, detail }
      },
    },
  )
  return { s, got }
}

describe('Soniox 实时听写', () => {
  it('配置照文档发、密钥在头里；没定的字整段换、定了的接上；说完把剩下的定下来，<fin> 不进字', async () => {
    fake = await startFakeSonioxRt({ bytesPerChar: 3200 })
    const { s, got } = run()
    // 还没连上就送的声音先排着，连上再发
    for (let i = 0; i < 8; i++) s.send(loud())
    await expect.poll(() => got.final.length + got.interim.length).toBe(8)
    expect(got.interim.length).toBe(3)
    await s.finish()
    expect(got.final).toBe(FAKE_RT_TEXT.slice(0, 8))
    expect(got.interim).toBe('')
    expect(got.error).toBeNull()
    const c = fake.conns[0]!
    expect(c.auth).toBe(`Bearer ${FAKE_RT_KEY}`)
    expect(c.config).toMatchObject({ model: 'stt-rt-v6', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1 })
    expect(c.config).not.toHaveProperty('api_key')
    expect(c.ended).toBe(true)
    expect(c.bytes).toBe(8 * 3200)
  })

  it('密钥错：报 auth，原话带上 401', async () => {
    fake = await startFakeSonioxRt()
    const { got } = run({ key: 'wrong' })
    await expect.poll(() => got.error?.code).toBe('auth')
    expect(got.error!.detail).toContain('401')
  })

  it('说到一半连接断了：报 net，已经出来的字还在', async () => {
    fake = await startFakeSonioxRt({ bytesPerChar: 3200, dropAfterChars: 5 })
    const { s, got } = run()
    for (let i = 0; i < 10; i++) s.send(loud())
    await expect.poll(() => got.error?.code).toBe('net')
    expect(got.final + got.interim).toBe(FAKE_RT_TEXT.slice(0, 5))
  })

  it('连不上（端口没人听）：报 net；Soniox 一直不回话：报 timeout', async () => {
    fake = await startFakeSonioxRt({ noPong: true })
    const url = fake.url
    await fake.close()
    fake = null
    let codeA: DictErrorCode | null = null
    const a = new SonioxStream({ url, key: FAKE_RT_KEY }, { text() {}, error: (c) => (codeA = c) })
    await expect.poll(() => codeA).toBe('net')
    a.cancel()

    fake = await startFakeSonioxRt({ noPong: true })
    const { got } = run({ pingMs: 100, silentMs: 400 })
    await expect.poll(() => got.error?.code, { timeout: 3000 }).toBe('timeout')
  })

  it('停顿定稿后下一段开头的空格：中文接中文、一句话开头去掉，英文照留', () => {
    // 2026-11-23 真跑 stt-rt-v6：「…长度是5。」停顿后下一段是「 范数。」
    expect(tidyJoin('长度是5。', ' 范数')).toBe('范数')
    expect(tidyJoin('', ' 范数')).toBe('范数')
    expect(tidyJoin('', ' hello')).toBe('hello')
    expect(tidyJoin('the norm', ' is')).toBe(' is')
    expect(tidyJoin('范数', ' L2')).toBe(' L2')
    expect(tidyJoin('范数', '就是')).toBe('就是')
  })

  it('错误码对照文档', () => {
    expect([401, 402, 403, 408, 429, 500, 503, 400].map(errorCode)).toEqual(['auth', 'quota', 'auth', 'timeout', 'busy', 'server', 'server', 'server'])
  })
})
