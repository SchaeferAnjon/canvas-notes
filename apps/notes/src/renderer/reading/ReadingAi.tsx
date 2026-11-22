/**
 * 读 PDF 时右栏 AI 那一格（方向 A：和「笔记」用竖条切换）。spec 1.3 发出去前的预览、1.5 AI 右栏。
 * 输入框是共用的那个（composer.tsx，第 2b 段）：底行谁来答 · 模型 · effort，顶上一排材料。
 * 框好的那块是那一排的第一张（不带编号，左下角「第28页」），预填「给我讲解一下」并全选（直接打字就换掉），回车就发；
 * 框着时 ⌘↵ 是引用（task-6cxtc：这块成为顶上那一排的一块材料、光标在输入框里，接着框别处攒成 ①②）；回答下面「还是不懂」「换个方式讲」，再下面一行后台记笔记的进度。
 */
import { when } from '../../shared/when'
import { isKey, useKeys } from '../keys'
import { Codicon } from '@cn/design'
import { ByLogo } from '../engine-logo'
import { readAsk, webAsk } from '../ai-greet'
import { pageHead } from '../../shared/read-along'
import { Greeting, QuickRow } from '../ai-quick'
import { onMessageMenu } from '../ctx/message-menu'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type ReadingMsg, withoutVizMark } from '../../shared/reading'
import { hideToolMarkup } from '../../shared/tool-markup'
import { Markdown } from '../md-render'
import { AiError } from '../ai-error'
import { pastedUrl } from '../paste-images'
import { AiHead, AwayBar, Chip, type DockNav, Sees } from '../ai-head'
import { AiInput, type Lead, MatMsg, sendText, useComposer, useConvPick } from '../composer'
import { ChangeBlock, StepRow } from '../AiPanel'
import { readKey, readLabel } from '../ai-place'
import { fmtTime } from '../../shared/video'
import { applyMarks, flashMark, groupMark, type Mark, sideGroups } from './marks'
import { AskBox } from '../side/AskBox'
import { showSide as revealSide, useSideHost } from '../side/host'
import { SideInline } from '../side/SideInline'
import { titleOf } from '../../shared/layout'
import * as R from './store'
import type { DiffSource } from '../../shared/diff'
import { type Ctx, slashGroups, type SlashItem } from '../../shared/ai-cmds'
import { useAiCmds } from '../commands/store'
import { useProposal } from '../commands/proposals'
import { videoOf } from '../../shared/video'
import { useVideoTitle } from '../video/store'
import { useSlash } from '../commands/SlashMenu'
import { openCmdEditor } from '../commands/editor'
import { libPlace, runIn } from '../commands/handoff'
import { runReadingCmd } from './cmds'
import { ensureBeforeSend } from '../web-notes/flow'

/** 待问那块的小标签：PDF「第28页」；网页、HTML；视频「接着问」是「00:06 · 视频名」 */
function pendingLabel(p: R.Pending): string {
  if (!p.web) return `第${p.page}页`
  if (p.web.t !== undefined) return `${fmtTime(p.web.t)} · ${p.web.title}`
  return /^https?:/i.test(p.web.url) ? '网页' : 'HTML'
}

/** / 命令的那一轮（reading/store.ts cmdTurn 开的）：回答下面是命令结果的按钮，不是讲解用的「还是不懂」「换个方式讲」 */
const isCmdTurn = (m: ReadingMsg) => m.thread.startsWith('cmd-')

/** 框好一块时预填的那句 */
const PREFILL = '给我讲解一下'

const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const stamp = (t: number) => when(t, { time: true })

/** 旁支最下面那一行「记到哪」：读 PDF、HTML 记进这份的笔记（第几页）；网页上问的旁支跟着这段对话存（那一问写进那篇的讲解块，旁支能在那篇里那一块上开） */
function recordOf(pdf: string, r: R.Reading, side: { thread: string }): { icon: 'note' | 'comment-discussion'; text: string } {
  if (R.isWebSrc(pdf)) return { icon: 'comment-discussion', text: '跟着这段对话存；在那篇的讲解块上开的旁支写进那篇' }
  const page = r.state.threads.find((t) => t.id === side.thread)?.page ?? 0
  return { icon: 'note', text: `记进《${titleOf(r.note.path)}》${page > 0 ? `第${page}页` : ''}` }
}

