import { Codicon } from '@cn/design'
import { type CiteRun, codeCite, detailsHead, findAutoCites, inlineMath, linkedSeen, mathBlockAt, wikiLabel } from '@cn/format'
import type { ReactNode } from 'react'
import { parseCallout } from './callout'
import { autoLinkProps, type CiteScope, useCiteRun } from './cite-names'
import { EngineLogo } from './engine-logo'
import { MathBlock, MathInline } from './reading/math'
import { ScrollX } from './scroll-x'
import { t as tNow } from '../shared/i18n'

/** 和第 from 行之前那个折叠块配对的 </details> 在第几行（里面套着的折叠块数着开、关跳过）；没有是 -1 */
function detailsClose(lines: string[], from: number): number {
  let depth = 0
  for (let k = from; k < lines.length; k++) {
    const inner = detailsHead(lines, k)
    if (inner) {
      depth++
      k += inner.lines - 1
    } else if (/^\s*<\/details>\s*$/i.test(lines[k]!)) {
      if (depth === 0) return k
      depth--
    }
  }
  return -1
}

/**
 * 引文下面挂的一段「我的评价：」「微信读书的想法：」（和文档里 review.ts 的 tagOf 一个认法：「微信读书的想法」要带冒号）：
 * 哪种、标签连冒号多长
 */
export function reviewTag(line: string): { wr: boolean; len: number } | null {
  const m = /^(\*\*)?(我的评价|微信读书的想法)(\*\*)?([：:])?(\*\*)?[ \t]*/.exec(line)
  if (!m) return null
  const wr = m[2] === '微信读书的想法' // 不翻：写进文件的标签
  if (wr && !m[4]) return null
  return { wr, len: m[0].length }
}

/**
 * 「我的评价」「微信读书的想法」一段：前面一个小标签（文件里的冒号不画），挂在引文下面时从引文竖线拐下来一道弯钩（hooked）。
 * 和文档里（review.css 的 cm-review-tag）一个样子，卡片里小一号
 */
export function Attached({ wr, children, hooked, clamp }: { wr: boolean; children: ReactNode; hooked: boolean; clamp?: string }) {
  // 不翻：写进文件的标签，照文件里的字画（同文档里 review.ts 的标签小块）
  const tag = <span className={'md-review-tag' + (wr ? ' wr' : '')}>{wr ? '微信读书的想法' : '我的评价'}</span>
  return (
    <div className={'md-attached' + (hooked ? ' hooked' : '')} data-kind={wr ? 'wr' : 'me'}>
      {clamp ? (
        <div className={clamp}>
          {tag}
          {children}
        </div>
      ) : (
        <>
          {tag}
          {children}
        </>
      )}
    </div>
  )
}

/**
 * AI 回答里的 md 显示成排好的样子：标题、列表、引用、代码块、分隔线、段落，行内的加粗、斜体、代码、链接、双链。
 * 全部走 React 元素（不拼 HTML）；边生成边显示时半截的 md 也照常显示。
 * math：公式用 KaTeX 排（CN-89；task-o48fa 起白板卡片、文档切成的白板也排，默认开）：哪段算公式和文档编辑器同一个认法
 * （@cn/format 的 inlineMath / mathBlockAt：行内 $…$、\(…\)，单独成行的 $$…$$、\[…\]；「$5 和 $10」这样的钱数、代码里的不算）
 */
export function Markdown(p: { text: string; math?: boolean; cites?: CiteScope }) {
  return p.cites ? <CitedMarkdown {...p} cites={p.cites} /> : <MarkdownBody text={p.text} math={p.math ?? true} />
}

/**
 * AI 的回答（task-3e53q）：没写成链接的路径、笔记名也认成链接（cite-names.tsx）。只有带 cites 的才认（AI 对话、读 PDF、旁支、视频问框的回答），
 * 白板卡、文档里画的 md 是用户自己的字，不认
 */
