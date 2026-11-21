import { Codicon, type CodiconName } from '@cn/design'
import type { Rect } from '@cn/format'
import { appSettings } from './settings-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiJob } from '../shared/ai-logo'
import type { NoteFile, SearchHit } from '../shared/api'
import { type CmdConfig, deleteOwn, GROUPS, hideCmd, materialize, moveCmd, newGroup, type OwnCommand, pinCmd, resetKey, setAlias, setKey, swapKey, unhideCmd, unpinCmd } from '../shared/commands'
import { AiIcon, EngineLogo } from './engine-logo'
import type { PdfFile } from '../shared/reading'
import { markParts, type MeaningHit, type PdfTextHit, queryWords, type SearchStatus } from '../shared/search'
import { titleOf } from '../shared/layout'
import { recentFiles } from './files/store'
import { buildRows, type ClaudeState, type Cursor, cursorAt, defaultIndex, type Group, groupHead, type Key, keyIsFinal, type Row, rowOf, step } from './search/rows'
import { cmdConfig, noteUsed, updateCmds, useCmds, usedRank } from './search/cmd-store'
import { availNow, checkKey, isKey, keyFor, useKeys } from './keys'
import { type EmptyRow, emptySections, FOLDERS_ID, groupName, selectable } from './search/cmd-layout'
import { CmdForm, type FormValue } from './search/CmdForm'
import { openCmdEditor } from './commands/editor'
import { deleteAiCmd, useAiCmds } from './commands/store'
import { useConvPick } from './composer'
import { KeysMini, type MenuAct, RowMenu, TextMini } from './search/PalMenus'
import { decodeUrl, isSearchUrl, looksLikeUrl, toUrl } from './url'
import './search/palette.css'

export interface PaletteCommand {
  /** 记在 命令.json 里的身份（钉住、藏起、别名、快捷键都按它）；不给就用名字 */
  id?: string
  name: string
  hint?: string
  icon: CodiconName
  /** 交给 AI 跑的命令：左边画跑它的那一家的标志（翻译没有能用的那家时画 icon） */
  ai?: AiJob
  /** 默认的快捷键（⌘K 里能改，改了的看 命令.json） */
  keys?: string
  run(): void
  /** 没打字时默认在哪一组（DESIGN.v3 3.1） */
  home?: string
  /** 文件夹首页一个个的：收在「文件夹首页」那一行下面 */
  folder?: string
  /** 只在打字时搜得到（翻成…、译文样式… 这些次一级的） */
  searchOnly?: boolean
  /** 快捷键是它自己那块接的（双语翻译 ⌥A），不能改 */
  fixedKeys?: boolean
  /** 自己加的命令（菜单里多「改这条命令…」「删掉这条」） */
  own?: OwnCommand
}

export const cmdId = (c: Pick<PaletteCommand, 'id' | 'name'>) => c.id ?? c.name

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
  // 设置 › 文档和白板「按意思找」关着：不载本机模型（PDF 里的字照样在读）
  if (!appSettings().editor.semantic) return '· 按意思找关着（设置 › 文档和白板）'
  if (!s) return '· 本机小模型，不联网'
  if (s.phase === 'loading') return '· 本机小模型在载入'
  if (s.phase === 'text') return `· 在读PDF里的字${s.done}/${s.total}`
  if (s.phase === 'embed') return `· 在建索引${s.done}/${s.total}段，先找建好的`
  if (s.phase === 'off') return '· 这台机器上没有本机模型'
  if (s.phase === 'error') return `· 出错了：${s.error ?? ''}`
  return '· 本机小模型，不联网'
}

let claudeSeq = 0

/** ⌘K 里搜东西、画行用的命令：现在的键、别名、藏没藏、钉没钉、最近用过第几 */
type ViewCmd = PaletteCommand & { id: string; keys?: string; alias?: string; hidden?: boolean; pinned?: boolean; usedRank?: number }

/** 一份搜索结果和搜它的那个词 */
type For<T> = { q: string; list: T[] }
const NONE = { q: '', list: [] }

type Menu = { id: string; x: number; y: number; byKey?: boolean }
type Mini = { kind: 'keys' | 'alias' | 'group'; id: string; at: { left: number; top: number } }
/** undo：改之前的 命令.json；只在这台 Mac 上的 AI 命令删掉了，撤回是放回那一份（undoFn） */
type Toast = { text: string; seq: number; undo?: CmdConfig; undoFn?: () => Promise<void> }
type Drag = { id: string; name: string; icon: PaletteCommand; w: number; x: number; y: number; dy: number; line: { left: number; top: number; width: number } | null; target: { gid: string; before: string | null } | null; over: string | null }

let toastSeq = 0

