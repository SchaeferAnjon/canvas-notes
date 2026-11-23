/**
 * 本地模型真跑（task-h7oy8）：只在给了 CN_LLM_REAL_DIR（放着下好的 GGUF 的目录）时跑，平时跳过。
 * 无头 Electron 里真调 localAsk（node-llama-cpp + Metal，单独的 utilityProcess），问判断题，记下载入秒数、每问秒数、token/s、
 * 回答是不是合法 JSON、判得对不对；CN_LLM_REAL_OUT=<文件> 时把数写进去。CN_LLM_REAL_MODELS=id1,id2 选测哪几个（默认表里全部）。
 *   CN_LLM_REAL_DIR=~/Library/Caches/Canvas\ Notes/llm CN_E2E=1 pnpm exec playwright test e2e/h7oy8-local-llm-real.spec.ts
 */
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { LOCAL_MODELS } from '../src/shared/local-models'
import { launch } from './app'

const DIR = process.env.CN_LLM_REAL_DIR
const MODELS = process.env.CN_LLM_REAL_MODELS?.split(',') ?? LOCAL_MODELS.map((m) => m.id)

const SYSTEM = `你判断笔记之间是不是讲同一件事。只回 JSON，不要别的字。
level 只能是：same-content（讲的是同一件事、内容大半重合）、same-topic（同一个题目，但讲的是不同的方面）、tangential（只沾一点边）、unrelated（不相关）、unsure（拿不准）。
confidence 是 0 到 1 的数。why 用一句中文说理由。quote_a、quote_b 各从两篇里原样摘一句最能说明关系的话（不相关时摘各自的主题句）。`

const A = `# 梯度下降的学习率怎么选
学习率太大，损失会来回震荡甚至发散；太小，收敛很慢，可能卡在平坦的地方。
常见做法：先用一个小的学习率预热（warmup）几百步，再按余弦曲线慢慢降下来。
调的时候先在对数尺度上扫一遍（1e-5 到 1e-1），挑损失下降最快又不发散的那一档。`

const NOTES: Record<string, { text: string; want: string; ok: string[] }> = {
  B: {
    text: `# 第4讲 学习率调度 笔记
老师说：步长（学习率）设大了 loss 会炸，设小了训练慢得要命。
实践里一般先 warmup，让学习率从很小慢慢升上去，然后用 cosine decay 往下降。
找合适的学习率：在 1e-5 到 1e-1 之间按 10 倍一档试，看哪个 loss 降得最快还稳定。`,
    want: 'same-content',
    ok: ['same-content'],
  },
  C: {
    text: `# 周末做红烧肉
五花肉切块冷水下锅焯一下，捞出来擦干。
锅里放一点油和冰糖，小火炒出糖色，下肉翻炒到上色，加生抽老抽和热水，小火炖一个小时。`,
    want: 'unrelated',
    ok: ['unrelated'],
  },
  D: {
    text: `# Adam 优化器是怎么回事
Adam 给每个参数记两样东西：梯度的滑动平均（一阶矩）和梯度平方的滑动平均（二阶矩）。
更新时用一阶矩当方向，用二阶矩的平方根去缩放，所以每个参数的有效步长不一样。
beta1 一般取 0.9，beta2 取 0.999，还要做偏差修正。`,
    want: 'same-topic',
    ok: ['same-topic', 'tangential'],
  },
  E: {
    text: `# 训练时显存不够怎么办
把 batch size 调小，或者用梯度累积凑出大 batch。
开混合精度（fp16 / bf16）能省一半显存。
batch 变了以后学习率也要跟着按比例调一下。`,
    want: 'tangential',
    ok: ['tangential', 'same-topic'],
  },
  F: {
    text: `# 读《百年孤独》
马孔多从建立到消失，布恩迪亚家族七代人，名字一代代重复。
最打动我的是那种循环感：每个人都在孤独里打转，好像历史从来没往前走。`,
    want: 'unrelated',
    ok: ['unrelated'],
  },
}

