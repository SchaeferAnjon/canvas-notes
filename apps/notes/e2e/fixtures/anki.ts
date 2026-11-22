/**
 * 出卡送 Anki 的测试材料（task-tz7y3，方向 B「AI 先改成卡，一张张过」）：
 * - 一门课 ecp：Lecture05 三轮 6 问（一条旁支）、Lecture04 两问，和原型 /private/tmp/canvas-notes-anki/proto.html 同一份数据；
 *   我框的图是照原型的「crop」画的（fixtures/anki/*.png，2 倍图）。
 * - 一个假的 AnkiConnect：记下建了什么笔记类型、加了哪些卡；能演「Anki 没开」（连上就断）、牌组里已经有同样的问题、撤回时删卡、
 *   「今天要复习」按牌组和标签数卡。
 */
import { type AskQa, type AskSection, newReadingNote, setProp, upsertSection } from '@cn/format'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { lecturePdf } from './pdf'

export const L5 = '课程/ecp/Lecture05.pdf'
export const L4 = '课程/ecp/Lecture04.pdf'
export const L6 = '课程/ecp/Lecture06.pdf'
export const L5_NOTE = '课程/ecp/Lecture05 笔记.md'
export const L4_NOTE = '课程/ecp/Lecture04 笔记.md'

const crop = (name: string) => readFileSync(join(__dirname, 'anki', `${name}.png`))
/** 截图在 PDF 上 100% 时的宽（2 倍图的一半） */
const CROP_W: Record<string, number> = { 'p2-1': 142, 'p3-1': 251, 'p4-1': 228, 'l4-p2-1': 258, 'l4-p3-1': 235 }

const qa = (q: string, a: string, sides: AskQa['sides'] = []): AskQa => ({ q, a, sides })

function section(pdf: string, page: number, title: string, time: string, qas: AskQa[], recap: string, shot: string): AskSection {
  const name = pdf.split('/').pop()!.replace(/\.pdf$/, '')
  return {
    id: `.canvas-notes/对话/${name}-p${page}-1.md`,
    file: pdf,
    page,
    rect: [0.08, 0.17, 0.84, 0.17],
    title,
    time,
    crop: `附件/${name}/${shot.replace(/^l4-/, '')}.png`,
    cropW: CROP_W[shot],
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: [],
    qas,
    recap,
  }
}

function note(pdf: string, lecture: number | null, sections: AskSection[]): string {
  const path = pdf.replace(/\.pdf$/, ' 笔记.md')
  let t = newReadingNote(pdf, new Date(2026, 10, 21))
  if (lecture !== null) t = setProp(t, '第几讲', String(lecture))
  for (const s of sections) t = upsertSection(t, s, path)
  return t
}

/** 旁支问的那一句（在第一问的回答里） */
export const SIDE_QUOTE = '水位一到门槛 Vth 就发一个 spike，同时把水位减掉一个门槛的量'

export const L5_SECTIONS = [
  section(
    L5,
    2,
    'LIF 神经元的三条公式',
    '20:21',
    [
      qa('给我讲解一下这三条公式', `把神经元想成一个漏水的水桶：每一步先漏掉一点（乘 β），再加上这一步流进来的电流。${SIDE_QUOTE}。\n\n- 第一条：漏和加\n- 第二条：到门槛就发\n- 第三条：发完减掉一个门槛`, [
        { quote: SIDE_QUOTE, turns: [{ q: '为什么减掉门槛，而不是清零？', a: '减掉门槛能把超出门槛的那一截留下来，下一步更快再发，信息不丢；清零会把这一截扔掉。' }] },
      ]),
      qa('那 tau 大一点会怎样？', 'tau 大，漏得慢，水位记得久，神经元对很久以前的输入也有反应。'),
    ],
    '水桶模型：漏、加、到门槛发、发完减门槛。',
    'p2-1',
  ),
  section(
    L5,
    3,
    '为什么用脉冲就省电',
    '20:34',
    [qa('为什么用脉冲就省电？', '没有 spike 的时候什么都不用算；大部分时间大部分神经元是安静的，乘加次数少很多。'), qa('SRAM 为什么比 DRAM 省电？', 'SRAM 在芯片上、离计算单元近，读一次的能量比去片外读 DRAM 小两个数量级。')],
    '省电靠不发就不算，和数据放在近处。',
    'p3-1',
  ),
  section(L5, 4, 'Roofline 的拐点', '20:51', [qa('Roofline 的拐点怎么算？', '拐点 = 峰值算力 ÷ 内存带宽（FLOP/Byte）。算术强度比它小受带宽限制，比它大受算力限制。')], '拐点是算力和带宽的比。', 'p4-1'),
]

