/**
 * 交给 AI 的话和认回答（teaching.md 第 5 节的三份草稿 + 回答的 JSON 样子）。照偏好「少给限制」写短：角色、材料、几条底线。
 * 判定由软件算（rules.ts），AI 只给状态和证据。这里的中文是给 AI 的提示词（不翻）。
 */
import { firstJson } from '../mindmap'
import { lastAsk, roundsUsed } from './round'
import { AI_BASIS, CORE_STATES, type CoreJudged, type CoreState, type Entry, type FeynmanMeta, type Myth, type Point, type Scope, STATE_LABEL, type StudentAct } from './types'
import { clipRight, type RightOf } from './rules'

// ---------------------------------------------------------------- 抽要点（5.1）

export const EXTRACT_SYSTEM = `你在帮一个学生准备「讲给别人听」的练习（费曼学习法）。只回一段 JSON，不要别的话。`

const SCOPE_RULE: Record<Scope, string> = {
  point: '这次讲一个知识点。',
  section: '这次是「串讲这一节」：每个知识点只取一句话核心，再加 1 到 2 条点和点的关系（「有了 A 为什么还要 B」），合起来不超过 5 条核心；不拆成几个点。',
  chapter: '这次是「串讲这一章」：只取分级是核心的知识点，每个一句话，再加一条「这一章在解决什么问题」；超过 5 个就分成两次（两个点）。',
}

/** material：材料全文（几样之间用标题隔开）；topic：知识点名（直接写一个词时就是那个词） */
export function extractPrompt(material: string, o: { scope: Scope; topic?: string; noMaterial?: boolean }): string {
  const src = o.noMaterial
    ? `库里没找到「${o.topic}」的材料，按常识定要点；每条的凭什么都写「${AI_BASIS}」。`
    : `下面是这次的材料${o.topic ? `（知识点：${o.topic}）` : ''}：\n<<<\n${material}\n>>>`
  return `${src}

${SCOPE_RULE[o.scope]}找出要讲到的东西，分三类：
- 核心：讲不到就算没懂这个点的，3 到 5 条。超过 5 条说明材料里不止一个点，把它分成几个点，每个点各列一份。
- 了解即可：讲到更好、讲不到不影响的，比如类比、例子、课外推导、另一种写法。
- 常见误解：学这个点的人最容易信的错说法，2 到 4 条，每条写错在哪、正确是什么、挂在哪条核心上。

先看考试证据，再看材料自己标的（标题、加粗、定义框、编号公式、课后题），最后才用你的判断。每条写一句凭什么（basis）；只凭你判断的写「${AI_BASIS}」。
核心的名字（text）写成要讲的事（「每一步怎么改 θ」），不写答案；答案（answer）另放一栏，一句话、不超过 40 字，讲完才给学生看。
材料里找不到出处的，basis 写「材料里没有」，不编页码。材料里带「[图 N]」的是框下来的图，图里的内容也算材料。
知识点名（topic）用材料里的说法，越短越好（「范数」「梯度下降」）。

只回 JSON：
{"points":[{"topic":"知识点名","core":[{"id":"c1","text":"要讲的事","answer":"正确说法","basis":"凭什么"}],"extra":[{"id":"e1","text":"…","answer":"…","basis":"…"}],"myths":[{"id":"m1","text":"错的说法","right":"正确是什么","core":"c1"}]}]}`
}

