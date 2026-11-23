/**
 * 文档、白板卡里写待办的时间（task-pd289，用户「在文件里写 todo 的时候我怎么写时间？一种是自然语言…另一种自己选」，看过说明「同意」）：
 *
 * 一、自然语言：在待办这一行直接写「明天下午三点交论文」「每周五晚上八点 组会」「下周一前交报告 提前一天提醒」「tomorrow 3pm」。
 *    停手 0.6 秒（或按回车）就认（@cn/tasks parseWhen）：要从标题里拿掉的字划掉、变淡，行尾出灰字预览（标准写法「📅 2026-11-23 15:00」）。
 *    Tab 收下；回车收下并换行（还没出预览时按回车：先出预览，不换行）；esc 不要，这一行之后不再提示。点灰字也是收下。
 *    本地认不出、看着有时间词的（timeyText）问 AI（主进程 main/when-ai.ts：设置 › AI「小活」那一家，Claude Code 用 Haiku，8 秒），
 *    等的时候行尾一个淡的「…」，回来了这一行还没改过才出预览，前面画那一家的标志。
 * 二、自己选：打 @（标题开头或空格后面）、按「定日子」的键（命令表 todo-when，默认 ⌥⌘T）、点日子小块（doc-dates.ts）弹选择器（when-pick.tsx），
 *    改什么马上写进这一行（只换那几个字，@cn/tasks setWhen），⌘Z 撤得回；关上时底栏说一句，带「撤回」。打 @ 开的，选了以后 @ 拿掉。
 *
 * 只认真的待办行（语法树里有 TaskMarker，代码块里长得像的不算）；只读的文档不提示。软件自己写的、外面改进来的不触发。
 */
import { syntaxTree } from '@codemirror/language'
import { Annotation, type EditorState, Prec, RangeSet, RangeValue, StateEffect, StateField, type Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { acceptWhen, makeId, meaningful, parseTaskLine, parseWhen, setWhen, timeyText, type When, type WhenFields, whenOf, whenTail } from '@cn/tasks'
import { t as tNow } from '../../shared/i18n'
import { logoHtml } from '../../shared/engine-logo-html'
import { whenText } from '../../shared/todo'
import { blockSel } from '../block-select'
import { app } from '../ctx/actions'
import { isKey, keyFor } from '../keys'
import { anchorOf, type PopAnchor } from '../pop-place'
import { isoToday, nowLocal } from './store'
import { closeWhenPick, openWhenPick, whenPickKey, whenPickOpen } from './when-pick'
import './when-assist.css'

/** 停手多久认（毫秒）；测试拨快：window.cnWhenDelay */
const IDLE_MS = 600
const idle = () => (window as unknown as { cnWhenDelay?: number }).cnWhenDelay ?? IDLE_MS
const newId = () => makeId(Math.random)

/** 这个软件自己写进这一行的（收下、选择器）：不再触发认 */
const ours = Annotation.define<boolean>()

// ---------------------------------------------------------------- 哪一行有预览

interface Sug {
  /** 那一行行首（跟着改动挪） */
  line: number
  /** 认的时候那一行的字：这一行改了就作废 */
  text: string
  /** 标题从哪起（行里的下标） */
  titleAt: number
  when: When
  /** AI 认出来的：前面画那一家的标志 */
  ai: string | null
}

const setSug = StateEffect.define<Sug | null>()
/** AI 正在想的那一行（行首），没有是 null */
const setWait = StateEffect.define<number | null>()

/** 不要再提示的几行（esc 过的）：行首一个点，跟着改动挪，那一行删了就没了 */
class Off extends RangeValue {
  point = true
  startSide = -1
}
const OFF = new Off()
const addOff = StateEffect.define<number>()

const offField = StateField.define<RangeSet<Off>>({
  create: () => RangeSet.empty,
  update(v, tr) {
    let x = v.map(tr.changes)
    for (const e of tr.effects) if (e.is(addOff)) x = x.update({ add: [OFF.range(e.value)] })
    return x
  },
})

const isOff = (state: EditorState, lineFrom: number) => {
  let hit = false
  state.field(offField).between(lineFrom, lineFrom, () => void (hit = true))
  return hit
}

interface SugState {
  sug: Sug | null
  wait: number | null
}

const sugField = StateField.define<SugState>({
  create: () => ({ sug: null, wait: null }),
  update(v, tr) {
    let { sug, wait } = v
    if (tr.docChanged) {
      if (sug) {
        const at = tr.changes.mapPos(sug.line, -1)
        const line = tr.state.doc.lineAt(at)
        sug = line.from === at && line.text === sug.text ? { ...sug, line: at } : null
      }
      if (wait !== null) {
        const at = tr.changes.mapPos(wait, -1)
        wait = tr.state.doc.lineAt(at).from === at ? at : null
      }
    }
    for (const e of tr.effects) {
      if (e.is(setSug)) sug = e.value
      if (e.is(setWait)) wait = e.value
    }
    return sug === v.sug && wait === v.wait ? v : { sug, wait }
  },
})

/** 这一行是不是待办（照语法树：代码块、引用里长得像的不算） */
function taskAt(state: EditorState, pos: number): { from: number; to: number; text: string } | null {
  const line = state.doc.lineAt(pos)
  if (!parseTaskLine(line.text)) return null
  let ok = false
  syntaxTree(state).iterate({ from: line.from, to: line.to, enter: (n) => void (n.name === 'TaskMarker' && (ok = true)) })
  return ok ? { from: line.from, to: line.to, text: line.text } : null
}

// ---------------------------------------------------------------- 画出来

class Ghost extends WidgetType {
  constructor(
    readonly tail: string,
    readonly ai: string | null,
    readonly wait: boolean,
  ) {
    super()
  }
  eq(o: Ghost) {
    return o.tail === this.tail && o.ai === this.ai && o.wait === this.wait
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = 'cm-when-ghost' + (this.wait ? ' wait' : '')
    el.setAttribute('aria-hidden', this.wait ? 'true' : 'false')
    if (this.ai) {
      const logo = document.createElement('span')
      logo.className = 'cm-when-logo'
      logo.innerHTML = logoHtml(this.ai as 'claude')
      el.append(logo)
    }
    if (this.wait) {
      el.append('…')
      return el
    }
    el.dataset.testid = 'when-ghost'
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', tNow('收下：{tail}', { tail: this.tail }))
    el.title = tNow('点一下或按 Tab 收下，回车收下并换行，esc 不要')
    const txt = document.createElement('span')
    txt.className = 'cm-when-tail'
    // 📅 🔔 🔁 是彩色的字：灰掉，和灰字一个样
    for (const part of this.tail.split(/([📅🔔🔁])/u)) {
      if (!part) continue
      if (/^[📅🔔🔁]$/u.test(part)) {
        const e = document.createElement('span')
        e.className = 'cm-when-emo'
        e.textContent = part
        txt.append(e)
      } else txt.append(part)
    }
    const k = document.createElement('kbd')
    k.className = 'cm-when-key'
    k.textContent = '⇥'
    el.append(txt, k)
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const s = view.state.field(sugField).sug
      if (s) accept(view, s, false)
    })
    return el
  }
  ignoreEvent() {
    return true
  }
}

