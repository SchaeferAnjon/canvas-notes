/**
 * 文档里「藏起来的语法」统一登记、统一看守（第 5 轮：前几轮一处处补，位置行、属性的 ---、折叠块的
 * <details>/<summary>/</details>、视频时刻块还是能被 ←、↓、Delete、Ctrl+D、退格改坏）。
 *
 * 每种藏法用 hiddenSyntax 交上自己藏着的范围（字符 [from, to)，连同把它和上下文隔开的换行），这里两个过滤器保证：
 * - 打字、退格、Delete、粘贴、拖放、剪切、挪行这些用户编辑，改不到藏着的字：落进去的输入挪到最近的看得见的位置，
 *   跨过它的删除只删看得见的部分（整块都选中了的才跟着删，比如选中一整块图片按退格，⌘A 删光）；
 * - 光标和选区两头停不进去：按挪动的方向跨过去，从行内挪来（End、↑↓、点）的停在它在屏上挨着的那一边。
 * ⌘Z / ⌘⇧Z、外面改了文件、白板写回、软件自己有意改的（带 hiddenOk）不拦。
 */
import { Annotation, ChangeSet, type ChangeSpec, EditorSelection, EditorState, Facet, Prec, type SelectionRange, type Text, Transaction, type TransactionSpec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'

export interface Hidden {
  /** 藏着的字 [from, to)：两头的换行也算（删掉它们会把语法并进别的行） */
  from: number
  to: number
  /** 光标能停在 from / to 上、字能插在那里 */
  fromOk: boolean
  toOk: boolean
  /** 光标从行内落到里面（End、↑↓、点）时停哪一边：它在屏上挨着哪边；near 按方向或离哪边近 */
  side: 'from' | 'to' | 'near'
  /** 一次删除盖住这一整段，藏着的跟着删（整块图片、整个折叠块、位置行连它那段）；null 永远不删 */
  unit: { from: number; to: number } | null
  /** to 是文件末尾时，插在 to 的字前面补上它（「</details>」后面直接打字会粘在同一行） */
  pad?: string
  /**
   * 靠空行和正文隔开的块（图片、时刻块、收着的提示块）：挨着它的空行里打字，补一个换行留住空行；
   * glue 是把空行留住的那几个换行（光标照样能停，删不掉；整块选中删的除外）
   */
  sep?: boolean
  glue?: { from: number; to: number }[]
  /** false：← → 不一下跨过它（展开的折叠块标题末尾的「</summary>」：→ 留在标题上，回车照旧在正文最前面新起一段） */
  step?: boolean
}

/** state：现在的文字；prev：这次改动之前的状态（属性藏不藏看改之前光标在不在里面） */
export type HiddenSource = (state: EditorState, prev: EditorState) => readonly Hidden[]

export const hiddenSyntax = Facet.define<HiddenSource>()

/** 软件有意改藏着的语法（折叠标题回车、位置行退格并段、点属性表进原文）：不拦 */
export const hiddenOk = Annotation.define<boolean>()

/** 挨着块的空行（上面那个、下面那个）的换行：删掉它，空行没了，块就和正文并在一起 */
export function blankGlue(doc: Text, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  if (from > 1 && doc.lineAt(from - 1).text === '' && doc.lineAt(from - 1).number > 1) out.push({ from: from - 2, to: from - 1 })
  if (to + 1 < doc.length && doc.lineAt(to + 1).text === '') out.push({ from: to + 1, to: to + 2 })
  return out
}

/**
 * 画成一整块的几行（图片、视频卡、时刻块、数据库）：连同上下的换行，整块选中才能删；光标按方向跨过去。
 * sep：图片、时刻块靠空行和正文隔开（空行里打一个字、删掉空行，图片就并进正文露出原文，后面的字并进时刻块看不见）：
 * 空行里打的字自动另起一行，空行的换行删不掉
 */
export function wholeBlock(doc: Text, from: number, to: number, sep = false): Hidden {
  const len = doc.length
  const a = from > 0 ? from - 1 : 0
  const z = to < len ? to + 1 : to
  return {
    from: a,
    to: z,
    fromOk: a > 0,
    toOk: true,
    side: 'near',
    unit: { from, to },
    ...(z < len ? {} : { pad: '\n\n' }),
    ...(sep ? { sep: true, glue: blankGlue(doc, from, to) } : {}),
  }
}

export function hiddenRanges(state: EditorState, prev: EditorState = state): Hidden[] {
  const out: Hidden[] = []
  for (const f of state.facet(hiddenSyntax)) for (const h of f(state, prev)) if (h.to > h.from) out.push(h)
  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

interface Cluster {
  from: number
  to: number
  fromOk: boolean
  toOk: boolean
  parts: Hidden[]
}

/** 有共同字符的并成一团（位置行紧挨着属性、紧挨着折叠块开头）；只碰到一个点的不并（空标题两边） */
function clusters(hs: readonly Hidden[]): Cluster[] {
  const out: Cluster[] = []
  for (const h of hs) {
    const last = out[out.length - 1]
    if (last && h.from < last.to) {
      if (h.from === last.from) last.fromOk &&= h.fromOk
      if (h.to > last.to) {
        last.to = h.to
        last.toOk = h.toOk
      } else if (h.to === last.to) last.toOk &&= h.toOk
      last.parts.push(h)
    } else out.push({ from: h.from, to: h.to, fromOk: h.fromOk, toOk: h.toOk, parts: [h] })
  }
  return out
}

/** 光标停在 pos 不行：挡着它的那一团 */
function blocking(cs: readonly Cluster[], pos: number, docLen: number): Cluster | null {
  for (const c of cs) {
    if (c.from > pos) break
    if (pos > c.from && pos < c.to) return c
    if (pos === c.from && !c.fromOk) return c
    if (pos === c.to && !c.toOk && !(pos === docLen && c.parts.some((p) => p.to === pos && p.pad))) return c
  }
  return null
}

/**
 * 把 pos 挪到看得见的地方：停在它在屏上挨着的那一边（位置行挨着上一行末尾，属性挨着下面第一段，<details> 挨着标题）；
 * 整块的（图片、收着的折叠块）按挪的方向（dir：1 往后、-1 往前、0 点的，挑近的那边）。
 * 「→ 跨过去」由 stepOver 按键做：→ 落进位置行和 End 落进去在这里分不出来
 */
function settle(cs: readonly Cluster[], pos: number, dir: number, docLen: number): number {
  for (let i = 0; i < 8; i++) {
    const c = blocking(cs, pos, docLen)
    if (!c) return pos
    const part = c.parts.find((p) => pos > p.from && pos < p.to) ?? c.parts.find((p) => pos === p.from || pos === p.to) ?? c.parts[0]!
    let side: 'from' | 'to' = part.side === 'near' ? (dir > 0 ? 'to' : dir < 0 ? 'from' : pos - c.from <= c.to - pos ? 'from' : 'to') : part.side
    if (side === 'to' && !c.toOk) side = 'from'
    else if (side === 'from' && !c.fromOk) side = 'to'
    const next = side === 'to' ? c.to : c.from
    if (next === pos) return pos
    dir = side === 'to' ? 1 : -1
    pos = next
  }
  return pos
}

/** 选区（不是光标）的一头可以停在一团的边上，或一整块的边上（选中一整块图片、折叠块） */
function selectionEndOk(cs: readonly Cluster[], pos: number): boolean {
  for (const c of cs) {
    if (c.from > pos) break
    if (pos > c.from && pos < c.to && !c.parts.some((p) => p.unit && (p.unit.from === pos || p.unit.to === pos))) return false
  }
  return true
}

/** 只看用户自己的编辑：打字、回车、粘贴、拖放、补全、各种删除、挪行复制行 */
function userEdit(tr: Transaction): boolean {
  const ev = tr.annotation(Transaction.userEvent)
  if (!ev) return false
  return ev === 'input' || tr.isUserEvent('delete') || ['input.type', 'input.paste', 'input.drop', 'input.complete', 'input.indent', 'input.copyline', 'move.line'].some((e) => tr.isUserEvent(e))
}

function bypass(tr: Transaction): boolean {
  return !!tr.annotation(hiddenOk) || tr.isUserEvent('undo') || tr.isUserEvent('redo')
}

/** [a, z) 去掉 [h, k) */
function subtract(pieces: [number, number][], h: number, k: number): [number, number][] {
  const out: [number, number][] = []
  for (const [a, z] of pieces) {
    if (k <= a || h >= z) out.push([a, z])
    else {
      if (a < h) out.push([a, h])
      if (k < z) out.push([k, z])
    }
  }
  return out
}

/** 编辑：改到藏着的字就改写这次改动 */
const guardChanges = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || bypass(tr) || !userEdit(tr)) return tr
  const start = tr.startState
  const hs = hiddenRanges(start)
  if (!hs.length) return tr
  const len = start.doc.length
  // 挪行、复制行：碰到藏着的就不挪（整段搬动会把位置行、折叠标签拆散）
  if (tr.isUserEvent('move.line') || tr.isUserEvent('input.copyline')) {
    let hit = false
    tr.changes.iterChanges((fromA, toA) => {
      if (hs.some((h) => (fromA < h.to && toA > h.from) || (fromA === toA && fromA > h.from && fromA < h.to))) hit = true
    })
    return hit ? [] : tr
  }
  const specs: { from: number; to?: number; insert?: string }[] = []
  /** 后面补了换行的插入点：光标停在打的字后面，不跑到补的换行后面 */
  const padded: number[] = []
  let changed = false
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
    let text = ins.toString()
    // 这次删除盖住了一整块的：那一块不护着
    const keep = hs.filter((h) => !(h.unit && fromA < toA && fromA <= h.unit.from && toA >= h.unit.to))
    let pieces: [number, number][] = fromA < toA ? [[fromA, toA]] : []
    for (const h of keep) if (h.from < toA && h.to > fromA) pieces = subtract(pieces, h.from, h.to)
    for (const h of keep) for (const g of h.glue ?? []) if (g.from < toA && g.to > fromA) pieces = subtract(pieces, g.from, g.to)
    if (pieces.length !== (fromA < toA ? 1 : 0) || (pieces[0] && (pieces[0][0] !== fromA || pieces[0][1] !== toA))) changed = true
    let at = pieces.length ? pieces[0]![0] : fromA
    if (text) {
      const cs = clusters(keep)
      // 插的位置被删掉的那几段里的点不算挡着（删掉后它就不在了），只看留下来的
      const target = settle(cs, at, 0, len)
      if (target !== at) {
        changed = true
        at = target
      }
      const pad = keep.find((h) => h.pad && h.to === at && at === len)
      if (pad) {
        // 文件末尾已经有的换行不再补
        const have = /\n*$/.exec(start.doc.sliceString(Math.max(0, at - pad.pad!.length), at))![0].length
        const add = '\n'.repeat(Math.max(0, pad.pad!.length - have))
        if (add && !text.startsWith(add)) {
          text = add + text
          changed = true
        }
      }
      // 挨着块的空行里打字：另起一行，空行留着（不然这一行字和块并成一段）
      const blank = start.doc.lineAt(at).text === ''
      if (blank && keep.some((h) => h.sep && h.from === at) && !text.endsWith('\n')) {
        text += '\n'
        padded.push(at)
        changed = true
      }
      if (blank && keep.some((h) => h.sep && h.to === at) && !text.startsWith('\n')) {
        text = '\n' + text
        changed = true
      }
      if (blocking(cs, at, len) && !pad) {
        // 两头都不能插（只有属性、没有结尾换行）：另起一行接在后面
        const c = blocking(cs, at, len)!
        at = c.to
        text = '\n' + text
        changed = true
      }
    }
    let inserted = !text
    for (const [a, z] of pieces) {
      if (!inserted && a === at) {
        specs.push({ from: a, to: z, insert: text })
        inserted = true
      } else specs.push({ from: a, to: z })
    }
    if (!inserted) specs.push({ from: at, insert: text })
  })
  if (!changed) return tr
  const changes = ChangeSet.of(specs as ChangeSpec, start.doc.length)
  const ends = new Set(padded.map((p) => changes.mapPos(p, 1)))
  const selection = EditorSelection.create(
    start.selection.ranges.map((r) => {
      const p = changes.mapPos(r.empty ? r.head : r.from, 1)
      return EditorSelection.cursor(ends.has(p) ? p - 1 : p)
    }),
    start.selection.mainIndex,
  )
  const spec: TransactionSpec = {
    changes,
    selection,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    annotations: [Transaction.userEvent.of(tr.annotation(Transaction.userEvent)!), ...(tr.annotation(Transaction.addToHistory) === false ? [Transaction.addToHistory.of(false)] : [])],
  }
  return spec
})

