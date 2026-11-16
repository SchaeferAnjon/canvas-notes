import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const { askWithImage } = await import('../src/main/mindmap/vision')
const { forAi, isHeic, stagePhoto } = await import('../src/main/mindmap/photo')

const fixture = (f: string) => join(__dirname, 'fixtures', f)
const PHOTO = join(__dirname, '../e2e/fixtures/handwritten-map.jpg')
const dir = mkdtempSync(join(tmpdir(), 'cn-photo-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('让 Claude Code 看照片', () => {
  it('图和话放在一条 stream-json 用户消息里；不给工具', async () => {
    const answer = await askWithImage({
      exe: process.execPath,
      prefix: [fixture('fake-claude-vision.mjs')],
      cwd: dir,
      system: '系统',
      prompt: '认这张照片里的思维导图。',
      image: { mime: 'image/jpeg', base64: Buffer.from([1, 2, 3, 4]).toString('base64') },
      signal: new AbortController().signal,
    })
    expect(JSON.parse(answer)).toEqual({ inputFormat: 'stream-json', tools: '', role: 'user', image: 'image', mime: 'image/jpeg', bytes: 4, prompt: '认这张照片里的思维导图。' })
  })

  it('停下、超时', async () => {
    const ac = new AbortController()
    const run = (signal: AbortSignal, timeoutMs?: number) =>
      askWithImage({ exe: process.execPath, prefix: [fixture('fake-claude-vision.mjs')], cwd: dir, system: '', prompt: '', image: { mime: 'image/png', base64: '' }, signal, timeoutMs })
    process.env.FAKE_VISION_HANG = '1'
    try {
      const p = run(ac.signal)
      setTimeout(() => ac.abort(), 200)
      await expect(p).rejects.toMatchObject({ name: 'AbortError' })
      await expect(run(new AbortController().signal, 300)).rejects.toThrow(/三分钟/)
    } finally {
      delete process.env.FAKE_VISION_HANG
    }
  })
})

describe('照片暂存', () => {
  it('JPEG 原样存；不是图、空的说清楚', async () => {
    const s = await stagePhoto(dir, new Uint8Array(readFileSync(PHOTO)))
    expect(s.mime).toBe('image/jpeg')
    expect(readFileSync(s.file).equals(readFileSync(PHOTO))).toBe(true)
    await expect(stagePhoto(dir, new Uint8Array([1, 2, 3]))).rejects.toThrow('这不是照片')
    await expect(stagePhoto(dir, new Uint8Array())).rejects.toThrow('照片是空的')
  })

  it('iPhone 的 HEIC 转成 JPEG；给 AI 的缩到长边 1600 以内', async () => {
    const heic = join(dir, 'a.heic')
    execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', PHOTO, '--out', heic])
    const bytes = new Uint8Array(readFileSync(heic))
    expect(isHeic(bytes)).toBe(true)
    const s = await stagePhoto(dir, bytes)
    expect(s.ext).toBe('jpg')
    const head = readFileSync(s.file).subarray(0, 3)
    expect([...head]).toEqual([0xff, 0xd8, 0xff])
    const ai = await forAi(s.file, dir)
    expect(ai.mime).toBe('image/jpeg')
    expect(Buffer.from(ai.base64, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
  })
})