const decos = EditorView.decorations.compute([sugField], (state) => {
  const { sug, wait } = state.field(sugField)
  const out = []
  if (sug) {
    const line = state.doc.lineAt(sug.line)
    for (const h of sug.when.hits) {
      const a = sug.line + sug.titleAt + h.from
      const b = sug.line + sug.titleAt + h.to
      if (a >= line.from && b <= line.to && b > a) out.push(Decoration.mark({ class: 'cm-when-cut' }).range(a, b))
    }
    const tail = whenTail(sug.when)
    if (tail) out.push(Decoration.widget({ widget: new Ghost(tail, sug.ai, false), side: 2 }).range(line.to))
  }
  if (wait !== null && (!sug || sug.line !== wait)) out.push(Decoration.widget({ widget: new Ghost('', engineId, true), side: 2 }).range(state.doc.lineAt(wait).to))
  return Decoration.set(out, true)
})

// ---------------------------------------------------------------- 认

/** 问 AI 的：同一句话只问一次（今天变了再问） */
const asked = new Map<string, Promise<When | null>>()
let engineId: string | null = null
let engineAsked = false
/** 问的是哪一家（灰字前面画它的标志）：问过一次才知道，之前当 Claude Code */
export const whenEngine = (): string => engineId ?? 'claude'
/** 问 AI（同一句话只问一次）；文档、白板卡、加一条的输入框都用它 */
export function askAi(title: string, now: string): Promise<When | null> {
  if (!engineAsked) {
    engineAsked = true
    void window.cnWhen
      .engine()
      .then((e) => void (engineId = e?.id ?? null))
      .catch(() => undefined)
  }
  const k = `${now.slice(0, 10)}\n${title}`
  let p = asked.get(k)
  if (!p) {
    p = window.cnWhen.ai(title, now).catch(() => null)
    asked.set(k, p)
    if (asked.size > 200) asked.delete(asked.keys().next().value!)
  }
  return p
}

