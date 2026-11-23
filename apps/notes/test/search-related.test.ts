// 梦游补双链找候选（search/index.ts 的 searchRelated 用的 Indexer.related / VectorIndex.related）：
// 每篇在全库里按「两篇最像的那一对段落」排前 k 篇，带回那一对段落的原文。假模型（按字算词袋），不用真模型。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeEmbedder } from '../src/main/search/embedder'
import { Indexer } from '../src/main/search/indexer'
import { jsScorer, ortScorer } from '../src/main/search/matmul'
import { readPdfText } from '../src/main/search/pdf-read'
import { VectorIndex } from '../src/main/search/vector-index'

const unit = (...xs: number[]) => {
  const v = new Float32Array(xs)
  const n = Math.hypot(...xs) || 1
  return v.map((x) => x / n)
}

describe('VectorIndex.related', () => {
  it('按最像的那一对段排，带回是哪一对；不含自己，最多 k 篇', async () => {
    const ix = new VectorIndex('m', 3)
    const c = (n: number) => Array.from({ length: n }, (_, i) => ({ snippet: `段${i}` }))
    // 我：第 0 段朝 x，第 1 段朝 y
    ix.set('我.md', 's', c(2), [unit(1, 0, 0), unit(0, 1, 0)])
    // 甲：第 1 段几乎就是我的第 1 段
    ix.set('甲.md', 's', c(2), [unit(0, 0, 1), unit(0.1, 1, 0)])
    // 乙：只有一段，介于 x 和 z 之间
    ix.set('乙.md', 's', c(1), [unit(1, 0, 1)])
    // 丙：和我完全不沾边（反方向）
    ix.set('丙.md', 's', c(1), [unit(-1, -1, 0)])
    const r = await ix.related('我.md', 2)
    expect(r.map((h) => h.path)).toEqual(['甲.md', '乙.md'])
    expect(r[0]).toMatchObject({ i: 1, j: 1 })
    expect(r[0]!.score).toBeCloseTo(1 / Math.hypot(0.1, 1), 5)
    expect(r[1]).toMatchObject({ i: 0, j: 0 })
    expect(r[1]!.score).toBeCloseTo(Math.SQRT1_2, 5)
    expect((await ix.related('我.md', 10)).map((h) => h.path)).toEqual(['甲.md', '乙.md', '丙.md'])
    expect(await ix.related('没有这篇.md', 5)).toEqual([])
  })

  it('点乘交给 onnxruntime（Gemm）算：和 JS 一个一个乘的结果一样，排序和配对也一样', async () => {
    const d = 1024
    const rnd = (n: number) => new Float32Array(n * d).map(() => Math.random() - 0.5)
    const a = rnd(7)
    const b = rnd(50)
    const ort = await ortScorer(2)
    const x = await ort(a, 7, b, 50, d)
    const y = await jsScorer(a, 7, b, 50, d)
    expect(x.length).toBe(350)
    for (let i = 0; i < x.length; i++) expect(x[i]).toBeCloseTo(y[i]!, 3)
    const ix = new VectorIndex('m', d)
    const unitRows = (n: number) => Array.from({ length: n }, () => {
      const v = new Float32Array(d).map(() => Math.random() - 0.5)
      const len = Math.hypot(...v)
      return v.map((t) => t / len)
    })
    for (let f = 0; f < 40; f++) {
      const vs = unitRows(1 + (f % 5))
      ix.set(`n${f}.md`, 's', vs.map(() => ({ snippet: '' })), vs)
    }
    for (const p of ['n0.md', 'n3.md', 'n17.md']) {
      const viaOrt = await ix.related(p, 5, ort)
      const viaJs = await ix.related(p, 5)
      expect(viaOrt.map((h) => [h.path, h.i, h.j])).toEqual(viaJs.map((h) => [h.path, h.i, h.j]))
    }
  })

  it('建完过一遍（built）存进 index.json；peek 只看模型名和 built', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cn-vi-'))
    try {
      const ix = new VectorIndex('bge-m3-int8', 3)
      ix.set('a.md', 's', [{ snippet: 'a' }], [unit(1, 0, 0)])
      ix.save(dir)
      expect(VectorIndex.peek(dir)).toEqual({ model: 'bge-m3-int8', built: false })
      ix.built = true
      ix.save(dir)
      expect(VectorIndex.peek(dir)).toEqual({ model: 'bge-m3-int8', built: true })
      expect(VectorIndex.load(dir, 'bge-m3-int8', 3).built).toBe(true)
      // 换了模型：整个重建（空的、没建完）
      expect(VectorIndex.load(dir, 'multilingual-e5-small-int8', 3)).toMatchObject({ size: 0, built: false })
      expect(VectorIndex.peek(join(dir, '没有'))).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Indexer.related（假模型）', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cn-related-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const put = (vault: string, p: string, t: string) => {
    mkdirSync(join(vault, p, '..'), { recursive: true })
    writeFileSync(join(vault, p), t)
  }

  it('每篇前 k 篇按最像的一对段落排，mine / theirs 是那一对段的原文（不带标题）', async () => {
    const vault = join(root, '库')
    // 冰岛那篇两段（各 200 字上下，切成两段）：一段讲火山和板块，一段讲买菜；火山那篇只讲火山；购物那篇只讲买菜
    const VOL = '冰岛的火山和板块裂谷：大西洋中脊从岛上穿过，板块每年分开两厘米。'.repeat(6)
    const BUY = '出发前买菜：牛奶、鸡蛋、面包、黄油。'.repeat(10)
    put(vault, '旅行/冰岛.md', `# 冰岛\n\n${VOL}\n\n${BUY}\n`)
    put(vault, '地理/火山.md', '# 火山\n\n大西洋中脊上的火山：板块分开的地方岩浆涌出来，形成裂谷。\n')
    put(vault, '生活/购物.md', '# 购物\n\n今天买菜：牛奶、鸡蛋、面包。\n')
    put(vault, '项目/周报.md', '# 周报\n\nThis week I finished the login page; payments next.\n')
    const ix = new Indexer({ root: vault, userData: join(root, 'ud'), indexDir: join(root, 'ud', 's'), embedder: fakeEmbedder(), readPdf: readPdfText, onStatus: () => undefined })
    expect(ix.built).toBe(false)
    await ix.scan()
    expect(ix.built).toBe(true)
    expect(ix.model).toBe('fake')

    const r = await ix.related(['旅行/冰岛.md', '地理/火山.md', '不在库里.md'], 2)
    const ice = r.get('旅行/冰岛.md')!
    expect(ice).toHaveLength(2)
    expect(ice.map((h) => h.path).sort()).toEqual(['地理/火山.md', '生活/购物.md'])
    expect(ice.every((h) => h.path !== '旅行/冰岛.md')).toBe(true)
    expect(ice[0]!.score).toBeGreaterThanOrEqual(ice[1]!.score)
    // 配对：和火山那篇配的是冰岛的火山段，和购物那篇配的是买菜段
    const volcano = ice.find((h) => h.path === '地理/火山.md')!
    expect(volcano.mine).toBe(VOL)
    expect(volcano.theirs).toBe('大西洋中脊上的火山：板块分开的地方岩浆涌出来，形成裂谷。')
    const shop = ice.find((h) => h.path === '生活/购物.md')!
    expect(shop.mine).toBe(BUY)
    expect(shop.theirs).toBe('今天买菜：牛奶、鸡蛋、面包。')
    // 火山那篇最像的是冰岛
    expect(r.get('地理/火山.md')![0]).toMatchObject({ path: '旅行/冰岛.md', theirs: VOL })
    expect(r.get('不在库里.md')).toEqual([])
  })

  it('换大模型时这份先不算向量（holdEmbed）：扫库不再算，查询照用已有的；resumeEmbed 接着算', async () => {
    const vault = join(root, '停')
    put(vault, 'a.md', '# a\n\n冰岛的火山。\n')
    let embeds = 0
    const base = fakeEmbedder()
    const counted = { ...base, embed: async (t: string[], k: 'query' | 'passage') => (k === 'passage' && embeds++, base.embed(t, k)) }
    const ix = new Indexer({ root: vault, userData: join(root, 'ud4'), indexDir: join(root, 'ud4', 's'), embedder: counted, readPdf: readPdfText, onStatus: () => undefined })
    await ix.scan()
    expect(embeds).toBe(1)
    ix.holdEmbed()
    put(vault, 'b.md', '# b\n\n冰岛的火山和板块。\n')
    await ix.scan()
    expect(embeds).toBe(1)
    expect(ix.state.phase).toBe('ready')
    expect((await ix.related(['a.md'], 5)).get('a.md')).toEqual([])
    ix.resumeEmbed()
    await ix.scan()
    expect(embeds).toBe(2)
    expect((await ix.related(['a.md'], 5)).get('a.md')!.map((h) => h.path)).toEqual(['b.md'])
  })

  it('没有模型（按意思找关着）：一篇都没有', async () => {
    const vault = join(root, '空')
    put(vault, 'a.md', '# a\n\n正文。\n')
    const ix = new Indexer({ root: vault, userData: join(root, 'ud2'), indexDir: join(root, 'ud2', 's'), embedder: null, readPdf: readPdfText, onStatus: () => undefined })
    await ix.scan()
    expect(ix.model).toBeNull()
    expect(ix.built).toBe(false)
    expect((await ix.related(['a.md'], 5)).size).toBe(0)
  })

  it('PDF 也能当候选：theirs 是那一页的字', async () => {
    const vault = join(root, 'pdf库')
    put(vault, '笔记.md', '# 笔记\n\nEigenvalues and eigenvectors of a matrix.\n')
    put(vault, '别的.md', '# 别的\n\n周末去爬山。\n')
    const ix = new Indexer({
      root: vault,
      userData: join(root, 'ud3'),
      indexDir: join(root, 'ud3', 's'),
      embedder: fakeEmbedder(),
      readPdf: async () => ({ data: new Uint8Array(), pages: [[{ id: 'p1-b0', page: 1, kind: 'text', text: 'Eigenvalues of a matrix', x: 0, y: 0, w: 10, h: 10 }]], sizes: [[100, 100]] }),
      onStatus: () => undefined,
    })
    put(vault, '讲义.pdf', '%PDF-1.4 假的')
    await ix.scan()
    const r = (await ix.related(['笔记.md'], 1)).get('笔记.md')!
    expect(r[0]).toMatchObject({ path: '讲义.pdf', mine: 'Eigenvalues and eigenvectors of a matrix.', theirs: 'Eigenvalues of a matrix' })
  })
})
