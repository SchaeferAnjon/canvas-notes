/**
 * 把读 PDF 时问过的送进 Anki（2026-11-22 起从笔记出卡，task-tz7y3；以前从「我的疑惑」页送）：走 AnkiConnect（Anki 的插件，只听本机 127.0.0.1:8765），
 * 和 ChatCards、Ask Free、GetNewWord 用同一个笔记类型「学习卡 · 问答」、同一张纸（卡片家族 v3）。
 * 规矩照 anki-learn 仓库 DESIGN.md「往 Anki 里加卡」：牌组「知识」（按 id 记，Anki 里改了名跟着走），课程和 PDF 写进标签，按 ID 字段找卡，
 * 同一牌组里问题一样的不重复加（Anki 按第一个字段 Question 判，同一批里按 cardKey 判，和 anki-learn 的 CardMaker.dedupe 同一个判断）；
 * 样式只往新的换（Anki 里的比我们旧才换），你在 Anki 里改过的模板（第一行不是「卡片家族 vN」）不动。
 * 笔记类型的定义拷自同一作者的 anki-learn（Core/Sources/AnkiLearnCore/Anki.swift 的 StudyCard），要一字不差。
 * 对接说明：/private/tmp/canvas-notes-anki/接AnkiLearn.md（task-tz7y3 交回时附的）、docs/DEVELOPMENT.md「送进 Anki」。
 */
import { execFile } from 'node:child_process'
import { type AskSection, cardKey, type CardText, formatPdfAnchor, mapMath } from '@cn/format'
import { catName } from '../../shared/categories'
import { t } from '../../shared/i18n'

/** AnkiConnect 在哪：测试用 CN_ANKI_URL 换成本机假服务（每次送时读，测试里能换） */
export const ankiUrl = (): string => process.env.CN_ANKI_URL || 'http://127.0.0.1:8765'
// ---------------- 笔记类型名、牌组规则只写在这一处（ChatCards 改名、用户换规矩时只改这里） ----------------

/** 放在库最外层的 PDF 的卡进「知识」（和 ChatCards 送的同一个）；别的文件夹里的跟着文件夹走（deckFor） */
export const DECK = '知识' // 不翻：Anki 里的牌组名（写进 Anki 的字照旧）
/**
 * 课程里的 PDF 的卡牌组跟着目录来（2026-11-22 用户：「在对应的课程下面，比如说 ecp」「这个命名就跟目录来」）：
 * 课程/<课>/ 下面的文件夹整条进牌组名，课程/ecp/Week 2/x.pdf 进「课程::ecp::Week 2」，再套的 Week 2/补充材料/ 进「课程::ecp::Week 2::补充材料」；
 * 直接放在课里的用 PDF 自己的名字（课程::ecp::Lecture05）。不按 PDF 书签分章；不在课程里的跟着所在文件夹走，库最外层的进「知识」
 */
const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
/** 牌组名的一节：不能带「::」（会多建一层），太长截到 40 个字 */
const part = (s: string) => [...s.replace(/::/g, '：').replace(/\s+/g, ' ').trim()].slice(0, 40).join('')
/** 这门课的牌组：课程/<课>/… 是「课程::<课>」；不在课程里是 null。最前面一节就是这个库「课程」文件夹的名字（英文库 Courses::<课>） */
export const courseDeckOf = (path: string): string | null => {
  const [top, course, ...rest] = path.split('/')
  return top === catName('课程') && course && rest.length ? `${top}::${part(course)}` : null
}
/** 这份 PDF 的卡进哪个牌组：课程里的「课程::<课>::<课下面的文件夹，一层一节；直接放在课里的是 PDF 的名字>」，别的文件夹里的「<文件夹>::<子文件夹>」，库的最外层进「知识」 */
export function deckFor(pdf: string): string {
  const course = courseDeckOf(pdf)
  // 不在课程里的跟着所在文件夹走（ParaRead 联动 2026-11-23：「出卡牌组跟着所在文件夹走」，阅读/论文/x.pdf 进「阅读::论文」）；放在库的最外层的进「知识」
  if (!course) {
    const dirs = pdf.split('/').slice(0, -1)
    return dirs.length ? dirs.map(part).join('::') : DECK
  }
  const dirs = pdf.split('/').slice(2, -1)
  return [course, ...(dirs.length ? dirs : [stem(pdf)]).map(part)].join('::')
}
export const FROM_TAG = '来自::Canvas_Notes' // 不翻：写进 Anki 的标签