/** 这一行认出来的（本地）；认不出、没用的是 null */
function localFor(text: string): { when: When; titleAt: number } | null {
  const t = parseTaskLine(text)
  if (!t || !t.title.trim()) return null
  const w = parseWhen(t.title, nowLocal())
  if (!w || !meaningful(w, !!t.date) || acceptWhen(text, w) === text) return null
  return { when: w, titleAt: t.titleStart }
}

/** 认这一行：本地认得出就出预览；认不出、看着有时间词的问 AI */
function suggest(view: EditorView, lineFrom: number) {
  const state = view.state
  // 选择器开着时不另出灰字（两样东西抢回车）
  if (state.readOnly || whenPickOpen() || isOff(state, lineFrom)) return
  const line = taskAt(state, lineFrom)
  if (!line) return
  const cur = state.field(sugField).sug
  if (cur && cur.line === line.from && cur.text === line.text) return
  const local = localFor(line.text)
  if (local) return view.dispatch({ effects: [setSug.of({ line: line.from, text: line.text, titleAt: local.titleAt, when: local.when, ai: null }), setWait.of(null)] })
  const t = parseTaskLine(line.text)!
  if (!t.title.trim() || !timeyText(t.title)) return
  const now = nowLocal()
  view.dispatch({ effects: setWait.of(line.from) })
  void askAi(t.title, now).then((w) => {
    // 回来时这一行还在、字没变才出（行首挪了照样认得出）
    const st = view.state.field(sugField)
    if (st.wait === null) return
    const l = view.state.doc.lineAt(st.wait)
    const effects = [setWait.of(null)] as StateEffect<unknown>[]
    if (w && l.text === line.text && !isOff(view.state, l.from) && meaningful(w, !!t.date) && acceptWhen(l.text, w) !== l.text) effects.push(setSug.of({ line: l.from, text: l.text, titleAt: t.titleStart, when: w, ai: engineId ?? 'claude' }))
    view.dispatch({ effects })
  })
}

/** 收下：标题换成拿掉时间词的，认出来的写进行尾；光标到行尾 */
function accept(view: EditorView, s: Sug, quiet = true): boolean {
  const line = view.state.doc.lineAt(s.line)
  if (line.text !== s.text) return false
  const next = acceptWhen(line.text, s.when, newId)
  writeLine(view, line.from, next, { selection: true, effects: [setSug.of(null)] })
  if (!quiet) view.focus()
  return true
}

/** 改一行：只换改了的那几个字；selection：光标放到行尾 */
function writeLine(view: EditorView, lineFrom: number, next: string, o: { selection?: boolean; effects?: StateEffect<unknown>[] } = {}) {
  const line = view.state.doc.lineAt(lineFrom)
  const cur = line.text
  let a = 0
  while (a < cur.length && a < next.length && cur[a] === next[a]) a++
  let b = 0
  while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++
  const changes = cur === next ? [] : [{ from: line.from + a, to: line.from + cur.length - b, insert: next.slice(a, next.length - b) }]
  view.dispatch({
    changes,
    ...(o.selection ? { selection: { anchor: line.from + next.length } } : {}),
    effects: o.effects ?? [],
    userEvent: 'input.when',
    annotations: ours.of(true),
  })
}

// ---------------------------------------------------------------- 键

/**
 * 文档里选着几块（从左边空白拖框、⇧ 点把手，task-5ryf9）：光标还留在原来那一行，可 Tab、esc、回车是那几块的
 * （缩进、取消选块），不能被灰字收走；白板卡里没有选块，field 是 undefined
 */
const blocksPicked = (view: EditorView) => !!view.state.field(blockSel, false)?.ranges.length

function sugOnCursor(view: EditorView): Sug | null {
  const s = view.state.field(sugField).sug
  if (!s || blocksPicked(view)) return null
  return view.state.doc.lineAt(view.state.selection.main.head).from === s.line ? s : null
}

