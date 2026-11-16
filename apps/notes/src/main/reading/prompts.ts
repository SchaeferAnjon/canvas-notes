/**
 * 读 PDF 边读边问的提示词，和把 AI 收好的笔记段读回来（纯函数，单元测试测）。
 */
import { type AskSection, blocksText, type PdfBlock } from '@cn/format'
import { type ReadingMsg, type ReadingThread, VIZ_MARK } from '../../shared/reading'

export const TUTOR_SYSTEM = `你是一个耐心、讲话直白的老师，在 Canvas Notes 笔记软件里陪一个人读 PDF 课件。他读到哪里不懂，就在 PDF 上框一块（发给你的图片）或者整页问你，一直问到懂为止。

怎么讲：
- 先看他框的那块图，结合这一页的文字和整份 PDF 的内容讲。图里的公式、记号照图里的意思讲。
- 用中文，具体、直白，多用一个小例子或具体数字，少用术语堆砌。公式用普通文字和 Unicode（θ、e₁、≤），不要 LaTeX。
- 提到别的页写成链接，比如 [第 4 页](#page=4)，他点了 PDF 会翻过去。
- 他笔记里已经弄懂的（每次会附上），直接拿来用（「用你在第 4 页弄懂的那条」），不要重新讲一遍。
- 他说「还是不懂」「换个方式讲」：上一版就是没讲通，换一个完全不同的角度（比方、画面、具体数字、反例），不要换个说法重复。
- 一次回答控制在 300 字以内，除非他要详细的。不客套，不说「好问题」，不在结尾问「还有什么问题吗」。
- 如果一个能拖能点的小可视化（几何、函数图像、变换、过程演示）会明显帮他懂，在回答最后单独一行写 ${VIZ_MARK}；用不上就不写。`

/** 用户说这些话，表示上一版没讲通 */
export const CONFUSED = /还是不懂|没懂|不懂|看不懂|听不懂|没听懂|不明白|换个方式|换种方式|换个讲法|换个角度|再讲一遍|没看懂/

export function askPrompt(o: {
  pdfName: string
  page: number
  pages: number
  pageText: string
  question: string
  thread: ReadingThread
  /** 整份 PDF 的文字：这个会话还没读过才给 */
  fullText?: string
  /** 全文还没读完（第一次打开时在读） */
  fullPending?: boolean
  /** 笔记里已经弄懂的 */
  digest: string
  hasImage: boolean
  /** 在右栏网页上框着问的 */
  web?: { url: string; title: string; text?: string }
  /** 来源是库里的一份 HTML（可视化） */
  html?: boolean
}): string {
  const out: string[] = []
  if (o.web && /^https?:/i.test(o.web.url)) {
    if (o.digest) out.push(`他笔记里已经弄懂的：\n${o.digest}`)
    if (o.pageText) out.push(`他中间开着的 PDF「${o.pdfName}」正在看第 ${o.page} 页，这一页的文字：\n<page>\n${o.pageText}\n</page>`)
    out.push(`他在右边的网页「${o.web.title}」（${o.web.url}）上框了一块，就是附上的图。框里的字：\n<web>\n${o.web.text || '（框里没有能读的字，看图）'}\n</web>`)
    out.push(`他说：${o.question}`)
    return out.join('\n\n')
  }
  if (o.html) {
    out.push(`他在看一个网页做的可视化「${o.pdfName}」，这是它的字：\n<page>\n${o.pageText || '（没有能读的字）'}\n</page>`)
    out.push(`${o.hasImage ? '他在上面框了一块，就是附上的图。' : '这是他接着刚才那处在追问。'}\n他说：${o.question}`)
    return out.join('\n\n')
  }
  if (o.fullText) out.push(`这是整份 PDF「${o.pdfName}」的文字（共 ${o.pages} 页，「# 」开头的是标题，[图 p5-b3] 是图的位置），先通读一遍，后面他会一处一处问：\n<pdf>\n${o.fullText}\n</pdf>`)
  else if (o.fullPending) out.push(`（整份 PDF「${o.pdfName}」的文字还在读，这一轮先看这一页。）`)
  if (o.digest) out.push(`他笔记里已经弄懂的：\n${o.digest}`)
  out.push(`他现在在看第 ${o.page} 页（共 ${o.pages} 页）。这一页的文字：\n<page>\n${o.pageText || '（这一页没有能选的字，是图片或扫描件）'}\n</page>`)
  const where = o.thread.quote ? `他选中了这段字：「${o.thread.quote}」。` : o.hasImage ? (o.thread.rect ? '他在这一页上框了一块，就是附上的图。' : '附上的图是整页。') : '这是他接着刚才那处在追问。'
  out.push(`${where}\n他说：${o.question}`)
  return out.join('\n\n')
}

