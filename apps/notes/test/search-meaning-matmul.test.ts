// 按意思搜索一次矩阵算（大库提速）：VectorIndex.search 把「这句 × 全库每一段」一次交给 Gemm，
// 和以前一段一段乘的结果一样（前 20 名同样的篇、同样的顺序），真库那么大（3000 篇、7 万段、1024 维）一次 80 毫秒以内。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jsScorer, ortScorer } from '../src/main/search/matmul'
import { VectorIndex } from '../src/main/search/vector-index'

/** 同一个 seed 造出来一样（Math.random 造 7 千万个数太慢） */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

function unitRows(r: () => number, n: number, d: number): Float32Array[] {
  return Array.from({ length: n }, () => {
    const v = new Float32Array(d)
    let len = 0
    for (let k = 0; k < d; k++) len += (v[k] = r()) ** 2
    len = Math.sqrt(len)
    for (let k = 0; k < d; k++) v[k]! /= len
    return v
  })
}

/** 改以前的做法：一段一段乘（双精度累加），同一篇 md 留最像的一段，PDF 每页一段，按分数排 */
function scanSearch(notes: { path: string; chunks: { page?: number }[]; vecs: Float32Array[] }[], q: Float32Array) {
  const best = new Map<string, { path: string; page?: number; score: number }>()
  for (const n of notes)
    n.vecs.forEach((v, i) => {
      let s = 0
      for (let k = 0; k < v.length; k++) s += v[k]! * q[k]!
      const page = n.chunks[i]!.page
      const key = page ? `${n.path}#${page}` : n.path
      const had = best.get(key)
      if (!had || s > had.score) best.set(key, { path: n.path, ...(page ? { page } : {}), score: s })
    })
  return [...best.values()].sort((a, b) => b.score - a.score)
}

/** 不卡门槛：只看排名 */
const OPEN = { limit: 20, min: -2, near: 4, spread: -4 }

describe('按意思搜索一次矩阵算', () => {
  it('小库：md 每篇留最像的一段、PDF 每页一段，和一段一段乘的结果一样（JS 和 onnxruntime 两种点乘）', async () => {
    const d = 64
    const r = rng(3)
    const ix = new VectorIndex('m', d)
    const notes = Array.from({ length: 60 }, (_, f) => {
      const pdf = f % 7 === 0
      const n = 1 + (f % 6)
      const chunks = Array.from({ length: n }, (_, i) => ({ snippet: `${f}-${i}`, ...(pdf ? { page: 1 + (i % 3) } : {}) }))
      const vecs = unitRows(r, n, d)
      const path = `n${f}.${pdf ? 'pdf' : 'md'}`
      ix.set(path, 's', chunks, vecs)
      return { path, chunks, vecs }
    })
    // 删一篇、换一篇：行号复用以后照样对
    ix.remove('n5.md')
    notes.splice(5, 1)
    const ort = await ortScorer(2)
    for (const q of unitRows(r, 8, d)) {
      const want = scanSearch(notes, q).slice(0, 20)
      for (const score of [jsScorer, ort]) {
        const got = await ix.search(q, OPEN, score)
        expect(got.map((h) => [h.path, h.page])).toEqual(want.map((h) => [h.path, h.page]))
        got.forEach((h, i) => expect(h.score).toBeCloseTo(want[i]!.score, 4))
        // 摘要是那一段的
        for (const h of got) expect(h.snippet.startsWith(h.path.slice(1).replace(/\.(md|pdf)$/, '') + '-')).toBe(true)
      }
    }
  })

  it('真库那么大（3000 篇、7 万段、1024 维）：前 20 名和一段一段乘一样，一次 80 毫秒以内', async () => {
    const d = 1024
    const r = rng(11)
    const ix = new VectorIndex('m', d)
    const notes: { path: string; chunks: { snippet: string }[]; vecs: Float32Array[] }[] = []
    let rows = 0
    for (let f = 0; f < 3000; f++) {
      // 一篇 1 到 45 段，平均 23 段（真库 3093 篇 70,372 段）
      const n = 1 + ((f * 37) % 45)
      const chunks = Array.from({ length: n }, () => ({ snippet: '' }))
      const vecs = unitRows(r, n, d)
      ix.set(`n${f}.md`, 's', chunks, vecs)
      notes.push({ path: `n${f}.md`, chunks, vecs })
      rows += n
    }
    expect(rows).toBeGreaterThan(65_000)
    const ort = await ortScorer()
    const ms: number[] = []
    for (const q of unitRows(r, 6, d)) {
      await ix.search(q, OPEN, ort)
      const t = performance.now()
      const got = await ix.search(q, OPEN, ort)
      ms.push(performance.now() - t)
      expect(got.map((h) => h.path)).toEqual(scanSearch(notes, q).slice(0, 20).map((h) => h.path))
    }
    ms.sort((a, b) => a - b)
    console.log(`一次矩阵算（${rows} 段 × ${d} 维）：${ms.map((x) => x.toFixed(1)).join(' / ')} 毫秒`)
    expect(ms[ms.length >> 1]).toBeLessThan(80)
  }, 120_000)

  // 真库的索引（用户库副本建的 bge-m3 索引，不进仓库）：CN_REAL_INDEX=<.../search/<指纹>/bge-m3> 时跑。
  // 拿库里 20 段自己的向量当查询，矩阵算和一段一段乘的前 20 名比
  it.runIf(!!process.env.CN_REAL_INDEX)('真库索引：前 20 名和一段一段乘一样', async () => {
    const dir = process.env.CN_REAL_INDEX!
    const ix = VectorIndex.load(dir, JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).model, 1024)
    const buf = readFileSync(join(dir, 'vectors.f32'))
    const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
    const saved = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { files: Record<string, { rows: number[]; chunks: { page?: number }[] }> }
    const notes = Object.entries(saved.files).map(([path, f]) => ({ path, chunks: f.chunks, vecs: f.rows.map((r) => vec.subarray(r * 1024, (r + 1) * 1024)) }))
    const ort = await ortScorer()
    const total = vec.length / 1024
    const ms: number[] = []
    const scan: number[] = []
    for (let i = 0; i < 20; i++) {
      const q = vec.slice(((i * 3517) % total) * 1024, ((i * 3517) % total + 1) * 1024)
      const t0 = performance.now()
      const want = scanSearch(notes, q).slice(0, 20)
      scan.push(performance.now() - t0)
      const t = performance.now()
      const got = await ix.search(q, OPEN, ort)
      ms.push(performance.now() - t)
      expect(got.map((h) => [h.path, h.page])).toEqual(want.map((h) => [h.path, h.page]))
    }
    console.log(`真库 ${total} 段：矩阵算 ${ms.map((x) => x.toFixed(0)).join(' ')} 毫秒；一段一段乘 ${scan.map((x) => x.toFixed(0)).join(' ')} 毫秒`)
  }, 300_000)
})
