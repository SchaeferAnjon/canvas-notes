/**
 * AI 标签里共用的几样（D 组「只有一个 AI」：读 PDF 和别处同一行对话、同一行「看得到」、同一个输入框位置）：
 * - AiHead：40 高的一行，「地方名 ⌄」对话菜单胶囊，右边「+」新对话（2026-11-20 工作区方向 A：「AI」两个字在标签上，收起是标签上的 ×、⌘J、⌘W）；
 * - Sees / Chip：头下面一行「看得到」，第一颗是这一页（带圆点），最后一颗「能动手：…」；
 * 谁来答、模型、effort 三颗在输入框底行（composer.tsx，CN-91 方向 C），头上没有引擎胶囊。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import type { ChatSummary } from '../shared/ai-chats'
import { when } from '../shared/when'
import * as C from './ai-chats'
import * as R from './reading/store'
import { useDismiss } from './use-dismiss'

/**
 * 这一格在看哪段对话（D 组 CN-132）：这里（当前页面）的，或者菜单里点开的别处的那段。
 * pick(null) 是回到这里；asks 数这里问了几问（菜单里「这里」那一行写「N问」，还没加载的地方读主进程记的）
 */
export interface DockNav {
  here: { key: string; label: string }
  away: { key: string; label: string } | null
  pick(c: { key: string; label: string } | null): void
  asks(key: string): number | null
}

export function AiHead(props: {
  /** 胶囊上写的：正在看的这段对话是哪里的 */
  label: string
  /** 对话菜单：这里 / 最近在别处问的 / 全部对话… */
  nav: DockNav
  /** 「+」的悬停说明 */
  newTip: string
  newDisabled?: boolean
  onNew(): void
}) {
  const [open, setOpen] = useState(false)
  // 对话菜单：点胶囊和菜单以外任何地方、按 Esc、窗口失焦都收起，再点胶囊是收起不是重开（CN-88）
  const box = useRef<HTMLDivElement>(null)
  useDismiss(open, [box], () => setOpen(false))
  return (
    <div className="aih">
      <div className="convbox" ref={box}>
        <button className={'conv' + (open ? ' open' : '')} data-testid="ai-conv" aria-label={`对话：${props.label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Codicon name="comment-discussion" size={13} className="ic" />
          <span className="t">{props.label}</span>
          <Codicon name="chevron-down" size={12} className="cv" />
        </button>
        {open && <ConvMenu nav={props.nav} close={() => setOpen(false)} />}
      </div>
      <span className="acts">
        <button aria-label="新对话" data-tip={props.newTip} data-side="below" disabled={props.newDisabled} onClick={props.onNew}>
          <Codicon name="add" size={16} />
        </button>
      </span>
    </div>
  )
}

/** 「最近在别处问的」列几条（全部在「全部对话…」里） */
const RECENT = 5

/**
 * 对话菜单（D 组小样 convMenu）：300 宽；「这里」一组（这个地方，没在看别处时打勾，右边「N问」或「还没问过」）、
 * 「最近在别处问的」（别的地方问过的，含读 PDF 的，按最近时间排，右边时间）、「全部对话…」（同一个菜单里列出全部，能滚）
 */
function ConvMenu(props: { nav: DockNav; close(): void }) {
  const { here, away } = props.nav
  const [list, setList] = useState<ChatSummary[] | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    let live = true
    // 刚问完、还没存盘的（存盘有 300 毫秒的等）先存掉，再问主进程要：刚问过的那份 PDF、那个地方也列得出来
    void Promise.all([R.flushSaves(), C.flush()])
      .then(() => window.cn.aiChats())
      .then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [])
  const pick = (c: { key: string; label: string } | null) => {
    props.close()
    props.nav.pick(c && c.key !== here.key ? c : null)
  }
  const hereAsks = props.nav.asks(here.key) ?? list?.find((c) => c.key === here.key)?.asks ?? 0
  const others = (list ?? []).filter((c) => c.key !== here.key)
  const row = (c: ChatSummary) => (
    <button key={c.key} className="it" role="menuitemradio" aria-checked={away?.key === c.key} onClick={() => pick(c)}>
      <span className="ck">{away?.key === c.key && <Codicon name="check" size={12} />}</span>
      <span className="lb">{c.label}</span>
      <span className="r">{when(c.at, { time: true })}</span>
    </button>
  )
  if (all)
    return (
      <div className="convmenu" role="menu" aria-label="对话">
        <div className="mh">全部对话</div>
        <div className="all">{(list ?? []).map(row)}</div>
      </div>
    )
  return (
    <div className="convmenu" role="menu" aria-label="对话">
      <div className="mh">这里</div>
      <button className="it" role="menuitemradio" aria-checked={!away} onClick={() => pick(null)}>
        <span className="ck">{!away && <Codicon name="check" size={12} />}</span>
        <span className="lb">{here.label}</span>
        <span className="r">{hereAsks ? `${hereAsks}问` : '还没问过'}</span>
      </button>
      {others.length > 0 && (
        <>
          <div className="sep" />
          <div className="mh">最近在别处问的</div>
          {others.slice(0, RECENT).map(row)}
        </>
      )}
      <div className="sep" />
      <button className="it" role="menuitem" onClick={() => setAll(true)}>
        <span className="ck">
          <Codicon name="history" size={12} />
        </span>
        <span className="lb">全部对话…</span>
      </button>
    </div>
  )
}

/** 在看别处的对话时，「看得到」那一行换成这一行：「这是在「X」问的 · 回到「周记」」 */
export function AwayBar(props: { nav: DockNav }) {
  const { here, away } = props.nav
  if (!away) return null
  return (
    <div className="away" data-testid="ai-away">
      <Codicon name="history" size={13} />
      <span className="tx">{`这是在「${away.label}」问的`}</span>
      <button onClick={() => props.nav.pick(null)}>{`回到「${here.label}」`}</button>
    </div>
  )
}

/**
 * 读 PDF 时 AI 那一格换成笔记：头「note 笔记 <名字> 笔记.md · 问着就记，不用整理」，右边「在中间打开」「收起 ⌘W」。
 * 收起只有这一颗（和 AI 那一页的「收起 ⌘J」同一个位置、同一个样子），不另外放 ×。
 * 左边和笔记正文、上格历史的头对齐（16、图标 16、间距 10）；后半句放不下时整句不露（不截半句），悬停看全
 */
/** 「看得到」那一行 */
export function Sees(props: { testid: string; children: React.ReactNode }) {
  return (
    <div className="sees" data-testid={props.testid}>
      <span className="k">看得到</span>
      {props.children}
    </div>
  )
}

/** 「看得到」里的一颗：on 是这一页（前面一个强调色圆点）；hands 是「能动手：…」（cursor 图标，透明底、1px 描边） */
export function Chip(props: { on?: boolean; hands?: boolean; title?: string; testid?: string; children: React.ReactNode }) {
  return (
    <span className={'chip' + (props.hands ? ' hands' : '')} title={props.title} data-testid={props.testid}>
      {props.on && <i className="dot" />}
      {props.hands && <Codicon name="cursor" size={12} />}
      {/* 名字太长（长标题的文档）时省略号，不撑出这一格 */}
      {typeof props.children === 'string' ? <span className="tx">{props.children}</span> : props.children}
    </span>
  )
}
