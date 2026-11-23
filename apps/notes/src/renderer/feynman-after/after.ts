/**
 * 费曼「讲完以后」的入口（③ feynman-after，task-yvabi）。判定卡上的按钮（② feynman-board 画的）调这几个函数，每个动作自己带核对框、弹窗或提示条：
 *
 * - feynmanMergeMap({ notePath, roundId, anchor })：「补进导图」。贴着 anchor 弹核对框，先列出要改哪几处；「放进去」才改原导图那一支的列表行，
 *   新的几处一个个长出来，底栏「撤回」回到原样；「算了」什么都不动。
 * - feynmanMakeMap({ notePath, roundId })：「拍成导图」（材料是卡片时）。这一轮整理成一棵树，走拍导图的 ② 核对、③ 放上白板，生成在这块白板的子白板里。
 * - feynmanCards({ notePath, roundId })：「出卡 · N张」。打开现有的出卡弹窗，来源是「费曼缺口」。
 * - feynmanToNote({ notePath, roundId })：「记进笔记」。材料来自的那篇末尾一块「费曼缺口 · X」（只有判定一行和缺口），底栏能撤回。
 * - canMergeMap(text, notePath, meta)：按钮叫「补进导图」还是「拍成导图」（材料是这张导图的一支才能补进）。
 *
 * notePath 是这一轮所在的那篇（白板）；roundId 是这一轮注释里的 id。读写都先找开着的那一篇（NoteDoc，白板上的改动 ⌘Z 也能撤），没开着的直接读写文件。
 */
import { keyPath, nodeAt, parseMindmap, withMindmap } from '@cn/format'
import { useSyncExternalStore } from 'react'
import { applyMapMerge, branchOf, findGapNote, gapCardId, gapNote, materialNote, type MergePlan, roundTree, withGapNote } from '../../shared/feynman/after'
import { findRounds, setMeta } from '../../shared/feynman/doc'
import type { FeynmanMeta } from '../../shared/feynman/types'
import { t as tNow } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { boardCapture, openCapture } from '../mindmap/capture-store'
import { settlePlaced } from '../mindmap/place'
import { NoteDoc } from '../note-doc'
import { openCards } from '../reading/cards-store'
import { growOnMap } from './map-grow'

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------------------------------------------------------------- 底部一句

/** 底部一句（带「撤回」）：白板那一列给了就用它的（② 的 say），没给用软件底栏 */
export type Say = (text: string, undo?: () => void) => void
const appSay: Say = (text, undo) => (undo ? app().noticeUndo(text, undo) : app().notice(text))

/** 每个动作都收这几样：这一轮在哪篇、这一轮的编号、底部一句怎么说 */
export interface AfterReq {
  notePath: string
  roundId: string
  say?: Say
}

// ---------------------------------------------------------------- 读写那一篇

const openDoc = (path: string) => [...NoteDoc.open].find((d) => d.path === path && !d.readOnly) ?? null

/** 这一篇现在的字：开着的用编辑器里的（还没存的也算） */
export async function noteText(path: string): Promise<string> {
  const d = openDoc(path)
  return d ? d.text : (await window.cn.readNote(path)).text
}

/** 改一篇：开着的交给编辑器（只改有差别的地方，⌘Z 能撤）再存；没开着的读了写回去，磁盘上变了就照新的再改一次 */
export async function editNote(path: string, f: (text: string) => string): Promise<void> {
  const d = openDoc(path)
  if (d) {
    const next = f(d.text)
    if (next !== d.text) d.setText(next)
    await d.save()
    return
  }
  let base = (await window.cn.readNote(path)).text
  for (let i = 0; i < 3; i++) {
    const next = f(base)
    if (next === base) return
    const r = await window.cn.writeNote(path, next, base)
    if (r.ok) return
    base = r.diskText
  }
  throw new Error(tNow('《{name}》一直在变，没写进去，再点一次', { name: titleOf(path) }))
}