/**
 * ⌘K / ⌘F：一个框（DESIGN.v3 第 3 节，cmdk 方案方向 A「就地改」）。
 * 没打字时按八组列出来，组间一道横线、组名在线下；右键、⋯、⌘. 出一条命令的菜单（钉住、挪到、设快捷键、起别名、藏起），
 * 按住把手拖到别的组，每次改完底部能撤回。打字以后：最合适 → 笔记 → 命令 → 笔记和PDF里的字 → 意思相近 → 网页和AI。
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
  const cfg = useCmds()
  /** 自己存的 AI 命令（库里的和只在这台 Mac 的）：改、删走「存成命令」那张表和 commands/store */
  const { mine } = useAiCmds()
  /** AI 对话现在用的那一家、模型、想多久：从头写、改一条 AI 命令时影响卡「谁来做」写它，提炼也用它 */
  const ai = useConvPick(null, () => {}, (t) => say(t))
  const aiWho = { who: ai.label, engine: ai.pick.engine, pick: { engine: ai.pick.engine, ...ai.req } }
  /** 命令现在的键（命令表 + 改过的；改了跟着重画） */
  const K = useKeys()
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
  /** 没打字时选中第几行（能选的行里数） */
  const [esel, setEsel] = useState(0)
  const [foldersOpen, setFoldersOpen] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  /** 加 / 改一条自己的命令：面板原地变成表单 */
  const [form, setForm] = useState<{ edit: OwnCommand | null } | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [mini, setMini] = useState<Mini | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  /**
   * 结果没出齐时按的 ↓ ↑ 回车：先记着，出齐了再照顺序按（keyIsFinal 说现在按和出齐了再按一样的，马上按）。
   * 这样早按、晚按落在同一行，回车也不会拿半截的列表去开网页、开没把握的笔记
   */
  const queue = useRef<{ q: string; keys: Key[] }>({ q: '', keys: [] })
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  /** 键盘挪的选中要滚到看得见；鼠标挪的不滚 */
  const scrollSel = useRef(false)

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

  // ---------------------------------------------------------------- 命令
  const children = props.commands.filter((c) => c.folder)
  const listed: PaletteCommand[] = useMemo(
    // 「文件夹首页」那一行：点了展开，不能设快捷键
    () => [...props.commands, ...(children.length ? [{ id: FOLDERS_ID, name: '文件夹首页', icon: 'folder' as const, home: 'go', fixedKeys: true, run: () => setFoldersOpen((v) => !v) }] : [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.commands],
  )
  // 分组用的（每条在哪组）；键的默认值在命令表里，设键时用 availNow()
  const avail = useMemo(() => listed.filter((c) => !c.folder).map((c) => ({ id: cmdId(c), home: c.home })), [listed])
  const pinned = useMemo(() => new Set(materialize(cfg, avail).find((g) => g.id === 'pin')?.items ?? []), [cfg, avail])
  const view = useMemo(() => {
    const m = new Map<string, ViewCmd>()
    for (const c of listed) {
      const id = cmdId(c)
      m.set(id, { ...c, id, keys: K(id) ?? undefined, alias: cfg.alias[id], hidden: cfg.hidden.includes(id), pinned: pinned.has(id), usedRank: usedRank(id) })
    }
    return m
  }, [listed, cfg, pinned, K])
  const boards = useMemo(() => new Set(props.notes.filter((n) => n.board).map((n) => n.path)), [props.notes])
  const digests = useMemo(() => new Set(props.notes.filter((n) => n.digest).map((n) => n.path)), [props.notes])

  // 最近打开的 3 篇（打开过的不够用最近改的补）
  const recent = useMemo(() => {
    const have = new Set([...props.notes.map((n) => n.path), ...(props.pdfs ?? []).map((p) => p.path)])
    const opened = recentFiles().filter((p) => have.has(p))
    const fill = [...props.notes].sort((a, b) => b.mtimeMs - a.mtimeMs).map((n) => n.path).filter((p) => !opened.includes(p))
    return [...opened, ...fill].slice(0, 3)
  }, [props.notes, props.pdfs])

  const rows = useMemo(() => {
    const t = q.trim()
    const looksUrl = looksLikeUrl(t)
    const explicitUrl = /^(https?:\/\/\S|www\.[\w-]+\.\S)/i.test(t) && !/\s/.test(t)
    return buildRows<ViewCmd>({
      q,
      recent: recentFiles(),
      pdfNames: (props.pdfs ?? []).map((p) => p.path),
      hits: hits.q === t ? hits.list : [],
      pdfHits: pdfHits.q === t ? pdfHits.list : [],
      meaning: meaning.q === t ? meaning.list : [],
      commands: [...view.values()].filter((c) => c.id !== FOLDERS_ID),
      url: t ? toUrl(q) : null,
      looksUrl,
      explicitUrl,
      expanded,
      claude,
    })
  }, [q, hits, pdfHits, meaning, view, props.pdfs, expanded, claude])

  const sections = useMemo(
    () => emptySections({ cfg, cmds: listed.map((c) => ({ id: cmdId(c), home: c.home, keys: c.keys, folder: c.folder, searchOnly: c.searchOnly })), recent, foldersOpen, showHidden, dragging: !!drag }),
    [cfg, listed, recent, foldersOpen, showHidden, drag],
  )
  const flat = useMemo(() => sections.flatMap((s) => s.rows.filter(selectable)), [sections])
  const empty = !q.trim()
  const eidx = flat.length ? Math.min(esel, flat.length - 1) : -1

  const idx = sel ? rowOf(rows, sel) : defaultIndex(rows)
  /** text：这个词的文字结果回来了；all：意思相近也回来了（结果出齐了） */
  const ready = { text: !q.trim() || doneFor === q.trim(), all: !q.trim() || (doneFor === q.trim() && meaning.q === q.trim()) }
  useEffect(() => {
    setSel(null)
    setEsel(0)
    queue.current = { q: '', keys: [] }
  }, [q])
  // Claude 找完：选中它找到的第一条（滚到看得见）
  useEffect(() => {
    if (claude.phase === 'done' && claude.found.length) setSel(cursorAt(rows, rows.findIndex((r) => r.kind === 'found')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claude])
  useEffect(() => {
    if (!empty || scrollSel.current) {
      list.current?.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' })
      scrollSel.current = false
    }
  }, [idx, eidx, empty])

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

  function runCmd(c: ViewCmd) {
    if (c.id === FOLDERS_ID) return setFoldersOpen((v) => !v)
    noteUsed(c.id)
    props.onClose()
    c.run()
  }

  function pick(r: Row<ViewCmd> | undefined) {
    if (!r) return
    if (r.kind === 'more') return setExpanded((s) => new Set(s).add(r.group))
    if (r.kind === 'claude') {
      if (claude.phase === 'running') {
        void window.cnSearch.claudeStop(claudeId.current)
        return
      }
      return askClaude()
    }
    if (r.kind === 'cmd') return runCmd(r.cmd)
    props.onClose()
    if (r.kind === 'note' || r.kind === 'pdfName') props.onOpen(r.path)
    else if (r.kind === 'pdfPage') props.onOpenPdfAt(r.hit.path, r.hit.page, r.hit.rect)
    else if (r.kind === 'meaning') r.hit.page && /\.pdf$/i.test(r.hit.path) ? props.onOpenPdfAt(r.hit.path, r.hit.page) : props.onOpen(r.hit.path)
    else if (r.kind === 'found') r.found.page && /\.pdf$/i.test(r.found.path) ? props.onOpenPdfAt(r.found.path, r.found.page) : props.onOpen(r.found.path)
    else props.onUrl(r.url)
  }

  function act(r: EmptyRow | undefined) {
    if (!r) return
    if (r.kind === 'cmd' || r.kind === 'child' || r.kind === 'put') {
      const c = view.get(r.id)
      if (c) runCmd(c)
    } else if (r.kind === 'folders') setFoldersOpen((v) => !v)
    else if (r.kind === 'note') {
      props.onClose()
      props.onOpen(r.path)
    } else if (r.kind === 'add') setForm({ edit: null })
    else if (r.kind === 'hidden') {
      setShowHidden((v) => !v)
      requestAnimationFrame(() => list.current && (list.current.scrollTop = list.current.scrollHeight))
    }
  }

  // ---------------------------------------------------------------- 改：每次改完底部能撤回
  function say(text: string, undo?: CmdConfig) {
    setToast({ text, undo, seq: ++toastSeq })
  }
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast((x) => (x?.seq === toast.seq ? null : x)), 4000)
    return () => clearTimeout(t)
  }, [toast])
  function change(fn: (c: CmdConfig) => CmdConfig, text: string) {
    const before = cmdConfig()
    void updateCmds(fn).catch((e) => say(`没存上：${String((e as Error)?.message ?? e)}`))
    say(text, before)
  }
  const nameOfId = (id: string) => view.get(id)?.name ?? id
  function togglePin(id: string) {
    if (pinned.has(id)) change((c) => unpinCmd(c, avail, id), `取消钉住「${nameOfId(id)}」`)
    else change((c) => pinCmd(c, avail, id), `钉住了「${nameOfId(id)}」，没打字时排在最上面`)
  }
  const hide = (id: string) => change((c) => hideCmd(c, id), `藏起了「${nameOfId(id)}」，打字搜照样找得到`)
  /** 能改的行（有自己的菜单）：命令和文件夹首页那一行；文件夹首页一个个的、笔记没有 */
  const editable = (id: string | undefined) => !!id && view.has(id) && !view.get(id)!.folder

  function openMenu(id: string, x: number, y: number, byKey = false) {
    if (!editable(id)) return
    setMini(null)
    setMenu({ id, x, y, byKey })
  }
  function closeMenu() {
    setMenu(null)
    input.current?.focus()
  }
  /** 挪到哪几组：钉住的、最近打开、它现在在的那组以外的 */
  const moveTargets = (id: string) => {
    const L = materialize(cfg, avail)
    const cur = L.find((g) => g.items.includes(id))?.id
    return L.filter((g) => g.id !== 'pin' && g.id !== cur).map((g) => ({ id: g.id, name: groupName(cfg, g.id) }))
  }
  function onMenu(a: MenuAct, at: { left: number; top: number }) {
    const id = menu!.id
    setMenu(null)
    if (a.kind === 'pin') togglePin(id)
    else if (a.kind === 'hide') hide(id)
    else if (a.kind === 'move') change((c) => moveCmd(c, avail, id, a.to, null), `挪到了「${groupName(cfg, a.to)}」`)
    else if (a.kind === 'newGroup') setMini({ kind: 'group', id, at })
    else if (a.kind === 'keys') {
      // 设快捷键的小弹层放在这一行下面 4，这一行整行露出来
      const r = document.querySelector(`.pal [data-cmd="${CSS.escape(id)}"]`)?.getBoundingClientRect()
      setMini({ kind: 'keys', id, at: r ? { left: at.left, top: r.bottom + 4 } : at })
    }
    else if (a.kind === 'alias') setMini({ kind: 'alias', id, at })
    else if (a.kind === 'edit') {
      // AI 命令：关上 ⌘K，开「存成命令」那张表改（规矩、在哪能用、写到哪）
      const cmd = mine.find((c) => c.id === id)
      if (cmd) {
        props.onClose()
        return openCmdEditor({ kind: 'edit', cmd, ...aiWho })
      }
      setForm({ edit: view.get(id)?.own ?? null })
    } else if (a.kind === 'delete') {
      const cmd = mine.find((c) => c.id === id)
      if (!cmd) change((c) => deleteOwn(c, id), '删掉了这条自己的命令')
      // AI 命令走 commands/store：只在这台 Mac 上的也删得掉，撤回放回原来那一份
      else
        void deleteAiCmd(cmd).then(
          (undo) => setToast({ text: '删掉了这条自己的命令', undoFn: undo, seq: ++toastSeq }),
          (e: unknown) => say(`没删掉：${String((e as Error)?.message ?? e)}`),
        )
    }
    if (a.kind !== 'newGroup' && a.kind !== 'keys' && a.kind !== 'alias') input.current?.focus()
  }
  function closeMini() {
    setMini(null)
    input.current?.focus()
  }

  // ---------------------------------------------------------------- 拖着换组
  function startDrag(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const row = (e.currentTarget as HTMLElement).closest('.pal-row') as HTMLElement
    const r = row.getBoundingClientRect()
    setMenu(null)
    setDrag({ id, name: nameOfId(id), icon: view.get(id)!, w: r.width, x: r.left, y: r.top, dy: e.clientY - r.top, line: null, target: null, over: null })
  }
  useEffect(() => {
    if (!drag) return
    const id = drag.id
    const move = (ev: PointerEvent) => {
      const box = list.current
      if (!box) return
      const sr = box.getBoundingClientRect()
      if (ev.clientY < sr.top + 30) box.scrollTop -= 8
      if (ev.clientY > sr.bottom - 30) box.scrollTop += 8
      let target: Drag['target'] = null
      let line: Drag['line'] = null
      let over: string | null = null
      // 只认列表看得见的那一块里的落点：拖到输入条、底栏上时（列表在自己滚），滚出去的那几行不算，横线也不画到面板外面
      const inside = ev.clientY >= sr.top && ev.clientY <= sr.bottom && ev.clientX >= sr.left && ev.clientX <= sr.right
      for (const el of inside ? box.querySelectorAll<HTMLElement>('[data-drop]') : []) {
        const b = el.getBoundingClientRect()
        if (ev.clientY < b.top || ev.clientY > b.bottom || ev.clientX < b.left || ev.clientX > b.right) continue
        const gid = el.dataset.drop!
        if (el.dataset.empty) {
          target = { gid, before: null }
          over = gid
          break
        }
        const L = materialize(cmdConfig(), avail)
        const vis = (L.find((g) => g.id === gid)?.items ?? []).filter((x) => x !== id && view.has(x) && !cmdConfig().hidden.includes(x))
        if (el.dataset.gh) {
          target = { gid, before: vis[0] ?? null }
          line = { left: b.left + 8, width: b.width - 16, top: b.bottom - 1 }
          break
        }
        const cid = el.dataset.cmd!
        if (cid === id) continue
        const after = ev.clientY > b.top + b.height / 2
        target = { gid, before: after ? (vis[vis.indexOf(cid) + 1] ?? null) : cid }
        line = { left: b.left + 8, width: b.width - 16, top: (after ? b.bottom : b.top) - 1 }
        break
      }
      if (line) line = { ...line, top: Math.max(sr.top, Math.min(sr.bottom - 2, line.top)) }
      setDrag((d) => (d ? { ...d, y: ev.clientY - d.dy, target, line, over } : d))
    }
    const up = () => {
      const d = dragRef.current
      setDrag(null)
      input.current?.focus()
      if (!d?.target) return
      const t = d.target
      const L = materialize(cmdConfig(), avail)
      const from = L.find((g) => g.items.includes(d.id))?.id
      // 放回原处（落点就是它自己后面那一条前面）不算改
      const items = L.find((g) => g.id === t.gid)?.items.filter((x) => view.has(x) && !cmdConfig().hidden.includes(x)) ?? []
      if (from === t.gid && (items[items.indexOf(d.id) + 1] ?? null) === t.before) return
      change((c) => moveCmd(c, avail, d.id, t.gid, t.before), from !== t.gid ? `「${d.name}」挪到了「${groupName(cmdConfig(), t.gid)}」` : `「${d.name}」换了位置`)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id])

  // ---------------------------------------------------------------- 自己的命令：加、改
  function saveOwn(v: FormValue) {
    const edit = form?.edit
    const id = edit?.id ?? `own-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const cmd: OwnCommand = { ...(edit ?? {}), id, name: v.name.trim(), kind: v.kind, target: v.target }
    setForm(null)
    change(
      (c) => {
        const all = [...avail, { id, home: v.group }]
        let next: CmdConfig = edit
          ? { ...c, own: c.own.map((o) => (o.id === id ? cmd : o)) }
          : { ...c, own: [...c.own, cmd] }
        const cur = materialize(next, all).find((g) => g.items.includes(id))?.id
        if (!edit || cur !== v.group) next = moveCmd(next, all, id, v.group, null)
        return setAlias(next, id, v.alias)
      },
      edit ? `存好了「${cmd.name}」` : `加上了「${cmd.name}」`,
    )
    input.current?.focus()
  }

  // ---------------------------------------------------------------- 选中的那一条（⌘. ⌘P ⌘⌫）
  const selectedId = (): string | undefined => {
    if (empty) {
      const r = flat[eidx]
      return r && (r.kind === 'cmd' || r.kind === 'put') ? r.id : r?.kind === 'folders' ? FOLDERS_ID : undefined
    }
    const r = rows[idx]
    return r?.kind === 'cmd' ? r.cmd.id : undefined
  }
  function menuForSelected() {
    const id = selectedId()
    const el = list.current?.querySelector<HTMLElement>('.pal-row.on')
    if (!id || !el) return
    const r = el.getBoundingClientRect()
    openMenu(id, r.right - 10, r.bottom, true)
  }

  const words = queryWords(q)
  const t = q.trim()
  // 本地一条都没有（笔记、命令、最合适都没有）才说「笔记和PDF里都没有…」；有命令对上时这一行读起来像什么都没找到（设计复审）
  const noText = !!t && !rows.some((r) => r.group === 'text' || r.group === 'notes' || r.group === 'best' || r.group === 'cmd')
  const finding = noText && doneFor !== t
  const urlish = looksLikeUrl(t)
  const groups = [...GROUPS.filter((g) => g.id !== 'recent' && g.id !== 'pin'), ...materialize(cfg, avail).filter((g) => !GROUPS.some((b) => b.id === g.id))].map((g) => ({ id: g.id, name: groupName(cfg, g.id) }))
  const formGroups = [{ id: 'pin', name: '钉住的' }, ...groups]
  const menuCmd = menu ? view.get(menu.id) : undefined
  let lastGroup: Group | '' = ''
  let n = -1
  /** 意思相近那一组该在哪一行前面：网页那一行（放最前的网址不算）、让 Claude 找 */
  const meaningAt = rows.findIndex((r) => (r.kind === 'url' && !r.typed) || r.kind === 'claude' || r.kind === 'found')

  const rowMenuProps = (id: string) => ({
    onContextMenu: (e: React.MouseEvent) => {
      if (!editable(id)) return
      e.preventDefault()
      e.stopPropagation()
      openMenu(id, e.clientX, e.clientY)
    },
  })
  const more = (id: string) =>
    editable(id) ? (
      <button
        className={'pal-more' + (menu?.id === id ? ' open' : '')}
        tabIndex={-1}
        aria-label={`「${nameOfId(id)}」能做什么`}
        title={`这一条能做什么${K('pal-menu') ? `（${K('pal-menu')}）` : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          if (menu?.id === id) return closeMenu()
          const r = e.currentTarget.getBoundingClientRect()
          openMenu(id, r.right - 4, r.bottom + 4)
        }}
      >
        <Codicon name="ellipsis" size={14} />
      </button>
    ) : null

  /** 没打字时的一行（普通函数，不是组件：每次画不换掉 DOM） */
  function emptyRow(r: EmptyRow, key: string) {
    if (r.kind === 'empty')
      return (
        <div key={key} className={'pal-empty' + (drag?.over === r.gid ? ' drop' : '')} data-drop={r.gid} data-empty="1">
          {r.gid === 'pin' ? '点一条右边的 ⋯「钉住」，或者拖到这里' : '拖到这里'}
        </div>
      )
    const i = ++n
    const on = i === eidx
    const common = {
      role: 'option',
      'aria-selected': on,
      onMouseMove: (e: React.MouseEvent) => (e.movementX || e.movementY) && !drag && i !== eidx && setEsel(i),
      onClick: () => act(r),
    } as const
    if (r.kind === 'note')
      return (
        <div key={key} {...common} className={'pal-row sr' + (on ? ' on' : '')}>
          <Codicon name={fileIcon(r.path, boards.has(r.path), digests.has(r.path))} size={16} className="i" />
          <span className="nm">{/\.(pdf|html?)$/i.test(r.path) ? nameOf(r.path) : titleOf(r.path)}</span>
          <span className="lc">{folderOf(r.path)}</span>
        </div>
      )
    if (r.kind === 'add')
      return (
        <div key={key} {...common} className={'pal-row sr add' + (on ? ' on' : '')}>
          <Codicon name="add" size={16} className="i" />
          <span className="nm">加一条自己的命令…</span>
          <span className="lc">打开一处、打开网址、让AI做</span>
        </div>
      )
    if (r.kind === 'hidden')
      return (
        <div key={key} {...common} className={'pal-row sr add' + (r.open ? ' exp' : '') + (on ? ' on' : '')} aria-expanded={r.open}>
          <Codicon name="eye-closed" size={16} className="i" />
          <span className="nm">{`藏着的 ${r.n} 条`}</span>
          <span className="chev">
            <Codicon name="chevron-right" size={12} />
          </span>
          <span className="lc">打字搜照样找得到</span>
        </div>
      )
    const id = r.kind === 'folders' ? FOLDERS_ID : r.id
    const c = view.get(id)
    if (!c) return null
    const dragging = drag?.id === id
    const gid = r.kind === 'cmd' || r.kind === 'folders' ? r.gid : undefined
    return (
      <div
        key={key}
        {...common}
        {...(r.kind === 'child' ? {} : rowMenuProps(id))}
        className={'pal-row sr' + (r.kind === 'child' ? ' child' : '') + (r.kind === 'put' ? ' hid' : '') + (r.kind === 'folders' && r.open ? ' exp' : '') + (dragging ? ' dragging' : '') + (on ? ' on' : '')}
        data-cmd={id}
        {...(gid ? { 'data-drop': gid } : {})}
        {...(r.kind === 'folders' ? { 'aria-expanded': r.open } : {})}
      >
        {gid && (
          <span className="pal-grip" aria-hidden onPointerDown={(e) => startDrag(e, id)} onClick={(e) => e.stopPropagation()}>
            <Codicon name="gripper" size={12} />
          </span>
        )}
        <CmdIcon c={c} />
        <span className="nm">{c.name}</span>
        {r.kind === 'folders' && (
          <span className="chev">
            <Codicon name="chevron-right" size={12} />
          </span>
        )}
        <span className="lc">{r.kind === 'folders' ? `${r.n} 个` : (c.hint ?? '')}</span>
        <span className="pal-rt">
          {c.alias && <span className="pal-alias">{c.alias}</span>}
          {c.keys && <kbd>{c.keys}</kbd>}
          {r.kind === 'put' ? (
            <button
              className="pal-put"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                change((x) => unhideCmd(x, id), `放回了「${c.name}」`)
              }}
            >
              放回
            </button>
          ) : (
            r.kind !== 'child' && more(id)
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="pal-back" onMouseDown={props.onClose}>
      <div className="pal" role="dialog" aria-label="搜索和命令" onMouseDown={(e) => (e.stopPropagation(), menu && !(e.target as HTMLElement).closest('.pal-more') && setMenu(null), mini && setMini(null))}>
        <div className="pal-in">
          <Codicon name="search" size={18} />
          <input
            ref={input}
            autoFocus
            aria-label="搜索笔记、输入网址或命令"
            placeholder="搜笔记、PDF里的字，或者说说你要找什么"
            value={q}
            onChange={(e) => (setQ(e.target.value), setShowHidden(false), setMenu(null))}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (form) return void (e.key === 'Escape' && (e.preventDefault(), setForm(null)))
              if (menu && e.key === 'Escape') return (e.preventDefault(), closeMenu())
              // ⌘. 这一条能做什么；⌘P 钉住；⌘⌫ 藏起（打着字时 ⌘⌫ 照旧是删到行首）；键照命令表（设置 › 快捷键里能改）
              if (isKey(e, 'pal-menu')) return (e.preventDefault(), menuForSelected())
              if (isKey(e, 'pal-pin')) {
                e.preventDefault()
                const id = selectedId()
                return void (editable(id) && togglePin(id!))
              }
              if (empty && isKey(e, 'pal-hide')) {
                e.preventDefault()
                const id = selectedId()
                return void (editable(id) && hide(id!))
              }
              if (empty) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  scrollSel.current = true
                  if (flat.length) setEsel((eidx + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length)
                } else if (e.key === 'Enter' && !e.metaKey && !e.altKey) (e.preventDefault(), act(flat[eidx]))
                else if (e.key === 'Escape') (e.preventDefault(), props.onClose())
                return
              }
              // ↓ ↑ 只在键盘能选的本地结果里挪；结果没出齐时先记着（第 3 轮：40ms 内 ↓ 回车去了 Google；第 4 轮：早按 ↓ 落到没把握的那篇）
              if (e.key === 'ArrowDown') (e.preventDefault(), press(1))
              else if (e.key === 'ArrowUp') (e.preventDefault(), press(-1))
              // ⌘↵ 不管选着哪一行都在右栏网页里搜（像网址就直接打开）；⌥↵ 让 Claude 找（CN-41）
              else if (isKey(e, 'pal-web')) (e.preventDefault(), pick(rows.find((r) => r.kind === 'url')))
              else if (isKey(e, 'pal-claude')) (e.preventDefault(), t && claude.phase !== 'running' && askClaude())
              // 回车只按出齐了会选中的那一行走：没出齐、后到的结果还能改它，就等（CN 第 2 轮：手快回车把笔记名发到了网上）；
              // 自己用鼠标挪到网页、Claude 那一行的马上走
              else if (e.key === 'Enter') (e.preventDefault(), press('enter'))
              else if (e.key === 'Escape') (e.preventDefault(), props.onClose())
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list} role="listbox" aria-label={empty ? '命令' : '结果'}>
          {form ? (
            <CmdForm
              edit={form.edit}
              group={form.edit ? (materialize(cfg, [...avail, { id: form.edit.id }]).find((g) => g.items.includes(form.edit!.id))?.id ?? 'pin') : 'pin'}
              alias={form.edit ? (cfg.alias[form.edit.id] ?? '') : ''}
              groups={formGroups}
              onDone={saveOwn}
              onBack={() => (setForm(null), input.current?.focus())}
              // 「让AI做一件事」：关上 ⌘K，开「存成命令」那张表从头写
              onAi={() => (props.onClose(), openCmdEditor({ kind: 'new', ...aiWho }))}
            />
          ) : empty ? (
            sections.map((s) => (
              <div key={s.id} className="pal-sec" data-g={s.id}>
                {s.name && (
                  <div className="pal-g" {...(s.id !== 'recent' ? { 'data-drop': s.id, 'data-gh': '1' } : {})}>
                    {s.name}
                  </div>
                )}
                {s.rows.map((r, i) => emptyRow(r, ('id' in r ? r.id : 'path' in r ? r.path : r.kind) + i))}
              </div>
            ))
          ) : (
            <>
              {finding ? (
                <div className="pal-none">在找「{t}」…</div>
              ) : (
                noText && (
                  <>
                    <div className="pal-none">笔记和PDF里都没有「{t}」这几个字</div>
                    {idx === -1 && !urlish && <div className="pal-none-why">{K('pal-web') ? `回车没有可打开的，${K('pal-web')} 去网页搜` : '回车没有可打开的'}</div>}
                  </>
                )
              )}
              {/* 打的像网址、名字对得上的一个都没有：回车不开正文里有它的、意思相近的，说清楚要去网页按 ⌘↵ */}
              {urlish && idx === -1 && !finding && <div className="pal-none-why">{`${noText ? '' : `没有叫「${t}」的笔记，`}回车不做事${K('pal-web') ? `，${K('pal-web')} 去网页打开` : ''}`}</div>}
              {rows.map((r, i) => {
                let head = null
                // 让 Claude 找跟在网页那一行下面，同一组「网页和AI」
                const sameSec = r.kind === 'claude' && lastGroup === 'web'
                if (r.group !== lastGroup && !sameSec) {
                  const h =
                    r.group === 'claude' && r.kind === 'claude'
                      ? { name: '网页和AI' }
                      : r.group === 'web' && r.kind === 'url' && r.typed
                        ? { name: '网页' }
                        : groupHead(r.group, { q, claudeDone: r.kind === 'found', why: r.group === 'best' && r.kind === 'cmd' && r.cmd.usedRank !== undefined ? '最近用过' : '' })
                  if (h) {
                    const why = r.group === 'meaning' ? statusWhy(status) : 'why' in h ? h.why : undefined
                    head = (
                      <div className="pal-g">
                        {h.name}
                        {why && <span className="why"> {why}</span>}
                      </div>
                    )
                  }
                }
                // 本机小模型还没好、意思相近一条没有：在它该在的地方（网页和AI 上面）说一句为什么
                const meaningHead =
                  i === meaningAt && t && status && status.phase !== 'ready' && !rows.some((x) => x.group === 'meaning') ? (
                    <div className="pal-g">
                      意思相近<span className="why"> {statusWhy(status)}</span>
                    </div>
                  ) : null
                const sec = r.group !== lastGroup && !sameSec && (lastGroup !== '' || !!meaningHead)
                lastGroup = r.group
                return (
                  <div key={i} className={sec ? 'pal-sec2' : undefined}>
                    {meaningHead}
                    {meaningHead && head && <div className="pal-div" />}
                    {head}
                    <RowView
                      row={r}
                      on={i === idx}
                      nokey={!cursorAt(rows, i)}
                      words={words}
                      q={t}
                      claude={claude}
                      boards={boards}
                      digests={digests}
                      more={more}
                      menuProps={rowMenuProps}
                      onHover={() => {
                        // 没把握的意思相近：鼠标悬停也不当选中（回车不开它），只能点
                        const c = cursorAt(rows, i)
                        if (c) setSel(c)
                      }}
                      onPick={() => pick(r)}
                    />
                  </div>
                )
              })}
            </>
          )}
        </div>
        <div className="pal-foot" aria-label="快捷键" style={mini?.kind === 'keys' ? { visibility: 'hidden' } : undefined}>
          {form ? (
            <span>{`${K('escape')} 回到列表 · ${K('submit')} 加上`}</span>
          ) : (
            <>
              {footKeys(K)}
            </>
          )}
        </div>
        {toast && (
          <div className="pal-toast" role="status">
            <span>{toast.text}</span>
            {(toast.undo || toast.undoFn) && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const { undo: before, undoFn } = toast
                  setToast(null)
                  void (undoFn ? undoFn() : updateCmds(() => before!))
                }}
              >
                撤回
              </button>
            )}
          </div>
        )}
      </div>
      {menu && menuCmd && (
        <RowMenu
          cmd={{ id: menu.id, name: menuCmd.name, keys: menuCmd.keys ?? null, alias: menuCmd.alias, pinned: !!menuCmd.pinned, own: !!menuCmd.own, ownEditable: menuCmd.own?.kind === 'open' || menuCmd.own?.kind === 'url' || menuCmd.own?.kind === 'ai', fixedKeys: menuCmd.fixedKeys }}
          x={menu.x}
          byKey={menu.byKey}
          y={menu.y}
          groups={moveTargets(menu.id)}
          onAct={onMenu}
          onClose={closeMenu}
        />
      )}
      {mini?.kind === 'keys' && (
        <KeysMini
          id={mini.id}
          name={nameOfId(mini.id)}
          cur={K(mini.id)}
          def={availNow().find((a) => a.id === mini.id)?.keys ?? null}
          at={mini.at}
          onClose={closeMini}
          onOk={(combo) => {
            const id = mini.id
            closeMini()
            change((c) => setKey(c, availNow(), id, combo), `「${nameOfId(id)}」的快捷键是 ${combo}`)
          }}
          onSwap={(combo) => {
            const id = mini.id
            const mine = K(id)
            const other = checkKey(id, combo).clash?.name ?? ''
            closeMini()
            change((c) => swapKey(c, availNow(), id, combo), `对调了：「${nameOfId(id)}」${combo}，「${other}」${mine}`)
          }}
          onClear={() => {
            const id = mini.id
            closeMini()
            change((c) => setKey(c, availNow(), id, null), `「${nameOfId(id)}」没有快捷键了`)
          }}
          onReset={() => {
            const id = mini.id
            const def = availNow().find((a) => a.id === id)?.keys
            closeMini()
            change((c) => resetKey(c, availNow(), id), def ? `「${nameOfId(id)}」回到默认 ${def}` : `「${nameOfId(id)}」回到默认：没有键`)
          }}
        />
      )}
      {mini?.kind === 'alias' && (
        <TextMini
          label="别名"
          title={`给「${nameOfId(mini.id)}」起个别名：打全它，这一条排第一`}
          value={cfg.alias[mini.id] ?? ''}
          placeholder="比如 tb"
          at={mini.at}
          onClose={closeMini}
          onOk={(v) => {
            const id = mini.id
            const a = v.trim()
            closeMini()
            if (a === (cfg.alias[id] ?? '')) return
            change((c) => setAlias(c, id, a), a ? `打「${a}」就是「${nameOfId(id)}」` : `「${nameOfId(id)}」没有别名了`)
          }}
        />
      )}
      {mini?.kind === 'group' && (
        <TextMini
          label="新的一组"
          title="新的一组叫什么"
          value="我的一组"
          placeholder="我的一组"
          at={mini.at}
          onClose={closeMini}
          onOk={(v) => {
            const id = mini.id
            const name = v.trim() || '我的一组'
            const gid = `g-${Date.now().toString(36)}`
            closeMini()
            change((c) => moveCmd(newGroup(c, avail, name, gid), avail, id, gid, null), `挪到了「${name}」`)
          }}
        />
      )}
      {drag && (
        <>
          <div className="pal-dragrow" style={{ left: drag.x, top: drag.y, width: drag.w }} aria-hidden>
            <CmdIcon c={drag.icon} />
            <span className="nm">{drag.name}</span>
          </div>
          {drag.line && <div className="pal-dropline" style={{ left: drag.line.left, top: drag.line.top, width: drag.line.width }} />}
        </>
      )}
    </div>
  )
}

