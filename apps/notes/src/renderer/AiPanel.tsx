import { AiNote } from './feynman/cover'
import { PhoneWaiting } from './mobile-ai/PhoneWaiting'
import { noteName } from '../shared/ai-note'
import { Codicon, type CodiconName } from '@cn/design'
import { onMessageMenu } from './ctx/message-menu'
import { app } from './ctx/actions'
import { fmValue, hasOldLayout, isMindmap, resetLayout, splitDoc } from '@cn/format'
import { type CiteScope, touchedOf, useCiteSig } from './cite-names'
import { Markdown } from './md-render'
import { AnswerRow } from './answer-row'
import { UserMsgActs } from './replies/save-reply'
import { sayOf } from './replies/store'
import { fillReply } from '../shared/replies'
import { withoutVizMark } from '../shared/reading'
import { type AbMenuItem, ChangeBar, UndoButton } from '@cn/ai-chat/answer-bar'
import { jumpDone, jumpToChat, useChatJump } from '@cn/ai-chat/chat-jump'
import { feedDone, setDraft, useFeed } from './ai-web-stay'
import { AiError } from '@cn/ai-chat/ai-error'
import { openEnginePick } from '@cn/ai-chat/ai-picker'
import { aiErrorCode } from '../shared/ai-errors'
import { openAiSettings, pastedUrl } from './ai-chat-host'
import { AiIntro, LoginCard, SetupCard } from './ai-setup'
import { ByLogo } from './engine-logo'
import { AiHead, AwayBar, Chip, type DockNav, type OlderChat, Sees } from './ai-head'
import { askLine, MULTI, pickAsk, quickCmds } from './ai-greet'
import { dropPicked, pickedFiles, pickTip, usePicked } from './ai-pick'
import { dropCards, pickText, useCardPick } from './ai-cards'
import { runTidy } from './commands/tidy'
import { t } from '../shared/i18n'
import { BoardFind } from './find/BoardFind'
import { ChangeBlock, FilePath } from './ai-change'
import { Greeting, type Quick, QuickRow } from './ai-quick'
import { AiInput, MatMsg, sendText, useComposer, useConvPick } from '@cn/ai-chat/composer'
import { MentionText } from '@cn/ai-chat/mention'
import type { AtItem } from '@cn/ai-chat/mentions'
import type { AiPick, EngineInfo } from '@cn/ai-engines/shared'
import { createPortal } from 'react-dom'
import { AskBox } from '@cn/ai-chat/side/AskBox'
import { showSide as revealSide, useSideHost } from '@cn/ai-chat/side/host'
import { ASK_THIS, sideName } from './side/name'
import { SideInline } from '@cn/ai-chat/side/SideInline'
import { ChatToc, type TocSide } from '@cn/ai-chat/chat-toc'
import { NewBelow, useFollow } from '@cn/ai-chat/follow'
import { StepRow } from '@cn/ai-chat/steps'
import { applyMarks, flashMark, groupMark, type Mark, sideGroups } from '@cn/ai-chat/side/marks'
import * as C from './ai-chats'
import { folderCount, HANDS, type Place, seenOf } from './ai-place'
import { WEB_PAGE_SAID, type WebSeen } from '../shared/web-pages'
import { type FolderSug, fileInPrompt, folderSugs, folderSumPrompt, newTarget, parseFileIn, skeleton, sumTargets } from './folder-ai'
import { useKnownFiles } from './files/store'
import { composing } from './ime'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentContext, StoredMsg, ToolStep } from '../shared/agent'
import { imageNames, type Material } from '../shared/materials'
import type { CommitInfo, DuplicatePair, NoteFile } from '../shared/api'
import { CLIPS, INBOX, titleOf } from '../shared/layout'
import { inboxEntry, placesOf, planInBatches } from '../shared/filing'
import './ai.css'
import { type AiCmd, type Ctx, tagsOf, whereCtx } from '../shared/ai-cmds'
import type { DiffSource } from '../shared/diff'
import { videoOf } from '../shared/video'
import { vaultFiles } from './files/store'
import { boardSelection } from './doc-board/selection'
import { openCmdEditor } from './commands/editor'
import { onRunIn, takeRun } from './commands/handoff'
import { addProposal, removeProposal } from './commands/proposals'
import { failed, type RunEnv, runBookThemes, runLinks, runOcr, runOwn, runPlan, runQuiz, runSplit, runTodo, runVideoKeys, runVideoText, runWeek } from './commands/run'
import { bodyChars, sectionNames } from '../shared/cmd-run'
import { useSlash } from './commands/SlashMenu'
import { useAiCmds } from './commands/store'
import {
  articlePrompt,
  askPrompt,
  COMMANDS,
  draftPath,
  draftText,
  dreamSummary,
  TIDY_BOARD,
  summaryPrompt,
  system,
  today,
  translatePrompt,
  translateText,
  withSummaryCard,
} from './ai-commands'
import { GROUPS } from './dream/useDream'
import { dreamDoes } from '../shared/dream-settings'
import { pickLabel, withoutEffort } from '@cn/ai-engines/shared'
import { withKeys } from './keys'
import { hideToolMarkup } from '../shared/tool-markup'
import type { NoteDoc, ViewMode } from './note-doc'
import type { Tab } from './tabs'
import { type NoteKind, type NoteTarget } from '../shared/ai-note'
import { safeName } from '../shared/file-name'
import { setNoteSwitch, useNoteSwitch } from './ai-note-switch'
import { NotedLine, RecChip } from './ai-note-ui'
import { askable, forgetNoted, mainAsk, notable, noteOne, refreshNoted, unnote, useNoted } from './ai-note-chat'
import { pageDest, showAskIn, webNoteTo } from './web-notes/flow'
import { dirLabel } from './web-notes/target'
import { NoteTip, TargetMenu } from './ai-note-target'
import { anchorOf, type PopAnchor } from './pop-place'
import { ipcOn } from './crash/ipc'

type Msg = C.Msg
type Action = NonNullable<Msg['actions']>[number]

type Change = NonNullable<StoredMsg['change']>

/** AI 那一格里的命令各用自己的图标（这一格整个都是 AI，引擎标志在输入框底行；同一条命令和 ⌘K 里同一个图标） */
const ICONS: Record<string, CodiconName> = {
  整理收件箱: 'inbox',
  整理当前白板: 'layers',
  总结这块白板: 'layout',
  写成文章: 'edit',
  翻译: 'whole-word',
  找重复: 'files',
  剪藏这一页: 'quote',
  现在梦游: 'wand',
}

let seq = Date.now()

/** 新加的 12 条自带命令里在 AI 对话里跑的（读 PDF 的三条在 reading/ 里），task-9womr */
const RUNNERS: Record<string, (env: RunEnv) => Promise<void>> = {
  截图转成文字: runOcr,
  补双链: runLinks,
  出几道自测题: runQuiz,
  拆成白板卡片: runSplit,
  白板排成计划: runPlan,
  计划拆成待办: runTodo,
  视频要点带时间: runVideoKeys,
  字幕整理成一篇: runVideoText,
  书摘按主题分节: runBookThemes,
  写这周的周记: runWeek,
  // 白板、文档操作条的「AI整理」（task-5ryf9）
  整理这几张: (env) => runTidy(env, 'board'),
  整理这几段: (env) => runTidy(env, 'doc'),
}

const lastSeg = (p: string) => p.split('/').pop() || p

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

export interface AiPanelProps {
  /** 这一格没开、或在读 PDF（格里是读 PDF 的 AI）：藏起来，不卸下（正在生成的那一轮不断） */
  hidden: boolean
  /** 这段对话是哪个地方的（头上胶囊写它的名字）：这里的，或者对话菜单里点开的别处的（nav.away） */
  place: Place
  /** 对话菜单、「这是在…问的 · 回到…」 */
  nav: DockNav
  /** 开着的这篇是书摘（「看得到」写「书摘：书名」） */
  digest: boolean
  tab: Tab | null
  mode: ViewMode
  doc(): NoteDoc | null
  notes: NoteFile[]
  webUrl: string | null
  /** 右栏开着网页 */
  webOpen: boolean
  /** AI 能操纵的网页（「看得到」每个一颗，写清在哪；能动手写默认操纵的那个，shared/web-pages.ts） */
  webPages: WebSeen[]
  /** 现在看的是什么（当前标签、右栏网页、选中的字），每一轮发给 AI */
  context(mentions: string[]): AgentContext
  onClose(): void
  onOpen(path: string): void
  onShowHistory(): void
  /** 在右栏打开梦游报告 */
  onShowDream(): void
  onChanged(): void
  /** AI 命令「先给你看」：在中间栏开对比标签、收下或不要以后关掉它（task-9womr） */
  onOpenDiff(src: DiffSource, title: string): void
  onCloseDiff(proposal: string): void
  /** 一打开就跑这条（seq 变了再跑一次） */
  autoRun?: { text: string; seq: number } | null
  /**
   * 文档里选字 ⌘J、右键「问 AI」：这段字成为输入框顶上那一排的第一块引用（src 是来源「《文档标题》」），光标在它后面，不自动发
   * （seq 变了再放一次；同一个标签再来一次换掉它，换了标签拿掉它）
   */
  draft?: { text: string; src: string; seq: number } | null
}

