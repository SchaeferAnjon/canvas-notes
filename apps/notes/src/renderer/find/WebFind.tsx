/**
 * 网页里的「在这一页里找」（⇧⌘F）：交给网页自己找（webview 的 findInPage，和浏览器的 ⌘F 一样：找到的都标出来，当前那一处橙色、滚到看得见），
 * 右边写「第几处 / 一共几处」（found-in-page 报回来的）；关掉时 stopFindInPage 清掉。右栏网页、中间栏的宽网页都用它。
 * 网页找的时候会把焦点拿走，报回来以后把焦点放回框里，接着打字。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import type { WebviewEl } from '../web/WebView'
import { FindBar } from './FindBar'
import { useFindTarget } from './find-hub'

type FoundEvent = Event & { result: { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean } }

export function WebFind(props: { view: () => WebviewEl | null | undefined; host: () => HTMLElement | null; on: boolean; owner: string; tab: string | null }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // 挂的地方（ref）第一次画时还没有：挂上以后再取
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = props.host()
    if (el !== host) setHost(el)
  })
  const [seq, setSeq] = useState(0)
  const [q, setQ] = useState('')
  /** 区分大小写（同文档里找的那颗开关） */
  const [caseSens, setCaseSens] = useState(false)
  const [count, setCount] = useState<{ at: number; total: number } | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const req = useRef(0)
  /** 正在找的那个网页（换了标签：上一个清掉） */
  const searching = useRef<WebviewEl | null>(null)

  useFindTarget(props.on && host ? { el: () => host, owner: props.owner, open: () => (setOpen(true), setSeq((s) => s + 1)) } : null)
  useEffect(() => {
    if (!props.on) setOpen(false)
  }, [props.on])

  // 网页报回来第几处、一共几处
  useEffect(() => {
    const v = props.view()
    if (!open || !v) return
    const h = (e: Event) => {
      const r = (e as FoundEvent).result
      if (r.requestId !== req.current) return
      setCount({ at: r.activeMatchOrdinal, total: r.matches })
      // 网页找的时候把焦点拿走了：放回框里
      if (document.activeElement !== input.current) input.current?.focus({ preventScroll: true })
    }
    v.addEventListener('found-in-page', h)
    return () => v.removeEventListener('found-in-page', h)
  }, [open, props.tab])

  const find = (text: string, opts: { forward?: boolean; findNext?: boolean }) => {
    const v = props.view()
    if (!v) return
    if (searching.current && searching.current !== v) searching.current.stopFindInPage('clearSelection')
    searching.current = v
    if (!text) {
      v.stopFindInPage('clearSelection')
      setCount(null)
      return
    }
    try {
      req.current = v.findInPage(text, { ...opts, matchCase: caseSens })
    } catch {
      // 网页还没载好（dom-ready 之前）：先不找，等再按
      setCount({ at: 0, total: 0 })
    }
  }
  // 换了字、换了区分大小写：重新找一轮；换了标签：在新的网页里接着找
  useEffect(() => {
    if (open) find(q, { findNext: true })
  }, [open, q, caseSens, props.tab])

  const close = () => {
    setOpen(false)
    searching.current?.stopFindInPage('clearSelection')
    searching.current = null
    setCount(null)
    props.view()?.focus()
  }
  if (!open || !host) return null
  return createPortal(
    <FindBar
      className="web-find"
      query={q}
      onQuery={setQ}
      count={q ? count : null}
      onNext={() => find(q, { forward: true })}
      onPrev={() => find(q, { forward: false })}
      onClose={close}
      placeholder={t('在这个网页里找')}
      toggles={[{ key: 'case', icon: 'case-sensitive', label: t('区分大小写'), on: caseSens, onToggle: () => setCaseSens((v) => !v) }]}
      focusSeq={seq}
      inputRef={input}
    />,
    host,
  )
}