/** 正文那一小段开头就是这篇的标题（摘要从「# 标题」那一行起）：行里已经写了名字，不再重复 */
/** ⌘K 底部那一行：键照命令表（没有键的那一项不写） */
function footKeys(K: (id: string) => string | null) {
  const part = (id: string, what: string) => (K(id) ? `${K(id)} ${what}` : null)
  const menu = part('pal-menu', '这一条能做什么')
  const before = [part('up-down', '选择'), part('enter', '打开')].filter(Boolean).join(' · ')
  const after = [part('pal-web', '网页搜'), part('pal-claude', '让Claude找'), part('escape', '关闭')].filter(Boolean).join(' · ')
  return (
    <>
      {before}
      {menu && (
        <>
          {' · '}
          <b>{menu}</b>
        </>
      )}
      {after && ` · ${after}`}
    </>
  )
}

export function withoutTitle(snippet: string, title: string): string {
  const t = title.trim()
  if (!t || !snippet.startsWith(t)) return snippet
  const rest = snippet.slice(t.length).trimStart()
  return rest || snippet
}

/** 命令左边的图标：交给 AI 的画跑它的那一家的标志 */
function CmdIcon({ c }: { c: Pick<PaletteCommand, 'ai' | 'icon'> }) {
  return c.ai ? <AiIcon job={c.ai} size={16} className="i" fallback={c.icon} /> : <Codicon name={c.icon} size={16} className="i" />
}