function roundOf(text: string, roundId: string): FeynmanMeta {
  const r = findRounds(text).find((x) => x.meta.id === roundId)
  if (!r) throw new Error(tNow('这一轮不在这篇里了'))
  return r.meta
}

// ---------------------------------------------------------------- 补进导图

/** 材料是这张导图的一支：按钮叫「补进导图」；不是（卡片、PDF、一个词）叫「拍成导图」 */
export const canMergeMap = (text: string, notePath: string, meta: FeynmanMeta) => branchOf(text, notePath, meta) !== null

export interface MergeRequest {
  seq: number
  notePath: string
  roundId: string
  /** 点的那颗按钮：核对框贴着它弹；没给就在窗口正中 */
  anchor: DOMRect | null
  /** 按钮所在的那一列（费曼那一列）：核对框和列一样宽、左沿对齐，放在列里 */
  column: DOMRect | null
  say: Say
}

let mergeReq: MergeRequest | null = null
let mergeSeq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** 「补进导图」：先弹核对框列出要改的几处（AI 对过），点「放进去」才改 */
export function feynmanMergeMap(o: AfterReq & { anchor?: HTMLElement | null }): void {
  // 没给按钮：点的那一颗还拿着焦点，就贴着它
  const el = o.anchor ?? (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null)
  const col = el?.closest<HTMLElement>('[data-testid="fy-col"]')
  mergeReq = { seq: ++mergeSeq, notePath: o.notePath, roundId: o.roundId, anchor: el?.getBoundingClientRect() ?? null, column: col?.getBoundingClientRect() ?? null, say: o.say ?? appSay }
  emit()
}

export function closeMerge() {
  mergeReq = null
  emit()
}

export function useMergeRequest(): MergeRequest | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => mergeReq,
  )
}

/**
 * 「放进去」：照核对过的单子改原导图那一支（只往孩子末尾加、只改行尾注释），新的几处一个个长出来；底栏一句带「撤回」，撤回回到原样。
 * plan 是哪一支、按哪份字算的：这一支在这中间被改过（字对不上）就不放，请再点一次。
 */
export async function applyMerge(notePath: string, plan: MergePlan, branchText: string, say: Say = appSay): Promise<void> {
  const before = await noteText(notePath)
  const roots = parseMindmap(before).roots
  if (nodeAt(roots, keyPath(plan.branch))?.text !== branchText) throw new Error(tNow('导图这一支刚改过，再点一次「补进导图」'))
  const { roots: next, grow } = applyMapMerge(roots, plan)
  growOnMap(notePath, grow)
  await editNote(notePath, (text) => withMindmap(text, next))
  const n = { add: 0, wrong: 0, blank: 0 }
  for (const op of plan.ops) {
    if (op.kind === 'add') {
      n.add++
      if (op.mark) n[op.mark]++
    } else n[op.kind]++
  }
  const parts = [n.add && tNow('加了{n}个节点', { n: n.add }), n.wrong && tNow('标红{n}处', { n: n.wrong }), n.blank && tNow('留了{n}个空框', { n: n.blank })].filter(Boolean)
  say(tNow('补进导图了：{what}', { what: parts.join(tNow('，')) || tNow('没有要改的') }), () => {
    // 撤回：原来那棵树写回去（没动过的行原样，加的、标的拿掉）
    void editNote(notePath, (text) => withMindmap(text, roots)).then(
      () => say(tNow('撤回了：导图回到补进去之前')),
      (e) => say(errText(e)),
    )
  })
}

// ---------------------------------------------------------------- 拍成导图

/**
 * 「拍成导图」：这一轮整理成一棵树，走拍导图那套的 ② 核对、③ 放上白板。生成在这块白板的子白板里（偏好「拍导图放在拍的地方」）：
 * 这块白板开着时落点放在它屏幕正中的空白处；没开着的接在这块白板末尾。
 */
