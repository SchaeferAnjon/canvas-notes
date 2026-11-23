/**
 * 梦游补双链在真库上的评测（task-h7oy8）：pnpm eval:dream-real <库路径> [步骤] [选项]，选项见 cli.mjs。
 * 四步，各自能单独重跑；样本、标注、AI 回答、分数全写进 out 目录（默认设置目录下 dream-eval/<库的指纹>/），不进仓库。
 *   sample  抽题（正例、找回来的邻居、两种反例）并算找候选的召回
 *   label   裁判（默认 Opus · high）标注；和 review.json（人核过的）合成 labels.json，列出还要人核的 review-todo.json
 *   judge   用一种或几种判法答题（同一批题、同一版提示词）
 *   score   打分、扫阈值、挑误报和漏报的例子，写 score.json
 * 没给库路径（CN_REAL_VAULT）时整个跳过，所以 pnpm eval:dream 不会跑到这里。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { JUDGE_SYSTEM, JUDGE_VERSION, judgePrompt, LINK_ASK, LINK_PASS, parseJudgements } from '../../src/shared/dream-judge'
import { httpEmbedder, onnxEmbedder } from './embed'
import { askAll, parseEngine } from './judge'
import { type Label, LABEL_SYSTEM, labelPrompt, parseLabels } from './label'
import { buildCorpus, type Query, sampleQueries, textFor } from './sample'
import { decide, line, metrics, type PairResult } from './score'
import { readVault } from './vault'

const env = process.env
const VAULT = env.CN_REAL_VAULT ?? ''
const OUT = env.CN_REAL_OUT ?? ''
const STEP = env.CN_REAL_STEP ?? 'score'
const log = (s: string) => console.log(s)
const readJson = <T>(f: string): T => JSON.parse(readFileSync(join(OUT, f), 'utf8')) as T
const writeJson = (f: string, x: unknown) => writeFileSync(join(OUT, f), JSON.stringify(x, null, 1))

interface LabelRow {
  q: string
  path: string
  source: string
  label: Label
  by: 'judge' | 'review'
  reason: string
  /** 裁判的原判（人核过改了的话留着对照） */
  judge?: Label
}

interface RunRow {
  q: string
  ms: number
  inTokens: number
  outTokens: number
  cacheRead: number
  cacheWrite: number
  cost: number
  error?: string
  model?: string
  cands: string[]
  judgements: ReturnType<typeof parseJudgements>
}

