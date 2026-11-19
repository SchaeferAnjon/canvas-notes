import { Codicon, type CodiconName } from '@cn/design'
import type { Rect } from '@cn/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile, SearchHit } from '../shared/api'
import type { PdfFile } from '../shared/reading'
import { markParts, type MeaningHit, type PdfTextHit, queryWords, type SearchStatus } from '../shared/search'
import { titleOf } from '../shared/layout'
import { buildRows, type ClaudeState, type Cursor, cursorAt, defaultIndex, type Group, groupHead, type Key, keyIsFinal, type Row, rowOf, step } from './search/rows'
import { decodeUrl, isSearchUrl, looksLikeUrl, toUrl } from './url'

export interface PaletteCommand {
  name: string
  hint?: string
  icon: CodiconName
  keys?: string
  run(): void
}

const nameOf = (p: string) => p.split('/').pop() ?? p
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
/**
 * 文件的图标：PDF 是书，白板是格子，书摘（bookId）是引号，我的疑惑是问号，HTML 是代码文件，别的笔记（剪来的也一样）是文档。
 * 树、左栏「最近」、文件夹首页、「最近」页、⌘K 都用这一个，同一篇在哪都是同一个图标
 */
export function fileIcon(path: string, board = false, digest = false): CodiconName {
  const low = path.toLowerCase()
  if (low.endsWith('.pdf')) return 'file-pdf'
  if (low.endsWith('.html') || low.endsWith('.htm')) return 'file-code'
  if (/\.(png|jpe?g|gif|webp|svg|heic|bmp)$/.test(low)) return 'file-media'
  if (board) return 'layout'
  if (digest) return 'quote'
  if (nameOf(path) === '我的疑惑.md') return 'question'
  return 'file-text'
}

/** 命中的词标出来 */
function Marked(props: { text: string; words: string[] }) {
  return (
    <>
      {markParts(props.text, props.words).map((p, i) =>
        p.hit ? (
          <mark key={i} className="sr-hit">
            {p.t}
          </mark>
        ) : (
          p.t
        ),
      )}
    </>
  )
}

const statusWhy = (s: SearchStatus | null): string => {
  if (!s) return '· 本机小模型，不联网'
  if (s.phase === 'loading') return '· 本机小模型在载入'
  if (s.phase === 'text') return `· 在读PDF里的字${s.done}/${s.total}`
  if (s.phase === 'embed') return `· 在建索引${s.done}/${s.total}段，先找建好的`
  if (s.phase === 'off') return '· 这台机器上没有本机模型'
  if (s.phase === 'error') return `· 出错了：${s.error ?? ''}`
  return '· 本机小模型，不联网'
}

let claudeSeq = 0

/**
 * ⌘F / ⌘K：一个框，三层搜索加命令。
 * 文字（笔记和 PDF 里的字，打字就出）→ 意思相近（本机小模型，停手 300ms 后出）→ 命令、网页 → 最后一行「让 Claude 帮我找」。
 * 每组最多 5 条，多的「还有 N 条」。
 */
/** 一份搜索结果和搜它的那个词 */
type For<T> = { q: string; list: T[] }
const NONE = { q: '', list: [] }

