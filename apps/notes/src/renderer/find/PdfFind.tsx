/**
 * PDF 里的「在这一页里找」（⇧⌘F）：读各页的字找（pdf.js 的 getTextContent，没画出来的页也算），右边写「第几处 / 一共几处」；
 * ↵ 下一处跳到那一页，那一页的文字层画好后把找到的几处铺淡底（CSS 高亮，不改文字层），当前那一处滚到中间。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import type { PdfDoc } from '../reading/pdf'
import { FindBar } from './FindBar'
import { useFindTarget } from './find-hub'
import { findRanges, paint } from './dom-find'

/** 一页的字：文字层每一块的字连起来（和画出来的文字层同一个顺序，找到的位置对得上） */
async function pageText(doc: PdfDoc, n: number): Promise<string> {
  const page = await doc.getPage(n)
  const tc = await page.getTextContent()
  return tc.items.map((it) => ('str' in it ? it.str : '')).join('')
}

export function PdfFind(props: { doc: PdfDoc | null; host: () => HTMLElement | null; scroller: () => HTMLElement | null; goPage(n: number): void; on: boolean; owner: string }) {
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
  const [cur, setCur] = useState(1)
  /** 每一处在第几页、是那一页的第几处 */
  const [hits, setHits] = useState<{ page: number; i: number }[]>([])
  const [reading, setReading] = useState(false)
  const texts = useRef(new Map<number, string>())
  const [tick, setTick] = useState(0)

  useFindTarget(props.on && host && props.doc ? { el: () => host, owner: props.owner, open: () => (setOpen(true), setSeq((s) => s + 1)) } : null)
  useEffect(() => {
    if (!props.on) setOpen(false)
  }, [props.on])
  useEffect(() => texts.current.clear(), [props.doc])

  // 找：一页页读字（读过的记着），读到一页就把那一页的几处加上
  useEffect(() => {
    const doc = props.doc
    const needle = q.trim().toLowerCase()
    if (!open || !doc || !needle) return void setHits([])
    let alive = true
    setReading(true)
    void (async () => {
      const out: { page: number; i: number }[] = []
      for (let n = 1; n <= doc.numPages && alive; n++) {
        let text = texts.current.get(n)
        if (text === undefined) {
          text = await pageText(doc, n)
          texts.current.set(n, text)
        }
        const hay = text.toLowerCase()
        let k = 0
        for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push({ page: n, i: k++ })
        // 前几页先出来（大 PDF 读完要一会儿）
        if (alive && (n % 20 === 0 || n === doc.numPages)) setHits([...out])
      }
      if (alive) setReading(false)
    })()
    return () => {
      alive = false
    }
  }, [open, q, props.doc])

  const at = hits.length ? Math.min(Math.max(cur, 1), hits.length) : 0
  const h = at ? hits[at - 1]! : null
  // 跳到那一页（看不到才跳）
  useEffect(() => {
    const sc = props.scroller()
    if (!h || !sc) return
    const pageEl = sc.querySelector<HTMLElement>(`.pdfpage[data-page="${h.page}"]`)
    const r = pageEl?.getBoundingClientRect()
    const s = sc.getBoundingClientRect()
    if (!r || r.bottom < s.top || r.top > s.bottom) props.goPage(h.page)
    setTick((x) => x + 1)
  }, [h?.page, h?.i])

  // 文字层画出来了（翻到、缩放）：铺淡底；当前那一处滚到中间
  const centered = useRef<string>('')
  useEffect(() => {
    const sc = props.scroller()
    if (!open || !sc) return void paint([], null)
    let tm: ReturnType<typeof setTimeout> | undefined
    const mo = new MutationObserver(() => {
      clearTimeout(tm)
      tm = setTimeout(() => setTick((x) => x + 1), 80)
    })
    mo.observe(sc, { subtree: true, childList: true })
    return () => (mo.disconnect(), clearTimeout(tm))
  }, [open])
  useEffect(() => {
    const sc = props.scroller()
    const needle = q.trim()
    if (!open || !sc || !needle) return void paint([], null)
    const all: Range[] = []
    let current: Range | null = null
    for (const layer of sc.querySelectorAll<HTMLElement>('.pdfpage .textLayer')) {
      const n = Number(layer.closest<HTMLElement>('.pdfpage')!.dataset.page)
      const found = findRanges([layer], needle)
      all.push(...found.map((f) => f.range))
      if (h && n === h.page) current = found[h.i]?.range ?? null
    }
    paint(all, current)
    const key = h ? `${h.page}:${h.i}:${needle}` : ''
    if (current && centered.current !== key) {
      centered.current = key
      const r = current.getBoundingClientRect()
      const s = sc.getBoundingClientRect()
      sc.scrollTop += r.top + r.height / 2 - (s.top + s.height / 2)
    }
  }, [tick, hits, at, open])
  useEffect(() => () => paint([], null), [])

  const close = () => {
    setOpen(false)
    paint([], null)
    centered.current = ''
    props.scroller()?.focus({ preventScroll: true })
  }
  if (!open || !host) return null
  return (
    <FindBar
      className="pdf-find"
      query={q}
      onQuery={(v) => (setQ(v), setCur(1), (centered.current = ''))}
      count={q.trim() ? { at, total: hits.length } : null}
      onNext={() => hits.length && setCur((at % hits.length) + 1)}
      onPrev={() => hits.length && setCur(((at - 2 + hits.length) % hits.length) + 1)}
      onClose={close}
      placeholder={t('在这份 PDF 里找')}
      note={reading && q.trim() ? t('正在一页页找…') : undefined}
      focusSeq={seq}
    />
  )
}