/** 光标、选区：停进藏着的地方就挪出来 */
const guardSelection = EditorState.transactionFilter.of((tr) => {
  if (tr.annotation(hiddenOk)) return tr
  if (!tr.selection && !tr.docChanged && !tr.effects.length) return tr
  const state = tr.state
  const hs = hiddenRanges(state, tr.startState)
  if (!hs.length) return tr
  const cs = clusters(hs)
  const len = state.doc.length
  const old = tr.startState.selection
  let moved = false
  const ranges = state.selection.ranges.map((r: SelectionRange, i: number) => {
    const before = old.ranges[i] ? tr.changes.mapPos(old.ranges[i]!.head, 1) : -1
    if (r.empty) {
      const p = settle(cs, r.head, before < 0 ? 0 : Math.sign(r.head - before), len)
      if (p === r.head) return r
      moved = true
      return EditorSelection.cursor(p)
    }
    const fix = (pos: number, was: number) => (selectionEndOk(cs, pos) ? pos : settle(cs, pos, was < 0 ? 0 : Math.sign(pos - was), len))
    const anchor = fix(r.anchor, old.ranges[i] ? tr.changes.mapPos(old.ranges[i]!.anchor, 1) : -1)
    const head = fix(r.head, before)
    if (anchor === r.anchor && head === r.head) return r
    moved = true
    return EditorSelection.range(anchor, head)
  })
  return moved ? [tr, { selection: EditorSelection.create(ranges, state.selection.mainIndex), sequential: true }] : tr
})

