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
import { ChangeSet, EditorSelection, EditorState, type Extension, type SelectionRange, Transaction, type TransactionSpec } from '@codemirror/state'
import { findMath } from '@cn/format'
import { Direction, EditorView, keymap } from '@codemirror/view'
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
import { reviewSyntax } from '../src/renderer/review'
import { enterLeft, enterRight, mathPreview, placedMath } from '../src/renderer/math-preview'
import { blockIds } from '../src/renderer/block-id'

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
  reviewSyntax,
  mathPreview,
  blockIds,
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
/** 白板（type: board）：自由的卡、列、列里的卡 */
const BOARD =
  '---\ntype: board\n---\n# 旅行\n\n<!-- card id=a1 x=10 y=20 -->\n自由的一张。\n\n<!-- column id=c1 x=384 y=60 w=300 title=地图与图片 -->\n<!-- card id=a2 in=c1 -->\n列里第一张。\n\n<!-- card id=a3 in=c1 -->\n列里第二张。\n'
const BOARD_IMG =
  '---\ntype: board\n---\n<!-- card id=b1 in=jg -->\nPhysical geography\n\n<!-- column id=d8 x=384 y=60 w=300 title="地图 与图片" -->\n\n<!-- card id=b2 in=d8 -->\n![](../../附件/剪藏/冰岛/sat.png)\n—— [Iceland sat](https://en.wikipedia.org/wiki/Geography_of_Iceland)\n\n<!-- card id=b3 in=d8 -->\n最后一张。\n'
const MATH_INLINE = '# 符号\n\n- $x_i$, $\\mathbf{x}_i$：向量 $\\mathbf{x}$ 第 $i$ 个元素\n- $\\mathbb{R}^{a\\times b}$：实数矩阵，花了 $5 和 $6\n\n后面一段。\n'
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
  { name: '引文下面的想法和评价（标签藏起来）', doc: '# 书摘\n\n> 接到叔叔谋反的消息。\n\n微信读书的想法：御驾亲征。\n\n我的评价：这一脚。\n\n下一段。\n' },
  { name: '引文下面空着的评价', doc: '# 书摘\n\n> 见面后，叔侄俩开聊。\n\n我的评价：\n\n下一段。\n' },
  // 第 8 轮：白板（type: board）用文档看法打开，卡片行、列行一样藏起来（以前白板不藏，露出 <!-- card … -->、<!-- column … -->）
  { name: '白板的卡片行和列行', doc: BOARD },
  { name: '白板：列紧跟在卡片后面、列里第一张卡是图片加来源', doc: BOARD_IMG },
  // task-4xtbp：从 Obsidian 导进来的行尾 ^块编号（[[笔记#^def1]] 指的就是它）
  { name: '行尾的块编号', doc: '# 定义\n\n线性映射保持加法和数乘。 ^def1\n\n- 第一条\n- 列表里一条 ^li-2\n\n后面一段。\n' },
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

/**
 * 评价的标签跟着整段删掉（⌘⇧K 删掉评价这一行）：这一段整个没了，不算改坏（标签是这一段自己的开头，不是隔开块的语法）；
 * 行尾的 ^块编号 也一样（整行删掉、删到行尾盖住整行时跟着删）
 */
function reviewsGone(before: EditorState, after: EditorState): Hidden[] {
  const text = after.doc.toString()
  return hiddenRanges(before).filter(
    (h) =>
      h.unit &&
      (/^\n?(\*\*)?(我的评价|微信读书的想法)/.test(before.doc.sliceString(h.from, h.to)) || /^[ \t]+\^[\w-]+\n?$/.test(before.doc.sliceString(h.from, h.to))) &&
      !text.includes(before.doc.sliceString(h.unit.from, h.unit.to).replace(/^\n+/, '')),
  )
}

