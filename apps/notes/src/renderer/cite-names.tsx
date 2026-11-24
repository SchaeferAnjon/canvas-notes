/**
 * AI 回答里没写成链接的路径、笔记名也认成链接（task-3e53q 设计页「二、a」后半；已定 4：先按推荐做，设置里能关，用户反对再拿掉）。
 * 只是兜底：系统提示已经让 AI 写成 [字](路径)（shared/cite-rule.ts），这里接它漏写的。认法是 @cn/format 的 cite-names.ts（纯函数），
 * 这里接界面这一头：
 * - useCiteRun：md-render 的 Markdown 带了 cites（哪段对话、这一轮读过哪些文件）时，拿库里的文件、库根、设置、点过「不是这篇」的名字，
 *   每画一条回答给一份 CiteRun；库里文件变了、设置改了、点了「不是这篇」都重画；
 * - autoLinkProps：认出来的画成和 AI 写的链接一样的 <a class="cite">，多带 data-auto（为什么认）、data-name、data-conv；
 * - citeAuto：预览卡（cite.tsx）上那一行小字「软件按名字认的 · 为什么」和「不是这篇」按钮。cite.tsx 只接这一个口。
 * 「不是这篇」：这个名字在这段对话里不再认（记在这台 Mac 上），底栏「⌘Z 撤回」。
 */
import { Codicon } from '@cn/design'
import { type AutoWhy, type CiteRun, nameIndex } from '@cn/format'
import { type ReactNode, useMemo, useSyncExternalStore } from 'react'
import { t } from '../shared/i18n'
import { app } from './ctx/actions'
import { useVaultFiles } from './files/store'
import { usePrefs } from './settings-store'

/** 一条回答在哪段对话里（「不是这篇」记在这段对话上）、这一轮 AI 读过哪些文件 */
export interface CiteScope {
  conv: string
  touched?: readonly string[]
}

// ---------- 库根（认绝对路径） ----------

let root = ''
let rootAsked = false
const rootSubs = new Set<() => void>()
function useRoot(): string {
  if (!rootAsked) {
    rootAsked = true
    void window.cn.vault().then((v) => {
      root = v?.path ?? ''
      for (const f of rootSubs) f()
    })
  }
  return useSyncExternalStore(
    (f) => (rootSubs.add(f), () => void rootSubs.delete(f)),
    () => root,
  )
}

// ---------- 点过「不是这篇」的名字（这台 Mac 上，按对话记） ----------

const NO_KEY = 'cn.citeNo'
let no: Record<string, string[]> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(NO_KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, string[]>) : {}
  } catch {
    return {}
  }
})()
const noSubs = new Set<() => void>()
function setNo(conv: string, names: string[]) {
  no = { ...no }
  if (names.length) no[conv] = names
  else delete no[conv]
  // 最多记 300 段对话（旧的先丢）
  const keys = Object.keys(no)
  for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete no[k]
  try {
    localStorage.setItem(NO_KEY, JSON.stringify(no))
  } catch {
    // 记不住只影响下次打开，这一次照样不认
  }
  for (const f of noSubs) f()
}
const useNo = () =>
  useSyncExternalStore(
    (f) => (noSubs.add(f), () => void noSubs.delete(f)),
    () => no,
  )

/** 「不是这篇」：这段对话里不再认这个名字；底栏能撤回（⌘Z） */
export function rejectName(conv: string, name: string) {
  const low = name.toLowerCase()
  const before = no[conv] ?? []
  if (before.includes(low)) return
  setNo(conv, [...before, low])
  // 底栏那颗「撤回」自己带着 ⌘Z 的提示，句子里不再写键
  app().noticeUndo(t('「{name}」在这段对话里不再认成链接', { name }), () => setNo(conv, (no[conv] ?? []).filter((x) => x !== low)))
}

// ---------- 画回答时用 ----------

/** 家目录：库根在 /Users/<名字>/ 下面时就是它（认 AI 写的 ~/…） */
const homeOf = (r: string) => /^\/Users\/[^/]+/.exec(r)?.[0]

/**
 * Markdown 带了 cites 时调：给一个「这条回答新开一份」的 CiteRun（seen 每条回答一份：同一个名字只认第一次）。
 * 库里的文件、设置、「不是这篇」变了重画
 */
export function useCiteRun(scope: CiteScope): () => CiteRun {
  const { files } = useVaultFiles()
  const r = useRoot()
  const prefs = usePrefs((s) => s.cite)
  const rejected = useNo()[scope.conv]
  const paths = useMemo(() => files.filter((f) => f.kind !== 'dir').map((f) => f.path), [files])
  const index = useMemo(() => nameIndex(paths, prefs.skip), [paths, prefs.skip])
  const touched = useMemo(() => new Set(scope.touched ?? []), [scope.touched])
  const no = useMemo(() => new Set(rejected ?? []), [rejected])
  return () => ({ ctx: { base: '', root: r, files: paths, ...(homeOf(r) ? { home: homeOf(r)! } : {}) }, index, names: prefs.names, touched, rejected: no, seen: new Set() })
}

/**
 * 认出来的链接会变（设置改了、点了「不是这篇」、库里的文件变了）的指纹：回答上划了旁支小标（@cn/ai-chat 的 side/marks.ts 改过 DOM）时，
 * 外面拿它当 key 整块换掉，React 不去动被改过的节点
 */
export function useCiteSig(conv: string): string {
  const { files } = useVaultFiles()
  const prefs = usePrefs((s) => s.cite)
  const rejected = useNo()[conv]
  return `${prefs.names ? 1 : 0}|${prefs.skip.join('\n')}|${(rejected ?? []).join('\n')}|${files.length}`
}

/** 这条回答上面那串步骤里读过、写过的库里文件 */
export const touchedOf = (steps?: readonly { paths?: string[] }[]): string[] => (steps ?? []).flatMap((s) => s.paths ?? [])

/** 认出来的那一截画成的链接上带的（cite.tsx 认 a.cite；data-auto 是为什么认，按路径认的不带） */
export function autoLinkProps(href: string, why: AutoWhy, conv: string, name?: string): Record<string, string> {
  return { className: 'cite', 'data-href': href, ...(why === 'path' ? {} : { 'data-auto': why, 'data-name': name ?? '', 'data-conv': conv }) }
}

// ---------- 预览卡上（cite.tsx 接这一个口） ----------

/**
 * 预览卡上的一行小字（软件按名字认的、为什么）和行尾的「不是这篇」：软件按名字认的才有；收卡由 cite.tsx 给。
 * 「不是这篇」放在这一行里、不放进下面那排按钮：右栏窄时第四颗按钮会折到第二行，而且它说的就是这一行
 */
export function citeAuto(el: HTMLElement | null, hide: () => void): ReactNode {
  const why = el?.dataset.auto as AutoWhy | undefined
  const name = el?.dataset.name
  const conv = el?.dataset.conv
  if (!why || !name || conv === undefined) return null
  return (
    <div className="why">
      <Codicon name="info" size={12} />
      <span data-testid="cite-auto">{why === 'touched' ? t('软件按名字认的：AI读过这篇') : t('软件按名字认的：名字加了书名号')}</span>
      <button
        onClick={() => {
          hide()
          rejectName(conv, name)
        }}
      >
        <Codicon name="close" size={12} />
        {t('不是这篇')}
      </button>
    </div>
  )
}
