/**
 * 右栏 AI 那一格（D 组「只有一个 AI」方向 A：只住右栏）。AI 永远是右栏的一格：右下角圆钮（A 是底栏最右一项）或 ⌘J 开关，
 * 右栏开着网页、大纲、历史、插件那一格时在下半格（各一半高）；换页面位置、宽度不变（宽度是用户拖的右栏宽）。
 *
 * 格里是三样之一：
 * - 别处（文件、文件夹、首页、收件箱……）的 AI 对话：AiPanel，一直挂着，关上只是藏起来，正在生成的那一轮不断；
 * - 读 PDF / HTML、右栏网页上框着问：读 PDF 的 AI（ReadingAi）；
 * - 读 PDF 时竖条「笔记」：这份 PDF 的笔记（ReadingNotes），再点「笔记」回到 AI。
 * 读 PDF 的 AI 和笔记只在这一格开着时挂上（框一块时它刚出来，预填的字能全选、光标进得去），两个之间切换不丢输入框里的字。
 *
 * 对话跟着地方走（D 组 CN-132）：每个文件、文件夹、首页、收件箱各存各的（ai-chats.ts），读 PDF 的按来源存（reading/store.ts）。
 * 头上「地方名 ⌄」菜单里点别处的一段：这一格换成那段对话（读 PDF 的用读 PDF 那一套显示、接着问），「看得到」那一行换成
 * 「这是在「X」问的 · 回到「周记」」；换了页面、右键「问 AI」、跑 AI 命令、框一块时回到这里。
 */
import { useEffect, useState } from 'react'
import { isBookDigest } from '../shared/plugins/weread'
import { AiPanel, type AiPanelProps } from './AiPanel'
import type { DockNav } from './ai-head'
import * as C from './ai-chats'
import { placeOf, readKey, readLabel, readSrc } from './ai-place'
import { ReadingAi } from './reading/ReadingAi'
import { ReadingNotes } from './reading/ReadingNotes'
import { SideCell, splitOf } from './reading/side'
import * as R from './reading/store'
import './reading/reading.css'
import './reading/side.css'

/** 这一格显示 AI 还是笔记（笔记只在读 PDF / HTML 时有） */
export type AiView = 'ai' | 'notes'

export interface AiDockProps {
  open: boolean
  view: AiView
  /** 中间栏开着的 PDF / HTML，或右栏网页上框着问的「web:<网址>」；别处是 null */
  reading: string | null
  onView(v: AiView): void
  onClose(): void
  /** 别处的 AI 对话要的（AiPanel） */
  chat: Omit<AiPanelProps, 'hidden' | 'onClose' | 'place' | 'nav' | 'digest'>
  onOpenNote(path: string): void
  onOpenLink(target: string): void
  onOpenHtml(path: string): void
  onOpenDoubts(folder: string): void
  onOpenWeb(url: string): void
  onNotice(text: string): void
}

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
  const { reading } = props
  const digest = useDigest(props.chat)
  const herePlace = placeOf(props.chat.tab, digest)
  const hereReading = R.useReading(reading)
  const here = reading ? { key: readKey(reading), label: readLabel(reading, [...(hereReading?.state.threads ?? [])].reverse().find((t) => t.web)?.web?.title) } : herePlace
  /** 菜单里点开的别处那段对话；null 是这里的 */
  const [away, setAway] = useState<{ key: string; label: string } | null>(null)
  // 换了页面、右键「问 AI」带进引文、跑 AI 命令、在这份 PDF 上框了一块：回到这里的对话
  useEffect(() => setAway(null), [here.key, props.chat.autoRun?.seq, props.chat.draft?.seq])
  useEffect(() => {
    if (hereReading?.pending) setAway(null)
  }, [hereReading?.pending])
  // 看的那段被清掉了（别处点了新对话）不用管：菜单里没有了，点「回到」照常回来
  const nav: DockNav = { here, away, pick: setAway, asks: asksOf }
  const awaySrc = away ? readSrc(away.key) : null
  /** 这一格显示的读 PDF 对话：看别处的读 PDF 对话时是它，不然是这里的 */
  const shownReading = away ? awaySrc : reading
  const chatPlace = away && !awaySrc ? away : herePlace
  return (
    <>
      <AiPanel {...props.chat} digest={digest} place={chatPlace} nav={nav} hidden={!props.open || !!shownReading} onClose={props.onClose} />
      {shownReading && props.open && <ReadingCell key={shownReading} {...props} pdf={shownReading} nav={nav} notes={!away} />}
    </>
  )
}

function ReadingCell(props: AiDockProps & { pdf: string; nav: DockNav; notes: boolean }) {
  const { pdf } = props
  // 笔记只有 PDF、HTML 有（右栏网页上框着问的问完记进中间开着的文档或收件箱）；从别处点开的读 PDF 对话只看 AI
  const notes = props.notes && !R.isWebSrc(pdf)
  const which: AiView = notes ? props.view : 'ai'
  // 旁支开在这一格的下格（CN-90 方向 A）：上格照旧是 AI 或笔记，换着看时下格照旧能问
  const r = R.useReading(pdf)
  const split = r ? splitOf(r) : null
  // 从别处点开的：这份 PDF 没开着，读出它的对话和笔记
  useEffect(() => {
    void R.load(pdf)
  }, [pdf])
  // 笔记在别处改了（中间栏当文档改、梦游、同步）：重新读
  useEffect(() => {
    const note = R.get(pdf).note.path
    const offA = window.cn.onFilesChanged(() => void R.reloadNote(pdf))
    const offB = window.cn.onNoteChanged((p) => p === note && void R.reloadNote(pdf))
    return () => {
      offA()
      offB()
    }
  }, [pdf])
  return (
    <>
      <ReadingAi
        pdf={pdf}
        hidden={which !== 'ai'}
        nav={props.nav}
        onShowNote={(id) => {
          props.onView('notes')
          R.focusSection(pdf, id)
        }}
        onOpenHtml={props.onOpenHtml}
        onNotice={props.onNotice}
        onCollapse={props.onClose}
        split={split}
      />
      {notes && (
        <ReadingNotes
          pdf={pdf}
          hidden={which !== 'notes'}
          split={split}
          onOpenNote={props.onOpenNote}
          onOpenLink={props.onOpenLink}
          onOpenHtml={props.onOpenHtml}
          onOpenDoubts={props.onOpenDoubts}
          onOpenWeb={props.onOpenWeb}
          onShowConvo={(id) => {
            props.onView('ai')
            R.showConvo(pdf, id)
          }}
          onCollapse={props.onClose}
        />
      )}
      {split && <SideCell pdf={pdf} view={which} onView={(v) => notes && props.onView(v)} onNotice={props.onNotice} />}
    </>
  )
}