const prompt = (ids: string[]) =>
  `这一篇（A）：\n${A}\n\n` +
  ids.map((id) => `候选 ${id}：\n${NOTES[id]!.text}`).join('\n\n') +
  `\n\n对每个候选判断它和 A 的关系，回：{"pairs":[{"id":"候选的字母","level":"…","confidence":0.0,"why":"…","quote_a":"…","quote_b":"…"}]}，候选按给的顺序各一条。`

/** 按候选的顺序各一条：id 钉死、level 只能五个之一（node-llama-cpp 照它约束生成） */
const LEVELS = ['same-content', 'same-topic', 'tangential', 'unrelated', 'unsure']
const schemaOf = (ids: readonly string[]) => ({
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      prefixItems: ids.map((id) => ({
        type: 'object',
        properties: { id: { const: id }, level: { enum: LEVELS }, confidence: { type: 'number' }, why: { type: 'string' }, quote_a: { type: 'string' }, quote_b: { type: 'string' } },
      })),
      minItems: ids.length,
      maxItems: ids.length,
    },
  },
})

interface Pair {
  id: string
  level: string
  confidence: number
  why: string
  quote_a: string
  quote_b: string
}

test.setTimeout(15 * 60_000)

test('真跑本地模型：判断题的用时、JSON、判得对不对', async () => {
  test.skip(!DIR, '只在 CN_LLM_REAL_DIR 给了时真跑')
  const results: unknown[] = []
  for (const model of MODELS) {
    const run = await launch({ '收件箱/一篇.md': '# 一篇\n' }, { CN_LLM_DIR: DIR!, CN_AI_FAKE: '0' })
    try {
      await run.page.evaluate((id) => window.cn.llmSetModel(id), model)
      expect((await run.page.evaluate(() => window.cn.llmStatus())).phase).toBe('ready')
      const rows: unknown[] = []
      for (const [name, ids, strict] of [
        ['两个候选（一对相关、一对不相关）· 只约束 JSON', ['B', 'C'], false],
        ['五个候选（同一件事、同题、沾边、两篇不相关）· 只约束 JSON', ['B', 'D', 'E', 'C', 'F'], false],
        ['两个候选 · 按 schema', ['B', 'C'], true],
        ['五个候选 · 按 schema', ['B', 'D', 'E', 'C', 'F'], true],
        ['五个候选 · 按 schema 再问一次（看结果稳不稳）', ['B', 'D', 'E', 'C', 'F'], true],
      ] as const) {
        const t0 = Date.now()
        const r = await run.app.evaluate(
          async (_e, a) => {
            const g = globalThis as unknown as { cnLocalLlm: { ask(s: string, p: string, o: { signal: AbortSignal; json?: boolean; schema?: object; maxTokens?: number }): Promise<string>; stats: unknown } }
            const text = await g.cnLocalLlm.ask(a.system, a.prompt, { signal: new AbortController().signal, ...(a.schema ? { schema: a.schema } : { json: true }), maxTokens: 1200 })
            return { text, stats: JSON.parse(JSON.stringify(g.cnLocalLlm.stats)) as { loadMs: number; contextSize: number; last: { ms: number; firstMs: number; tokens: number; promptTokens: number } } }
          },
          { system: SYSTEM, prompt: prompt([...ids]), schema: strict ? schemaOf(ids) : null },
        )
        const wall = Date.now() - t0
        let parsed: { pairs: Pair[] } | null = null
        try {
          parsed = JSON.parse(r.text) as { pairs: Pair[] }
        } catch {
          parsed = null
        }
        const judged = ids.map((id) => {
          const p = parsed?.pairs?.find((x) => x.id === id || x.id === `候选 ${id}` || x.id?.endsWith(id))
          const n = NOTES[id]!
          return { id, want: n.want, got: p?.level ?? null, exact: p?.level === n.want, ok: !!p && n.ok.includes(p.level), confidence: p?.confidence, why: p?.why, quote_a: p?.quote_a, quote_b: p?.quote_b }
        })
        // 模型进程占的内存（Electron 的子进程里最大的那个）
        const rss = Math.max(
          ...execFileSync('ps', ['-A', '-o', 'ppid=,rss='], { encoding: 'utf8' })
            .split('\n')
            .map((l) => l.trim().split(/\s+/))
            .filter(([pp]) => pp === String(run.app.process().pid))
            .map(([, kb]) => Number(kb) / 1024 / 1024),
        )
        const s = r.stats.last
        const genMs = s.ms - s.firstMs
        rows.push({
          name,
          wallS: +(wall / 1000).toFixed(2),
          askS: +(s.ms / 1000).toFixed(2),
          promptTokens: s.promptTokens,
          prefillS: +(s.firstMs / 1000).toFixed(2),
          prefillTokPerS: +(s.promptTokens / (s.firstMs / 1000)).toFixed(0),
          tokens: s.tokens,
          genTokPerS: +(s.tokens / (genMs / 1000)).toFixed(1),
          json: !!parsed && Array.isArray(parsed.pairs),
          judged,
          maxChildRssGb: +rss.toFixed(2),
          text: r.text,
        })
      }
      const stats = await run.app.evaluate(() => (globalThis as unknown as { cnLocalLlm: { stats: { loadMs: number; loadSteps: Record<string, number>; contextSize: number } } }).cnLocalLlm.stats)
      results.push({ model, loadS: +(stats.loadMs / 1000).toFixed(2), loadSteps: stats.loadSteps, contextSize: stats.contextSize, rows })
      // 先写下来再退出（退出慢、退出失败也不丢数）
      if (process.env.CN_LLM_REAL_OUT) writeFileSync(process.env.CN_LLM_REAL_OUT, JSON.stringify(results, null, 2))
    } finally {
      await run.close()
    }
  }
})

