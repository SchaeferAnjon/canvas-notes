/**
 * 费曼的整套流程（shared/feynman/flow.ts、material.ts），AI 用 CN_AI_FAKE 那一套假回答（fake.ts），库是内存里的几篇：
 * 四种材料入口都能抽要点（导图一支、几张卡含剪藏卡 / 子白板卡 / PDF 框选截图卡、一个词、一整份 PDF），拆点，
 * 要一起盖住的东西，一整轮讲 → 追问 → 说穿 → 判定，teaching.md 第 6 节四段口语稿的判定。
 */
import { describe, expect, it } from 'vitest'
import type { ExtractResult } from '../src/shared/feynman/api'
import { addRound, appendEntry, findRounds, putBlock, setMeta } from '../src/shared/feynman/doc'
import { type AskQ, extract, type FlowDeps, judge, turn } from '../src/shared/feynman/flow'
import type { GatherDeps } from '../src/shared/feynman/material'
import { courseSummary, passesBefore, roundsIn } from '../src/shared/feynman/progress'
import { newMeta } from '../src/shared/feynman/round'
import type { Entry, FeynmanMeta } from '../src/shared/feynman/types'

const PDF = '课程/线代/第2讲 线性代数.pdf'
const FILES: Record<string, string> = {
  '课程/线代/第2讲 导图.md': `---
type: board
白板样式: 导图
第几讲: 2
read-along: https://zh.d2l.ai/
---
- 线性代数
  - 范数
    - 量向量有多大
    - 放大 α 倍是 |α| 倍
    - 三角不等式
    - 非负
  - 矩阵
    - a
    - b
    - c
    - d
    - e
    - f

## 剪藏

<!-- card id=k1 x=900 y=100 -->
> 范数是向量的大小，L2 范数就是平方和开根号。
> —— [2.3. 线性代数](https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html#norms)

<!-- card id=k2 x=900 y=300 -->
> ‖αx‖ = |α|‖x‖
> —— [2.3. 线性代数](https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html#norms)

<!-- card id=k3 x=900 y=500 -->
> 另一页讲的矩阵乘法。
> —— [2.4. 微积分](https://zh.d2l.ai/chapter_preliminaries/calculus.html)

讲范数的另一张自己写的卡：范数不能是负的。

[[范数子白板]]

![[剪藏 范数.md]]
`,
  '课程/线代/范数子白板.md': '---\ntype: board\n---\n\n## 列\n\n范数满足三角不等式：两段路不比直走短。\n\n范数的齐次性。\n',
  '课程/线代/剪藏 范数.md': '---\nsource: https://example.com/norm\n---\n> 范数（norm）给向量一个长度。\n',
  '课程/线代/读PDF 第2讲.md': `---
type: board
---

## 第 5 页

![我框的|360](附件/框选/p5.png)
[第 5 页](第2讲%20线性代数.pdf#page=5&rect=0.1,0.2,0.3,0.2) 梯度下降：沿负梯度走。

## 第 6 页

[第 5 页](第2讲%20线性代数.pdf#page=5) 这一页的另一张卡。
`,
  '笔记/优化.md': '# 优化\n\n梯度下降从一个初始猜测出发，每一步沿负梯度走，学习率太大会来回跳。\n',
}
const PDF_PAGES = [
  { page: 1, text: '第2讲 线性代数\n标量和向量' },
  { page: 2, text: '范数\n‖x‖ 量的是向量有多大' },
  { page: 3, text: '梯度下降\nθ := θ − α∇L' },
]

function deps(log: AskQ[] = []): FlowDeps {
  const g: GatherDeps = {
    read: async (p) => FILES[p] ?? null,
    notes: async () => Object.keys(FILES),
    search: async (w) => Object.keys(FILES).filter((p) => FILES[p]!.includes(w) && !p.includes('导图')),
    pdf: async (p) => (p === PDF ? PDF_PAGES : null),
    hasFile: async (p) => p === '课程/线代/附件/框选/p5.png',
    findFile: async (name) => (name.endsWith('.pdf') ? PDF : null),
  }
  return {
    gather: g,
    ask: async (q) => {
      log.push(q)
      return q.fake()
    },
    by: (img) => (img ? 'Claude Code · Opus 5.5（看图）' : 'Claude Code · Opus 5.5'),
  }
}

