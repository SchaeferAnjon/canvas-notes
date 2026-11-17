/**
 * 藏起来的语法 × 每种按键（第 5 轮：位置行、属性的 ---、折叠块的 <details>/<summary>/</details>、时刻块、图片、收着的提示块
 * 能被 ←、↓、Delete、Ctrl+D、退格改坏）。每一格：按下去以后藏着的每一段原样还在（整块选中删掉的除外），光标不在藏着的地方，⌘Z 回到原样。
 *
 * 编辑器没有屏幕（Vitest 跑在 node 里）：
 * - 退格、Delete、Ctrl+D、选中删除、粘贴、打字用的是 CodeMirror 自己的命令和这里登记的按键（先跑优先级高的，跟真编辑器一样）；
 * - ←→ 先跑 stepOver，再照 CodeMirror 的 moveByChar 挪一个字、跨过 atomicRanges；
 * - ↑↓、Home、End、Ctrl+A、Ctrl+E、点：落在哪儿取决于排版，这里把每一个位置都当落点试一遍（从上面来、从下面来、点的）。
 * 真键盘在 e2e/r5-hidden.spec.ts 里再按一遍。
 */
import { deleteCharBackward, deleteCharForward, history, insertNewlineAndIndent, undo } from '@codemirror/commands'
import { insertNewlineContinueMarkup, markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Extension, Transaction, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { backspaceSelectsBlock } from '../src/renderer/atomic-blocks'
import { enterInQuote } from '../src/renderer/doc-keys'
import { editorHost } from '../src/renderer/editor-host'
import { enterInFoldTitle, foldBlock, foldBlocks, toggleFold } from '../src/renderer/fold-block'
import { type Hidden, hiddenGuard, hiddenOk, hiddenRanges, stepOver } from '../src/renderer/hidden-syntax'
import { backspaceOverLayout, deleteOverLayout, layoutLines } from '../src/renderer/layout-lines'
import { mdWidgets } from '../src/renderer/md-widgets'
import { propsBlock } from '../src/renderer/mindmap/props-block'

// 时刻块的模块一加载就要 window（视频测试站地址）
;(globalThis as { window?: unknown }).window ??= {}
const { videoDocWidgets } = await import('../src/renderer/video/doc-widgets')

const extensions: Extension[] = [
  markdown(),
  editorHost.of({ path: () => '写作/测试.md', notice: () => {} }),
  layoutLines,
  propsBlock,
  foldBlock,
  mdWidgets,
  videoDocWidgets,
  hiddenGuard,
  history(),
]

type View = EditorView & { state: EditorState }

/** 只有 state 和 dispatch 的编辑器；是 EditorView 的实例，CodeMirror 的删除命令才会跨过 atomicRanges */
function fakeView(state: EditorState): View {
  let s = state
  const v = Object.create(EditorView.prototype) as View
  Object.defineProperty(v, 'state', { get: () => s })
  // 待办勾选框是 ViewPlugin（没有屏幕就没有）
  Object.defineProperty(v, 'plugin', { value: () => null })
  Object.defineProperty(v, 'dispatch', {
    value: (...specs: (TransactionSpec | Transaction)[]) => {
      s = (specs[0] instanceof Transaction ? specs[0] : s.update(...(specs as TransactionSpec[]))).state
    },
  })
  return v
}

interface Sample {
  name: string
  doc: string
  /** 打开后先展开的折叠块（第几个） */
  open?: number[]
}

const MOMENT = '<!-- moment video=youtube:kYB8IZa5AuE t=10 -->\n[▶ 00:10 · 讲到这里](https://www.youtube.com/watch?v=kYB8IZa5AuE&t=10s)'

const samples: Sample[] = [
  { name: '位置行（中间一段）', doc: '# 删除键\n\n第一段卡片。\n\n第二段卡片。\n\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n' },
  { name: '位置行（没有标题，第一行）', doc: '<!-- card id=d1 x=1 y=2 -->\n没有标题的第一段。\n\n第二段。\n' },
  { name: '属性 + 位置行', doc: '---\ncreated: 2026-11-17 10:00\n---\n<!-- card id=d1 x=825 y=778 -->\n属性下面第一段。\n\n第二段。\n' },
  { name: '属性', doc: '---\ncreated: 2026-11-17 10:00\n---\n属性下面第一段。\n\n第二段。\n' },
  { name: '属性（给人看的键，画成表）+ 标题', doc: '---\n课程: 写作\ncreated: 2026-11-17 10:00\n---\n# 标题\n\n正文。\n' },
  { name: '展开的折叠块', doc: '# 折叠退格\n\n<details>\n<summary>标题甲</summary>\n\n第一段里面。\n\n</details>\n\n后面一段。\n', open: [0] },
  { name: '展开的折叠块 + 前面位置行', doc: '# 折叠\n\n第一段。\n\n<!-- card id=d3 x=1 y=2 -->\n<details>\n<summary>收着的标题</summary>\n\n里面。\n\n</details>\n\n后面。\n', open: [0] },
  { name: '收着的折叠块', doc: '# 折叠\n\n前面。\n\n<details>\n<summary>标题甲</summary>\n\n第一段里面。\n\n</details>\n\n后面一段。\n' },
  { name: '展开的折叠块（多行 summary，文件开头）', doc: '<details>\n<summary>\n多行的\n标题\n</summary>\n\n第一段里面。\n\n</details>\n\n后面。\n', open: [0] },
  { name: '展开的折叠块在文件末尾（没有结尾换行）', doc: '# 尾\n\n前面。\n\n<details>\n<summary>尾巴</summary>\n\n里面。\n\n</details>', open: [0] },
  { name: '套着的折叠块（都展开）', doc: '<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n最里面。\n\n</details>\n\n</details>\n\n后面。\n', open: [0, 1] },
  { name: '收着的提示块', doc: '# 提示\n\n> [!ai]- 讲解\n> 正文一\n> 正文二\n\n后面。\n' },
  { name: '时刻块', doc: `# 视频笔记\n\n前面。\n\n${MOMENT}\n\n后面。\n` },
  { name: '图片', doc: '# 图\n\n前一段。\n\n![说明](附件/a.png)\n\n后一段。\n' },
]

function open(sample: Sample): View {
  const v = fakeView(EditorState.create({ doc: sample.doc, extensions }))
  for (const i of sample.open ?? []) {
    const b = foldBlocks(v.state.doc.toString())[i]!
    v.dispatch({ effects: toggleFold.of(b.from) })
  }
  // 光标放在正文最后（文件末尾不一定能停）
  v.dispatch({ selection: { anchor: v.state.doc.length }, userEvent: 'select' })
  return v
}

/** 藏着的每一段的原文（去掉两头的换行和空行） */
const pieces = (s: EditorState) => hiddenRanges(s).map((h) => s.doc.sliceString(h.from, h.to).replace(/^\n+|\n+$/g, ''))

/** 改完以后：原来藏着的每一段都还整行整行地在（出现次数不少），藏着的块一个没少（没露成原文） */
function expectIntact(before: EditorState, after: EditorState, where: string) {
  const text = after.doc.toString()
  // 整行：前面是行首（</summary> 接在标题字后面，不算）、后面是行尾（<summary>、提示块的「> [!ai]- 」后面接标题字，不算）
  const lines = (core: string) => {
    const needL = !core.startsWith('</summary>')
    const needR = !(/<summary>$/i.test(core) || /^>\s*\[!/.test(core))
    let n = 0
    for (let i = text.indexOf(core); i >= 0; i = text.indexOf(core, i + 1)) {
      const okL = !needL || i === 0 || text[i - 1] === '\n'
      const okR = !needR || i + core.length === text.length || text[i + core.length] === '\n'
      if (okL && okR) n++
    }
    return n
  }
  const want = new Map<string, number>()
  for (const p of pieces(before)) want.set(p, (want.get(p) ?? 0) + 1)
  for (const [core, n] of want) expect(lines(core), `${where}：「${core}」`).toBeGreaterThanOrEqual(n)
  expect(hiddenRanges(after).length, `${where}：藏着的块少了`).toBeGreaterThanOrEqual(hiddenRanges(before).length)
}

function clustersOf(s: EditorState): Hidden[][] {
  const hs = hiddenRanges(s)
  const out: Hidden[][] = []
  for (const h of hs) {
    const last = out[out.length - 1]
    if (last && h.from < Math.max(...last.map((x) => x.to))) last.push(h)
    else out.push([h])
  }
  return out
}

/** 光标停在这里不行：在藏着的一团中间，或停在不许停的一头 */
function badCursor(s: EditorState, pos: number): boolean {
  for (const c of clustersOf(s)) {
    const from = Math.min(...c.map((h) => h.from))
    const to = Math.max(...c.map((h) => h.to))
    if (pos > from && pos < to) return true
    if (pos === from && c.filter((h) => h.from === from).some((h) => !h.fromOk)) return true
    if (pos === to && c.filter((h) => h.to === to).some((h) => !h.toOk && !(h.pad && pos === s.doc.length))) return true
  }
  return false
}

/** 能停的位置（每团的两头 ±1，按键从这里按） */
function stops(s: EditorState): number[] {
  const out = new Set<number>()
  for (const h of hiddenRanges(s)) for (const p of [h.from - 1, h.from, h.to, h.to + 1]) if (p >= 0 && p <= s.doc.length && !badCursor(s, p)) out.add(p)
  return [...out].sort((a, b) => a - b)
}

/** CodeMirror 的 moveByChar：挪一个字，落进 atomicRanges 就按方向跨过去 */
function moveChar(v: View, dir: 1 | -1) {
  if (stepOver(dir, false)(v)) return
  const s = v.state
  let pos = Math.max(0, Math.min(s.doc.length, s.selection.main.head + dir))
  for (let i = 0; i < 10; i++) {
    let moved = false
    for (const f of s.facet(EditorView.atomicRanges)) {
      f(v).between(pos, pos, (from, to) => {
        if (from < pos && to > pos) {
          pos = dir > 0 ? to : from
          moved = true
        }
      })
    }
    if (!moved) break
  }
  v.dispatch({ selection: { anchor: pos }, userEvent: 'select' })
}

const keys: Record<string, (v: View) => void> = {
  '←': (v) => moveChar(v, -1),
  '→': (v) => moveChar(v, 1),
  退格: (v) => void (backspaceOverLayout(v) || backspaceSelectsBlock(v) || deleteCharBackward(v)),
  Delete: (v) => void (deleteOverLayout(v) || deleteCharForward(v)),
  'Ctrl+D': (v) => void (deleteOverLayout(v) || deleteCharForward(v)),
  打字: (v) => v.dispatch(v.state.replaceSelection('Y'), { userEvent: 'input.type' } as TransactionSpec),
  回车: (v) => void (enterInFoldTitle(v) || enterInQuote(v) || insertNewlineContinueMarkup(v) || insertNewlineAndIndent(v)),
  粘贴: (v) => v.dispatch(v.state.replaceSelection('贴\n\n进来'), { userEvent: 'input.paste' } as TransactionSpec),
}

function typeAt(v: View, text: string) {
  v.dispatch({ ...v.state.replaceSelection(text), userEvent: 'input.type' })
}

describe.each(samples)('$name', (sample) => {
  it('每个位置当落点（↑↓、Home、End、Ctrl+A、Ctrl+E、点）：光标挪到能停的地方，打的字不进藏着的语法', () => {
    const v0 = open(sample)
    expect(pieces(v0.state).length).toBeGreaterThan(0)
    const len = v0.state.doc.length
    for (let p = 0; p <= len; p++) {
      for (const from of [0, len, p]) {
        const v = open(sample)
        v.dispatch({ selection: { anchor: from }, userEvent: 'select' })
        v.dispatch({ selection: { anchor: p }, userEvent: 'select' })
        const at = v.state.selection.main.head
        expect(badCursor(v.state, at), `落点 ${p}（从 ${from} 来）停在了 ${at}`).toBe(false)
        const s0 = v.state
        typeAt(v, 'Y')
        expectIntact(s0, v.state, `落点 ${p}（从 ${from} 来）打字`)
        undo(v)
        expect(v.state.doc.toString()).toBe(sample.doc)
      }
    }
  })

  it.each(Object.keys(keys))('%s：藏着的语法原样，光标在能停的地方，⌘Z 回到原样', (key) => {
    const v0 = open(sample)
    for (const at of stops(v0.state)) {
      // 每个位置按一下、两下、三下
      for (const times of [1, 2, 3]) {
        const v = open(sample)
        v.dispatch({ selection: { anchor: at }, userEvent: 'select' })
        for (let i = 0; i < times; i++) {
          // 退格碰到整块先选中（再按一下才删）：两下以上就是有意删掉整块，不算改坏
          if (key === '退格' && !v.state.selection.main.empty) return
          keys[key]!(v)
        }
        const where = `${sample.name} 从 ${at} 按 ${key} ${times} 下`
        if (v.state.selection.main.empty) expect(badCursor(v.state, v.state.selection.main.head), where).toBe(false)
        // 位置行退格、Delete 并段时位置行挪到并好的那段前面，原文不变；藏着的每一段都还在（顺序可能变）
        expectIntact(v0.state, v.state, where)
        for (let i = 0; i < 6; i++) undo(v)
        expect(v.state.doc.toString(), where + ' 再 ⌘Z').toBe(sample.doc)
      }
    }
  })

  it('选中删除：从任一能停的位置选到另一个，删掉后没被整块选中的藏着的语法都还在', () => {
    const v0 = open(sample)
    const all = stops(v0.state)
    for (const a of all)
      for (const b of all) {
        if (b <= a) continue
        const v = open(sample)
        v.dispatch({ selection: EditorSelection.range(a, b), userEvent: 'select' })
        const kept = hiddenRanges(v.state).filter((h) => !(h.unit && a <= h.unit.from && b >= h.unit.to))
        const want = kept.map((h) => v.state.doc.sliceString(h.from, h.to))
        deleteCharBackward(v)
        const got = v.state.doc.toString()
        for (const w of want) expect(got, `${sample.name} 选 ${a}–${b} 删`).toContain(w)
        expect(badCursor(v.state, v.state.selection.main.head)).toBe(false)
        undo(v)
        expect(v.state.doc.toString()).toBe(sample.doc)
      }
  })

  it('⌘A 再退格：全选时属性也露出原文、一起选中，删掉就是空的；⌘Z 回到原样', () => {
    const v = open(sample)
    v.dispatch({ selection: EditorSelection.range(0, v.state.doc.length), userEvent: 'select' })
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe('')
    undo(v)
    expect(v.state.doc.toString()).toBe(sample.doc)
  })
})

describe('报告里的几条，按原样走一遍', () => {
  it('属性下面第一段摆在白板上：段首 ← 再打 Y，Y 在这段开头，属性和位置行原样', () => {
    const doc = '---\ncreated: 2026-11-17 10:00\n---\n<!-- card id=d1 x=825 y=778 -->\n属性下面第一段。\n\n第二段。\n'
    const v = open({ name: '', doc })
    v.dispatch({ selection: { anchor: doc.indexOf('属性下面') }, userEvent: 'select' })
    keys['←']!(v)
    typeAt(v, 'Y')
    expect(v.state.doc.toString()).toBe(doc.replace('属性下面', 'Y属性下面'))
  })

  it('属性下面第一段：段首退格一下、两下，什么都不变', () => {
    const doc = '---\ncreated: 2026-11-17 10:00\n---\n<!-- card id=d1 x=825 y=778 -->\n属性下面第一段。\n\n第二段。\n'
    const v = open({ name: '', doc })
    v.dispatch({ selection: { anchor: doc.indexOf('属性下面') }, userEvent: 'select' })
    keys['退格']!(v)
    keys['退格']!(v)
    expect(v.state.doc.toString()).toBe(doc)
    expect(v.state.selection.main.head).toBe(doc.indexOf('属性下面'))
  })

  it('上一段末尾 Delete 两下：第一下并掉空行，第二下并段，位置行挪到并好的那段前面', () => {
    const doc = '# 删除键\n\n第一段卡片。\n\n第二段卡片。\n\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n'
    const v = open({ name: '', doc })
    v.dispatch({ selection: { anchor: doc.indexOf('第二段卡片。') + 6 }, userEvent: 'select' })
    keys['Delete']!(v)
    expect(v.state.doc.toString()).toBe('# 删除键\n\n第一段卡片。\n\n第二段卡片。\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n')
    keys['Delete']!(v)
    expect(v.state.doc.toString()).toBe('# 删除键\n\n第一段卡片。\n\n<!-- card id=d2 x=900 y=200 -->\n第二段卡片。收尾一段。\n')
    expect(v.state.doc.sliceString(v.state.selection.main.head).startsWith('收尾一段')).toBe(true)
  })

  it('空行上 Delete、Ctrl+D：删掉空行，位置行留着，光标到那段段首', () => {
    const doc = '# 删除键\n\n第二段卡片。\n\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n'
    for (const key of ['Delete', 'Ctrl+D']) {
      const v = open({ name: '', doc })
      v.dispatch({ selection: { anchor: doc.indexOf('\n\n<!--') + 1 }, userEvent: 'select' })
      keys[key]!(v)
      expect(v.state.doc.toString()).toBe('# 删除键\n\n第二段卡片。\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n')
      expect(v.state.doc.sliceString(v.state.selection.main.head).startsWith('收尾一段')).toBe(true)
    }
  })

  it('没有标题、第一段摆在白板上：段首退格不删位置行', () => {
    const doc = '<!-- card id=d1 x=1 y=2 -->\n没有标题的第一段。\n\n第二段。\n'
    const v = open({ name: '', doc })
    v.dispatch({ selection: { anchor: doc.indexOf('没有标题') }, userEvent: 'select' })
    keys['退格']!(v)
    expect(v.state.doc.toString()).toBe(doc)
  })

  it('展开的折叠块后面那段段首退格三下：第一下并掉空行，后面停住，</details> 不丢', () => {
    const doc = '# 折叠退格\n\n<details>\n<summary>标题甲</summary>\n\n第一段里面。\n\n</details>\n\n后面一段。\n'
    const v = open({ name: '', doc, open: [0] })
    v.dispatch({ selection: { anchor: doc.indexOf('后面一段') }, userEvent: 'select' })
    for (let i = 0; i < 3; i++) keys['退格']!(v)
    expect(v.state.doc.toString()).toBe(doc.replace('</details>\n\n后面', '</details>\n后面'))
    typeAt(v, 'Z')
    expect(v.state.doc.toString()).toContain('</details>\nZ后面一段。')
  })

  it('折叠块前面有位置行、展开：从上一段末尾 ↓ 落到 <details> 前面，打的字进标题', () => {
    const doc = '# 折叠\n\n第一段。\n\n<!-- card id=d3 x=1 y=2 -->\n<details>\n<summary>收着的标题</summary>\n\n里面。\n\n</details>\n\n后面。\n'
    const v = open({ name: '', doc, open: [0] })
    v.dispatch({ selection: { anchor: doc.indexOf('第一段。') + 4 }, userEvent: 'select' })
    // ↓ 两下：先到空行，再落到下一屏行最左边，就是 <details> 的行首（藏着）
    v.dispatch({ selection: { anchor: doc.indexOf('\n\n<!--') + 1 }, userEvent: 'select' })
    v.dispatch({ selection: { anchor: doc.indexOf('<details>') }, userEvent: 'select' })
    typeAt(v, 'Q')
    expect(v.state.doc.toString()).toBe(doc.replace('<summary>收着的标题', '<summary>Q收着的标题'))
  })

  it('图片上下的空行：光标能停，打的字另起一行（图片不并进正文、不露原文），光标在打的字后面；空行删不掉，下面段首退格先选中图片', () => {
    const doc = '# 图\n\n前一段。\n\n![说明](附件/a.png)\n\n后一段。\n'
    const v = open({ name: '', doc })
    v.dispatch({ selection: { anchor: doc.indexOf('\n\n![') + 1 }, userEvent: 'select' })
    expect(v.state.selection.main.head).toBe(doc.indexOf('\n\n![') + 1)
    typeAt(v, 'A')
    typeAt(v, 'B')
    expect(v.state.doc.toString()).toBe('# 图\n\n前一段。\nAB\n\n![说明](附件/a.png)\n\n后一段。\n')
    const below = open({ name: '', doc })
    below.dispatch({ selection: { anchor: doc.indexOf(')\n\n') + 2 }, userEvent: 'select' })
    typeAt(below, 'C')
    expect(below.state.doc.toString()).toBe('# 图\n\n前一段。\n\n![说明](附件/a.png)\n\nC\n后一段。\n')
    const del = open({ name: '', doc })
    del.dispatch({ selection: { anchor: doc.indexOf(')\n\n') + 2 }, userEvent: 'select' })
    keys['Delete']!(del)
    expect(del.state.doc.toString()).toBe(doc)
    del.dispatch({ selection: { anchor: doc.indexOf('后一段') }, userEvent: 'select' })
    keys['退格']!(del)
    expect(del.state.doc.toString()).toBe(doc)
    expect(del.state.sliceDoc(del.state.selection.main.from, del.state.selection.main.to)).toBe('![说明](附件/a.png)')
  })

  it('点属性表的一行进原文（软件有意的，带 hiddenOk）：光标进得去，能改；没带的程序挪光标照样挪出来', () => {
    const doc = '---\n课程: 写作\n---\n# 标题\n\n正文。\n'
    const v = open({ name: '', doc })
    v.dispatch({ selection: { anchor: doc.indexOf('写作') + 2 } })
    expect(v.state.selection.main.head).toBe(doc.indexOf('# 标题'))
    v.dispatch({ selection: { anchor: doc.indexOf('写作') + 2 }, annotations: hiddenOk.of(true) })
    typeAt(v, '课')
    expect(v.state.doc.toString()).toBe(doc.replace('写作', '写作课'))
  })
})
