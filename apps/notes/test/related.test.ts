// 右栏「相关」的纯函数（task-h7oy8，设计页 44 相关栏）：反查索引、那一句、分类、标题和块、「连上」写进原句（A1）、「撤掉」变回普通字
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { aliasesOf, blockLabel, blockLine, headingLine, keysOf, LinkIndex, linkIn, parseLinks, quoteOf, refKind, seqDir, unlinkIn, wordsOf } from '../src/main/related'

const AMDAHL = ['# 05-Amdahl定律', '', '## 2. Amdahl 定律公式', '', '加速比 a = 1/(s+p/N)。Gustafson 的反驳在下一篇。', '', '## 3. 数值表', '', '一张表。 ^tab1', ''].join('\n')

describe('反查索引', () => {
  it('双链、嵌入、[字](路径)、标题、块都认；代码块里的不算，属性里的记成「列了名字」', () => {
    const t = ['---', 'up: "[[05-Amdahl定律]]"', '---', '讲同一条定律：[[05-Amdahl定律|阿姆达尔]] 和 ![[05-Amdahl定律#^tab1]]。', '```', '[[05-Amdahl定律]]', '```', '[公式](../课/05-Amdahl定律.md#2.%20Amdahl%20定律公式)'].join('\n')
    const all = parseLinks('参考/H&P.md', t)
    expect(all[0]!.prop).toBe(true)
    expect(refKind(t, all[0]!)).toBe('bare')
    const refs = all.slice(1)
    expect(refs.map((r) => [r.key, r.anchor, r.embed, r.label, r.line])).toEqual([
      ['05-amdahl定律', '', false, '阿姆达尔', 3],
      ['05-amdahl定律', '^tab1', true, '05-Amdahl定律', 3],
      ['课/05-amdahl定律', '2. Amdahl 定律公式', false, '公式', 7],
    ])
  })

  it('按名字、路径后缀、别名都找得到；只重读变了的篇', () => {
    const ix = new LinkIndex()
    const a = '读到 [[05-Amdahl定律]] 那篇。'
    const texts = new Map([
      ['课/05-Amdahl定律.md', '---\naliases: [阿姆达尔定律]\n---\n# 05'],
      ['日记/1.md', a],
      ['日记/2.md', '又想起 [[阿姆达尔定律]]。'],
      ['日记/3.md', '[[课/05-Amdahl定律]]'],
    ])
    expect(ix.sync(texts)).toBe(4)
    const al = aliasesOf(texts.get('课/05-Amdahl定律.md')!)
    expect(al).toEqual(['阿姆达尔定律'])
    expect(ix.refsTo('课/05-Amdahl定律.md', al).map((r) => r.from).sort()).toEqual(['日记/1.md', '日记/2.md', '日记/3.md'])
    // 没变的不重读
    expect(ix.sync(texts)).toBe(0)
    texts.set('日记/1.md', '不再提了。')
    texts.delete('日记/3.md')
    expect(ix.sync(texts)).toBe(2)
    expect(ix.refsTo('课/05-Amdahl定律.md', al).map((r) => r.from)).toEqual(['日记/2.md'])
    expect(keysOf('课/05-Amdahl定律.md')).toEqual(['课/05-amdahl定律', '05-amdahl定律'])
  })
})

describe('那一句和分类', () => {
  it('那一句去掉记号，链接那几个字打底色', () => {
    const t = '- **05-Amdahl定律** 讲得最细：[[05-Amdahl定律]] 和 [[06-Gustafson|Gustafson]] 互补。'
    const r = parseLinks('x.md', t)[0]!
    const q = quoteOf(t, r)
    expect(q.text).toBe('05-Amdahl定律 讲得最细：05-Amdahl定律 和 Gustafson 互补。')
    expect(q.text.slice(...q.mark!)).toBe('05-Amdahl定律')
  })

  it('长句截在链接两边', () => {
    const t = '前'.repeat(300) + '[[目标]]' + '后'.repeat(300)
    const q = quoteOf(t, parseLinks('x.md', t)[0]!, 60)
    expect(q.text.length).toBeLessThanOrEqual(62)
    expect(q.text.slice(...q.mark!)).toBe('目标')
  })

  it('正文一句、只列名字、前后篇、末尾「相关：」', () => {
    const t = ['讲 HPC 的限制时指到 [[A]]。', '- [[A]]', '上一篇：[[A]] · 下一篇：[[B]]', '相关：[[A]]、[[C]]'].join('\n')
    const refs = parseLinks('x.md', t).filter((r) => r.key === 'a')
    expect(refs.map((r) => refKind(t, r))).toEqual(['sentence', 'bare', 'seq', 'related-line'])
    expect(seqDir(t, refs[2]!)).toBe('prev')
    // 目录页（链接很多的那种）里列表的一行：只算列了名字
    expect(refKind(t, refs[0]!, true)).toBe('sentence')
    const hub = '- **Amdahl 定律** → [[A]] · [[B]]'
    expect(refKind(hub, parseLinks('x.md', hub)[0]!, true)).toBe('bare')
  })

  it('标题、块编号指着第几行；块那一段的开头几个字', () => {
    expect(headingLine(AMDAHL, '2. Amdahl 定律公式')).toBe(2)
    expect(headingLine(AMDAHL, '05-Amdahl定律#3. 数值表')).toBe(6)
    expect(headingLine(AMDAHL, '没有这节')).toBe(-1)
    expect(blockLine(AMDAHL, 'tab1')).toBe(8)
    expect(blockLabel(AMDAHL, 8)).toBe('一张表。')
  })
})