export const L4_SECTIONS = [
  section(L4, 2, '带宽', '19:05', [qa('带宽和延迟有什么不一样？', '带宽是一秒能搬多少，延迟是第一个字节要等多久。')], '带宽看搬多少，延迟看等多久。', 'l4-p2-1'),
  section(L4, 3, 'Roofline 图', '19:20', [qa('这张图的横轴是什么？', '横轴是算术强度：每搬一个字节做几次运算。')], '横轴是算术强度。', 'l4-p3-1'),
]

/** Lecture05 的 6 问（和「只看我问的」里的顺序一样：主问题，挂在它后面的旁支，再下一问） */
export const L5_QUESTIONS = ['给我讲解一下这三条公式', '为什么减掉门槛，而不是清零？', '那 tau 大一点会怎样？', '为什么用脉冲就省电？', 'SRAM 为什么比 DRAM 省电？', 'Roofline 的拐点怎么算？']

/** 两份 PDF 每一页的字（真 AI 出卡的测试当「这一页 PDF 上的字」交给 AI） */
export const L5_PAGES = [
  { title: 'Lecture 5 Spiking neurons', lines: ['Neurons talk with spikes.'] },
  { title: '5.2 LIF neuron', lines: ['The leaky integrate-and-fire neuron keeps a membrane potential.', 'V[t] = beta * V[t-1] + I[t]', 'S[t] = 1 if V[t] >= V_th, else 0', 'V[t] <- V[t] - S[t] * V_th', 'beta is the decay; larger tau means slower leak.', 'Subtracting V_th keeps the residue above threshold.'] },
  { title: '5.3 Why spikes save energy', lines: ['No spike, no work.', 'SRAM read = 5 pJ, DRAM read = 640 pJ.'] },
  { title: '5.4 Roofline', lines: ['knee = peak FLOP/s / bandwidth (B/s)'] },
]
export const L4_PAGES = [
  { title: 'Lecture 4 Memory', lines: ['Memory hierarchy.'] },
  { title: '4.2 Bandwidth', lines: ['Bandwidth: bytes per second between levels.'] },
  { title: '4.3 Roofline plot', lines: ['x-axis: arithmetic intensity (FLOP/Byte)'] },
]
const lecture5 = lecturePdf(L5_PAGES)
const lecture4 = lecturePdf(L4_PAGES)
const lecture6 = lecturePdf([{ title: 'Lecture 6 Learning rules', lines: ['STDP.'] }])

/** ecp 一门课：Lecture05 三轮 6 问、Lecture04 两问、Lecture06 没开始，两篇自己写的 */
export function ankiVault(): Record<string, string | Uint8Array> {
  return {
    [L5]: lecture5,
    [L4]: lecture4,
    [L6]: lecture6,
    [L5_NOTE]: note(L5, 5, L5_SECTIONS),
    [L4_NOTE]: note(L4, 4, L4_SECTIONS),
    '课程/ecp/考试安排.md': '# 考试安排\n\n期末开卷。\n',
    '课程/ecp/期末复习提纲.md': '# 期末复习提纲\n\n- 第5讲\n',
    '附件/Lecture05/p2-1.png': crop('p2-1'),
    '附件/Lecture05/p3-1.png': crop('p3-1'),
    '附件/Lecture05/p4-1.png': crop('p4-1'),
    '附件/Lecture04/p2-1.png': crop('l4-p2-1'),
    '附件/Lecture04/p3-1.png': crop('l4-p3-1'),
  }
}