/**
 * ← → 正好挨着藏着的一团：一下跨过去（→ 从上一段末尾到下一段段首）。CodeMirror 自己挪会落进去，
 * 落进去后 settle 只能按「屏上挨着哪边」挪回来，光标原地不动
 */
export function stepOver(dir: 1 | -1, extend: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view
    const sel = state.selection.main
    if (!extend && !sel.empty) return false
    const cs = clusters(hiddenRanges(state))
    const c = cs.find((x) => x.parts.every((p) => p.step !== false) && (dir > 0 ? x.from === sel.head && x.toOk : x.to === sel.head && x.fromOk))
    if (!c) return false
    const to = dir > 0 ? c.to : c.from
    view.dispatch({ selection: extend ? EditorSelection.range(sel.anchor, to) : EditorSelection.cursor(to), userEvent: 'select', scrollIntoView: true })
    return true
  }
}

/** 过滤器倒着跑（优先级低的、后登记的先跑）：先改写编辑，再看光标落在哪 */
export const hiddenGuard = [
  // 别的过滤器（折叠标题去空行）改完以后光标也得在看得见的地方：看光标的放最后跑，改写编辑的最先跑
  Prec.highest(guardSelection),
  Prec.lowest(guardChanges),
  Prec.high(
    keymap.of([
      { key: 'ArrowRight', run: stepOver(1, false), shift: stepOver(1, true) },
      { key: 'ArrowLeft', run: stepOver(-1, false), shift: stepOver(-1, true) },
    ]),
  ),
]
