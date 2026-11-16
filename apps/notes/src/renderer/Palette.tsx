import { Codicon, type CodiconName } from '@cn/design'
import type { Rect } from '@cn/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile, SearchHit } from '../shared/api'
import type { PdfFile } from '../shared/reading'
import { markParts, type MeaningHit, type PdfTextHit, queryWords, type SearchStatus } from '../shared/search'
import { titleOf } from '../shared/layout'
import { buildRows, type ClaudeState, type Group, groupHead, type Row } from './search/rows'
import { decodeUrl, toUrl } from './url'

export interface PaletteCommand {
  name: string
  hint?: string
  icon: CodiconName
  keys?: string
  run(): void
}

const nameOf = (p: string) => p.split('/').pop() ?? p
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
/** 文件的图标：PDF 是书，白板是格子，我的疑惑是问号，HTML 是代码文件 */
export function fileIcon(path: string, board = false): CodiconName {
  const low = path.toLowerCase()
  if (low.endsWith('.pdf')) return 'file-pdf'
  if (low.endsWith('.html') || low.endsWith('.htm')) return 'file-code'
  if (board) return 'layout'
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
  if (s.phase === 'text') return `· 在读 PDF 里的字 ${s.done}/${s.total}`
  if (s.phase === 'embed') return `· 在建索引 ${s.done}/${s.total} 段，先找建好的`
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
  const [hits, setHits] = useState<SearchHit[]>([])
  const [pdfHits, setPdfHits] = useState<PdfTextHit[]>([])
  const [meaning, setMeaning] = useState<MeaningHit[]>([])
  const [status, setStatus] = useState<SearchStatus | null>(null)
  const [expanded, setExpanded] = useState<Set<Group>>(new Set())
  const [claude, setClaude] = useState<ClaudeState>({ phase: 'idle' })
  const claudeId = useRef(0)
  const [idx, setIdx] = useState(0)
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
      setHits([])
      setPdfHits([])
      setMeaning([])
      return
    }
    let stale = false
    const fast = setTimeout(() => {
      void window.cn.search(t).then((h) => !stale && setHits(h))
      void window.cnSearch.pdfText(t).then((h) => !stale && setPdfHits(h))
    }, 80)
    const slow = setTimeout(() => void window.cnSearch.meaning(t).then((h) => !stale && setMeaning(h)), 300)
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
  const rows = useMemo(() => {
    const t = q.trim()
    const looksUrl = /^(https?:\/\/|[\w-]+(\.[\w-]+)+(\/|$))/i.test(t)
    return buildRows<PaletteCommand>({
      q,
      recent: [...props.notes].sort((a, b) => b.mtimeMs - a.mtimeMs).map((n) => n.path),
      pdfNames: (props.pdfs ?? []).map((p) => p.path),
      hits,
      pdfHits,
      meaning,
      commands: props.commands,
      url: t ? toUrl(q) : null,
      looksUrl,
      expanded,
      claude,
    })
  }, [q, hits, pdfHits, meaning, props.notes, props.pdfs, props.commands, expanded, claude])

  useEffect(() => setIdx(0), [q])
  // Claude 找完：选中它找到的第一条（滚到看得见）
  useEffect(() => {
    if (claude.phase === 'done' && claude.found.length) setIdx(rows.findIndex((r) => r.kind === 'found'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claude])
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

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
  let lastGroup: Group | '' = ''
  return (
    <div className="pal-back" onMouseDown={props.onClose}>
      <div className="pal" role="dialog" aria-label="搜索和命令" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-in">
          <Codicon name="search" size={18} />
          <input
            autoFocus
            aria-label="搜索笔记、输入网址或命令"
            placeholder="搜笔记、PDF 里的字，或者说说你要找什么"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(rows.length - 1, i + 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)))
              else if (e.key === 'Enter') (e.preventDefault(), pick(rows[idx]))
              else if (e.key === 'Escape') (e.preventDefault(), props.onClose())
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list}>
          {noText && <div className="pal-none">笔记和 PDF 里都没有「{t}」这几个字</div>}
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
                <RowView row={r} on={i === idx} words={words} q={t} claude={claude} boards={boards} onHover={() => setIdx(i)} onPick={() => pick(r)} />
              </div>
            )
          })}
        </div>
        <div className="pal-foot">↑↓ 选择 · ↵ 打开 · esc 关闭</div>
      </div>
    </div>
  )
}

function RowView(p: { row: Row<PaletteCommand>; on: boolean; words: string[]; q: string; claude: ClaudeState; boards: Set<string>; onHover(): void; onPick(): void }) {
  const r = p.row
  const cls = 'pal-row sr' + (p.on ? ' on' : '') + (r.kind === 'more' ? ' more' : '') + (r.kind === 'found' ? ' two' : '') + (r.kind === 'claude' ? ' ask' : '')
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
        <Codicon name={fileIcon(r.path, p.boards.has(r.path))} size={16} className="i" />
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
        <Codicon name={fileIcon(h.path, p.boards.has(h.path))} size={16} className="i" />
        <span className="nm">{/\.pdf$/i.test(h.path) ? nameOf(h.path) : titleOf(h.path)}</span>
        <span className="lc">{h.page ? `第 ${h.page} 页` : folderOf(h.path)}</span>
        <span className="sn">
          <Marked text={h.snippet} words={p.words} />
        </span>
      </>
    )
  } else if (r.kind === 'url')
    body = (
      <>
        <Codicon name="globe" size={16} className="i" />
        <span className="nm">在右栏网页里打开</span>
        <span className="sn">{decodeUrl(r.url)}</span>
      </>
    )
  else if (r.kind === 'more') body = <span className="nm">还有 {r.n} 条</span>
  else if (r.kind === 'found')
    body = (
      <>
        <Codicon name={fileIcon(r.found.path, p.boards.has(r.found.path))} size={16} className="i" />
        <span className="col">
          <span className="nm">
            {/\.(pdf|html?)$/i.test(r.found.path) ? nameOf(r.found.path) : titleOf(r.found.path)}
            {r.found.page ? ` · 第 ${r.found.page} 页` : ''}
          </span>
          <span className="sn">{r.found.why || folderOf(r.found.path)}</span>
        </span>
      </>
    )
  else if (p.claude.phase === 'running')
    body = (
      <>
        <Codicon name="loading" size={16} className="i spin" />
        <span className="nm">Claude 在翻文件…</span>
        <span className="sn">
          已看 {p.claude.looked} 个 · {p.claude.step}
        </span>
        <span className="rt">停下</span>
      </>
    )
  else if (p.claude.phase === 'done')
    body = (
      <>
        <Codicon name="sparkle" size={16} className="i" />
        <span className="nm">Claude 也没找到「{p.q}」</span>
        <span className="sn">{p.claude.error ?? '换个说法再试，或者回车让它再找一遍'}</span>
      </>
    )
  else
    body = (
      <>
        <Codicon name="sparkle" size={16} className="i" />
        <span className="nm">让 Claude 帮我找「{p.q}」</span>
        <span className="rt">几秒到十几秒</span>
      </>
    )
  return (
    <button className={cls} onMouseEnter={p.onHover} onClick={p.onPick} role="option" aria-selected={p.on}>
      {body}
    </button>
  )
}