export const W2_L5 = '课程/ecp/Week 2/Lecture05.pdf'
export const W2_L4 = '课程/ecp/Week 2/补充材料/Lecture04.pdf'
export const STDP = '阅读/STDP.pdf'

/**
 * 牌组跟着目录来（2026-11-22 用户：「这个命名就跟目录来」）：ecp 按周分了子文件夹，Lecture05 在 Week 2 里，Lecture04 在 Week 2/补充材料 里
 * （文件夹再套文件夹），两份都带书签（牌组也不按它分章）；另有一份不在课程里的 阅读/STDP.pdf，一问，卡进「知识」
 */
export function weekVault(): Record<string, string | Uint8Array> {
  const at = (pdf: string, ss: AskSection[]) => ss.map((s) => ({ ...s, file: pdf }))
  const stdp = section(STDP, 1, 'STDP', '21:02', [qa('STDP 是什么？', '前一个神经元先发、后一个后发，连接就加强；反过来就减弱。')], '先后决定加强还是减弱。', 'p2-1')
  const md = (pdf: string) => pdf.replace(/\.pdf$/, ' 笔记.md')
  return {
    [W2_L5]: lecturePdf(L5_PAGES, { outline: true }),
    [W2_L4]: lecturePdf(L4_PAGES, { outline: true }),
    [STDP]: lecturePdf([{ title: 'STDP', lines: ['Spike-timing-dependent plasticity.'] }]),
    [md(W2_L5)]: note(W2_L5, 5, at(W2_L5, L5_SECTIONS)),
    [md(W2_L4)]: note(W2_L4, 4, at(W2_L4, L4_SECTIONS)),
    [md(STDP)]: note(STDP, null, [stdp]),
    '附件/Lecture05/p2-1.png': crop('p2-1'),
    '附件/Lecture05/p3-1.png': crop('p3-1'),
    '附件/Lecture05/p4-1.png': crop('p4-1'),
    '附件/Lecture04/p2-1.png': crop('l4-p2-1'),
    '附件/Lecture04/p3-1.png': crop('l4-p3-1'),
    '附件/STDP/p2-1.png': crop('p2-1'),
  }
}

// ---------------------------------------------------------------- 假的 AnkiConnect

export interface FakeNote {
  id: number
  deckName: string
  modelName: string
  fields: Record<string, string>
  tags: string[]
  options?: { allowDuplicate?: boolean; duplicateScope?: string }
}

export interface FakeAnki {
  url: string
  /** Anki 没开：连上就断（软件看到的和真的没开一样） */
  down: boolean
  /** 笔记类型：名字 → 字段、样式、模板 */
  models: Map<string, { fields: string[]; css: string; templates: { Name: string; Front: string; Back: string }[] }>
  decks: Record<string, number>
  notes: FakeNote[]
  /** 收到的每一次请求 */
  calls: { action: string; params?: Record<string, unknown> }[]
  media: string[]
  close(): Promise<void>
}

const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()

/** Anki 的查找（只认这里用到的几样）：deck:名字（含子牌组）、tag:标签（含子标签）、nid:1,2、is:new、is:due */
function find(a: FakeAnki, query: string): number[] {
  const parts = query.match(/"[^"]*"|\S+/g)?.map((p) => p.replace(/^"|"$/g, '')) ?? []
  let notes = a.notes
  for (const p of parts) {
    const [k, v] = [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)]
    if (k === 'deck') notes = notes.filter((n) => n.deckName === v || n.deckName.startsWith(v + '::'))
    else if (k === 'tag') notes = notes.filter((n) => n.tags.some((t) => t === v || t.startsWith(v + '::')))
    else if (k === 'nid') notes = notes.filter((n) => v.split(',').map(Number).includes(n.id))
    else if (p === 'is:due') notes = []
  }
  return notes.map((n) => n.id)
}

