import type { ReactNode } from 'react'
import { inline } from './CardBody'

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
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      out.push(
        <blockquote key={key()} className="md-quote">
          {joinLines(body, key())}
        </blockquote>,
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
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|\s*>|\s*[-*+]\s|\s*\d+[.)]\s|\s*(```|~~~))/.test(lines[i]!)) para.push(lines[i++]!)
    if (!para.length) para.push(lines[i++]!)
    out.push(
      <p key={key()} className="md-p">
        {joinLines(para, key())}
      </p>,
    )
  }
  return <div className="md">{out}</div>
}

function joinLines(lines: string[], k: number): ReactNode[] {
  return lines.flatMap((l, j) => (j ? [<br key={`${k}-br${j}`} />, ...inline(l, `${k}-${j}`)] : inline(l, `${k}-${j}`)))
}