describe('连上（A1）和撤掉', () => {
  it('第一处提到的字变成链接，字不变；撤掉一字节不差地回去', () => {
    const words = wordsOf('Gustafson-Law（古斯塔夫森定律）')
    expect(words).toContain('Gustafson')
    const e = linkIn(AMDAHL, 'Gustafson-Law（古斯塔夫森定律）', words)
    expect(e.words).toBe('Gustafson')
    expect(e.text).toContain('[[Gustafson-Law（古斯塔夫森定律）|Gustafson]] 的反驳')
    expect(e.text.replace('[[Gustafson-Law（古斯塔夫森定律）|Gustafson]]', 'Gustafson')).toBe(AMDAHL)
    const back = unlinkIn(e.text, 'x.md', e.line, ['gustafson-law（古斯塔夫森定律）'])
    expect(back).toBe(AMDAHL)
  })

  it('标题、已有链接、代码里的字不动；正文没有就加在文末「相关：」', () => {
    const t = '# 加速比\n\n见 [[加速比定义]]，`加速比` 是代码。\n'
    const e = linkIn(t, '加速比', ['加速比'])
    expect(e.words).toBeNull()
    expect(e.text).toBe('# 加速比\n\n见 [[加速比定义]]，`加速比` 是代码。\n\n相关：[[加速比]]\n')
    const again = linkIn(e.text, '别的', ['不在正文里'])
    expect(again.text).toBe('# 加速比\n\n见 [[加速比定义]]，`加速比` 是代码。\n\n相关：[[加速比]]、[[别的]]\n')
    // 撤掉「相关：」行里的一项、再撤最后一项：整行连同前面的空行一起去掉
    const one = unlinkIn(again.text, 'x.md', again.line, ['别的'])
    expect(one).toBe(e.text)
    expect(unlinkIn(one!, 'x.md', e.line, ['加速比'])).toBe(t)
  })

  it('英文按整词认，先在判断时那一句里找', () => {
    const t = 'Lawyer 不算。\n\nLaw 在第二段。\n\n第三段也写 Law。'
    const e = linkIn(t, 'X', ['Law'], '第三段也写')
    expect(e.line).toBe(4)
    expect(e.text.split('\n')[4]).toBe('第三段也写 [[X|Law]]。')
  })

  it('[字](路径) 撤掉变回字', () => {
    const t = '见 [公式](../课/A.md#公式) 那节。'
    expect(unlinkIn(t, '日记/x.md', 0, keysOf('课/A.md'))).toBe('见 公式 那节。')
  })
})

// 量数：CN_REAL_VAULT=<库> 时在真库上量建索引、查一篇要多久（平时跳过）
describe.skipIf(!process.env.CN_REAL_VAULT)('真库上量', () => {
  it('3000 篇：第一次建索引、以后只查表', async () => {
    const root = process.env.CN_REAL_VAULT!
    const texts = new Map<string, string>()
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n.startsWith('.')) continue
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (n.endsWith('.md')) texts.set(relative(root, p), readFileSync(p, 'utf8'))
      }
    }
    walk(root)
    const ix = new LinkIndex()
    let t = performance.now()
    ix.sync(texts)
    const build = performance.now() - t
    t = performance.now()
    ix.sync(texts)
    const again = performance.now() - t
    const target = [...texts.keys()].find((p) => p.endsWith('05-Amdahl定律.md'))!
    t = performance.now()
    const refs = ix.refsTo(target, aliasesOf(texts.get(target)!))
    for (const r of refs) quoteOf(texts.get(r.from)!, r)
    const query = performance.now() - t
    // 每篇都查一遍：最慢的那篇
    let worst = 0
    let worstPath = ''
    let worstRefs = 0
    for (const p of texts.keys()) {
      const s = performance.now()
      const rs = ix.refsTo(p)
      for (const r of rs) quoteOf(texts.get(r.from)!, r)
      const d = performance.now() - s
      if (d > worst) [worst, worstPath, worstRefs] = [d, p, rs.length]
    }
    console.log(JSON.stringify({ notes: texts.size, buildMs: Math.round(build), againMs: +again.toFixed(2), amdahlRefs: refs.length, amdahlMs: +query.toFixed(2), worstMs: +worst.toFixed(2), worstPath, worstRefs }))
    expect(build).toBeLessThan(3000)
    expect(again).toBeLessThan(50)
  }, 120_000)
})
