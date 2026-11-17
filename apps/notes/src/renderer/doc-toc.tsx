/**
 * 长文档的目录条（CN-26 A）：文档有 3 个以上标题、并且长过两屏时，中间栏右边贴边一列短横线，一条横线一个标题，
 * 读到的那条 --t1，其余 --line2；鼠标移上去 0.2 秒展开成 264 宽的目录浮层，点一项滚到那里，头一行「⌥⌘O 在右栏打开」。
 * 一直看得见、不占地方、不推开正文；不自动打开右栏大纲（不跳动）。
 */
import { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import type { NoteDoc } from './note-doc'
import { docOutline, type OutlineItem } from './shell/outline'

export const TOC_MIN_HEADINGS = 3

/** 目录里的标题：开头那个独一份的一级标题是这篇的名字，不算（纯函数，单元测试在 test/doc-toc.test.ts） */
export function tocItems(md: string): OutlineItem[] {
  const all = docOutline(md)
  if (all.length > 1 && all[0]!.depth === 0 && !all.slice(1).some((i) => i.depth === 0)) return all.slice(1).map((i) => ({ ...i, depth: i.depth - 1 }))
  return all
}

export function DocToc(props: { text: string; doc: () => NoteDoc | null; scroller: () => HTMLElement | null; onOpenOutline(): void }) {
  const items = tocItems(props.text)
  const [long, setLong] = useState(false)
  const [cur, setCur] = useState(0)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const enough = items.length >= TOC_MIN_HEADINGS

  // 长过两屏才出来；滚动时更新读到哪一条
  useEffect(() => {
    const sc = props.scroller()
    if (!sc || !enough) return
    const measure = () => {
      setLong(sc.scrollHeight > sc.clientHeight * 2)
      const view = props.doc()?.view
      if (!view) return
      const top = sc.getBoundingClientRect().top + 80
      let k = 0
      items.forEach((it, i) => {
        const line = it.line! + 1
        if (line > view.state.doc.lines) return
        const y = view.lineBlockAt(view.state.doc.line(line).from).top + view.documentTop
        if (y <= top) k = i
      })
      setCur(k)
    }
    measure()
    sc.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(sc)
    if (sc.firstElementChild) ro.observe(sc.firstElementChild)
    return () => (sc.removeEventListener('scroll', measure), ro.disconnect())
  }, [props.text, enough])

  useEffect(() => () => clearTimeout(timer.current), [])

  if (!enough || !long) return null

  const go = (it: OutlineItem) => {
    const view = props.doc()?.view
    if (!view) return
    const line = view.state.doc.line(Math.min(view.state.doc.lines, it.line! + 1))
    view.dispatch({ selection: { anchor: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) })
    view.focus()
    setOpen(false)
  }
  const enter = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), 200)
  }
  const leave = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 160)
  }

  return (
    <div className="doc-toc-wrap" onMouseEnter={enter} onMouseLeave={leave}>
      <div className="doc-toc" data-part="目录条" aria-hidden={open}>
        {items.map((it, i) => (
          <i key={i} className={(it.depth === 0 ? 'd0' : it.depth === 1 ? 'd1' : 'd2') + (i === cur ? ' on' : '')} />
        ))}
      </div>
      {open && (
        <nav className="doc-tocpop" aria-label="目录" data-part="目录浮层">
          <div className="hd">
            <span>目录</span>
            <button type="button" className="to-right" onClick={() => (setOpen(false), props.onOpenOutline())}>
              ⌥⌘O 在右栏打开
            </button>
          </div>
          <div className="rows">
            {items.map((it, i) => (
              <button key={i} type="button" className={'r' + (it.depth > 0 ? ' l' + Math.min(2, it.depth) : '') + (i === cur ? ' on' : '')} onClick={() => go(it)}>
                {it.text}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

/** 宽版（「⋯ › 宽版」）：记在这台机器上，按笔记路径；改名跟着走，不写进 md 文件 */
const WIDE_KEY = 'cn.wideDocs'

function wideSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(WIDE_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function isWide(path: string): boolean {
  return wideSet().has(path)
}

export function setWide(path: string, on: boolean, oldPath?: string) {
  const s = wideSet()
  if (oldPath) s.delete(oldPath)
  if (on) s.add(path)
  else s.delete(path)
  try {
    localStorage.setItem(WIDE_KEY, JSON.stringify([...s]))
  } catch {
    // 存不下（隐私模式之类）：这一次照样变宽，下次打开回到默认
  }
}