export async function feynmanMakeMap(o: AfterReq): Promise<void> {
  try {
    const meta = roundOf(await noteText(o.notePath), o.roundId)
    const seed = { title: tNow('{topic} 导图', { topic: meta.topic }), roots: roundTree(meta), step1: tNow('讲'), said: tNow('照费曼「{topic}」这一轮整理的', { topic: meta.topic }) }
    const b = boardCapture(o.notePath)
    const card = meta.from.find((f) => f.kind === 'card')
    if (b?.seeded) return b.seeded(seed, card?.kind === 'card' ? card.head : undefined)
    openCapture({
      into: { path: o.notePath, as: 'board' },
      seed,
      async onPlaced(r) {
        await editNote(o.notePath, (text) => `${text.replace(/\s*$/, '')}\n\n[[${titleOf(r.path)}]]\n`)
        await settlePlaced(o.notePath, r, tNow('导图放在这里：是这块白板的子白板，文件在它旁边'))
      },
    })
  } catch (e) {
    ;(o.say ?? appSay)(errText(e))
  }
}

// ---------------------------------------------------------------- 出卡

/** 「出卡 · N张」：现有的出卡弹窗，来源是这一轮的缺口 */
export function feynmanCards(o: AfterReq): void {
  openCards({ kind: 'feynman', note: o.notePath, round: o.roundId })
}

/** 送进 Anki 以后：这一轮里送过的那几条缺口记上 sent（列里写「✓ 已送进Anki」）；撤回时 on 是 false */
export async function markGapsSent(note: string, round: string, ids: string[], on: boolean): Promise<void> {
  const want = new Set(ids)
  try {
    await editNote(note, (text) => {
      const meta = findRounds(text).find((r) => r.meta.id === round)?.meta
      if (!meta?.gaps) return text
      const gaps = meta.gaps.map((g) => (want.has(gapCardId(round, g.point)) ? (on ? { ...g, sent: true } : (({ sent: _, ...rest }) => rest)(g)) : g))
      return setMeta(text, { ...meta, gaps })
    })
  } catch (e) {
    app().notice(errText(e))
  }
}

// ---------------------------------------------------------------- 记进笔记

/** 「记进笔记」：材料来自的那篇末尾一块「费曼缺口 · 范数」（同一个点已经有的就换成这一次的），底栏能撤回 */
export async function feynmanToNote(o: AfterReq): Promise<void> {
  const say = o.say ?? appSay
  try {
    const text = await noteText(o.notePath)
    const r = findRounds(text).find((x) => x.meta.id === o.roundId)
    if (!r) throw new Error(tNow('这一轮不在这篇里了'))
    const meta = r.meta
    if (!meta.verdict) throw new Error(tNow('这一轮还没判，先点「讲完了，看判定」'))
    const target = materialNote(meta)
    if (!target) throw new Error(tNow('这一轮是直接写的一个词，没有材料那篇；缺口在这一列里'))
    const verdict = [...r.entries].reverse().find((e) => e.kind === 'verdict')
    const block = gapNote(meta, { by: verdict?.by ?? meta.by })
    let old: string | null = null
    let was = ''
    let now = ''
    await editNote(target, (t) => {
      const at = findGapNote(t, meta.topic)
      old = at ? t.slice(at.from, at.to) : null
      was = t
      now = withGapNote(t, meta.topic, block)
      return now
    })
    say(tNow('记进了《{name}》末尾：「费曼缺口 · {topic}」', { name: titleOf(target), topic: meta.topic }), () => {
      void editNote(target, (t) => {
        // 这中间没再改过：整篇回到记之前，一字不差
        if (t === now) return was
        const at = findGapNote(t, meta.topic)
        if (!at) return t
        if (old !== null) return t.slice(0, at.from) + old + t.slice(at.to)
        // 原来没有：连前面隔开的空行一起拿掉
        let from = at.from
        while (from > 0 && t[from - 1] === '\n' && t[from - 2] === '\n') from--
        return t.slice(0, from) + t.slice(at.to)
      }).then(
        () => say(tNow('撤回了：《{name}》末尾那一块拿掉了', { name: titleOf(target) })),
        (e) => say(errText(e)),
      )
    })
  } catch (e) {
    say(errText(e))
  }
}
