/**
 * AI 标签里共用的几样（D 组「只有一个 AI」：读 PDF 和别处同一行对话、同一行「看得到」、同一个输入框位置）：
 * - AiHead：40 高的一行，「地方名 ⌄」对话菜单胶囊，右边「+」新对话（2026-11-20 工作区方向 A：「AI」两个字在标签上，收起是标签上的 ×、⌘J、⌘W）；
 * - Sees / Chip：头下面一行「看得到」，第一颗是这一页（带圆点），最后一颗「能动手：…」；
 * 谁来答、模型、effort 三颗在输入框底行（composer.tsx，CN-91 方向 C），头上没有引擎胶囊。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { type ConvoRow, type ConvPages, hostOf, NO_PAGE, pageOfConvo, readSrc } from '../shared/ai-chats'
import { pagesNow, usePages } from './ai-pages'
import { when } from '../shared/when'
import * as C from './ai-chats'
import * as R from './reading/store'
import { useDismiss } from '@cn/ai-chat/use-dismiss'
import { useT } from './i18n'
import { useKey } from './keys'
import { composing } from './ime'

/**
 * 这一格在看哪段对话（D 组 CN-132）：这里（当前页面）的，或者菜单里点开的别处的那段。
 * pick(null) 是回到这里；asks 数这里问了几问（菜单里「这里」那一行写「N问」，还没加载的地方读主进程记的）
 */
export interface DockNav {
  here: { key: string; label: string }
  /** kept：换了页面（含从 AI 回答里的引用 ⌘点开一篇），右栏留在这段（AI 对话绑页面方向 A，AiDock） */
  away: { key: string; label: string; kept?: boolean } | null
  pick(c: { key: string; label: string } | null): void
  asks(key: string): number | null
  /** 「留在这个对话」：这里是右栏网页自己那段、看着别处的那段时有（之后这个网页的引用、讲解都进看着的那段，ai-web-stay.ts） */
  stayHere?(): void
  /** 右栏开着的网页留在看着的这段了：「这是在《X》问的」那一行不再出 */
  stayed?: boolean
  /** 中间这一页有几段对话（不算正看着的这段）：头上那一行「这页有 N 段对话 · 打开」 */
  hereCount?: number
  /** 换页时接上了这一页的对话：每接一次加一，胶囊闪一下 */
  joined?: number
  /** 看着的别处那段挂在这一页上（搬过来的、这页收起来的）：照这一页的样子画（「看得到」那一行，不出「这是在…问的」） */
  onPage?: boolean
  /** 对话菜单里点了一段：那个地方的那段（id 是点「+」收起来的那段），回到它接着问 */
  openRow(r: { key: string; label: string; id?: number }): void
  /** 「挂到这一页」：看着的这段搬到中间这一页（一段只挂一页）；不能搬时没有 */
  bindHere?(): void
  /** 「不挂任何页」 */
  unbind?(): void
}

/** 对话菜单「之前的对话」里的一段（读 PDF 点「+」收起来的，点了切回） */
export interface OlderChat {
  id: number
  /** 那段第一问的原话 */
  label: string
  /** 最后一次问答的时间 */
  at: number
  asks: number
  pick(): void
  /** 正在答：先不能切 */
  disabled?: boolean
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
  /** 这里以前的几段（读 PDF 的「+」收起来的） */
  older?: OlderChat[]
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // 对话菜单：点胶囊和菜单以外任何地方、按 Esc、窗口失焦都收起，再点胶囊是收起不是重开（CN-88）
  const box = useRef<HTMLDivElement>(null)
  useDismiss(open, [box], () => setOpen(false))
  return (
    <div className="aih">
      <div className="convbox" ref={box}>
        <button key={props.nav.joined ?? 0} className={'conv' + (open ? ' open' : '') + (props.nav.joined ? ' joined' : '')} data-testid="ai-conv" aria-label={t('对话：{name}', { name: props.label })} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Codicon name="comment-discussion" size={13} className="ic" />
          <span className="t">{props.label}</span>
          <Codicon name="chevron-down" size={12} className="cv" />
        </button>
        {open && <ConvMenu nav={props.nav} older={props.older ?? []} close={() => setOpen(false)} />}
      </div>
      <span className="acts">
        <button aria-label={t('新对话')} data-tip={props.newTip} data-side="below" disabled={props.newDisabled} onClick={props.onNew}>
          <Codicon name="add" size={16} />
        </button>
      </span>
    </div>
  )
}