export function Palette(props: {
  notes: NoteFile[]
  pdfs?: PdfFile[]
  commands: PaletteCommand[]
  onOpen(path: string): void
  onOpenPdfAt(path: string, page: number, rect?: Rect): void
  onUrl(url: string): void
  onClose(): void
}) {
  const [q, setQ] = useState('')
  // 每份结果记着是哪个词搜出来的：换了词、新结果还没回来时不露上一个词的结果（先写「在找…」）
  const [hits, setHits] = useState<For<SearchHit>>(NONE)
  const [pdfHits, setPdfHits] = useState<For<PdfTextHit>>(NONE)
  /** 文字搜索（笔记和 PDF 两边）已经回来的那个词：没回来之前不说「都没有」 */
  const [doneFor, setDoneFor] = useState('')
  const [meaning, setMeaning] = useState<For<MeaningHit>>(NONE)
  const [status, setStatus] = useState<SearchStatus | null>(null)
  const [expanded, setExpanded] = useState<Set<Group>>(new Set())
  const [claude, setClaude] = useState<ClaudeState>({ phase: 'idle' })
  const claudeId = useRef(0)
  /**
   * 用户自己挪到（上下键、鼠标）的那一行，按身份记（第几个本地结果 / 网页那一行 / 让 Claude 找）；
   * 没挪过是 null，选中的是 defaultIndex（本地结果，不会是去网上搜那一行）
   */
  const [sel, setSel] = useState<Cursor | null>(null)
  /**
   * 结果没出齐时按的 ↓ ↑ 回车：先记着，出齐了再照顺序按（keyIsFinal 说现在按和出齐了再按一样的，马上按）。
   * 这样早按、晚按落在同一行，回车也不会拿半截的列表去开网页、开没把握的笔记
   */
  const queue = useRef<{ q: string; keys: Key[] }>({ q: '', keys: [] })
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.cnSearch.status().then(setStatus)
    return window.cnSearch.onStatus(setStatus)
  }, [])

  // 文字：打字就出（80ms 防抖）；意思相近：停手 300ms 再算
  useEffect(() => {
    const t = q.trim()
    setExpanded(new Set())
    if (!t) {
      setHits(NONE)
      setPdfHits(NONE)
      setMeaning(NONE)
      return
    }
    let stale = false
    const fast = setTimeout(() => {
      const a = window.cn.search(t).then((h) => !stale && setHits({ q: t, list: h }))
      const b = window.cnSearch.pdfText(t).then((h) => !stale && setPdfHits({ q: t, list: h }))
      void Promise.allSettled([a, b]).then(() => !stale && setDoneFor(t))
    }, 80)
    // 意思相近没算成（搜索进程退了）也算回来了：一条没有，排着的键照样按
    const slow = setTimeout(
      () =>
        void window.cnSearch.meaning(t).then(
          (h) => !stale && setMeaning({ q: t, list: h }),
          () => !stale && setMeaning({ q: t, list: [] }),
        ),
      300,
    )
    return () => {
      stale = true
      clearTimeout(fast)
      clearTimeout(slow)
    }
  }, [q])

  // 换了词：Claude 正在找的停下，结果清掉
  useEffect(() => {
    if (claudeId.current) void window.cnSearch.claudeStop(claudeId.current)
    claudeId.current = 0
    setClaude({ phase: 'idle' })
  }, [q])
  useEffect(
    () =>
      window.cnSearch.onClaude((id, e) => {
        if (id !== claudeId.current || e.type !== 'step') return
        setClaude((c) => (c.phase === 'running' ? { phase: 'running', looked: c.looked + (e.text.startsWith('读 ') ? 1 : 0), step: e.text } : c))
      }),
    [],
  )
  useEffect(
    () => () => {
      if (claudeId.current) void window.cnSearch.claudeStop(claudeId.current)
    },
    [],
  )

  function askClaude() {
    const t = q.trim()
    if (!t) return
    const id = ++claudeSeq
    claudeId.current = id
    setClaude({ phase: 'running', looked: 0, step: '开始翻' })
    void window.cnSearch.claudeFind(id, t).then(
      (r) => id === claudeId.current && setClaude({ phase: 'done', found: r.found, ...(r.error ? { error: r.error } : {}) }),
      (e) => id === claudeId.current && setClaude({ phase: 'done', found: [], error: String((e as Error).message ?? e) }),
    )
  }

  const boards = useMemo(() => new Set(props.notes.filter((n) => n.board).map((n) => n.path)), [props.notes])
  const digests = useMemo(() => new Set(props.notes.filter((n) => n.digest).map((n) => n.path)), [props.notes])
  const rows = useMemo(() => {
    const t = q.trim()
    const looksUrl = looksLikeUrl(t)
    const explicitUrl = /^(https?:\/\/\S|www\.[\w-]+\.\S)/i.test(t) && !/\s/.test(t)
    return buildRows<PaletteCommand>({
      q,
      recent: [...props.notes].sort((a, b) => b.mtimeMs - a.mtimeMs).map((n) => n.path),
      pdfNames: (props.pdfs ?? []).map((p) => p.path),
      hits: hits.q === t ? hits.list : [],
      pdfHits: pdfHits.q === t ? pdfHits.list : [],
      meaning: meaning.q === t ? meaning.list : [],
      commands: props.commands,
      url: t ? toUrl(q) : null,
      looksUrl,
      explicitUrl,
      expanded,
      claude,
    })
  }, [q, hits, pdfHits, meaning, props.notes, props.pdfs, props.commands, expanded, claude])

  const idx = sel ? rowOf(rows, sel) : defaultIndex(rows)
  /** text：这个词的文字结果回来了；all：意思相近也回来了（结果出齐了） */
  const ready = { text: !q.trim() || doneFor === q.trim(), all: !q.trim() || (doneFor === q.trim() && meaning.q === q.trim()) }
  useEffect(() => {
    setSel(null)
    queue.current = { q: '', keys: [] }
  }, [q])
  // Claude 找完：选中它找到的第一条（滚到看得见）
  useEffect(() => {
    if (claude.phase === 'done' && claude.found.length) setSel(cursorAt(rows, rows.findIndex((r) => r.kind === 'found')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claude])
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  /** 按一个键：排着的还没按完、或者现在按和出齐了再按不一样，就排上 */
  function press(k: Key) {
    const t = q.trim()
    const qu = queue.current
    if (qu.q === t && qu.keys.length) qu.keys.push(k)
    else if (!keyIsFinal(rows, sel, k, ready)) queue.current = { q: t, keys: [k] }
    else if (k === 'enter') pick(rows[idx])
    else setSel(step(rows, sel, k))
  }
  // 结果又回来一批：排着的键能按的照顺序按掉
  useEffect(() => {
    const qu = queue.current
    if (!qu.keys.length || qu.q !== q.trim()) return
    let cur = sel
    while (qu.keys.length && keyIsFinal(rows, cur, qu.keys[0]!, ready)) {
      const k = qu.keys.shift()!
      if (k === 'enter') {
        qu.keys = []
        setSel(cur)
        pick(rows[cur ? rowOf(rows, cur) : defaultIndex(rows)])
        return
      }
      cur = step(rows, cur, k)
    }
    if (cur !== sel) setSel(cur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ready.text, ready.all])

  function pick(r: Row<PaletteCommand> | undefined) {
    if (!r) return
    if (r.kind === 'more') return setExpanded((s) => new Set(s).add(r.group))
    if (r.kind === 'claude') {
      if (claude.phase === 'running') {
        void window.cnSearch.claudeStop(claudeId.current)
        return
      }
      return askClaude()
    }
    props.onClose()
    if (r.kind === 'cmd') r.cmd.run()
    else if (r.kind === 'note' || r.kind === 'pdfName') props.onOpen(r.path)
    else if (r.kind === 'pdfPage') props.onOpenPdfAt(r.hit.path, r.hit.page, r.hit.rect)
    else if (r.kind === 'meaning') r.hit.page && /\.pdf$/i.test(r.hit.path) ? props.onOpenPdfAt(r.hit.path, r.hit.page) : props.onOpen(r.hit.path)
    else if (r.kind === 'found') r.found.page && /\.pdf$/i.test(r.found.path) ? props.onOpenPdfAt(r.found.path, r.found.page) : props.onOpen(r.found.path)
    else props.onUrl(r.url)
  }

  const words = queryWords(q)
  const t = q.trim()
  const noText = !!t && !rows.some((r) => r.group === 'text')
  const finding = noText && doneFor !== t
  const urlish = looksLikeUrl(t)
  let lastGroup: Group | '' = ''
  return (
    <div className="pal-back" onMouseDown={props.onClose}>
      <div className="pal" role="dialog" aria-label="搜索和命令" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-in">
          <Codicon name="search" size={18} />
          <input
            autoFocus
            aria-label="搜索笔记、输入网址或命令"
            placeholder="搜笔记、PDF里的字，或者说说你要找什么"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              // ↓ ↑ 只在键盘能选的本地结果里挪；结果没出齐时先记着（第 3 轮：40ms 内 ↓ 回车去了 Google；第 4 轮：早按 ↓ 落到没把握的那篇）
              if (e.key === 'ArrowDown') (e.preventDefault(), press(1))
              else if (e.key === 'ArrowUp') (e.preventDefault(), press(-1))
              // ⌘↵ 不管选着哪一行都在右栏网页里搜（像网址就直接打开）；⌥↵ 让 Claude 找（CN-41）
              else if (e.key === 'Enter' && e.metaKey && !e.altKey) (e.preventDefault(), pick(rows.find((r) => r.kind === 'url')))
              else if (e.key === 'Enter' && e.altKey && !e.metaKey) (e.preventDefault(), t && claude.phase !== 'running' && askClaude())
              // 回车只按出齐了会选中的那一行走：没出齐、后到的结果还能改它，就等（CN 第 2 轮：手快回车把笔记名发到了网上）；
              // 自己用鼠标挪到网页、Claude 那一行的马上走
              else if (e.key === 'Enter') (e.preventDefault(), press('enter'))
              else if (e.key === 'Escape') (e.preventDefault(), props.onClose())
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list}>
          {finding ? (
            <div className="pal-none">在找「{t}」…</div>
          ) : (
            noText && (
              <>
                <div className="pal-none">笔记和PDF里都没有「{t}」这几个字</div>
                {idx === -1 && !urlish && <div className="pal-none-why">回车没有可打开的，⌘↵ 去网页搜</div>}
              </>
            )
          )}
          {/* 打的像网址、名字对得上的一个都没有：回车不开正文里有它的、意思相近的，说清楚要去网页按 ⌘↵ */}
          {urlish && idx === -1 && !finding && <div className="pal-none-why">{noText ? '回车不做事，⌘↵ 去网页打开' : `没有叫「${t}」的笔记，回车不做事，⌘↵ 去网页打开`}</div>}
          {rows.map((r, i) => {
            let head = null
            if (r.group !== lastGroup) {
              const h = groupHead(r.group, { q, claudeDone: r.kind === 'found' })
              if (h) {
                const why = r.group === 'meaning' ? statusWhy(status) : h.why
                head = (
                  <div className="pal-g">
                    {h.name}
                    {why && <span className="why"> {why}</span>}
                  </div>
                )
              }
            }
            const meaningHead =
              r.group === 'claude' && lastGroup !== 'meaning' && t && status && status.phase !== 'ready' && !rows.some((x) => x.group === 'meaning') ? (
                <div className="pal-g">
                  意思相近<span className="why"> {statusWhy(status)}</span>
                </div>
              ) : null
            lastGroup = r.group
            return (
              <div key={i}>
                {meaningHead}
                {head}
                <RowView row={r} on={i === idx} nokey={!cursorAt(rows, i)} words={words} q={t} claude={claude} boards={boards} digests={digests} onHover={() => {
                    // 没把握的意思相近：鼠标悬停也不当选中（回车不开它），只能点
                    const c = cursorAt(rows, i)
                    if (c) setSel(c)
                  }} onPick={() => pick(r)} />
              </div>
            )
          })}
        </div>
        <div className="pal-foot" aria-label="快捷键">
          ↑↓ 选择 · ↵ 打开 · <b>⌘↵ 网页搜</b> · <b>⌥↵ 让Claude找</b> · esc 关闭
        </div>
      </div>
    </div>
  )
}

function RowView(p: { row: Row<PaletteCommand>; on: boolean; /** 键盘选不中（没把握的意思相近）：只有悬停的淡底，点了才开 */ nokey?: boolean; words: string[]; q: string; claude: ClaudeState; boards: Set<string>; digests: Set<string>; onHover(): void; onPick(): void }) {
  const r = p.row
  const cls = 'pal-row sr' + (p.on ? ' on' : '') + (p.nokey ? ' nokey' : '') + (r.kind === 'more' ? ' more' : '') + (r.kind === 'found' ? ' two' : '') + (r.kind === 'claude' ? ' ask' : '')
  let body
  if (r.kind === 'cmd')
    body = (
      <>
        <Codicon name={r.cmd.icon} size={16} className="i" />
        <span className="nm">{r.cmd.name}</span>
        {r.cmd.hint && <span className="lc">{r.cmd.hint}</span>}
        {r.cmd.keys && <kbd className="rt">{r.cmd.keys}</kbd>}
      </>
    )
  else if (r.kind === 'note')
    body = (
      <>
        <Codicon name={fileIcon(r.path, p.boards.has(r.path), p.digests.has(r.path))} size={16} className="i" />
        <span className="nm">{titleOf(r.path)}</span>
        <span className="lc">{folderOf(r.path)}</span>
        {r.snippet && (
          <span className="sn">
            <Marked text={r.snippet} words={p.words} />
          </span>
        )}
      </>
    )
  else if (r.kind === 'pdfName')
    body = (
      <>
        <Codicon name="book" size={16} className="i" />
        <span className="nm">
          <Marked text={nameOf(r.path)} words={p.words} />
        </span>
        <span className="lc">{folderOf(r.path)}</span>
      </>
    )
  else if (r.kind === 'pdfPage' || r.kind === 'meaning') {
    const h = r.hit
    body = (
      <>
        <Codicon name={fileIcon(h.path, p.boards.has(h.path), p.digests.has(h.path))} size={16} className="i" />
        <span className="nm">{/\.pdf$/i.test(h.path) ? nameOf(h.path) : titleOf(h.path)}</span>
        <span className="lc">{h.page ? `第${h.page}页` : folderOf(h.path)}</span>
        <span className="sn">
          <Marked text={h.snippet} words={p.words} />
        </span>
      </>
    )
  } else if (r.kind === 'url')
    body = (
      <>
        <Codicon name="globe" size={16} className="i" />
        <span className="nm">{isSearchUrl(r.url) ? '在右栏网页里搜' : '在右栏网页里打开'}</span>
        <span className="sn">{decodeUrl(r.url).replace(/^https?:\/\/(www\.)?/, '')}</span>
        <kbd className="rt">⌘↵</kbd>
      </>
    )
  else if (r.kind === 'more') body = <span className="nm">{`还有${r.n}条`}</span>
  else if (r.kind === 'found')
    body = (
      <>
        <Codicon name={fileIcon(r.found.path, p.boards.has(r.found.path), p.digests.has(r.found.path))} size={16} className="i" />
        <span className="col">
          <span className="nm">
            {/\.(pdf|html?)$/i.test(r.found.path) ? nameOf(r.found.path) : titleOf(r.found.path)}
            {r.found.page ? ` · 第${r.found.page}页` : ''}
          </span>
          <span className="sn">{r.found.why || folderOf(r.found.path)}</span>
        </span>
      </>
    )
  else if (p.claude.phase === 'running')
    body = (
      <>
        <Codicon name="loading" size={16} className="i spin" />
        <span className="nm">Claude在翻文件…</span>
        <span className="sn">
          {`已看${p.claude.looked}个 · ${p.claude.step}`}
        </span>
        <span className="rt">停下</span>
      </>
    )
  else if (p.claude.phase === 'done')
    body = (
      <>
        <Codicon name="sparkle" size={16} className="i" />
        <span className="nm">Claude也没找到「{p.q}」</span>
        <span className="sn">{p.claude.error ?? '换个说法再试，或者回车让它再找一遍'}</span>
      </>
    )
  else
    body = (
      <>
        <Codicon name="sparkle" size={16} className="i" />
        <span className="nm">让Claude帮我找「{p.q}」</span>
        <span className="rt">几秒到十几秒</span>
        <kbd className="rt2">⌥↵</kbd>
      </>
    )
  return (
    // 鼠标真的动了才换选中（列表在不动的鼠标下面重排时，浏览器也会补发 mouseenter，不能借这个把「去网上搜」选上）
    <button className={cls} onMouseMove={(e) => (e.movementX || e.movementY) && !p.on && p.onHover()} onClick={p.onPick} role="option" aria-selected={p.on}>
      {body}
    </button>
  )
}
