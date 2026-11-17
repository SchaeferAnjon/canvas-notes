/**
 * 藏起来的语法 × 每种按键（第 5 轮：位置行、属性的 ---、折叠块的 <details>/<summary>/</details>、时刻块、图片、收着的提示块
 * 能被 ←、↓、Delete、Ctrl+D、退格改坏）。每一格：按下去以后藏着的每一段原样还在（整块选中删掉的除外），光标不在藏着的地方，⌘Z 回到原样。
 *
 * 编辑器没有屏幕（Vitest 跑在 node 里）：
 * - 退格、Delete、Ctrl+D、选中删除、粘贴、打字用的是 CodeMirror 自己的命令和这里登记的按键（先跑优先级高的，跟真编辑器一样）；
 * - ←→ 先跑 stepOver，再照 CodeMirror 的 moveByChar 挪一个字、跨过 atomicRanges；
 * - ↑↓、Home、End、Ctrl+A、Ctrl+E、点：落在哪儿取决于排版，这里把每一个位置都当落点试一遍（从上面来、从下面来、点的）。
 * 真键盘在 e2e/r5-hidden.spec.ts 里再按一遍。
 *
 * 第 6 轮：挪行、Ctrl+T、⌘/ 这些没列在上面的键从旁边漏过去。后半截把文档里真有的每一套键（CodeMirror 自带、markdown、我们自己的）
 * 从编辑器里取出来，除了只挪光标的，每个键对每种藏起来的语法按一遍；新加的键、CodeMirror 升级多出来的键自动进表。
 */
