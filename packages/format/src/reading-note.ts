/**
 * 一份 PDF 一篇笔记（「第3讲 线性映射 笔记.md」，和 PDF 在同一个文件夹）：每框一块问一轮，AI 在后台补一段。
 * 笔记是普通 md，用户能自己改；这里负责写一段、读回来（右栏「笔记」按段显示）、按「完整对话」的路径找到同一段替换。
 *
 * 一段的样子（链接都相对这篇笔记所在的文件夹，和文档里插图片一样，别的 md 软件也打得开）：
 *
 *   ## 第 5 页 · 旋转矩阵每个数从哪来
 *   [第 5 页](第3讲%20线性映射.pdf#page=5&rect=0.05,0.29,0.52,0.36) · 10:20
 *
 *   ![我框的](../../附件/第3讲%20线性映射/p5-1.png)
 *
 *   ![第 5 页 · 单位圆上的 e₁、e₂](../../附件/第3讲%20线性映射/p5-1-fig.png)
 *
 *   > [!question] 我的疑惑
 *   > 整块没看懂：旋转矩阵的四个数是怎么来的
 *
 *   > [!ai] AI 讲解（第 2 版） · Claude Code · Opus 5.5 · 看了第 5 页
 *   > 换个看法，先别看公式……
 *   >
 *   > - 要点一
 *   > - 要点二
 *
 *   （讲通的讲法和要点是 AI 写的，放进一个 [!ai] 提示块，CN-76；以前写成 [!success] 讲通的讲法 + 块外的列表，照样读得回来）
 *
 *   <details><summary>没讲通 · 第 1 版：用公式推，没听懂</summary>
 *
 *   原来的讲法
 *
 *   </details>
 *
 *   [完整对话 · 2 轮](../../.canvas-notes/对话/第3讲%20线性映射-p5-1.md) · [[第4讲 特征值#旋转矩阵没有实特征值]]
 *
 * 读回来时路径都换回库里的路径（AskSection 里一律是库里的路径）。
 * 「完整对话」的路径就是这一段的身份：同一处接着问，就按它找到这一段整段换掉；用户自己写的别的段落原样留着。
 */
import { aiCallout, parseAiCalloutHead, splitAiBody } from './ai-callout'
import { encodePath, formatPdfAnchor, parsePdfAnchor, type Rect } from './pdf-link'
import { AI_KEY, setProp } from './props'

export interface Figure {
  path: string
  caption: string
}

export interface FailedTry {
  version: number
  /** 一行：用了什么讲法、为什么没讲通 */
  line: string
  /** 当时的原文 */
  text: string
}

export interface AskSection {
  /** 完整对话文件在库里的路径，也是这一段的身份 */
  id: string
  /** PDF 在库里的路径 */
  file: string
  page: number
  /** 框的位置（这一页上的比例）；整页问的没有 */
  rect?: Rect
  title: string
  /** 问的时间 HH:MM */
  time?: string
  /** 我框的那块截图 */
  crop?: string
  /** AI 觉得这页重要的图 */
  figures: Figure[]
  /** 我的疑惑：用户口吻，一行一条 */
  doubts: string[]
  /** 讲通的讲法 */
  good: string
  /** 换过讲法时是第几版 */
  goodVersion?: number
  /** 哪家哪个模型讲的（「Claude Code · Opus 5.5」，写在提示块头上） */
  by?: string
  points: string[]
  failed: FailedTry[]
  rounds: number
  /** 双链目标（不带方括号） */
  links: string[]
  /** 这一处做的可视化（库里的 HTML 文件） */
  viz?: { path: string; title: string }
  /**
   * 不是在 PDF 上问的：网页（url 是网址，label 是域名）或库里的 HTML（url 是库里的路径，label 是文件名）。
   * 这时链接那行写「[域名](网址)」，点了回网页；page 是问的时候 PDF 翻到的那页（没有 PDF 时是 0，标题不写页码）。
   * 视频问答块「接着问」的：label 是「▶ 00:06 · 视频名」，t 是那一问在视频第几秒（AI 那块写「看了 00:06 这一帧」）
   */
  web?: { url: string; label: string; t?: number }
}

export const CONVO_DIR = '.canvas-notes/对话'
export const ATTACH_DIR = '附件'

const baseName = (p: string) => p.split('/').pop() ?? p
const stem = (p: string) => baseName(p).replace(/\.[^.]+$/, '')
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** PDF 旁边那篇笔记：「第3讲 线性映射.pdf」→「第3讲 线性映射 笔记.md」 */
export function notePathFor(pdf: string): string {
  const d = dirOf(pdf)
  return `${d ? d + '/' : ''}${stem(pdf)} 笔记.md`
}