it.skipIf(!VAULT)('梦游补双链：真库评测', { timeout: 0 }, async () => {
  mkdirSync(OUT, { recursive: true })
  const notes = readVault(VAULT)
  log(`库：${notes.size} 篇；输出：${OUT}；步骤：${STEP}`)
  const titleOf = (p: string) => notes.get(p)!.title

  if (STEP === 'sample') {
    const embed = /^https?:/.test(env.CN_EMBED_DIR!) ? httpEmbedder(env.CN_EMBED_DIR!) : await onnxEmbedder(env.CN_EMBED_DIR!)
    const corpus = await buildCorpus(notes, embed, join(OUT, `emb-${embed.name}`), log)
    // --exclude <别的 queries.json>：那一批的 A 不再抽（另抽一批留出集）
    const exclude = new Set(env.CN_REAL_EXCLUDE ? (JSON.parse(readFileSync(env.CN_REAL_EXCLUDE, 'utf8')) as Query[]).map((q) => q.a) : [])
    const qs = await sampleQueries(corpus, embed, { n: Number(env.CN_REAL_N ?? 150), dev: Number(env.CN_REAL_DEV ?? 30), seed: Number(env.CN_REAL_SEED ?? 7), retrieved: 3, exclude }, log)
    writeJson('queries.json', qs)
    const ranks = qs.map((q) => q.cands.find((c) => c.source === 'link')!.rank)
    const at = (k: number) => ranks.filter((r) => r > 0 && r <= k).length
    log(`抽了 ${qs.length} 题，${qs.reduce((s, q) => s + q.cands.length, 0)} 对；合格的笔记 ${corpus.eligible.length} 篇`)
    log(`拿掉链接后找回来（${embed.name} + 关键词 + 标题，按名次合并）：前 5 名 ${at(5)}，前 10 名 ${at(10)}，前 20 名 ${at(20)}（共 ${qs.length}）`)
    writeJson('recall.json', { embed: embed.name, n: qs.length, at5: at(5), at10: at(10), at20: at(20), ranks })
    return
  }

  const qs = readJson<Query[]>('queries.json')
  const hideFor = (q: Query, p: string) => (p === q.a ? [q.b] : [q.a])
  const textOf = (q: Query, p: string) => textFor(notes, p, hideFor(q, p))

  // 看一题给 AI 看的原样提示词：show，配 --split q012
  if (STEP === 'show') {
    const q = qs.find((x) => x.id === env.CN_REAL_SPLIT) ?? qs[0]!
    log(judgePrompt({ title: titleOf(q.a), text: textOf(q, q.a) }, q.cands.map((c) => ({ title: titleOf(c.path), text: textOf(q, c.path) }))))
    log(JSON.stringify(q.cands, null, 1))
    return
  }

  if (STEP === 'label') {
    const e = parseEngine(env.CN_LABEL_ENGINE ?? 'claude:opus:high')
    const jobs = qs.map((q) => ({
      key: q.id,
      system: LABEL_SYSTEM,
      prompt: labelPrompt({ title: titleOf(q.a), text: textOf(q, q.a) }, q.cands.map((c) => ({ title: titleOf(c.path), text: textOf(q, c.path) }))),
      meta: q,
    }))
    const res = await askAll(e, jobs, OUT, log)
    const review: Record<string, { label: Label; note: string }> = existsSync(join(OUT, 'review.json')) ? readJson('review.json') : {}
    const rows: LabelRow[] = []
    const todo: unknown[] = []
    let cost = 0
    for (const { job, ans } of res) {
      cost += ans.cost
      const q = job.meta
      const got = parseLabels(ans.text, q.cands.length)
      q.cands.forEach((c, i) => {
        const g = got.find((x) => x.index === i)
        const key = `${q.id}|${c.path}`
        const r = review[key]
        const judge = g?.label
        // 要人核：裁判没判、说两可、和原来的链接对不上（链着的判不该连 / 没链着的判该连）
        const needs = !g || g.label === 'maybe' || (c.source === 'link' && g.label !== 'link') || (c.source !== 'link' && g.label === 'link')
        if (needs && !r) todo.push({ key, a: titleOf(q.a), b: titleOf(c.path), source: c.source, judge: judge ?? '没判', reason: g?.reason ?? '', aDir: q.a.split('/').slice(0, -1).join('/'), bDir: c.path.split('/').slice(0, -1).join('/') })
        const label: Label | undefined = r?.label ?? judge
        if (label) rows.push({ q: q.id, path: c.path, source: c.source, label, by: r ? 'review' : 'judge', reason: r?.note || g?.reason || '', judge })
      })
    }
    writeJson('labels.json', rows)
    writeJson('review-todo.json', todo)
    const n = (l: Label) => rows.filter((r) => r.label === l).length
    log(`标注 ${rows.length} 对：该连 ${n('link')}，两可 ${n('maybe')}，不该连 ${n('no')}；人核过 ${rows.filter((r) => r.by === 'review').length}，还要人核 ${todo.length}；裁判花费 $${cost.toFixed(2)}（含缓存命中的）`)
    return
  }

  const split = env.CN_REAL_SPLIT ?? 'all'
  // --limit N：只用这一组的前 N 题（本机模型慢，先在一部分题上比）
  const pick = qs.filter((q) => split === 'all' || q.split === split).slice(0, Number(env.CN_REAL_LIMIT) || undefined)

  if (STEP === 'judge') {
    for (const spec of (env.CN_JUDGE ?? 'claude:haiku:low').split(',')) {
      const e = parseEngine(spec)
      const jobs = pick.map((q) => ({
        key: q.id,
        system: JUDGE_SYSTEM,
        prompt: judgePrompt({ title: titleOf(q.a), text: textOf(q, q.a) }, q.cands.map((c) => ({ title: titleOf(c.path), text: textOf(q, c.path) }))),
        meta: q,
      }))
      const t0 = Date.now()
      const res = await askAll(e, jobs, OUT, log)
      const rows: RunRow[] = res.map(({ job, ans }) => ({
        q: job.meta.id,
        ms: ans.ms,
        inTokens: ans.inTokens,
        outTokens: ans.outTokens,
        cacheRead: ans.cacheRead,
        cacheWrite: ans.cacheWrite,
        cost: ans.cost,
        error: ans.error,
        model: ans.model,
        cands: job.meta.cands.map((c) => c.path),
        judgements: parseJudgements(ans.text, job.meta.cands.length),
      }))
      mkdirSync(join(OUT, 'runs', JUDGE_VERSION), { recursive: true })
      const file = join('runs', JUDGE_VERSION, `${e.name}.json`)
      const old: RunRow[] = existsSync(join(OUT, file)) ? readJson(file) : []
      const merged = [...old.filter((o) => !rows.some((r) => r.q === o.q)), ...rows]
      writeJson(file, merged)
      const bad = rows.filter((r) => r.judgements.length < r.cands.length).length
      log(`${e.name}（提示词 ${JUDGE_VERSION}）：${rows.length} 题，墙钟 ${Math.round((Date.now() - t0) / 1000)} 秒，答得不全 ${bad} 题`)
    }
    return
  }

  if (STEP === 'score') {
    const labels = readJson<LabelRow[]>('labels.json')
    const lab = new Map(labels.map((l) => [`${l.q}|${l.path}`, l]))
    const version = env.CN_JUDGE_VERSION ?? JUDGE_VERSION
    const dir = join(OUT, 'runs', version)
    const names = (env.CN_JUDGE ? env.CN_JUDGE.split(',').map((s) => parseEngine(s).name) : []).filter(Boolean)
    const all = names.length ? names : (await import('node:fs')).readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    const qById = new Map(qs.map((q) => [q.id, q]))
    const report: Record<string, unknown> = {}
    log(`\n提示词 ${version}，题：${split}（${pick.length} 题）；线：提 ≥ ${LINK_PASS}，拿不准 ≥ ${LINK_ASK}`)
    for (const name of all) {
      const run = (readJson<RunRow[]>(join('runs', version, `${name}.json`))).filter((r) => pick.some((q) => q.id === r.q))
      const rows: PairResult[] = []
      for (const r of run) {
        const q = qById.get(r.q)!
        r.cands.forEach((p, i) => {
          const l = lab.get(`${q.id}|${p}`)
          if (!l) return
          rows.push({ q: q.id, a: q.a, b: p, source: l.source, label: l.label, j: r.judgements.find((j) => j.index === i), aText: textOf(q, q.a), bText: textOf(q, p) })
        })
      }
      const m = metrics(rows)
      log(line(name, m))
      const ms = run.map((r) => r.ms).sort((a, b) => a - b)
      const pairs = run.reduce((s, r) => s + r.cands.length, 0)
      const sweep = [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((p) => ({ pass: p, ...metrics(rows, p, LINK_ASK) }))
      const ex = (f: (r: PairResult) => boolean) =>
        rows.filter(f).map((r) => ({ q: r.q, a: titleOf(r.a), b: titleOf(r.b), aPath: r.a, bPath: r.b, source: r.source, label: r.label, labelWhy: lab.get(`${r.q}|${r.b}`)!.reason, j: r.j }))
      report[name] = {
        metrics: m,
        calls: run.length,
        pairs,
        msMedian: ms[Math.floor(ms.length / 2)] ?? 0,
        msP90: ms[Math.floor(ms.length * 0.9)] ?? 0,
        msPerPair: pairs ? run.reduce((s, r) => s + r.ms, 0) / pairs : 0,
        inTokens: run.reduce((s, r) => s + r.inTokens + r.cacheRead + r.cacheWrite, 0),
        outTokens: run.reduce((s, r) => s + r.outTokens, 0),
        cost: run.reduce((s, r) => s + r.cost, 0),
        errors: run.filter((r) => r.error).length,
        incomplete: run.filter((r) => r.judgements.length < r.cands.length).length,
        model: run.find((r) => r.model)?.model,
        sweep,
        falsePositives: ex((r) => decide(r) === 'link' && r.label === 'no'),
        misses: ex((r) => decide(r) === 'drop' && r.label === 'link'),
        asks: ex((r) => decide(r) === 'ask'),
        // 每一对的处理（比两次判法合起来用时，比如两遍都过才提）
        decisions: rows.map((r) => ({ q: r.q, b: r.b, label: r.label, source: r.source, d: decide(r), kind: r.j?.kind, conf: r.j?.confidence })),
      }
    }
    writeJson(`score-${version}-${split}${env.CN_REAL_LIMIT ? `-first${env.CN_REAL_LIMIT}` : ''}.json`, report)
  }
})