/** 「这里」先列几段、「最近在别处问的」列几页（全部在「全部对话…」里） */
const RECENT = 5

/** 一页（「最近在别处问的」一行、「全部对话」一组）：网页按网站归，没挂页面的、找回的各一组 */
interface PageGroup {
  key: string
  name: string
  /** 灰色小字的路径「课程 › study project 2」（网页、首页这些没有） */
  path: string
  rows: ConvoRow[]
}

const dirsOf = (p: string) => p.split('/').slice(0, -1)

/** 这一页在哪个文件夹里（「课程 › study project 2」） */
function pathOf(page: string): string[] {
  if (page.startsWith('file:')) return dirsOf(page.slice(5))
  if (page.startsWith('folder:')) return dirsOf(page.slice(7))
  const src = readSrc(page)
  if (src && !src.startsWith('web:')) return dirsOf(src)
  return []
}

/** 这段归哪一组：挂的那页；网页按网站；没挂页面、找回的各一组 */
function groupOf(r: ConvoRow, pages: ConvPages, t: ReturnType<typeof useT>): { key: string; name: string; path: string[] } {
  const page = pageOfConvo(r.key, pages)
  if (page === NO_PAGE) return { key: NO_PAGE, name: t('没挂页面'), path: [] }
  if (page === 'recovered') return { key: page, name: t('找回的对话'), path: [] }
  const src = readSrc(page)
  if (src?.startsWith('web:')) {
    const host = hostOf(src.slice(4))
    return { key: `site:${host}`, name: host, path: [] }
  }
  // 搬过来挂到这页的：名字是表里记的那页的名字
  const name = page === r.key ? r.label : (pages[r.key]?.label ?? r.label)
  return { key: page, name, path: pathOf(page) }
}

function groupRows(rows: ConvoRow[], pages: ConvPages, t: ReturnType<typeof useT>): PageGroup[] {
  const m = new Map<string, PageGroup>()
  for (const r of rows) {
    const g = groupOf(r, pages, t)
    const had = m.get(g.key)
    if (had) had.rows.push(r)
    else m.set(g.key, { key: g.key, name: g.name, path: g.path.join(' › '), rows: [r] })
  }
  // 组按最近问的排；组里新的在前
  return [...m.values()].map((g) => ({ ...g, rows: g.rows.sort((a, b) => b.at - a.at) })).sort((a, b) => b.rows[0]!.at - a.rows[0]!.at)
}

const sameRow = (a: { key: string; id?: number }, b: { key: string; id?: number }) => a.key === b.key && a.id === b.id

/**
 * 对话菜单（2026-11-24 用户「对话菜单按文件夹和页归组」）：
 * - 「这里」：这一页的几段（现在这段、点「+」收起来的、挂到这页的），新的在上，一行是第一句话 + 时间 · 几问，正看着的打勾，多于 5 段收成「还有 N 段…」；
 * - 「最近在别处问的」：一行一页（页名 + 灰色路径 +「3 段 · 今天 13:35」），点页名回到那页最近那段，右边箭头展开那页的几段；网页按网站归；
 * - 「挂到这一页《X》」「不挂任何页」（看着的这段能挂、挂着时才有）、「全部对话…」（按文件夹归组、能搜，见 AllConvos）
 */
