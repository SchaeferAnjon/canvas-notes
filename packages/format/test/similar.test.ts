import { describe, expect, it } from 'vitest'
import { commonPassage, estimate, findSimilarPairs, jaccard, minhash, plainText, shingles, similarity } from '../src'

const PARIS_A = `---
created: 2026-11-08 10:00
source: https://example.com/paris-a
---
# 巴黎深度漫游指南（上）

第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。
<!-- card id=a1 x=10 y=20 -->
晚上去圣日耳曼的小酒馆吃饭。
`

const PARIS_B = `# 巴黎自由行全景指南

第一天从拉丁区出发，先去先贤祠，再穿过卢森堡公园。下午沿塞纳河走到西岱岛，看圣礼拜堂的彩色玻璃，傍晚在巴黎圣母院前的广场坐一会儿。
第二天去卢浮宫，留一整天。
`

const ICELAND = `# 冰岛自驾

一号公路一圈大约 1330 公里，冬天很多路段会封，出发前每天看 road.is 的路况，风大的时候不要开车门太猛。
`

const RICH = `# 所思所想

Seek wealth, not money or status. Wealth is having assets that earn while you sleep.
`

describe('找重复：3-gram + MinHash', () => {
  it('去掉 frontmatter、注释、网址和记号，按字切 3-gram', () => {
    expect(plainText(PARIS_A)).not.toMatch(/created|card id|https/)
    expect(plainText('**财富**靠[专长](https://x.y)，见 [[工作流|这里]]。')).toBe('财富靠专长见工作流')
    expect([...shingles('冰岛自驾')]).toEqual(['冰岛自', '岛自驾'])
    expect(shingles('ab').size).toBe(0)
  })

  it('MinHash 估出来的相似度和真的 Jaccard 差不多', () => {
    const a = shingles(plainText(PARIS_A))
    const b = shingles(plainText(PARIS_B))
    const real = jaccard(a, b)
    expect(Math.abs(estimate(minhash(a), minhash(b)) - real)).toBeLessThan(0.15)
    expect(estimate(minhash(a), minhash(a))).toBe(1)
  })

  it('同一段内容的两篇找得出来，不相干的不报；结果固定、像的在前', () => {
    const docs = [
      { id: '素材/巴黎/巴黎深度漫游指南（上）.md', text: PARIS_A },
      { id: '收件箱/巴黎自由行全景指南.md', text: PARIS_B },
      { id: '冰岛自驾.md', text: ICELAND },
      { id: '所思所想.md', text: RICH },
      { id: '短.md', text: '极光' },
    ]
    const pairs = findSimilarPairs(docs)
    expect(pairs).toHaveLength(1)
    const p = pairs[0]!
    expect([p.a, p.b]).toEqual(['收件箱/巴黎自由行全景指南.md', '素材/巴黎/巴黎深度漫游指南（上）.md'])
    expect(p.score).toBeGreaterThan(0.4)
    expect(p.score).toBeLessThanOrEqual(1)
    expect(p.passage).toContain('先贤祠')
    expect(Array.from(p.passage.replace(/…$/, '')).length).toBeLessThanOrEqual(40)
    expect(findSimilarPairs([...docs].reverse())).toEqual(pairs)
  })

  it('一模一样的两篇相似度接近 1', () => {
    const pairs = findSimilarPairs([
      { id: 'a.md', text: ICELAND },
      { id: 'b.md', text: ICELAND.replace('# 冰岛自驾', '# 冰岛自驾（副本）') },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.score).toBeGreaterThanOrEqual(0.9)
  })

  it('短的那篇几乎整段在长的那篇里，也算可能重复', () => {
    const long = PARIS_B + '\n' + ICELAND + '\n' + RICH + '\n第三天去奥赛博物馆和蒙马特高地，晚上在塞纳河上坐游船，船上风很大要多穿一件。'
    const pairs = findSimilarPairs([
      { id: 'long.md', text: long },
      { id: 'clip.md', text: PARIS_B },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.containment).toBeGreaterThanOrEqual(0.8)
    expect(pairs[0]!.score).toBeLessThan(0.4)
  })

  it('两篇没共同的字时相似度是 0，最长共同段是空的', () => {
    expect(similarity(ICELAND, '财富是睡觉时也在赚钱的资产').score).toBe(0)
    expect(commonPassage('abc', 'xyz')).toBe('')
    expect(similarity(PARIS_A, PARIS_B).passage).toContain('卢森堡公园')
    // 给人看的那段保留原来的大小写
    expect(similarity('云量低于三成、KP 指数到 3 以上就出门', '云量低于三成、KP 指数到 3 以上就开车').passage).toBe('云量低于三成 KP 指数到 3 以上就')
  })

  // 单独跑约几百毫秒；整套单元测试并行跑、CPU 忙时会到两秒上下，所以上限放到 6 秒：防的是退化成逐对比较（那样要几十秒）
  it('一千篇几秒内比完（不是逐对比较）', () => {
    const docs = Array.from({ length: 1000 }, (_, i) => ({
      id: `n${i}.md`,
      text: `第 ${i} 篇：${'随手记下的一句话，'.repeat(1 + (i % 5))}编号 ${i * 7919} 结尾 ${String(i).repeat(6)}`,
    }))
    const t = performance.now()
    findSimilarPairs(docs)
    expect(performance.now() - t).toBeLessThan(6000)
  })
})
