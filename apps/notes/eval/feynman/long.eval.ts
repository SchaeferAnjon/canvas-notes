/**
 * 「聊到底」的提示词用真 AI 走一场（pnpm eval:feynman 一起跑）：teaching.md 稿 2 的自己讲那段，之后照稿子答；
 * C4 连着答不上三次（换角度 → 提示 → 说穿），看真 AI 学生是不是照软件定的那条、那一步问，一次一问、不夸不讲课、提示不带答案的关键词；
 * 最后收尾判一次。和 run.eval.ts 一样用这台 Mac 上的 Claude Code、CN_TEST_ANTHROPIC_API_KEY（只在这个进程里交给 Claude Code，不写进文件），没有 key 就跳过。
 */
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { claudeEngine } from '../../src/main/agent/engines'
import { type AskQ, type FlowDeps, judge, turn } from '../../src/shared/feynman/flow'
import { finishLong, leaks, longLine } from '../../src/shared/feynman/long'
import type { Entry, FeynmanMeta } from '../../src/shared/feynman/types'
import { DRAFTS, GD_META } from './drafts'

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

const engine = claudeEngine()
const calls: string[] = []
const deps: FlowDeps = {
  gather: null as never,
  by: () => `Claude Code · ${MODEL}`,
  ask: async (q: AskQ) => {
    calls.push(q.kind)
    const r = await engine.run({ prompt: q.prompt, system: q.system, cwd: tmpdir(), signal: AbortSignal.timeout(240_000), onText: () => {}, model: MODEL, effort: EFFORT })
    return r.text
  },
}

describe.skipIf(!KEY)(`费曼聊到底 · 真 AI（${MODEL} · ${EFFORT}）`, () => {
  it('稿 2 聊到底：照软件定的那条那一步问，一次一问，提示不带答案；收尾判定', { timeout: 1_500_000 }, async () => {
    const d2 = DRAFTS.find((d) => d.name.startsWith('稿 2'))!
    let meta: FeynmanMeta = { ...GD_META, id: 'f-long-eval', mode: 'long', points: GD_META.points.map((p) => (p.id === 'c4' ? { ...p, words: ['同时', '旧值', '一起改'] } : p)) }
    const entries: Pick<Entry, 'kind' | 'text'>[] = [{ kind: 'me', text: d2.own }]
    // 答：c3 照稿子答上；c4 连着三次答不上（不说「不知道」，免得直接说穿）；之后答得上
    const answers = ['呃 也不是 太大会走过头 在最低点两边来回跳 严重的话越跳越远 就收不回来了', '那就 各算各的偏导 各自更新吧', '嗯 一个一个改 改完一个再改下一个', '我还是想不出来别的办法', '比如坡度是负八 学习率零点一 那西塔就加零点八 变大', '不对 每一步走的是阿尔法乘坡度 坡缓了步子自己变小', '两个参数都先用原来的值把偏导算完 再一起改']
    const rows: string[] = []
    let bad = 0
    for (let i = 0; i <= answers.length; i++) {
      const n0 = calls.length
      const t = await turn({ reqId: i, meta, entries }, deps)
      meta = t.meta
      if (t.reveal) entries.push({ kind: 'reveal', text: t.reveal })
      if (t.say) entries.push({ kind: t.act === 'confirm' ? 'confirm' : 'student', text: t.say })
      const p = meta.points.find((x) => x.id === t.point)
      const q = (t.say.match(/[？?]/g) ?? []).length
      const leak = t.step === 'hint' || t.step === 'again' ? leaks(t.say, p) : []
      const praise = /^(对|没错|很好|懂了|明白了)/.test(t.say)
      if (q > 1 || leak.length || praise) bad++
      rows.push(`${i + 1}. ${t.act}${t.point ? ' ' + t.point : ''}${t.step ? ' ' + t.step : ''}${calls.length - n0 > 1 ? '（重问了一次）' : ''}${t.reveal ? `｜说穿：${t.reveal}` : ''}｜${t.say}${leak.length ? `｜✗ 带出了 ${leak.join('、')}` : ''}${q > 1 ? '｜✗ 两个问句' : ''}`)
      if (t.act === 'offer' || i === answers.length) break
      entries.push({ kind: 'me', text: answers[i]! })
    }
    const f = finishLong(meta)
    meta = f.meta
    for (const r of f.reveals) entries.push({ kind: 'reveal', text: r.text })
    const j = await judge({ reqId: 99, meta, entries, today: '2026-11-24', prevPasses: 0 }, deps)
    console.log(`\n费曼聊到底 · 真 AI（${MODEL} · ${EFFORT}），${calls.length} 问\n${rows.join('\n')}\n判定：${j.meta.verdict}${j.meta.redone ? ' · 当场补讲' : ''}｜${j.meta.states!.map((s) => `${s.id} ${s.state}${s.via ? `(${s.via})` : ''}`).join('，')}｜${longLine(j.meta)}`)
    // 真 AI 先问哪条由它判的含糊 / 没碰定（不一定是 c4）：至少有一条走完「换角度 → 提示 → 说穿」三步
    const ladder = j.meta.points.some((p) => {
      const steps = j.meta.asked.filter((a) => a.point === p.id && (a.act === 'ask' || a.act === 'reveal')).map((a) => (a.act === 'reveal' ? 'reveal' : a.step))
      const i = steps.indexOf('angle')
      return i >= 0 && steps.slice(i, i + 3).join() === 'angle,hint,reveal'
    })
    expect(ladder).toBe(true)
    expect(bad).toBe(0)
  })
})