// 不翻：Anki 里的笔记类型、模板名，和 anki-learn 一字不差
export const StudyCard = {
  name: '学习卡 · 问答', // 不翻
  /** 同名的笔记类型不是我们的（字段对不上）就改用这个名字，不碰你的 */
  otherName: '学习卡 · 问答 2', // 不翻
  fields: ['Question', 'Answer', 'More', 'Quote', 'Image', 'Label', 'Source', 'Link', 'ID'],
  templateName: '问答', // 不翻
  version: 3,
}

const TOP = `<div class="top">{{#Label}}<div class="meta">{{Label}}</div>{{/Label}}<div class="q">{{Question}}</div>{{#Image}}<div class="shot">{{Image}}</div>{{/Image}}</div>`
export const FRONT = `<div class="fam">\n${TOP}\n</div>`
// 不翻：Anki 卡片模板（写进 Anki）
export const BACK = `<div class="fam back">
${TOP}
<div class="ans"><div class="a">{{Answer}}</div>{{#More}}<div class="more">{{More}}</div>{{/More}}</div>
<div class="foot"><div class="src">{{#Source}}<span>{{Source}}</span>{{/Source}}{{#Link}}<a class="open" href="{{text:Link}}">打开原文</a>{{/Link}}</div>{{#Quote}}<details><summary>原文</summary><div class="body">{{Quote}}</div></details>{{/Quote}}{{#Image}}<details class="pic"><summary>当时的画面</summary><div class="body">{{Image}}</div></details>{{/Image}}</div>
</div>`

// 不翻：Anki 卡片的样式，第一行「卡片家族 vN」是版本号
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
/**
 * 纯文字（偶尔带 `代码`、**加粗**、公式）→ Anki 字段的 HTML。公式照文档里的认法（@cn/format 的 findMath）换成 Anki 的 MathJax 认的
 * \(…\)、\[…\]（task-o48fa），里面的字不再套代码、加粗
 */
export function html(text: string): string {
  const rest = (t: string) =>
    esc(t)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/\n/g, '<br>')
  return mapMath(text.trim(), (m) => (m.block || m.display ? `\\[${esc(m.tex)}\\]` : `\\(${esc(m.tex)}\\)`), rest)
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
  /** 这一条看到的那一段（新格式：doubts 是这一问的原话，good 是它回答原文的开头一段） */
  section: AskSection
  question: string
  /** 旁支里问的：被问的那一句（卡背面「原文」那一栏） */
  quote?: string
  /** 出卡弹窗里过过的那张（AI 改写的、自己改过的）：有它就用它的问题、答案、补充、原文摘句 */
  card?: CardText
  /** 截图在 Anki 媒体库里的文件名（storeMediaFile 回的） */
  image?: string
  /** 费曼缺口的卡：纸底的出处、「打开原文」回到那一篇（不是 PDF 的第几页） */
  source?: string
  link?: string
}

const tagWord = (s: string) => s.trim().split(/\s+/).join('_')
/** 补充：一行一条，两条以上写成要点，一条就是一段（anki-learn AnkiHTML.points） */
const points = (lines: string[]) => {
  const l = lines.map((x) => x.trim().replace(/^[-•·*]\s*/, '')).filter(Boolean)
  return l.length > 1 ? `<ul>${l.map((p) => `<li>${html(p)}</li>`).join('')}</ul>` : html(l[0] ?? '')
}

export function fieldsFor(c: CardInput): Record<string, string> {
  const s = c.section
  const k = c.card
  return {
    Question: html(k?.q ?? c.question),
    Answer: html(k?.a ?? s.good),
    More: points(k ? k.more.split('\n') : s.points),
    // 旁支那一问：被问的那句；出卡改写的：AI 从回答、PDF 里原样摘的一句；以前的笔记：AI 写的另几条疑惑
    Quote: c.quote ? html(c.quote) : k ? html(k.quote) : s.doubts.length > 1 ? html(s.doubts.slice(1).join('\n')) : '',
    // 我框的图是 2 倍图：照它在 PDF 上 100% 时的宽画（和笔记里一样大，不然 Anki 里大一倍）
    Image: c.image ? `<img class="lead" src="${esc(c.image)}"${s.cropW ? ` width="${Math.round(s.cropW)}"` : ''}>` : '',
    // 不翻：写进 Anki 卡片的字
    Label: esc(`Canvas Notes · ${c.course || stem(c.pdf)}${c.quote ? ' · 旁支' : ''}`),
    Source: esc(c.source ?? `${stem(c.pdf)} · 第 ${s.page} 页`), // 不翻
    Link: esc(c.link ?? openLink(c.pdf, s)),
    ID: noteId(c.id),
  }
}

