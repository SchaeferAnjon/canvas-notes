// 真的本机小模型（multilingual-e5-small）：模型在 apps/notes/resources/models/（pnpm install 时 scripts/fetch-model.mjs 下好），不联网。
// 1000 篇的测速：CN_BENCH=1 npx vitest run apps/notes/test/search-model.test.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeBigVault } from '../e2e/fixtures/big-vault'
import { e5Embedder, type Embedder } from '../src/main/search/embedder'
import { Indexer } from '../src/main/search/indexer'
import { readPdfText } from '../src/main/search/pdf-read'

const MODEL = join(__dirname, '../resources/models/multilingual-e5-small')
const have = existsSync(join(MODEL, 'onnx', 'model_quantized.onnx'))
if (!have) console.warn(`没有本机模型（${MODEL}），跑一次 node apps/notes/scripts/fetch-model.mjs`)

describe.skipIf(!have)('本机小模型按意思找', () => {
  let root: string
  let e5: Embedder
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cn-e5-'))
    e5 = await e5Embedder(MODEL)
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('「矩阵怎么变换」找到写「线性映射」的那篇，「去哪玩」找到爬山', async () => {
    const vault = join(root, '库')
    const put = (p: string, t: string) => {
      mkdirSync(join(vault, p, '..'), { recursive: true })
      writeFileSync(join(vault, p), t)
    }
    put('课程/线性代数/第3讲 笔记.md', '# 线性映射\n\n满足 T(u+v)=T(u)+T(v) 和 T(cv)=cT(v) 的映射叫线性映射，每个线性映射在一组基下都能写成一个矩阵。\n')
    put('生活/周末.md', '周末去爬山，带上水和三明治，山顶看日落。\n')
    put('生活/购物.md', '今天的购物清单：牛奶、鸡蛋、面包。\n')
    put('项目/周报.md', '这周把登录页改完了，下周做支付。\n')
    const ix = new Indexer({ root: vault, userData: join(root, 'ud'), indexDir: join(root, 'ud', 'search'), embedder: e5, readPdf: readPdfText, onStatus: () => undefined })
    await ix.scan()
    expect((await ix.meaning('矩阵怎么变换'))[0]!.path).toBe('课程/线性代数/第3讲 笔记.md')
    expect((await ix.meaning('周末去哪玩'))[0]!.path).toBe('生活/周末.md')
    expect((await ix.meaning('买菜'))[0]!.path).toBe('生活/购物.md')
    // 不沾边的不硬凑：问线性代数时购物清单不在结果里
    expect((await ix.meaning('矩阵怎么变换')).map((h) => h.path)).not.toContain('生活/购物.md')
  })

  it.skipIf(!process.env.CN_BENCH)('1000 篇：建索引多久、查一次多久', async () => {
    const vault = join(root, '大库')
    makeBigVault(vault, 1000)
    let chunks = 0
    const ix = new Indexer({
      root: vault,
      userData: join(root, 'ud2'),
      indexDir: join(root, 'ud2', 'search'),
      embedder: e5,
      readPdf: readPdfText,
      onStatus: (s) => {
        if (s.phase === 'embed') chunks = s.total
      },
    })
    const t0 = performance.now()
    await ix.scan()
    const build = performance.now() - t0
    const qs = ['矩阵怎么变换', '冰岛自驾看极光', '怎么管理时间', '写作习惯', '编程里的函数测试', '读书笔记怎么做', '会议记录', '产品设计灵感']
    await ix.meaning('热身')
    const times: number[] = []
    for (let i = 0; i < 5; i++)
      for (const q of qs) {
        const t = performance.now()
        await ix.meaning(q)
        times.push(performance.now() - t)
      }
    times.sort((a, b) => a - b)
    const t1 = performance.now()
    const ix2 = new Indexer({ root: vault, userData: join(root, 'ud2'), indexDir: join(root, 'ud2', 'search'), embedder: e5, readPdf: readPdfText, onStatus: () => undefined })
    await ix2.scan()
    const reopen = performance.now() - t1
    console.log(
      `1000 篇（${chunks} 段）：建索引 ${(build / 1000).toFixed(1)} 秒；查一次中位数 ${times[times.length >> 1]!.toFixed(1)} ms，最慢 ${times[times.length - 1]!.toFixed(1)} ms；重开（都没变）${reopen.toFixed(0)} ms`,
    )
    expect(ix.state.files).toBeGreaterThanOrEqual(1000)
  }, 600_000)
})
