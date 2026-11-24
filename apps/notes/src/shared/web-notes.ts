/**
 * 网页的笔记写进这个网页正在剪进去的那篇（task-6cxtc，偏好「网页的笔记记在正在剪进去的那篇」，设计稿 11-选中小条 第 2 节）：
 * - 一问一块 `[!ai]`，块头带回到网页那一段的链接（web-link.ts），下面引着那几句原文、再是回答：
 *
 *     > [!ai] 讲解一下 · Claude Code · Opus 5.5 · [2.2.1 读取数据集 ↩](https://…/pandas.html#:~:text=下面我们将数据集按行写入CSV文件中。)
 *     > > 下面我们将数据集按行写入CSV文件中。
 *     >
 *     > 这段在准备练习用的数据：……
 *
 *   自己问的（引用以后打的问题）头一个词是「你问：问题原话」；引了几段时每段前面 ①②，和问题里的编号对得上。框一块问的放那块的截图。
 * - 剪藏照旧是引文 + 来源一行，来源一行的链接也是回到那一段的（「—— [2.2.1 读取数据集 · 动手学深度学习](…#:~:text=…)」）。
 * - 右栏「笔记」标签、网页上的小标从那篇里认回「来自这一页的几条」（webEntries）。
 * - 2026-11-24 起问答照「记笔记」开关写进剪藏那篇本身（偏好「剪藏和AI笔记同一篇」，@cn/format 的 ai-note.ts 新写法：问的那句做小标题、
 *   引用那几段带回到这一段的来源、图、一块带「回到 AI 对话」链接的 AI 回答框）：webEntries 也认这种，认成「问的」，不算剪藏。
 * 纯函数：界面、测试都用，不碰 Electron。
 */
import { aiCallout, askUnits } from '@cn/format'
import { mdUrl } from './layout'
import { normText } from './read-anchor'
import { parseFragment, samePage } from './web-link'

/** 自己问的头一个词 */
export const ASKED = '你问'

export interface WebAsk {
  /** 讲解一下 / 翻译 + 讲一讲 / 你问：问题原话 */
  label: string
  /** 「Claude Code · Opus 5.5」 */
  by: string
  /** 回到网页那一段的链接（几段时几个） */
  links: { text: string; url: string }[]
  /** 引着的原文（选中的字）；几段时前面加 ①② */
  quotes: string[]
  /** 框一块问的那块截图（库里的路径） */
  image?: string
  answer: string
}

const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim()
/** 链接上的字里不能有方括号（md 链接会断开） */
const linkText = (s: string) => s.replace(/[[\]]/g, ' ').trim()

/**
 * 写成一块 `[!ai]`（不带结尾换行）。块头和 AI 对话「插进文档」、视频讲解、读 PDF 的 AI 块是同一个写法（@cn/format 的 aiCallout：
 * 「头一个词 · 谁答的 · 看了什么」），这里「看了什么」是回到网页那一段的链接；块里先引着那几句、框的那块截图，空一行再是回答
 */
export function webAskBlock(a: WebAsk): string {
  const many = a.quotes.length > 1
  // 引着的原文可以有几行（块级公式、代码块）：每行前面「> 」，空行写「>」不断开这段引文；几段时第一行前面 ①②
  const quoted = (q: string, i: number) =>
    q
      .trim()
      .split('\n')
      .map((l, k) => (l.trim() ? `> ${k === 0 && many ? `${MARKS[i] ?? ''} ` : ''}${l}` : '>'))
  const lead = [...a.quotes.flatMap(quoted), ...(a.image ? [`![我框的](${mdUrl(a.image)})`] : [])]
  const seen = a.links.map((l) => `[${linkText(l.text)}](${l.url})`).join(' · ')
  return aiCallout({ label: oneLine(a.label), ...(a.by ? { by: a.by } : {}), ...(seen ? { seen } : {}), text: [...lead, ...(lead.length ? [''] : []), a.answer.trim()].join('\n') })
}