export interface ExtractedPoint {
  topic: string
  points: Point[]
  myths: Myth[]
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

function parseJson(answer: string): Record<string, unknown> {
  const json = firstJson(answer)
  if (!json) throw new Error('AI没按要求回答（没有JSON），再试一次')
  try {
    const o = JSON.parse(json) as unknown
    if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>
  } catch {
    // 下面一起报
  }
  throw new Error('AI回的JSON读不懂，再试一次')
}

/** 认抽要点的回答：一个或几个点；每个点核心至少 1 条 */
export function parseExtract(answer: string): ExtractedPoint[] {
  const o = parseJson(answer)
  const list = Array.isArray(o.points) ? o.points : [o]
  const out: ExtractedPoint[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const pts: Point[] = []
    const take = (arr: unknown, kind: 'core' | 'extra') => {
      if (!Array.isArray(arr)) return
      arr.forEach((x, i) => {
        const p = (typeof x === 'string' ? { text: x } : x) as Record<string, unknown>
        const text = str(p?.text, 80)
        if (!text) return
        const prefix = kind === 'core' ? 'c' : 'e'
        let id = str(p.id, 8) || `${prefix}${i + 1}`
        if (!id.startsWith(prefix) || pts.some((q) => q.id === id)) id = `${prefix}${i + 1}`
        while (pts.some((q) => q.id === id)) id += 'x'
        pts.push({ id, kind, text, answer: clipRight(str(p.answer, 120)), basis: str(p.basis, 40) || AI_BASIS })
      })
    }
    take(r.core, 'core')
    take(r.extra, 'extra')
    if (!pts.some((p) => p.kind === 'core')) continue
    const myths: Myth[] = []
    if (Array.isArray(r.myths))
      r.myths.forEach((x, i) => {
        const m = (x ?? {}) as Record<string, unknown>
        const text = str(m.text, 80)
        if (!text) return
        const core = str(m.core, 8)
        myths.push({ id: str(m.id, 8) || `m${i + 1}`, text, right: str(m.right, 80), core: pts.some((p) => p.id === core) ? core : pts[0]!.id })
      })
    out.push({ topic: str(r.topic, 30) || '这个知识点', points: pts, myths })
  }
  if (!out.length) throw new Error('AI没抽出要点，再试一次')
  return out
}

// ---------------------------------------------------------------- 一整份 PDF：先给知识点单子

export const PDF_LIST_SYSTEM = `你在帮一个学生把一讲课件切成「一次讲一个」的知识点单子。只回一段 JSON，不要别的话。`

export function pdfListPrompt(name: string, pages: { page: number; text: string }[]): string {
  const body = pages.map((p) => `【第 ${p.page} 页】\n${p.text}`).join('\n\n')
  return `下面是「${name}」每一页的字。把它切成知识点：在出现一个新概念名的地方切（标题换了、加粗新词、Definition、Theorem、带编号的公式）；标题连续的几页并成一个点（「(cont.)」并进上一页）；少于 2 条核心的并进旁边的点。每个点核心 2 到 5 条、只有一个主角概念。
每个点写：名字（越短越好）、从第几页到第几页、分级（core：讲别的离不开它或考试会考；extra：例子、历史、课外）、估计几条核心。
<<<
${body}
>>>
只回 JSON：{"title":"这一讲的名字","items":[{"name":"知识点名","from":1,"to":2,"level":"core","cores":3}]}`
}

export interface PdfListItem {
  name: string
  from: number
  to: number
  level: 'core' | 'extra'
  cores: number
}

export function parsePdfList(answer: string, pages: number): { title: string; items: PdfListItem[] } {
  const o = parseJson(answer)
  const items: PdfListItem[] = []
  if (Array.isArray(o.items))
    for (const x of o.items) {
      const r = (x ?? {}) as Record<string, unknown>
      const name = str(r.name, 30)
      const from = Math.min(Math.max(1, Math.round(Number(r.from) || 1)), pages)
      const to = Math.min(Math.max(from, Math.round(Number(r.to) || from)), pages)
      if (!name) continue
      items.push({ name, from, to, level: r.level === 'extra' ? 'extra' : 'core', cores: Math.min(Math.max(1, Math.round(Number(r.cores) || 3)), 9) })
    }
  if (!items.length) throw new Error('AI没切出知识点，再试一次')
  return { title: str(o.title, 40), items }
}

// ---------------------------------------------------------------- 讲同一件事的卡（一起盖住）

export const SAME_SYSTEM = `你在帮一个学生盖住白板上会把答案露出来的卡片。只回一段 JSON，不要别的话。`

export function samePrompt(topic: string, points: Point[], cards: { n: number; text: string }[]): string {
  const list = cards.map((c) => `[${c.n}] ${c.text.replace(/\s+/g, ' ').slice(0, 240)}`).join('\n')
  return `他马上要凭记忆讲「${topic}」，要讲到：${points
    .filter((p) => p.kind === 'core')
    .map((p) => p.text)
    .join('；')}。
下面是同一块白板上别的卡。哪几张一眼看过去就能把这些要点的答案念出来（讲的是同一件事）？只挑真的讲同一件事的，别的不挑。
${list}
只回 JSON：{"same":[卡的编号]}`
}

export function parseSame(answer: string): number[] {
  const o = parseJson(answer)
  return Array.isArray(o.same) ? o.same.map(Number).filter((n) => Number.isInteger(n)) : []
}

// ---------------------------------------------------------------- AI 学生（5.2）

type Lite = Pick<Entry, 'kind' | 'text'>

const pointLine = (p: Point) => `- ${p.id}（${p.kind === 'core' ? '核心' : '了解即可'}）${p.text}｜答案：${p.answer || '（没写）'}｜出处：${p.basis}`

function transcript(entries: readonly Lite[]): string {
  const who: Record<string, string> = { me: '他说', student: '你问', reveal: '你说穿', confirm: '你确认' }
  return entries
    .filter((e) => who[e.kind])
    .map((e) => `【${who[e.kind]}】${e.text.trim()}`)
    .join('\n\n')
}

const CHAIN_ASK: Record<Scope, string> = {
  point: '核心都讲到了，就要一个带数的例子，或拿一个常见误解试他。',
  section: '这次是串讲一节：追问问点和点的关系（「有了 A 为什么还要 B」「B 的问题是 A 带来的吗」），不问细处。',
  chapter: '这次是串讲一章：追问问主线（这一章在解决什么问题、这几个点怎么接起来），不问细处。',
}

export function studentSystem(topic: string, scope: Scope): string {
  return `你是一个没学过「${topic}」的同学，正在听对面的人给你讲。要点单子在下面，他看得到名字，看不到答案；答案和常见误解只有你知道，答案只在说穿时用，别在问题里带出来。

他的话多半是语音听写出来的：没标点、有同音字、口头禅、改口、中英混着说，都正常。按最通的意思理解，别提这些字，别纠正说法。只有意思可能正好相反（加还是减、变大还是变小），上下文又分不出来时，像同学一样问一句「你说的是加还是减？」（act 用 confirm），这一问不算追问。他说的正好和答案相反、而反过来那个词读音相近（加和减、大和小）时，就算前后说得通，也先这样确认一次再追问：可能只是听写错了。

听完以后最多追问三轮，每轮只盯一条核心、这一条最多问两次，每次一句，先引他的原话。先问他说错的核心（拿常见误解问「那是不是……对吧？」），再问含糊的，再用外行的问法问一条他没碰到的核心（问题里别带答案）。${CHAIN_ASK[scope]}了解即可的东西不追问。

同一处他连着两次没答对，才说穿：一句正确说法加出处（写在 reveal 里），然后接着问别的（写在 say 里）。第一次没答对，换个角度再问，不给提示。

他一半以上的话花在了解即可的东西上，又有核心没碰，第一轮先说「这个了解即可，先讲核心」，再问那条核心（act 用 redirect）。他问「这个要不要会」，直接答（act 用 answer）。

你是学生，不打分，不夸，不讲课。和他用同一种语言说话。只回一段 JSON，不要别的话。`
}

/** 软件记着的进度，原样告诉 AI（几轮了、上一问盯哪条、连着没答对几次），免得它数错 */
export function turnPrompt(meta: FeynmanMeta, entries: readonly Lite[], only?: string[]): string {
  const pts = meta.points.filter((p) => !only || p.kind !== 'core' || only.includes(p.id))
  const used = roundsUsed(meta.asked)
  const la = lastAsk(meta.asked)
  const lp = la?.point ? meta.points.find((p) => p.id === la.point) : undefined
  const state = [
    `已经追问了 ${used} 轮（最多 3 轮）。`,
    lp ? `上一问盯的是 ${lp.id}「${lp.text}」，在那一问之前他对这一条已经连着没答对 ${la!.miss ?? 0} 次${(la!.miss ?? 0) >= 1 ? '：这次再没答对就说穿' : ''}。` : '',
    meta.asked.some((a) => a.act === 'redirect') ? '「这个了解即可，先讲核心」已经说过了，别再说。' : '',
    meta.asked.some((a) => a.act === 'confirm') ? '加还是减已经确认过一次了。' : '',
    only ? `这是当场「再讲这几处」：只问 ${only.join('、')} 这几条。` : '',
    used >= 3 ? '三轮已经用完：别再开新的一条，最多把上一条问完或说穿，然后 act 写 done。' : '',
  ]
    .filter(Boolean)
    .join('\n')
  const myths = meta.myths.map((m) => `- ${m.id}（挂在 ${m.core}）${m.text}｜正确：${m.right}`).join('\n')
  return `要点单子：
${pts.map(pointLine).join('\n')}
常见误解（只有你知道）：
${myths || '（没有）'}

到现在的记录：
${transcript(entries)}

${state}

先判断他最后这一段有没有答对你上一问（last：right 答对 / miss 没答对 / none 上一句不是追问），再说下一句。touched 写到现在为止他讲到了的核心编号（只算他自己说的）。
只回 JSON：{"last":"right|miss|none","act":"ask|confirm|redirect|answer|reveal|done","point":"盯着的核心编号","quote":"引的他的原话","say":"你这一句","reveal":"说穿的那一句（不说穿就不写）","touched":["c1"]}`
}

export interface ParsedTurn {
  last: 'right' | 'miss' | 'none'
  act: StudentAct
  point?: string
  quote?: string
  say: string
  reveal?: string
  touched: string[]
}

const ACTS: StudentAct[] = ['ask', 'confirm', 'reveal', 'redirect', 'answer', 'done']

export function parseTurn(answer: string, meta: FeynmanMeta): ParsedTurn {
  const o = parseJson(answer)
  const act = ACTS.includes(o.act as StudentAct) ? (o.act as StudentAct) : 'ask'
  const ids = new Set(meta.points.map((p) => p.id))
  const point = str(o.point, 8)
  const say = typeof o.say === 'string' ? o.say.trim().slice(0, 600) : ''
  const reveal = typeof o.reveal === 'string' ? o.reveal.trim().slice(0, 300) : ''
  if (!say && !reveal && act !== 'done') throw new Error('AI学生没说话，再试一次')
  const touched = Array.isArray(o.touched) ? o.touched.map((x) => str(x, 8)).filter((x) => ids.has(x)) : []
  return {
    last: o.last === 'right' || o.last === 'miss' ? o.last : 'none',
    act,
    ...(ids.has(point) ? { point } : {}),
    ...(str(o.quote, 120) ? { quote: str(o.quote, 120) } : {}),
    say,
    ...(reveal ? { reveal } : {}),
    touched,
  }
}

// ---------------------------------------------------------------- 判每条要点（5.3）

export const JUDGE_SYSTEM = `你在核对一轮「讲给别人听」的练习，只给每条核心一个状态和证据，不打分。只回一段 JSON，不要别的话。`

export function judgePrompt(meta: FeynmanMeta, entries: readonly Lite[], only?: string[]): string {
  const cores = meta.points.filter((p) => p.kind === 'core' && (!only || only.includes(p.id)))
  const extras = only ? [] : meta.points.filter((p) => p.kind === 'extra')
  const myths = meta.myths.map((m) => `- ${m.text}（挂在 ${m.core}；正确：${m.right}）`).join('\n')
  return `下面是一轮「讲给别人听」的记录：他自己讲的一段，和他回答追问的几段；还有这个知识点（${meta.topic}）的核心、了解即可和常见误解。
核心：
${cores.map(pointLine).join('\n')}
了解即可：
${extras.map(pointLine).join('\n') || '（没有）'}
常见误解：
${myths || '（没有）'}

记录：
${transcript(entries)}

给每条核心一个状态，附一句他的原话做证据：
- 讲清：意思在，用什么词、哪种语言、举什么例子、打什么比方都行；关键那层说到了、没说全的一小点从他别的话里带得出来，也算讲清（没说全的写进 wording）。
- 追问后补上：自己讲时漏了或没说清，被问了（一次或两次）答对了，没靠说穿。
- 说错后改对：先说了一个概念错（意思反了），追问里自己改对了，没靠说穿。只说得不完整、说太满不算概念错。
- 含糊：碰到了，但关键那层关系没说出来；追问后还是说不出来，也没说反着的话（说穿了也算含糊）。
- 没讲到：从头到尾没提，追问也没轮到它。
- 讲错：说了反着的话，追问两次还没改过来，最后靠说穿。

按意思判，不比字面：不要求课件原词、符号、单位，也不要求说得完整漂亮；说「斜率」就是梯度，说「跳来跳去」就是来回振荡。听写错、同音字、口头禅、断句、改口都不是错，改口以最后一次为准。
只有意思反了、会让他算错做错的，才是概念错；追问里他自己改对了算「说错后改对」，靠说穿才知道的算「讲错」。没说反着的话、只是说不出来的，说穿了也算「含糊」。
用词不准、说太满但前后讲对了，写进 wording，最多 2 条，不碰状态。
只看他说的话；追问和说穿里出现的内容，不算他讲到。
原话（quote）截最能说明这个状态的那一句，不超过 40 字，从中间截的前后加「…」；讲错的那条截他说反的那句。

再给：了解即可每条讲到没有、说错没有；每条核心和了解即可一句正确说法（不超过 40 字）和出处（材料里没有的写「材料里没有」）；一段 150 字以内的完整版，只讲核心，尽量用他举的例子和他的说法。
只回一个 JSON：{"core":[{"id":"c1","state":"讲清","quote":"他的原话"}],"extra":[{"id":"e1","said":true,"wrong":false}],"rights":[{"id":"c1","right":"正确说法","src":"出处"}],"wording":[],"full":"完整版"}`
}

const STATE_OF = new Map<string, CoreState>([...CORE_STATES.map((s) => [s, s] as [string, CoreState]), ...Object.entries(STATE_LABEL).map(([k, v]) => [v, k as CoreState] as [string, CoreState])])

export interface ParsedJudge {
  states: CoreJudged[]
  rights: RightOf[]
  wording: string[]
  full: string
}

export function parseJudge(answer: string, meta: FeynmanMeta, only?: string[]): ParsedJudge {
  const o = parseJson(answer)
  const cores = meta.points.filter((p) => p.kind === 'core' && (!only || only.includes(p.id)))
  const got = new Map<string, CoreJudged>()
  if (Array.isArray(o.core))
    for (const x of o.core) {
      const r = (x ?? {}) as Record<string, unknown>
      const id = str(r.id, 8)
      const state = STATE_OF.get(str(r.state, 12))
      if (!state || !cores.some((p) => p.id === id)) continue
      got.set(id, { id, state, quote: state === 'missing' ? '' : str(r.quote, 120) })
    }
  // AI 漏了的核心当没讲到
  const states = cores.map((p) => got.get(p.id) ?? { id: p.id, state: 'missing' as const, quote: '' })
  const rights: RightOf[] = meta.points.map((p) => {
    const r = Array.isArray(o.rights) ? ((o.rights as unknown[]).find((x) => str((x as Record<string, unknown>)?.id, 8) === p.id) as Record<string, unknown> | undefined) : undefined
    const e = Array.isArray(o.extra) ? ((o.extra as unknown[]).find((x) => str((x as Record<string, unknown>)?.id, 8) === p.id) as Record<string, unknown> | undefined) : undefined
    return { id: p.id, right: clipRight(str(r?.right, 120) || p.answer || p.text), src: str(r?.src, 40) || p.basis, ...(p.kind === 'extra' ? { said: e?.said === true, wrong: e?.wrong === true } : {}) }
  })
  const wording = Array.isArray(o.wording) ? o.wording.map((w) => str(w, 120)).filter(Boolean).slice(0, 2) : []
  const full = str(o.full, 400)
  return { states, rights, wording, full: [...full].length > 150 ? [...full].slice(0, 149).join('') + '…' : full }
}

/** 边写边给：JSON 里某个字段已经写到了的那一截（学生的话、完整版一点点长出来） */
export function partialField(raw: string, key: string): string {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw)
  if (!m) return ''
  let out = ''
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i]!
    if (c === '"') return out
    if (c !== '\\') {
      out += c
      continue
    }
    const n = raw[i + 1]
    if (n === undefined) return out
    if (n === 'u') {
      const hex = raw.slice(i + 2, i + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out
      out += String.fromCharCode(parseInt(hex, 16))
      i += 5
      continue
    }
    out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '' : n
    i++
  }
  return out
}