export function AiPanel(props: AiPanelProps) {
  const place = props.place
  // 每个地方各存各的对话（D 组 CN-132，ai-chats.ts）；不同地方的对话能同时答，同一段一次一问，超过上限排队（AI 对话同时跑）
  const { msgs, loaded, pick: ownPick, sides, noteTo, older } = C.useChat(place)
  /** 这段对话排着队：排第几个（发送键换成停下，输入框下面写「排在第 N 个 · 去看看」） */
  const queued = C.queuedAt(place.key)
  /** 这段对话正在答（或排着队）的那一问 */
  const running = C.runningAt(place.key)?.id ?? queued?.id ?? null
  /** 排着队时「去看看」去的那一段：最早开始答的 */
  const ahead = queued ? C.firstRunning() : null
  // 看着这段时它答完不记「没看」的点；看了就去掉
  useEffect(() => {
    C.setLooking(props.hidden ? null : place.key)
  }, [place.key, props.hidden])
  useEffect(() => () => C.setLooking(null), [])
  /** 输入框上面一行提示（「最多4张」、加图没成的原因），3 秒后收起 */
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const showNote = (t: string) => {
    setPasteNote(t)
    setTimeout(() => setPasteNote((x) => (x === t ? null : x)), 3000)
  }
  // 输入框的字和顶上那一排材料（第 2b 段，composer.tsx）
  const c = useComposer(showNote)
  const input = c.text
  const setInput = c.setText
  // 输入框有字、带着引用：换页时这段不算空着，不换走（AI 对话绑页面，AiDock）
  const drafting = !!input.trim() || c.mats.length > 0
  useEffect(() => {
    setDraft(place.key, drafting)
    return () => setDraft(place.key, false)
  }, [place.key, drafting])
  // 谁来答 · 模型 · effort（CN-91 方向 C）：模型和 effort 记在这个地方的对话里，没选过用设置 › AI「AI 对话」那一行
  // 一个 AI 都没接上（task-587os）：空对话里放三选一卡；接上以后卡留着到点「开始用」；发出去的那一问记着，开始用后接着发
  const [setup, setSetup] = useState(false)
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)
  const cp = useConvPick<AiPick, EngineInfo>(ownPick, (p) => C.setPick(place.key, p), showNote, () => setSetup(true))
  useEffect(() => {
    if (cp.none) setSetup(true)
  }, [cp.none])
  const engine = cp.pick.engine
  const engines = cp.engines
  /**
   * 这段对话里 @ 点名过的文档（发出去以后一直在「看得到」里、每一轮都交给 AI，开新对话清掉）；
   * 输入框里还没发的那几颗胶囊在 c.mentions。轮里读 ref：发出去的那一刻 state 还没画到
   */
  const [mentions, setMentions] = useState<string[]>([])
  const namedRef = useRef<string[]>([])
  namedRef.current = mentions
  const list = useRef<HTMLDivElement>(null)
  /** 这一格、对话那一块：在这段对话里找（⇧⌘F）焦点在这一格里（输入框也算）就归它，条摆在对话那一块右上角 */
  const cell = useRef<HTMLElement>(null)
  const msgsBox = useRef<HTMLDivElement>(null)
  const box = c.ta

  // 旁支（task-4edsc，方向 A「就地展开」）：回答里选一句「问这句」，就在那一段下面长出来；一句一个小标，数字是这一句开了几条
  const sideState = C.sideUi(place.key)
  const groups = new Map<number, ReturnType<typeof sideGroups<C.Side>>>()
  for (const msg of new Set(sides.map((s) => s.msg)))
    groups.set(
      msg,
      sideGroups(sides.filter((s) => s.msg === msg)),
    )
  const marks = new Map<number, Mark[]>([...groups].map(([msg, gs]) => [msg, gs.map((g) => groupMark(g, sideState.open))]))
  const openSide = sides.find((s) => s.id === sideState.open) ?? null
  const openGroup = openSide ? (groups.get(openSide.msg)?.find((g) => g.sides.includes(openSide)) ?? null) : null
  const host = useSideHost(list, openSide && openGroup ? { msg: openSide.msg, key: openGroup.key } : null)
  // 对话跟着最新的往下滚，人往上翻就停、滚回最底或点「↓ 新回答」再跟（@cn/ai-chat/follow）。
  // 开着旁支：对话不再自己滚到底（停在那条旁支上）
  const fol = useFollow(list, !!openSide)
  const pinned = fol.pinned
  if (openSide) pinned.current = false
  /** 对话目录里的旁支：问过的（和开着的那条），挂在它那一句的小标上 */
  const tocSides: TocSide[] = [...groups.values()].flat().flatMap((g) => g.sides.filter((x) => x.msgs.length || x.id === openSide?.id).map((x) => ({ id: x.id, name: sideName(x), group: g.key })))
  const asked = msgs.some((m) => m.role === 'user')
  /** 点小标：这一句开着的那条收起；没开着就打开这一句最后开的那条 */
  const toggleSide = (key: string) => {
    const g = [...groups.values()].flat().find((x) => x.key === key)
    if (!g) return
    if (g.sides.some((s) => s.id === sideState.open)) return C.showSide(place.key, null)
    C.showSide(place.key, g.sides[g.sides.length - 1]!.id)
  }
  // 回到主对话（文档里选字 ⌘J、右键「问 AI」带进来一块，跑一条 AI 命令）：旁支收起，主输入框回来
  const mainSeq = `${props.draft?.seq ?? 0}|${props.autoRun?.seq ?? 0}`
  const mainSeen = useRef(mainSeq)
  useEffect(() => {
    if (mainSeen.current === mainSeq) return
    mainSeen.current = mainSeq
    if (C.sideUi(place.key).open) C.showSide(place.key, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainSeq])
  // 刚收起的那一句：闪一下（原型 A）
  useLayoutEffect(() => {
    const f = sideState.flash
    if (!f) return
    const key = [...groups.values()].flat().find((g) => g.sides.some((s) => s.id === f.side))?.key
    if (key) flashMark(list.current, key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideState.flash?.seq])

  const notePath = props.tab?.type === 'note' ? props.tab.path : null
  const noteFile = props.notes.find((n) => n.path === notePath)
  const isBoard = !!noteFile?.board || props.mode === 'board'
  const inbox = props.notes.filter((n) => n.kind === 'inbox')
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? 'Claude Code'

  // ---------- 记笔记开关（2026-11-24 方向 A，shared/ai-note.ts）：看文档写进这篇本身，没开东西先问记进哪篇；带着网页引用的一问照网页的开关写进剪藏那篇 ----------
  /** 这段对话是一篇 md 文档的（看文档）：那篇；别的（首页、收件箱、文件夹……）是 null */
  const noteDoc = /^file:.+\.md$/i.test(place.key) ? place.key.slice(5) : null
  const noteKind: NoteKind = noteDoc ? 'doc' : 'none'
  const sw = useNoteSwitch(noteKind)
  /** 看文档没选过时记进哪篇：这篇本身（2026-11-24 偏好「剪藏和AI笔记同一篇」），插在光标处 */
  const noteDefault: NoteTarget | null = noteDoc ? { path: noteDoc, inline: true } : null
  /** 记进哪篇：这段对话选过的；没选过照上面；没开东西没选过是 null（拨开时先问） */
  const target: NoteTarget | null = noteTo ?? noteDefault
  /** 开着：开关开、有记进的那篇 */
  const noteOn = sw.main && !!target
  const sideNoteOn = sw.side && !!target
  const noted = useNoted(place.key)
  const [noteMenu, setNoteMenu] = useState<{ at: PopAnchor; anchor: HTMLElement; then?: 'on' | { one: number } } | null>(null)
  const [noteTip, setNoteTip] = useState<{ text: string; ok?: boolean; acts?: { label: string; primary?: boolean; onClick(): void }[]; seq: number } | null>(null)
  // 换了一段对话：上一段拨开关时那句提示（「记进《甲篇》」）不跟过来
  useEffect(() => setNoteTip(null), [place.key])
  const tipSeq = useRef(0)
  /** 提示一句；ms 给了几秒后自己收（中途关是 4 秒），带按钮的等点 */
  const tip = (text: string, o: { ok?: boolean; ms?: number; acts?: { label: string; primary?: boolean; onClick(): void }[] } = {}) => {
    const s = ++tipSeq.current
    setNoteTip({ text, seq: s, ...(o.ok ? { ok: true } : {}), ...(o.acts ? { acts: o.acts } : {}) })
    if (o.ms) setTimeout(() => setNoteTip((x) => (x?.seq === s ? null : x)), o.ms)
  }
  /** 「已记进」照笔记里认：这段对话记进过的几篇（现在的那篇、每一问发问时记着的那篇）问一遍 */
  const notePaths = [...new Set([target?.path, ...msgs.map((m) => m.noteAt?.path), ...sides.flatMap((s) => s.msgs.map((m) => m.noteAt?.path))].filter((x): x is string => !!x))]
  const notePathsSig = notePaths.join('\n')
  useEffect(() => {
    if (!loaded || !notePaths.length) return
    refreshNoted(place.key, notePaths).catch((e: unknown) => console.error('认记过的问失败', e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.key, loaded, notePathsSig])
  /** 没开东西时「收件箱新建一篇」：收件箱里「和 AI 聊：<头一问>」（还没问是对话名），撞名加「 2」 */
  const inboxTarget = (): NoteTarget => {
    const first = msgs.find((m) => m.role === 'user' && m.text?.trim())?.text?.replace(/\s+/g, ' ').trim()
    const name = noteName((first ?? place.label).replace(/[？?。！!，,、；;：:]+$/u, ''), 16)
    const title = safeName(`和 AI 聊：${name}`) // 不翻：文件名
    const have = new Set(props.notes.map((n) => n.path))
    let path = `${INBOX}/${title}.md`
    for (let n = 2; have.has(path); n++) path = `${INBOX}/${title} ${n}.md`
    return { path, create: { title: titleOf(path) } }
  }
  /** 前面答完了、能记、还没记的几问（主对话的回答编号，按先后） */
  const unnotedMain = () => msgs.flatMap((m, i) => (notable(m) && askable(msgs[i - 1]) && !noted.has(m.id) ? [m.id] : []))
  const unnotedSide = () => sides.flatMap((s) => s.msgs.flatMap((m, i) => (notable(m) && s.msgs[i - 1]?.role === 'user' && !noted.has(m.id) ? [m.id] : [])))
  const switchFail = (e: unknown) => tip(t('开关没存上：{why}', { why: errText(e) }), { ms: 4000 })
  /** 按先后补记进 to（补进去） */
  async function backfill(to: NoteTarget, ids: number[]) {
    setNoteTip(null)
    for (const id of ids) await noteOne(place.key, id, to, place.label)
    tip(t('补进去了，按问的先后排好'), { ok: true, ms: 3000 })
  }
  /** 开了（拨开、没开东西时选好了那篇）：前面有没记的问一句补不补 */
  function turnedOn(to: NoteTarget) {
    if (!sw.main) setNoteSwitch(noteKind, { ...sw, main: true }).catch(switchFail)
    const miss = unnotedMain()
    if (miss.length)
      tip(t('前面 {n} 问没记', { n: miss.length }), {
        acts: [
          { label: t('补进去'), primary: true, onClick: () => void backfill(to, miss) },
          { label: t('只记以后的'), onClick: () => setNoteTip(null) },
        ],
      })
    else tip(t('之后答一条记一条，记进《{name}》', { name: noteName(titleOf(to.path), 18) }), { ok: true, ms: 3500 })
  }
  /** 弹「记进哪篇」：贴着输入框下面那一排的「《…》▾」（⋯ 里点的也弹在这里） */
  function openNoteMenu(el: HTMLElement | null, then?: 'on' | { one: number }) {
    const anchor = el ?? list.current?.closest('aside')?.querySelector<HTMLElement>('[data-testid="ai-note-target"]') ?? null
    if (!anchor) return
    setNoteMenu((m) => (m && m.anchor === anchor && !then ? null : { at: anchorOf(anchor), anchor, ...(then ? { then } : {}) }))
  }
  function pickNoteTarget(to: NoteTarget) {
    const then = noteMenu?.then
    setNoteMenu(null)
    // 看文档选回默认的那篇就是没选过
    C.setNoteTo(place.key, noteDefault && to.path === noteDefault.path ? null : to)
    if (then === 'on') turnedOn(to)
    else if (then) void noteOne(place.key, then.one, to, place.label)
    else if (sw.main) tip(t('之后答一条记一条，记进《{name}》', { name: noteName(titleOf(to.path), 18) }), { ok: true, ms: 3500 })
  }
  function toggleNoteMain() {
    if (noteOn) {
      setNoteSwitch(noteKind, { ...sw, main: false }).catch(switchFail)
      const done = msgs.filter((m) => noted.get(m.id)?.state === 'done').length
      tip(done ? t('之后的不记了；已记的 {n} 问留在《{name}》里', { n: done, name: noteName(titleOf(target!.path), 18) }) : t('之后的不记了'), { ms: 4000 })
      return
    }
    if (!target) return openNoteMenu(null, 'on')
    turnedOn(target)
  }
  function toggleNoteSide() {
    const next = !sw.side
    setNoteSwitch(noteKind, { ...sw, side: next }).catch(switchFail)
    const miss = next && target ? unnotedSide() : []
    if (miss.length)
      tip(t('前面 {n} 条旁支没记', { n: miss.length }), {
        acts: [
          { label: t('补进去'), primary: true, onClick: () => void backfill(target!, miss) },
          { label: t('只记以后的'), onClick: () => setNoteTip(null) },
        ],
      })
    else tip(next ? t('之后开的旁支也记，挂在被问那条下面') : t('之后的旁支不记'), { ms: 3000 })
  }
  /** 回答下面 ⋯ 最前面那一项：记了的「从《…》拿掉」，没记的「记进《…》」（开关关着也能单记这一条，没目标先问记进哪篇） */
  function noteItemFor(msg: number): AbMenuItem | null {
    const v = noted.get(msg)
    if (v?.state === 'done')
      return { id: 'note-out', icon: 'note', label: t('从《{name}》拿掉', { name: noteName(v.to, 12) }), tip: t('只拿掉这一问写进去的那几行'), onClick: () => void unnote(place.key, msg) }
    if (v?.state === 'writing' || !mainAsk(place.key, msg)) return null
    if (!target) return { id: 'note-in', icon: 'note', label: t('记进笔记…'), tip: t('先选记进哪篇，再记这一条'), onClick: () => openNoteMenu(null, { one: msg }) }
    return { id: 'note-in', icon: 'note', label: t('记进《{name}》', { name: noteName(titleOf(target.path), 12) }), tip: t('只记这一条，开关关着也能记'), onClick: () => void noteOne(place.key, msg, target, place.label) }
  }

  useEffect(() => {
    if (!props.hidden) box.current?.focus()
  }, [props.hidden])
  // 左栏选了好几个交给 AI（task-0tgz2，ai-pick.ts）：「看得到」写「选中的N个」，问候和快捷命令换成好几篇的，每一轮交给 AI
  const picked = usePicked()
  const pickedNow = useRef(picked)
  pickedNow.current = picked
  const knownFiles = useKnownFiles()
  const pickList = useMemo(() => (picked ? pickedFiles(picked.items, knownFiles) : []), [picked, knownFiles])
  // 白板框选的几张、文档拖选的几块（task-5ryf9）：只在那一篇开着时算
  const cardPick = useCardPick()
  const cardsHere = cardPick && props.tab?.type === 'note' && props.tab.path === cardPick.path ? cardPick : null
  // 点了「问AI」（左栏多选、操作条）输入框拿到焦点：右栏本来就开着时上面那条（开合时聚焦）不跑
  useEffect(() => {
    if ((picked || cardsHere) && !props.hidden) box.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, cardsHere])
  const draftSeq = useRef(0)
  // 文档里带进来的那一块跟着那个标签：换了标签就拿掉它（和它在字里的编号），自己接着打的问题留着，不拿上一篇的话问这一篇
  useEffect(() => {
    c.dropDocQuotes(props.tab?.id ?? null)
    // 左栏选了好几个「问AI」也跟着那时的标签：换了标签就拿掉（task-0tgz2）
    if (pickedNow.current && pickedNow.current.tab !== (props.tab?.id ?? null)) dropPicked()
    if (cardPick && !(props.tab?.type === 'note' && props.tab.path === cardPick.path)) dropCards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tab?.id])
  useEffect(() => {
    const d = props.draft
    if (!d || d.seq === draftSeq.current) return
    draftSeq.current = d.seq
    // 成为第一块引用，光标在它后面；已经打了的问题留着（在编号后面），同一个标签里再来一次换掉这一块
    c.add({ kind: 'quote', text: d.text.trim().slice(0, 20_000), src: d.src }, { doc: { tab: props.tab?.id ?? null } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draft?.seq])
  // 网页上点了「引用」「讲解一下」进的是这段（ai-web-stay.ts，偏好「引用留在当前对话」）：引用成为输入框顶上的一块、光标进去；
  // 讲解一下带着这块直接问。输入框里已经有字、有材料，或 AI 还在答：这块照样放进输入框，不替你发（不冲掉打了一半的）
  const feed = useFeed()
  useEffect(() => {
    if (!feed || feed.key !== place.key || !loaded || props.hidden) return
    feedDone(feed.seq)
    if (feed.ask && !c.text.trim() && !c.mats.length && !C.busyAt(place.key) && !cp.none) return void run(feed.ask, [feed.mat])
    c.add(feed.mat)
    if (feed.ask) showNote(t('这段放进输入框了，回车问'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.seq, place.key, loaded, props.hidden])
  const ranSeq = useRef(0)
  useEffect(() => {
    const a = props.autoRun
    if (!a || a.seq === ranSeq.current || !loaded) return
    ranSeq.current = a.seq
    void run(a.text)
  }, [props.autoRun?.seq, loaded])
  // 新的字、进度出来：跟着就滚到底（格子变高变矮、字排出来变长也照这样，在 useFollow 里）
  useEffect(() => fol.stick(), [msgs])
  // 换了地方、收起又打开：从最新那一轮看起
  useLayoutEffect(() => {
    if (props.hidden) return
    fol.follow()
  }, [props.hidden, place.key])

  /** 文件夹首页（剪藏的一个主题也是一个文件夹）：这个文件夹 */
  const folder = props.tab?.type === 'folder' ? props.tab.folder : props.tab?.type === 'topic' ? `${CLIPS}/${props.tab.topic}` : null

  // ---------- 菜单 ----------
  // / 菜单（task-9womr）：这里能用的全列出来，「我的命令 / 这一篇 / 整个库」，固定高度能滚（commands/SlashMenu.tsx）
  const webCtx: Ctx | null = props.webOpen && props.webUrl ? (videoOf(props.webUrl) ? 'video' : 'web') : null
  const pageCtx: Ctx = notePath ? (isBoard ? 'board' : props.digest ? 'book' : 'doc') : folder !== null ? 'folder' : 'none'
  const { mine, slash: slashCfg } = useAiCmds()
  /** 自己的命令里在这里能用、没藏起的（输入框上面那排小按钮竖线后面那几颗） */
  const mineHere = mine.filter((m) => !slashCfg.hidden.includes(m.id) && whereCtx(m.where).some((x) => x === pageCtx || x === webCtx))
  const sl = useSlash({
    text: input,
    here: webCtx === 'video' ? 'video' : pageCtx,
    also: [pageCtx, ...(webCtx ? [webCtx] : [])],
    engine,
    onRun: (it) => (setInput(''), void (it.mine ? runOwnCmd(it.mine) : run('/' + it.name))),
    onClose: () => setInput(''),
    onEdit: (cmd) => openCmdEditor({ kind: 'edit', cmd, who: cp.label, engine, pick: { engine, ...cp.req } }),
    onCopy: (builtin) => openCmdEditor({ kind: 'copy', builtin, who: cp.label, engine, pick: { engine, ...cp.req } }),
  })
  /**
   * @ 候选（@文档胶囊）：自己写的文档和白板、剪来的网页、库里的 PDF 和 HTML，名字里有打的那几个字；名字打头的排前面。
   * 已经点过的（这段对话里发过的、输入框里那几颗）不再列。/ 菜单开着时没有
   */
  const findAt = (q: string): AtItem[] => {
    if (sl.open) return []
    const lq = q.toLowerCase()
    const md: AtItem[] = props.notes
      .filter((n) => n.kind !== 'inbox')
      .map((n) => ({ path: n.path, title: titleOf(n.path), ...(n.board ? { kind: 'board' as const, sub: t('白板 · {n}张卡片', { n: n.board.cards }) } : n.kind === 'clip' ? { kind: 'web' as const, sub: t('剪藏的网页') } : { kind: 'doc' as const, sub: t('文档') }) }))
    const other: AtItem[] = files.flatMap((f): AtItem[] => {
      const name = f.path.split('/').pop()!
      return f.kind === 'pdf' ? [{ path: f.path, title: name.replace(/\.pdf$/i, ''), kind: 'pdf', sub: 'PDF' }] : f.kind === 'html' ? [{ path: f.path, title: name.replace(/\.html?$/i, ''), kind: 'html', sub: 'HTML' }] : []
    })
    const hits = [...md, ...other].filter((x) => x.title.toLowerCase().includes(lq) && !mentions.includes(x.path))
    return [...hits.filter((x) => x.title.toLowerCase().startsWith(lq)), ...hits.filter((x) => !x.title.toLowerCase().startsWith(lq))]
  }

  /**
   * 空对话输入框上面那排快捷命令（task-0tgz2）：这一页用得上的 / 命令（ai-greet.ts 的 quickCmds），点了就是选了那条；
   * 文件夹页照小样给这个文件夹的（总结、挪进来、照上一篇开一篇，folder-ai.ts），做不到的不放；右栏开着网页时「剪藏这一页」排第一
   */
  function quickItems(folder: string | null): Quick[] {
    // 左栏选了好几个：好几篇用得上的（点了就是发那一问，是哪几篇跟着「看得到」交给 AI）
    if (picked) return MULTI.map((m) => ({ text: m.text, icon: m.icon, tip: m.ask, go: () => void run(m.ask) }))
    // 白板、文档里选中的几样（task-5ryf9，原型右栏那一排）
    if (cardsHere) {
      const qs = cardsHere.where === 'board' ? [t('总结这几张'), t('出几道题'), t('画成导图'), t('它们有什么联系')] : [t('讲一讲这几块'), t('出几道题'), t('改写得更清楚'), t('画成导图')]
      return qs.map((q) => ({ text: q, icon: 'comment-discussion' as const, tip: q, go: () => void run(q) }))
    }
    const web = !!(props.webOpen && props.webUrl)
    const cmd = (name: string): Quick => ({
      text: name,
      icon: ICONS[name] ?? 'comment-discussion',
      tip: `/${name} · ${COMMANDS.find((c) => c.name === name)?.desc ?? ''}`,
      go: () => void run('/' + name),
    })
    // 自己存的命令接在一道竖线后面（task-9womr；放不下的收进「⋯」，在那里也在一道横线后面）
    const own = mineHere.map((m): Quick => ({ text: m.name, icon: 'bookmark', own: true, tip: `自己存的命令：/${m.name} · ${m.desc}`, go: () => void runOwnCmd(m) }))
    if (folder === null) return [...quickCmds(props.tab, { web, board: isBoard, inbox: inbox.length }).map(cmd), ...own]
    return [...(web ? [cmd('剪藏这一页')] : []), ...folderSugs(folder, props.notes, today()).map((s) => ({ text: s.text, icon: s.icon, go: () => void runFolder(folder, s) })), ...own]
  }

  // ---------- 跑命令 ----------
  // 加进这一轮开始时那个地方的对话（答的时候换了页面也写回原处）；改一条按编号找，在哪个地方都一样
  const push = (m: Msg) => {
    fol.follow()
    C.update(place.key, (x) => [...x, { ...m, time: Date.now() }], place.label)
  }
  const patch = (id: number, p: Partial<Msg>) => C.patch(id, p)

  async function noteText(path: string): Promise<string> {
    const d = props.doc()
    if (d && d.path === path) return d.text
    return (await window.cn.readNote(path)).text
  }

  /**
   * 只聊天的命令：live 时边生成边显示。用输入框底行选的那一家、模型、想多久（task-0fhyo：以前 / 命令不读这一排，用的是命令行默认档）；
   * images：一起交给 AI 的库里的图
   */
  async function askAi(id: number, prompt: string, live: boolean, images?: string[]): Promise<string> {
    if (live) patch(id, { live: true, text: '' })
    try {
      return await window.cn.aiAsk(id, system(), prompt, { pick: { engine, ...cp.req }, ...(images?.length ? { images } : {}) })
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
      const did = lead.replace(/，提交没成功$/, '')
      // 自动提交抢先把 AI 改的收进去了：照实说，下面照样给「撤回」，只撤回那次里 AI 改的几个文件（第 6 轮）
      const taken = c && 'taken' in c ? c.taken : null
      patch(m.id, {
        warn: undefined,
        retry: undefined,
        tries: undefined,
        done: taken ? `${did}，已经由自动提交收进去了` : c ? `${did}，提交好了` : '没有要提交的改动了',
        ...(taken && m.retry
          ? { change: { commit: taken, kinds: m.retry.kinds, only: { paths: m.retry.paths, message: m.retry.message } } }
          : c && !('taken' in c) && m.retry
            ? { change: { commit: c, kinds: m.retry.kinds } }
            : {}),
      })
    } catch (e) {
      patch(m.id, { warn: `${lead}：第${tries}次也没提交上，${errText(e)}`, tries })
    }
    props.onChanged()
  }

  async function revert(id: number, c: Change) {
    try {
      const r = await window.cn.aiRevert(c.commit.hash, c.only)
      if (r) patch(id, { change: { ...c, reverted: r } })
      props.onChanged()
    } catch (e) {
      patch(id, { error: errText(e) })
    }
  }

  // 文档里点了「回到 AI 对话」（task-83vl3）：这段对话读进来、格子露出来以后滚到那条回答，闪一下；那条没了（点过新对话）说一句
  const jump = useChatJump()
  useEffect(() => {
    if (!jump || jump.key !== place.key || !loaded || props.hidden) return
    const el = list.current?.querySelector<HTMLElement>(`[data-msg="${jump.msg}"]`)
    jumpDone(jump.seq)
    if (!el) return app().notice('这段对话里找不到那条回答了（点过「新对话」）')
    pinned.current = false
    el.scrollIntoView({ block: 'center' })
    el.classList.remove('jumped')
    void el.offsetWidth
    el.classList.add('jumped')
    setTimeout(() => el.classList.remove('jumped'), 1600)
  }, [jump, place.key, loaded, props.hidden])

  // 读 PDF、看视频那一格里打的整个库的命令：换到这段对话来跑（commands/handoff.ts）
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    const go = () => {
      if (!loaded || props.hidden) return
      const t = takeRun(place.key)
      if (t) void runRef.current(t)
    }
    go()
    return onRunIn(go)
  }, [place.key, loaded, props.hidden])

  /** 跑命令要的（commands/run.ts）：往这条回答里写、问 AI（输入框选的那一家）、写进文件一次提交、先给你看 */
  function runEnv(id: number): RunEnv {
    return {
      patch: (p) => patch(id, p),
      ask: (prompt, o) => askAi(id, prompt, false, o?.images),
      change: (change, kinds) => applyChange(id, change, kinds),
      notePath,
      noteText,
      notes: props.notes,
      files: vaultFiles,
      boardKey: () => (notePath ? boardSelection(notePath) : null),
      open: props.onOpen,
      today: today(),
      folder,
      by: withoutEffort(cp.label),
      propose: (p) => {
        const pid = `p${id}`
        const take = async () => {
          // AI 读完以后这一篇又改过：不拿旧的盖掉新打的字
          for (const f of p.files) if (f.before !== null && (await noteText(f.path)) !== f.before) return patch(id, { actions: [], warn: `「${titleOf(f.path)}」在 AI 改的时候又改过了，这次没写进去：再跑一次 /${p.name}` })
          removeProposal(pid)
          props.onCloseDiff(pid)
          let commit: CommitInfo | null
          try {
            commit = await applyChange(id, { message: p.message, writes: p.files.map((f) => ({ path: f.path, text: f.after, ...(f.before === null ? { create: true } : {}) })) }, p.kinds)
          } catch (e) {
            if (!(e instanceof CommitFailed)) throw e
            return patch(id, { actions: [], warn: `改好了，提交没成功：${e.message}`, retry: e.retry })
          }
          // 新建的那篇重名时主进程另存成「… 2」：回答、「打开」、改动块都照真写进去的那个（task-f4kf7：以前写的、打开的都是旧的那篇）
          const first = p.files[0]!
          const real = first.before === null ? (commit?.files.find((f) => f.path.endsWith('.md'))?.path ?? first.path) : first.path
          if (commit && real !== first.path) patch(id, { change: { commit, kinds: { ...p.kinds, [real]: p.kinds[first.path] ?? '新' } } })
          patch(id, { actions: real !== notePath ? [{ label: '打开', primary: true, run: () => props.onOpen(real) }] : [], done: `收下了，写进了「${titleOf(real)}」` })
        }
        const drop = () => {
          removeProposal(pid)
          props.onCloseDiff(pid)
          patch(id, { actions: [], done: '没收下，文件没动' })
        }
        addProposal({ id: pid, name: p.name, title: p.title, place: { key: place.key, label: place.label }, files: p.files, ...(p.warn ? { warn: p.warn } : {}), take, drop })
        const show = () => props.onOpenDiff({ kind: 'proposal', id: pid }, `${p.title} · /${p.name} 改的`)
        show()
        patch(id, {
          pending: false,
          // 少了整节、命令没说要删（task-1l29q）：回答上面一行红色 warning 说少了哪几节（人刚发完命令，眼睛在这边），按钮叫「照样收下」
          ...(p.warn ? { alert: `比原文少了${p.warn.lost.length}节（${sectionNames(p.warn.lost)}），命令里没说要删` } : {}),
          text: p.warn ? '改好了，先在中间看清：真要这样就点「照样收下」。' : `${p.lead ?? '改好了，'}摆在中间先给你看：收下才写进去。`,
          // 收不收那一套（task-eavzx）：看改动 ……… 不要 · 收下；实心的「收下」只在中间标签底下那一条（一屏一颗实心按钮），这颗描边
          actions: [
            { label: t('看改动'), kind: 'view', run: show },
            { label: t('不要'), kind: 'reject', run: drop },
            { label: p.warn ? t('照样收下') : t('收下'), kind: 'accept', run: take },
          ],
        })
      },
    }
  }

  /**
   * 快捷回复（task-eavzx，命令带 reply 的）：/ 菜单、⌘K、它的快捷键跑它，就是在这段对话里发那句（空照最新那条回答、你问的那句填好），
   * 和点回答下面那颗一样；不走 / 命令那一套（它不读文档、不改文件）
   */
  function replyText(cmd: AiCmd): string {
    const i = msgs.findLastIndex(plainAnswer)
    const q = i > 0 && msgs[i - 1]?.role === 'user' ? (msgs[i - 1]!.text ?? '') : ''
    return fillReply(sayOf(cmd), { answer: i >= 0 ? (msgs[i]!.text ?? '') : '', question: q }) || cmd.name
  }

  /** / 菜单里点了自己的命令（和自带的重名时也认得是哪一条） */
  async function runOwnCmd(cmd: AiCmd) {
    if (C.busyAt(place.key)) return
    if (cmd.reply) return void run(replyText(cmd))
    push({ id: seq++, role: 'user', text: '/' + cmd.name })
    const id = seq++
    push({ id, role: 'ai', pending: true })
    if (!(await waitTurn(id))) return
    try {
      await runOwn(runEnv(id), cmd, { web: !!(props.webOpen && props.webUrl) })
    } catch (e) {
      if (e instanceof CommitFailed) patch(id, { pending: false, warn: `改好了，提交没成功：${e.message}`, retry: e.retry })
      else patch(id, { pending: false, error: errText(e) })
    } finally {
      C.end(place.key)
    }
  }

  // 白板、文档顶上「整理好了 · 挪了N张卡 · 撤回」（ai-act-store.ts）：撤的就是这一轮这条消息的改动，在这里撤，消息跟着变「已撤回」
  useEffect(() => {
    const on = (e: Event) => {
      const { turn, commit } = (e as CustomEvent<{ turn: number; commit: string }>).detail
      const m = msgs.find((x) => x.id === turn)
      if (!m?.change || m.change.commit.hash !== commit) return
      e.preventDefault()
      if (!m.change.reverted) void revert(m.id, m.change)
    }
    window.addEventListener('cn:ai-undo', on)
    return () => window.removeEventListener('cn:ai-undo', on)
  })

  /**
   * 这一问开始答（AI 对话同时跑）：同时在答的到了上限就排队，轮到了再往下；排着时按了停下，这一问记成没发出去
   */
  async function waitTurn(id: number): Promise<boolean> {
    if (await C.begin({ id, key: place.key, label: place.label, engine })) return true
    patch(id, { pending: false, error: t('没开始答：排队时停下了') })
    return false
  }

  /** mats：这一句带的材料（输入框顶上那一排，多段引用方向 B）；「再问一次」这些只带字 */
  async function run(raw: string, mats: Material[] = [], o: { ready?: boolean } = {}) {
    // 只贴了图、字里除了编号没别的字：问「这张图讲的是什么」（同读 PDF，CN-24）
    const text = sendText(raw, mats)
    if ((!text && !mats.length) || C.busyAt(place.key)) return
    // 还没接 AI：不发，把上手卡顶上来；这一问记着，接上点「开始用」后接着发
    // ready：引导卡刚装好、登好 Claude Code（「没接 AI」那个状态要等主进程通知了才变）
    if (cp.none && !o.ready) {
      setSetup(true)
      if (text) setPendingAsk(text)
      setInput('')
      return
    }
    // 「/名字」是一颗快捷回复（⌘K、快捷键跑它也走这里）：发它那句
    const replyName = /^\/(\S+)$/.exec(text)?.[1]
    const replyCmd = replyName && !mats.length && !COMMANDS.some((c) => c.name === replyName) ? mine.find((m) => m.name === replyName && m.reply) : undefined
    if (replyCmd) return run(replyText(replyCmd))
    // / 命令只看字：材料留在输入框里
    const cmdLine = /^\//.test(text)
    const own = cmdLine ? [] : mats
    // 输入框里的那几颗胶囊（发的是输入框里的字时）：记在问的这条上（消息里照样画成胶囊），并进这段对话点名过的
    const named = !cmdLine && raw === c.text ? c.mentions : []
    if (named.length) {
      const all = [...namedRef.current, ...named.map((m) => m.path).filter((p) => !namedRef.current.includes(p))]
      namedRef.current = all
      setMentions(all)
    }
    if (own.length) c.clear()
    else setInput('')
    // 记笔记按发问这一刻的开关算（/ 命令不记）：开着就把记进哪篇记在问的这条上，答完照它写
    // 带着网页上引的一段、框的一块（偏好「引用留在当前对话」进了这段对话的）：网页的「记笔记」开着、定了记进哪篇时写进剪藏那篇
    const webUrl = own.find((m) => m.url && /^https?:/i.test(m.url))?.url
    const webTo = webUrl && !cmdLine ? webNoteTo(webUrl) : null
    const noteAt: NoteTarget | null = webTo ? { path: webTo, inline: true } : noteOn && !cmdLine ? target : null
    push({ id: seq++, role: 'user', text, ...(own.length ? { mats: own } : {}), ...(named.length ? { mentions: named } : {}), ...(noteAt ? { noteAt } : {}) })
    const id = seq++
    const cmd = /^\/(\S+)/.exec(text)?.[1]
    push({ id, role: 'ai', pending: true })
    // 找重复（大库要算十几秒）不占着对话：算的时候照样能发新问题，它在自己那条消息里报进度、能单独停下
    if (cmd === '找重复') return void findDuplicates(id)
    if (!(await waitTurn(id))) return
    try {
      // 新加的自带命令（task-9womr，commands/run.ts）；自己存的命令（打全名字也算，和自带的重名时自带的在前）
      const fresh = cmd ? RUNNERS[cmd] : undefined
      if (fresh) return await fresh(runEnv(id))
      const mineCmd = cmd && !COMMANDS.some((c) => c.name === cmd) ? mine.find((m) => m.name === cmd) : undefined
      if (mineCmd) return await runOwn(runEnv(id), mineCmd, { web: !!(props.webOpen && props.webUrl) })
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
        // 提交说明写命令名和白板名，不写交给 AI 的那一长串（task-9womr）
        return await agentTurn(id, TIDY_BOARD, [], `/整理当前白板 · ${titleOf(notePath)}`)
      }
      if (cmd === '现在梦游') return await dreamNow(id)
      if (cmd === '剪藏这一页') return await clipPage(id)
      if (cmd === '整理收件箱') return await tidyInbox(id)
      if (cmd === '总结这块白板' || cmd === '写成文章') {
        if (!notePath) return patch(id, { pending: false, error: '先打开一块白板或一篇笔记' })
        const body = await noteText(notePath)
        // 以前写法的白板数卡片行；新写法（「## 列名」）的白板列里的卡没有卡片行，按切出来的卡数
        const isBoardDoc = fmValue(body, 'type') === 'board'
        const cards = hasOldLayout(body) || !isBoardDoc ? (body.match(/^<!-- card /gm) ?? []).length : splitDoc(body).total
        // 空的先不问 AI（像白板排成计划那样，task-nphy3）：以前照样问，AI 回一句拒绝话，写成文章还拿它新建了一篇
        const what = cmd === '写成文章' ? '写不成文章' : '没什么可总结的'
        if (isBoardDoc && !cards && !bodyChars(body)) return patch(id, { pending: false, text: `这块白板上还没有卡，${what}。` })
        if (!isBoardDoc && !bodyChars(body)) return patch(id, { pending: false, text: `这篇还没有正文，${what}。` })
        const read = `读了 ${notePath}${cards ? ` · ${cards}张卡片` : ''}`
        patch(id, { read })
        if (cmd === '总结这块白板') {
          // 总结卡的头一行写是哪家、哪个模型（task-5yp97「AI 总结 · Claude Code · Opus 5.5」），照问的这一下选的记
          const by = pickLabel({ engine, ...(cp.pick.model ? { model: cp.pick.model } : {}) }, cp.engines.find((e) => e.id === engine)?.models)
          const reply = await askAi(id, summaryPrompt(notePath, body), true)
          const actions: Action[] = []
          if (fmValue(body, 'type') === 'board' || cards > 0) {
            actions.push({
              label: '存成卡片',
              primary: true,
              run: async () => {
                const cur = (await window.cn.readNote(notePath)).text
                const { text: next } = withSummaryCard(cur, reply, by)
                try {
                  // 提交说明和别的 / 命令一样「AI：/命令 · 对象」（task-gj0l0）
                  await applyChange(id, { message: `/总结这块白板 · ${titleOf(notePath)}`, writes: [{ path: notePath, text: next }] }, { [notePath]: '改' })
                } catch (e) {
                  if (!(e instanceof CommitFailed)) throw e
                  return patch(id, { actions: [], warn: `卡存好了，提交没成功：${e.message}`, retry: e.retry })
                }
                patch(id, { actions: [], done: /<!--\s*card\s[^>]*\b(in|w)=/.test(cur) ? '存到了白板左下角' : '存到了白板最左一组的最上面' })
              },
            })
          }
          patch(id, { pending: false, text: reply, actions })
        } else {
          const article = await askAi(id, articlePrompt(notePath, body), true)
          // AI 回的不是一篇文章（没有一个标题，多半是说写不成的话）：照实说它的话，不建文件（task-nphy3）
          if (!/^#{1,6}\s+\S/m.test(article)) return patch(id, { pending: false, text: undefined, ...failed('AI这次没写成文章，什么都没建。', article) })
          // 草稿写在白板旁边（白板在库最外层时进收件箱）；卡片和改动块写的是带文件夹的整条路径
          const want = draftPath(notePath)
          const draft = draftText(notePath, article)
          const commit = await applyChange(id, { message: `/写成文章 · ${titleOf(notePath)}`, writes: [{ path: want, text: draft, create: true }] }, {})
          const path = commit?.files.find((f) => f.path.endsWith('.md'))?.path ?? want
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
        // 没选：翻整篇的正文（属性、藏着的位置行不翻，task-n1ffi）
        const src = sel.trim() || (notePath ? translateText(await noteText(notePath)) : '')
        if (!notePath && !sel.trim()) return patch(id, { pending: false, error: '先在文档里选中一段，或者打开一篇笔记' })
        if (!src.trim()) return patch(id, { pending: false, text: '这篇还没有正文，没什么可翻的。' })
        patch(id, { read: sel.trim() ? `读了选中的${sel.length}个字` : `读了 ${notePath}` })
        const reply = await askAi(id, translatePrompt(src), true)
        patch(id, { pending: false, text: reply })
        return
      }
      await agentTurn(id, text, own)
      // 答完、没出错（noteOne 里再看一遍：出错、只有步骤没有字的不记）
      if (noteAt) void noteOne(place.key, id, noteAt, place.label)
    } catch (e) {
      if (e instanceof CommitFailed) patch(id, { pending: false, warn: `改好了，提交没成功：${e.message}`, retry: e.retry })
      else patch(id, { pending: false, error: errText(e) })
    } finally {
      C.end(place.key)
    }
  }

  /** 文件夹页的建议（D 组小样）：问的那句照原话进对话，下面是做的结果 */
  async function runFolder(folder: string, s: FolderSug) {
    if (C.busyAt(place.key)) return
    push({ id: seq++, role: 'user', text: s.text })
    const id = seq++
    push({ id, role: 'ai', pending: true })
    if (!(await waitTurn(id))) return
    try {
      if (s.kind === 'sum') await folderSum(id, folder)
      else if (s.kind === 'file') await fileIn(id, folder)
      else await newInFolder(id, folder)
    } catch (e) {
      if (e instanceof CommitFailed) patch(id, { pending: false, warn: `改好了，提交没成功：${e.message}`, retry: e.retry })
      else patch(id, { pending: false, error: errText(e) })
    } finally {
      C.end(place.key)
    }
  }

  /** 把这周的周记总结成三句话：周记读这周那篇，别的文件夹读最近改的几篇 */
  async function folderSum(id: number, folder: string) {
    const list = sumTargets(folder, props.notes)
    if (!list.length) return patch(id, { pending: false, text: '这个文件夹里还没有文档。' })
    const items = await Promise.all(list.map(async (n) => ({ path: n.path, text: await noteText(n.path) })))
    patch(id, { read: list.length === 1 ? `读了「${titleOf(list[0]!.path)}」` : `读了文件夹「${lastSeg(folder)}」${list.length}篇` })
    const reply = await askAi(id, folderSumPrompt(folder, items), true)
    patch(id, { pending: false, text: reply })
  }

  /** 收件箱里和这个文件夹有关的挪进来：AI 挑，列出来，你点同意才挪，一次提交可撤回 */
  async function fileIn(id: number, folder: string) {
    const name = lastSeg(folder)
    if (!inbox.length) return patch(id, { pending: false, text: '收件箱是空的，没有要挪的。' })
    const items = await Promise.all(inbox.map(async (n) => ({ path: n.path, text: (await window.cn.readNote(n.path)).text })))
    const have = props.notes.filter((n) => n.path.startsWith(folder + '/')).map((n) => titleOf(n.path)).slice(0, 50)
    const read = `读了收件箱${inbox.length}条`
    patch(id, { read })
    const paths = parseFileIn(await askAi(id, fileInPrompt(folder, items, have), false), inbox)
    if (!paths.length) return patch(id, { pending: false, text: `收件箱里没找到和${name}有关的，先都留着。` })
    patch(id, {
      pending: false,
      text: `和${name}有关的${paths.length}条，挪进「${folder}」：`,
      moves: paths.map((p) => ({ path: p, to: folder })),
      actions: [
        {
          label: '同意，挪过去',
          primary: true,
          run: async () => {
            const kinds: Record<string, string> = {}
            for (const p of paths) kinds[`${folder}/${p.split('/').pop()}`] = '移动'
            await applyChange(id, { message: `把收件箱里${paths.length}条挪进「${folder}」`, moves: paths.map((p) => ({ from: p, toFolder: folder })) }, kinds)
            patch(id, { actions: [], done: `挪好了${paths.length}条` })
          },
        },
      ],
    })
  }

  /** 照上周的样子开一篇：属性和小节照最新那篇，内容空着；开好就打开它（不问 AI） */
  async function newInFolder(id: number, folder: string) {
    const t = newTarget(folder, props.notes, today())
    if (!t) return patch(id, { pending: false, error: '认不出下一篇叫什么' })
    const from = titleOf(t.from.path)
    const text = skeleton(await noteText(t.from.path), from, t.name, today())
    // 没问 AI：提交说明不带「AI：」（task-9womr）
    const commit = await applyChange(id, { message: `照「${from}」开一篇「${t.name}」`, noAi: true, writes: [{ path: t.path, text, create: true }] }, {})
    const path = commit?.files.find((f) => f.path.endsWith('.md'))?.path ?? t.path
    if (commit) patch(id, { change: { commit, kinds: { [path]: '新' } } })
    patch(id, { pending: false, read: `照「${from}」的属性和小节`, text: `开好了「${titleOf(path)}」，内容空着等你写。` })
    props.onOpen(path)
  }

  /** 直接说的话：交给选好的引擎，它能用工具操纵网页、白板、文档；mats 是带的材料（字里的 ①② 照旧，后面按同一套编号列出每块，图叫「图②」，图一起附上） */
  async function agentTurn(id: number, text: string, mats: Material[] = [], subject?: string) {
    // 回答头上写全「Claude Code · Opus 5.5 · High」：这个对话这一问用的
    patch(id, { live: true, engine, text: '', by: cp.label })
    const ctx = {
      ...props.context(namedRef.current),
      ...(picked ? { picked: { count: picked.items.length, files: pickList } } : {}),
      ...(cardsHere ? { cards: { where: cardsHere.where, count: cardsHere.items.length, text: pickText(cardsHere) } } : {}),
    }
    const pasted = imageNames(mats)
    try {
      // 接着这个地方自己的会话（D 组 CN-132）；模型和 effort 是这个对话选的（CN-91）
      const r = await window.cn.aiTurn({
        id,
        engine,
        text,
        ...(subject ? { subject } : {}),
        context: ctx,
        place: { key: place.key, label: place.label },
        ...cp.req,
        ...(pasted.length ? { pasted } : {}),
        ...(mats.length ? { mats } : {}),
      })
      C.patch(id, (m) => ({
        ...m,
        pending: false,
        live: false,
        text: r.text || m.text || undefined,
        // 停下、中途断了：还转着圈的那一步不会再报做完，改成没做完（不然一直转）
        ...(r.error ? { error: r.error, ...(m.steps?.some((x) => x.status === 'run') ? { steps: m.steps.map((x) => (x.status === 'run' ? { ...x, status: 'err' as const, detail: '没做完' } : x)) } : {}) } : {}),
        ...(r.commit ? { change: { commit: r.commit, kinds: r.kinds, ...(r.only ? { only: r.only } : {}), ...(r.moved ? { moved: r.moved } : {}) } } : {}),
        // 这一轮的改动已经被别的提交带走了：照实说已经记进历史，下面照样能撤回（只撤这一轮的文件）
        ...(r.only ? { done: '改好了，已经记进历史了（和别的改动在同一次提交里）' } : {}),
        // 改好了、提交没成功（没署名、锁一直不放）：照实说，「再提交一次」只提交这一轮改的那几个文件
        ...(r.failed ? { warn: `改好了，提交没成功：${r.failed.failed}`, retry: { paths: r.failed.paths, message: r.failed.message, kinds: r.kinds } } : {}),
      }))
      if (r.commit || r.failed) props.onChanged()
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
    const off = ipcOn(window.cn.onDuplicatesProgress, 'cn.onDuplicatesProgress')((p) => {
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
    const does = dreamDoes((await window.cn.settings()).dream, 'zh')
    patch(id, { read: `正在梦游${does ? `：${does}` : ''}` })
    // 跟着输入框底行选的那一家、模型、想多久（task-0fhyo）
    const report = await window.cn.dreamNow({ webUrl: props.webUrl, pick: { engine, ...cp.req } })
    const s = dreamSummary(report, GROUPS)
    patch(id, { pending: false, read: undefined, text: s.text, dream: { items: s.items, groups: s.groups } })
  }

  /**
   * 剪藏这一页（不经 AI，和网页面板的引号按钮同一件事）：右栏开着的网页整页进收件箱，单独一次提交。
   * 回答和别的命令一样：一句剪到了哪、「打开」，下面「改了1个文件 · 撤回」（以前只回一行路径）
   */
  async function clipPage(id: number) {
    // 整页照剪藏去处：配对的那篇写进它末尾，选的文件夹新建在那里，都没有进收件箱（main/web 的 clipCurrentPage）
    const dest = props.webUrl && /^https?:/i.test(props.webUrl) ? pageDest(props.webUrl) : {}
    const { path, commit } = await window.cn.clipCurrentPage({ webUrl: props.webUrl, ...dest })
    props.onChanged()
    patch(id, {
      pending: false,
      text: dest.into ? t('整页写进《{title}》末尾了。', { title: titleOf(path) }) : `剪好了「${titleOf(path)}」，放在「${dirLabel(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')}」。`,
      actions: [{ label: '打开', primary: true, run: () => props.onOpen(path) }],
      ...(commit ? { change: { commit, kinds: { [path]: dest.into ? '改' : '新' } } } : {}),
    })
  }

  /**
   * /整理收件箱：和梦游同一套归法（shared/filing.ts，照这个库的分法：课程归到那门课，自己写的进周记、写作这些，剪来的进剪藏/<主题>），
   * 只挪不改名；拿不准的留在收件箱。不走梦游的分支：你点「同意」才挪，一次提交，能撤回。
   * 收件箱多的一批批问（一条消息一次只问一个）；AI 那头出错（没登录、停下）整条照常报错，后面几批不再问
   */
  async function tidyInbox(id: number) {
    if (!inbox.length) return patch(id, { pending: false, text: '收件箱是空的，没有要整理的。' })
    const entries = await Promise.all(inbox.map(async (n) => inboxEntry(n.path, (await window.cn.readNote(n.path)).text)))
    const read = `读了收件箱${inbox.length}条`
    patch(id, { read })
    const notes: string[] = []
    let failed: unknown = null
    const ask = async (prompt: string) => {
      if (failed) throw failed
      try {
        return await askAi(id, prompt, false)
      } catch (e) {
        failed = e
        throw e
      }
    }
    // 去处照这个库的分法（设置 › 梦游「这个库怎么分」，和梦游同一份）
    const places = placesOf(props.notes.map((n) => n.path), (await window.cn.dreamRoles()).rows)
    const plans = await planInBatches(entries, places, ask, (n) => notes.push(n), 'move', { parallel: 1 })
    if (failed) throw failed
    if (!plans.length && notes.length) throw new Error(notes.join('\n'))
    const stay = inbox.length - plans.length
    if (!plans.length) return patch(id, { pending: false, read, text: '这几条都没把握放哪，先留在收件箱。' })
    const moves = plans.map((p) => ({ path: p.path, to: p.folder }))
    patch(id, {
      pending: false,
      read,
      text: `挪${plans.length}条到下面这些地方${stay ? `，${stay}条拿不准留在收件箱` : ''}：${notes.length ? `\n\n${notes.join('\n')}` : ''}`,
      moves,
      actions: [
        {
          label: '同意，挪过去',
          primary: true,
          run: async () => {
            const kinds: Record<string, string> = {}
            for (const m of moves) kinds[`${m.to}/${m.path.split('/').pop()}`] = '移动'
            // 提交说明和别的 / 命令一样「AI：/命令 · 对象」（task-gj0l0）
            await applyChange(id, { message: `/整理收件箱 · ${moves.length}条`, moves: moves.map((m) => ({ from: m.path, toFolder: m.to })) }, kinds)
            patch(id, { actions: [], done: `挪好了${moves.length}条` })
          },
        },
      ],
    })
  }

  /**
   * 动手做了几步才断的那一轮（停下、中途退出）：写做完的最后一步（停下时掐断的那步不算，它自己写着没做完），
   * 最后一条给「接着做」（接着同一个会话，主进程没答完也记下了会话号）。
   * 一步没做、一个字没说就出错的（没登录、网络断了）照旧是「再问一次」
   */
  function cutOf(m: Msg, last: boolean): { cut?: { at: { label: string; code?: string } | null; onContinue?(): void } } {
    if (!m.engine || (!m.steps?.length && !m.text?.trim())) return {}
    const s = m.steps?.filter((x) => x.status === 'ok').pop()
    return { cut: { at: s ? { label: s.label, ...(s.code ? { code: s.code } : {}) } : null, ...(last && !C.busyAt(place.key) ? { onContinue: () => void run('接着做') } : {}) } }
  }

  /** 回答下面一颗按钮点了：提交没成功、出错写在这条回答上 */
  function runAction(id: number, a: Action) {
    void Promise.resolve(a.run()).catch((e) => patch(id, e instanceof CommitFailed ? { actions: [], warn: `改好了，提交没成功：${e.message}`, retry: e.retry } : { error: errText(e) }))
  }

  /** 收不收那一套（命令结果、AI整理，task-eavzx）：看改动 ……… 不要 · 收下；中间对比标签底下已有实心的，这颗描边 */
  function changeBar(m: Msg) {
    const of = (k: 'view' | 'reject' | 'accept') => m.actions?.find((a) => a.kind === k)
    const accept = of('accept')
    const reject = of('reject')
    if (!accept || !reject) return null
    const view = of('view')
    return (
      <ChangeBar
        testId="ai-change-bar"
        {...(view ? { view: { label: view.label, onClick: () => runAction(m.id, view) } } : {})}
        reject={{ label: reject.label, onClick: () => runAction(m.id, reject) }}
        accept={{ label: accept.label, onClick: () => runAction(m.id, accept) }}
      />
    )
  }

  /**
   * AI 停下等用户点头（网页上提交、登录、付款、上传；偏好「等点头给两颗按钮」）：最后那条回答下面那排换成「不要 · 可以，上传」，
   * 点了等于回一句（「可以，…」AI 接着做那一步，「不要」AI 不做、说一声）；自己打字回照旧。用户回过话、正在答时不出
   */
  function askBar(m: C.Msg, i: number) {
    if (i !== msgs.length - 1 || m.pending || m.live || running !== null) return null
    const risk = m.steps?.findLast((s) => s.status === 'ask')?.risk
    if (!risk) return null
    const yes = { submit: t('可以，提交'), login: t('可以，登录'), pay: t('可以，付款'), upload: t('可以，上传') }[risk]
    const no = t('不要', { ctx: '等点头' })
    return <ChangeBar testId="ai-ask-bar" solid reject={{ label: no, onClick: () => void run(no) }} accept={{ label: yes, onClick: () => void run(yes) }} />
  }

  /** Claude Code 没登录、没装、装了运行不了（首次问AI引导登录）的那一轮：回答处换成引导卡 */
  function loginCode(m: Msg, i: number) {
    if (!m.error || msgs[i - 1]?.role !== 'user' || !msgs[i - 1]!.text || (m.engine ?? engine) !== 'claude' || cutOf(m, false).cut) return null
    const code = aiErrorCode(m.error)
    return code === 'not-logged-in' || code === 'not-installed' || code === 'broken' ? code : null
  }

  /** 没答出来那一块（AiError）：出错的那一轮、它前面那句问话（「再问一次」「换个问法」用） */
  function errorOf(m: Msg, i: number) {
    const ask = msgs[i - 1]?.role === 'user' ? msgs[i - 1]! : undefined
    const q = ask?.text
    // 登好把这一问和这条出错的拿掉，刚才那句接着发（像从没出过错）
    const code = loginCode(m, i)
    if (ask && q && code)
      return (
        <LoginCard
          mode={code === 'not-installed' ? 'install' : code === 'broken' ? 'repair' : 'login'}
          live={i === msgs.length - 1}
          onSwitch={openEnginePick}
          onDone={() => {
            if (C.busyAt(place.key)) return
            C.update(place.key, (all) => all.filter((x) => x.id !== ask.id && x.id !== m.id))
            void run(q, ask.mats ?? [], { ready: true })
          }}
        />
      )
    return (
      <AiError
        raw={m.error!}
        engine={{ id: m.engine ?? engine, label: engines.find((e) => e.id === (m.engine ?? engine))?.label }}
        {...cutOf(m, i === msgs.length - 1)}
        {...(q && !C.busyAt(place.key)
          ? {
              onRetry: () => void run(q),
              onRephrase: () => {
                setInput(q)
                requestAnimationFrame(() => box.current?.focus())
              },
            }
          : {})}
      />
    )
  }

  /**
   * 旁支里问一句（空着是「讲讲这句」）：第一问从这个地方主对话的会话分叉，之后接着旁支自己的会话；旁支的问答和主对话分开存，
   * 不往主对话里加东西。输入框下面「旁支」开着（发问那一刻）就记进这段对话记进的那篇，挂在被问那一问后面
   */
  async function sendSide(id: string, text: string, mats: Material[]) {
    const side = C.chatOf(place.key).sides.find((s) => s.id === id)
    if (!side || C.sideRunning(id) !== undefined) return
    const q = text.trim() || (side.msgs.some((m) => m.role === 'user') ? '' : ASK_THIS)
    if (!q) return
    const uid = ++seq
    const aid = ++seq
    const now = Date.now()
    const noteAt = sideNoteOn ? target : null
    C.updateSides(place.key, (all) => all.map((s) => (s.id === id ? { ...s, msgs: [...s.msgs, { id: uid, role: 'user', text: q, time: now, ...(mats.length ? { mats } : {}), ...(noteAt ? { noteAt } : {}) }, { id: aid, role: 'ai', text: '', time: now, pending: true, live: true, engine, by: cp.label }] } : s)))
    C.setSideRunning(id, aid)
    // 被问的那一轮：那条回答和它前面那一问（分叉不了时放在第一问前面）
    const all = C.chatOf(place.key).msgs
    const i = all.findIndex((m) => m.id === side.msg)
    const answer = all[i]?.text ?? ''
    const ask = all
      .slice(0, Math.max(0, i))
      .reverse()
      .find((m) => m.role === 'user')?.text
    const pasted = imageNames(mats)
    try {
      const r = await window.cn.aiSide({
        id: aid,
        engine,
        place: { key: place.key, label: place.label },
        text: q,
        side: { id, quote: side.quote, ...(ask ? { ask } : {}), history: `【那一轮】\n${ask ? `他问：${ask}\n` : ''}你答：${answer.slice(0, 3000)}` },
        context: props.context(namedRef.current),
        ...cp.req,
        ...(pasted.length ? { pasted } : {}),
        ...(mats.length ? { mats } : {}),
      })
      C.patch(aid, (m) => ({ ...m, pending: false, live: false, text: r.text || m.text || '', ...(r.error ? { error: r.error } : {}), ...(r.commit ? { change: { commit: r.commit, kinds: r.kinds, ...(r.only ? { only: r.only } : {}), ...(r.moved ? { moved: r.moved } : {}) } } : {}), ...(r.only ? { done: '改好了，已经记进历史了（和别的改动在同一次提交里）' } : {}) }))
      if (r.commit || r.failed) props.onChanged()
      if (noteAt && !r.error) void noteOne(place.key, aid, noteAt, place.label)
    } catch (e) {
      C.patch(aid, { pending: false, live: false, error: errText(e) })
    } finally {
      C.setSideRunning(id, null)
    }
  }

  function stop() {
    if (running === null) return
    // 排着队：不排了（还没开始答，什么都没做）
    if (C.cancelQueued(place.key)) return
    void window.cn.aiStop(running)
    void window.cn.aiTurnStop(running)
  }

  /** 新对话：这个地方的对话清掉（会话号一起清） */
  function newChat() {
    void C.shelve(place.key)
    forgetNoted(place.key)
    setNoteTip(null)
    setMentions([])
  }

  // ---------- 存成命令（方向 C：照这几轮前后的对比提炼） ----------
  /** 这段对话是一篇笔记的，AI 在这几轮里改过它（没撤回的）：能存成命令 */
  const filePath = place.key.startsWith('file:') ? place.key.slice(5) : null
  const aiTurns = filePath ? msgs.filter((m) => m.role === 'ai' && m.change && !m.change.reverted && m.change.commit.files.some((f) => f.path === filePath)) : []
  const savedCmd = mine.find((m) => m.from?.place === place.key)
  const canSave = !!filePath && aiTurns.length > 0 && running === null && !props.nav.away
  // 答完才出的那一行（存成命令、存成了）：停在最底下的跟着滚到它
  useEffect(() => {
    if (canSave) fol.stick()
  }, [canSave, savedCmd?.id])

  function openSave(edit?: AiCmd) {
    if (!filePath || !aiTurns.length) return
    const ask = (m: Msg) => {
      const i = msgs.indexOf(m)
      return msgs
        .slice(0, i)
        .reverse()
        .find((x) => x.role === 'user')?.text ?? ''
    }
    const from = msgs.indexOf(aiTurns[0]!)
    const asks = msgs.slice(Math.max(0, from - 1)).filter((m) => m.role === 'user' && m.text).map((m) => m.text!)
    const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
    openCmdEditor({
      kind: 'chat',
      place: { key: place.key, label: place.label },
      path: filePath,
      title: titleOf(filePath),
      asks,
      commits: aiTurns.map((m) => ({ hash: m.change!.commit.hash, ask: ask(m), files: m.change!.commit.files.map((f) => ({ path: f.path, added: f.added, removed: f.removed })) })),
      firstHash: aiTurns[0]!.change!.commit.hash,
      rounds: aiTurns.length,
      // 举例就拿正在看的这一篇（之前拿同一个文件夹里的另一篇，用户看不懂为什么是别的书，task-ne7cw）
      example: { title: titleOf(filePath), folder: dir },
      who: cp.label,
      engine,
      pick: { engine, ...cp.req },
      ...(edit ? { edit } : {}),
    })
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 输入法还在组字：这一下是输入法的（Safari 那种组字结束的回车 keyCode 229 也算，ime.ts）
    if (composing(e)) return
    if (sl.onKey(e)) return
    // @ 候选的 ↑↓、Tab、↵、esc 在输入框里先接了（@cn/ai-chat 的 AiInput at）
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void run(input, c.plain())
    } else if (e.key === 'Escape') {
      props.onClose()
    }
  }

  // 看得到（D 组 CN-132）：这一页（文件夹页「文件夹：周记 · 1篇」、首页「首页」……不再写「没打开笔记」），右栏开着网页再多一颗网页，@ 点名的笔记
  const files = useKnownFiles()
  const count = useMemo(() => (folder === null ? 0 : folderCount(folder, files)), [folder, files])
  const seen = seenOf(props.tab, { board: isBoard, digest: props.digest, inbox: inbox.length, count: () => count })
  // 网页（右栏、中间分屏的另一格）各一颗，写清在哪；中间开着的网页是「这一页」那颗。默认操纵的那个写在「能动手」里
  const webTab = props.tab?.type === 'web' ? props.tab.id : null
  const webSees = props.webPages
    .filter((p) => p.url && p.key !== webTab)
    .map((p) => ({ label: t('{where}网页：{host}', { where: t(WEB_PAGE_SAID[p.page]), host: hostOf(p.url) }), title: [t(WEB_PAGE_SAID[p.page]), p.title, p.url].filter(Boolean).join(' · ') }))
  const webHand = props.webPages.find((p) => p.default)
  // 问候放不下时一级级收：先藏标志和那一行问候，再不行整个不画（按这一格实际放不放得下量：那一句有一行有两行）；
  // 底下那排快捷命令不在消息区里，一直在
  const empty = loaded && msgs.length === 0
  const emptyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = emptyRef.current
    const box = list.current
    if (!el || !box) return
    // 问候靠底排（justify-content: flex-end），放不下时是往上漫出去、不算进 scrollHeight：直接比问候和消息区里面的高
    const fit = () => {
      const cs = getComputedStyle(box)
      const room = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      for (const level of [[], ['tight1'], ['tight2']]) {
        el.classList.remove('tight1', 'tight2')
        el.classList.add(...level)
        if (el.offsetHeight <= room + 0.5) return
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  })
  const sees: { label: string; on?: boolean; title?: string }[] = [{ label: seen.see, on: !picked && !cardsHere }, ...webSees, ...[...mentions, ...c.mentions.map((m) => m.path).filter((p) => !mentions.includes(p))].map((m) => ({ label: `@${titleOf(m)}` }))]
  // 它在这一页能替你做的动作（右栏网页开着时是网页的，最可能是要它动网页）
  // 默认操纵的是这一页（中间开着的网页）时不写在哪，同别的「能动手」；是别的网页时写和那一颗一样的叫法
  const hands = !webHand ? seen.hands : webHand.key === webTab ? t(HANDS.web) : t('在{where}网页点、填表、剪藏', { where: t(WEB_PAGE_SAID[webHand.page]) })
  /** 对话菜单「之前的对话」：点「+」收起来的那几段，新的在上；名字是那段第一问的原话（同读 PDF） */
  const olderItems: OlderChat[] = (older ?? []).map((c) => ({ id: c.id, label: c.label || place.label, at: c.at, asks: c.asks, pick: () => void C.switchOlder(place.key, c.id), disabled: running !== null }))
  // 实心主按钮一屏最多一个（DESIGN.md 组件）：只有最新那条带按钮的回答用实心，之前的「打开」「存成卡片」退成次按钮
  const lastActs = msgs.findLastIndex((m) => m.role === 'ai' && !!m.actions?.length)
  /** 最新那条能复制、插入、引用的回答：它下面那排一直露着，之前的悬停才露 */
  const lastAnswer = msgs.findLastIndex(plainAnswer)

  return (
    <aside ref={cell} className="right aicell ai" aria-label="AI 对话" hidden={props.hidden}>
      <AiHead label={place.label} nav={props.nav} newTip="新对话：现在这段收进对话菜单，能切回" newDisabled={running !== null} onNew={newChat} older={olderItems} />
      {props.nav.away && !props.nav.onPage ? (
        <AwayBar nav={props.nav} />
      ) : (
      <Sees testid="ai-sees">
        {picked && (
          <Chip on testid="ai-picked" title={pickTip(picked.items, knownFiles)}>
            {`选中的${picked.items.length}个`}
          </Chip>
        )}
        {cardsHere && !picked && (
          <Chip on testid="ai-cards" title={cardsHere.items.map((x) => x.text.trim().split('\n')[0]!.slice(0, 40)).join('\n')}>
            {cardsHere.where === 'board' ? t('白板上选中的{n}张', { n: cardsHere.items.length }) : t('这篇里选中的{n}块', { n: cardsHere.items.length })}
          </Chip>
        )}
        {sees.map((s) => (
          <Chip key={s.label} on={s.on} {...(s.title ? { title: s.title } : {})}>
            {s.label}
          </Chip>
        ))}
        {hands && (
          <Chip hands {...(webHand ? { title: t('AI 不说是哪个网页时动这一个；你点进别的网页就换成那个') } : {})}>
            {`能动手：${hands}`}
          </Chip>
        )}
        {/* 记笔记开着：「● 正在记进《…》」，点了打开那篇（还没记过一问、那篇还没建时点不了） */}
        {noteOn && <RecChip target={titleOf(target!.path)} side={sideNoteOn} {...(props.notes.some((n) => n.path === target!.path) ? { onOpen: () => props.onOpen(target!.path) } : {})} />}
      </Sees>
      )}
      {/* 费曼学习讲着：顶上一句，照常能问、不记（已定 3） */}
      <AiNote />
      {/* 手机全能模式：手机经这台 Mac 问的那一问在等手机点头时，顶上说一声 */}
      <PhoneWaiting />
      {/* 对话目录（task-3e53q「三、b」）：问过一问就在右边贴边出一列短横线；包一层好让它贴着这一格的右边 */}
      <div ref={msgsBox} className={'msgs-box' + (asked ? ' toc' : '')}>
      {/* 在这段对话里找（⇧⌘F）：问过的、答过的每一条，跳到那一处的字 */}
      <BoardFind root={() => cell.current} host={() => msgsBox.current} cards=".um-wrap, .am" on={!props.hidden && !empty} owner="ai" placeholder={t('在这段对话里找')} toText />
      <div
        className={'msgs' + (empty ? ' greeting' : '') + (setup ? ' setup' : '')}
        ref={list}
        onClick={(e) => {
          // 问过的那句后面的小标：开着就收起，没开就打开
          const b = (e.target as Element).closest<HTMLElement>('.badge[data-side]')
          if (b) toggleSide(b.dataset.side!)
        }}
        onKeyDown={(e) => {
          const b = (e.target as Element).closest<HTMLElement>('.badge[data-side]')
          if (b && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            toggleSide(b.dataset.side!)
          }
        }}
      >
        {/* 空对话打招呼（task-0tgz2 方向 A）：引擎标志 + 钟点问候，下面一句跟着在看的东西走；能做什么在输入框上面那一排 */}
        {empty && <Greeting ref={emptyRef} engine={cp.none ? null : engine} ask={picked ? pickAsk(picked.items.length) : askLine(props.tab, { board: isBoard, inbox: inbox.length, label: place.label })} />}
        {/* 第一次开 AI（命令行用户，没走上手卡）：一句话说明全能模式，不拦着 */}
        {empty && !setup && !cp.introSeen && <AiIntro onSeen={() => void window.cn.aiIntroSeen('ai')} />}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={m.id} className="um-wrap" data-toc-q={m.text?.trim() || (m.mats?.length || m.pasted?.length ? t('（图和材料）') : '')}>
              {m.pasted && (
                <div className="um-imgs">
                  {m.pasted.map((n) => (
                    <img key={n} src={pastedUrl(n)} alt="粘贴的图" />
                  ))}
                </div>
              )}
              {m.mats?.length ? (
                <MatMsg text={m.text ?? ''} mats={m.mats} {...(m.mentions ? { mentions: m.mentions } : {})} onContextMenu={(e) => onMessageMenu(e, m.text ?? '', { user: 'chat' })} />
              ) : (
                <div className="um" onContextMenu={(e) => onMessageMenu(e, m.text ?? '', { user: 'chat' })}>
                  <MentionText text={m.text ?? ''} {...(m.mentions ? { mentions: m.mentions } : {})} />
                </div>
              )}
              {/* 你发的那句下面悬停出「拷贝 · 存成快捷回复」（task-eavzx） */}
              <UserMsgActs text={m.text ?? ''} place="chat" />
            </div>
          ) : (
            <div key={m.id} className="am" data-testid="ai-msg" data-msg={m.id} data-engine={m.engine} data-src="AI的回答" aria-busy={m.pending || undefined} onContextMenu={(e) => !m.pending && onMessageMenu(e, m.text ?? '', { ...(m.by ? { by: m.by } : {}), key: place.key, msg: m.id })}>
              {(m.read || m.by) && (
                <div className="read">
                  {m.read && <Codicon name="check" size={12} />}
                  {m.read && <span className="rd">{m.read}</span>}
                  {m.by && (
                    <span className="by">
                      {m.read ? ' · ' : ''}
                      <ByLogo by={m.by} />
                      {m.by}
                    </span>
                  )}
                </div>
              )}
              {m.steps?.map((s) => (
                <StepRow key={s.id} s={s} />
              ))}
              {m.pending && !m.text && !m.steps?.length && !m.dupProgress && (
                <div className="thinking">{queued?.id === m.id ? t('排在第 {n} 个，前面答完自动开始…', { n: queued.n }) : m.engine ? `${engines.find((e) => e.id === m.engine)?.label ?? ''}正在想…` : '正在想…'}</div>
              )}
              {m.error && !cutOf(m, false).cut && errorOf(m, i)}
              {m.alert && (
                <div className="aiwarn" role="status" data-testid="ai-alert">
                  <Codicon name="warning" size={12} className="ic" />
                  <span>{m.alert}</span>
                </div>
              )}
              {m.text && <AnswerText text={m.text} marks={marks.get(m.id)} live={!!m.live || !!m.pending} cites={{ conv: place.key, touched: touchedOf(m.steps) }} />}
              {/* 做了几步才断的：「没做完」放在说到一半的字后面（停在哪里一眼看得到） */}
              {m.error && cutOf(m, false).cut && errorOf(m, i)}
              {/* 回答下面一排：拷贝 · 插进文档 · ⋯（task-83vl3；task-bppvn 拿掉了「引用再问」）；命令的结果（带按钮、改动块、找重复、归档）不出；AI 等点头时换成「不要 · 可以，…」 */}
              {askBar(m, i) ??
                (plainAnswer(m) && (
                  <AnswerRow
                    md={withoutVizMark(m.text!).text}
                    {...(m.by ? { by: m.by } : {})}
                    chatKey={place.key}
                    msg={m.id}
                    noteItem={noteItemFor(m.id)}
                    last={i === lastAnswer}
                    host={{
                      place: 'chat',
                      busy: running !== null,
                      send: (text) => void run(text),
                      side: (text) => {
                        const id = C.openSide(place.key, place.label, { msg: m.id, quote: sideQuote(m.text!) })
                        void sendSide(id, text, [])
                      },
                      vars: () => ({ question: (msgs[i - 1]?.role === 'user' && msgs[i - 1]!.text) || '' }),
                    }}
                  />
                ))}
              {m.moves && (
                <div className="moves">
                  {m.moves.map((x) => (
                    <div key={x.path} className="mv">
                      {/* 名字放不下整行省略号（不在词中间断行），悬停看全名 */}
                      <span className="truncate" title={titleOf(x.path)}>
                        {titleOf(x.path)}
                      </span>
                      <span className="to">→ {x.to ?? `${CLIPS}/${x.topic}`}</span>
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
                    <FilePath path={m.draft.path} code />
                    <span className="rest">
                      {'· '}
                      <span className="num">{m.draft.words}</span>字 · AI写的草稿
                    </span>
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
              {!!m.actions?.length && changeBar(m)}
              {!!m.actions?.some((a) => !a.kind) && (
                <div className="acts">
                  {m.actions.filter((a) => !a.kind).map((a) => (
                    <button
                      key={a.label}
                      className={'btn btn-sm' + (a.primary && i === lastActs ? ' btn-primary' : '')}
                      onClick={() => runAction(m.id, a)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              {m.change && <ChangeBlock change={m.change} onRevert={() => void revert(m.id, m.change!)} onHistory={props.onShowHistory} onOpen={props.onOpen} />}
              {/* 记进笔记的这一问：「✓ 已记进《…》 · 撤回」（正在记、没记成也在这一行） */}
              {noted.get(m.id) && <NotedLine s={noted.get(m.id)!} onUndo={() => void unnote(place.key, m.id)} onOpen={() => showAskIn(noted.get(m.id)!.note, m.id)} />}
            </div>
          ),
        )}
        {/* 好几轮把这一篇改成想要的样子以后：存成命令（方向 C，commands/SaveCmd.tsx 那张表）；存过的写「存成了」，能再改一次 */}
        {canSave &&
          (savedCmd ? (
            <>
              <div className="savedcard" data-testid="cmd-saved">
                <div className="t">
                  <Codicon name="pass" size={16} />
                  {`存成了 /${savedCmd.name}`}
                </div>
                <div className="s">{withKeys(`${tagsOf(savedCmd).map((t) => t[0]).join(' · ')}。在 / 菜单和 {k:search} 的「让AI做」里，打 / 试试。`)}</div>
              </div>
              <div className="saverow">
                <Codicon name="symbol-event" size={14} />
                还想改这条命令？
                <button className="btn btn-sm" onClick={() => openSave(savedCmd)}>
                  <Codicon name="edit" size={14} />
                  再改一次
                </button>
              </div>
            </>
          ) : (
            <div className="saverow" data-testid="cmd-saverow">
              <Codicon name="symbol-event" size={14} />
              调出满意的样子了？
              <button className="btn btn-sm" onClick={() => openSave()}>
                <Codicon name="save" size={14} />
                存成命令
              </button>
            </div>
          ))}
        {/* 一个 AI 都没接上：三选一卡（不弹窗），发出去的那一问等「开始用」以后接着发 */}
        {/* 最后一轮已经是引导卡（修 Claude Code、登录）：不再叠一张三选一卡 */}
        {setup && !(msgs.length > 0 && loginCode(msgs[msgs.length - 1]!, msgs.length - 1)) && (
          <SetupCard
            onSettings={openAiSettings}
            onDone={() => {
              setSetup(false)
              const ask = pendingAsk
              setPendingAsk(null)
              if (ask) void run(ask)
            }}
          />
        )}
      </div>
      {asked && <ChatToc list={list} sides={tocSides} openSide={openSide?.id ?? null} onSide={(id) => C.showSide(place.key, id)} />}
      <NewBelow f={fol} />
      </div>
      {/* 回答里选一句：同一个小框（task-4edsc，方向 A）：「引用 ⌘↵」（⇧⌘L 也行，task-bppvn）成为输入框顶上那一排的一块，「问这句 ↵」就地开一条旁支 */}
      <AskBox
        list={list}
        active={!props.hidden}
        onQuote={(text, src) => c.add({ kind: 'quote', text, src })}
        onAsk={(at, question) => {
          const id = C.openSide(place.key, place.label, at)
          if (question.trim()) void sendSide(id, question, [])
        }}
      />
      {host &&
        openSide &&
        openGroup &&
        createPortal(
          <SideInline
            side={{ id: openSide.id, quote: openSide.quote, name: sideName(openSide), msgs: openSide.msgs.map((m) => ({ id: m.id, role: m.role, text: m.text ?? '', ...(m.error ? { error: m.error } : {}), ...(m.mats ? { mats: m.mats } : {}), ...(m.engine ? { engine: m.engine } : {}), ...(m.steps ? { steps: m.steps } : {}) })) }}
            group={openGroup.sides.map((s) => ({ id: s.id, name: sideName(s) }))}
            running={C.sideRunning(openSide.id) !== undefined}
            record={sideNoteOn ? { icon: 'note', text: t('答完记进《{name}》', { name: noteName(titleOf(target!.path), 18) }) } : { icon: 'comment-discussion', text: '跟着这段对话存，不写进笔记' }}
            conv={place.key}
            picks={cp.picks}
            link={{ key: place.key, msg: openSide.msg }}
            onSend={(text, mats) => void sendSide(openSide.id, text, mats)}
            onStop={() => {
              const ai = C.sideRunning(openSide.id)
              if (ai !== undefined) void window.cn.aiTurnStop(ai)
            }}
            onClose={() => C.showSide(place.key, null)}
            onNew={() => void C.newSideOn(place.key, place.label, openSide.id)}
            onSwitch={(id) => C.showSide(place.key, id)}
            onPut={(text) => {
              c.add({ kind: 'quote', text, src: `旁支 · ${sideName(openSide)}` })
              app().notice(t('插进了主对话的输入框，没发'))
            }}
            menu={{
              title: '这段对话的旁支',
              all: sides.filter((s) => s.msgs.length || s.id === openSide.id).map((s) => ({ id: s.id, name: sideName(s), right: `${s.msgs.filter((m) => m.role === 'user').length} 问` })),
              onRename: (name) => C.renameSide(place.key, openSide.id, name),
              onDelete: () => C.deleteSide(place.key, openSide.id),
            }}
            onNotice={showNote}
            takeFocus={C.takeSideFocus}
            onGrow={() => revealSide(list.current, host, openGroup.key)}
            omniWhere={t('收起旁支后，在输入框下面那行改')}
          />,
          host,
        )}
      {/* 打了字、加了材料先藏起来（斜杠菜单、@ 菜单从这里往上弹），清空回来；发了第一问收起 */}
      {empty && !setup && !input && !c.mats.length && (
        <QuickRow
          items={quickItems(folder)}
          onAll={() => {
            setInput('/')
            box.current?.focus()
          }}
        />
      )}
      {/* 中途拨记笔记开关的那一条：输入框上面的灰底条（和读 PDF 那边同一个样子，设计复审） */}
      {noteTip && !pasteNote && <NoteTip text={noteTip.text} {...(noteTip.ok ? { ok: true } : {})} {...(noteTip.acts ? { acts: noteTip.acts } : {})} />}
      <AiInput
        c={c}
        placeholder={cp.none ? t('跟AI说，/ 选命令，@ 引用笔记') : t('跟{name}说，/ 选命令，@ 引用笔记', { name: engines.find((e) => e.id === engine)?.label ?? 'Claude Code' })}
        hint="↵ 发送"
        picks={cp.picks}
        // 开着旁支时缩成一行灰字（方向 A：不和旁支的输入框摞着），点它收起旁支、回到这里；全能模式那行一起藏起来
        slim={openSide ? { onWake: () => C.showSide(place.key, null) } : null}
        omni={openSide ? null : cp.omni}
        // 全能模式上面那一排「记笔记 ·《记进哪篇》▾ ｜ 旁支」（没开东西、还没选那篇时「记笔记」显示关着，拨它先问记进哪篇）
        note={openSide ? null : { main: noteOn, side: sw.side, target: target ? titleOf(target.path) : null, onMain: toggleNoteMain, onSide: toggleNoteSide, onTarget: (el) => openNoteMenu(el) }}
        running={running !== null}
        sendDisabled={!input.trim() && !c.mats.length}
        below={
          queued ? (
            <div className="aiin-wait" data-testid="ai-wait">
              <span>
                {C.fullAt() !== null
                  ? t('同时在答 {m} 段，排在第 {n} 个', { m: C.fullAt()!, n: queued.n })
                  : t('{name}一次答一段，排在第 {n} 个', { name: engines.find((e) => e.id === engine)?.label ?? engine, n: queued.n })}
              </span>
              {ahead && (
                <>
                  <span aria-hidden="true">·</span>
                  <button data-testid="ai-wait-go" title={t('「{name}」那边还在答', { name: ahead.label })} onClick={() => jumpToChat(ahead.key, ahead.id)}>
                    {t('去看看')}
                  </button>
                </>
              )}
            </div>
          ) : undefined
        }
        onSend={() => void run(input, c.plain())}
        onStop={stop}
        onKeyDown={onKey}
        at={findAt}
        onNotice={showNote}
        list={list}
      >
        {pasteNote && <div className="nocmd">{pasteNote}</div>}
        {sl.menu}
      </AiInput>
      {noteMenu && (
        <TargetMenu
          at={noteMenu.at}
          anchor={noteMenu.anchor}
          doc={noteDoc}
          current={noteDoc ? target : (noteTo ?? null)}
          inbox={noteDoc ? null : inboxTarget()}
          hint={noteDoc ? t('看文档时默认：记笔记关、旁支关。改了这两颗，下次看文档照改后的来。') : t('以后在{place}聊：每段对话打开「记笔记」时都先问这一句。', { place: place.label })}
          notes={props.notes.map((n) => n.path).filter((p) => /\.md$/i.test(p))}
          onPick={pickNoteTarget}
          onClose={() => setNoteMenu(null)}
        />
      )}
    </aside>
  )
}

/** 找重复一次先列几对 */
const DUP_PAGE = 50

/** 答完了的一段话（不是命令的结果：带按钮、改动块、找重复、归档、梦游）：下面一排拷贝 · 插进文档 · ⋯ */
/** 在整条回答上开的旁支（快捷回复「开一条旁支」）：那句写回答开头一句 */
const sideQuote = (md: string) => (md.replace(/[#>*_`|-]/g, ' ').trim().split(/\n|(?<=[。！？.!?])/)[0] ?? '').trim().slice(0, 40)

const plainAnswer = (m: C.Msg) => m.role === 'ai' && !m.pending && !m.live && !!m.text?.trim() && !m.actions?.length && !m.change && !m.dups && !m.moves && !m.dream && !m.draft

/** 找重复的一对对：像的在前 */
const byScore = (pairs: DuplicatePair[]) => pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))


/**
 * 回答原文（md 照排）。问过的那几句（旁支）：答完以后在画好的字上划虚线、插小标（@cn/ai-chat 的 side/marks.ts）；
 * 有小标时字一变 .txt 整块换掉（key），React 不去动改过的节点；答着的时候不划
 */
function AnswerText(p: { text: string; marks?: Mark[]; live: boolean; cites: CiteScope }) {
  const txt = useRef<HTMLDivElement>(null)
  const key = JSON.stringify(p.marks ?? [])
  // 认出来的链接变了（task-3e53q）：有小标时也整块换掉
  const sig = useCiteSig(p.cites.conv)
  useLayoutEffect(() => {
    if (!txt.current || !p.marks?.length || p.live) return
    return applyMarks(txt.current, p.marks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, p.text, p.live, sig])
  return (
    <div className="txt" key={p.marks?.length ? p.text + sig : 'txt'} ref={txt}>
      {/* 模型偶尔把工具调用写成了字（task-ne7cw）：成段的不显示，存的还是原文 */}
      <Markdown text={hideToolMarkup(withoutVizMark(p.text).text, p.live)} math cites={p.cites} />
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
