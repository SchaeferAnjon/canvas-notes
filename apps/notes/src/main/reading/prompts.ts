/**
 * 读 PDF 边读边问的提示词，和把 AI 收好的笔记段读回来（纯函数，单元测试测）。
 */
import { answerLead, type AskSection, blocksText, type PdfBlock } from '@cn/format'
import { MATH_RULE, PRE_MARK, type ReadingMsg, type ReadingThread, VIZ_MARK, withoutVizMark } from '../../shared/reading'
import { MODES_RULE } from '../agent/modes'
import { CITE_FIND, CITE_RULE } from '../../shared/cite-rule'
import { fmtTime } from '../../shared/video'

/**
 * 读 PDF 讲解的那几条（CN-89）：Claude Code 不再整个换掉它自己的系统提示，这几条用 --append-system-prompt 附在后面（engines.ts 的 appendSystem）；
 * Codex 放在 developerInstructions，Gemini、OpenCode 放在会话第一段话前面。前四行照 A 组方案 notes.md「回答讲透」原样写，
 * 后面是原来就有用的几条（框了图的那一问还让 AI 写配图的框，在每一问的话里：FIGURE_ASK）
 */
export const TUTOR_SYSTEM = `你在 Canvas Notes 里陪一个人读 PDF 课件。他在 PDF 上框一块、或在你的回答里选一句来问你。
把这件事真讲明白：先一句话说清它是什么，再按一条线讲下去：为什么要有它、每一项在干什么、拿一个具体数字或例子走一遍。需要时用小标题和列表。
长短看问题：整块的「讲解一下」要讲透，不怕长；旁支里的小追问简短回答。
${MATH_RULE}提到这份 PDF 的别的页一律写成链接：[第 4 页](#page=4)；页码范围写 [第 1–2 页](#page=1)，开头的章节地图、列表里的每一项、长讲解里第二次提到同一页、「对照第 4 页的表 II」这种带尾巴的、「下一页」「上一页」这种说法（写成 [下一页](#page=5)）都要写成链接。
说的是那一页上某一段、某一句时（「§III-B 开头一句话带过」「原文这样写」），链接里接上 &text= 和那段原文开头的 6 到 12 个词：照 PDF 原文的语言一字不改地抄（不是你的译文），空格写 %20，抄到括号、方括号、引号前就停，像 [第 2 页](#page=2&text=We%20additionally%20extract%20a%20static%20feature%20stream)；软件按它跳到那一段。说整页的不写 text。
他笔记里已经弄懂的（每次会附上），直接拿来用（「用你在 [第 4 页](#page=4) 弄懂的那条」），不要重新讲一遍。
他说「还是不懂」「换个方式讲」：上一版就是没讲通，换一个完全不同的角度（比方、画面、具体数字、反例），不要换个说法重复。
如果一个能拖能点的小可视化（几何、函数图像、变换、过程演示）会明显帮他懂，在回答最后单独一行写 ${VIZ_MARK}；用不上就不写。
这一问要讲的主要不是这份 PDF（或他在右栏网页、视频上问的那一处）本身写了什么，而是读懂它要的、它外面的基础知识（大 O 复杂度怎么算、自注意力一般怎么算、某个数学工具、领域常识），在回答最后单独一行写 ${PRE_MARK}；讲眼前内容本身的不写。
你也能动手（canvas 这组工具）：在库里新建、改写、改名、挪动、删笔记，建文件夹，看库里有哪些笔记、读一篇。他让你记下来、整理、挪笔记时直接做，这一轮结束软件提交一次，他能一键撤回。
这是笔记软件里的读书对话，不是终端里接活：用不着建任务看板、写交付页，小事不派子 Agent。
${MODES_RULE}
提到库里别的东西（他的计划、别的笔记、别的 PDF、白板……）照下面写成链接：
${CITE_RULE}
${CITE_FIND}`

/**
 * 讲法改过就加一：claude 默认记下一个会话第一次用的系统提示、以后接着聊都用记下的那份（--system-prompt-snapshot），
 * 旧会话接着聊还是旧讲法（「300 字以内」）。版本不对的会话不再接着聊，开新会话、补上全文和最近几轮（和会话接不上一样）。
 * 4：能动手（canvas 工具）、两种模式（2026-11-19）；5：提到库里的东西写成链接、路径照【库里的笔记】（task-3e53q）；
 * 6：页码链接带引的那句原文 &text=（页码链接跳到段）；7：讲论文外的前置知识时回答末尾标〔前置知识〕（前置知识标签）；
 * 8：网页、视频上问的也标前置知识（功能小三件）
 */