function CitedMarkdown(p: { text: string; math?: boolean; cites: CiteScope }) {
  const make = useCiteRun(p.cites)
  const run = make()
  // AI 自己写成链接的那几篇（不管写在前面还是后面）：回答里光写它们名字的不再按名字认（真 Claude Code 写「第3讲 PDF 的[第 4 页](…第3讲.pdf…)」）
  for (const m of p.text.matchAll(/\[\[([^\]\n]+)\]\]|\[[^\]\n]+\]\((<[^>\n]+>|[^)\n]+)\)/g)) linkedSeen(m[1] !== undefined ? { wiki: m[1] } : { href: m[2]!.replace(/^<(.*)>$/, '$1').replace(/\s+"[^"]*"$/, '') }, run)
  return <MarkdownBody text={p.text} math={p.math ?? true} cites={p.cites} auto={{ run, conv: p.cites.conv }} />
}

/** 正在画的这条回答认链接用的（MarkdownBody 画的时候放上、画完拿掉；inline 同步调，读得到）；标题、折叠块的头里不认 */
let auto: { run: CiteRun; conv: string } | null = null

function MarkdownBody(p: { text: string; math: boolean; cites?: CiteScope; auto?: { run: CiteRun; conv: string } }) {
  const outer = auto
  auto = p.auto ?? null
  try {
    return markdownBody(p.text, p.math, p.cites)
  } finally {
    auto = outer
  }
}

/** 不认链接地画一段（标题、折叠块的头、提示块的头） */
function bare<T>(f: () => T): T {
  const a = auto
  auto = null
  try {
    return f()
  } finally {
    auto = a
  }
}

function markdownBody(text: string, math: boolean, cites: CiteScope | undefined) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  const key = () => out.length
  /** 最后一块引文（或者挂在引文下面的评价）在 out 里的位置：紧跟着它、以标签开头的一段挂上去，画弯钩 */
  let hookable = -1
  while (i < lines.length) {
    const line = lines[i]!
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!)
      i++
      out.push(
        <pre key={key()} className="md-code">
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    // 单独成行的公式：$$…$$、\[…\] 一行写完，或者开头一行、结尾一行夹着（边生成边显示还没到结尾时先按字显示）；认法同文档编辑器（@cn/format 的 mathBlockAt）
    const mb = math ? mathBlockAt(lines, i) : null
    if (mb) {
      out.push(<MathBlock key={key()} latex={mb.tex} raw={lines.slice(i, mb.end + 1).join('\n').trim()} />)
      i = mb.end + 1
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = Math.min(h[1]!.length, 3)
      out.push(
        <div key={key()} className={`md-h md-h${level}`}>
          {bare(() => inline(h[2]!, key(), math))}
        </div>,
      )
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key()} className="md-hr" />)
      i++
      continue
    }
    // 折叠块 <details><summary>…</summary> … </details>：收着，点开看（不露 HTML 标签）
    const det = detailsHead(lines, i)
    const close = det ? detailsClose(lines, i + det.lines) : -1
    if (det && close !== -1) {
      out.push(
        <details key={key()} className="md-fold" open={det.open}>
          <summary>
            <Codicon name="chevron-right" size={14} />
            <span>{bare(() => inline(det.title, key(), math))}</span>
          </summary>
          <Markdown text={lines.slice(i + det.lines, close).join('\n')} math={math} {...(cites ? { cites } : {})} />
        </details>,
      )
      i = close + 1
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      const c = parseCallout('> ' + body[0]!)
      if (c) {
        // AI 讲解：「AI 讲解」是名字，后面「 · 引擎 · 模型 · 看了什么」淡一号、一行放不下就省略（同文档里的 cm-callout-meta）
        const title = c.title || c.label
        const cut = c.kind === 'ai' ? title.indexOf(' · ') : -1
        out.push(
          <div key={key()} className={`md-callout tone-${c.tone}`} data-kind={c.kind}>
            <div className="md-callout-h">
              {c.engine ? <EngineLogo id={c.engine} size={14} /> : <Codicon name={c.icon} size={14} />}
              {cut > 0 ? (
                <>
                  <span className="md-callout-name">{title.slice(0, cut)}</span>
                  <span className="md-callout-meta">{bare(() => inline(title.slice(cut), key(), math))}</span>
                </>
              ) : (
                <span className="md-callout-name">{title}</span>
              )}
            </div>
            {body.length > 1 && <Markdown text={body.slice(1).join('\n')} math={math} {...(cites ? { cites } : {})} />}
          </div>,
        )
        continue
      }
      out.push(
        <blockquote key={key()} className="md-quote">
          {joinLines(body, key(), math)}
        </blockquote>,
      )
      hookable = out.length - 1
      continue
    }
    // 表格：表头行下面紧跟分隔行 |---|:---:| 才算；边生成边显示时分隔行还没到，先按段落显示
    if (isRow(line) && i + 1 < lines.length && isDelim(lines[i + 1]!)) {
      const head = cells(line)
      const align = cells(lines[i + 1]!).map((c): 'center' | 'right' | undefined => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : undefined))
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isRow(lines[i]!)) rows.push(cells(lines[i++]!))
      const k = key()
      const st = (j: number) => (align[j] ? { textAlign: align[j] } : undefined)
      out.push(
        // 宽了只在自己框里横着滚，哪边还有列哪边渐隐（scroll-x.tsx，白板卡、AI 回答、读 PDF 讲解卡共用）
        <ScrollX key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} style={st(j)}>
                    {inline(c, `${k}-h${j}`, math)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {head.map((_, j) => (
                    <td key={j} style={st(j)}>
                      {inline(row[j] ?? '', `${k}-${r}-${j}`, math)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>,
      )
      continue
    }
    const ul = /^(\s*)[-*+]\s+(.*)$/
    const ol = /^(\s*)(\d+)[.)]\s+(.*)$/
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line) && !ul.test(line)
      const items: { text: string; indent: number; done?: boolean }[] = []
      while (i < lines.length) {
        const l = lines[i]!
        const m = ordered ? ol.exec(l) : ul.exec(l)
        if (m) {
          let t = ordered ? m[3]! : m[2]!
          let done: boolean | undefined
          const task = /^\[( |x|X)\]\s+(.*)$/.exec(t)
          if (task) {
            done = task[1] !== ' '
            t = task[2]!
          }
          items.push({ text: t, indent: m[1]!.length, done })
          i++
        } else if (l.trim() && /^\s{2,}\S/.test(l) && items.length) {
          // 列表项的续行
          items[items.length - 1]!.text += ' ' + l.trim()
          i++
        } else break
      }
      const List = ordered ? 'ol' : 'ul'
      out.push(
        <List key={key()} className="md-list">
          {items.map((it, j) => (
            <li key={j} style={it.indent ? { marginLeft: Math.min(it.indent, 8) * 6 } : undefined} className={it.done === undefined ? undefined : it.done ? 'md-task done' : 'md-task'}>
              {it.done !== undefined && <span className="md-box">{it.done ? '✓' : ''}</span>}
              {inline(it.text, `${key()}-${j}`, math)}
            </li>
          ))}
        </List>,
      )
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,6}\s|\s*>|\s*[-*+]\s|\s*\d+[.)]\s|\s*(```|~~~))/.test(lines[i]!) &&
      !(isRow(lines[i]!) && i + 1 < lines.length && isDelim(lines[i + 1]!)) &&
      !(math && para.length && mathBlockAt(lines, i))
    )
      para.push(lines[i++]!)
    if (!para.length) para.push(lines[i++]!)
    // 「我的评价」「微信读书的想法：」开头的一段：前面一个小标签（同文档里的 cm-review-tag，冒号不画）；跟在引文下面就从竖线拐一道弯钩
    const tag = reviewTag(para[0]!)
    if (tag) {
      para[0] = para[0]!.slice(tag.len)
      const hooked = hookable >= 0 && hookable === out.length - 1
      out.push(
        <Attached key={key()} wr={tag.wr} hooked={hooked}>
          {joinLines(para, key(), math)}
        </Attached>,
      )
      if (hooked) hookable = out.length - 1
      continue
    }
    out.push(
      <p key={key()} className="md-p">
        {joinLines(para, key(), math)}
      </p>,
    )
  }
  return <div className="md">{out}</div>
}

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isDelim = (l: string) => isRow(l) && cells(l).every((c) => /^:?-+:?$/.test(c))
/** 一行表格拆成格：去掉两头的竖线，`\|` 是格里的竖线 */
function cells(l: string): string[] {
  return l
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))
}

function joinLines(lines: string[], k: number, math: boolean): ReactNode[] {
  return lines.flatMap((l, j) => (j ? [<br key={`${k}-br${j}`} />, ...inline(l, `${k}-${j}`, math)] : inline(l, `${k}-${j}`, math)))
}

// [字](链接)：链接里有空格的只认 <…> 包着的，和指向 .md / .pdf 的（AI 写「课程/study project 2/x.md」不转 %20，task-3e53q）
const INLINE = /(!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)|\*\*[^*]+\*\*|==[^=\s](?:[^=]*[^=\s])?==|~~[^~]+~~|\*[^*\s][^*]*\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\((?:<[^>\n]+>|[^)\s]+|[^)\n"]+?\.(?:md|pdf)(?:[:#][^)\s]*)?)(?:\s+"[^"]*")?\))/y
/** 回答里双链露出来的字：不露 md 记号，「笔记#标题」写成「笔记 › 标题」，#^块号 不露（有别名只露别名） */
const citeLabel = (inner: string) => wikiLabel(inner).replace(/\s*#\^[^#|]*$/, '').replace(/\s*#\s*/, ' › ')
/** [字](链接 "标题") 里的链接（<…> 包着的去掉尖括号） */
const linkHref = (t: string) => t.slice(t.indexOf('](') + 2, -1).replace(/\s+"[^"]*"$/, '').replace(/^<(.*)>$/, '$1')
/** 汉字、假名、谚文（中西文之间要留 1/8 字宽的那一边；标点不算） */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * 一行字里的行内记号。开了公式时先按 @cn/format 的 inlineMath 认出公式（和文档编辑器同一个认法），
 * 别的记号（加粗、斜体……）只认整个包住公式或和公式不沾边的：「$x_i$, $\mathbf{x}_i$」中间那截 _…_ 不当斜体。
 * 文字里的 \$ 显示成 $
 */
export function inline(s: string, keyBase: string | number = '', math = true): ReactNode[] {
  const out: ReactNode[] = []
  const spans = math ? inlineMath(s) : []
  let text = ''
  const plain = (x: string) => (math ? x.replace(/\\\$/g, '$') : x)
  const flush = () => {
    if (!text) return
    // AI 回答里没写成链接的路径、笔记名（task-3e53q）：认出来的那几截画成链接
    const hits = auto ? findAutoCites(text, auto.run) : []
    let at = 0
    for (const h of hits) {
      if (h.from > at) out.push(plain(text.slice(at, h.from)))
      out.push(
        <a key={`${keyBase}-a${out.length}`} {...autoLinkProps(h.href, h.why, auto!.conv, h.name)}>
          {plain(text.slice(h.from, h.to))}
        </a>,
      )
      at = h.to
    }
    if (at < text.length) out.push(plain(text.slice(at)))
    text = ''
  }
  let k = 0
  for (let p = 0; p < s.length; ) {
    const key = `${keyBase}-${p}`
    while (k < spans.length && spans[k]!.from < p) k++
    const f = spans[k]
    if (f && f.from === p) {
      flush()
      // 紧挨着汉字（AI 没打空格）：那一边留 1/8 字宽（KaTeX 是 inline-block，text-autospace 加不上）
      const gap = `${CJK.test(s[f.from - 1] ?? '') ? ' gl' : ''}${CJK.test(s[f.to] ?? '') ? ' gr' : ''}`
      out.push(<MathInline key={key} latex={f.tex} gap={gap} raw={s.slice(f.from, f.to)} />)
      p = f.to
      continue
    }
    INLINE.lastIndex = p
    const m = INLINE.exec(s)
    const t = m?.[0]
    // 和公式沾边又没整个包住它（斜体的 _ 一头在公式里）：不算记号
    if (!t || spans.some((x) => x.from < p + t.length && x.to > p && !(x.from >= p && x.to <= p + t.length))) {
      text += s[p]
      p++
      continue
    }
    flush()
    // 正文中间的图片只留说明文字：卡片里放大图会把卡片撑得很长
    if (t.startsWith('![')) out.push(<span key={key} className="img-alt">{t.slice(2, t.indexOf(']')) || tNow('图片')}</span>)
    // 加粗里面的公式、代码照常排
    else if (t.startsWith('**')) out.push(<b key={key}>{inline(t.slice(2, -2), key, math)}</b>)
    // 高亮、删除线：和文档里（live-preview 的 cm-hl、cm-strike）一个样子
    else if (t.startsWith('==')) out.push(<mark key={key} className="md-hl">{t.slice(2, -2)}</mark>)
    else if (t.startsWith('~~')) out.push(<s key={key}>{t.slice(2, -2)}</s>)
    else if (t.startsWith('`')) {
      // 整段是库里一个路径的行内代码（`课程/小论文计划.md`）：认成链接，样子还是代码（task-3e53q）
      const href = auto ? codeCite(t.slice(1, -1), auto.run.ctx) : null
      out.push(
        href ? (
          <a key={key} {...autoLinkProps(href, 'path', auto!.conv)}>
            <code>{t.slice(1, -1)}</code>
          </a>
        ) : (
          <code key={key}>{t.slice(1, -1)}</code>
        ),
      )
    }
    // 双链、[字](链接)：引用（task-3e53q）。点了出预览卡、⌘点打开、⇧⌘点新标签（cite.tsx 在整个窗口上接住点击，哪里画的都一样）
    else if (t.startsWith('[[')) out.push(<a key={key} className="wl cite" data-wiki={t.slice(2, -2)}>{citeLabel(t.slice(2, -2))}</a>)
    // 读 PDF 时 AI 回答里的「[第 4 页](#page=4)」：点了 PDF 翻过去（右栏 AI 接住点击）；
    // 带着引的那句「#page=4&text=We%20propose」的：data-text 写那句，翻过去跳到那一段（页码链接跳到段）
    else if (/\]\(#page=\d+(?:&text=[^)\s]*)?\)$/.test(t)) {
      const q = new URLSearchParams(linkHref(t).slice(1))
      out.push(
        <a key={key} className="pg" data-page={q.get('page')!} data-text={q.get('text')?.trim() || undefined}>
          {t.slice(1, t.indexOf(']'))}
        </a>,
      )
    }
    // 笔记里带文件的「[第 4 页](x.pdf#page=4&rect=…)」：和上面一个样子；指的是哪份 PDF 由用的地方按笔记路径认（白板卡里点，page-link.ts）。
    // 不带 data-page：右栏 AI 那边只认光写页码的（它翻的是开着的那份）
    else if (/\]\((?![a-z][a-z0-9+.-]*:)[^)\s]+\.pdf#(?:[^)\s]*&)?page=\d+[^)\s]*\)$/i.test(t)) out.push(<a key={key} className="pg cite" data-href={t.slice(t.indexOf('](') + 2, -1)}>{t.slice(1, t.indexOf(']'))}</a>)
    else if (t.startsWith('[')) out.push(<a key={key} className="cite" data-href={linkHref(t)}>{t.slice(1, t.indexOf(']'))}</a>)
    else out.push(<i key={key}>{inline(t.slice(1, -1), key, math)}</i>)
    p += t.length
  }
  flush()
  return out
}
