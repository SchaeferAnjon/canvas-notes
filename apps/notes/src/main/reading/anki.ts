/**
 * 把「我的疑惑」送进 Anki：走 AnkiConnect（Anki 的插件，只听本机 127.0.0.1:8765），
 * 和 Anki Learn、Ask Free、GetNewWord 用同一个笔记类型「学习卡 · 问答」、同一张纸（卡片家族 v3）。
 * 规矩照 anki-learn 仓库 DESIGN.md「往 Anki 里加卡」：牌组「知识」，章节和课程写进标签，按 ID 字段找卡，
 * 同一牌组里问题一样的不重复加，你在 Anki 里改过的模板不动。
 * 笔记类型的定义拷自同一作者的 anki-learn（Core/Sources/AnkiLearnCore/Anki.swift 的 StudyCard），要一字不差。
 */
import { type AskSection, formatPdfAnchor } from '@cn/format'

export const ANKI_URL = process.env.CN_ANKI_URL || 'http://127.0.0.1:8765'
export const DECK = '知识'
export const FROM_TAG = '来自::Canvas_Notes'

export const StudyCard = {
  name: '学习卡 · 问答',
  /** 同名的笔记类型不是我们的（字段对不上）就改用这个名字，不碰你的 */
  otherName: '学习卡 · 问答 2',
  fields: ['Question', 'Answer', 'More', 'Quote', 'Image', 'Label', 'Source', 'Link', 'ID'],
  templateName: '问答',
  version: 3,
}

const TOP = `<div class="top">{{#Label}}<div class="meta">{{Label}}</div>{{/Label}}<div class="q">{{Question}}</div>{{#Image}}<div class="shot">{{Image}}</div>{{/Image}}</div>`
export const FRONT = `<div class="fam">\n${TOP}\n</div>`
export const BACK = `<div class="fam back">
${TOP}
<div class="ans"><div class="a">{{Answer}}</div>{{#More}}<div class="more">{{More}}</div>{{/More}}</div>
<div class="foot"><div class="src">{{#Source}}<span>{{Source}}</span>{{/Source}}{{#Link}}<a class="open" href="{{text:Link}}">打开原文</a>{{/Link}}</div>{{#Quote}}<details><summary>原文</summary><div class="body">{{Quote}}</div></details>{{/Quote}}{{#Image}}<details class="pic"><summary>当时的画面</summary><div class="body">{{Image}}</div></details>{{/Image}}</div>
</div>`

