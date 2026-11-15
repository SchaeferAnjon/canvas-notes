import { Icon } from '@cn/design'
import { fmValue } from '@cn/format'
import {
  ArrowUp,
  Check,
  ChevronDown,
  CopyCheck,
  FileText,
  GitCommitHorizontal,
  Globe,
  Inbox,
  LayoutGrid,
  Languages,
  LoaderCircle,
  Moon,
  PenLine,
  Plus,
  Sparkles,
  Square,
  Undo2,
  X,
  MousePointer2,
} from 'lucide-react'
import { Markdown } from './md-render'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentContext, EngineId, EngineInfo, StoredMsg, ToolStep } from '../shared/agent'
import type { CommitInfo, NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import './ai.css'
import {
  articlePrompt,
  askPrompt,
  COMMANDS,
  draftText,
  inboxPrompt,
  parseMoves,
  dreamSummary,
  PENDING_COMMANDS,
  TIDY_BOARD,
  summaryPrompt,
  SYSTEM,
  topicFolder,
  translatePrompt,
  withSummaryCard,
} from './ai-commands'
import { GROUPS } from './dream/useDream'
import type { NoteDoc, ViewMode } from './note-doc'
import type { Tab } from './tabs'

type Action = { label: string; primary?: boolean; run(): Promise<void> | void }

type Change = NonNullable<StoredMsg['change']>

/** 存下来的部分 + 只在这次打开时有的（还在生成、按钮） */
type Msg = StoredMsg & {
  pending?: boolean
  /** 流式的字往这条里写 */
  live?: boolean
  actions?: Action[]
}

const ICONS: Record<string, typeof Inbox> = {
  整理收件箱: Inbox,
  总结这块白板: LayoutGrid,
  写成文章: PenLine,
  翻译: Languages,
  找重复: CopyCheck,
  剪藏当前网页: Globe,
  现在梦游: Moon,
}

let seq = Date.now()

export function AiPanel(props: {
  open: boolean
  tab: Tab | null
  mode: ViewMode
  doc(): NoteDoc | null
  notes: NoteFile[]
  webUrl: string | null
  /** 现在看的是什么（当前标签、右栏网页、选中的字），每一轮发给 AI */
  context(mentions: string[]): AgentContext
  onClose(): void
  onOpen(path: string): void
  onShowHistory(): void
  /** 在右栏打开梦游报告 */
  onShowDream(): void
  onChanged(): void
  /** 一打开就跑这条（seq 变了再跑一次） */
  autoRun?: { text: string; seq: number } | null
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [menuIdx, setMenuIdx] = useState(0)
  const [mentions, setMentions] = useState<string[]>([])
  const [running, setRunning] = useState<number | null>(null)
  const [engines, setEngines] = useState<EngineInfo[]>([])
  const [engine, setEngine] = useState<EngineId>('claude')
  const [engineMenu, setEngineMenu] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const notePath = props.tab?.type === 'note' ? props.tab.path : null
  const noteFile = props.notes.find((n) => n.path === notePath)
  const isBoard = !!noteFile?.board || props.mode === 'board'
  const inbox = props.notes.filter((n) => n.kind === 'inbox')
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? 'Claude Code'

  // 对话记录和选的引擎：存在软件设置目录，关了再开、重开软件都还在
  useEffect(() => {
    void window.cn.aiChatLoad().then((m) => {
      setMsgs(m)
      setLoaded(true)
    })
    void window.cn.aiEngines().then((r) => {
      setEngines(r.engines)
      setEngine(r.current)
    })
  }, [])
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => void window.cn.aiChatSave(msgs.map(stored)), 300)
    return () => clearTimeout(t)
  }, [msgs, loaded])

  // 边生成边显示：字和工具步骤按编号写进那条消息
  useEffect(
    () =>
      window.cn.onAiEvent((id, e) =>
        setMsgs((x) =>
          x.map((m) => {
            if (m.id !== id || m.role !== 'ai' || !m.live) return m
            if (e.type === 'text') return { ...m, text: (m.text ?? '') + e.delta }
            const steps = [...(m.steps ?? [])]
            const i = steps.findIndex((s) => s.id === e.id)
            const step: ToolStep = { id: e.id, label: e.label, status: e.status, ...(e.detail ? { detail: e.detail } : {}) }
            if (i === -1) steps.push(step)
            else steps[i] = step
            return { ...m, steps }
          }),
        ),
      ),
    [],
  )

  useEffect(() => {
    if (props.open) {
      box.current?.focus()
      // 设置页「AI」里可能换过默认引擎
      void window.cn.aiEngines().then((r) => setEngine(r.current))
    } else setEngineMenu(false)
  }, [props.open])
  const ranSeq = useRef(0)
  useEffect(() => {
    const a = props.autoRun
    if (!a || a.seq === ranSeq.current || !loaded) return
    ranSeq.current = a.seq
    void run(a.text)
  }, [props.autoRun?.seq, loaded])
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [msgs])

  // ---------- 菜单 ----------
  const slash = /^\/(\S*)$/.exec(input)
  const at = /(?:^|\s)@(\S*)$/.exec(input)
  const cmdItems = slash ? COMMANDS.filter((c) => c.name.includes(slash[1]!)) : []
  const atItems = at
    ? props.notes
        .filter((n) => n.kind === 'work' && titleOf(n.path).toLowerCase().includes(at[1]!.toLowerCase()) && !mentions.includes(n.path))
        .slice(0, 8)
    : []
  const menuLen = slash ? cmdItems.length : at ? atItems.length : 0

  const suggestions = useMemo(() => {
    if (props.tab?.type === 'inbox') return ['整理收件箱', '找重复']
    if (isBoard) return ['总结这块白板', '写成文章', '整理收件箱']
    if (notePath) return ['总结这块白板', '翻译']
    if (props.webUrl) return ['剪藏当前网页', '整理收件箱']
    return ['整理收件箱', '现在梦游']
  }, [props.tab, isBoard, notePath, props.webUrl])

  // ---------- 跑命令 ----------
  const push = (m: Msg) => setMsgs((x) => [...x, m])
  const patch = (id: number, p: Partial<Msg>) => setMsgs((x) => x.map((m) => (m.id === id && m.role === 'ai' ? { ...m, ...p } : m)))

  async function noteText(path: string): Promise<string> {
    const d = props.doc()
    if (d && d.path === path) return d.text
    return (await window.cn.readNote(path)).text
  }

  /** 只聊天的命令：live 时边生成边显示 */
  async function askAi(id: number, prompt: string, live: boolean): Promise<string> {
    if (live) patch(id, { live: true, text: '' })
    try {
      return await window.cn.aiAsk(id, SYSTEM, prompt)
    } finally {
      patch(id, { live: false })
    }
  }

  async function applyChange(id: number, change: Parameters<typeof window.cn.aiChange>[0], kinds: Record<string, string>) {
    const d = props.doc()
    if (d) await d.save()
    const commit = await window.cn.aiChange(change)
    props.onChanged()
    if (commit) patch(id, { change: { commit, kinds } })
    return commit
  }

  async function revert(id: number, c: Change) {
    try {
      const r = await window.cn.aiRevert(c.commit.hash)
      if (r) patch(id, { change: { ...c, reverted: r } })
      props.onChanged()
    } catch (e) {
      patch(id, { error: errText(e) })
    }
  }

  async function run(raw: string) {
    const text = raw.trim()
    if (!text || running !== null) return
    setInput('')
    setEngineMenu(false)
    push({ id: seq++, role: 'user', text })
    const id = seq++
    const cmd = /^\/(\S+)/.exec(text)?.[1]
    push({ id, role: 'ai', pending: true })
    setRunning(id)
    try {
      // 不是现成的命令：去掉斜杠，当成一句话交给 AI 去做
      if (cmd && !COMMANDS.some((c) => c.name === cmd)) return await agentTurn(id, text.slice(1))
      if (cmd === '整理当前白板') {
        if (!notePath) return patch(id, { pending: false, error: '先打开一块白板' })
        return await agentTurn(id, TIDY_BOARD)
      }
      if (cmd === '找重复') return await findDuplicates(id)
      if (cmd === '现在梦游') return await dreamNow(id)
      if (cmd && PENDING_COMMANDS[cmd]) return await pendingCommand(id, cmd)
      if (cmd === '整理收件箱') return await tidyInbox(id)
      if (cmd === '总结这块白板' || cmd === '写成文章') {
        if (!notePath) return patch(id, { pending: false, error: '先打开一块白板或一篇笔记' })
        const body = await noteText(notePath)
        const cards = (body.match(/^<!-- card /gm) ?? []).length
        const read = `读了 ${notePath}${cards ? ` · ${cards} 张卡片` : ''}`
        patch(id, { read })
        if (cmd === '总结这块白板') {
          const reply = await askAi(id, summaryPrompt(notePath, body), true)
          const actions: Action[] = []
          if (fmValue(body, 'type') === 'board' || cards > 0) {
            actions.push({
              label: '存成卡片',
              primary: true,
              run: async () => {
                const cur = (await window.cn.readNote(notePath)).text
                const { text: next } = withSummaryCard(cur, reply)
                await applyChange(id, { message: `总结「${titleOf(notePath)}」存成卡片`, writes: [{ path: notePath, text: next }] }, { [notePath]: '改' })
                patch(id, { actions: [], done: '存到了白板左下角' })
              },
            })
          }
          patch(id, { pending: false, text: reply, actions })
        } else {
          const article = await askAi(id, articlePrompt(notePath, body), true)
          const name = `${titleOf(notePath)}：文章草稿`
          const draft = draftText(notePath, article)
          const commit = await applyChange(id, { message: `按「${titleOf(notePath)}」写成文章草稿`, writes: [{ path: `${name}.md`, text: draft, create: true }] }, {})
          const path = commit?.files.find((f) => f.path.endsWith('.md'))?.path ?? `${name}.md`
          if (commit) patch(id, { change: { commit, kinds: { [path]: '新' } } })
          const words = article.replace(/\s/g, '').length
          patch(id, {
            pending: false,
            text: undefined,
            draft: { path, words, head: article.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 3).join('\n') },
            actions: [{ label: '打开', primary: true, run: () => props.onOpen(path) }],
          })
        }
        return
      }
      if (cmd === '翻译') {
        const d = props.doc()
        const sel = d ? d.view.state.sliceDoc(d.view.state.selection.main.from, d.view.state.selection.main.to) : ''
        const src = sel.trim() || (notePath ? await noteText(notePath) : '')
        if (!src.trim()) return patch(id, { pending: false, error: '先在文档里选中一段，或者打开一篇笔记' })
        patch(id, { read: sel.trim() ? `读了选中的 ${sel.length} 个字` : `读了 ${notePath}` })
        const reply = await askAi(id, translatePrompt(src), true)
        patch(id, { pending: false, text: reply })
        return
      }
      await agentTurn(id, text)
    } catch (e) {
      patch(id, { pending: false, error: errText(e) })
    } finally {
      setRunning(null)
    }
  }

  /** 直接说的话：交给选好的引擎，它能用工具操纵网页、白板、文档 */
  async function agentTurn(id: number, text: string) {
    patch(id, { live: true, engine, text: '' })
    const ctx = props.context(mentions)
    try {
      const r = await window.cn.aiTurn({ id, engine, text, context: ctx })
      setMsgs((x) =>
        x.map((m) =>
          m.id === id && m.role === 'ai'
            ? {
                ...m,
                pending: false,
                live: false,
                text: r.text || m.text || undefined,
                ...(r.error ? { error: r.error } : {}),
                ...(r.commit ? { change: { commit: r.commit, kinds: r.kinds } } : {}),
              }
            : m,
        ),
      )
      if (r.commit) props.onChanged()
    } finally {
      patch(id, { live: false })
    }
  }

  /** 找重复：只列出来，不改文件；两篇都能点开 */
  async function findDuplicates(id: number) {
    const pairs = await window.cn.findDuplicates({ webUrl: props.webUrl })
    if (!pairs.length) return patch(id, { pending: false, text: '没找到重复的。' })
    patch(id, { pending: false, text: `找到 ${pairs.length} 对可能重复的，像的在前：`, dups: pairs })
  }

  /** 现在梦游：改动在单独的分支上，跑完说整理了几条、分几组，给个按钮打开右栏报告 */
  async function dreamNow(id: number) {
    patch(id, { read: '正在梦游：整理收件箱、补双链、找重复、写本周小结' })
    const report = await window.cn.dreamNow({ webUrl: props.webUrl })
    const s = dreamSummary(report, GROUPS)
    patch(id, { pending: false, read: undefined, text: s.text, dream: { items: s.items, groups: s.groups } })
  }

  /** 还在别的同事那里做的命令：window.cn 上有对应方法才调 */
  async function pendingCommand(id: number, cmd: string) {
    const fn = (window.cn as unknown as Record<string, unknown>)[PENDING_COMMANDS[cmd]!]
    if (typeof fn !== 'function') return patch(id, { pending: false, text: '这条命令还在做' })
    const r: unknown = await (fn as (arg: { webUrl: string | null }) => Promise<unknown>).call(window.cn, { webUrl: props.webUrl })
    props.onChanged()
    patch(id, { pending: false, text: typeof r === 'string' && r ? r : '做好了' })
  }

  async function tidyInbox(id: number) {
    if (!inbox.length) return patch(id, { pending: false, text: '收件箱是空的，没有要整理的。' })
    const items = await Promise.all(inbox.map(async (n) => ({ path: n.path, text: (await window.cn.readNote(n.path)).text })))
    const topics = [...new Set(props.notes.filter((n) => n.kind === 'clip').map((n) => n.topic!))]
    const reply = await askAi(id, inboxPrompt(items, topics), false)
    const moves = parseMoves(reply, inbox)
    if (!moves.length) return patch(id, { pending: false, read: `读了收件箱 ${inbox.length} 条`, text: '这几条都没把握放哪，先留在收件箱。' })
    patch(id, {
      pending: false,
      read: `读了收件箱 ${inbox.length} 条`,
      text: `有把握的 ${moves.length} 条，挪到这些主题：`,
      moves,
      actions: [
        {
          label: '同意，挪过去',
          primary: true,
          run: async () => {
            const kinds: Record<string, string> = {}
            for (const m of moves) kinds[`${topicFolder(m.topic)}/${m.path.split('/').pop()}`] = '移动'
            await applyChange(id, { message: `整理收件箱：挪了 ${moves.length} 条`, moves: moves.map((m) => ({ from: m.path, toFolder: topicFolder(m.topic) })) }, kinds)
            patch(id, { actions: [], done: `挪好了 ${moves.length} 条` })
          },
        },
      ],
    })
  }

  function stop() {
    if (running === null) return
    void window.cn.aiStop(running)
    void window.cn.aiTurnStop(running)
  }

  function pickEngine(e: EngineInfo) {
    if (!e.path) return
    setEngine(e.id)
    setEngineMenu(false)
    void window.cn.aiSetEngine(e.id)
    box.current?.focus()
  }

  function newChat() {
    setMsgs([])
    setMentions([])
    void window.cn.aiChatClear()
  }

  // ---------- 输入 ----------
  function pick(i: number) {
    if (slash) {
      const c = cmdItems[i]
      if (c) void run('/' + c.name)
    } else if (at) {
      const n = atItems[i]
      if (!n) return
      setMentions((m) => [...m, n.path])
      setInput(input.slice(0, input.length - at[1]!.length - 1) + '@' + titleOf(n.path) + ' ')
    }
    setMenuIdx(0)
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (menuLen) {
      if (e.key === 'ArrowDown') return (e.preventDefault(), setMenuIdx((i) => (i + 1) % menuLen))
      if (e.key === 'ArrowUp') return (e.preventDefault(), setMenuIdx((i) => (i - 1 + menuLen) % menuLen))
      if (e.key === 'Enter') return (e.preventDefault(), pick(menuIdx))
      if (e.key === 'Escape') return (e.preventDefault(), setInput(''))
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void run(input)
    } else if (e.key === 'Escape') {
      props.onClose()
    }
  }

  const sees: { label: string; on?: boolean }[] = []
  if (notePath) sees.push({ label: `${isBoard ? '白板' : '文档'}：${titleOf(notePath)}`, on: true })
  if (props.tab?.type === 'inbox') sees.push({ label: `收件箱 ${inbox.length} 条`, on: true })
  if (props.webUrl) sees.push({ label: `网页：${hostOf(props.webUrl)}` })
  for (const m of mentions) sees.push({ label: `@${titleOf(m)}` })
  // 它在这一页能替你做的动作（右栏网页开着时排最前，最可能是要它动网页）
  const hands = props.webUrl
    ? '滚动、选中、剪藏网页'
    : notePath
      ? isBoard
        ? '挪卡片、排成列、合并'
        : '改写、插入、挪块'
      : props.tab?.type === 'home' || props.tab?.type === 'inbox'
        ? '整理收件箱、开白板'
        : null

  return (
    <aside className="ai floating" aria-label="AI 对话" hidden={!props.open}>
      <div className="aih">
        <b>AI</b>
        <div className="aieng">
          <button className="engbtn" aria-label="选 AI 引擎" aria-haspopup="menu" aria-expanded={engineMenu} onClick={() => setEngineMenu((v) => !v)} data-testid="ai-engine">
            {engineLabel}
            <Icon of={ChevronDown} size={12} />
          </button>
          {engineMenu && (
            <div className="engmenu" role="menu" aria-label="AI 引擎">
              <div className="mh">用这台 Mac 上已经登录的</div>
              {engines.map((e) => (
                <button key={e.id} role="menuitemradio" aria-checked={e.id === engine} disabled={!e.path} title={e.hint ?? e.path ?? ''} onClick={() => pickEngine(e)}>
                  <span className="ck">{e.id === engine && <Icon of={Check} size={12} />}</span>
                  <b>{e.label}</b>
                  <span>{e.path ? '' : '没装'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="meta">改动都是提交，可撤回</span>
        <span className="sp" />
        <button className="iconbtn" aria-label="新对话" title="新对话" onClick={newChat}>
          <Icon of={Plus} size={14} />
        </button>
        <button className="iconbtn" aria-label="收起 AI" title="收起 ⌘J" onClick={props.onClose}>
          <Icon of={X} size={14} />
        </button>
      </div>
      <div className="sees" data-testid="ai-sees">
        <span className="k">看得到</span>
        {sees.length === 0 && <span className="chip">没打开笔记</span>}
        {sees.map((s) => (
          <span key={s.label} className="chip">
            {s.on && <i className="dot" />}
            {s.label}
          </span>
        ))}
        {hands && (
          <span className="chip hands">
            <Icon of={MousePointer2} size={12} />
            能动手：{hands}
          </span>
        )}
      </div>
      <div className="msgs" ref={list}>
        {msgs.length === 0 && (
          <div className="ai-empty">
            <h2>想让 AI 做什么？</h2>
            <p>输入 / 选命令，@ 点名一篇笔记，或者直接说：它能替你点网页、整理白板、改文档。</p>
            <div className="sugg">
              {suggestions.map((s) => (
                <button key={s} onClick={() => void run('/' + s)}>
                  <Icon of={ICONS[s] ?? Sparkles} size={14} />/{s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="um">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="am" data-testid="ai-msg" data-engine={m.engine}>
              {m.read && (
                <div className="read">
                  <Icon of={Check} size={12} />
                  {m.read}
                </div>
              )}
              {m.steps?.map((s) => (
                <div key={s.id} className={'read tstep ' + s.status} data-testid="ai-step" title={s.detail}>
                  <Icon of={s.status === 'run' ? LoaderCircle : s.status === 'ok' ? Check : X} size={12} className={s.status === 'run' ? 'spin' : ''} />
                  {s.label}
                  {s.status === 'err' && s.detail && <span className="why">：{s.detail}</span>}
                </div>
              ))}
              {m.pending && !m.text && !m.steps?.length && <div className="thinking">{m.engine ? `${engines.find((e) => e.id === m.engine)?.label ?? ''} 正在想…` : '正在想…'}</div>}
              {m.error && <div className="err">{m.error}</div>}
              {m.text && (
                <div className="txt">
                  <Markdown text={m.text} />
                </div>
              )}
              {m.moves && (
                <div className="moves">
                  {m.moves.map((x) => (
                    <div key={x.path} className="mv">
                      <span className="truncate">{titleOf(x.path)}</span>
                      <span className="to">→ {topicFolder(x.topic)}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.dups && (
                <div className="dups" data-testid="ai-dups">
                  {m.dups.map((d) => (
                    <div key={d.a + '|' + d.b} className="dup">
                      <div className="pair">
                        <button className="lnk" onClick={() => props.onOpen(d.a)}>
                          {titleOf(d.a)}
                        </button>
                        <span className="vs">↔</span>
                        <button className="lnk" onClick={() => props.onOpen(d.b)}>
                          {titleOf(d.b)}
                        </button>
                        <span className="sp" />
                        <span className="num score">{Math.round(d.score * 100)}%</span>
                      </div>
                      <div className="why">{d.why}</div>
                    </div>
                  ))}
                </div>
              )}
              {m.draft && (
                <div className="dprev">
                  <div className="dh">
                    <Icon of={FileText} size={14} />
                    <b className="truncate">{titleOf(m.draft.path)}</b>
                  </div>
                  <div className="dmeta">
                    <code>{m.draft.path}</code> · <span className="num">{m.draft.words}</span> 字 · AI 写的草稿
                  </div>
                  <p>{m.draft.head}</p>
                </div>
              )}
              {m.done && <div className="done">{m.done}</div>}
              {m.dream && (
                <div className="acts">
                  <button className="btn btn-sm btn-primary" onClick={props.onShowDream}>
                    <Icon of={Moon} size={12} />
                    打开梦游报告
                  </button>
                </div>
              )}
              {!!m.actions?.length && (
                <div className="acts">
                  {m.actions.map((a) => (
                    <button
                      key={a.label}
                      className={'btn btn-sm' + (a.primary ? ' btn-primary' : '')}
                      onClick={() => void Promise.resolve(a.run()).catch((e) => patch(m.id, { error: errText(e) }))}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              {m.change && <ChangeBlock change={m.change} onRevert={() => void revert(m.id, m.change!)} onHistory={props.onShowHistory} />}
            </div>
          ),
        )}
      </div>
      <div className="aiin">
        {menuLen > 0 && (
          <div className="cmdmenu" role="listbox" aria-label={slash ? '命令' : '引用笔记'}>
            {slash
              ? cmdItems.map((c, i) => (
                  <button key={c.name} role="option" aria-selected={i === menuIdx} className={i === menuIdx ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                    <span className="ib">
                      <Icon of={ICONS[c.name] ?? Sparkles} size={14} />
                    </span>
                    <span>
                      <b>{c.name}</b>
                      <span>{c.desc}</span>
                    </span>
                  </button>
                ))
              : atItems.map((n, i) => (
                  <button key={n.path} role="option" aria-selected={i === menuIdx} className={i === menuIdx ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                    <span className="ib">
                      <Icon of={n.board ? LayoutGrid : FileText} size={14} />
                    </span>
                    <span>
                      <b>{titleOf(n.path)}</b>
                      <span>{n.board ? `白板 · ${n.board.cards} 张卡片` : '文档'}</span>
                    </span>
                  </button>
                ))}
            <div className="keys">↑↓ 选择 · ↵ 执行 · esc 关闭</div>
          </div>
        )}
        {slash && cmdItems.length === 0 && <div className="nocmd">没有这条命令，回车直接交给 AI 去做</div>}
        <textarea
          ref={box}
          rows={1}
          aria-label="问 AI"
          placeholder={`跟 ${engineLabel} 说，/ 选命令，@ 引用笔记`}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setMenuIdx(0)
            const t = e.currentTarget
            t.style.height = 'auto'
            t.style.height = Math.min(t.scrollHeight, 140) + 'px'
          }}
          onKeyDown={onKey}
        />
        {running !== null ? (
          <button className="send" aria-label="停下" onClick={stop}>
            <Icon of={Square} size={12} />
          </button>
        ) : (
          <button className="send" aria-label="发送" disabled={!input.trim()} onClick={() => void run(input)}>
            <Icon of={ArrowUp} size={14} />
          </button>
        )}
      </div>
    </aside>
  )
}

/** 存盘时去掉只在这次打开时有的东西；没做完的那条记成停下了 */
function stored(m: Msg): StoredMsg {
  const { pending, live, actions, ...rest } = m
  void live
  void actions
  return pending && !rest.text && !rest.error ? { ...rest, error: '没做完（软件关了）' } : rest
}

function ChangeBlock({ change, onRevert, onHistory }: { change: Change; onRevert(): void; onHistory(): void }) {
  const c: CommitInfo = change.commit
  return (
    <div className={'aichg' + (change.reverted ? ' reverted' : '')} data-testid="ai-change">
      <div className="hd">
        <Icon of={GitCommitHorizontal} size={14} />
        {change.reverted ? '已撤回' : `改了 ${c.files.length} 个文件`}
        <code>{(change.reverted ?? c).hash.slice(0, 7)}</code>
        <span className="sp" />
        {!change.reverted && (
          <button className="btn btn-sm" onClick={onRevert}>
            <Icon of={Undo2} size={12} />
            撤回
          </button>
        )}
      </div>
      {c.files.map((f) => (
        <div key={f.path} className="fr">
          <span className="truncate">{f.path}</span>
          <span className="k">{change.kinds[f.path] ?? (f.removed === 0 && f.added > 0 ? '新' : '改')}</span>
          <span className="num add">+{f.added}</span>
          <span className="num del">−{f.removed}</span>
        </div>
      ))}
      <div className="ft">
        {change.reverted ? '又做了一次反向提交，文件回到了 AI 改之前' : '已提交到 main'}
        <button className="lnk" onClick={onHistory}>
          在历史里看
        </button>
      </div>
    </div>
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
