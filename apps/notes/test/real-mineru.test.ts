/**
 * 真的 MinerU 跑一次（只读用本机已经装好的那份，不装、不升级）：CN_REAL_MINERU=1 npx vitest run apps/notes/test/real-mineru.test.ts
 * 下载公开的 arXiv 1512.03385v1（ResNet，12 页）到临时目录，后台解析一遍（约 40 秒），看第 5 页的表格成表、第 3 页的公式成 LaTeX、
 * 第 5 页的矢量图（训练曲线）框得到；测完删临时目录。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { blocksText, mineruFigure, tableRows } from '@cn/format'
import { afterAll, describe, expect, it } from 'vitest'
import { convertMiddle } from '../src/main/mineru/convert'
import { findMineru, realFindEnv } from '../src/main/mineru/find'
import { MineruRunner } from '../src/main/mineru/run'

const on = process.env.CN_REAL_MINERU === '1'
const dir = mkdtempSync(join(tmpdir(), 'cn-real-mineru-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!on)('真的 MinerU', () => {
  it('找到本机的一份，解析 ResNet：表格成表、公式成 LaTeX、矢量图框到', { timeout: 300_000 }, async () => {
    const f = await findMineru(realFindEnv({ home: homedir(), shell: true }))
    expect(f.state).toBe('ready')
    if (f.state !== 'ready') return
    const res = await fetch('https://arxiv.org/pdf/1512.03385v1', { signal: AbortSignal.timeout(60_000) })
    expect(res.ok).toBe(true)
    const pdf = join(dir, 'resnet.pdf')
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()))
    const out = join(dir, 'raw.json')
    const t0 = Date.now()
    const err = await new Promise<string | null>((done) => {
      const r = new MineruRunner({
        command: () => f.path,
        tmpRoot: join(dir, 'tmp'),
        home: homedir(),
        onProgress: () => {},
        onDone: () => done(null),
        onFailed: (_j, e) => done(e),
      })
      r.enqueue({ key: 'resnet', pdf, pages: 12, out })
    })
    expect(err).toBeNull()
    console.log(`MinerU ${f.version}（${f.from}）解析 12 页用了 ${Math.round((Date.now() - t0) / 1000)} 秒`)
    const c = convertMiddle(readFileSync(out, 'utf8'), { pdf: 'resnet.pdf', pages: 12, version: f.version })
    expect(c.pages).toHaveLength(12)
    expect(c.sizes![4]).toEqual([612, 792])

    // 第 5 页：Table 1（网络结构）是表，格子里有 layer name、conv1；表注是 caption
    const p5 = c.pages[4]!
    const tables = p5.filter((b) => b.kind === 'table')
    expect(tables.length).toBeGreaterThanOrEqual(1)
    const rows = tableRows(tables[0]!.text)
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.flat().map((x) => x.text).join(' ')).toMatch(/layer name.*conv1/)
    expect(p5.some((b) => b.kind === 'caption' && /^Table 1\./.test(b.text))).toBe(true)
    expect(blocksText(p5)).toMatch(/\[表 p5-b\d+\]\nlayer name \| output size/)

    // 第 3 页：公式 (1)、(2) 是 LaTeX
    const formulas = c.pages[2]!.filter((b) => b.kind === 'formula').map((b) => b.text)
    expect(formulas.length).toBeGreaterThanOrEqual(2)
    expect(formulas.join('\n')).toMatch(/\\mathcal \{ F \}.*\\tag\{1\}/)
    // 正文里的行内公式写成 $…$
    expect(c.pages[2]!.some((b) => b.kind === 'text' && /\$\\mathcal \{ H \}/.test(b.text))).toBe(true)

    // 第 5 页：Figure 4 的两张训练曲线是矢量画的（pdf.js 没有图片块），MinerU 框得到，配图就用它的框
    const figs = p5.filter((b) => b.kind === 'image')
    expect(figs.length).toBeGreaterThanOrEqual(2)
    for (const g of figs) {
      expect(g.w).toBeGreaterThan(100)
      expect(g.y).toBeGreaterThan(200)
      expect(g.y + g.h).toBeLessThan(420)
    }
    // AI 回答给了左边那张图的大概位置：配图取 MinerU 的框
    const left = figs.sort((a, b) => a.x - b.x)[0]!
    const pick = mineruFigure(p5, { w: 612, h: 792 }, { rect: [0.12, 0.3, 0.38, 0.2] })
    expect(pick?.block).toBe(left.id)
    // 页码、arXiv 页边竖排字丢掉
    expect(c.pages[0]!.some((b) => /arXiv:1512/.test(b.text))).toBe(false)
  })
})
