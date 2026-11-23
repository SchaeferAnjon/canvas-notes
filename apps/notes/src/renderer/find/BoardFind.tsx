/**
 * 白板上的「在这一页里找」（⇧⌘F）：找卡片里的字（按「##」分列的白板、以前的自由白板都一样），找到的铺淡底；
 * ↵ 下一处、⇧↵ 上一处，跳到那张卡（滚过去）并闪一下（同白板上刚落下的卡片那圈强调色，约 2 秒后没了）。导图白板由导图自己找。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { FindBar } from './FindBar'
import { useFindTarget } from './find-hub'
import { findRanges, flash, paint } from './dom-find'

export function BoardFind(props: { root: () => HTMLElement | null; cards: string; on: boolean; owner: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [seq, setSeq] = useState(0)
  const [q, setQ] = useState('')
  const [cur, setCur] = useState(1)
  /** 白板重画了（卡片多了少了、改了字）：重新找 */
  const [tick, setTick] = useState(0)
  const [hits, setHits] = useState<{ block: Element; range: Range }[]>([])
  const last = useRef<Element | null>(null)
  const root = props.root()

  useFindTarget(props.on && root ? { el: props.root, owner: props.owner, open: () => (setOpen(true), setSeq((s) => s + 1)) } : null)
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
    setHits(findRanges([...el.querySelectorAll(props.cards)], q.trim()))
  }, [open, q, tick])

  const at = hits.length ? Math.min(Math.max(cur, 1), hits.length) : 0
  useEffect(() => {
    const h = at ? hits[at - 1]! : null
    paint(
      hits.map((x) => x.range),
      h?.range ?? null,
    )
    if (!h) return
    const card = h.block
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
    props.root()?.focus({ preventScroll: true })
  }
  if (!open || !root) return null
  return createPortal(
    <FindBar
      className="board-find"
      query={q}
      onQuery={(v) => (setQ(v), setCur(1), (last.current = null))}
      count={q.trim() ? { at, total: hits.length } : null}
      onNext={() => hits.length && setCur((at % hits.length) + 1)}
      onPrev={() => hits.length && setCur(((at - 2 + hits.length) % hits.length) + 1)}
      onClose={close}
      placeholder={t('在这块白板里找')}
      focusSeq={seq}
    />,
    root,
  )
}