/** 放截图的文件夹：附件/<PDF 名字>/ */
export function attachDirFor(pdf: string): string {
  return `${ATTACH_DIR}/${stem(pdf)}`
}

/** 课程/<课>/… 里的 PDF 属于哪门课 */
export function courseOf(pdf: string): string | undefined {
  const m = /^课程\/([^/]+)\//.exec(pdf)
  return m?.[1]
}

/** 文件名里的「第 3 讲」「Lecture 3」「L03」 */
export function lectureOf(pdf: string): number | undefined {
  const s = stem(pdf)
  const m = /第\s*(\d+)\s*讲/.exec(s) ?? /\blec(?:ture)?\s*[-_ ]?(\d+)/i.exec(s) ?? /^L(\d+)\b/.exec(s)
  return m ? Number(m[1]) : undefined
}

const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * 新笔记的开头：属性（和导图、课程首页同一套键：类型、课程、第几讲、来源、日期）+ 一级标题。
 * 课程、第几讲是软件按文件夹和文件名填的，记在「AI填的」里，用户改了就不算
 */
export function newReadingNote(pdf: string, now = new Date()): string {
  let t = setProp('', '类型', '笔记')
  const course = courseOf(pdf)
  const lec = lectureOf(pdf)
  if (course) t = setProp(t, '课程', course)
  if (lec !== undefined) t = setProp(t, '第几讲', String(lec))
  t = setProp(t, '来源', `[[${baseName(pdf)}]]`)
  t = setProp(t, '日期', dayOf(now))
  const ai = [...(course ? ['课程'] : []), ...(lec !== undefined ? ['第几讲'] : [])]
  if (ai.length) t = setProp(t, AI_KEY, ai.join(', '))
  return `${t}\n# ${stem(pdf)} 笔记\n`
}

/** 笔记 note 里指向库里 target 的相对链接（每一段编码，括号、空格不破坏 md 链接） */
export function linkFrom(note: string, target: string): string {
  const from = note.split('/').slice(0, -1)
  const to = target.split('/')
  let k = 0
  while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++
  return encodePath([...Array(from.length - k).fill('..'), ...to.slice(k)].join('/'))
}

/** 反过来：笔记里的相对链接 → 库里的路径 */
export function linkTo(note: string, link: string): string {
  const parts = note.split('/').slice(0, -1)
  for (const p of decode(link).split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return parts.join('/')
}

/** 写进 md 时不能破坏结构的字：方括号会断开图片说明，换行会断开一行 */
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim()
const alt = (s: string) => oneLine(s).replace(/[[\]]/g, '')
const quote = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n')

/** 视频里第几秒：00:06、1:02:03（和视频块上的一样） */
function clipTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`
}

/** 「问这一页」附的整页截图的说明 */
const WHOLE_PAGE = '整页'

/** 附的截图叫什么：「问这一页」没有框，是「整页」；框的、网页上框的是「我框的」（笔记文件、右栏笔记面板、Anki 弹窗同一个说法） */
export function cropCaption(s: { rect?: unknown; web?: unknown }): string {
  return !s.rect && !s.web ? WHOLE_PAGE : '我框的'
}

/** note：这一段写进的那篇笔记在库里的路径（链接相对它） */
export function renderSection(s: AskSection, note: string): string {
  const out: string[] = []
  out.push(`## ${s.page > 0 ? `第 ${s.page} 页 · ` : ''}${oneLine(s.title) || '没起标题'}`)
  const back = s.web
    ? `[${alt(s.web.label) || '网页'}](${/^https?:/i.test(s.web.url) ? s.web.url.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) : linkFrom(note, s.web.url)})`
    : `[第 ${s.page} 页](${anchorFrom(note, s.file, s.page, s.rect)})`
  out.push(`${back}${s.time ? ` · ${s.time}` : ''}`)
  const imgs: string[] = []
  // 「问这一页」附的是整页（没有框）：图的说明写「整页」，不写「我框的」
  if (s.crop) imgs.push(`![${cropCaption(s)}](${linkFrom(note, s.crop)})`)
  for (const f of s.figures) imgs.push(`![${alt(f.caption) || '图'}](${linkFrom(note, f.path)})`)
  // 一张图一段：文档视图里一段只有一张图才显示成图
  if (imgs.length) out.push('', imgs.join('\n\n'))
  if (s.doubts.length) out.push('', `> [!question] 我的疑惑\n${s.doubts.map((d) => `> ${oneLine(d)}`).join('\n')}`)
  // AI 讲通的讲法和要点：一个 [!ai] 提示块，和自己写的分得开
  if (s.good.trim() || s.points.length) {
    const seen = s.web ? (s.web.t !== undefined ? `看了 ${clipTime(s.web.t)} 这一帧` : /^https?:/i.test(s.web.url) ? '看了网页这一段' : '看了框的这一块') : `看了第 ${s.page} 页`
    out.push('', aiCallout({ text: s.good, points: s.points, seen, ...(s.by ? { by: s.by } : {}), ...(s.goodVersion ? { version: s.goodVersion } : {}) }))
  }
  for (const f of s.failed) {
    out.push('', `<details><summary>没讲通 · 第 ${f.version} 版：${oneLine(f.line).replace(/</g, '＜')}</summary>`, '', f.text.trim(), '', '</details>')
  }
  const foot = [
    `[完整对话 · ${s.rounds} 轮](${linkFrom(note, s.id)})`,
    ...(s.viz ? [`[可视化 · ${alt(s.viz.title)}](${linkFrom(note, s.viz.path)})`] : []),
    ...s.links.map((l) => `[[${oneLine(l)}]]`),
  ]
  out.push('', foot.join(' · '))
  return out.join('\n') + '\n'
}

