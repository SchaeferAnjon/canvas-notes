// 真的 bge-m3（GGUF，node-llama-cpp 走 Metal；不进安装包，第一次用时下载）：给了下好的目录才跑，平常跳过。
//   CN_BGE_DIR=<放 bge-m3-q8_0.gguf 的目录> npx vitest run apps/notes/test/search-bge.test.ts
// 换一个量化比（如 F16）：CN_BGE_FILE=bge-m3-FP16.gguf
// 量门槛（像真库的样本，和 search-model.test.ts 的 e5 同一张表）：再加 CN_MEASURE=1
// 一个库里两两的分数（和别的版本比）：CN_PAIRS_VAULT=<库> 打出每对「最像的一对段」的分数
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeMeaningVault, MISSED, RELATED, UNRELATED } from '../e2e/fixtures/meaning-vault'
import { BGE_FILES, bgeEmbedder } from '../src/main/search/bge'
import { e5Embedder, type Embedder } from '../src/main/search/embedder'
import { FILLER, Indexer } from '../src/main/search/indexer'
import { readPdfText } from '../src/main/search/pdf-read'
import { Vault } from '../src/main/vault'

const DIR = process.env.CN_BGE_DIR ?? ''
const FILE = process.env.CN_BGE_FILE || BGE_FILES[0]!.file
const have = !!DIR && existsSync(join(DIR, FILE))
const E5 = join(__dirname, '../resources/models/multilingual-e5-small')

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, k) => s + x * b[k]!, 0)

describe.skipIf(!have)('bge-m3', () => {
  let bge: Embedder
  let root: string
  beforeAll(async () => {
    bge = await bgeEmbedder(DIR, FILE)
    root = mkdtempSync(join(tmpdir(), 'cn-bge-'))
  }, 120_000)
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('1024 维、归一化；同一主题比不相干的分高得多，中英文同一个东西也认得', async () => {
    const [a, b, c, d, e] = await bge.embed(
      [
        '冰岛的火山和板块裂谷：大西洋中脊从岛上穿过，板块每年分开两厘米。',
        '大西洋中脊是板块分开的地方，岩浆涌出来形成新的地壳，冰岛就在中脊上。',
        '今天的购物清单：牛奶、鸡蛋、面包。',
        'Iceland sits on the Mid-Atlantic Ridge, where two tectonic plates pull apart and volcanoes erupt.',
        '这周把登录页改完了，下周做支付。',
      ],
      'passage',
    )
    expect(a!.length).toBe(1024)
    expect(dot(a!, a!)).toBeCloseTo(1, 4)
    const same = dot(a!, b!)
    const cross = dot(a!, d!)
    const off = Math.max(dot(a!, c!), dot(a!, e!))
    console.log(`同一主题 ${same.toFixed(3)}，中英同一件事 ${cross.toFixed(3)}，不相干 ${off.toFixed(3)}`)
    expect(same - off).toBeGreaterThan(0.2)
    expect(cross - off).toBeGreaterThan(0.2)
  }, 60_000)

  it('每段多少毫秒（和 e5-small 比）', async () => {
    const texts = Array.from({ length: 64 }, (_, i) => `第${i}段：` + '线性映射在一组基下写成矩阵，特征值和特征向量描述它在哪些方向上只是伸缩。'.repeat(4))
    const time = async (e: Embedder) => {
      await e.embed(texts.slice(0, 16), 'passage')
      const t = performance.now()
      for (let i = 0; i < texts.length; i += 16) await e.embed(texts.slice(i, i + 16), 'passage')
      return (performance.now() - t) / texts.length
    }
    const b = await time(bge)
    const line = [`bge-m3（${FILE}）每段 ${b.toFixed(1)} ms`]
    const t = performance.now()
    for (const q of ['矩阵怎么变换', '冰岛的火山', 'event loop', '怎么让小狗坐下', '明朝皇帝']) await bge.embed([q], 'query')
    line.push(`查询一次（打的字算成向量）${((performance.now() - t) / 5).toFixed(1)} ms`)
    if (existsSync(join(E5, 'onnx', 'model_quantized.onnx'))) line.push(`e5-small 每段 ${(await time(await e5Embedder(E5))).toFixed(1)} ms`)
    console.log(line.join('；') + `（每段约 ${texts[0]!.length} 字，一批 16 段）`)
  }, 300_000)

  it('像真库的样本：不沾边的意思相近一条不出，沾边的出最该出的那篇', async () => {
    const vault = join(root, '像真库')
    makeMeaningVault(vault)
    const ix = new Indexer({ root: vault, userData: join(root, 'ud'), indexDir: join(root, 'ud', 's'), embedder: bge, readPdf: readPdfText, onStatus: () => undefined })
    await ix.scan()
    const v = new Vault(vault)
    const missed: string[] = []
    for (const q of UNRELATED) expect((await ix.meaning(q)).map((h) => h.path), q).toEqual([])
    for (const [q, want] of RELATED) {
      const r = (await ix.meaning(q)).map((h) => h.path)
      expect(r.length, q).toBeLessThanOrEqual(5)
      const text = [...(await v.search(q)).map((h) => h.path), ...ix.pdfSearch(q).map((h) => h.path)]
      if (![...r, ...text].some((p) => want.split('|').includes(p))) missed.push(q)
    }
    console.log(`沾边 ${RELATED.length} 个里没找到 ${missed.length} 个：${missed.join('、')}（e5 漏的：${MISSED.join('、')}）`)
    expect(missed.length).toBeLessThanOrEqual(MISSED.length)
  }, 600_000)

  it.skipIf(!process.env.CN_PAIRS_VAULT)('一个库里两两最像的一对段的分数', async () => {
    const ix = new Indexer({ root: process.env.CN_PAIRS_VAULT!, userData: join(root, 'pairs-ud'), indexDir: join(root, 'pairs-ud', 's'), embedder: bge, readPdf: readPdfText, onStatus: () => undefined })
    await ix.scan()
    const all = await ix.related((ix as unknown as { index: { paths(): string[] } }).index.paths(), 1000)
    const out: Record<string, Record<string, number>> = {}
    for (const [p, hits] of all) out[p] = Object.fromEntries(hits.map((h) => [h.path, h.score]))
    process.stdout.write('PAIRS ' + JSON.stringify(out) + '\n')
  }, 600_000)

  it.skipIf(!process.env.CN_MEASURE)('量门槛：每个查询最像的几篇比套话高多少', async () => {
    const vault = join(root, '量')
    makeMeaningVault(vault)
    const ix = new Indexer({ root: vault, userData: join(root, '量-ud'), indexDir: join(root, '量-ud', 's'), embedder: bge, readPdf: readPdfText, meaning: { limit: 3, near: 1, over: -1, spread: -1 }, onStatus: () => undefined })
    await ix.scan()
    const fv = await bge.embed(FILLER, 'passage')
    let out = '查询\t最像的\t分数\t套话\t前三减套话\n'
    for (const q of [...RELATED.map(([q]) => q), ...UNRELATED]) {
      const [qv] = await bge.embed([q], 'query')
      const filler = fv.reduce((s, f) => s + dot(f, qv!), 0) / fv.length
      const hits = await ix.meaning(q)
      out += [q, hits[0]?.path, hits[0]?.score.toFixed(3), filler.toFixed(3), hits.map((h) => (h.score - filler).toFixed(3)).join(' ')].join('\t') + '\n'
    }
    process.stdout.write(out)
  }, 600_000)
})
