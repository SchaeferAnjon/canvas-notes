// 真的让本机 Claude Code 认一张手写导图（要联网、花额度）：CN_REAL_VISION=1 才跑，模型用 CN_MAP_MODEL（默认 haiku，便宜）。
// CN_REAL_VISION=1 npx vitest run apps/notes/test/real-vision.test.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

describe.skipIf(!process.env.CN_REAL_VISION)('真的认一张导图', () => {
  it('认出中心和第一层，框在照片里', async () => {
    const { askWithImage } = await import('../src/main/mindmap/vision')
    const { forAi } = await import('../src/main/mindmap/photo')
    const { findCli } = await import('@cn/ai-engines')
    const { parseRecognition, recognizePrompt, RECOGNIZE_SYSTEM } = await import('../src/shared/mindmap')
    const dir = mkdtempSync(join(tmpdir(), 'cn-vision-'))
    const image = await forAi(join(__dirname, '../e2e/fixtures/handwritten-map.jpg'), dir)
    const t = Date.now()
    const answer = await askWithImage({
      exe: findCli('claude')!,
      cwd: dir,
      system: RECOGNIZE_SYSTEM,
      prompt: recognizePrompt(['线性代数', '概率论']),
      image,
      model: process.env.CN_MAP_MODEL || 'haiku',
      signal: new AbortController().signal,
    })
    const r = parseRecognition(answer)
    console.log(`认了 ${((Date.now() - t) / 1000).toFixed(1)} 秒`, JSON.stringify(r, null, 1))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.roots[0]!.text).toContain('线性映射')
    expect(r.roots[0]!.children.map((c) => c.text).join(' ')).toMatch(/定义.*|矩阵表示|核与像|例子/)
    expect(r.roots[0]!.box).toBeDefined()
  }, 240_000)
})