/** 回车：有预览就收下、往下照常换行（交给后面的回车）；还没出预览但本地认得出：先出预览，不换行 */
function enter(view: EditorView): boolean {
  if (whenPickOpen()) return whenPickKey('Enter')
  const sel = view.state.selection.main
  if (!sel.empty || view.state.readOnly || blocksPicked(view)) return false
  const line = taskAt(view.state, sel.head)
  // 光标在标题中间按回车是要拆开这一行：照常换行，不认
  if (!line || sel.head < line.from + parseTaskLine(line.text)!.titleEnd) return false
  const s = sugOnCursor(view)
  if (s) {
    accept(view, s)
    return false
  }
  if (isOff(view.state, line.from)) return false
  const local = localFor(line.text)
  if (!local) {
    // 本地认不出、看着有时间词：换行照常，这一行在后台问 AI，答回来了预览出在这一行上
    queueMicrotask(() => suggest(view, line.from))
    return false
  }
  view.dispatch({ effects: setSug.of({ line: line.from, text: line.text, titleAt: local.titleAt, when: local.when, ai: null }) })
  return true
}

function tab(view: EditorView): boolean {
  if (whenPickOpen()) return true
  const s = sugOnCursor(view)
  return s ? accept(view, s) : false
}

function escape(view: EditorView): boolean {
  if (whenPickOpen()) return whenPickKey('Escape')
  const s = sugOnCursor(view)
  if (!s) return false
  view.dispatch({ effects: [setSug.of(null), addOff.of(s.line)] })
  return true
}

const PICK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'])

const keys = Prec.highest(
  keymap.of([
    {
      any: (view, e) => {
        // 选择器开着（光标留在编辑器里）：方向键、翻页交给它；打别的字就关上，字照常打进去
        if (whenPickOpen()) {
          if (PICK_KEYS.has(e.key) && !e.metaKey && !e.altKey && !e.ctrlKey) return whenPickKey(e.key)
          if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') return false
          if (!['Shift', 'Meta', 'Alt', 'Control', 'CapsLock'].includes(e.key)) closeWhenPick()
          return false
        }
        if (isKey(e, 'todo-when')) return openAtCursor(view, 'key')
        return false
      },
    },
    { key: 'Tab', run: tab },
    { key: 'Enter', run: enter },
    { key: 'Escape', run: escape },
  ]),
)

// ---------------------------------------------------------------- 停手就认

const watcher = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.docChanged) return
      // 自己打的字（打、粘贴、删）才认；软件写的、外面改进来的、撤销不算
      const typed = u.transactions.some((tr: Transaction) => (tr.isUserEvent('input') || tr.isUserEvent('delete')) && !tr.annotation(ours))
      if (!typed) return
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.run(), idle())
    }
    run() {
      const v = this.view
      if (v.composing) return void (this.timer = setTimeout(() => this.run(), idle()))
      suggest(v, v.state.doc.lineAt(v.state.selection.main.head).from)
    }
    destroy() {
      clearTimeout(this.timer)
      if (owner === this.view) closeWhenPick()
    }
  },
)

// ---------------------------------------------------------------- 选择器

/** 开着选择器的那个编辑器（关掉编辑器时一起关） */
let owner: EditorView | null = null

/** 光标那一处的框（选择器贴着它下面） */
function caretAt(view: EditorView): PopAnchor | null {
  const head = view.state.selection.main.head
  const r = view.coordsAtPos(head)
  if (!r) return null
  const col = view.dom.closest('main.center, .dview, .dcol, aside.side')?.getBoundingClientRect()
  return { left: r.left, top: r.top, bottom: r.bottom, right: r.left, ...(col ? { box: { left: col.left, top: col.top, right: col.right, bottom: col.bottom } } : {}) }
}

export type PickHow = 'at' | 'key' | 'chip'

/**
 * 给这一行开选择器：how 是怎么开的（打 @、按键、点日子小块）；el 是日子小块、「定日子」那一颗（贴着它放），没有就贴着光标
 */
