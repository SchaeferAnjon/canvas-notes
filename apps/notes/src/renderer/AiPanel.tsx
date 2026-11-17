import { Codicon, type CodiconName } from '@cn/design'
import { onMessageMenu } from './ctx/message-menu'
import { fmValue, isMindmap, resetLayout, splitDoc } from '@cn/format'
import { Markdown } from './md-render'
import { AiError } from './ai-error'
import { PastedThumbs, pastedUrl, usePastedImages } from './paste-images'
import { EngineLogo } from './engine-logo'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentContext, EngineId, EngineInfo, StoredMsg, ToolStep } from '../shared/agent'
import type { CommitInfo, DuplicatePair, NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import './ai.css'
import {
  articlePrompt,
  askPrompt,
  COMMANDS,
  draftText,
  dropQuote,
  inboxPrompt,
  parseMoves,
  quoteOf,
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
  /** 找重复正在算：已比几篇、共几篇（total 是 0 时还在读全库、切字） */
  dupProgress?: { done: number; total: number }
}

const ICONS: Record<string, CodiconName> = {
  整理收件箱: 'inbox',
  总结这块白板: 'layout',
  写成文章: 'edit',
  翻译: 'whole-word',
  找重复: 'check',
  剪藏当前网页: 'globe',
  现在梦游: 'wand',
}

let seq = Date.now()

/**
 * 做成了、只是没提交上：黄色 warning 图标 + 一行说明（「卡存好了，提交没成功」），下面 12 号淡字写原因，再一个「再提交一次」。
 * 和 AI 出错那行（ai-error.tsx）同一种排法
 */
function CommitWarn(props: { text: string; onRetry(): void }) {
  const at = props.text.indexOf('：')
  const [title, why] = at > 0 ? [props.text.slice(0, at), props.text.slice(at + 1)] : [props.text, '']
  return (
    <div className="warn" role="status" data-testid="ai-warn">
      <div className="t">
        <Codicon name="warning" size={12} className="ic" />
        <span>{title}</span>
      </div>
      {why && <div className="why">{why}</div>}
      <div className="acts">
        <button className="btn btn-xs" onClick={props.onRetry}>
          <Codicon name="git-commit" size={12} />
          再提交一次
        </button>
      </div>
    </div>
  )
}

/** AI 的改动写进文件了、只是没提交上；message 是中文原因，retry 是「再提交一次」要提交的文件和说明 */
class CommitFailed extends Error {
  constructor(
    why: string,
    readonly retry: NonNullable<StoredMsg['retry']>,
  ) {
    super(why)
  }
}

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
  /** 右键「问 AI」：这段字作为引文放进输入框，光标进去，不自动发（seq 变了再放一次） */
  draft?: { text: string; seq: number } | null
  /** 现在用的引擎名字（A 的底栏 AI 项写它） */
  onEngine?(label: string, id: EngineId): void
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const paste = usePastedImages((t) => {
    setPasteNote(t)
    setTimeout(() => setPasteNote((x) => (x === t ? null : x)), 3000)
  })
  const [menuIdx, setMenuIdx] = useState(0)
  const [mentions, setMentions] = useState<string[]>([])
  const [running, setRunning] = useState<number | null>(null)
  const [engines, setEngines] = useState<EngineInfo[]>([])
  const [engine, setEngine] = useState<EngineId>('claude')
  const [engineMenu, setEngineMenu] = useState(false)
  /** 现在 AI 对话用的「Claude Code · Opus 5.5」 */
  const [by, setBy] = useState('')
  // 引擎菜单开着时按 Esc 收起（只收菜单，不关 AI 浮窗）
  useEffect(() => {
    if (!engineMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setEngineMenu(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [engineMenu])
  const list = useRef<HTMLDivElement>(null)
  /** 对话列表停在最底下（新的字、进度出来时跟着滚） */
  const pinned = useRef(true)
  const box = useRef<HTMLTextAreaElement>(null)

  const notePath = props.tab?.type === 'note' ? props.tab.path : null
  const noteFile = props.notes.find((n) => n.path === notePath)
  const isBoard = !!noteFile?.board || props.mode === 'board'
  const inbox = props.notes.filter((n) => n.kind === 'inbox')
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? 'Claude Code'
  useEffect(() => props.onEngine?.(engineLabel, engine), [engineLabel, engine])

  // 对话记录和选的引擎：存在软件设置目录，关了再开、重开软件都还在
  useEffect(() => {
    void window.cn.aiChatLoad().then((m) => {
      setMsgs(m)
      setLoaded(true)
    })
    const loadEngines = () =>
      void window.cn.aiEngines().then((r) => {
        setEngines(r.engines)
        setEngine(r.current)
        setBy(r.label)
      })
    loadEngines()
    // 设置 › AI 里改了「AI 对话」（或读 PDF 右栏头上换了）：开着的浮窗马上跟着换
    return window.cn.onAiPrefsChanged(loadEngines)
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
      void window.cn.aiEngines().then((r) => (setEngine(r.current), setBy(r.label)))
    } else setEngineMenu(false)
  }, [props.open])
  const draftSeq = useRef(0)
  /** 引文是在哪个标签带进来的：换了标签就把它从输入框拿掉（自己接着打的问题留着），不拿上一篇的话问这一篇 */
  const quoteFrom = useRef<{ tab: string | null; quote: string } | null>(null)
  useEffect(() => {
    const q = quoteFrom.current
    if (!q || q.tab === (props.tab?.id ?? null)) return
    quoteFrom.current = null
    // 引文改过几个字、前面打过字也认得出来：「>」开头的那几行拿掉，自己打的问题留着
    setInput((v) => dropQuote(v, q.quote))
  }, [props.tab?.id])
  useEffect(() => {
    const d = props.draft
    if (!d || d.seq === draftSeq.current) return
    draftSeq.current = d.seq
    // 已经打了问题：引文放在问题上面，不盖掉人自己打的字（上一段引文换成这一段）
    const quote = quoteOf(d.text)
    const old = quoteFrom.current?.quote
    setInput((v) => quote + (old ? dropQuote(v, old) : v).replace(/^\n+/, ''))
    quoteFrom.current = { tab: props.tab?.id ?? null, quote }
    // 浮窗刚打开，等它画出来再把光标放到最后
    requestAnimationFrame(() => {
      const t = box.current
      if (!t) return
      t.focus()
      t.setSelectionRange(t.value.length, t.value.length)
    })
  }, [props.draft?.seq])
  // 输入框跟着字变高（最多约 6 行再滚）：打字、带进引文、换篇拿掉引文都走这里
  useLayoutEffect(() => {
    const t = box.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = Math.min(t.scrollHeight, 140) + 'px'
  }, [input, props.open])
  const ranSeq = useRef(0)
  useEffect(() => {
    const a = props.autoRun
    if (!a || a.seq === ranSeq.current || !loaded) return
    ranSeq.current = a.seq
    void run(a.text)
  }, [props.autoRun?.seq, loaded])
  useEffect(() => {
    // 跟着最新的往下滚；人往上翻着看时不拽回去（找重复每 0.3 秒刷新一次，不然一直被拉到底）
    if (pinned.current) list.current?.scrollTo({ top: list.current.scrollHeight })
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
  const push = (m: Msg) => ((pinned.current = true), setMsgs((x) => [...x, m]))
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
    const r = await window.cn.aiChange(change)
    props.onChanged()
    // 改动写进文件了、只是没提交上：交给调用的照实说（「卡存好了，提交没成功：…」），不当成 AI 没答出来
    if (r && 'failed' in r) throw new CommitFailed(r.failed, { paths: r.paths, message: r.message, kinds })
    const commit = r
    if (commit) patch(id, { change: { commit, kinds } })
    return commit
  }

  /**
   * 「再提交一次」：只提交 AI 那次改的文件、用原来的「AI：…」说明（第 5 轮：以前是「现在提交」整个库，把别处正写着的笔记一起提交成
   * 「更新 2 个文件」，消息里也没了撤回）。提交上了：提醒换成「提交好了」，下面和一次就提交上的一样给「改了几个文件 · 撤回」；
   * 又没成：写明这是第几次也没成和这次的原因（以前一个字不变，看不出点过）
   */
  async function retryCommit(m: StoredMsg) {
    const warn = m.warn!
    const lead = warn.slice(0, warn.indexOf('：'))
    const tries = (m.tries ?? 1) + 1
    try {
      const c = m.retry ? await window.cn.aiCommit(m.retry.paths, m.retry.message) : await window.cn.commit()
      patch(m.id, {
        warn: undefined,
        retry: undefined,
        tries: undefined,
        done: c ? `${lead.replace(/，提交没成功$/, '')}，提交好了` : '没有要提交的改动了',
        ...(c && m.retry ? { change: { commit: c, kinds: m.retry.kinds } } : {}),
      })
    } catch (e) {
      patch(m.id, { warn: `${lead}：第${tries}次也没提交上，${errText(e)}`, tries })
    }
    props.onChanged()
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
    // 粘贴的图跟着这句一起交给引擎（/ 命令不带图）
    const pasted = /^\//.test(text) ? [] : paste.list.map((p) => p.name)
    if (pasted.length) paste.clear()
    push({ id: seq++, role: 'user', text, ...(pasted.length ? { pasted } : {}) })
    const id = seq++
    const cmd = /^\/(\S+)/.exec(text)?.[1]
    push({ id, role: 'ai', pending: true })
    // 找重复（大库要算十几秒）不占着对话：算的时候照样能发新问题，它在自己那条消息里报进度、能单独停下
    if (cmd === '找重复') return void findDuplicates(id)
    setRunning(id)
    try {
      // 不是现成的命令：去掉斜杠，当成一句话交给 AI 去做
      if (cmd && !COMMANDS.some((c) => c.name === cmd)) return await agentTurn(id, text.slice(1))
      if (cmd === '整理当前白板') {
        if (!notePath) return patch(id, { pending: false, error: '先打开一块白板' })
        // 普通文档的白板就是按节摆（doc-board 的规则）：不用问 AI，摆回原样就是整理好的样子
        const body = await noteText(notePath)
        if (fmValue(body, 'type') !== 'board' && !isMindmap(body)) {
          const d = props.doc()
          const next = resetLayout(body)
          const b = splitDoc(next)
          if (d && d.path === notePath && next !== body) d.setText(next)
          return patch(id, { pending: false, text: `照文档的节摆好了：${b.columns.length}列、${b.total}张卡${next !== body ? '，单独摆出来的卡都放回了它那一节' : ''}。` })
        }
        return await agentTurn(id, TIDY_BOARD)
      }
      if (cmd === '现在梦游') return await dreamNow(id)
      if (cmd && PENDING_COMMANDS[cmd]) return await pendingCommand(id, cmd)
      if (cmd === '整理收件箱') return await tidyInbox(id)
      if (cmd === '总结这块白板' || cmd === '写成文章') {
        if (!notePath) return patch(id, { pending: false, error: '先打开一块白板或一篇笔记' })
        const body = await noteText(notePath)
        const cards = (body.match(/^<!-- card /gm) ?? []).length
        const read = `读了 ${notePath}${cards ? ` · ${cards}张卡片` : ''}`
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
                try {
                  await applyChange(id, { message: `总结「${titleOf(notePath)}」存成卡片`, writes: [{ path: notePath, text: next }] }, { [notePath]: '改' })
                } catch (e) {
                  if (!(e instanceof CommitFailed)) throw e
                  return patch(id, { actions: [], warn: `卡存好了，提交没成功：${e.message}`, retry: e.retry })
                }
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
        patch(id, { read: sel.trim() ? `读了选中的${sel.length}个字` : `读了 ${notePath}` })
        const reply = await askAi(id, translatePrompt(src), true)
        patch(id, { pending: false, text: reply })
        return
      }
      await agentTurn(id, text, pasted)
    } catch (e) {
      if (e instanceof CommitFailed) patch(id, { pending: false, warn: `改好了，提交没成功：${e.message}`, retry: e.retry })
      else patch(id, { pending: false, error: errText(e) })
    } finally {
      setRunning(null)
    }
  }

  /** 直接说的话：交给选好的引擎，它能用工具操纵网页、白板、文档 */
  async function agentTurn(id: number, text: string, pasted: string[] = []) {
    patch(id, { live: true, engine, text: '', ...(by ? { by } : {}) })
    const ctx = props.context(mentions)
    try {
      const r = await window.cn.aiTurn({ id, engine, text, context: ctx, ...(pasted.length ? { pasted } : {}) })
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

  /** 找重复每条消息列出了几对（先列 50，「再显示 50 对」往下加；别把上万对一次铺开） */
  const [dupShown, setDupShown] = useState<Record<number, number>>({})
  /** 正在算的找重复是哪一条消息 */
  const dupping = useRef<number | null>(null)
  /**
   * 找重复：只列出来，不改文件；两篇都能点开。边算边报「已比 N/M 篇」，先找到的先列出来（像的在前）；
   * 「停下」直接结束算的进程，已经找到的留着。
   */
  async function findDuplicates(id: number) {
    if (dupping.current !== null) return patch(id, { pending: false, text: '上一次找重复还在算，等它算完或者先停下。' })
    dupping.current = id
    let found: DuplicatePair[] = []
    let prog = { done: 0, total: 0 }
    patch(id, { dupProgress: prog })
    const off = window.cn.onDuplicatesProgress((p) => {
      prog = { done: p.done, total: p.total }
      if (p.pairs.length) found = byScore([...found, ...p.pairs])
      patch(id, { dupProgress: prog, ...(found.length ? { dups: found } : {}) })
    })
    try {
      const pairs = await window.cn.findDuplicates({ webUrl: props.webUrl })
      if (!pairs.length) return patch(id, { pending: false, dupProgress: undefined, dups: undefined, text: '没找到重复的。' })
      patch(id, { pending: false, dupProgress: undefined, text: `找到${pairs.length}对可能重复的，像的在前：`, dups: pairs })
    } catch (e) {
      if (errText(e) !== '停下了') return patch(id, { pending: false, dupProgress: undefined, error: errText(e) })
      const where = prog.total ? `比了${prog.done}/${prog.total}篇` : '还没开始比'
      patch(id, {
        pending: false,
        dupProgress: undefined,
        text: found.length ? `停下了（${where}），先找到的${found.length}对，像的在前：` : `停下了（${where}），还没找到重复的。`,
        dups: found.length ? found : undefined,
      })
    } finally {
      off()
      dupping.current = null
    }
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
    if (!moves.length) return patch(id, { pending: false, read: `读了收件箱${inbox.length}条`, text: '这几条都没把握放哪，先留在收件箱。' })
    patch(id, {
      pending: false,
      read: `读了收件箱${inbox.length}条`,
      text: `有把握的${moves.length}条，挪到这些主题：`,
      moves,
      actions: [
        {
          label: '同意，挪过去',
          primary: true,
          run: async () => {
            const kinds: Record<string, string> = {}
            for (const m of moves) kinds[`${topicFolder(m.topic)}/${m.path.split('/').pop()}`] = '移动'
            await applyChange(id, { message: `整理收件箱：挪了 ${moves.length} 条`, moves: moves.map((m) => ({ from: m.path, toFolder: topicFolder(m.topic) })) }, kinds)
            patch(id, { actions: [], done: `挪好了${moves.length}条` })
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
    void window.cn.aiSetEngine(e.id).then(() => window.cn.aiEngines().then((r) => setBy(r.label)))
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
  if (props.tab?.type === 'inbox') sees.push({ label: `收件箱${inbox.length}条`, on: true })
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
            <EngineLogo id={engine} />
            {engineLabel}
            <Codicon name="chevron-down" size={12} />
          </button>
          {engineMenu && (
            <div className="engmenu" role="menu" aria-label="AI 引擎">
              <div className="mh">用这台Mac上已经登录的</div>
              {engines.map((e) => (
                <button key={e.id} role="menuitemradio" aria-checked={e.id === engine} disabled={!e.path} title={e.hint ?? e.path ?? ''} onClick={() => pickEngine(e)}>
                  <span className="ck">{e.id === engine && <Codicon name="check" size={12} />}</span>
                  <EngineLogo id={e.id} />
                  <b>{e.label}</b>
                  <span>{e.path ? '' : '没装'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 头里放不下整句（右栏 340 宽、引擎胶囊带标志）就换成短的「改动可撤回」，悬停看全句 */}
        <span className="meta" data-testid="ai-undo-hint" data-tip="AI的改动都是Git提交，随时可撤回" data-side="below">
          <span className="long">改动都是提交，可撤回</span>
          <span className="short">改动可撤回</span>
        </span>
        <span className="sp" />
        <button className="iconbtn" aria-label="新对话" title="新对话" onClick={newChat}>
          <Codicon name="add" size={14} />
        </button>
        <button className="ai-collapse" aria-label="收起 AI" data-tip="收起AI" data-key="⌘J" data-side="below" onClick={props.onClose}>
          <Codicon name="close" size={14} className="ic" />
          <span className="lb">收起</span> <kbd>⌘J</kbd>
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
            <Codicon name="cursor" size={12} />
            能动手：{hands}
          </span>
        )}
      </div>
      <div
        className="msgs"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {msgs.length === 0 && (
          <div className="ai-empty">
            <h2>想让AI做什么？</h2>
            <p>输入 / 选命令，@ 点名一篇笔记，或者直接说：它能替你点网页、整理白板、改文档。</p>
            <div className="sugg">
              {suggestions.map((s) => (
                <button key={s} onClick={() => void run('/' + s)}>
                  <Codicon name={ICONS[s] ?? 'sparkle'} size={14} />/{s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="um-wrap">
              {m.pasted && (
                <div className="um-imgs">
                  {m.pasted.map((n) => (
                    <img key={n} src={pastedUrl(n)} alt="粘贴的图" />
                  ))}
                </div>
              )}
              <div className="um" onContextMenu={(e) => onMessageMenu(e, m.text ?? '')}>
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="am" data-testid="ai-msg" data-engine={m.engine} onContextMenu={(e) => !m.pending && onMessageMenu(e, m.text ?? '')}>
              {(m.read || m.by) && (
                <div className="read">
                  {m.read && <Codicon name="check" size={12} />}
                  {m.read && <span className="rd">{m.read}</span>}
                  {m.by && <span className="by">{m.read ? ' · ' : ''}{m.by}</span>}
                </div>
              )}
              {m.steps?.map((s) => (
                <div key={s.id} className={'read tstep ' + s.status} data-testid="ai-step" title={s.detail}>
                  <Codicon name={s.status === 'run' ? 'loading' : s.status === 'ok' ? 'check' : 'close'} size={12} className={s.status === 'run' ? 'spin' : ''} />
                  {s.label}
                  {s.status === 'err' && s.detail && <span className="why">：{s.detail}</span>}
                </div>
              ))}
              {m.pending && !m.text && !m.steps?.length && !m.dupProgress && <div className="thinking">{m.engine ? `${engines.find((e) => e.id === m.engine)?.label ?? ''}正在想…` : '正在想…'}</div>}
              {m.error && (
                <AiError
                  raw={m.error}
                  engine={{ id: m.engine ?? engine, label: engines.find((e) => e.id === (m.engine ?? engine))?.label }}
                  {...(() => {
                    const q = msgs[i - 1]?.role === 'user' ? msgs[i - 1]!.text : undefined
                    return q && running === null
                      ? {
                          onRetry: () => void run(q),
                          onRephrase: () => {
                            setInput(q)
                            requestAnimationFrame(() => box.current?.focus())
                          },
                        }
                      : {}
                  })()}
                />
              )}
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
                  {/* 先列像的前 50 对，「再显示 50 对」往下加（上万对一次铺开太重；算的时候每 0.3 秒刷新一次） */}
                  {m.dups.slice(0, dupShown[m.id] ?? DUP_PAGE).map((d) => (
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
                  {m.dups.length > (dupShown[m.id] ?? DUP_PAGE) && (
                    <button className="lnk dupmore" onClick={() => setDupShown((x) => ({ ...x, [m.id]: (x[m.id] ?? DUP_PAGE) + DUP_PAGE }))}>
                      {`再显示${Math.min(DUP_PAGE, m.dups.length - (dupShown[m.id] ?? DUP_PAGE))}对（还有${m.dups.length - (dupShown[m.id] ?? DUP_PAGE)}对）`}
                    </button>
                  )}
                </div>
              )}
              {/* 进度和「停下」放在列出来的几对下面：对话停在最底下时一眼看得到 */}
              {m.dupProgress && m.pending && (
                <div className="read tstep run dupprog" data-testid="dup-progress" role="status">
                  <Codicon name="loading" size={12} className="spin" />
                  <span className="rd">
                    {m.dupProgress.total ? (
                      <>
                        正在找重复：已比<span className="num">{m.dupProgress.done}/{m.dupProgress.total}</span>篇
                        {m.dups?.length ? (
                          <>
                            ，找到<span className="num">{m.dups.length}</span>对
                          </>
                        ) : null}
                      </>
                    ) : (
                      '正在读全库、切字…'
                    )}
                  </span>
                  <button className="btn btn-sm" onClick={() => void window.cn.stopDuplicates()}>
                    <Codicon name="debug-stop" size={12} />
                    停下
                  </button>
                </div>
              )}
              {m.draft && (
                <div className="dprev">
                  <div className="dh">
                    <Codicon name="file-text" size={14} />
                    <b className="truncate">{titleOf(m.draft.path)}</b>
                  </div>
                  <div className="dmeta">
                    <code>{m.draft.path}</code> · <span className="num">{m.draft.words}</span>字 · AI写的草稿
                  </div>
                  <p>{m.draft.head}</p>
                </div>
              )}
              {m.done && <div className="done">{m.done}</div>}
              {m.warn && <CommitWarn text={m.warn} onRetry={() => void retryCommit(m)} />}
              {m.dream && (
                <div className="acts">
                  <button className="btn btn-sm btn-primary" onClick={props.onShowDream}>
                    <Codicon name="wand" size={12} />
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
                      onClick={() =>
                        void Promise.resolve(a.run()).catch((e) =>
                          patch(m.id, e instanceof CommitFailed ? { actions: [], warn: `改好了，提交没成功：${e.message}`, retry: e.retry } : { error: errText(e) }),
                        )
                      }
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
      <div className={'aiin' + (paste.list.length ? ' has-att' : '') + (paste.dragging ? ' hot' : '')} {...paste.dropProps}>
        {paste.list.length > 0 && (
          <div className="atts">
            <PastedThumbs list={paste.list} onRemove={paste.remove} />
          </div>
        )}
        {pasteNote && <div className="nocmd">{pasteNote}</div>}
        {menuLen > 0 && (
          <div className="cmdmenu" role="listbox" aria-label={slash ? '命令' : '引用笔记'}>
            {slash
              ? cmdItems.map((c, i) => (
                  <button key={c.name} role="option" aria-selected={i === menuIdx} className={i === menuIdx ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
                    <span className="ib">
                      <Codicon name={ICONS[c.name] ?? 'sparkle'} size={14} />
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
                      <Codicon name={n.board ? 'layout' : 'file-text'} size={14} />
                    </span>
                    <span>
                      <b>{titleOf(n.path)}</b>
                      <span>{n.board ? `白板 · ${n.board.cards}张卡片` : '文档'}</span>
                    </span>
                  </button>
                ))}
            <div className="keys">↑↓ 选择 · ↵ 执行 · esc 关闭</div>
          </div>
        )}
        {slash && cmdItems.length === 0 && <div className="nocmd">没有这条命令，回车直接交给AI去做</div>}
        <textarea
          ref={box}
          rows={1}
          aria-label="问 AI"
          placeholder={`跟${engineLabel}说，/ 选命令，@ 引用笔记`}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setMenuIdx(0)
          }}
          onKeyDown={onKey}
          onPaste={paste.onPaste}
        />
        {running !== null ? (
          <button className="send" aria-label="停下" onClick={stop}>
            <Codicon name="primitive-square" size={12} />
          </button>
        ) : (
          <button className="send" aria-label="发送" disabled={!input.trim()} onClick={() => void run(input)}>
            <Codicon name="arrow-up" size={14} />
          </button>
        )}
      </div>
    </aside>
  )
}

/** 找重复一次先列几对 */
const DUP_PAGE = 50

/** 找重复的一对对：像的在前 */
const byScore = (pairs: DuplicatePair[]) => pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))


/** 存盘时去掉只在这次打开时有的东西；没做完的那条记成停下了 */
function stored(m: Msg): StoredMsg {
  const { pending, live, actions, dupProgress, ...rest } = m
  void live
  void actions
  void dupProgress
  return pending && !rest.text && !rest.error ? { ...rest, error: '没做完（软件关了）' } : rest
}

function ChangeBlock({ change, onRevert, onHistory }: { change: Change; onRevert(): void; onHistory(): void }) {
  const c: CommitInfo = change.commit
  return (
    <div className={'aichg' + (change.reverted ? ' reverted' : '')} data-testid="ai-change">
      <div className="hd">
        <Codicon name="git-commit" size={14} />
        {change.reverted ? '已撤回' : `改了${c.files.length}个文件`}
        <code>{(change.reverted ?? c).hash.slice(0, 7)}</code>
        <span className="sp" />
        {!change.reverted && (
          <button className="btn btn-sm" onClick={onRevert}>
            <Codicon name="discard" size={12} />
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
        {change.reverted ? '又做了一次反向提交，文件回到了AI改之前' : '已提交到main'}
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