/** 回答头一个词：讲解一下、翻译 + 讲一讲；自己问的是「你问：原话」 */
export function askLabel(question: string): string {
  const q = oneLine(question)
  if (q === '给我讲解一下') return '讲解一下'
  if (q === '先把这块翻译成中文，再讲一讲') return '翻译 + 讲一讲'
  return `${ASKED}：${q}`
}

/** 右栏「笔记」里一条（从那篇里认回来的） */
export interface WebEntry {
  /** ask：AI 那一块（讲解一下、翻译 + 讲一讲、你问）；clip：剪藏 */
  kind: 'ask' | 'clip'
  /** 讲解一下 / 翻译 + 讲一讲 / 你问 / 剪藏 */
  label: string
  /** 列表里那一行的字：你问的是问题原话；讲解一下「那句」；剪藏「那段」 */
  title: string
  /** 那段上面的小标题（链接上写的字，去掉 ↩） */
  head: string
  /** 回到那一段的链接 */
  url: string
  /** 链接里那段开头 */
  text: string
  /** 引着的原文（网页上画点线、回到那几句用）；没有就是那段开头 */
  quote: string
  /** 这一块（剪藏是引文的第一行）在那篇里第几行（从 0 数） */
  line: number
  /** 认这一条：头一行（剪藏是来源那一行）的原文和第几次出现（行号会变，原文不变） */
  key: string
  /** key 那一行（块头；剪藏是来源那一行）在那篇里第几行（从 0 数）：查那一行是哪次提交写的 */
  keyAt: number
  /** 剪的是一张图（网页图拖进对话）：网页上照图注认回那张图标「剪过」 */
  img?: true
}

const LINK = /\[([^\]\n]*)\]\(([^)\s]+)\)/g
const AI_HEAD = /^\s*>\s*\[!ai\][+-]?[ \t]+(.*)$/i
const SOURCE = /^——\s*(.*)$/
/** 一张图：![说明](路径) */
const IMAGE = /^!\[([^\]\n]*)\]\([^)\n]+\)\s*$/

const words = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null

/** 列表里引的那段太长就截到 27 个字以内、截在词边上（照设计稿「举一个例子，我们首先创建一个人工数据集，并存储在CSV…」） */
function short(s: string, n = 27): string {
  if (s.length <= n) return s
  let out = ''
  for (const p of words?.segment(s) ?? []) {
    if (out.length + p.segment.length > n) break
    out += p.segment
  }
  return (out || s.slice(0, n)).replace(/[\s，,、；;：:]+$/, '') + '…'
}

