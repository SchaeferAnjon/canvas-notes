/**
 * 白板上的「在这一页里找」（⇧⌘F）：找卡片里的字（按「##」分列的白板、以前的自由白板都一样），找到的铺淡底；
 * ↵ 下一处、⇧↵ 上一处，跳到那张卡（滚过去）并闪一下（同白板上刚落下的卡片那圈强调色，约 2 秒后没了）。导图白板由导图自己找。
 * AI 对话也用它（AiPanel）：找问过的、答过的每一条，条摆在对话那一块右上角，跳到那一处的字（一条回答可能很长，不闪整条）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { FindBar } from './FindBar'
import { useFindTarget } from './find-hub'
import { findRanges, flash, paint } from './dom-find'

export function BoardFind(props: {
  /** 这一栏（焦点在它里面就归它；找它里面的 cards） */
  root: () => HTMLElement | null
  cards: string
  on: boolean
  owner: string
  /** 条摆在哪（要 position: relative）；不给是 root */
  host?: () => HTMLElement | null
  placeholder?: string
  /**
   * 跳到那一处的字（不闪整块）：AI 对话一条回答可能比这一格还高。开着时 host 加 .finding（find.css：对话顶上让出条的高度，
   * 第一条里的字不被条盖住；对话目录挪到条下面）；多一颗「区分大小写」
   */
  toText?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [seq, setSeq] = useState(0)
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(1)
  const [caseSens, setCaseSens] = useState(false)
  /** 白板重画了（卡片多了少了、改了字）：重新找 */
  const [tick, setTick] = useState(0)
  const [hits, setHits] = useState<{ block: Element; range: Range }[]>([])
  const last = useRef<Element | null>(null)
  // 挂的地方（ref）第一次画时还没有：挂上以后再取（同 WebFind）
  const [els, setEls] = useState<{ root: HTMLElement | null; host: HTMLElement | null }>({ root: null, host: null })
  useLayoutEffect(() => {
    const r = props.root()
    const h = (props.host ?? props.root)()
    if (r !== els.root || h !== els.host) setEls({ root: r, host: h })
  })
  const { root, host } = els
  /** 打开前焦点在哪（AI 输入框）：关掉时放回去；白板放回白板 */
  const before = useRef<HTMLElement | null>(null)

  useFindTarget(
    props.on && root
      ? {
          el: props.root,
          owner: props.owner,
          open: () => {
            const a = document.activeElement
            if (a instanceof HTMLElement && !a.closest('.cn-findbar')) before.current = a
            setOpen(true)
            setSeq((s) => s + 1)
          },
        }
      : null,
  )
  useEffect(() => {
    if (!props.on) setOpen(false)
  }, [props.on])

  useEffect(() => {
    const el = props.root()
    if (!open || !el) return
    let tm: ReturnType<typeof setTimeout> | undefined
    const mo = new MutationObserver((list) => {
      // 找的条自己变了不算
      if (list.every((m) => (m.target as Element).closest?.('.cn-findbar'))) return
      clearTimeout(tm)
      tm = setTimeout(() => setTick((x) => x + 1), 150)
    })
    mo.observe(el, { subtree: true, childList: true, characterData: true })
    return () => (mo.disconnect(), clearTimeout(tm))
  }, [open])

  useEffect(() => {
    const el = props.root()
    if (!open || !el) return void paint([], null)
    setHits(findRanges([...el.querySelectorAll(props.cards)], q.trim(), caseSens))
  }, [open, q, tick, caseSens])
  useEffect(() => {
    if (!host || !props.toText) return
    host.classList.toggle('finding', open)
    return () => host.classList.remove('finding')
  }, [open, host])

  const at = hits.length ? Math.min(Math.max(cur, 1), hits.length) : 0
  useEffect(() => {
    const h = at ? hits[at - 1]! : null
    paint(
      hits.map((x) => x.range),
      h?.range ?? null,
    )
    if (!h) return
    const card = h.block
    if (props.toText) {
      h.range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
      return
    }
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    // 同一张卡上找下一处不再闪
    if (last.current !== card) flash(card)
    last.current = card
  }, [hits, at])
  useEffect(() => () => paint([], null), [])

  const close = () => {
    setOpen(false)
    paint([], null)
    last.current = null
    const back = before.current
    before.current = null
    if (props.toText && back?.isConnected) back.focus({ preventScroll: true })
    else props.root()?.focus({ preventScroll: true })
  }
  if (!open || !root || !host) return null
  return createPortal(
    <FindBar
      className="board-find"
      query={q}
      onQuery={(v) => (setQ(v), setCur(1), (last.current = null))}
      count={q.trim() ? { at, total: hits.length } : null}
      onNext={() => hits.length && setCur((at % hits.length) + 1)}
      onPrev={() => hits.length && setCur(((at - 2 + hits.length) % hits.length) + 1)}
      onClose={close}
      placeholder={props.placeholder ?? t('在这块白板里找')}
      {...(props.toText ? { toggles: [{ key: 'case', icon: 'case-sensitive' as const, label: t('区分大小写'), on: caseSens, onToggle: () => (setCaseSens((v) => !v), setCur(1)) }] } : {})}
      focusSeq={seq}
    />,
    host,
  )
}