export const CSS = `/* 卡片家族 v3 */
.card {
  --bg: #FFFFFF; --surface: #F4F4F6;
  --text: #18191C; --text2: #5F636C; --text3: #969AA2;
  --border: rgba(0,0,0,.09); --accent: #5460D2;
  --backdrop: #F2F2F4; --sheet: #FFFFFF; --band: #F8F8FA;
  --shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 32px -12px rgba(0,0,0,.10);
  --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  margin: 0; padding: 40px 24px 64px; background: var(--backdrop); color: var(--text);
  font-family: var(--sans); font-size: 17px; line-height: 1.6; text-align: left;
  letter-spacing: 0; font-kerning: normal; text-autospace: normal;
  -webkit-font-smoothing: antialiased; overflow-wrap: break-word;
}
.card.nightMode, .nightMode .card, .card.night_mode, .night_mode .card {
  --bg: #16171A; --surface: rgba(255,255,255,.07);
  --text: #EDEDEF; --text2: #9A9FA8; --text3: #6E7480;
  --border: rgba(255,255,255,.09); --accent: #8A94F5;
  --backdrop: #0F1012; --sheet: #1B1C1F; --band: #202125; --shadow: none;
}
.card code { font-family: var(--mono); font-size: .88em; padding: .08em .36em; border-radius: 5px; background: var(--surface); overflow-wrap: anywhere; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.card pre { font-family: var(--mono); font-size: 14px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface); padding: 12px 14px; border-radius: 8px; margin: 8px 0; }
.card pre code { padding: 0; background: none; font-size: inherit; }
.card .code-h, .card .copy { display: none; }
.card .scrollx { overflow-x: auto; }
.card b, .card strong { font-weight: 600; }
.card a { color: var(--accent); text-decoration: none; }
.card img { max-width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--border); display: block; }

/* 纸：四种卡都一样 */
.fam { max-width: 620px; margin: 0 auto; background: var(--sheet); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; }
.fam .top { padding: 28px 32px 30px; }
.fam .meta { font-size: 12px; line-height: 1.5; color: var(--text2); margin-bottom: 8px; }
.fam .q { font-size: 24px; line-height: 1.45; font-weight: 600; text-wrap: pretty; }
.fam.back .q { color: var(--text2); }
.fam .shot { margin-top: 16px; }
.fam .ans { padding: 24px 32px 28px; border-top: 1px solid var(--border); }
.fam .a { font-size: 24px; line-height: 1.45; font-weight: 600; text-wrap: pretty; }
.fam .a code { font-size: .84em; }
.fam .more { margin-top: 14px; font-size: 16px; line-height: 1.65; color: var(--text2); text-wrap: pretty; }
.fam .more ul { list-style: none; margin: 0; padding: 0; }
.fam .more li { position: relative; padding-left: 16px; }
.fam .more li + li { margin-top: 6px; }
.fam .more li::before { content: ""; position: absolute; left: 3px; top: .74em; width: 5px; height: 5px; border-radius: 50%; background: var(--text3); }
/* 答案本身是几条要点（知识片段、Ask Free 的老卡）：正文字号，编号方块 */
.fam .a ol { list-style: none; margin: 0; padding: 0; counter-reset: p; font-size: 17px; font-weight: 400; line-height: 1.6; }
.fam .a ol li { position: relative; counter-increment: p; padding-left: 30px; }
.fam .a ol li + li { margin-top: 10px; }
.fam .a ol li::before { content: counter(p); position: absolute; left: 0; top: .2em; width: 20px; height: 20px; border-radius: 5px; background: var(--surface); color: var(--text2); font-size: 12px; line-height: 20px; text-align: center; font-variant-numeric: tabular-nums; }
/* 截图：带 class="lead" 的放在问题下面，别的收进「当时的画面」 */
.fam .shot:not(:has(img.lead)) { display: none; }
.fam details.pic:has(img.lead) { display: none; }

/* 纸底一条：出处在左，「打开原文」在右，折叠在下 */
.fam .foot { padding: 14px 32px 16px; border-top: 1px solid var(--border); background: var(--band); }
.fam .foot:not(:has(.src > *, details:not(.pic), img:not(.lead))) { display: none; }
.fam .src { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 16px; font-size: 13px; line-height: 1.6; color: var(--text2); }
.fam .src:empty { display: none; }
.fam .src .open { margin-left: auto; font-weight: 500; white-space: nowrap; }
.fam .src + details { margin-top: 6px; }
.fam details > summary { display: inline-flex; align-items: center; gap: 8px; list-style: none; cursor: pointer; font-size: 13px; font-weight: 500; color: var(--text2); padding: 2px 0; }
.fam details > summary::-webkit-details-marker { display: none; }
.fam details > summary::before { content: ""; width: 5px; height: 5px; margin: 0 2px; border-right: 1.5px solid var(--text3); border-bottom: 1.5px solid var(--text3); transform: rotate(-45deg); transition: transform .15s; }
.fam details[open] > summary::before { transform: rotate(45deg); }
.fam details .body { margin: 6px 0 4px 17px; font-size: 15px; line-height: 1.6; color: var(--text2); text-wrap: pretty; }

/* 单词卡：句子在前 */
.fam .ctx { font-size: 24px; line-height: 1.5; text-wrap: pretty; }
.fam .kw { --c: var(--accent); --l: .34em; --w: 1.5px; padding: 0 .16em; margin: 0 .03em;
  background: linear-gradient(var(--c),var(--c)) left top / var(--l) var(--w) no-repeat, linear-gradient(var(--c),var(--c)) left top / var(--w) var(--l) no-repeat,
  linear-gradient(var(--c),var(--c)) right top / var(--l) var(--w) no-repeat, linear-gradient(var(--c),var(--c)) right top / var(--w) var(--l) no-repeat,
  linear-gradient(var(--c),var(--c)) left bottom / var(--l) var(--w) no-repeat, linear-gradient(var(--c),var(--c)) left bottom / var(--w) var(--l) no-repeat,
  linear-gradient(var(--c),var(--c)) right bottom / var(--l) var(--w) no-repeat, linear-gradient(var(--c),var(--c)) right bottom / var(--w) var(--l) no-repeat; }
.fam .tr { margin-top: 10px; font-size: 16px; color: var(--text2); }
.fam .tr u { text-decoration: none; color: var(--text); box-shadow: inset 0 -2px var(--accent); }
.fam .sense { font-size: 30px; line-height: 1.3; font-weight: 600; }
.fam .hw { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-top: 8px; font-size: 14px; color: var(--text2); }
.fam .hw b { font-size: 17px; font-weight: 600; color: var(--text); }
.fam .hw .ipa { font-family: var(--mono); }
.fam .mean { margin-top: 12px; font-size: 15px; color: var(--text2); }

@media (max-width: 520px) {
  .card { padding: 0; background: var(--sheet); font-size: 16px; }
  .fam { max-width: none; border: 0; border-radius: 0; box-shadow: none; }
  .fam .top, .fam .ans { padding: 20px 16px 22px; }
  .fam .foot { padding: 12px 16px 16px; }
  .fam .q, .fam .a, .fam .ctx { font-size: 20px; }
  .fam .sense { font-size: 26px; }
  .fam .more { font-size: 15px; }
  .fam details > summary { padding: 8px 0; margin: -6px 0; }
}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** 纯文字（偶尔带 `代码`、**加粗**）→ Anki 字段的 HTML */
export function html(text: string): string {
  return esc(text.trim())
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>')
}

/** 段落指纹，当 ID 字段的后半截（FNV-1a） */
function fnv(s: string): string {
  let h = 0x811c9dc5
  for (const ch of s) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

export const noteId = (threadId: string) => `canvasnotes-${fnv(threadId)}`

/** 点卡上「打开原文」：回到软件里这份 PDF 的那一页、那一块 */
export function openLink(pdf: string, s: AskSection): string {
  const hash = formatPdfAnchor({ file: pdf, page: s.page, rect: s.rect }).replace(/^[^#]*#/, '')
  return `canvas-notes://open?file=${encodeURIComponent(pdf)}&${hash}`
}

