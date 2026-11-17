import { Codicon } from '@cn/design'
import { detailsHead } from '@cn/format'
import type { ReactNode } from 'react'
import { parseCallout } from './callout'

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
 * AI 回答里的 md 显示成排好的样子：标题、列表、引用、代码块、分隔线、段落，行内的加粗、斜体、代码、链接、双链。
 * 全部走 React 元素（不拼 HTML）；边生成边显示时半截的 md 也照常显示。
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  const key = () => out.length
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
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = Math.min(h[1]!.length, 3)
      out.push(
        <div key={key()} className={`md-h md-h${level}`}>
          {inline(h[2]!, key())}
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
            <span>{inline(det.title, key())}</span>
          </summary>
          <Markdown text={lines.slice(i + det.lines, close).join('\n')} />
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
              <Codicon name={c.icon} size={14} />
              {cut > 0 ? (
                <>
                  <span className="md-callout-name">{title.slice(0, cut)}</span>
                  <span className="md-callout-meta">{title.slice(cut)}</span>
                </>
              ) : (
                <span className="md-callout-name">{title}</span>
              )}
            </div>
            {body.length > 1 && <Markdown text={body.slice(1).join('\n')} />}
          </div>,
        )
        continue
      }
      out.push(
        <blockquote key={key()} className="md-quote">
          {joinLines(body, key())}
        </blockquote>,
      )
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
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} style={st(j)}>
                    {inline(c, `${k}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {head.map((_, j) => (
                    <td key={j} style={st(j)}>
                      {inline(row[j] ?? '', `${k}-${r}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
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
              {inline(it.text, `${key()}-${j}`)}
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
      !(isRow(lines[i]!) && i + 1 < lines.length && isDelim(lines[i + 1]!))
    )
      para.push(lines[i++]!)
    if (!para.length) para.push(lines[i++]!)
    // 「我的评价」开头的一段：前面一个小标签（同文档里的 cm-review-tag）；后面紧跟的冒号并进标签，「我的评价：」一体
    const review = /^(\*\*)?我的评价([：:])?(\*\*)?([：:])?/.exec(para[0]!)
    if (review) para[0] = para[0]!.slice(review[0].length)
    out.push(
      <p key={key()} className="md-p">
        {review && <span className="md-review-tag">{`我的评价${review[2] ?? review[4] ?? ''}`}</span>}
        {joinLines(para, key())}
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

function joinLines(lines: string[], k: number): ReactNode[] {
  return lines.flatMap((l, j) => (j ? [<br key={`${k}-br${j}`} />, ...inline(l, `${k}-${j}`)] : inline(l, `${k}-${j}`)))
}

const INLINE = /(!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)|\*\*[^*]+\*\*|==[^=\s](?:[^=]*[^=\s])?==|~~[^~]+~~|\*[^*\s][^*]*\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+(?:\s+"[^"]*")?\))/g

export function inline(s: string, keyBase: string | number = ''): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index! > last) out.push(s.slice(last, m.index))
    const t = m[0]
    const key = `${keyBase}-${m.index}`
    // 正文中间的图片只留说明文字：卡片里放大图会把卡片撑得很长
    if (t.startsWith('![')) out.push(<span key={key} className="img-alt">{t.slice(2, t.indexOf(']')) || '图片'}</span>)
    else if (t.startsWith('**')) out.push(<b key={key}>{t.slice(2, -2)}</b>)
    // 高亮、删除线：和文档里（live-preview 的 cm-hl、cm-strike）一个样子
    else if (t.startsWith('==')) out.push(<mark key={key} className="md-hl">{t.slice(2, -2)}</mark>)
    else if (t.startsWith('~~')) out.push(<s key={key}>{t.slice(2, -2)}</s>)
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('[[')) out.push(<span key={key} className="wl">{t.slice(2, -2).split('|').pop()}</span>)
    // 读 PDF 时 AI 回答里的「[第 4 页](#page=4)」：点了 PDF 翻过去（右栏 AI 接住点击）
    else if (/\]\(#page=\d+\)$/.test(t)) out.push(<a key={key} className="pg" data-page={/#page=(\d+)/.exec(t)![1]}>{t.slice(1, t.indexOf(']'))}</a>)
    else if (t.startsWith('[')) out.push(<u key={key}>{t.slice(1, t.indexOf(']'))}</u>)
    else out.push(<i key={key}>{t.slice(1, -1)}</i>)
    last = m.index! + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