// ---------------------------------------------------------------- 读回来

/** 指回 PDF 某页某块的相对链接 */
function anchorFrom(note: string, pdf: string, page: number, rect?: Rect): string {
  const href = formatPdfAnchor({ file: pdf, page, rect })
  return linkFrom(note, pdf) + href.slice(href.indexOf('#'))
}

/** 一段 md 里能认出的东西；认不出完整对话链接的段（用户自己写的）返回 null */
export function parseSection(chunk: string, note: string): AskSection | null {
  const lines = chunk.replace(/\r\n/g, '\n').split('\n')
  const head = /^##\s+(?:第\s*(\d+)\s*页\s*·\s*)?(.*)$/.exec(lines[0] ?? '')
  if (!head) return null
  const convo = /\[完整对话(?:\s*·\s*(\d+)\s*轮)?\]\(([^)]+)\)/.exec(chunk)
  if (!convo) return null
  const s: AskSection = {
    id: linkTo(note, convo[2]!),
    file: '',
    page: Number(head[1] ?? 1),
    title: head[2]!.trim(),
    figures: [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: Number(convo[1] ?? 1),
    links: [],
  }
  const anchorLine = lines.find((l) => /^\[第\s*\d+\s*页\]\(/.test(l))
  if (anchorLine) {
    const m = /^\[[^\]]*\]\(([^)]+)\)(?:\s*·\s*(\d{1,2}:\d{2}))?/.exec(anchorLine)
    const a = m ? parsePdfAnchor(m[1]!) : null
    if (a) {
      s.file = linkTo(note, encodePath(a.file))
      s.page = a.page
      if (a.rect) s.rect = a.rect
    }
    if (m?.[2]) s.time = m[2]
  } else {
    // 网页、HTML 上问的：第二行是「[域名](网址) · 10:20」
    const w = /^\[([^\]]*)\]\(((?:https?:[^)\s]+)|[^)\s]*\.html?)\)(?:\s*·\s*(\d{1,2}:\d{2}))?\s*$/i.exec(lines[1] ?? '')
    if (w) {
      s.web = { label: w[1]!, url: /^https?:/i.test(w[2]!) ? w[2]!.replace(/%2[089]/gi, (c) => decodeURIComponent(c)) : linkTo(note, w[2]!) }
      // 视频「接着问」的：「▶ 00:06 · 视频名」
      const vt = /^▶ (?:(\d+):)?(\d+):(\d{2}) · /.exec(w[1]!)
      if (vt) s.web.t = Number(vt[1] ?? 0) * 3600 + Number(vt[2]) * 60 + Number(vt[3])
      if (!head[1]) s.page = 0
      if (w[3]) s.time = w[3]
    }
  }
  for (const m of chunk.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const path = linkTo(note, m[2]!)
    if ((m[1] === '我框的' || m[1] === WHOLE_PAGE) && !s.crop) s.crop = path
    else s.figures.push({ path, caption: m[1]! })
  }
  let i = 1
  while (i < lines.length) {
    const l = lines[i]!
    const callout = /^>\s*\[!(\w+)\]\s*(.*)$/.exec(l)
    if (callout) {
      const body: string[] = []
      i++
      while (i < lines.length && /^>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^>\s?/, ''))
      if (callout[1] === 'question') s.doubts.push(...body.map((b) => b.trim()).filter(Boolean))
      else if (callout[1] === 'ai') {
        const h = parseAiCalloutHead(callout[2]!)
        const b = splitAiBody(body)
        s.good = b.text
        s.points.push(...b.points)
        if (h.version) s.goodVersion = h.version
        if (h.by) s.by = h.by
      } else if (callout[1] === 'success') {
        s.good = body.join('\n').trim()
        const v = /第\s*(\d+)\s*版/.exec(callout[2]!)
        if (v) s.goodVersion = Number(v[1])
      }
      continue
    }
    const det = /^<details><summary>没讲通\s*·\s*第\s*(\d+)\s*版[：:]\s*(.*?)<\/summary>\s*$/.exec(l)
    if (det) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^<\/details>\s*$/.test(lines[i]!)) body.push(lines[i++]!)
      i++
      s.failed.push({ version: Number(det[1]), line: det[2]!.replace(/＜/g, '<'), text: body.join('\n').trim() })
      continue
    }
    const pt = /^[-*]\s+(.*)$/.exec(l)
    if (pt) s.points.push(pt[1]!.trim())
    i++
  }
  const footer = lines.find((l) => l.includes('[完整对话'))
  if (footer) {
    for (const m of footer.matchAll(/\[\[([^\]]+)\]\]/g)) s.links.push(m[1]!)
    const v = /\[可视化 · ([^\]]*)\]\(([^)]+)\)/.exec(footer)
    if (v) s.viz = { title: v[1]!, path: linkTo(note, v[2]!) }
  }
  return s
}