/** 那篇里来自这一页（网址 # 后面不算）的几条，按在那篇里的先后 */
export function webEntries(md: string, page: string): WebEntry[] {
  const lines = md.split('\n')
  const out: WebEntry[] = []
  const seen = new Map<string, number>()
  const keyOf = (s: string) => {
    const n = (seen.get(s) ?? 0) + 1
    seen.set(s, n)
    return `${s}\n${n}`
  }
  // 新写法的一问（引用后紧跟带对话链接的 AI 块）：来源行回到这一页的，认成「问的」；它占的那几行不再当剪藏、旧块认
  const lineAt = (pos: number) => md.slice(0, pos).split('\n').length - 1
  const taken: [number, number][] = []
  for (const u of askUnits(md, '')) {
    const from = lineAt(u.from)
    taken.push([from, lineAt(u.end)])
    if (u.ask.side) continue
    // 回到这一页的那条链接：来源行（选的那段、框的那块），或带着 ①② 引的那几段的来源
    const links = [...(u.ask.src ? [{ ...u.ask.src, quote: u.ask.quote ?? '' }] : []), ...(u.ask.mats ?? []).flatMap((m) => (m.kind === 'quote' && m.href ? [{ label: m.src, href: m.href, quote: m.text }] : []))]
    const hit = links.map((l) => ({ l, frag: parseFragment(l.href) })).find((x) => x.frag && samePage(x.frag.page, page))
    if (!hit) continue
    const frag = hit.frag!
    const href = hit.l.href
    const q = oneLine(u.ask.q)
    const label = askLabel(q)
    const asked = label.startsWith(`${ASKED}：`)
    const quote = normText(hit.l.quote) || frag.text
    out.push({
      kind: 'ask',
      label: asked ? ASKED : label,
      title: asked ? q : `${label}「${short(quote, 40)}」`,
      head: hit.l.label.replace(/\s*↩\s*$/, '').split(' · ')[0]!.trim(),
      url: href,
      text: frag.text,
      quote,
      line: from,
      key: keyOf(lines[from]!),
      keyAt: from,
    })
  }
  const inAsk = (i: number) => taken.some(([a, b]) => i >= a && i < b)
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (inAsk(i)) continue
    if (/^\s*(```|~~~)/.test(l)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const ai = AI_HEAD.exec(l)
    if (ai && !(i > 0 && /^\s*>/.test(lines[i - 1]!))) {
      const links = [...ai[1]!.matchAll(LINK)].map((m) => ({ text: m[1]!, url: m[2]!, frag: parseFragment(m[2]!) })).filter((x) => x.frag && samePage(x.frag.page, page))
      if (!links.length) continue
      const first = links[0]!
      const label = ai[1]!.split(' · ')[0]!.trim()
      const quotes: string[] = []
      for (let k = i + 1; k < lines.length && /^\s*>/.test(lines[k]!); k++) {
        const q = /^\s*>\s?>\s?(.*)$/.exec(lines[k]!)
        if (q) quotes.push(q[1]!.replace(new RegExp(`^[${MARKS}]\\s*`), ''))
        else if (quotes.length) break
      }
      const quote = normText(quotes[0] ?? '') || first.frag!.text
      const asked = label.startsWith(`${ASKED}：`)
      out.push({
        kind: 'ask',
        label: asked ? ASKED : label,
        title: asked ? label.slice(ASKED.length + 1).trim() : `${label}「${short(quote, 40)}」`,
        head: first.text.replace(/\s*↩\s*$/, '').trim(),
        url: first.url,
        text: first.frag!.text,
        quote,
        line: i,
        key: keyOf(l),
        keyAt: i,
      })
      continue
    }
    const src = SOURCE.exec(l)
    if (!src) continue
    // 剪的一张图：图、（空一行）、来源一行
    const imgAt = IMAGE.test(lines[i - 1] ?? '') ? i - 1 : !(lines[i - 1] ?? '').trim() && IMAGE.test(lines[i - 2] ?? '') ? i - 2 : -1
    if (imgAt < 0 && !/^\s*>/.test(lines[i - 1] ?? '')) continue
    const link = [...src[1]!.matchAll(LINK)].map((m) => ({ text: m[1]!, url: m[2]!, frag: parseFragment(m[2]!) })).find((x) => x.frag && samePage(x.frag.page, page))
    if (!link) continue
    if (imgAt >= 0) {
      const alt = normText(IMAGE.exec(lines[imgAt]!)![1]!)
      const head = link.text.split(' · ')[0]!.trim()
      out.push({ kind: 'clip', label: '剪藏', title: `图「${short(alt || head)}」`, head, url: link.url, text: link.frag!.text, quote: alt || link.frag!.text, line: imgAt, key: keyOf(l), keyAt: i, img: true })
      continue
    }
    let k = i - 1
    while (k > 0 && /^\s*>/.test(lines[k - 1]!) && !AI_HEAD.test(lines[k - 1]!)) k--
    const quote = normText(
      lines
        .slice(k, i)
        .map((x) => x.replace(/^\s*>\s?/, ''))
        .join(' '),
    )
    out.push({
      kind: 'clip',
      label: '剪藏',
      title: `「${short(quote)}」`,
      head: link.text.split(' · ')[0]!.trim(),
      url: link.url,
      text: link.frag!.text,
      quote: quote || link.frag!.text,
      line: k,
      key: keyOf(l),
      keyAt: i,
    })
  }
  return out.sort((a, b) => a.line - b.line)
}