/** port：在这个端口上听（占着它的程序关掉以后 Anki 在同一个端口起来）；不给让系统挑 */
export async function fakeAnki(o: { decks?: Record<string, number>; notes?: Omit<FakeNote, 'id'>[]; down?: boolean; port?: number } = {}): Promise<FakeAnki> {
  let nextId = 1_700_000_000_000
  const a: FakeAnki = {
    url: '',
    down: !!o.down,
    models: new Map(),
    decks: { Default: 1, ...(o.decks ?? {}) },
    notes: (o.notes ?? []).map((n) => ({ ...n, id: nextId++ })),
    calls: [],
    media: [],
    close: async () => undefined,
  }
  const dup = (n: Omit<FakeNote, 'id'>) => a.notes.some((x) => x.deckName === n.deckName && strip(x.fields.Question ?? '') === strip(n.fields.Question ?? ''))
  const server: Server = createServer((req, res) => {
    if (a.down) return void req.socket.destroy()
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const { action, params } = JSON.parse(body) as { action: string; params?: Record<string, unknown> }
      a.calls.push({ action, ...(params ? { params } : {}) })
      const ok = (result: unknown) => res.end(JSON.stringify({ result, error: null }))
      const bad = (error: string) => res.end(JSON.stringify({ result: null, error }))
      const p = params ?? {}
      switch (action) {
        case 'version':
          return ok(6)
        case 'modelNames':
          return ok([...a.models.keys()])
        case 'modelFieldNames':
          return ok(a.models.get(p.modelName as string)?.fields ?? [])
        case 'modelStyling':
          return ok({ css: a.models.get(p.modelName as string)?.css ?? '' })
        case 'createModel': {
          a.models.set(p.modelName as string, { fields: p.inOrderFields as string[], css: p.css as string, templates: p.cardTemplates as { Name: string; Front: string; Back: string }[] })
          return ok({ id: 1 })
        }
        case 'updateModelStyling': {
          const m = p.model as { name: string; css: string }
          a.models.get(m.name)!.css = m.css
          return ok(null)
        }
        case 'updateModelTemplates':
          return ok(null)
        case 'deckNamesAndIds':
          return ok(a.decks)
        case 'createDeck': {
          const id = 1_800_000_000_000 + Object.keys(a.decks).length
          a.decks[p.deck as string] = id
          return ok(id)
        }
        case 'storeMediaFile':
          a.media.push(p.filename as string)
          return ok(p.filename)
        case 'canAddNotesWithErrorDetail':
          return ok((p.notes as Omit<FakeNote, 'id'>[]).map((n) => (dup(n) ? { canAdd: false, error: 'cannot create note because it is a duplicate' } : { canAdd: true })))
        case 'addNotes':
          return ok(
            (p.notes as Omit<FakeNote, 'id'>[]).map((n) => {
              if (dup(n)) return null
              const id = nextId++
              a.notes.push({ ...n, id })
              return id
            }),
          )
        case 'deleteNotes': {
          const ids = p.notes as number[]
          a.notes = a.notes.filter((n) => !ids.includes(n.id))
          return ok(null)
        }
        case 'findCards':
        case 'findNotes':
          return ok(find(a, p.query as string))
        case 'guiBrowse':
          return ok(find(a, p.query as string))
        default:
          return bad(`unsupported action ${action}`)
      }
    })
  })
  await new Promise<void>((r) => server.listen(o.port ?? 0, '127.0.0.1', r))
  a.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  a.close = () => new Promise<void>((r) => server.close(() => r()))
  return a
}