export interface CardInput {
  id: string
  pdf: string
  course: string
  section: AskSection
  question: string
  /** 截图在 Anki 媒体库里的文件名（storeMediaFile 回的） */
  image?: string
}

const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const tagWord = (s: string) => s.trim().split(/\s+/).join('_')

export function fieldsFor(c: CardInput): Record<string, string> {
  const s = c.section
  return {
    Question: html(c.question),
    Answer: html(s.good),
    More: s.points.length > 1 ? `<ul>${s.points.map((p) => `<li>${html(p)}</li>`).join('')}</ul>` : html(s.points[0] ?? ''),
    Quote: s.doubts.length > 1 ? html(s.doubts.slice(1).join('\n')) : '',
    Image: c.image ? `<img class="lead" src="${esc(c.image)}">` : '',
    Label: esc(`Canvas Notes · ${c.course || stem(c.pdf)}`),
    Source: esc(`${stem(c.pdf)} · 第 ${s.page} 页`),
    Link: esc(openLink(c.pdf, s)),
    ID: noteId(c.id),
  }
}

export function tagsFor(c: CardInput): string[] {
  return [FROM_TAG, ...(c.course ? [`主题::${tagWord(c.course)}`] : []), `主题::${tagWord(stem(c.pdf))}`]
}

export class AnkiConnectError extends Error {}