function decode(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

interface Chunk {
  from: number
  to: number
  section: AskSection | null
}

/** 按「## 」切成块（代码块里的不算）；第一块之前是开头（属性、一级标题） */
function chunks(md: string, note: string): { head: string; list: Chunk[] } {
  const starts: number[] = []
  let fence = false
  let pos = 0
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && /^##\s/.test(line)) starts.push(pos)
    pos += line.length + 1
  }
  const list = starts.map((from, k) => {
    const to = starts[k + 1] ?? md.length
    return { from, to, section: parseSection(md.slice(from, to), note) }
  })
  return { head: md.slice(0, starts[0] ?? md.length), list }
}

export function parseReadingNote(md: string, note: string): AskSection[] {
  return chunks(md, note)
    .list.map((c) => c.section)
    .filter((s): s is AskSection => !!s)
}

/**
 * 写进一段：同一个完整对话的那段整段换掉；新的一段按页码插（排在页码更大的第一段前面），
 * 用户自己写的段落、开头的属性原样不动。
 */
export function upsertSection(md: string, s: AskSection, note: string): string {
  const text = renderSection(s, note)
  const { list } = chunks(md, note)
  const same = list.find((c) => c.section?.id === s.id)
  if (same) return md.slice(0, same.from) + text + sep(md.slice(same.to)) + md.slice(same.to)
  const after = list.find((c) => c.section && c.section.page > s.page)
  if (after) return md.slice(0, after.from) + text + '\n' + md.slice(after.from)
  const body = md.replace(/\n*$/, '\n')
  return body + '\n' + text
}

/** 换掉的段后面紧跟下一段时补一个空行 */
const sep = (rest: string) => (rest && !rest.startsWith('\n') ? '\n' : '')

// ---------------------------------------------------------------- 完整对话

export interface ConvoTurn {
  role: 'user' | 'ai'
  text: string
  time?: string
  image?: string
}

/** 完整对话存成 md（convo = .canvas-notes/对话/… 它自己的路径），从笔记里点得开 */
export function conversationMd(convo: string, pdf: string, page: number, rect: Rect | undefined, turns: ConvoTurn[]): string {
  const out = [`# ${stem(pdf)} · 第 ${page} 页 · 完整对话`, '', `[回到第 ${page} 页](${anchorFrom(convo, pdf, page, rect)})`]
  for (const t of turns) {
    out.push('', `### ${t.role === 'user' ? '我' : 'AI'}${t.time ? ` · ${t.time}` : ''}`, '')
    if (t.image) out.push(`![${rect ? '我框的' : WHOLE_PAGE}](${linkFrom(convo, t.image)})`, '')
    out.push(t.text.trim())
  }
  return out.join('\n') + '\n'
}
