/**
 * AI 标签（2026-11-20 工作区方向 A「拖到哪就在哪」：右栏里的一个标签，在哪由 shell/Dock.tsx 管）里面画什么，和笔记标签（NotesDock）。
 *
 * AI 标签里是两样之一：
 * - 别处（文件、文件夹、首页、收件箱……）的 AI 对话：AiPanel，一直挂着，关上只是藏起来，正在生成的那一轮不断；
 * - 读 PDF / HTML、右栏网页上框着问：读 PDF 的 AI（ReadingAi）；旁支就地长在被问那句所在的那一段下面（2026-11-21 方向 A，task-4edsc）。
 * 笔记是另一个标签（NotesDock：这份 PDF 的笔记 ReadingNotes），能和 AI 同时看。读 PDF 的 AI 只在 AI 标签开着时挂上
 * （框一块时它刚出来，预填的字能全选、光标进得去）。
 *
 * 对话跟着地方走（D 组 CN-132）：每个文件、文件夹、首页、收件箱各存各的（ai-chats.ts），读 PDF 的按来源存（reading/store.ts）。
 * 头上「地方名 ⌄」菜单里点别处的一段：这一格换成那段对话（读 PDF 的用读 PDF 那一套显示、接着问），「看得到」那一行换成
 * 「这是在「X」问的 · 回到「周记」」；换了页面、右键「问 AI」、跑 AI 命令、框一块时回到这里。
 */
import { useEffect, useRef, useState } from 'react'
import { isBookDigest } from '../shared/plugins/weread'
import { AiPanel, type AiPanelProps } from './AiPanel'
import type { DockNav } from './ai-head'
import * as C from './ai-chats'
import { useChatJump } from './chat-jump'
import { dropPicked, usePicked } from './ai-pick'
import { placeOf, readKey, readLabel, readSrc } from './ai-place'
import { ReadingAi } from './reading/ReadingAi'
import { ReadingNotes } from './reading/ReadingNotes'
import * as R from './reading/store'
import './reading/reading.css'
import './reading/side.css'
import './side/side-inline.css'
import { useT } from './i18n'
import { takeStay } from './ai-stay'
import { clearStay, setShown, setStay, stayOf, useStays, useWantConvo, wantDone } from './ai-web-stay'
import { useKeyHandler } from './keys'

export interface AiDockProps {
  /** AI 标签开着（在哪一组里都算，在别的标签后面也算） */
  open: boolean
  /** 看得见（是它那一组前面那个） */
  shown: boolean
  /** 中间栏开着的 PDF / HTML，或右栏网页上框着问的「web:<网址>」；别处是 null */
  reading: string | null
  /** 开笔记标签（「在笔记里看」「已记进笔记 ›」）：没开就开上，在别的标签后面就换到它 */
  onShowNotes(): void
  onClose(): void
  /** 别处的 AI 对话要的（AiPanel） */
  chat: Omit<AiPanelProps, 'hidden' | 'onClose' | 'place' | 'nav' | 'digest'>
  onOpenHtml(path: string): void
  onNotice(text: string): void
}

/** 读 PDF 时文件树多选「问AI」的那段对话的 key（不混进读 PDF 的对话；每次重新选了「问AI」从头开始） */
const PICKED_KEY = 'picked'

/** 这个地方问了几问（读进来了的才知道；没读进来的菜单里用主进程记的） */
function asksOf(key: string): number | null {
  const src = readSrc(key)
  if (src) {
    const r = R.get(src)
    return r.loaded ? r.state.msgs.filter((m) => m.role === 'user').length : null
  }
  const c = C.chatOf(key)
  return c.loaded ? c.msgs.filter((m) => m.role === 'user').length : null
}