/** 全文太长时截断（大约 15 万字，够一学期的讲义） */
export function fullTextOf(pages: PdfBlock[][], max = 150_000): string {
  let out = ''
  for (const blocks of pages) {
    const page = `--- 第 ${blocks[0]?.page ?? '?'} 页 ---\n${blocksText(blocks)}\n`
    if (out.length + page.length > max) return out + `--- 后面的页太长，没放进来 ---\n`
    out += page
  }
  return out
}

/** 笔记里已经弄懂的，给 AI 一行一段 */
export function noteDigest(sections: AskSection[]): string {
  return sections
    .map((s) => `- 第 ${s.page} 页「${s.title}」：${s.good.replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n')
}

/** 一处的几版讲法：第几个 AI 回答是第几版；后面紧跟着「还是不懂」的那几版是没讲通的 */
export function versionsOf(msgs: ReadingMsg[]): { answers: ReadingMsg[]; failed: number[] } {
  const answers: ReadingMsg[] = []
  const failed: number[] = []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!
    if (m.role !== 'ai' || !m.text.trim() || m.error) continue
    answers.push(m)
    const next = msgs.slice(i + 1).find((x) => x.role === 'user')
    if (next && CONFUSED.test(next.text)) failed.push(answers.length)
  }
  return { answers, failed }
}

export const SUMMARY_SYSTEM = `你帮一个人把他和 AI 老师关于 PDF 课件某一处的问答，收成他自己的学习笔记的一段。只输出一个 JSON 对象，不要别的字，不要代码块。`

export function summarizePrompt(o: { pdfName: string; thread: ReadingThread; msgs: ReadingMsg[]; blocks: PdfBlock[]; failed: number[]; titles: string[] }): string {
  const { answers } = versionsOf(o.msgs)
  const convo = o.msgs
    .filter((m) => m.text.trim() && !m.error)
    .map((m) => {
      if (m.role === 'user') return `【他】${m.text}`
      return `【AI 第 ${answers.indexOf(m) + 1} 版】${m.text}`
    })
    .join('\n\n')
  const figures = o.blocks.filter((b) => b.kind === 'image').map((b) => b.id)
  const w = o.thread.web
  const head = w
    ? `${/^https?:/i.test(w.url) ? `网页「${w.title}」（${w.url}）` : `可视化「${w.title}」`}，他框了一块问。

框里的字：
${w.text || blocksText(o.blocks) || '（没有能读的字）'}`
    : `PDF「${o.pdfName}」第 ${o.thread.page} 页${o.thread.quote ? `，他选中的字：「${o.thread.quote}」` : o.thread.rect ? '，他框了一块问' : '，他问的是整页'}。

这一页的文字（[图 pX-bY] 是图）：
${blocksText(o.blocks) || '（没有能选的字）'}`
  return `${head}

问答：
${convo}

${o.failed.length ? `其中第 ${o.failed.join('、')} 版之后他说没懂，这几版算没讲通；最后一版是讲通的。` : '最后一版是讲通的。'}

库里别的笔记的标题（双链只能从这里挑：讲的是同一个知识点的才挑，最多 2 个；拿不准就空着）：
${o.titles.slice(0, 200).join('、') || '（没有）'}

输出 JSON：
{
  "title": "这一处讲的是什么，16 个字以内，像笔记小标题",
  "doubts": ["用他自己的口吻写他卡在哪，一行一条；他只说了「给我讲解一下」的，写成具体卡在哪，比如「整块没看懂：旋转矩阵的四个数是怎么来的」；追问一次加一条"],
  "good": "讲通的那一版讲法，保留它的讲法和例子，压成 2 到 5 句",
  "points": ["2 到 3 条要点，每条一句短话"],
  "failed": [${o.failed.map((v) => `{"version": ${v}, "line": "第 ${v} 版用了什么讲法，一句话，比如「用公式推，没听懂」"}`).join(', ')}],
  "figure": ${figures.length ? `"这一页最重要的一张图，从 ${figures.join('、')} 里挑一个；都不重要就写 null"` : 'null'},
  "figureCaption": "那张图是什么，10 个字以内",
  "links": ["从上面的标题里原样抄，没有就空数组"]
}`
}

/** AI 收好的 JSON 读回来；读不出来时用对话本身兜一段（笔记照样记上，不让这一轮白问） */
export function parseSummary(
  raw: string,
  o: { thread: ReadingThread; msgs: ReadingMsg[]; failed: number[]; titles: string[]; blocks: PdfBlock[] },
): { title: string; doubts: string[]; good: string; points: string[]; failedLines: Record<number, string>; figure?: string; figureCaption?: string; links: string[] } {
  const { answers } = versionsOf(o.msgs)
  const last = answers[answers.length - 1]?.text ?? ''
  const asked = o.msgs.filter((m) => m.role === 'user').map((m) => m.text.trim())
  let j: Record<string, unknown> = {}
  const a = raw.indexOf('{')
  const b = raw.lastIndexOf('}')
  if (a !== -1 && b > a) {
    try {
      j = JSON.parse(raw.slice(a, b + 1)) as Record<string, unknown>
    } catch {
      j = {}
    }
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
  const failedLines: Record<number, string> = {}
  if (Array.isArray(j.failed))
    for (const f of j.failed as { version?: unknown; line?: unknown }[]) {
      const v = Number(f?.version)
      if (o.failed.includes(v) && str(f?.line)) failedLines[v] = str(f.line)
    }
  for (const v of o.failed) failedLines[v] ??= oneLine(answers[v - 1]?.text ?? '', 30)
  const figureIds = new Set(o.blocks.filter((x) => x.kind === 'image').map((x) => x.id))
  const figure = str(j.figure)
  const titles = new Set(o.titles)
  return {
    title: str(j.title).slice(0, 40) || oneLine(asked.find((q) => !/^给我讲解一下$/.test(q)) ?? `第 ${o.thread.page} 页`, 16),
    doubts: list(j.doubts).length ? list(j.doubts) : asked,
    good: str(j.good) || last,
    points: list(j.points).slice(0, 4),
    failedLines,
    ...(figureIds.has(figure) ? { figure, figureCaption: str(j.figureCaption) || '这页的图' } : {}),
    links: list(j.links).filter((l) => titles.has(l)).slice(0, 2),
  }
}

function oneLine(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

// ---------------------------------------------------------------- 做个可视化

export const VIZ_SYSTEM = `你帮一个正在读课件的人做一个能拖能点的小可视化网页，帮他看懂一处他卡住的地方。只输出一个完整的 HTML 文件，不要别的字。`

export function vizPrompt(o: { pdfName: string; thread: ReadingThread; msgs: ReadingMsg[]; pageText: string; good?: string }): string {
  const convo = o.msgs
    .filter((m) => m.text.trim() && !m.error)
    .map((m) => `【${m.role === 'user' ? '他' : 'AI'}】${m.text.replace(VIZ_MARK, '').trim()}`)
    .join('\n\n')
  return `PDF「${o.pdfName}」第 ${o.thread.page} 页${o.thread.rect ? '，他框了附上的这一块' : ''}。

这一页的文字：
${o.pageText || '（没有能选的字）'}

他和 AI 的问答：
${convo}
${o.good ? `\n最后讲通的讲法：${o.good}\n` : ''}
做一个单文件 HTML 可视化，让他自己拖一拖、点一点就看懂这一处。要求：
- 一个完整的 HTML 文件，<!doctype html> 开头；CSS 和 JS 都写在文件里，不引任何外部文件、字体、图片，不联网。
- 能动手：滑块、拖动的点、按钮，动的时候数字和图一起变；关键的数写在图旁边。
- 中文说明，一两句告诉他拖哪里、看什么。
- 浅色深色都看得清（用 prefers-color-scheme），窗口 600 到 1400 宽都放得下。
- <title> 写 8 到 16 个字的标题，像「旋转矩阵 · 拖动角度看基向量」。`
}

/** 从回答里取出 HTML（可能包在 \`\`\`html 里）；取不出返回 null */
export function extractHtml(reply: string): string | null {
  const fenced = /\`\`\`(?:html)?\s*([\s\S]*?)\`\`\`/i.exec(reply)?.[1] ?? reply
  const a = fenced.search(/<!doctype html|<html[\s>]/i)
  const b = fenced.toLowerCase().lastIndexOf('</html>')
  if (a === -1 || b < a) return null
  return fenced.slice(a, b + 7)
}

/** 标题：<title> 里的字，去掉文件名里不能用的 */
export function vizTitle(html: string, fallback: string): string {
  const t = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim()
  return (t || fallback).slice(0, 40)
}

export const vizFileStem = (title: string) => title.split('·')[0]!.replace(/[\\/:*?"<>|#%\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30) || '可视化'

/** 属性写进 <head> 的 meta（HTML 没有 frontmatter）：类型 可视化、课程、第几讲、来源 */
export function withVizMeta(html: string, props: Record<string, string>): string {
  const metas = Object.entries(props)
    .filter(([, v]) => v)
    .map(([k, v]) => `<meta name="${k}" content="${v.replace(/"/g, '&quot;')}">`)
    .join('\n')
  const at = html.search(/<head[^>]*>/i)
  if (at === -1) return html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${metas}\n</head>`)
  const end = html.indexOf('>', at) + 1
  return html.slice(0, end) + '\n' + metas + html.slice(end)
}