function ConvMenu(props: { nav: DockNav; older: OlderChat[]; close(): void }) {
  const t = useT()
  const { here, away } = props.nav
  const [rows, setRows] = useState<ConvoRow[] | null>(null)
  const [all, setAll] = useState(false)
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  usePages()
  const pages = pagesNow()
  useEffect(() => {
    let live = true
    // 刚问完、还没存盘的（存盘有 300 毫秒的等）先存掉，再问主进程要：刚问过的那份 PDF、那个地方也列得出来
    void Promise.all([R.flushSaves(), C.flush()])
      .then(() => window.cn.aiConvos())
      .then((l) => live && setRows(l))
    return () => {
      live = false
    }
  }, [])
  const go = (r: ConvoRow | { key: string; label: string; id?: number }) => {
    props.close()
    props.nav.openRow(r)
  }
  /** 正看着的那段：别处的那段，或这里现在这段 */
  const shown = { key: away?.key ?? here.key }
  // 这一页收起来的几段：看着这里时照这一格读进来的（读 PDF 的旧记录读进来时才拆成几段），看着别处时照主进程记的
  const olderHere: ConvoRow[] | null = away ? null : props.older.map((o) => ({ key: here.key, id: o.id, first: o.label, label: here.label, at: o.at, asks: o.asks, hay: o.label }))
  const list = olderHere ? (rows ?? []).filter((r) => !(r.key === here.key && r.id !== undefined)).concat(olderHere) : (rows ?? [])
  const onHere = (r: ConvoRow) => r.key === here.key || pageOfConvo(r.key, pages) === here.key
  const mine = list.filter(onHere).sort((a, b) => b.at - a.at)
  // 这里现在这段还没问过：照样一行（「还没问过」，问过以前几段写「新对话」），点了回到它
  const hereNow = !mine.some((r) => r.key === here.key && r.id === undefined)
  const hereAsks = props.nav.asks(here.key) ?? 0
  const groups = groupRows(
    list.filter((r) => !onHere(r)),
    pages,
    t,
  )
  const busy = (r: ConvoRow) => r.id !== undefined && !!props.older.find((o) => o.id === r.id)?.disabled
  const timeOf = (at: number) => (at ? when(at, { time: true }) : '')
  const convRow = (r: ConvoRow, sub = false) => {
    const on = sameRow(r, shown) && r.id === undefined
    return (
      <button
        key={`${r.key}#${r.id ?? ''}`}
        className={'it' + (sub ? ' sub' : '')}
        role="menuitemradio"
        aria-checked={on}
        data-testid={r.id !== undefined ? 'ai-older' : 'ai-convo'}
        disabled={busy(r)}
        title={busy(r) ? t('答完再切') : `${r.first || r.label} · ${t('{n}问', { n: r.asks })}`}
        onClick={() => go(r)}
      >
        <span className="ck">{on && <Codicon name="check" size={12} />}</span>
        <span className="lb">{r.first || r.label}</span>
        <span className="r">{sub ? timeOf(r.at) : [timeOf(r.at), t('{n}问', { n: r.asks })].filter(Boolean).join(' · ')}</span>
      </button>
    )
  }
  if (all) return <AllConvos rows={list} groups={[...(mine.length ? [{ key: here.key, name: t('这一页 · {name}', { name: here.label }), path: '', rows: mine }] : []), ...groups]} shown={shown} onPick={go} />
  const hereRows = mine.slice(0, more ? undefined : hereNow ? RECENT - 1 : RECENT)
  const hidden = mine.length - hereRows.length
  const shownPage = pageOfConvo(shown.key, pages)
  return (
    <div className="convmenu" role="menu" aria-label={t('对话')}>
      <div className="mh">{t('这里')}</div>
      {hereNow && (
        <button className="it" role="menuitemradio" aria-checked={!away} data-testid="ai-convo" onClick={() => go({ key: here.key, label: here.label })}>
          <span className="ck">{!away && <Codicon name="check" size={12} />}</span>
          <span className="lb">{here.label}</span>
          <span className="r">{hereAsks ? t('{n}问', { n: hereAsks }) : mine.length ? t('新对话') : t('还没问过')}</span>
        </button>
      )}
      {hereRows.map((r) => convRow(r))}
      {hidden > 0 && (
        <button className="it more" role="menuitem" onClick={() => setMore(true)}>
          <span className="ck" />
          <span className="lb">{t('还有 {n} 段…', { n: hidden })}</span>
        </button>
      )}
      {groups.length > 0 && (
        <>
          <div className="sep" />
          <div className="mh">{t('最近在别处问的')}</div>
          {groups.slice(0, RECENT).map((g) => {
            const on = g.rows.some((r) => sameRow(r, shown))
            const n = g.rows.length
            return (
              <div key={g.key} className="pgrp">
                <div className="pgrow">
                  <button className="it pg" role="menuitemradio" aria-checked={on} data-testid="ai-page" title={[g.path, g.name].filter(Boolean).join(' › ')} onClick={() => go(g.rows[0]!)}>
                    <span className="ck">{on && <Codicon name="check" size={12} />}</span>
                    <span className="lb">{g.name}</span>
                    {g.path && <span className="path">{g.path}</span>}
                    <span className="r">{[t('{n} 段', { n }), timeOf(g.rows[0]!.at)].filter(Boolean).join(' · ')}</span>
                  </button>
                  <button className={'fold' + (open === g.key ? ' open' : '')} aria-label={t('展开《{name}》的几段', { name: g.name })} aria-expanded={open === g.key} onClick={() => setOpen((x) => (x === g.key ? null : g.key))}>
                    <Codicon name="chevron-right" size={12} />
                  </button>
                </div>
                {open === g.key && g.rows.map((r) => convRow(r, true))}
              </div>
            )
          })}
        </>
      )}
      <div className="sep" />
      {props.nav.bindHere && shownPage !== here.key && (
        <button className="it" role="menuitem" onClick={() => (props.close(), props.nav.bindHere!())}>
          <span className="ck">
            <Codicon name="pin" size={12} />
          </span>
          <span className="lb">{t('挂到这一页《{name}》', { name: here.label })}</span>
        </button>
      )}
      {props.nav.unbind && shownPage !== NO_PAGE && (
        <button className="it" role="menuitem" onClick={() => (props.close(), props.nav.unbind!())}>
          <span className="ck">
            <Codicon name="close" size={12} />
          </span>
          <span className="lb">{t('不挂任何页')}</span>
        </button>
      )}
      <button className="it" role="menuitem" onClick={() => setAll(true)}>
        <span className="ck">
          <Codicon name="history" size={12} />
        </span>
        <span className="lb">{t('全部对话…')}</span>
      </button>
    </div>
  )
}