export function ReadingAi(props: {
  pdf: string
  hidden: boolean
  /** 对话菜单、看别处的对话时「这是在…问的 · 回到…」（D 组 CN-132；读 PDF 的对话从别处点开时也用这一套显示、接着问） */
  nav: DockNav
  onShowNote(id: string): void
  onOpenHtml(path: string): void
  onNotice(text: string): void
  onCollapse(): void
  /** 「在笔记里看」：笔记标签没开就开上、在别的标签后面就换到它（读 PDF、HTML 有） */
  onShowNotes(): void
  /** AI 命令「先给你看」（自己的命令在视频、网页上用）：在中间栏开对比标签、收下或不要以后关掉它（task-9womr） */
  onOpenDiff(src: DiffSource, title: string): void
  onCloseDiff(proposal: string): void
  /** / 命令新建的那一篇：「打开」开到中间 */
  onOpen(path: string): void
}) {
  const K = useKeys()
  const { pdf } = props
  const r = R.useReading(pdf)!
  // 输入框的字和顶上那一排材料（composer.tsx）
  const c = useComposer(props.onNotice)
  const input = c.text
  const setInput = c.setText
  const box = c.ta
  // 谁来答 · 模型 · effort（CN-91 方向 C）：模型和 effort 记在这份 PDF 的对话里，没选过用设置 › AI「AI 对话」那一行
  const cp = useConvPick(r.state.pick, (p) => R.setPick(pdf, p), props.onNotice)
  const engine = cp.pick.engine
  const engines = cp.engines
  const [flashMsg, setFlashMsg] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? 'Claude Code'
  // / 菜单（task-9womr）：「这份 PDF」或「这个视频」那一组，自己的命令在这里能用的，整个库的换到收件箱、首页那段对话跑
  const webUrl = R.isWebSrc(pdf) ? pdf.slice(4) : null
  const here: Ctx = webUrl ? (videoOf(webUrl) ? 'video' : 'web') : /\.html?$/i.test(pdf) ? 'html' : 'pdf'
  const cmds = useAiCmds()
  /** 「再问一次」再跑那条命令：照 / 菜单在这里能找到的那一条；找不到（命令删了、换了地方）返回 false */
  const rerun = (text: string) => {
    const name = text.slice(1)
    const it = slashGroups({ here, also: here === 'video' ? ['web'] : [], q: name, mine: cmds.mine, slash: cmds.slash })
      .flatMap((g) => g.items)
      .find((x) => x.name === name)
    if (!it) return false
    runCmd(it)
    return true
  }
  const runCmd = (it: SlashItem) => {
    if (it.builtin?.lib) {
      const pl = libPlace(it.name)
      runIn(pl.key, '/' + it.name)
      props.nav.pick(pl)
      return
    }
    void runReadingCmd({ pdf, place: { key: readKey(pdf), label: readLabel(pdf) }, pick: { engine, ...cp.req }, onOpenDiff: props.onOpenDiff, onCloseDiff: props.onCloseDiff }, it)
  }
  const sl = useSlash({
    text: input,
    here,
    also: here === 'video' ? ['web'] : [],
    engine,
    onRun: (it) => {
      setInput('')
      runCmd(it)
    },
    onClose: () => setInput(''),
    onEdit: (cmd) => openCmdEditor({ kind: 'edit', cmd, who: cp.label, engine, pick: { engine, ...cp.req } }),
    onCopy: (builtin) => openCmdEditor({ kind: 'copy', builtin, who: cp.label, engine, pick: { engine, ...cp.req } }),
  })


  // 框好一块（还没点工具条上的按钮）：输入框预填「给我讲解一下」并全选，焦点进来好回车就发；
  // 输入框里已经有自己打的字就不动它，框的这块挂在那一排第一张（光标放到最后）；
  // 改问法：输入框空着、光标在里面；马上就发的（工具条按钮、问这一页、⌘↵）不预填（CN-23）
  const pendingKey = r.pending ? `${r.pending.page}:${r.pending.rect?.join(',') ?? ''}:${r.pending.quote ?? ''}:${r.pending.blank ? 1 : 0}` : ''
  const selectNext = useRef(false)
  /** 要全选、放光标了：字没变（改问法前输入框本来就是空的）时也要再放一次 */
  const [selectSeq, setSelectSeq] = useState(0)
  const prefilled = useRef('')
  const inputNow = useRef(input)
  inputNow.current = input
  useEffect(() => {
    if (!r.pending || r.pending.direct) return
    const own = inputNow.current.trim() && inputNow.current !== prefilled.current
    if (own) {
      prefilled.current = ''
      requestAnimationFrame(() => {
        const t = box.current
        if (!t) return
        t.focus()
        t.setSelectionRange(t.value.length, t.value.length)
      })
      return
    }
    selectNext.current = true
    prefilled.current = r.pending.blank ? '' : PREFILL
    setInput(prefilled.current)
    setSelectSeq((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey])
  // 框的那块不要了（esc、×、点了空白处、「引用这块」成了材料）：预填的字跟着清掉，自己打的留着
  const hadPending = useRef(false)
  useEffect(() => {
    if (r.pending) {
      hadPending.current = true
      return
    }
    if (!hadPending.current) return
    hadPending.current = false
    const pre = prefilled.current
    prefilled.current = ''
    if (pre && inputNow.current === pre) setInput('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.pending])
  // 不管从哪里发出去（回车、工具条、问这一页、⌘↵）：预填的字清掉；自己打的、还没发的字留着
  const sentSeen = useRef(r.sent)
  useEffect(() => {
    if (sentSeen.current === r.sent) return
    sentSeen.current = r.sent
    const pre = prefilled.current
    prefilled.current = ''
    if (pre && inputNow.current === pre) setInput('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.sent])
  // 排着的那几问不发了（停下、不发了、换了一块）：它们的字和材料回到输入框，光标放到最后。
  // 输入框里已经有自己打的字就接在后面、空一行（第 3 轮：点停下把刚打的字换掉了）
  useEffect(() => {
    const back = r.restore
    if (!back) return
    const pre = prefilled.current
    prefilled.current = ''
    if (inputNow.current === pre) setInput('')
    c.restore(back.text, back.mats)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.restore?.seq])
  // 外面加进来的材料（PDF、HTML、网页上「引用」，右栏网页选字「问 AI」）：编号插在光标处、光标进输入框；预填的字不要了
  const incoming = r.incoming.length ? r.incoming[r.incoming.length - 1]!.seq : 0
  useEffect(() => {
    if (!incoming) return
    for (const g of R.takeIncoming(pdf)) {
      if (prefilled.current && inputNow.current === prefilled.current) {
        prefilled.current = ''
        setInput('')
      }
      c.add(g.mat, g.doc ? { doc: { tab: null } } : {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])
  // 等预填的字真的写进输入框以后再全选（不然写字会把光标挪到最后）
  useLayoutEffect(() => {
    if (!selectNext.current || !box.current) return
    selectNext.current = false
    box.current.focus()
    box.current.select()
  }, [input, pendingKey, selectSeq])

  // ⌘J、圆钮打开的：光标进输入框，直接打字问
  useEffect(() => {
    if (!props.hidden && R.takeAiFocus()) box.current?.focus()
  }, [props.hidden])

  // 新消息、边生成边显示：滚到底（开着旁支时换回这一格不滚走，停在那条旁支上）
  const lastLen = r.state.msgs.length ? r.state.msgs[r.state.msgs.length - 1]!.text.length : 0
  const sideOpen = useRef(false)
  useEffect(() => {
    if (sideOpen.current && !lastLen) return
    list.current?.scrollTo({ top: list.current.scrollHeight })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.state.msgs.length, lastLen])
  useEffect(() => {
    if (props.hidden || sideOpen.current) return
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [props.hidden])

  // 从笔记点「完整对话」：滚到那次对话，外圈亮一下
  useEffect(() => {
    const cv = r.convo
    if (!cv || props.hidden) return
    const el = list.current?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(cv.id)}"]`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setFlashMsg(cv.id)
    const t = setTimeout(() => setFlashMsg(null), 2000)
    return () => clearTimeout(t)
  }, [r.convo?.seq, props.hidden])

  /** 输入框里是自己打的字（不是预填的、不是空的） */
  const own = !!input.trim() && input !== prefilled.current

  /** page：⌘↵ 在答的时候排上的，发出时带上这一页 */
  async function send(page?: number) {
    const mats = c.plain()
    // 只贴了图、字里除了编号一个字都没有：默认问这张图讲的是什么（CN-24）
    const text = sendText(input, mats)
    // 还在答上一问：和点浮条「讲解一下」一样排在后面，答完依次发（store.send 排队）
    if (!text && !mats.length) return
    // 网页那一处（task-6cxtc）：还没定这个网页记到哪篇先问一句，取消就不发（字留在输入框里）；
    // 视频问答块「接着问」那一串记进那块问答所在的那篇，不问
    if (R.sendsToWebNote(pdf) && !(await ensureBeforeSend(r.pending?.web?.url ?? pdf.slice(4)))) return
    c.clear()
    void R.send(pdf, text, [], { ...(page ? { page } : {}), ...(mats.length ? { mats } : {}) })
  }

  /**
   * ⌘↵：框着一块（不管焦点在 PDF 上还是输入框里）是引用（这块成为一块材料，task-6cxtc）；没框时输入框里有自己打的问题就带上这一页问这句（HTML 带这一屏），
   * 空着或只有预填的字交给 PDF 标签「问这一页」；网页那一处没有「这一页」，⌘↵ 只管引用
   */
  function cmdEnter(e: React.KeyboardEvent) {
    if (r.pending && !r.pending.direct && !r.pending.blank) {
      e.preventDefault()
      e.stopPropagation()
      void R.quotePending(pdf)
      return
    }
    if (R.isWebSrc(pdf)) return
    if (!own) return
    e.preventDefault()
    e.stopPropagation()
    // 还在答、没框：排在后面，发出时带上这一页（和不在答时的 ⌘↵ 一样，第 3 轮：排着发出去时没带这一页）
    if (r.running !== null) return send(r.state.page || 1)
    const text = input.trim()
    const mats = c.plain()
    c.clear()
    window.dispatchEvent(new CustomEvent(R.ASK_PAGE, { detail: { src: pdf, text, ...(mats.length ? { mats } : {}) } }))
  }

  const running = r.running !== null
  const msgs = r.state.msgs
  const lastAi = [...msgs].reverse().find((m) => m.role === 'ai')
  /** 实心的「打开」只给最后一个能打开的（和 AI 对话里一样：一屏一颗实心按钮） */
  const lastOpen = [...msgs].reverse().find((m) => m.open && !m.change?.reverted)
  const sectionCount = r.note.sections.length
  // 问过的那几句（旁支，方向 A）：一句一个小标，数字是这一句开了几条；开着的那一句整句亮、小标强调色底
  const sides = r.state.sides ?? []
  const groups = new Map<number, ReturnType<typeof sideGroups<(typeof sides)[number]>>>()
  for (const msg of new Set(sides.map((s) => s.msg)))
    groups.set(
      msg,
      sideGroups(sides.filter((s) => s.msg === msg)),
    )
  const marks = new Map<number, Mark[]>([...groups].map(([msg, gs]) => [msg, gs.map((g) => groupMark(g, r.side.open))]))
  const open = sides.find((s) => s.id === r.side.open) ?? null
  const openGroup = open ? (groups.get(open.msg)?.find((g) => g.sides.includes(open)) ?? null) : null
  sideOpen.current = !!open
  const host = useSideHost(list, open && openGroup ? { msg: open.msg, key: openGroup.key } : null)
  /** 点小标：这一句开着的那条收起；没开着就打开这一句最后开的那条 */
  const toggleSide = (key: string) => {
    const g = [...groups.values()].flat().find((x) => x.key === key)
    if (!g) return
    if (g.sides.some((s) => s.id === r.side.open)) return R.closeSide(pdf)
    R.showSide(pdf, g.sides[g.sides.length - 1]!.id)
  }
  // 回到主对话（PDF 上框了一块、别处带进来一块、主对话发出去了一问）：旁支收起，主输入框回来
  const mainSeq = `${pendingKey}|${r.sent}|${incoming}`
  const mainSeen = useRef(mainSeq)
  useEffect(() => {
    if (mainSeen.current === mainSeq) return
    mainSeen.current = mainSeq
    if (r.side.open && (r.pending || incoming || r.sent)) R.closeSide(pdf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainSeq])
  // 刚收起的那一句：闪一下（原型 A）
  useLayoutEffect(() => {
    const f = r.side.flash
    if (!f) return
    const key = [...groups.values()].flat().find((g) => g.sides.some((s) => s.id === f.side))?.key
    if (key) flashMark(list.current, key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.side.flash?.seq])
  /** 视频那一处：右栏开着这个视频时它的标题（从圆钮、⌘J 进来还没问过时，网页标题没人记下） */
  const videoTitle = useVideoTitle(R.isWebSrc(pdf) ? pdf.slice(4) : null)
  /** 网页上问的那几处的网页标题（头上胶囊、「看得到」写它）；还没问过、只引用了时用引用时记下的（task-6cxtc 复审）；视频用视频标题 */
  const webTitle = [...r.state.threads].reverse().find((t) => t.web)?.web?.title ?? r.pending?.web?.title ?? r.webTitle ?? videoTitle
  /** 头上胶囊、空对话里写的：这段对话是哪里的 */
  const label = readLabel(pdf, webTitle)
  /** 网页那一处：「看得到」和空白提示写这一页叫什么（「2.2. 数据预处理」，不是域名、整串网址） */
  const webHead = R.isWebSrc(pdf) ? pageHead(webTitle, pdf.slice(4)) : null
  const html = /\.html?$/i.test(pdf)
  const pend = r.pending
  // 输入框顶上那一排的第一张：框好的那块（左下角「第28页」）、选着的那段、视频那一帧
  const lead: Lead | null = !pend
    ? null
    : pend.quote
      ? {
          label: pendingLabel(pend),
          quote: pend.quote,
          img: pend.image && pend.web?.t !== undefined ? vaultImg(pend.image) : null,
          alt: pend.web?.t !== undefined ? `${fmtTime(pend.web.t)} 这一帧` : '选中的这段',
          removeLabel: '不要这段了',
          onRemove: () => R.unstage(pdf, true),
        }
      : {
          label: pendingLabel(pend),
          img: pend.url ?? null,
          alt: pend.page ? `第 ${pend.page} 页框的那块` : '框的那块',
          removeLabel: '不要这块了',
          onRemove: () => R.unstage(pdf, true),
        }
  // 底行提示：框着一块时说三个键（CN-92 方向 A），改问法时说怎么发、怎么取消；平时说回车和 ⌘↵
  // 键照命令表（问这一页的键能改）
  const ask = K('ask-page')
  const hintNow = pend && !pend.direct ? (pend.blank ? `${K('enter')} 发送 · ${K('escape')} 取消这块` : `${K('enter')} 讲解一下${ask ? ` · ${ask} 引用` : ''} · ${K('escape')} 取消这块`) : undefined
  const hint = R.isWebSrc(pdf) || !ask ? `${K('enter')} 发送` : `${K('enter')} 发送 · ${ask} ${html ? '问这一屏' : '问这一页'}`

  return (
    <aside className="right aicell reading-ai ai" aria-label="边读边问 AI" hidden={props.hidden}>
      <AiHead label={label} nav={props.nav} newTip="新对话：AI 从头读这份 PDF，问过的和笔记都留着" newDisabled={running} onNew={() => void R.newChat(pdf)} />
      {/* 看得到（A 组读 PDF 小样）：这份 PDF · 第几页 | ✓ 读过全文几页 | 笔记几轮（还没记过不画）；看别处的对话时换成「这是在…问的」；下格开着旁支时藏起来 */}
      {props.nav.away ? (
        <AwayBar nav={props.nav} />
      ) : (
      <Sees testid="reading-sees">
        {R.isWebSrc(pdf) ? (
          <Chip on>{`网页 · ${webHead}`}</Chip>
        ) : /\.html?$/i.test(pdf) ? (
          <Chip on>{`${stemOf(pdf)}.html`}</Chip>
        ) : (
          <Chip on>{`${stemOf(pdf)}.pdf · 第${r.state.page}页`}</Chip>
        )}
        {!R.isWebSrc(pdf) && r.pending?.web && /^https?:/i.test(r.pending.web.url) && <Chip on>{`网页 · ${r.pending.web.title}`}</Chip>}
        {r.pages > 0 &&
          (r.readN < r.pages ? (
            <Chip>
              <Codicon name="loading" size={12} className="spin" />
              <span className="num">{`正在读全文${r.readN}/${r.pages}`}</span>
            </Chip>
          ) : (
            <Chip>
              <Codicon name="check" size={12} className="ok" />
              <span className="num">{`读过全文${r.pages}页`}</span>
            </Chip>
          ))}
        {!R.isWebSrc(pdf) && sectionCount > 0 && (
          <Chip>
            <span className="num">{`笔记${sectionCount}轮`}</span>
          </Chip>
        )}
      </Sees>
      )}
      <div
        className={'msgs' + (msgs.length === 0 ? ' greeting' : '')}
        ref={list}
        onClick={(e) => {
          const a = (e.target as Element).closest<HTMLElement>('a.pg[data-page]')
          if (a) R.jumpTo(pdf, Number(a.dataset.page))
          // 问过的那句后面的小标：切到那条旁支，开着的那条再点是关掉
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
        {/* 空对话和别处同一个样子（task-0tgz2 打招呼）：怎么框一块问写在那一句和输入框的占位字里；「问这一页」在输入框上面那一排 */}
        {msgs.length === 0 && <Greeting engine={engine} ask={webHead ? webAsk(webHead) : readAsk(label)} />}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const startsThread = m.role === 'user' && (!prev || prev.thread !== m.thread || (prev.role === 'ai' && m.time - prev.time > 10 * 60_000))
          const isNew = r.state.newChatAt && m.time >= r.state.newChatAt && (!prev || prev.time < r.state.newChatAt)
          return (
            <Msg
              key={m.id}
              m={m}
              sep={isNew ? `新对话 · ${stamp(r.state.newChatAt!)}` : startsThread ? `${Date.now() - m.time < 10 * 60_000 ? '现在' : stamp(m.time)}${m.page ? ` · 第${m.page}页` : ''}` : null}
              flash={flashMsg === m.thread && startsThread}
              last={m === lastAi && !running}
              primary={m === lastOpen}
              running={running && m.id === r.running}
              quote={startsThread ? r.state.threads.find((t) => t.id === m.thread)?.quote : undefined}
              onAgain={(t) => {
                setInput('')
                // / 命令那一轮的「再问一次」：再跑一次这条命令，不是把「/命令名」当一句话问 AI
                if (isCmdTurn(m) && rerun(t)) return
                void R.send(pdf, t)
              }}
              onRephrase={(t) => {
                setInput(t)
                requestAnimationFrame(() => box.current?.focus())
              }}
              onOpen={props.onOpen}
              onOpenDiff={props.onOpenDiff}
              ask={m.role === 'ai' && prev?.role === 'user' ? prev.text : undefined}
              busy={running}
              marks={marks.get(m.id)}
              engine={{ id: m.engine ?? engine, label: engines.find((e) => e.id === (m.engine ?? engine))?.label }}
              onShowNote={() => props.onShowNote(m.thread)}
              onRevert={() => void R.revertChange(pdf, m.id).catch((e: unknown) => props.onNotice(String((e as Error).message ?? e)))}
              onViz={() => void R.makeViz(pdf, m.id)}
              onOpenHtml={props.onOpenHtml}
            />
          )
        })}
      </div>
      {/* 回答里选中一句（CN-90 方向 A）：选区下方的小框，上面一格先打问题，下面「引用进输入框 ⇧⌘L」（输入框顶上那一排的一块，来源「AI的回答 · 第28页」）、「问这句 ↵」（下格开旁支） */}
      <AskBox
        list={list}
        active={!props.hidden}
        onQuote={(text, src) => c.add({ kind: 'quote', text, src })}
        onAsk={(at, question) => void R.openSide(pdf, at, question)}
      />
      {/* 开着的那条旁支：就在被问那句所在的那一段下面（方向 A「就地展开」，task-4edsc） */}
      {host &&
        open &&
        openGroup &&
        createPortal(
          <SideInline
            side={{ id: open.id, quote: open.quote, name: R.sideName(open), msgs: open.msgs }}
            group={openGroup.sides.map((s) => ({ id: s.id, name: R.sideName(s) }))}
            running={r.sideRunning[open.id] !== undefined}
            record={recordOf(pdf, r, open)}
            picks={cp.picks}
            {...(R.isWebSrc(pdf)
              ? {}
              : {
                  onNote: () => {
                    props.onShowNotes()
                    R.focusSide(pdf, open.thread, open.quote)
                  },
                })}
            onSend={(text, mats) => void R.sendSide(pdf, open.id, text, mats)}
            onStop={() => R.stopSide(pdf, open.id)}
            onClose={() => R.closeSide(pdf)}
            onNew={() => void R.newSideOn(pdf, open.id)}
            onSwitch={(id) => R.showSide(pdf, id)}
            onPut={(text) => {
              // 直接进主对话的输入框（不走「外面带进来的」那条路：那条会把旁支收起）；旁支照旧开着（原型 A）
              c.add({ kind: 'quote', text, src: `旁支 · ${R.sideName(open)}` })
              props.onNotice('放进了主对话的输入框，没发')
            }}
            menu={{
              title: R.isWebSrc(pdf) ? '这个网页的旁支' : /\.html?$/i.test(pdf) ? '这一份 HTML 的旁支' : '这一份 PDF 的旁支',
              all: sides
                .filter((s) => s.msgs.length || s.id === open.id)
                .map((s) => {
                  const page = r.state.threads.find((t) => t.id === s.thread)?.page ?? 0
                  return { id: s.id, name: R.sideName(s), right: `${page > 0 ? `第 ${page} 页 · ` : ''}${R.sideAsks(s)} 问` }
                }),
              onRename: (name) => R.renameSide(pdf, open.id, name),
              onDelete: () => R.deleteSide(pdf, open.id),
            }}
            onNotice={props.onNotice}
            takeFocus={R.takeSideFocus}
            onGrow={() => revealSide(list.current, host, openGroup.key)}
          />,
          host,
        )}
      {/* 输入框上面那一排（和 AI 对话同一个）：读 PDF 是「问这一页」（⌘↵ 同一件事），HTML 是「问这一屏」；框着一块、打了字、发了第一问都收起 */}
      {msgs.length === 0 && !input && !c.mats.length && !r.pending && !R.isWebSrc(pdf) && !props.nav.away && (
        <QuickRow
          items={[{ text: html ? '问这一屏' : '问这一页', engine, go: () => window.dispatchEvent(new CustomEvent(R.ASK_PAGE, { detail: { src: pdf, text: html ? '给我讲解一下这一屏' : '给我讲解一下这一页' } })) }]}
        />
      )}
      <AiInput
        c={c}
        className="reading-in"
        placeholder={pend?.web?.t !== undefined ? `接着问${fmtTime(pend.web.t)}这一帧…` : pend?.blank ? '打你自己的问法…' : `跟${engineLabel}说，${R.isWebSrc(pdf) ? '在网页上按住 ⌘ 框一块' : '在左边框一块'}就能问`}
        hint={hint}
        hintNow={hintNow}
        lead={lead}
        picks={cp.picks}
        // 开着旁支时缩成一行灰字（方向 A：不和旁支的输入框摞着），点它收起旁支、回到这里；全能模式那行一起藏起来
        slim={open ? { onWake: () => R.closeSide(pdf) } : null}
        omni={open ? null : cp.omni}
        running={running}
        sendDisabled={!input.trim() && !c.mats.length}
        own={own}
        onSend={() => send()}
        onStop={() => R.stop(pdf)}
        onNotice={props.onNotice}
        list={list}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (sl.onKey(e)) return
          if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
            e.preventDefault()
            send()
          } else if (isKey(e, 'ask-page')) cmdEnter(e)
          else if (e.key === 'Escape') {
            e.preventDefault()
            // 框着一块、输入框里只有预填的字或空着：连图一起取消（CN-97）；打了自己的字：先离开输入框（再按 esc 在 PDF 上取消这块）
            if (r.pending && !own) R.unstage(pdf)
            box.current?.blur()
          }
        }}
        children={sl.menu}
        above={
          // 排着的几问自己占一整块（在那一排下面、字上面），附图再多也不挤它（第 3 轮美学）
          r.queued.length > 0 && (
            <span className="queue">
              {r.queued.map((q, i) => (
                <span key={i} className="queued" role="status" data-testid="reading-queued" title={q.text}>
                  <Codicon name="history" size={12} />
                  <span className="truncate">
                    {i === 0 ? '答完上一问自动发出' : '再接着发'}
                    {q.page ? `（带第${q.page}页）` : ''}：{q.text}
                  </span>
                  <button className="lnk" onClick={() => R.cancelQueued(pdf, i)}>
                    不发了
                  </button>
                </span>
              ))}
            </span>
          )
        }
      />
    </aside>
  )
}

function Msg(p: {
  m: ReadingMsg
  sep: string | null
  flash: boolean
  last: boolean
  /** 「打开」用实心的 */
  primary: boolean
  running: boolean
  quote?: string
  onAgain(text: string): void
  onRephrase(text: string): void
  onOpen(path: string): void
  onOpenDiff(src: DiffSource, title: string): void
  /** 这条回答问的是什么（出错时「再问一次」「换个问法」用） */
  ask?: string
  busy: boolean
  engine: { id: string; label?: string }
  onShowNote(): void
  /** 撤回这一问 AI 改的文件（反向提交） */
  onRevert(): void
  onViz(): void
  onOpenHtml(path: string): void
  /** 这条回答里问过的那几句（旁支）：虚线 + 小标 */
  marks?: Mark[]
}) {
  const { m } = p
  const cmd = isCmdTurn(m)
  const proposal = useProposal(m.proposal ?? null)
  // 问过的那几句：答完以后在画好的字上划虚线、插小标（marks.ts）；有小标时字一变 .txt 整块换掉（key），React 不去动改过的节点；
  // 没有小标时不换（答着时每来一段字都整块重画，回答里的表格、公式会一闪一闪地换成新的节点）
  const txt = useRef<HTMLDivElement>(null)
  const marksKey = JSON.stringify(p.marks ?? [])
  useLayoutEffect(() => {
    if (!txt.current || !p.marks?.length || p.running) return
    return applyMarks(txt.current, p.marks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksKey, m.text, p.running])
  // 框的那块（或整页）：放在这一问的气泡最上面
  const crop = m.image ? (
    <div className="att">
      <img src={vaultImg(m.image)} alt={m.page ? `第 ${m.page} 页框的那块` : '框的那块'} />
    </div>
  ) : null
  return (
    <>
      {p.sep && <div className="daysep">{p.sep}</div>}
      {m.role === 'user' ? (
        <div className={'um-wrap' + (p.flash ? ' flash' : '')} data-thread={p.sep ? m.thread : undefined}>
          {/* 以前粘贴的图（没有材料那时候）照旧画在气泡上面；带材料的图在气泡里那一排列表里 */}
          {!m.mats?.length &&
            m.pasted?.map((n) => (
              <div key={n} className="att">
                <img src={pastedUrl(n)} alt="粘贴的图" />
              </div>
            ))}
          {p.quote && <div className="uq">「{p.quote}」</div>}
          {m.mats?.length ? (
            <MatMsg text={m.text} mats={m.mats} lead={crop} onContextMenu={(e) => onMessageMenu(e, m.text)} />
          ) : (
            <div className={'um' + (crop ? ' wimg' : '')} onContextMenu={(e) => onMessageMenu(e, m.text)}>
              {crop}
              {crop ? <div className="ut">{m.text}</div> : m.text}
            </div>
          )}
        </div>
      ) : (
        <div className="am" data-testid="reading-msg" data-msg={m.id} data-src={m.page ? `AI的回答 · 第${m.page}页` : 'AI的回答'} onContextMenu={(e) => m.text && onMessageMenu(e, withoutVizMark(m.text).text)}>
          {/* 出错的那条不写「✓ 读了第几页」：没答出来，下面红字说为什么 */}
          {m.text && !m.error && m.read && (
            <div className="read">
              <Codicon name="check" size={12} className="ok" />
              <span className="rd">{m.read}</span>
              {m.by && (
                <span className="by">
                  {' · '}
                  <ByLogo by={m.by} />
                  {m.by}
                </span>
              )}
            </div>
          )}
          {/* AI 动手的每一步（DESIGN.v3 2.3）：在做转圈、做完绿勾、出错红叉跟原因；全能模式下它自己跑命令、写文件也写成人话 */}
          {m.steps?.map((s) => (
            <StepRow key={s.id} s={s} />
          ))}
          {!m.text && !m.error && !m.cant && !m.steps?.length && <div className="thinking">正在想…</div>}
          {m.text && (
            <div className="txt md" key={p.marks?.length ? m.text : 'txt'} ref={txt}>
              <Markdown text={hideToolMarkup(withoutVizMark(m.text).text)} math />
            </div>
          )}
          {m.cant && <AiError raw={m.cant} own />}
          {m.error && <AiError raw={m.error} engine={p.engine} {...(p.ask && !p.busy ? { onRetry: () => p.onAgain(p.ask!), onRephrase: () => p.onRephrase(p.ask!) } : {})} />}
          {/* / 命令的结果（task-69r0v，照 AI 对话里命令结果的样子）：写进去的那一篇「打开」、先给你看的「收下」「不要」「看改动」，下面是改动块和撤回 */}
          {cmd && proposal && (
            <div className="acts">
              <button className="btn btn-sm" onClick={() => void proposal.take()}>
                {/* 少了整节、命令没说要删（task-1l29q）：同中间底下那一条，叫「照样收下」 */}
                {proposal.warn ? '照样收下' : '收下'}
              </button>
              <button className="btn btn-sm" onClick={proposal.drop}>
                不要
              </button>
              <button className="btn btn-sm" onClick={() => p.onOpenDiff({ kind: 'proposal', id: proposal.id }, `${proposal.title} · /${proposal.name} 改的`)}>
                看改动
              </button>
            </div>
          )}
          {cmd && m.open && !m.change?.reverted && !m.error && !m.cant && (
            <div className="acts">
              <button className={'btn btn-sm' + (p.primary ? ' btn-primary' : '')} onClick={() => p.onOpen(m.open!.path)}>
                打开
              </button>
            </div>
          )}
          {!cmd && p.last && m.text && !m.error && (
            <div className="acts">
              <button className="btn btn-xs" onClick={() => p.onAgain('还是不懂')}>
                <Codicon name="question" size={12} />
                还是不懂
              </button>
              <button className="btn btn-xs" onClick={() => p.onAgain('换个方式讲')}>
                <Codicon name="discard" size={12} />
                换个方式讲
              </button>
              {m.vizOk && !m.viz && (
                <button className="btn btn-xs" onClick={p.onViz}>
                  <Codicon name="preview" size={12} />
                  做个可视化
                </button>
              )}
            </div>
          )}
          {m.note === 'writing' && (
            <div className="noted">
              <Codicon name="loading" size={12} className="spin" />
              正在记进笔记…
            </div>
          )}
          {m.note === 'done' && (
            <div className="noted">
              <Codicon name="check" size={12} />
              {m.noteTo ? (
                `已记进${m.noteTo}`
              ) : (
                <>
                  {'已记进笔记 · '}
                  <button className="lnk" onClick={p.onShowNote}>
                    {`第${m.page ?? ''}页`}
                    <Codicon name="chevron-right" size={12} />
                  </button>
                </>
              )}
            </div>
          )}
          {m.note === 'error' && <div className="noted err">没记进笔记：{m.noteError}</div>}
          {m.change && <ChangeBlock change={m.change} onRevert={p.onRevert} />}
          {m.warn && <div className="noted err">{m.warn}</div>}
          {m.vizOk && !m.viz && !(p.last && m.text && !m.error) && (
            <div className="acts">
              <button className="btn btn-xs" onClick={p.onViz}>
                <Codicon name="preview" size={12} />
                做个可视化
              </button>
            </div>
          )}
          {m.viz?.state === 'making' && (
            <div className="vizpill" role="status">
              <Codicon name="loading" size={14} className="spin" />
              后台在做可视化 · 好了会挂进笔记，可以接着问
            </div>
          )}
          {m.viz?.state === 'done' && (
            <div className="vizpill done">
              <Codicon name="preview" size={14} />
              <span className="truncate">可视化做好了：{m.viz.path.split('/').pop()}</span>
              <button className="btn btn-xs btn-primary" onClick={() => p.onOpenHtml((m.viz as { path: string }).path)}>
                打开
              </button>
            </div>
          )}
          {m.viz?.state === 'error' && (
            <div className="noted err">
              没做成可视化：{m.viz.error}
              <button className="lnk" onClick={p.onViz}>
                再试一次
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