export const TUTOR_VERSION = 8

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
  web?: { url: string; title: string; text?: string; t?: number; answer?: string }
  /** 视频「接着问」：那一秒前后的字幕（右栏开着这个视频、有字幕时） */
  subs?: string
  /** 来源是库里的一份 HTML（可视化） */
  html?: boolean
  /** 这一问材料里带着图（贴截图问的那一问；接着问的只打字的不算） */
  shot?: boolean
  /** 附上的公式截图是哪几块（@cn/format 的 formulaImagesNote；文字层里公式是拆散的，以图为准） */
  formulaNote?: string
}): string {
  const out: string[] = []
  if (o.web && /^https?:/i.test(o.web.url) && o.web.t !== undefined) {
    // 视频问答块上「接着问」：带上那一帧（附的图）、那一问的回答和前后字幕，AI 才知道「第三个箭头」指什么
    const time = fmtTime(o.web.t)
    if (o.pageText) out.push(`他中间开着的 PDF「${o.pdfName}」正在看第 ${o.page} 页，这一页的文字：\n<page>\n${o.pageText}\n</page>`)
    out.push(`他在看右边的视频「${o.web.title}」（${o.web.url}），在 ${time} 那一帧框了一块问过：「${o.thread.quote ?? ''}」。${o.hasImage ? `附上的图是 ${time} 那一帧（紫色框是他当时框的地方）。` : ''}`)
    if (o.web.answer) out.push(`你当时的回答：\n<answer>\n${o.web.answer}\n</answer>`)
    if (o.subs) out.push(`${time} 前后的字幕：\n<subs>\n${o.subs}\n</subs>`)
    out.push(`这是他接着那一问在追问。\n他说：${o.question}`)
    return out.join('\n\n')
  }
  if (o.web && /^https?:/i.test(o.web.url)) {
    if (o.digest) out.push(`他笔记里已经弄懂的：\n${o.digest}`)
    if (o.pageText) out.push(`他中间开着的 PDF「${o.pdfName}」正在看第 ${o.page} 页，这一页的文字：\n<page>\n${o.pageText}\n</page>`)
    // 网页上选中一段字问的（task-6cxtc 网页选字的小条）：没有图，给那段字；框了一块的给图和框里的字
    if (o.thread.quote && !o.hasImage) out.push(`他在右边的网页「${o.web.title}」（${o.web.url}）上选中了这段字：\n<web>\n${o.thread.quote}\n</web>`)
    else out.push(`他在右边的网页「${o.web.title}」（${o.web.url}）上框了一块，就是附上的图。框里的字：\n<web>\n${o.web.text || '（框里没有能读的字，看图）'}\n</web>`)
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
  // 贴截图问的（0.5.9）：说清这一页是怎么定的；没认出是哪一页的不给哪一页的字
  const found = o.thread.found === 'none' || (o.shot && o.thread.found !== 'moved') ? o.thread.found : undefined
  if (found === 'none') out.push(`他贴了一张截图（材料里的图），按图里的字在这份 PDF 里没找到是哪一页，先看图回答。`)
  else
    out.push(
      `${found === 'ocr' ? `他贴了一张截图（材料里的图），按图里的字认出是第 ${o.page} 页（共 ${o.pages} 页）` : found === 'view' ? `他贴了一张截图（材料里的图），图里的字没认出是哪一页，他问的时候正看着第 ${o.page} 页（共 ${o.pages} 页）` : `他现在在看第 ${o.page} 页（共 ${o.pages} 页）`}。这一页的文字：\n<page>\n${o.pageText || '（这一页没有能选的字，是图片或扫描件）'}\n</page>`,
    )
  if (o.formulaNote) out.push(o.formulaNote)
  const where = found ? '' : o.thread.quote ? `他选中了这段字：「${o.thread.quote}」。` : o.hasImage ? (o.thread.rect ? '他在这一页上框了一块，就是附上的图。' : '附上的图是整页。') : '这是他接着刚才那处在追问。'
  out.push(`${where ? where + '\n' : ''}他说：${o.question}`)
  // 配图的框（CN-60）：笔记里要配一张图时按这个框从 PDF 重新画的页面里裁，矢量画的图也裁得对
  if (o.hasImage && !o.thread.quote) out.push(FIGURE_ASK)
  return out.join('\n\n')
}

/** 让 AI 在回答最后顺带写配图的框（软件认出来就去掉，不显示） */
export const FIGURE_ASK =
  '回答完以后，如果附上的图里有值得配进笔记的图（示意图、结构图、流程图、表格、函数图像；不算 Logo、页眉页脚、整段文字），最后单独写一行：〔配图 左,上,宽,高 · 这张图是什么，10 个字以内〕，四个数是它在附上的图里的位置，0 到 1 的比例，框紧一点、把图的标注带上；没有就不写这一行。'

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

/** 笔记里已经弄懂的，给 AI 一行一段：新格式用每轮的小结，以前的笔记用讲通的讲法 */
export function noteDigest(sections: AskSection[]): string {
  return sections
    .map((s) => `- 第 ${s.page} 页「${s.title}」：${(s.qas ? s.recap || s.good : s.good).replace(/\s+/g, ' ').slice(0, 160)}`)
    .join('\n')
}

/**
 * 旁支里问的话（CN-90）：第一问告诉 AI 被问的那句和它所在的那一轮（Claude Code 的分叉只能整段分，AI 要知道问的是哪一轮的哪一句）；
 * 接着问的只说接着这条旁支（会话接着旁支自己的）
 */
export function sidePrompt(o: { first: boolean; quote: string; page: number; title?: string; ask?: string; question: string }): string {
  if (!o.first) return `（接着这条旁支问，问的还是「${o.quote}」这句。）\n他说：${o.question}`
  const round = `那一轮在${o.page > 0 ? `第 ${o.page} 页` : '这里'}${o.title ? `「${o.title}」` : ''}${o.ask ? `，他问的是：${o.ask}` : ''}`
  return `（这是一条旁支：他在你前面的一个回答里选中了一句另问，问完回到主对话，主对话照旧。）\n${round}\n他选中的那句：「${o.quote}」\n他说：${o.question}`
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