export function tagsFor(c: CardInput): string[] {
  return [FROM_TAG, ...(c.course ? [`主题::${tagWord(c.course)}`] : []), `主题::${tagWord(stem(c.pdf))}`] // 不翻：写进 Anki 的标签
}

/** off：连不上（Anki 没开、没装插件），选的都留着、开了接着送；port：端口上答话的不是 AnkiConnect（别的程序占着）；api：Anki 回了错误 */
export class AnkiConnectError extends Error {
  constructor(
    message: string,
    readonly kind: 'off' | 'api' | 'port' = 'api',
  ) {
    super(message)
  }
}

/** 谁在这个端口上听：lsof 查（5 秒没回、没装、查不到都当不知道；lsof 要翻一遍所有进程，机器忙时一两秒是常事，只在送不成时查一次） */
export function whoListens(port: number): Promise<{ name: string; pid: number } | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  const lsof = process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof'
  return new Promise((resolve) =>
    execFile(lsof, ['-nP', '+c', '0', `-iTCP:${port}`, '-sTCP:LISTEN'], { timeout: 5000 }, (err, out) => {
      if (err) return resolve(null)
      // COMMAND PID USER …：第一行是表头；+c 0 给全名，名字里的空格 lsof 写成 \x20
      const m = /^(\S+)\s+(\d+)\s/m.exec(String(out).split('\n').slice(1).join('\n'))
      resolve(m ? { name: m[1]!.replace(/\\x20/g, ' '), pid: Number(m[2]) } : null)
    }),
  )
}

/**
 * 端口上答话的不是 AnkiConnect（2026-11-22 用户截图「Anki 的回答读不懂」：`python3 -m http.server 8765` 对 POST 回 501 的 HTML，
 * AnkiConnect 因为端口被占没起来）：说清楚是哪个程序占着、怎么办
 */
async function portBusy(): Promise<AnkiConnectError> {
  const port = Number(new URL(ankiUrl()).port) || 80
  const who = await whoListens(port)
  return new AnkiConnectError(
    who
      ? t('{port}端口被别的程序占着（{name}，进程号{pid}），不是AnkiConnect。关掉它，重启Anki再送。', { port, name: who.name, pid: who.pid })
      : t('{port}端口被别的程序占着，不是AnkiConnect。关掉它，重启Anki再送。', { port }),
    'port',
  )
}

/** AnkiConnect（v6）一律回 200 的 JSON {result, error}；不是这个样子就是别的程序在答话 */
const isAnkiReply = (j: unknown): j is { result: unknown; error: string | null } =>
  !!j && typeof j === 'object' && !Array.isArray(j) && 'result' in j && 'error' in j && (j.error === null || typeof j.error === 'string')

export async function call(action: string, params?: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(ankiUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, version: 6, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new AnkiConnectError(t('Anki 没开着，或者没装 AnkiConnect 插件（编号 2055492159）。打开 Anki 再送一次'), 'off')
  }
  if (!res.ok) throw await portBusy()
  const j: unknown = await res.json().catch(() => undefined)
  if (!isAnkiReply(j)) throw await portBusy()
  if (j.error) throw new AnkiConnectError(t('Anki 回了一个错误：{error}', { error: j.error.includes('Close the affected editor') ? t('Anki 里开着卡片浏览器或「添加」窗口，关掉它再送') : j.error }))
  if (action === 'version' && typeof j.result !== 'number') throw await portBusy()
  return j.result
}

/** AnkiConnect 在不在答话（Anki 开着、插件在跑）：两秒没回当没开 */
export const connected = (): Promise<boolean> => call('version', undefined, 2000).then(() => true, () => false)

/** CSS 第一行：`/* 卡片家族 v3 *\/`；不是这个格式就说明你在 Anki 里改过 */
export function cssVersion(css: string): number | null {
  const m = /^\/\* 卡片家族 v(\d+) \*\/$/.exec((css.split('\n', 1)[0] ?? '').trim())
  return m ? Number(m[1]) : null
}

