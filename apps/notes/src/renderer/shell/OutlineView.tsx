import { useEffect, useRef, useState } from 'react'
import type { NoteDoc } from '../note-doc'
import { pdfDoc } from '../reading/pdf'
import type { Tab } from '../tabs'
import { boardOutline, docOutline, type OutlineItem } from './outline'
import { HeadBtn, ViewHead } from './Shell'

type PdfOutlineNode = { title: string; dest: string | unknown[] | null; items: PdfOutlineNode[] }

/** PDF 自带的目录，带页码；没有目录就空着（外面写一句「这份 PDF 没有目录」） */
async function pdfOutline(path: string): Promise<OutlineItem[] | null> {
  const doc = pdfDoc(path)
  if (!doc) return null
  const nodes = ((await doc.getOutline()) ?? []) as PdfOutlineNode[]
  const out: OutlineItem[] = []
  const walk = async (list: PdfOutlineNode[], depth: number) => {
    for (const n of list) {
      let page: number | undefined
      try {
        const dest = typeof n.dest === 'string' ? await doc.getDestination(n.dest) : n.dest
        const ref = dest?.[0]
        if (ref && typeof ref === 'object') page = (await doc.getPageIndex(ref as never)) + 1
        else if (typeof ref === 'number') page = ref + 1
      } catch {
        // 目录项指向坏了的位置：照样列出来，只是没有页码
      }
      out.push({ text: n.title, depth, page })
      if (n.items?.length) await walk(n.items, depth + 1)
    }
  }
  await walk(nodes, 0)
  return out
}

/** 大纲里点白板的一项：开着这块白板的 BoardView 把那张卡片或那一列滚到正中、选中 */
const flyBus = new EventTarget()
export function flyToCard(path: string, id: string) {
  flyBus.dispatchEvent(new CustomEvent('fly', { detail: { path, id } }))
}
export function onFlyToCard(path: string, f: (id: string) => void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<{ path: string; id: string }>).detail
    if (d.path === path) f(d.id)
  }
  flyBus.addEventListener('fly', h)
  return () => flyBus.removeEventListener('fly', h)
}

/** 右栏「大纲」：文档的标题、PDF 的目录、白板的列和卡片 */
export function OutlineView(props: { tab: Tab | null; doc(): NoteDoc | null; onClose(): void; onPdfPage(path: string, page: number): void }) {
  const { tab } = props
  const [items, setItems] = useState<OutlineItem[] | null>(null)
  const [cur, setCur] = useState(-1)
  const kind = tab?.type === 'note' ? 'note' : tab?.type === 'pdf' ? 'pdf' : null
  const path = tab && 'path' in tab ? tab.path : null
  const docOf = useRef(props.doc)
  docOf.current = props.doc

  useEffect(() => {
    setItems(null)
    if (!kind || !path) return
    if (kind === 'pdf') {
      let alive = true
      const load = () =>
        void pdfOutline(path).then((x) => {
          if (!alive) return
          if (x) setItems(x)
          else window.setTimeout(load, 400) // PDF 还在打开
        })
      load()
      return () => void (alive = false)
    }
    // 文档和白板：跟着正文变（打字、AI 改、外部改动），一秒看一次
    let last = ''
    const read = () => {
      const d = docOf.current()
      if (!d || d.path !== path) return
      const text = d.view.state.doc.toString()
      if (text === last) return
      last = text
      const isBoard = /^---\n[\s\S]*?\btype:\s*board\b[\s\S]*?\n---/.test(text)
      setItems(isBoard ? boardOutline(text) : docOutline(text))
      const head = d.view.state.doc.lineAt(d.view.state.selection.main.head).number - 1
      setCur(isBoard ? -1 : docOutline(text).filter((o) => (o.line ?? 0) <= head).length - 1)
    }
    read()
    const t = window.setInterval(read, 1000)
    return () => window.clearInterval(t)
  }, [kind, path])

  function go(o: OutlineItem, i: number) {
    if (kind === 'pdf' && path && o.page) return props.onPdfPage(path, o.page)
    if (o.id && path) {
      setCur(i)
      return flyToCard(path, o.id)
    }
    const d = props.doc()
    if (!d || o.line === undefined) return
    const line = d.view.state.doc.line(o.line + 1)
    d.view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    d.view.focus()
    setCur(i)
  }

  const sub = kind === 'pdf' ? 'PDF自带的目录' : items && path ? path.split('/').pop()!.replace(/\.md$/i, '') : undefined
  return (
    <aside className="right outline" aria-label="大纲">
      <ViewHead title="大纲" sub={sub}>
        <HeadBtn icon="close" label="收起右栏" onClick={props.onClose} />
      </ViewHead>
      <div className="vbody" role="list" aria-label="大纲条目">
        {!kind && <p className="none">这一页没有大纲。文档、PDF、白板才有。</p>}
        {kind && items?.length === 0 && <p className="none">{kind === 'pdf' ? '这份PDF没有自带目录。' : '还没有标题。用 # 写标题，这里就会列出来。'}</p>}
        {items?.map((o, i) => (
          <button key={i} role="listitem" className={'ol' + (i === cur ? ' on' : '')} style={{ '--d': o.depth } as React.CSSProperties} onClick={() => go(o, i)}>
            <span className="truncate">{o.text}</span>
            {o.page !== undefined && <span className="pg num">{o.page}</span>}
          </button>
        ))}
      </div>
    </aside>
  )
}