// 真联网下载（CN_LLM_REAL_NET=<空目录> 时跑）：Electron 里 window.cn.llmDownload 真从 Hugging Face 下小一档那个，
// 看进度事件、取消后 .part 留着、再下用 Range 接着下（已下的字节数不归零），再取消；不下完（1.8 GB）
test('真联网：下载、取消、接着下', async () => {
  test.skip(!process.env.CN_LLM_REAL_NET, '只在 CN_LLM_REAL_NET 给了时跑')
  const dir = process.env.CN_LLM_REAL_NET!
  const run = await launch({ '收件箱/一篇.md': '# 一篇\n' }, { CN_LLM_DIR: dir, CN_AI_FAKE: '0' })
  const { page } = run
  try {
    await page.evaluate(() => window.cn.llmSetModel('qwen3-1.7b-q8'))
    const watch = () =>
      page.evaluate(
        () =>
          new Promise<{ first: number; last: number; speed: number }>((resolve) => {
            let first = -1
            const off = window.cn.onLlm((s) => {
              if (s.phase !== 'downloading' || s.got == null) return
              if (first < 0) first = s.got
              if (s.got - first > 30e6) {
                off()
                void window.cn.llmCancel()
                resolve({ first, last: s.got, speed: s.speed ?? 0 })
              }
            })
            void window.cn.llmDownload()
          }),
      )
    const a = await watch()
    await expect.poll(() => page.evaluate(() => window.cn.llmStatus().then((s) => s.phase))).toBe('missing')
    const kept = (await page.evaluate(() => window.cn.llmStatus())).got!
    expect(kept).toBeGreaterThan(30e6)
    const b = await watch()
    // 接着下：第一条进度就从留着的地方起
    expect(b.first).toBeGreaterThanOrEqual(kept)
    await expect.poll(() => page.evaluate(() => window.cn.llmStatus().then((s) => s.phase))).toBe('missing')
    console.log(JSON.stringify({ first: a, kept, resumed: b }))
  } finally {
    await run.close()
  }
})