export async function call(action: string, params?: Record<string, unknown>): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(ANKI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, version: 6, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new AnkiConnectError('Anki 没开着，或者没装 AnkiConnect 插件（编号 2055492159）。打开 Anki 再送一次')
  }
  if (!res.ok) throw new AnkiConnectError('Anki 的回答读不懂')
  const j = (await res.json()) as { result?: unknown; error?: string | null }
  if (j.error) throw new AnkiConnectError(`Anki 回了一个错误：${j.error.includes('Close the affected editor') ? 'Anki 里开着卡片浏览器或「添加」窗口，关掉它再送' : j.error}`)
  return j.result
}

/** 「学习卡 · 问答」缺了就建；同名但字段对不上的不是我们的，改用「学习卡 · 问答 2」。你改过的模板一律不动 */
async function noteType(): Promise<string> {
  const names = ((await call('modelNames')) as string[]) ?? []
  for (const name of [StudyCard.name, StudyCard.otherName]) {
    if (!names.includes(name)) {
      await call('createModel', {
        modelName: name,
        inOrderFields: StudyCard.fields,
        css: CSS,
        isCloze: false,
        cardTemplates: [{ Name: StudyCard.templateName, Front: FRONT, Back: BACK }],
      })
      return name
    }
    const fields = ((await call('modelFieldNames', { modelName: name })) as string[]) ?? []
    if (fields.join('\u0000') === StudyCard.fields.join('\u0000')) return name
  }
  throw new AnkiConnectError(`「${StudyCard.name}」和「${StudyCard.otherName}」都是别的笔记类型`)
}

/** 牌组按 id 记：你在 Anki 里改了名就跟着新名字；找不到就按名字建 */
async function deck(id: number | undefined): Promise<{ name: string; id: number }> {
  const decks = ((await call('deckNamesAndIds')) as Record<string, number>) ?? {}
  if (id !== undefined) {
    const cur = Object.entries(decks).find(([, v]) => v === id)
    if (cur) return { name: cur[0], id }
  }
  if (decks[DECK] !== undefined) return { name: DECK, id: decks[DECK]! }
  return { name: DECK, id: (await call('createDeck', { deck: DECK })) as number }
}

export interface SendResult {
  added: string[]
  duplicates: string[]
  failed: Record<string, string>
  deck: { name: string; id: number }
}

/** 送一批：截图先存进 Anki 的媒体库，再加笔记；牌组里问题一样的不重复加 */
export async function sendCards(cards: (CardInput & { png?: Buffer })[], deckId?: number): Promise<SendResult> {
  await call('version')
  const model = await noteType()
  const d = await deck(deckId)
  for (const c of cards) {
    if (!c.png) continue
    c.image = (await call('storeMediaFile', { filename: `${noteId(c.id)}.png`, data: c.png.toString('base64') })) as string
  }
  const notes = cards.map((c) => ({ deckName: d.name, modelName: model, fields: fieldsFor(c), tags: tagsFor(c), options: { allowDuplicate: false, duplicateScope: 'deck' } }))
  const checks = (await call('canAddNotesWithErrorDetail', { notes })) as { canAdd: boolean; error?: string }[]
  if (!Array.isArray(checks) || checks.length !== cards.length) throw new AnkiConnectError('Anki 的回答读不懂')
  const r: SendResult = { added: [], duplicates: [], failed: {}, deck: d }
  const fresh: number[] = []
  checks.forEach((ch, i) => {
    if (ch.canAdd) fresh.push(i)
    else if (/duplicate/i.test(ch.error ?? '')) r.duplicates.push(cards[i]!.id)
    else r.failed[cards[i]!.id] = ch.error ?? '加不进去'
  })
  if (fresh.length) {
    const ids = (await call('addNotes', { notes: fresh.map((i) => notes[i]) })) as (number | null)[]
    fresh.forEach((i, k) => {
      if (ids?.[k] == null) r.failed[cards[i]!.id] = '加不进去'
      else r.added.push(cards[i]!.id)
    })
  }
  return r
}