/**
 * 「学习卡 · 问答」缺了就建；同名但字段对不上的不是我们的，改用「学习卡 · 问答 2」。
 * 样式只往新的换：Anki 里的比我们带的旧（别的软件装的早一版）才换模板和样式；新的、你改过的（第一行不是「卡片家族 vN」）一律不动
 */
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
    if (fields.join('\u0000') !== StudyCard.fields.join('\u0000')) continue
    const v = cssVersion(((await call('modelStyling', { modelName: name })) as { css?: string } | null)?.css ?? '')
    if (v !== null && v < StudyCard.version) {
      await call('updateModelStyling', { model: { name, css: CSS } })
      await call('updateModelTemplates', { model: { name, templates: { [StudyCard.templateName]: { Front: FRONT, Back: BACK } } } })
    }
    return name
  }
  throw new AnkiConnectError(t('「{a}」和「{b}」都是别的笔记类型', { a: StudyCard.name, b: StudyCard.otherName }))
}

/** 这几个牌组缺了就建（Anki 里已经有的、你自己改过的不动） */
async function ensureDecks(names: string[]): Promise<void> {
  const decks = ((await call('deckNamesAndIds')) as Record<string, number>) ?? {}
  for (const n of new Set(names)) if (decks[n] === undefined) await call('createDeck', { deck: n })
}

export interface SendResult {
  added: string[]
  duplicates: string[]
  failed: Record<string, string>
  /** 这一批进了哪几个牌组 */
  decks: string[]
  /** 加进去的那几问在 Anki 里的笔记编号（撤回时删、在 Anki 里看时找） */
  notes: Record<string, number>
}

/** 送一批：截图先存进 Anki 的媒体库，再加笔记；同一牌组里同一批问题一样的只送第一张，牌组里已经有一样问题的不重复加 */
export async function sendCards(cards: (CardInput & { png?: Buffer })[]): Promise<SendResult> {
  await call('version')
  const model = await noteType()
  const r: SendResult = { added: [], duplicates: [], failed: {}, decks: [], notes: {} }
  const seen = new Set<string>()
  const go = cards.filter((c) => {
    const k = `${deckFor(c.pdf)}\n${cardKey(c.card?.q ?? c.question)}`
    if (!seen.has(k)) return seen.add(k)
    r.duplicates.push(c.id)
    return false
  })
  r.decks = [...new Set(go.map((c) => deckFor(c.pdf)))]
  if (go.length) await ensureDecks(r.decks)
  for (const c of go) {
    if (!c.png) continue
    c.image = (await call('storeMediaFile', { filename: `${noteId(c.id)}.png`, data: c.png.toString('base64') })) as string
  }
  const notes = go.map((c) => ({ deckName: deckFor(c.pdf), modelName: model, fields: fieldsFor(c), tags: tagsFor(c), options: { allowDuplicate: false, duplicateScope: 'deck' } }))
  if (!notes.length) return r
  const checks = (await call('canAddNotesWithErrorDetail', { notes })) as { canAdd: boolean; error?: string }[]
  if (!Array.isArray(checks) || checks.length !== go.length) throw new AnkiConnectError(t('Anki 的回答读不懂'))
  const fresh: number[] = []
  checks.forEach((ch, i) => {
    if (ch.canAdd) fresh.push(i)
    else if (/duplicate/i.test(ch.error ?? '')) r.duplicates.push(go[i]!.id)
    else r.failed[go[i]!.id] = ch.error ?? t('加不进去')
  })
  if (fresh.length) {
    const ids = (await call('addNotes', { notes: fresh.map((i) => notes[i]) })) as (number | null)[]
    fresh.forEach((i, k) => {
      const id = ids?.[k]
      if (id == null) r.failed[go[i]!.id] = t('加不进去')
      else {
        r.added.push(go[i]!.id)
        r.notes[go[i]!.id] = id
      }
    })
  }
  return r
}

/** 撤回刚送的：Anki 里删掉这几张笔记 */
export async function deleteNotes(ids: number[]): Promise<void> {
  if (ids.length) await call('deleteNotes', { notes: ids })
}

/** Anki 的查找能找到几张卡（「今天要复习」：deck:"知识" tag:主题::ecp is:new / is:due） */
export async function countCards(query: string): Promise<number> {
  const r = (await call('findCards', { query }, 5000)) as unknown[]
  return Array.isArray(r) ? r.length : 0
}

/** 在 Anki 的卡片浏览器里打开这几张（按 ID 字段找，和 anki-learn 的 AnkiConnect.query 同一个写法） */
export async function browse(itemIds: string[]): Promise<void> {
  if (itemIds.length) await call('guiBrowse', { query: itemIds.map((id) => `"ID:${noteId(id)}"`).join(' OR ') }, 5000)
}