/** 改完以后：原来藏着的每一段都还整行整行地在（出现次数不少），藏着的块一个没少（没露成原文） */
function expectIntact(before: EditorState, after: EditorState, where: string) {
  const text = after.doc.toString()
  // 整行：前面是行首（</summary> 接在标题字后面、行尾的「 ^块编号」接在正文后面，不算）、后面是行尾（<summary>、提示块的「> [!ai]- 」、评价的「我的评价：」后面接字，不算）
  const lines = (core: string) => {
    const needL = !core.startsWith('</summary>') && !/^[ \t]+\^[\w-]+$/.test(core)
    const needR = !(/<summary>$/i.test(core) || /^>\s*\[!/.test(core) || /^(\*\*)?(我的评价|微信读书的想法)/.test(core))
    let n = 0
    for (let i = text.indexOf(core); i >= 0; i = text.indexOf(core, i + 1)) {
      const okL = !needL || i === 0 || text[i - 1] === '\n'
      const okR = !needR || i + core.length === text.length || text[i + core.length] === '\n'
      if (okL && okR) n++
    }
    return n
  }
  const want = new Map<string, number>()
  const gone = reviewsGone(before, after)
  const goneCores = gone.map((h) => before.doc.sliceString(h.from, h.to).replace(/^\n+|\n+$/g, ''))
  for (const p of pieces(before)) want.set(p, (want.get(p) ?? 0) + 1)
  for (const c of goneCores) want.set(c, (want.get(c) ?? 1) - 1)
  // 只藏一个换行的（展开的提示块下面那个）去掉换行是空的：它留没留住由空行数（shapes）看
  for (const [core, n] of want) if (core) expect(lines(core), `${where}：「${core}」`).toBeGreaterThanOrEqual(n)
  expect(hiddenRanges(after).length, `${where}：藏着的块少了`).toBeGreaterThanOrEqual(hiddenRanges(before).length - gone.length)
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

describe('行尾的 ^块编号（task-4xtbp）', () => {
  const DOC = '# 定义\n\n线性映射保持加法和数乘。 ^def1\n\n`代码 ^x1`\n\n```\n代码块 ^x2\n```\n\n^own\n\n后面一段。\n'
  /** 屏上：块编号被 replace 盖住（藏着）还是露成淡色小字 */
  function looks(v: View, id: string): 'hidden' | 'shown' | 'plain' {
    const from = v.state.doc.toString().indexOf(id)
    let out: 'hidden' | 'shown' | 'plain' = 'plain'
    for (const set of v.state.facet(EditorView.decorations)) {
      const ds = typeof set === 'function' ? set(v) : set
      ds.between(from, from + id.length, (a, b, d) => {
        if (a <= from && b >= from + id.length) out = d.point ? 'hidden' : /cm-blockid/.test(String(d.spec.class)) ? 'shown' : out
      })
    }
    return out
  }

  it('藏着，光标到那一行也不露（DESIGN.v3 6.5 方向 A）；代码里的、顶格单独一行的不管', () => {
    const v = open({ name: '', doc: DOC })
    expect(looks(v, ' ^def1')).toBe('hidden')
    expect(looks(v, ' ^x1')).toBe('plain')
    expect(looks(v, ' ^x2')).toBe('plain')
    expect(looks(v, '^own')).toBe('plain')
    v.dispatch({ selection: { anchor: DOC.indexOf('线性') + 2 }, userEvent: 'select' })
    expect(looks(v, ' ^def1')).toBe('hidden')
  })

  it('点那一行末尾（End）：光标停在块编号前面，接着打的字在块编号前面；文件里块编号还在行尾', () => {
    const v = open({ name: '', doc: DOC })
    const end = DOC.indexOf(' ^def1') + ' ^def1'.length
    v.dispatch({ selection: { anchor: end }, userEvent: 'select' })
    expect(v.state.selection.main.head).toBe(DOC.indexOf(' ^def1'))
    typeAt(v, '（补一句）')
    expect(v.state.doc.toString()).toContain('线性映射保持加法和数乘。（补一句） ^def1\n')
  })

  it('行尾回车：块编号留在这一段上，新的一行起在它后面，接着打的字在新的一行；列表里回车接着是列表', () => {
    for (const [doc, line, want] of [
      [DOC, '线性映射保持加法和数乘。 ^def1', '线性映射保持加法和数乘。 ^def1\n新的一行'],
      ['- 第一条 ^a1\n- 第二条\n', '- 第一条 ^a1', '- 第一条 ^a1\n- 新的一行'],
    ] as const) {
      const v = open({ name: '', doc })
      v.dispatch({ selection: { anchor: doc.indexOf(line) + line.length }, userEvent: 'select' })
      keys['回车']!(v)
      typeAt(v, '新的一行')
      expect(v.state.doc.toString()).toContain(want)
      undo(v)
      undo(v)
      expect(v.state.doc.toString()).toBe(doc)
    }
  })

  it('打开不改文字（块编号只是装饰）', () => {
    const v = open({ name: '', doc: DOC })
    expect(v.state.doc.toString()).toBe(DOC)
  })
})

describe('报告里的几条，按原样走一遍', () => {
  it('白板用文档看法打开：每一行 <!-- card … -->、<!-- column … --> 都藏着（光标停不进、屏上不露），列名画成小节标题', () => {
    for (const doc of [BOARD, BOARD_IMG]) {
      const v = open({ name: '', doc })
      const hs = hiddenRanges(v.state)
      for (const m of doc.matchAll(/^<!--[^\n]*-->$/gm)) {
        const from = m.index!
        const to = from + m[0].length
        expect(hs.some((h) => h.from <= from && h.to >= to), `「${m[0]}」没藏`).toBe(true)
        // 屏上：整行被 replace 装饰盖住
        let covered = false
        for (const set of v.state.facet(EditorView.decorations)) {
          const ds = typeof set === 'function' ? set(v) : set
          ds.between(from, to, (a, b, d) => void (a <= from && b >= to && (d.spec.widget || d.point) && (covered = true)))
        }
        expect(covered, `「${m[0]}」露在屏上`).toBe(true)
      }
    }
    const heads: string[] = []
    const v = open({ name: '', doc: BOARD_IMG })
    for (const set of v.state.facet(EditorView.decorations)) {
      const ds = typeof set === 'function' ? set(v) : set
      ds.between(0, v.state.doc.length, (_a, _b, d) => void (d.spec.widget?.constructor?.name === 'ColumnHead' && heads.push((d.spec.widget as { title: string }).title)))
    }
    expect(heads).toEqual(['地图 与图片'])
  })

  it('白板文档看法：列名下面一行行首退格三下、上面一段末尾 Delete 三下，列那一行和卡片行都还在（列名不像图片那样先选中再删）', () => {
    const doc = BOARD
    const below = open({ name: '', doc })
    below.dispatch({ selection: { anchor: doc.indexOf('列里第一张') }, userEvent: 'select' })
    for (let i = 0; i < 3; i++) keys['退格']!(below)
    expect(below.state.doc.toString()).toContain('<!-- column id=c1 x=384 y=60 w=300 title=地图与图片 -->\n<!-- card id=a2 in=c1 -->\n')
    const above = open({ name: '', doc })
    above.dispatch({ selection: { anchor: doc.indexOf('自由的一张。') + 6 }, userEvent: 'select' })
    for (let i = 0; i < 3; i++) keys['Delete']!(above)
    expect(above.state.doc.toString()).toContain('<!-- column id=c1 x=384 y=60 w=300 title=地图与图片 -->\n<!-- card id=a2 in=c1 -->\n列里第一张。')
  })

  it('白板文档看法：打开、不动、拿出来的字和原文一个字节都不差', () => {
    for (const doc of [BOARD, BOARD_IMG]) expect(open({ name: '', doc }).state.doc.toString()).toBe(doc)
  })

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

  it('挨着块打一个字再删掉：守卫补的换行跟着拿掉，文件一个字节都不多（规矩 1：打一个字再删掉）', () => {
    const doc = '# 图\n\n前一段。\n\n![说明](附件/a.png)\n\n后一段。\n'
    for (const at of [doc.indexOf('\n\n![') + 1, doc.indexOf(')\n\n') + 2]) {
      const v = open({ name: '', doc })
      v.dispatch({ selection: { anchor: at }, userEvent: 'select' })
      typeAt(v, 'x')
      expect(v.state.doc.toString()).not.toBe(doc)
      keys['退格']!(v)
      expect(v.state.doc.toString()).toBe(doc)
    }
    // 打两个字：退格一下只删一个字，第二下连补的换行一起拿掉
    const v = open({ name: '', doc })
    v.dispatch({ selection: { anchor: doc.indexOf('\n\n![') + 1 }, userEvent: 'select' })
    typeAt(v, 'A')
    typeAt(v, 'B')
    keys['退格']!(v)
    expect(v.state.doc.toString()).toBe('# 图\n\n前一段。\nA\n\n![说明](附件/a.png)\n\n后一段。\n')
    keys['退格']!(v)
    expect(v.state.doc.toString()).toBe(doc)
    // 收着的折叠块前面（rule1 的样本 html-and-tables.md）：一样
    const fold = '| a | b |\n|---|:-:|\n| 1 | 2 |\n\n<details><summary>折叠</summary>\n\n里面\n\n</details>\n'
    const f = open({ name: '', doc: fold })
    f.dispatch({ selection: { anchor: fold.indexOf('<details>') }, userEvent: 'select' })
    typeAt(f, 'x')
    expect(f.state.doc.toString()).not.toBe(fold)
    keys['退格']!(f)
    expect(f.state.doc.toString()).toBe(fold)
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
      // 段落里的一行图（白板卡片里图下面紧跟来源行，第 8 轮）：回车把来源行隔开、删掉来源行以后它单独成段，
      // 边上多出来的空行是用户自己改的，只比图本身
      const inPara = new Set(hiddenRanges(v0.state).filter((h) => !h.sep).map((h) => v0.state.doc.sliceString(h.from, h.to).replace(/^\n+|\n+$/g, '')).filter((c) => /^\[?!\[/.test(c)))
      const norm = (xs: string[]) => xs.map((x) => (inPara.has(x.split('｜')[0]!) ? x.split('｜')[0]! : x)).sort()
      const want = norm(shapes(v0.state))
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
          if (v.state.selection.main.empty && !reviewsGone(v0.state, v.state).length) expect(norm(shapes(v.state)), where).toEqual(want)
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

// ---------- task-o48fa 公式：排好的是一整颗，光标走进去露写法 ----------

const MATH_SAMPLES: Sample[] = [
  { name: '行内公式（d2l 符号表的两行，带钱数）', doc: MATH_INLINE },
  { name: '单独成行的公式（$$ 夹着一行）', doc: '# 公式\n\n上一段。\n\n$$\n\\sum_{i=1}^{n} x_i\n$$\n\n下一段。\n' },
  { name: '单独成行的公式（一行写完，上下紧挨着正文）', doc: '# 公式\n\n上一段：\n$$E = mc^2$$\n下一段。\n' },
  { name: '\\(…\\) 和 \\[…\\]（文件末尾）', doc: '设 \\(a^2\\) 是\n\n\\[\nb^2\n\\]' },
]

type MView = View & { changes: ChangeSet }

/** 记着一路改了什么的编辑器（判断排好的公式是整颗删掉的、还是被改了半截） */
function mathView(doc: string, at: number): MView {
  let s = EditorState.create({ doc, extensions: withKeys })
  const v = Object.create(EditorView.prototype) as MView
  Object.defineProperty(v, 'state', { get: () => s })
  Object.defineProperty(v, 'plugin', { value: () => null })
  v.changes = ChangeSet.empty(doc.length)
  Object.defineProperty(v, 'dispatch', {
    value: (...specs: (TransactionSpec | Transaction)[]) => {
      const tr = specs[0] instanceof Transaction ? specs[0] : s.update(...(specs as TransactionSpec[]))
      v.changes = v.changes.compose(tr.changes)
      s = tr.state
    },
  })
  withLayout(v)
  v.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  v.changes = ChangeSet.empty(doc.length)
  return v
}

/**
 * 排好的（光标不在里面的）公式：按一下以后要么整颗还在、照样认得出是公式，要么整颗删掉了；不许改到半截（连单独成行的上下那个换行）。
 * 例外（$ 写法本身的规矩，pandoc、Obsidian 一样）：同一行别处的字改了，让一个落单的 $ 和它配成了对、或者它后面紧跟了数字（$x$5），
 * 它就不再是公式，文件里的字照实
 */
function expectMathIntact(before: EditorState, v: MView, where: string) {
  const after = v.state
  const now = findMath(after.doc.toString())
  const len = before.doc.length
  for (const p of placedMath(before).filter((x) => !x.open && x.html !== null)) {
    const a = p.block && p.a > 0 ? p.a - 1 : p.a
    const b = p.block && p.b < len ? p.b + 1 : p.b
    let whole = false
    let partial = false
    v.changes.iterChanges((fA, tA) => {
      if (tA > fA && fA <= p.a && tA >= p.b) whole = true
      else if ((tA > fA && fA < b && tA > a) || (fA === tA && fA > p.a && fA < p.b)) partial = true
    })
    if (whole) continue
    const src = before.doc.sliceString(p.span.from, p.span.to)
    expect(partial, `${where}：改到了「${src}」的半截 → ${JSON.stringify(after.doc.toString())}`).toBe(false)
    const from = v.changes.mapPos(p.span.from, 1)
    const to = v.changes.mapPos(p.span.to, -1)
    let sameLine = false
    const line = before.doc.lineAt(p.span.from)
    v.changes.iterChanges((fA, tA) => void (fA <= line.to && tA >= line.from && (sameLine = true)))
    if (sameLine) continue
    expect(
      now.some((m) => m.from === from && m.to === to && m.tex === p.span.tex && m.block === p.span.block),
      `${where}：「${src}」不再是公式 → ${JSON.stringify(after.doc.toString())}`,
    ).toBe(true)
  }
  // 光标停不进排好的公式中间
  const sel = after.selection.main
  if (sel.empty) expect(placedMath(after).some((x) => !x.open && x.html !== null && sel.head > x.a && sel.head < x.b), `${where}：光标停在排好的公式中间 ${sel.head}`).toBe(false)
}

/** 文档里的键（math-preview 的先轮到）：← → 走进写法再照 CodeMirror 挪一个字；↑↓ 照没有折行的排版；打字、粘贴 */
function mathKey(k: string): (v: View) => void {
  const all = chains(EditorState.create({ doc: '', extensions: withKeys }))
  const vertical = (down: boolean) => (v: View) =>
    press(v, [...all.get(down ? 'ArrowDown' : 'ArrowUp')!.filter((f) => !NAV.has(f)), (x: EditorView) => (x.dispatch({ selection: x.moveVertically(x.state.selection.main, down), userEvent: 'select' }), true)])
  if (k === '→') return (v) => void (enterRight(v) || moveChar(v, 1))
  if (k === '←') return (v) => void (enterLeft(v) || moveChar(v, -1))
  if (k === '↓') return vertical(true)
  if (k === '↑') return vertical(false)
  if (k === '打字' || k === '粘贴') return keys[k]!
  return (v) => press(v, all.get(k)!)
}

describe('task-o48fa 公式 × 每个会改文档的键 × 每个位置', () => {
  const all = chains(EditorState.create({ doc: '', extensions: withKeys }))
  const names = [...[...all].filter(([, chain]) => !chain.some((f) => NAV.has(f))).map(([k]) => k), '←', '→', '↑', '↓', '打字', '粘贴']

  it('键表里有退格、Delete、Ctrl-d、删词、删行、挪行、回车、Tab', () => {
    for (const k of ['Backspace', 'Delete', 'Ctrl-d', 'Alt-Backspace', 'Cmd-Backspace', 'Cmd-Shift-k', 'Alt-ArrowUp', 'Ctrl-t', 'Enter', 'Tab']) expect(names, k).toContain(k)
  })

  describe.each(MATH_SAMPLES)('$name', (sample) => {
    it.each(names)('%s：排好的公式整颗在或整颗删，光标不停在它中间，⌘Z 回到原样', (k) => {
      const len = sample.doc.length
      const key = mathKey(k)
      for (let at = 0; at <= len; at++) {
        for (const times of [1, 2]) {
          const v = mathView(sample.doc, at)
          const where = `${sample.name} 从 ${at} 按 ${k} ${times} 下`
          // 每一下都看：按之前排好的那些（按了第一下光标走进去了的，第二下就是在改写法）
          for (let i = 0; i < times; i++) {
            const before = v.state
            v.changes = ChangeSet.empty(before.doc.length)
            key(v)
            expectMathIntact(before, v, `${where}（第 ${i + 1} 下）`)
          }
          for (let i = 0; i < 6; i++) undo(v)
          expect(v.state.doc.toString(), where + ' 再 ⌘Z').toBe(sample.doc)
        }
      }
    })

    it('从任一位置选到另一个位置再退格：排好的公式整颗在或整颗删', () => {
      const len = sample.doc.length
      for (let a = 0; a <= len; a++)
        for (let b = a + 1; b <= len; b++) {
          const v = mathView(sample.doc, len)
          v.dispatch({ selection: EditorSelection.range(a, b), userEvent: 'select' })
          const before = v.state
          v.changes = ChangeSet.empty(len)
          deleteCharBackward(v)
          expectMathIntact(before, v, `${sample.name} 选 ${a}–${b} 退格`)
          undo(v)
          expect(v.state.doc.toString()).toBe(sample.doc)
        }
    })
  })
})

describe('task-o48fa 公式：光标进出、整颗选中删、写错的', () => {
  const doc = MATH_INLINE
  const at = (s: string) => doc.indexOf(s)
  const opened = (v: View) => placedMath(v.state).filter((p) => p.open).map((p) => v.state.doc.sliceString(p.span.from, p.span.to))

  it('光标在文末时每个公式都排好（钱数不算），交给看守；打开时编辑器自己放在公式里的光标不露', () => {
    const v = mathView(doc, doc.length)
    const ps = placedMath(v.state)
    expect(ps.map((p) => doc.slice(p.span.from, p.span.to))).toEqual(['$x_i$', '$\\mathbf{x}_i$', '$\\mathbf{x}$', '$i$', '$\\mathbb{R}^{a\\times b}$'])
    expect(ps.every((p) => !p.open && p.html !== null)).toBe(true)
    expect(hiddenRanges(v.state).length).toBe(5)
    const fresh = EditorState.create({ doc, extensions: withKeys, selection: { anchor: at('x_i') } })
    expect(placedMath(fresh).some((p) => p.open)).toBe(false)
  })

  it('→ 从左边走进写法（$ 后面），一路 → 走出去又排好；← 从右边走进（$ 前面）', () => {
    const v = mathView(doc, at('$x_i$'))
    const right = mathKey('→')
    right(v)
    expect(v.state.selection.main.head).toBe(at('$x_i$') + 1)
    expect(opened(v)).toEqual(['$x_i$'])
    for (let i = 0; i < 4; i++) right(v)
    expect(v.state.selection.main.head).toBe(at('$x_i$') + 5)
    expect(opened(v)).toEqual([])
    const w = mathView(doc, at('$x_i$') + 5)
    mathKey('←')(w)
    expect(w.state.selection.main.head).toBe(at('$x_i$') + 4)
    expect(opened(w)).toEqual(['$x_i$'])
  })

  it('写法里打字改公式：文件里是改过的写法，走出去排好的是新的', () => {
    const v = mathView(doc, at('$x_i$') + 4)
    v.dispatch({ ...v.state.replaceSelection('j'), userEvent: 'input.type' })
    expect(v.state.doc.toString()).toBe(doc.replace('$x_i$', '$x_ij$'))
    v.dispatch({ selection: { anchor: v.state.doc.length }, userEvent: 'select' })
    expect(placedMath(v.state)[0]!.span.tex).toBe('x_ij')
    expect(placedMath(v.state)[0]!.open).toBe(false)
  })

  it('退格在公式后面：先选中整颗（选中的字是 $…$ 原文），再按一次整颗删掉；Delete 在前面同样', () => {
    const v = mathView(doc, at('$x_i$') + 5)
    const bs = mathKey('Backspace')
    bs(v)
    const sel = v.state.selection.main
    expect(v.state.doc.sliceString(sel.from, sel.to)).toBe('$x_i$')
    expect(placedMath(v.state)[0]!.selected).toBe(true)
    expect(placedMath(v.state)[0]!.open).toBe(false)
    bs(v)
    expect(v.state.doc.toString()).toBe(doc.replace('$x_i$', ''))
    const d = mathView(doc, at('$x_i$'))
    mathKey('Delete')(d)
    expect(d.state.doc.sliceString(d.state.selection.main.from, d.state.selection.main.to)).toBe('$x_i$')
  })

  it('单独成行的：光标在那几行任何一处都露写法；下一行行首退格先选中整块；↓ 从上一行进到第一行行首', () => {
    const block = '上一段。\n\n$$\n\\sum_i x_i\n$$\n\n下一段。\n'
    const from = block.indexOf('$$')
    const to = block.lastIndexOf('$$') + 2
    for (let p = from; p <= to; p++) expect(placedMath(mathView(block, p).state)[0]!.open, `光标在 ${p}`).toBe(true)
    expect(placedMath(mathView(block, from - 1).state)[0]!.open).toBe(false)
    const v = mathView(block, to + 1)
    mathKey('Backspace')(v)
    expect(v.state.doc.sliceString(v.state.selection.main.from, v.state.selection.main.to)).toBe('$$\n\\sum_i x_i\n$$')
    const down = mathView(block, from - 1)
    mathKey('↓')(down)
    expect(down.state.selection.main.head).toBe(from)
  })

  it('写错的公式不排：原文照写，不交给看守，错在哪写成一句中文', () => {
    const v = mathView('坏的 $\\frac{1}{$ 和 $\\foo$ 公式\n', 0)
    const ps = placedMath(v.state)
    expect(ps.map((p) => p.html)).toEqual([null, null])
    expect(ps[0]!.error).toMatch(/^公式写错了：/)
    expect(ps[1]!.error).toBe('公式写错了：不认识的命令 \\foo（第 1 个字）')
    expect(hiddenRanges(v.state)).toEqual([])
  })
})

// ---------- task-6lsvd：整块下面一行行首退格、上面一行行尾 Delete ----------
// 用户 0.4.8：书摘末尾嵌着一个空的数据库块，下面一行行首退格删不掉，光标跳到上一段末尾。
// 这里的编辑器带上 wysiwyg（代码块围栏行登记成藏着的语法，```base 的围栏也在里面，以前的样本没带它，抓不到）、白板链接，
// 键按文档里真有的那几套（优先级照 note-doc.ts、doc-editing.ts）。

const { wysiwyg } = await import('../src/renderer/wysiwyg')
const { boardLink, setBoards } = await import('../src/renderer/board-link')

const blockKeys: Extension[] = [...withKeys, wysiwyg, boardLink]

interface BlockSample {
  name: string
  /** 整块的原文（独占几行） */
  block: string
  /** 只认紧挨着的那一行（单独成行的公式：上下的空行是普通空行，隔着空行退格先删空行，task-o48fa 定的） */
  near?: boolean
}

const BLOCK_SAMPLES: BlockSample[] = [
  { name: '数据库块（```base，有写法）', block: BASE },
  { name: '空的数据库块（```base 里没字，用户截图那块）', block: '```base\n```' },
  { name: '图片', block: '![说明](附件/a.png)' },
  { name: '视频卡', block: VIDEO },
  { name: '时刻块', block: MOMENT },
  { name: '表格', block: '| a | b |\n|---|---|\n| 1 | 2 |' },
  { name: '白板链接（独占一行的 [[白板]]）', block: '[[白板甲]]' },
  { name: '单独成行的公式（对照，task-o48fa 已做）', block: '$$\n\\sum_i x_i\n$$', near: true },
]

const docOf = (block: string) => `# 块\n\n上一段。\n\n${block}\n\n下一段。\n`

function openBlock(doc: string, at: number): View {
  const v = withLayout(fakeView(EditorState.create({ doc, extensions: blockKeys })))
  // ← → 收起选区时 CodeMirror 问这一处的文字方向
  Object.defineProperty(v, 'textDirectionAt', { value: () => Direction.LTR })
  v.dispatch({ effects: setBoards.of(new Map([['白板甲', { path: '白板甲.md', color: 'blue', cards: 2 }]])) })
  v.dispatch({ selection: { anchor: at }, userEvent: 'select' })
  return v
}

const blockChains = chains(EditorState.create({ doc: '', extensions: blockKeys }))
const pressKey = (v: View, k: string) => press(v, blockChains.get(k)!)
const selected = (v: View) => v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)

/** 整块要么整个在、要么整个没了：块里任何一行（去掉两头空白至少 3 个字）都不许单独留下来 */
function wholeOrGone(doc: string, block: string, where: string): 'kept' | 'gone' {
  if (doc.includes(block)) return 'kept'
  const left = block.split('\n').filter((l) => l.trim().length >= 3 && doc.includes(l))
  expect(left, `${where}：整块删了一半，留下 ${JSON.stringify(left)}：${JSON.stringify(doc)}`).toEqual([])
  return 'gone'
}

describe.each(BLOCK_SAMPLES)('task-6lsvd 整块：$name', ({ block, near }) => {
  const doc = docOf(block)
  const from = doc.indexOf(block)
  const to = from + block.length
  // 删掉整块以后：上一段、空一行、下一段（不多出空行）
  const gone = '# 块\n\n上一段。\n\n下一段。\n'

  it.each([
    ['块下面一行（空行）行首', to + 1],
    ...(near ? [] : [['块下面隔一个空行的下一段段首', to + 2] as [string, number]]),
  ])('%s按退格：第一下选中整块、字不变；第二下连同它占的行删掉、光标留在原来那一行；⌘Z 一次回到原样', (_n, at) => {
    const v = openBlock(doc, at)
    pressKey(v, 'Backspace')
    expect(v.state.doc.toString()).toBe(doc)
    expect(selected(v)).toBe(block)
    pressKey(v, 'Backspace')
    expect(v.state.doc.toString()).toBe(gone)
    expect(v.state.selection.main.empty).toBe(true)
    // 光标不跳到上一段末尾这种不相干的地方：在块原来那一处（上一段下面的空行，或下一段段首）
    const head = v.state.selection.main.head
    expect([gone.indexOf('\n\n下一段') + 1, gone.indexOf('下一段')], `光标停在 ${head}`).toContain(head)
    expect(badCursor(v.state, head)).toBe(false)
    undo(v)
    expect(v.state.doc.toString()).toBe(doc)
  })

  it.each([
    ['块上面一行（空行）行尾', from - 1],
    ...(near ? [] : [['块上面隔一个空行的上一段段尾', from - 2] as [string, number]]),
  ])('%s按 Delete（Ctrl+D 一样）：第一下选中整块，第二下连同它占的行删掉；⌘Z 一次回到原样', (_n, at) => {
    for (const k of ['Delete', 'Ctrl-d']) {
      const v = openBlock(doc, at)
      pressKey(v, k)
      expect(v.state.doc.toString(), k).toBe(doc)
      expect(selected(v), k).toBe(block)
      pressKey(v, k)
      expect(v.state.doc.toString(), k).toBe(gone)
      const head = v.state.selection.main.head
      expect([gone.indexOf('\n\n下一段') + 1, gone.indexOf('\n\n下一段')], `${k} 光标停在 ${head}`).toContain(head)
      undo(v)
      expect(v.state.doc.toString(), k).toBe(doc)
    }
  })

  it('逐键：每个能停的位置按退格、Delete、Ctrl+D 一下、两下，整块整个在或整个删，光标不停在藏着的地方，⌘Z 回到原样', () => {
    const v0 = openBlock(doc, doc.length)
    for (const at of stops(v0.state)) {
      for (const k of ['Backspace', 'Delete', 'Ctrl-d']) {
        for (const times of [1, 2]) {
          const v = openBlock(doc, at)
          for (let i = 0; i < times; i++) pressKey(v, k)
          const text = v.state.doc.toString()
          const where = `从 ${at} 按 ${k} ${times} 下`
          wholeOrGone(text, block, where)
          if (v.state.selection.main.empty) expect(badCursor(v.state, v.state.selection.main.head), where).toBe(false)
          else expect(selected(v), where + ' 选中的就是这一块').toBe(block)
          for (let i = 0; i < 6; i++) undo(v)
          expect(v.state.doc.toString(), where + ' 再 ⌘Z').toBe(doc)
        }
      }
    }
  })

  it('选中整块以后用别的删除键（⌥⌫、⌘⌫、Ctrl+H、剪切）：整块整个删（看守不再把围栏这些块里藏着的留下），⌘Z 回到原样', () => {
    for (const k of ['Alt-Backspace', 'Cmd-Backspace', 'Ctrl-h', '剪切']) {
      const v = openBlock(doc, to + 1)
      pressKey(v, 'Backspace')
      expect(selected(v), k).toBe(block)
      if (k === '剪切') v.dispatch({ ...v.state.replaceSelection(''), userEvent: 'delete.cut' })
      else pressKey(v, k)
      const text = v.state.doc.toString()
      expect(wholeOrGone(text, block, k), k).toBe('gone')
      expect(badCursor(v.state, v.state.selection.main.head), k).toBe(false)
      for (let i = 0; i < 6; i++) undo(v)
      expect(v.state.doc.toString(), k).toBe(doc)
    }
  })

  it('选中整块（第一下退格）以后：← → 收起选中、字不变；打字留着块、字另起一段接在块下面', () => {
    for (const k of ['ArrowLeft', 'ArrowRight']) {
      const v = openBlock(doc, to + 1)
      pressKey(v, 'Backspace')
      pressKey(v, k)
      expect(v.state.selection.main.empty, k).toBe(true)
      expect(v.state.doc.toString(), k).toBe(doc)
    }
    // 打字：块原样留着，字在块和下一段之间自成一行（不并进下一段）
    const t = openBlock(doc, to + 1)
    pressKey(t, 'Backspace')
    typeAt(t, 'Y')
    const typed = t.state.doc.toString()
    expect(typed.startsWith(doc.slice(0, to) + '\n')).toBe(true)
    expect(typed.slice(to)).toMatch(/^\n+Y\n+下一段。\n$/)
  })
})

describe('task-6lsvd 文件里块挨着块、在文件头尾：删掉整块不多留空行、不并段', () => {
  const cases: [string, string, string][] = [
    ['紧挨着上一段（用户截图：书摘最后一段下面直接是数据库块）', '读。\n```base\n```\n', '读。\n'],
    ['块在文件最后、后面空一行', '读。\n\n```base\n```\n\n', '读。\n\n'],
    ['块是全篇最后一样（上面空一行、结尾一个换行）：上一段下面的空行留着，光标在那里打字是新起一段', '读。\n\n```base\n```\n', '读。\n\n'],
    ['块在文件最后、没有结尾换行', '读。\n\n```base\n```', '读。'],
    ['块在文件开头', '```base\n```\n\n下一段。\n', '下一段。\n'],
    ['上下都紧挨着正文', '读。\n```base\n```\n下一段。\n', '读。\n下一段。\n'],
  ]
  it.each(cases)('%s', (_n, doc, want) => {
    const block = '```base\n```'
    const to = doc.indexOf(block) + block.length
    const v = openBlock(doc, Math.min(to + 1, doc.length))
    pressKey(v, 'Backspace')
    expect(selected(v)).toBe(block)
    pressKey(v, 'Backspace')
    expect(v.state.doc.toString()).toBe(want)
    undo(v)
    expect(v.state.doc.toString()).toBe(doc)
  })
})

describe('task-6lsvd 能改字的块（代码块、提示块、AI 讲解、旁支）：下面一行行首退格、上面一行行尾 Delete 走进块里，不删记号、不跳走', () => {
  const TEXT_BLOCKS: [string, string, string, string][] = [
    // 名字、块、退格后光标前面的字、Delete 后光标后面的字
    ['代码块', '```js\nlet a = 1\n```', 'let a = 1', 'let a = 1'],
    ['提示块', '> [!tip] 提示标题\n> 提示正文。', '提示正文。', '提示标题'],
    ['AI 讲解（展开）', '> [!ai]+ 讲解\n> 正文一', '正文一', '讲解'],
    ['旁支块', '> [!ai]+ 讲解\n> 正文一\n>\n> [!side] 问题\n> > 那一句\n> 回答。', '回答。', '讲解'],
  ]
  it.each(TEXT_BLOCKS)('%s', (_n, block, before, after) => {
    const doc = docOf(block)
    const from = doc.indexOf(block)
    const to = from + block.length
    const b = openBlock(doc, to + 1)
    pressKey(b, 'Backspace')
    expect(b.state.doc.toString()).toBe(doc)
    expect(b.state.selection.main.empty).toBe(true)
    expect(doc.slice(0, b.state.selection.main.head).endsWith(before), `退格后光标在 ${b.state.selection.main.head}`).toBe(true)
    for (const k of ['Delete', 'Ctrl-d']) {
      const d = openBlock(doc, from - 1)
      pressKey(d, k)
      expect(d.state.doc.toString(), k).toBe(doc)
      expect(doc.slice(d.state.selection.main.head).startsWith(after), `${k} 后光标在 ${d.state.selection.main.head}`).toBe(true)
    }
  })
})