/** 开着的这篇是不是书摘（认开头的 bookId，同标签上的书摘图标）：是的话头上胶囊和「看得到」写短书名「书摘：趣说明朝276年」 */
function useDigest(chat: AiDockProps['chat']): boolean {
  const path = chat.tab?.type === 'note' ? chat.tab.path : null
  const [seen, setSeen] = useState<{ path: string; yes: boolean } | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    const d = chat.doc()
    const text = d && d.path === path ? Promise.resolve(d.text) : window.cn.readNote(path).then((n) => n.text)
    void text.then((t) => live && setSeen({ path, yes: isBookDigest(t.slice(0, 4000)) }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  return !!path && seen?.path === path && seen.yes
}

export function AiDock(props: AiDockProps) {
  const t = useT()
  const { reading } = props
  const digest = useDigest(props.chat)
  const herePlace = placeOf(props.chat.tab, digest)
  const hereReading = R.useReading(reading)
  const here = reading ? { key: readKey(reading), label: readLabel(reading, [...(hereReading?.state.threads ?? [])].reverse().find((t) => t.web)?.web?.title) } : herePlace
  /** 菜单里点开的别处那段对话；null 是这里的。stay：从 AI 回答里的引用 ⌘点开了别的一篇，右栏留在原来那段（ai-stay.ts） */
  const [away, setAway] = useState<{ key: string; label: string; stay?: boolean } | null>(null)
  /** 上一次画的时候这一格看着的那段对话（中间换了一篇时，从引用点开的要留在它上面） */
  const shown = useRef<{ key: string; label: string } | null>(null)
  // 换了页面、右键「问 AI」带进引文、跑 AI 命令、在这份 PDF 上框了一块：回到这里的对话。
  // 从 AI 回答里的引用 ⌘点开的那一篇（task-3e53q 已定 3）：不跟着换，留在刚才看着的那段，头上给「切到《X》的 AI」
  useEffect(() => {
    const prev = shown.current
    if (takeStay() && props.shown && prev && prev.key !== here.key) setAway({ ...prev, stay: true })
    else setAway(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here.key, props.chat.autoRun?.seq, props.chat.draft?.seq])
  /**
   * 中间开着 PDF 时文件树多选「问AI」（task-0tgz2）：这一格换成普通的 AI 对话（选中的那几篇在「看得到」里），
   * 存成单独一段「选中的N个」，读 PDF 的对话不动；对话菜单点了哪一段、在 PDF 上框了一块、换了标签就回到读 PDF 那一格
   */
  const picked = usePicked()
  const pickOverPdf = !!picked && !!reading && picked.tab === (props.chat.tab?.id ?? null)
  // 重新选了一次「问AI」：上一回问别的几篇的那段清掉，从打招呼开始
  useEffect(() => {
    if (pickOverPdf) C.clear(PICKED_KEY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked])
  useEffect(() => {
    if (hereReading?.pending) {
      setAway(null)
      if (pickOverPdf) dropPicked()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hereReading?.pending])
  // 看的那段被清掉了（别处点了新对话）不用管：菜单里没有了，点「回到」照常回来
  const pickAway = (c: { key: string; label: string } | null) => {
    if (pickOverPdf) dropPicked()
    setAway(c)
  }
  // 文档里点了「回到 AI 对话」（task-83vl3）：是这里的对话就回到这里，别处的当「看别处的对话」打开（名字照对话菜单里的）
  const jump = useChatJump()
  useEffect(() => {
    if (!jump) return
    if (jump.key === here.key) return pickAway(null)
    let live = true
    void C.flush()
      .then(() => window.cn.aiChats())
      .then((l) => live && pickAway({ key: jump.key, label: l.find((c) => c.key === jump.key)?.label ?? C.chatOf(jump.key).label }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.seq])
  // 网页上的引用、讲解要进别的一段（ai-web-stay.ts，偏好「引用留在当前对话」）：换到那段
  const want = useWantConvo()
  useEffect(() => {
    if (!want) return
    wantDone(want.seq)
    pickAway(want.key === here.key ? null : { key: want.key, label: want.label })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want?.seq])
  // 「留在这个对话」：看着别处的对话、这里是右栏网页自己那段时给这颗；留过的（右栏开着的网页留在看着的这段）那一行不再出
  useStays()
  const web = props.chat.webOpen && props.chat.webUrl && /^https?:/i.test(props.chat.webUrl) ? props.chat.webUrl : null
  const stayed = web ? stayOf(web) : null
  const ownWeb = reading?.startsWith('web:') ? reading.slice(4) : null
  const nav: DockNav = {
    here,
    away,
    // 自己在菜单里、「回到」点了别的一段：这个网页不再留在原来那段
    pick: (c) => {
      if (web && stayed && (c?.key ?? here.key) !== stayed.key) clearStay(web)
      pickAway(c)
    },
    asks: asksOf,
    ...(away && !away.stay && ownWeb ? { stayHere: () => setStay(ownWeb, away) } : {}),
    ...(away && stayed?.key === away.key ? { stayed: true } : {}),
  }
  const awaySrc = away ? readSrc(away.key) : null
  /** 这一格显示的读 PDF 对话：看别处的读 PDF 对话时是它，不然是这里的（选中了几篇「问AI」时不显示） */
  const shownReading = pickOverPdf ? null : away ? awaySrc : reading
  const chatPlace = pickOverPdf ? { key: PICKED_KEY, label: t('选中的{n}个', { n: picked.items.length }) } : away && !awaySrc ? away : herePlace
  // 记下这一回看着的是哪段（effect 在上面那个之后跑：中间换了一篇的那一下，上面读到的还是换之前的）
  useEffect(() => {
    shown.current = away ? { key: away.key, label: away.label } : shownReading ? here : chatPlace
    setShown({ ...shown.current, open: props.open })
  })
  // 「右栏切到这篇的 AI」（命令 ai-follow）：在看别处的对话时回到这里（中间开着的这一篇）的
  useKeyHandler('ai-follow', away ? () => (pickAway(null), true) : null)
  return (
    <>
      <AiPanel {...props.chat} digest={digest} place={chatPlace} nav={nav} hidden={!props.shown || !!shownReading} onClose={props.onClose} />
      {shownReading && props.open && <ReadingCell key={shownReading} {...props} pdf={shownReading} nav={nav} />}
    </>
  )
}

/** 这份 PDF 的对话和笔记读进来；笔记在别处改了（中间栏当文档改、梦游、同步）重新读 */
function useReadingLive(pdf: string) {
  // 从别处点开的：这份 PDF 没开着，读出它的对话和笔记
  useEffect(() => {
    void R.load(pdf)
  }, [pdf])
  useEffect(() => {
    const note = R.get(pdf).note.path
    const offA = window.cn.onFilesChanged(() => void R.reloadNote(pdf))
    const offB = window.cn.onNoteChanged((p) => p === note && void R.reloadNote(pdf))
    return () => {
      offA()
      offB()
    }
  }, [pdf])
}

function ReadingCell(props: AiDockProps & { pdf: string; nav: DockNav }) {
  const { pdf } = props
  useReadingLive(pdf)
  return (
    <ReadingAi
      pdf={pdf}
      onOpenDiff={props.chat.onOpenDiff}
      onCloseDiff={props.chat.onCloseDiff}
      onOpen={props.chat.onOpen}
      hidden={!props.shown}
      nav={props.nav}
      onShowNote={(id) => {
        if (R.isWebSrc(pdf)) return
        props.onShowNotes()
        R.focusSection(pdf, id)
      }}
      onShowNotes={() => !R.isWebSrc(pdf) && props.onShowNotes()}
      onOpenHtml={props.onOpenHtml}
      onNotice={props.onNotice}
      onCollapse={props.onClose}
    />
  )
}

/** 笔记标签：这份 PDF / HTML 的笔记（一份一篇，2026-11-20 起是独立的标签，能拖到任何位置） */
export function NotesDock(props: {
  pdf: string
  shown: boolean
  /** 开 AI 标签（笔记里「完整对话」） */
  onShowAi(): void
  onOpenNote(path: string): void
  onOpenLink(target: string): void
  onOpenHtml(path: string): void
  onOpenWeb(url: string): void
}) {
  const { pdf } = props
  useReadingLive(pdf)
  return (
    <ReadingNotes
      pdf={pdf}
      hidden={!props.shown}
      onOpenNote={props.onOpenNote}
      onOpenLink={props.onOpenLink}
      onOpenHtml={props.onOpenHtml}
      onOpenWeb={props.onOpenWeb}
      onShowConvo={(id) => {
        props.onShowAi()
        R.showConvo(pdf, id)
      }}
    />
  )
}
