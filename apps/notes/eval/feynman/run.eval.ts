/**
 * 费曼的提示词用真 AI 验一遍（pnpm eval:feynman）：teaching.md 第 6 节四段口语稿，
 * 判定（每条核心的状态、软件算的三档）和 AI 学生听完自己讲的那段说的第一句，和 teaching.md 写的对一对。
 *
 * 用这台 Mac 上的 Claude Code（和软件里「AI 对话」一样的参数：不给工具、不留会话），模型默认 Opus 5.5 · High（软件的默认），
 * CN_EVAL_MODEL、CN_EVAL_EFFORT 能换。走的是 API 额度那把 key：CN_TEST_ANTHROPIC_API_KEY（环境里没有就现问 `dispatch env get`），
 * 只在这个进程里交给 Claude Code，不写进任何文件。没有 key 就跳过。
 * 结果打一张表；CN_EVAL_OUT=<文件> 时另存一份 JSON（交付页用）。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { claudeEngine } from '../../src/main/agent/engines'
import { type AskQ, type FlowDeps, judge, turn } from '../../src/shared/feynman/flow'
import type { CoreState, StudentAct } from '../../src/shared/feynman/types'
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
  // 在 Claude Code 终端里跑时父会话的变量会让命令行以为自己是子进程：去掉
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE|_CODE)/.test(k)) delete process.env[k]
  process.env.ANTHROPIC_API_KEY = KEY
}

const engine = claudeEngine()
const calls: { kind: string; ms: number }[] = []
const deps: FlowDeps = {
  gather: null as never,
  by: () => `Claude Code · ${MODEL}`,
  ask: async (q: AskQ) => {
    const t0 = Date.now()
    const r = await engine.run({ prompt: q.prompt, system: q.system, cwd: tmpdir(), signal: AbortSignal.timeout(240_000), onText: () => {}, model: MODEL, effort: EFFORT })
    calls.push({ kind: q.kind, ms: Date.now() - t0 })
    return r.text
  },
}

interface Row {
  draft: string
  want: { states: Record<string, CoreState>; verdict: string; first: string }
  got: { states: Record<string, CoreState>; quotes: Record<string, string>; verdict: string; first: { act: StudentAct; point?: string; say: string }; wording: string[]; full: string }
  statesMatch: boolean
  verdictMatch: boolean
  firstMatch: boolean
}

describe.skipIf(!KEY)(`费曼提示词 · 真 AI（${MODEL} · ${EFFORT}）`, () => {
  it('teaching.md 第 6 节四段口语稿：判定和学生第一句', { timeout: 900_000 }, async () => {
    const rows = await Promise.all(
      DRAFTS.map(async (d): Promise<Row> => {
        const [t, j] = await Promise.all([
          turn({ reqId: 1, meta: GD_META, entries: [{ kind: 'me', text: d.own }] }, deps),
          judge({ reqId: 2, meta: GD_META, entries: d.lines, today: '2026-11-23', prevPasses: 0 }, deps),
        ])
        const states = Object.fromEntries(j.states.map((s) => [s.id, s.state]))
        const quotes = Object.fromEntries(j.states.map((s) => [s.id, s.quote]))
        const firstOk = t.act === d.first.act && (!d.first.points || (!!t.point && d.first.points.includes(t.point)))
        return {
          draft: d.name,
          want: { states: d.states, verdict: d.verdict, first: `${d.first.act}${d.first.points ? `（${d.first.points.join(' 或 ')}）` : ''}` },
          got: { states, quotes, verdict: j.meta.verdict!, first: { act: t.act, ...(t.point ? { point: t.point } : {}), say: t.say }, wording: j.wording, full: j.full },
          statesMatch: Object.entries(d.states).every(([k, v]) => states[k] === v),
          verdictMatch: j.meta.verdict === d.verdict,
          firstMatch: firstOk,
        }
      }),
    )
    const label: Record<string, string> = { clear: '讲清', asked: '追问后补上', fixed: '说错后改对', vague: '含糊', missing: '没讲到', wrong: '讲错', pass: '过', almost: '差一点', fail: '没过' }
    console.log(`\n费曼提示词 · 真 AI（${MODEL} · ${EFFORT}），${calls.length} 问，平均 ${Math.round(calls.reduce((s, c) => s + c.ms, 0) / calls.length / 1000)} 秒`)
    for (const r of rows) {
      const diff = Object.keys(r.want.states)
        .map((k) => `${k} ${label[r.want.states[k]!]}${r.got.states[k] === r.want.states[k] ? '' : ` → ${label[r.got.states[k]!] ?? r.got.states[k]}`}`)
        .join('，')
      console.log(`${r.verdictMatch ? '✓' : '✗'} ${r.draft}：判定 ${label[r.got.verdict]}（teaching.md：${label[r.want.verdict]}）｜${diff}｜学生第一句 ${r.got.first.act}${r.got.first.point ? ` ${r.got.first.point}` : ''}${r.firstMatch ? '' : `（应为 ${r.want.first}）`}：${r.got.first.say}`)
    }
    if (process.env.CN_EVAL_OUT) writeFileSync(process.env.CN_EVAL_OUT, JSON.stringify({ model: MODEL, effort: EFFORT, at: new Date().toISOString(), calls, rows }, null, 2))
    // 判定（三档）要和 teaching.md 一样；每条状态、学生第一句打在表里看
    expect(rows.map((r) => r.got.verdict)).toEqual(rows.map((r) => r.want.verdict))
  })

  it('抽要点：一张课件的字抽成核心 3 到 5 条（名字不带答案、每条有凭什么）；PDF 一讲切成知识点单子', { timeout: 600_000 }, async () => {
    const slide = `PPT p20 Gradient descent
Start from an initial guess θ⁽⁰⁾ and repeatedly update the parameters to reduce the loss.
θ_d := θ_d − α ∂L/∂θ_d   (update simultaneously for all d)
α is the learning rate. Too small: slow. Too large: overshoot, oscillate, may diverge.
Example: x = 2, t = 4, θ = 0, gradient = −8.
Which samples to use for one update → next topic (SGD).
Derivation of ∂L/∂θ for the squared loss: the ½ and the 2 cancel …`
    const ans = await deps.ask({ kind: 'extract', system: (await import('../../src/shared/feynman/prompts')).EXTRACT_SYSTEM, prompt: (await import('../../src/shared/feynman/prompts')).extractPrompt(slide, { scope: 'point', topic: '梯度下降' }), images: [], fake: () => '' })
    const pts = (await import('../../src/shared/feynman/prompts')).parseExtract(ans)
    for (const p of pts) console.log(`抽要点「${p.topic}」：核心 ${p.points.filter((x) => x.kind === 'core').map((x) => `${x.text}（${x.basis}）`).join('；')}｜了解即可 ${p.points.filter((x) => x.kind === 'extra').map((x) => x.text).join('；')}｜误解 ${p.myths.length} 条`)
    const cores = pts[0]!.points.filter((x) => x.kind === 'core')
    expect(cores.length).toBeGreaterThanOrEqual(3)
    expect(cores.length).toBeLessThanOrEqual(5)
    expect(cores.every((c) => c.basis && c.answer)).toBe(true)
    // 名字只写要讲的事，不写公式答案
    expect(cores.filter((c) => /[=:]=|:=|−\s*α/.test(c.text))).toEqual([])

    const pr = await import('../../src/shared/feynman/prompts')
    const pages = [
      { page: 1, text: '# Lecture 3 Linear Maps\nA linear map sends sums to sums and scalings to scalings.' },
      { page: 2, text: '# 3.2 Definition\nT(u + v) = T(u) + T(v); T(cu) = cT(u).' },
      { page: 3, text: '# 3.2 Definition (cont.)\nBoth rules together keep linear combinations.' },
      { page: 4, text: '# Example 3.4 Rotation\nColumn 1 of R is the rotated e1, column 2 the rotated e2.' },
      { page: 5, text: '# 3.5 Kernel and image\nThe kernel is the set of vectors sent to zero. The image is everything T can reach.' },
    ]
    const list = pr.parsePdfList(await deps.ask({ kind: 'list', system: pr.PDF_LIST_SYSTEM, prompt: pr.pdfListPrompt('第3讲 线性映射', pages), images: [], fake: () => '' }), pages.length)
    console.log(`PDF 单子「${list.title}」：${list.items.map((x) => `${x.name} p${x.from}-${x.to} ${x.level} ${x.cores}条`).join('；')}`)
    // (cont.) 并进上一页
    expect(list.items.some((x) => x.from <= 2 && x.to >= 3)).toBe(true)
  })
})
