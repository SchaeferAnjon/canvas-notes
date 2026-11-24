/**
 * 「补进导图」的提示词用真 AI 验一遍（pnpm eval:feynman）：原型那张「线性代数 2.3」导图、「范数」那一轮（没过：放大 α 倍讲错，能不能是负的含糊，
 * 量的是什么讲清、举了 (3, 4) 的例子），看 AI 回的单子能不能读、是不是照设计页图 33 那样：讲错的标在「f(αx) = |α| f(x)」上，
 * 含糊的空框留在「非负 f(x) ≥ 0」后面，讲清的节点不动，最多加 2 个你的原话。
 * 和 run.eval.ts 一样用这台 Mac 上的 Claude Code、CN_TEST_ANTHROPIC_API_KEY（只在这个进程里交给 Claude Code，不写进文件），没有 key 就跳过。
 */
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { parseMindmap } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { claudeEngine } from '@cn/ai-engines'
import { MAP_PLAN_SYSTEM, mapPlanAsk, mergeLines, readPlan } from '../../src/shared/feynman/after'
import { findRounds } from '../../src/shared/feynman/doc'
import { MAP_TEXT } from '../../e2e/fixtures/feynman-after'

function key(): string | null {
  if (process.env.CN_TEST_ANTHROPIC_API_KEY) return process.env.CN_TEST_ANTHROPIC_API_KEY
  try {
    return execFileSync('dispatch', ['env', 'get', 'CN_TEST_ANTHROPIC_API_KEY'], { encoding: 'utf8', timeout: 10_000 }).trim() || null
  } catch {
    return null
  }
}

const KEY = key()
const MODEL = process.env.CN_EVAL_MODEL || 'claude-opus-5-5'
const EFFORT = process.env.CN_EVAL_EFFORT || 'high'
if (KEY) {
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE|_CODE)/.test(k)) delete process.env[k]
  process.env.ANTHROPIC_API_KEY = KEY
}

describe.skipIf(!KEY)(`费曼补进导图 · 真 AI（${MODEL} · ${EFFORT}）`, () => {
  it('讲错的标在那个节点上、含糊的留空框、讲清的不动、加的是你的原话', { timeout: 300_000 }, async () => {
    const roots = parseMindmap(MAP_TEXT).roots
    const round = findRounds(MAP_TEXT)[0]!
    const r = await claudeEngine().run({ prompt: mapPlanAsk(roots, '0.2', round), system: MAP_PLAN_SYSTEM, cwd: tmpdir(), signal: AbortSignal.timeout(240_000), onText: () => {}, model: MODEL, effort: EFFORT })
    const plan = readPlan(roots, '0.2', r.text)
    console.log('AI 回的：', r.text)
    expect(plan).not.toBeNull()
    console.table(mergeLines(roots, plan!))
    expect(plan!.ops).toContainEqual(expect.objectContaining({ kind: 'wrong', at: '0.2.1' }))
    expect(plan!.ops).toContainEqual({ kind: 'blank', at: '0.2.3' })
    const adds = plan!.ops.filter((o) => o.kind === 'add')
    expect(adds.length).toBeLessThanOrEqual(2)
    // 讲清的那几个节点不动
    for (const k of ['0.2.0', '0.2.2', '0.2.4']) expect(plan!.ops.some((o) => o.kind !== 'add' && o.at === k)).toBe(false)
  })
})