/** 「全部对话」：同一个菜单里换成按文件夹、页归组的全部（「课程 › study project 2 › 情绪识别调研 · 3 段」），这一页的在最上面，能搜，点一段回到它接着问 */
function AllConvos(props: { rows: ConvoRow[]; groups: PageGroup[]; shown: { key: string }; onPick(r: ConvoRow): void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (g: PageGroup, r: ConvoRow) => {
    const text = `${r.first}\n${r.hay}\n${g.name}\n${g.path}`.toLowerCase()
    return words.every((w) => text.includes(w))
  }
  const shownGroups = props.groups.map((g) => ({ ...g, rows: g.rows.filter((r) => hit(g, r)) })).filter((g) => g.rows.length)
  return (
    <div className="convmenu wide" role="menu" aria-label={t('对话')}>
      <div className="mh">{t('全部对话')}</div>
      <input className="find" type="search" autoFocus placeholder={t('搜对话')} aria-label={t('搜对话')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => !composing(e) && e.key === 'Enter' && shownGroups[0] && props.onPick(shownGroups[0].rows[0]!)} />
      <div className="all">
        {shownGroups.map((g) => (
          <div key={g.key} className="agrp" data-testid="ai-all-group">
            <div className="gh" title={[g.path, g.name].filter(Boolean).join(' › ')}>
              {g.path && <span className="path">{g.path} › </span>}
              <span className="nm">{g.name}</span>
              <span className="n">{` · ${t('{n} 段', { n: g.rows.length })}`}</span>
            </div>
            {g.rows.map((r) => {
              const on = sameRow(r, props.shown) && r.id === undefined
              return (
                <button key={`${r.key}#${r.id ?? ''}`} className="it sub" role="menuitemradio" aria-checked={on} data-testid="ai-all-row" onClick={() => props.onPick(r)}>
                  <span className="ck">{on && <Codicon name="check" size={12} />}</span>
                  <span className="lb">{r.first || r.label}</span>
                  <span className="r">{when(r.at, { time: true })}</span>
                </button>
              )
            })}
          </div>
        ))}
        {!shownGroups.length && <div className="none">{q ? t('没搜到') : t('还没问过')}</div>}
      </div>
    </div>
  )
}

/**
 * 在看别处的对话时，「看得到」那一行换成这一行：「这是在《X》问的 · 回到《周记》」。
 * 换了页面右栏留着刚才那段（away.kept，AI 对话绑页面方向 A）：「这是在《X》问的 · 这页有 N 段对话 · 打开 ⌥⌘J」，这页没对话时「切到《Y》的 AI ⌥⌘J」
 */
export function AwayBar(props: { nav: DockNav }) {
  const t = useT()
  const key = useKey('ai-follow')
  const { here, away } = props.nav
  if (!away || (props.nav.stayed && !away.kept)) return null
  const n = props.nav.hereCount ?? 0
  return (
    <div className={'away' + (away.kept ? ' stay' : '')} data-testid="ai-away">
      <Codicon name="history" size={13} />
      {/* 放不下时只截地方名，「这是在」「问的」留着 */}
      <StayText name={away.label} />
      {away.kept ? (
        <button onClick={() => props.nav.pick(null)} data-testid="ai-follow">
          <span className="lb">{n ? t('这页有 {n} 段对话 · 打开', { n }) : t('切到《{name}》的 AI', { name: here.label })}</span>
          {key && <span className="k">{key}</span>}
        </button>
      ) : (
        <>
          {props.nav.stayHere && (
            <>
              <button className="stay-here" onClick={props.nav.stayHere} data-testid="ai-stay-here">
                {t('留在这个对话')}
              </button>
              <span className="sep" aria-hidden>
                ·
              </span>
            </>
          )}
          <button onClick={() => props.nav.pick(null)} data-testid="ai-back">
            {t('回到《{name}》', { name: here.label })}
          </button>
        </>
      )}
    </div>
  )
}

/** 「这是在《X》问的」拆成三截：放不下时只截地方名 */
function StayText({ name }: { name: string }) {
  const t = useT()
  const [a, b = ''] = t('这是在《{name}》问的', { name: '\u0000' }).split('\u0000')
  return (
    <span className="tx">
      <span>{a}</span>
      <span className="nm">{name}</span>
      <span>{b}</span>
    </span>
  )
}

/**
 * 读 PDF 时 AI 那一格换成笔记：头「note 笔记 <名字> 笔记.md · 问着就记，不用整理」，右边「在中间打开」「收起 ⌘W」。
 * 收起只有这一颗（和 AI 那一页的「收起 ⌘J」同一个位置、同一个样子），不另外放 ×。
 * 左边和笔记正文、上格历史的头对齐（16、图标 16、间距 10）；后半句放不下时整句不露（不截半句），悬停看全
 */
/** 「看得到」那一行 */
export function Sees(props: { testid: string; children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="sees" data-testid={props.testid}>
      <span className="k">{t('看得到')}</span>
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