function RowView(p: {
  row: Row<ViewCmd>
  on: boolean
  /** 键盘选不中（没把握的意思相近）：只有悬停的淡底，点了才开 */
  nokey?: boolean
  words: string[]
  q: string
  claude: ClaudeState
  boards: Set<string>
  digests: Set<string>
  more(id: string): React.ReactNode
  menuProps(id: string): { onContextMenu(e: React.MouseEvent): void }
  onHover(): void
  onPick(): void
}) {
  const r = p.row
  const cls = 'pal-row sr' + (p.on ? ' on' : '') + (p.nokey ? ' nokey' : '') + (r.kind === 'more' ? ' more' : '') + (r.kind === 'found' ? ' two' : '') + (r.kind === 'claude' ? ' ask' : '')
  let body
  let extra = {}
  if (r.kind === 'cmd') {
    const c = r.cmd
    extra = { 'data-cmd': c.id, ...(c.folder ? {} : p.menuProps(c.id)) }
    body = (
      <>
        <CmdIcon c={c} />
        <span className="nm">
          <Marked text={c.name} words={p.words} />
        </span>
        {c.hint && <span className="lc">{c.hint}</span>}
        <span className="pal-rt">
          {c.hidden && <span className="pal-tag">藏着的</span>}
          {c.alias && <span className="pal-alias">{c.alias}</span>}
          {c.keys && <kbd>{c.keys}</kbd>}
          {!c.folder && p.more(c.id)}
        </span>
      </>
    )
  } else if (r.kind === 'note') {
    // 名字对上的（最合适、笔记两组）只写名字和位置、标出命中的字；正文里有的（笔记和PDF里的字）再跟一小段
    const body1 = r.group === 'text' && r.snippet
    body = (
      <>
        <Codicon name={fileIcon(r.path, p.boards.has(r.path), p.digests.has(r.path))} size={16} className="i" />
        <span className="nm">{body1 ? titleOf(r.path) : <Marked text={titleOf(r.path)} words={p.words} />}</span>
        <span className="lc">{folderOf(r.path)}</span>
        {body1 && (
          <span className="sn">
            <Marked text={withoutTitle(r.snippet!, titleOf(r.path))} words={p.words} />
          </span>
        )}
      </>
    )
  } else if (r.kind === 'pdfName')
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
        {keyFor('pal-web') && <kbd className="rt">{keyFor('pal-web')}</kbd>}
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
        <span className="sn">{`已看${p.claude.looked}个 · ${p.claude.step}`}</span>
        <span className="rt">停下</span>
      </>
    )
  else if (p.claude.phase === 'done')
    body = (
      <>
        <EngineLogo id="claude" size={16} className="i" />
        <span className="nm">Claude也没找到「{p.q}」</span>
        <span className="sn">{p.claude.error ?? '换个说法再试，或者回车让它再找一遍'}</span>
      </>
    )
  else
    body = (
      <>
        <EngineLogo id="claude" size={16} className="i" />
        <span className="nm">让Claude帮我找「{p.q}」</span>
        <span className="rt">几秒到十几秒</span>
        {keyFor('pal-claude') && <kbd className="rt2">{keyFor('pal-claude')}</kbd>}
      </>
    )
  return (
    // 鼠标真的动了才换选中（列表在不动的鼠标下面重排时，浏览器也会补发 mouseenter，不能借这个把「去网上搜」选上）
    <div className={cls} {...extra} onMouseMove={(e) => (e.movementX || e.movementY) && !p.on && p.onHover()} onClick={p.onPick} role="option" aria-selected={p.on}>
      {body}
    </div>
  )
}