export function openWhenFor(view: EditorView, lineFrom: number, how: PickHow, el?: HTMLElement): boolean {
  const line = taskAt(view.state, lineFrom)
  if (!line || view.state.readOnly) return false
  // 这一行的行首跟着改动挪（选择器开着时别处打了字也认得出是哪一行）
  let at = line.from
  const before = line.text
  /** 打 @ 开的：@ 在哪（选了以后拿掉） */
  let atSign = how === 'at' ? view.state.selection.main.head - 1 : -1
  let last = before
  owner = view
  if (view.state.field(sugField).sug) view.dispatch({ effects: setSug.of(null) })
  // 悬停才出的那一排（「定日子」那一颗）：开着时留着，选择器贴得住
  const keep = el?.closest<HTMLElement>('.cm-tdtools')
  keep?.classList.add('keep')
  const track = (tr: { changes: { mapPos(p: number, a?: number): number } }) => {
    at = tr.changes.mapPos(at, -1)
    if (atSign >= 0) atSign = tr.changes.mapPos(atSign, 1)
  }
  trackers.add(track)
  openWhenPick({
    proxy: true,
    // 点日子小块、「定日子」开的是拿鼠标的：底下不写键怎么用
    keysHint: how !== 'chip',
    align: how === 'chip' ? 'end' : 'start',
    value: whenOf(line.text),
    at: () => (el && el.isConnected ? anchorOf(el) : caretAt(view)),
    onChange: (next) => {
      const l = view.state.doc.lineAt(at)
      if (l.from !== at || !parseTaskLine(l.text)) return null
      // 打 @ 开的：先拿掉那个 @
      if (atSign >= 0 && /[@＠]/.test(view.state.doc.sliceString(atSign, atSign + 1)) && atSign >= l.from && atSign < l.to) {
        const sp = atSign > l.from && view.state.doc.sliceString(atSign - 1, atSign) === ' ' && /^(\s|$)/.test(view.state.doc.sliceString(atSign + 1, atSign + 2)) ? 1 : 0
        view.dispatch({ changes: { from: atSign - sp, to: atSign + 1 }, userEvent: 'input.when', annotations: ours.of(true) })
        atSign = -1
      }
      const cur = view.state.doc.lineAt(at)
      const text = setWhen(cur.text, next, newId)
      writeLine(view, cur.from, text, { selection: how !== 'chip' })
      last = view.state.doc.lineAt(at).text
      return whenOf(last)
    },
    onClose: () => {
      keep?.classList.remove('keep')
      trackers.delete(track)
      if (owner === view) owner = null
      if (how !== 'chip' && document.contains(view.dom)) view.focus()
      if (last === before) return
      const t = parseTaskLine(last)
      const w = whenOf(last)
      const title = t?.title ?? ''
      const said = w.date ? tNow('「{title}」改到{when}', { title, when: whenText(w.date, w.time, isoToday()) + (w.remind ? ' · 🔔 ' + w.remind : '') + (w.repeat ? ' · 🔁 ' + w.repeat : '') }) : tNow('「{title}」拿掉了日子', { title })
      const undoAt = at
      app().noticeUndo(said, () => {
        const l = view.state.doc.lineAt(Math.min(undoAt, view.state.doc.length))
        if (l.text !== last) return app().notice(tNow('那一行后来又改过，撤不回了'))
        writeLine(view, l.from, before)
      })
    },
  })
  return true
}

/** 跟着改动挪选择器开着的那一行 */
const trackers = new Set<(tr: Transaction) => void>()
const tracking = EditorView.updateListener.of((u) => {
  if (!u.docChanged || !trackers.size) return
  for (const tr of u.transactions) for (const f of trackers) f(tr)
})

/** 光标所在的那一行开选择器（按键、打 @）；不在待办行上说一句 */
function openAtCursor(view: EditorView, how: PickHow): boolean {
  const head = view.state.selection.main.head
  if (!taskAt(view.state, head)) {
    if (how === 'key' && view.hasFocus) app().notice(tNow('光标放在一行待办上再按 {key}，就能定日子和时间', { key: keyFor('todo-when') ?? '' }))
    return how === 'key' && view.hasFocus
  }
  return openWhenFor(view, view.state.doc.lineAt(head).from, how)
}

/** 打 @：标题开头、空格后面打的才算（邮箱里的 @ 不算） */
const atInput = EditorView.inputHandler.of((view, from, to, text) => {
  if ((text !== '@' && text !== '＠') || from !== to || view.state.readOnly) return false
  const line = view.state.doc.lineAt(from)
  const t = parseTaskLine(line.text)
  if (!t || !taskAt(view.state, from)) return false
  const col = from - line.from
  // 标题里、标题后面（行尾的空格也算），行尾那一截记号前面
  const fieldsAt = t.fields.length ? t.fields[0]!.start : line.text.length
  if (col < t.titleStart || col > fieldsAt) return false
  const prev = line.text.slice(col - 1, col)
  if (col > t.titleStart && !/\s/.test(prev)) return false
  // 先让 @ 照常打进去，再开选择器
  queueMicrotask(() => {
    if (view.state.doc.sliceString(from, from + 1) === text) openAtCursor(view, 'at')
  })
  return false
})

/** 文档、白板卡都装这一套 */
export const whenAssist = [offField, sugField, decos, keys, watcher, atInput, tracking]