import * as cmds from '@codemirror/commands'
import { deleteCharBackward, deleteCharForward, history, insertNewlineAndIndent, undo } from '@codemirror/commands'
import { insertNewlineContinueMarkup, markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Extension, type SelectionRange, Transaction, type TransactionSpec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { atomicBlocks, backspaceSelectsBlock } from '../src/renderer/atomic-blocks'
import { docKeys, enterInQuote } from '../src/renderer/doc-keys'
import { highlightKeys } from '../src/renderer/highlight'
import { noteKeys } from '../src/renderer/note-keys'
import { editorHost } from '../src/renderer/editor-host'
import { enterInFoldTitle, foldBlock, foldBlocks, toggleFold } from '../src/renderer/fold-block'
import { type Hidden, hiddenGuard, hiddenOk, hiddenRanges, stepOver } from '../src/renderer/hidden-syntax'
import { backspaceOverLayout, deleteOverLayout, layoutLines } from '../src/renderer/layout-lines'
import { mdWidgets } from '../src/renderer/md-widgets'
import { propsBlock } from '../src/renderer/mindmap/props-block'
import { baseBlock } from '../src/renderer/base/base-block'

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
  baseBlock,
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

const VIDEO = '<!-- video video=youtube:7CVYBBX_zxA -->\n![视频标题](附件/c.png)\n[视频标题](https://www.youtube.com/watch?v=7CVYBBX_zxA)\nIC实验室 · 08:55'
const MOMENT_QUOTE =
  '<!-- moment video=youtube:7CVYBBX_zxA t=1.1 -->\n![00:01](附件/c.png)\n[▶ 00:01 · 视频标题](https://www.youtube.com/watch?v=7CVYBBX_zxA&t=1s)\n> **00:01 原文一句**'
const BASE = '```base\nfilters:\n  and:\n    - file.inFolder("测/库")\nviews:\n  - type: table\n```'

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
  { name: '展开的提示块', doc: '# 块\n\n上一段。\n\n> [!tip] 提示标题\n> 提示正文。\n\n下一段。\n' },
  { name: '展开的提示块（能收起）', doc: '# 块\n\n上一段。\n\n> [!ai]+ 讲解\n> 正文一\n\n下一段。\n' },
  { name: '视频卡', doc: `# 块\n\n上一段。\n\n${VIDEO}\n\n下一段。\n` },
  { name: '时刻块（带原文）', doc: `# 块\n\n上一段。\n\n${MOMENT_QUOTE}\n\n下一段。\n` },
  { name: '数据库块', doc: `# 块\n\n上一段。\n\n${BASE}\n\n下一段。\n` },
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
  // 只藏一个换行的（展开的提示块下面那个）去掉换行是空的：它留没留住由空行数（shapes）看
  for (const [core, n] of want) if (core) expect(lines(core), `${where}：「${core}」`).toBeGreaterThanOrEqual(n)
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

// ---------- 第 6 轮：第 5 轮看守没覆盖到的编辑路径 ----------

/** 文档模式里真有的几套键（优先级和 note-doc.ts、doc-editing.ts 里一样） */
const withKeys: Extension[] = [...extensions, docKeys, atomicBlocks, highlightKeys, keymap.of(noteKeys)]

function openKeys(sample: Sample): View {
  const v = fakeView(EditorState.create({ doc: sample.doc, extensions: withKeys }))
  for (const i of sample.open ?? []) v.dispatch({ effects: toggleFold.of(foldBlocks(v.state.doc.toString())[i]!.from) })
  v.dispatch({ selection: { anchor: v.state.doc.length }, userEvent: 'select' })
  return v
}

/** 键名统一成 mac 上的写法：Mod 是 Cmd，修饰键排好序 */
function keyName(name: string): string {
  const parts = name.split(/-(?!$)/)
  const key = parts.pop()!
  const mods = parts.map((m) => (m === 'Mod' || m === 'Meta' ? 'Cmd' : m)).sort()
  return [...mods, key].join('-')
}

type Cmd = (v: EditorView) => boolean
/** 每个键在 mac 上会依次试的命令（先试优先级高的，第一个返回 true 的算数），和 CodeMirror 的 keymap 一样 */
function chains(state: EditorState): Map<string, Cmd[]> {
  const out = new Map<string, Cmd[]>()
  const add = (name: string, f: Cmd | undefined) => {
    if (!f) return
    const k = keyName(name)
    out.set(k, [...(out.get(k) ?? []), f])
  }
  for (const set of state.facet(keymap))
    for (const b of set) {
      const name = b.mac ?? b.key
      if (!name) continue
      add(name, b.run as Cmd | undefined)
      add('Shift-' + name, b.shift as Cmd | undefined)
    }
  return out
}

/** 只挪光标、选区的命令（光标停哪由前面「每个位置当落点」那组测）；别的键都当会改文档，对每种藏起来的语法按一遍 */
const NAV = new Set<unknown>(
  Object.entries(cmds)
    .filter(([n]) => /^(cursor|select|addCursor|simplifySelection|toggleTabFocusMode)/.test(n))
    .map(([, f]) => f),
)

/** 没有屏幕时 CodeMirror 量排版的那几个：照一行一行、没有折行算 */
function withLayout(v: View): View {
  const line = (pos: number) => v.state.doc.lineAt(pos)
  Object.defineProperty(v, 'lineWrapping', { value: false })
  Object.defineProperty(v, 'lineBlockAt', { value: (pos: number) => ({ from: line(pos).from, to: line(pos).to }) })
  Object.defineProperty(v, 'moveToLineBoundary', { value: (r: SelectionRange, forward: boolean) => EditorSelection.cursor(forward ? line(r.head).to : line(r.head).from) })
  Object.defineProperty(v, 'moveVertically', {
    value: (r: SelectionRange, forward: boolean) => {
      const l = line(r.head)
      const n = l.number + (forward ? 1 : -1)
      if (n < 1 || n > v.state.doc.lines) return EditorSelection.cursor(forward ? v.state.doc.length : 0)
      const to = v.state.doc.line(n)
      return EditorSelection.cursor(Math.min(to.to, to.from + r.head - l.from))
    },
  })
  return v
}

/** 藏着的每一段（去掉两头换行）连同它边上留住几个空行：按完以后应该一模一样（没被拆开、没并进正文、正文没被藏进去） */
const shapes = (s: EditorState) =>
  hiddenRanges(s)
    .map((h) => `${s.doc.sliceString(h.from, h.to).replace(/^\n+|\n+$/g, '')}｜空行${h.glue?.length ?? 0}`)
    .sort()

const press = (v: View, chain: Cmd[]) => {
  for (const f of chain) if (f(v)) return
}

describe('每个会改文档的键（CodeMirror 自带的、markdown 的、我们自己的）× 每种藏起来的语法', () => {
  const all = chains(EditorState.create({ doc: '', extensions: withKeys }))
  const tested = [...all].filter(([, chain]) => !chain.some((f) => NAV.has(f)))

  it('键表里有挪行、复制行、对调、缩进、删行、⌘/ 这些（CodeMirror 升级换了键名时这里先报）', () => {
    const names = tested.map(([k]) => k)
    for (const k of ['Alt-ArrowUp', 'Alt-ArrowDown', 'Alt-Shift-ArrowUp', 'Alt-Shift-ArrowDown', 'Ctrl-t', 'Ctrl-o', 'Ctrl-k', 'Cmd-/', 'Ctrl-A', 'Cmd-[', 'Cmd-]', 'Alt-Cmd-\\', 'Cmd-Shift-k', 'Cmd-Enter', 'Enter', 'Shift-Enter', 'Backspace', 'Delete', 'Ctrl-d', 'Ctrl-h', 'Alt-Backspace', 'Cmd-Backspace', 'Tab'])
      expect(names, k).toContain(k)
  })

  it('⌘/、⇧⌃A 在笔记里不做事：不包成 <!-- … -->', () => {
    for (const k of ['Cmd-/', 'Ctrl-A']) {
      const doc = '# 注释键\n\n第一段。\n\n<!-- card id=d2 x=900 y=200 -->\n第二段摆着。\n\n第三段。\n'
      const v = withLayout(openKeys({ name: '', doc }))
      v.dispatch({ selection: EditorSelection.range(doc.indexOf('第一段'), doc.indexOf('第二段摆着') + 6), userEvent: 'select' })
      press(v, all.get(k)!)
      expect(v.state.doc.toString(), k).toBe(doc)
      v.dispatch({ selection: { anchor: doc.indexOf('第二段摆着') + 2 }, userEvent: 'select' })
      press(v, all.get(k)!)
      expect(v.state.doc.toString(), k).toBe(doc)
    }
  })

  describe.each(samples)('$name', (sample) => {
    it.each(tested.map(([k]) => k))('%s：藏着的原样、没并进正文，光标在能停的地方，⌘Z 回到原样', (k) => {
      const chain = all.get(k)!
      const v0 = openKeys(sample)
      const want = shapes(v0.state)
      for (const at of stops(v0.state)) {
        for (const times of [1, 2]) {
          const v = withLayout(openKeys(sample))
          v.dispatch({ selection: { anchor: at }, userEvent: 'select' })
          for (let i = 0; i < times; i++) {
            // 退格碰到整块先选中，再按就是有意删掉这一块
            const sel = v.state.selection.main
            if (!sel.empty && hiddenRanges(v.state).some((h) => h.unit && h.unit.from === sel.from && h.unit.to === sel.to)) break
            press(v, chain)
          }
          const where = `${sample.name} 从 ${at} 按 ${k} ${times} 下：${JSON.stringify(v.state.doc.toString())}`
          if (v.state.selection.main.empty) expect(badCursor(v.state, v.state.selection.main.head), where).toBe(false)
          expectIntact(v0.state, v.state, where)
          if (v.state.selection.main.empty) expect(shapes(v.state), where).toEqual(want)
          for (let i = 0; i < 6; i++) undo(v)
          expect(v.state.doc.toString(), where + ' 再 ⌘Z').toBe(sample.doc)
        }
      }
    })
  })
})

describe('第 6 轮报告里的几条，按原样走一遍', () => {
  const CALLOUT = '# 块\n\n上一段。\n\n> [!tip] 提示标题\n> 提示正文。\n\n下一段。\n'
  const IMG = '# 块\n\n上一段。\n\n![图](附件/c.png)\n\n下一段。\n'
  const keys6 = chains(EditorState.create({ doc: '', extensions: withKeys }))
  const key = (v: View, k: string) => press(v, keys6.get(k)!)

  it('展开的提示块下面的空行里打字、粘贴：另起一段，空行留着，下一段不并进提示块', () => {
    const v = openKeys({ name: '', doc: CALLOUT })
    v.dispatch({ selection: { anchor: CALLOUT.indexOf('\n\n下一段') + 1 }, userEvent: 'select' })
    for (const ch of '新打的字') typeAt(v, ch)
    expect(v.state.doc.toString()).toBe(CALLOUT.replace('\n\n下一段', '\n\n新打的字\n下一段'))
    const p = openKeys({ name: '', doc: CALLOUT })
    p.dispatch({ selection: { anchor: CALLOUT.indexOf('\n\n下一段') + 1 }, userEvent: 'select' })
    keys['粘贴']!(p)
    expect(p.state.doc.toString()).toBe(CALLOUT.replace('\n\n下一段', '\n\n贴\n\n进来\n下一段'))
  })

  it('⌥↑ / ⌥↓ 挨着提示块、图片、视频卡、时刻块：块不和正文并在一起（不挪）', () => {
    for (const doc of [CALLOUT, IMG, `# 块\n\n上一段。\n\n${VIDEO}\n\n下一段。\n`, `# 块\n\n上一段。\n\n${MOMENT_QUOTE}\n\n下一段。\n`]) {
      const up = withLayout(openKeys({ name: '', doc }))
      up.dispatch({ selection: { anchor: doc.indexOf('下一段') }, userEvent: 'select' })
      key(up, 'Alt-ArrowUp')
      expect(up.state.doc.toString()).toBe(doc)
      const down = withLayout(openKeys({ name: '', doc }))
      down.dispatch({ selection: { anchor: doc.indexOf('上一段。') + 4 }, userEvent: 'select' })
      key(down, 'Alt-ArrowDown')
      expect(down.state.doc.toString()).toBe(doc)
    }
  })

  it('Ctrl+T：摆在白板上的段落段首、图片下一段段首都不对调；普通两个字照常对调', () => {
    const placed = '# 拖出\n\n第一段。\n\n<!-- card id=d2 x=900 y=200 -->\n第二段摆着。\n'
    const v = withLayout(openKeys({ name: '', doc: placed }))
    v.dispatch({ selection: { anchor: placed.indexOf('第二段') }, userEvent: 'select' })
    key(v, 'Ctrl-t')
    expect(v.state.doc.toString()).toBe(placed)
    const img = withLayout(openKeys({ name: '', doc: IMG }))
    img.dispatch({ selection: { anchor: IMG.indexOf('下一段') }, userEvent: 'select' })
    key(img, 'Ctrl-t')
    expect(img.state.doc.toString()).toBe(IMG)
    img.dispatch({ selection: { anchor: IMG.indexOf('下一段') + 1 }, userEvent: 'select' })
    key(img, 'Ctrl-t')
    expect(img.state.doc.toString()).toBe(IMG.replace('下一段', '一下段'))
  })

  it('点图片（选中这一块）再打字：整串字落在图片下面一段，光标跟着字走', () => {
    const doc = '# 一图\n\n上一段。\n\n![图一](附件/c.png)\n\n下一段。\n'
    const from = doc.indexOf('![')
    const to = doc.indexOf(')\n') + 1
    // 浏览器把第一个字当成换掉选区（replaceSelection）
    const v = openKeys({ name: '', doc })
    v.dispatch({ selection: EditorSelection.range(from, to), userEvent: 'select.pointer' })
    for (const ch of 'xyz') typeAt(v, ch)
    expect(v.state.doc.toString()).toBe(doc.replace('\n\n下一段', '\n\nxyz\n下一段'))
    // 也可能直接插在块后面的空行里（报告里看到的）：后面的字跟着
    const w = openKeys({ name: '', doc })
    w.dispatch({ selection: EditorSelection.range(from, to), userEvent: 'select.pointer' })
    w.dispatch({ changes: { from: to + 1, insert: 'x' }, userEvent: 'input.type' })
    for (const ch of 'yz') typeAt(w, ch)
    expect(w.state.doc.toString()).toBe(doc.replace('\n\n下一段', '\n\nxyz\n下一段'))
    // 块下面紧挨着正文（数据库块的 ``` 下面直接一段）：字前后各空一行
    const tight = `# 表\n\n${BASE}\n下一段。\n`
    const t = openKeys({ name: '', doc: tight })
    t.dispatch({ selection: EditorSelection.range(tight.indexOf('```'), tight.lastIndexOf('```') + 3), userEvent: 'select.pointer' })
    for (const ch of 'ab') typeAt(t, ch)
    expect(t.state.doc.toString()).toBe(`# 表\n\n${BASE}\n\nab\n\n下一段。\n`)
  })
})