const draftOf = (r: ExtractResult) => {
  if (r.kind !== 'draft') throw new Error(`应该直接给「这次要讲到」，给的是 ${r.kind}`)
  return r.draft
}

describe('四种材料都能抽要点', () => {
  it('导图的一支：这个节点和它下面全部；配对的网页一起盖住；剪自同一页、讲同一件事的卡也盖', async () => {
    const log: AskQ[] = []
    const d = draftOf(await extract({ refs: [{ kind: 'map', path: '课程/线代/第2讲 导图.md', node: '0.0', text: '范数' }] }, deps(log)))
    expect(d.topic).toBe('范数')
    expect(d.points.filter((p) => p.kind === 'core').map((p) => p.text)).toEqual(['量的是向量有多大', '放大 α 倍会怎样', '两段路和直走', '能不能是负的'])
    expect(d.points.find((p) => p.kind === 'extra')!.text).toBe('L2 和 L1 怎么算')
    expect(d.lecture).toBe(2)
    expect(d.basisLine).toBe('照导图「范数」这一支和配对的网页核对')
    expect(log[0]!.prompt).toContain('- 范数\n  - 量向量有多大')
    expect(d.cover).toContainEqual({ kind: 'web', url: 'https://zh.d2l.ai/' })
    // 讲同一件事的卡（写着「范数」的），矩阵那张不盖
    const heads = d.cover.filter((c) => c.kind === 'card').map((c) => (c.kind === 'card' ? c.head : ''))
    expect(heads.some((h) => h.includes('范数不能是负的'))).toBe(true)
    expect(heads.some((h) => h.includes('矩阵乘法'))).toBe(false)
    expect(log.map((q) => q.kind)).toEqual(['extract', 'same'])
  })

  it('导图一支超过 5 个子枝：子枝各当一个点让你挑，这一支变串讲；挑了一个再抽', async () => {
    const r = await extract({ refs: [{ kind: 'map', path: '课程/线代/第2讲 导图.md', node: '0.1', text: '矩阵' }] }, deps())
    expect(r.kind).toBe('pick')
    if (r.kind !== 'pick') return
    expect(r.why).toBe('branch')
    expect(r.items.map((x) => x.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(r.chain).toMatchObject({ name: '矩阵', scope: 'section' })
    const d = draftOf(await extract({ refs: [], pick: r.items[2]! }, deps()))
    expect(d.from).toEqual([{ kind: 'map', path: '课程/线代/第2讲 导图.md', node: '0.1.2', text: 'c' }])
    expect(d.siblings).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('路径变了按字找回那一支', async () => {
    const d = draftOf(await extract({ refs: [{ kind: 'map', path: '课程/线代/第2讲 导图.md', node: '0.9', text: '范数' }] }, deps()))
    expect(d.from[0]).toMatchObject({ node: '0.0', text: '范数' })
  })

  it('白板上选中的几张卡：剪藏卡带出处页，剪自同一页的另一张一起盖；子白板卡读里面的卡；嵌入的剪藏笔记读摘要；能和导图节点混选', async () => {
    const log: AskQ[] = []
    const board = '课程/线代/第2讲 导图.md'
    const d = draftOf(
      await extract(
        {
          refs: [
            { kind: 'card', path: board, id: 'k1', head: '' },
            { kind: 'card', path: board, head: '[[范数子白板]]' },
            { kind: 'card', path: board, head: '![[剪藏 范数.md]]' },
            { kind: 'map', path: board, node: '0.0', text: '范数' },
          ],
          board,
        },
        deps(log),
      ),
    )
    const prompt = log[0]!.prompt
    expect(prompt).toContain('网页剪藏「2.3. 线性代数」（出处：https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html#norms）')
    expect(prompt).toContain('子白板「范数子白板」：\n范数满足三角不等式')
    expect(prompt).toContain('（出处：https://example.com/norm）')
    expect(prompt).toContain('范数（norm）给向量一个长度')
    expect(d.basisLine).toBe('照导图「范数」这一支、选中的 3 张卡和配对的网页核对')
    const cards = d.cover.filter((c) => c.kind === 'card')
    // 选中的三张、剪自同一页的 k2；另一页的 k3 不盖
    expect(cards.filter((c) => c.kind === 'card' && c.why === 'picked').length).toBe(3)
    expect(cards.find((c) => c.kind === 'card' && c.id === 'k2')).toMatchObject({ why: 'same-page' })
    expect(cards.some((c) => c.kind === 'card' && c.id === 'k3')).toBe(false)
  })

  it('读 PDF 的配对笔记转成的白板：卡里的框选截图交给看图那家，出处写回那份 PDF 那一页，那份 PDF 一起盖；同一页的另一张卡也盖', async () => {
    const log: AskQ[] = []
    const board = '课程/线代/读PDF 第2讲.md'
    const d = draftOf(await extract({ refs: [{ kind: 'card', path: board, head: '![我框的|360](附件/框选/p5.png)' }], board }, deps(log)))
    const q = log.find((x) => x.kind === 'extract')!
    expect(q.images).toEqual([{ path: '课程/线代/附件/框选/p5.png' }])
    expect(q.prompt).toContain('第2讲 线性代数.pdf 第 5 页')
    expect(q.prompt).toContain('[图 1]')
    expect(d.by).toBe('Claude Code · Opus 5.5（看图）')
    expect(d.cover).toContainEqual({ kind: 'pdf', path: PDF, page: 5 })
    expect(d.points[0]!.src).toEqual({ kind: 'pdf', path: PDF, page: 5 })
    expect(d.cover.some((c) => c.kind === 'card' && c.why === 'same-page' && c.head.includes('这一页的另一张卡'))).toBe(true)
  })

  it('直接写一个词：库里找相关笔记当材料；找不到按常识，列头写「没有材料，AI 自己定的要点」', async () => {
    const log: AskQ[] = []
    const d = draftOf(await extract({ refs: [{ kind: 'word', word: '梯度下降' }] }, deps(log)))
    expect(d.topic).toBe('梯度下降')
    expect(log[0]!.prompt).toContain('笔记「优化」')
    expect(d.basisLine).toBe('照库里的 2 篇笔记核对')
    const none: AskQ[] = []
    const n = draftOf(await extract({ refs: [{ kind: 'word', word: '傅里叶变换' }] }, deps(none)))
    expect(n.noMaterial).toBe(true)
    expect(n.basisLine).toBe('没有材料，AI 自己定的要点')
    expect(n.topic).toBe('傅里叶变换')
    expect(none[0]!.prompt).toContain('按常识定要点；每条的凭什么都写「AI 判断」')
    expect(n.points.every((p) => p.basis === 'AI 判断')).toBe(true)
  })

  it('一整份 PDF：先给这一讲的知识点单子，不直接开讲；挑一个只读那几页；串讲这一讲读整份', async () => {
    const log: AskQ[] = []
    const r = await extract({ refs: [{ kind: 'pdf', path: PDF }] }, deps(log))
    expect(r.kind).toBe('pick')
    if (r.kind !== 'pick') return
    expect(r.why).toBe('pdf')
    expect(r.items.map((x) => x.name)).toEqual(['第2讲 线性代数', '范数', '梯度下降'])
    expect(log.map((q) => q.kind)).toEqual(['list'])
    const d = draftOf(await extract({ refs: [], pick: r.items[2]! }, deps(log)))
    expect(d.topic).toBe('梯度下降')
    expect(d.from).toEqual([{ kind: 'pdf', path: PDF, pages: [3, 3] }])
    expect(d.cover).toContainEqual({ kind: 'pdf', path: PDF })
    expect(d.lecture).toBe(2)
    expect(d.siblings).toEqual(['第2讲 线性代数', '范数', '梯度下降'])
    expect(log[1]!.prompt).toContain('θ := θ − α∇L')
    expect(log[1]!.prompt).not.toContain('标量和向量')
    const chain = draftOf(await extract({ refs: [], pick: r.chain! }, deps()))
    expect(chain.scope).toBe('section')
  })

  it('核心超过 5 条：分成几个点让你挑（挑了直接用抽好的，不再问）；「就讲这一整个」并成一个', async () => {
    const many = '课程/多.md'
    FILES[many] = '---\ntype: board\n---\n\n' + Array.from({ length: 8 }, (_, i) => `第${i + 1}条要讲的说法。`).join('\n\n') + '\n'
    const refs = Array.from({ length: 8 }, (_, i) => ({ kind: 'card' as const, path: many, head: `第${i + 1}条要讲的说法。` }))
    const log: AskQ[] = []
    const r = await extract({ refs }, deps(log))
    expect(r.kind).toBe('pick')
    if (r.kind !== 'pick') return
    expect(r.why).toBe('many-cores')
    expect(r.items.length).toBe(2)
    const d = draftOf(await extract({ refs, pick: r.items[1]! }, deps(log)))
    expect(d.points.length).toBe(3)
    expect(log.filter((q) => q.kind === 'extract').length).toBe(1)
    const all = draftOf(await extract({ refs, noSplit: true }, deps()))
    expect(all.points.filter((p) => p.kind === 'core').map((p) => p.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'])
    delete FILES[many]
  })

  it('一次最多 12 张卡', async () => {
    const refs = Array.from({ length: 13 }, (_, i) => ({ kind: 'card' as const, path: 'x.md', head: String(i) }))
    await expect(extract({ refs }, deps())).rejects.toThrow('一次最多讲 12 张卡')
  })
})

/** 照 teaching.md 第 6 节走一轮：自己讲一段，学生问，你答（答案照稿子），讲完判 */
async function talk(own: string, answers: string[]): Promise<{ meta: FeynmanMeta; text: string; said: string[] }> {
  const d = draftOf(await extract({ refs: [{ kind: 'word', word: '梯度下降' }] }, deps()))
  let meta = newMeta(d, { today: '2026-11-23', id: 'f-t' })
  let text = addRound('', meta)
  const said: string[] = []
  const entries = () => findRounds(text)[0]!.entries.map((e: Entry) => ({ kind: e.kind, text: e.text }))
  text = appendEntry(text, meta.id, 'me', own)
  for (let i = 0; ; i++) {
    const t = await turn({ reqId: 1, meta, entries: entries() }, deps())
    meta = t.meta
    if (t.reveal) text = appendEntry(text, meta.id, 'reveal', t.reveal, t.by)
    if (t.say) text = appendEntry(text, meta.id, t.act === 'confirm' ? 'confirm' : 'student', t.say, t.by)
    said.push(`${t.act}${t.point ? ':' + t.point : ''}${t.reveal ? '+reveal' : ''}`)
    text = setMeta(text, meta)
    if (t.act === 'done' || i >= answers.length) break
    text = appendEntry(text, meta.id, 'me', answers[i]!)
  }
  const j = await judge({ reqId: 2, meta, entries: entries(), today: '2026-11-23', prevPasses: 0 }, deps())
  text = setMeta(text, j.meta)
  for (const k of ['verdict', 'gaps', 'wording', 'full'] as const) text = putBlock(text, meta.id, k, j.blocks[k] ?? '', j.by)
  return { meta: j.meta, text, said }
}

describe('一整轮（假 AI）：teaching.md 第 6 节四段口语稿', () => {
  it('稿 1 口语很乱：过；只是噪声不算错', async () => {
    const r = await talk(
      '嗯 梯度下降呢 就是说 我们要找那个让损失最小的西塔 对吧 但是你又不能一个一个去试 那怎么办呢 就先随便猜一个西塔 然后看脚下这个坡 就是那个提度 嗯 梯度 坡往哪边下就往哪边走一小步 公式的话就是 新的西塔等于旧的西塔 减去 学习力乘以这个坡度 对 是减 因为要往下坡走嘛 比如说 x 等于二 t 等于四 从零开始 坡度是负八 减负八 西塔就变大了 变成零点八 然后一直这样走 走很多步就到碗底了 那个阿尔法啊 就是学习力 不能太大 太大的话他就会在碗两边跳来跳去 甚至越跳越远 就发散了 太小的话就走得特别慢 还有就是 参数有好几个的话 要同事更新 就是先用旧的把所有偏倒都算完 再一起改 不能改一个算一个 嗯 大概就这样',
      ['正的话 那就是减三乘学习力 变小 往左走'],
    )
    expect(r.meta.verdict).toBe('pass')
    expect(r.meta.states!.map((s) => s.state)).toEqual(['clear', 'clear', 'clear', 'clear'])
    expect(r.meta.next).toBe('2026-12-07')
    expect(r.text).toContain('> [!ai] 判定 · Claude Code · Opus 5.5\n> 过：核心4条都讲清了。')
    expect(r.meta.gaps!.filter((g) => g.card).map((g) => g.kind)).toEqual(['recap'])
  })

  it('稿 2 差一点：同一处连着两次没答对才说穿；C4 含糊；差一点，三天后', async () => {
    const r = await talk('梯度下降就是 让损失函数变小的一个方法 先给参数一个初始值 然后每次都往梯度的反方向走 新的西塔等于西塔减阿尔法乘梯度 这样损失就会越来越小 学习力的话 就是每一步走多远 大一点就走得快 小一点就走得慢 然后呃 重复很多次 直到损失不怎么变了 就停', [
      '呃 也不是 太大会走过头 在最低点两边来回跳 严重的话越跳越远 就收不回来了',
      '那就 各算各的偏导 各自更新吧 这个我说不上来',
      '这个……我没想过 说不上来',
    ])
    expect(r.said.slice(0, 3)).toEqual(['ask:c3', 'ask:c4', 'ask:c4'])
    expect(r.said[3]).toMatch(/\+reveal$/)
    expect(r.meta.states!.map((s) => s.state)).toEqual(['clear', 'clear', 'asked', 'vague'])
    expect(r.meta.verdict).toBe('almost')
    expect(r.meta.next).toBe('2026-11-26')
    expect(r.text).toContain('> [!ai] 说穿')
    expect(r.text).toContain('> [!ai] 说法提醒')
  })

  it('稿 3 概念错：先确认「加还是减」（不算一轮），确认是加、没改过来：讲错，没过，明天再讲', async () => {
    const r = await talk('梯度下降的话 梯度呢就是坡度嘛 嗯 我们从一个随机的西塔开始 梯度是负的话 就说明在往下走 那西塔就继续往小了走 公式是新的西塔等于旧的西塔加上学习力乘梯度 学习力太大会震荡 太小会很慢 一直迭代到收敛', [
      '加吧 因为梯度是负的 加一个负的 西塔就变小了 就往下走了',
      '两个都先用原来的值算 再一起改',
    ])
    expect(r.said[0]).toBe('confirm')
    expect(r.meta.states!.find((s) => s.id === 'c2')!.state).toBe('wrong')
    expect(r.meta.verdict).toBe('fail')
    expect(r.meta.next).toBe('2026-11-24')
    expect(r.text).toContain('> [!ai] 确认')
    expect(r.meta.gaps![0]).toMatchObject({ point: 'c2', kind: 'wrong', card: true })
  })

  it('稿 4 讲偏到了解即可：学生先拉回核心；说错后改对：过，那条出卡', async () => {
    const r = await talk('我先说一个类比 梯度下降就像大雾里下山 你看不见山脚 只能感受脚下哪边是往下的 往下迈一步 再感受 再迈一步 但是它跟下山不一样的地方是 步子大小是 阿尔法乘坡度 坡越陡迈得越大 然后呢 在这个碗上 每一步离碗底的距离会乘一减四阿尔法 所以阿尔法要小于零点五才会收敛 等于零点二五的时候一步就到了 大于零点五就越跳越远 就发散了', [
      '新的西塔 等于旧的减阿尔法乘坡度 坡度负的话就是加 西塔变大',
      '先改西塔零 然后用新的西塔零去算西塔一的偏导 这样更准吧',
      '哦 那就不是同一个点了 坡度是在原来那个点量的 应该两个都用旧的算完 再一起改',
    ])
    expect(r.said[0]).toBe('redirect:c2')
    expect(r.text).toContain('这些了解即可，先讲核心')
    expect(r.meta.states!.find((s) => s.id === 'c4')!.state).toBe('fixed')
    expect(r.meta.verdict).toBe('pass')
    expect(r.meta.gaps!.filter((g) => g.card).map((g) => g.kind)).toEqual(['fixed', 'recap'])
  })
})

describe('学生的规矩由软件守', () => {
  const m0 = async () => newMeta(draftOf(await extract({ refs: [{ kind: 'word', word: '梯度下降' }] }, deps())), { today: '2026-11-23', id: 'f-x' })
  const fixed = (ans: object): FlowDeps => ({ ...deps(), ask: async () => JSON.stringify(ans) })

  it('AI 第一次没答对就说穿：不要那一句', async () => {
    const meta = { ...(await m0()), asked: [{ act: 'ask' as const, point: 'c4' }] }
    const t = await turn({ reqId: 1, meta, entries: [{ kind: 'me', text: '不知道' }] }, fixed({ last: 'miss', act: 'ask', point: 'c4', say: '换个角度问', reveal: '答案是…', touched: [] }))
    expect(t.reveal).toBeUndefined()
    expect(t.meta.asked.at(-1)).toEqual({ act: 'ask', point: 'c4', miss: 1 })
  })

  it('第二次没答对 AI 忘了说穿：照答案和出处补一句', async () => {
    const meta = { ...(await m0()), asked: [{ act: 'ask' as const, point: 'c4' }, { act: 'ask' as const, point: 'c4', miss: 1 }] }
    const t = await turn({ reqId: 1, meta, entries: [{ kind: 'me', text: '说不上来' }] }, fixed({ last: 'miss', act: 'ask', point: 'c1', say: '那从哪开始？', touched: [] }))
    expect(t.reveal).toBe('几个参数同时更新：先用旧 θ 把偏导全算完，再一起改。出处：p20「simultaneously」。')
    expect(t.meta.asked.slice(-2)).toEqual([{ act: 'reveal', point: 'c4' }, { act: 'ask', point: 'c1' }])
  })

  it('三轮用完：不开新的一条', async () => {
    const meta = { ...(await m0()), asked: (['c1', 'c2', 'c3'] as const).map((point) => ({ act: 'ask' as const, point })) }
    const t = await turn({ reqId: 1, meta, entries: [{ kind: 'me', text: '对' }] }, fixed({ last: 'right', act: 'ask', point: 'c4', say: '那 c4 呢？', touched: ['c4'] }))
    expect(t.act).toBe('done')
    expect(t.say).toBe('')
  })

  it('判定：AI 回的状态写中文、漏了一条、完整版太长，都按规矩收', async () => {
    const meta = await m0()
    const j = await judge(
      { reqId: 1, meta, entries: [{ kind: 'me', text: 'x' }], today: '2026-11-23', prevPasses: 0 },
      fixed({ core: [{ id: 'c1', state: '讲清', quote: 'a' }, { id: 'c2', state: '追问后补上', quote: 'b' }, { id: 'c3', state: 'clear', quote: 'c' }], extra: [], rights: [], wording: ['1', '2', '3'], full: '长'.repeat(200) }),
    )
    expect(j.states.map((s) => s.state)).toEqual(['clear', 'asked', 'clear', 'missing'])
    expect(j.meta.verdict).toBe('almost')
    expect(j.wording.length).toBe(2)
    expect([...j.full].length).toBe(150)
  })

  it('手画的图：这一问带着图，交给看图那家', async () => {
    const meta = await m0()
    const log: AskQ[] = []
    const t = await turn({ reqId: 1, meta, entries: [{ kind: 'me', text: '我画了一个碗' }], image: { mime: 'image/png', base64: 'AAAA' } }, deps(log))
    expect(log[0]!.images).toEqual([{ mime: 'image/png', base64: 'AAAA' }])
    expect(t.by).toBe('Claude Code · Opus 5.5（看图）')
  })

  it('当场「再讲这几处」：只问、只判那几条；补上了就是「过 · 当场补讲」，判定块和缺口块换掉、说法提醒和完整版不动', async () => {
    const meta = await m0()
    const first = await judge({ reqId: 1, meta, entries: [{ kind: 'me', text: '先随便猜一个初始值 西塔减去学习力乘坡度 太大会跳' }], today: '2026-11-23', prevPasses: 0 }, deps())
    expect(first.meta.verdict).toBe('almost')
    const short = first.meta.states!.filter((s) => s.state === 'missing').map((s) => s.id)
    expect(short).toEqual(['c4'])
    const log: AskQ[] = []
    const t = await turn({ reqId: 2, meta: first.meta, entries: [{ kind: 'me', text: '补一下' }], only: short }, deps(log))
    expect(t.point).toBe('c4')
    expect(log[0]!.prompt).toContain('只问 c4 这几条')
    const again = await judge({ reqId: 3, meta: first.meta, entries: [{ kind: 'student', text: t.say }, { kind: 'me', text: '好几个参数要同时更新 先都用旧的算完再一起改' }], today: '2026-11-23', prevPasses: 0, only: short }, deps())
    expect(again.meta).toMatchObject({ verdict: 'pass', redone: true, next: '2026-11-26' })
    expect(again.blocks.verdict).toContain('过 · 当场补讲')
    expect(again.blocks.gaps).toContain('✓ 当场补讲清了')
    expect(again.blocks.wording).toBeUndefined()
    expect(again.blocks.full).toBeUndefined()
  })

  it('回答不是 JSON：报一句能看懂的错', async () => {
    const meta = await m0()
    await expect(turn({ reqId: 1, meta, entries: [] }, { ...deps(), ask: async () => '我觉得你讲得很好' })).rejects.toThrow('AI没按要求回答')
  })
})

describe('进度从各节注释里读（课程首页）', () => {
  const round = (o: Partial<FeynmanMeta>): string =>
    addRound('', { ...newMeta({ topic: 'x', scope: 'point', points: [], myths: [], from: [], cover: [], basisLine: '', by: '' }, { today: '2026-11-01', id: `f-${Math.random()}` }), status: 'judged', ...o })

  it('一行数、每讲一颗、下次先讲：没过（到期）→ 差一点（到期）→ 没讲过 → 过了到期', () => {
    const notes = [
      { path: '课程/线代/第1讲.md', text: round({ topic: '向量', lecture: 1, verdict: 'pass', day: '2026-11-01', next: '2026-11-15' }) + round({ topic: '范数', lecture: 1, verdict: 'fail', day: '2026-11-20', next: '2026-11-21', siblings: ['向量', '范数', '点积'] }) },
      { path: '课程/线代/第2讲.md', text: round({ topic: '矩阵', lecture: 2, verdict: 'almost', day: '2026-11-22', next: '2026-11-25' }) },
    ]
    const s = courseSummary(notes, '2026-11-23')
    expect(s).toMatchObject({ total: 4, pass: 1, almost: 1, fail: 1, never: 1 })
    expect(s.lectures).toEqual([
      { lecture: 1, pass: 1, total: 3 },
      { lecture: 2, pass: 0, total: 1 },
    ])
    expect(s.next).toMatchObject({ topic: '范数', why: 'fail' })
    // 范数补讲过了：下一个是还没讲过的点积（矩阵还没到三天）
    const later = courseSummary([...notes, { path: '课程/线代/第1讲.md', text: round({ topic: '范数', lecture: 1, verdict: 'pass', day: '2026-11-23', next: '2026-12-07' }) }], '2026-11-23')
    expect(later.next).toMatchObject({ topic: '点积', why: 'new', lecture: 1 })
    expect(later.topics.find((t) => t.topic === '范数')!.rounds).toBe(2)
  })

  it('考前两周：点都讲过了，提醒按章串讲；过了的到期重讲排在后面', () => {
    const notes = [{ path: 'a.md', text: round({ topic: '向量', verdict: 'pass', day: '2026-11-01', next: '2026-11-15' }) }]
    expect(courseSummary(notes, '2026-11-23', '2026-12-01').next).toMatchObject({ why: 'exam' })
    expect(courseSummary(notes, '2026-11-23').next).toMatchObject({ topic: '向量', why: 'due' })
  })

  it('一讲的点都讲过了、还没串讲过：提醒串讲这一讲', () => {
    const notes = [{ path: 'a.md', text: round({ topic: '向量', lecture: 3, verdict: 'pass' }) + round({ topic: '范数', lecture: 3, verdict: 'almost' }) }]
    expect(courseSummary(notes, '2026-11-23').chain).toBe(3)
    const chained = notes[0]!.text + round({ topic: '第3讲', lecture: 3, scope: 'section', verdict: 'pass', day: '2026-11-02' })
    expect(courseSummary([{ path: 'a.md', text: chained }], '2026-11-23').chain).toBeNull()
  })

  it('过了几次（第二次过六周用）：当场补讲的不算', () => {
    const rounds = roundsIn([{ path: 'a.md', text: round({ topic: '范数', verdict: 'pass' }) + round({ topic: '范 数', verdict: 'pass', redone: true }) + round({ topic: '向量', verdict: 'pass' }) }])
    expect(passesBefore(rounds, '范数')).toBe(1)
  })
})
