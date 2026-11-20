import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { calloutKind, parseCallout } from '../src/renderer/callout'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { enterInFoldTitle, foldBlock, foldBlocks, toggleFold } from '../src/renderer/fold-block'
import { Markdown } from '../src/renderer/md-render'

describe('提示块（CN-59）', () => {
  it('认 question / success / note / info / warning / danger / quote / ai，不认识的按 note 画、标题照写', () => {
    expect(parseCallout('> [!question] 我的疑惑')).toMatchObject({ kind: 'question', icon: 'question', tone: 'yellow', title: '我的疑惑', prefix: '> [!question] '.length })
    expect(parseCallout('> [!success] 讲通的讲法')).toMatchObject({ kind: 'success', icon: 'pass', tone: 'green' })
    expect(calloutKind('NOTE')).toMatchObject({ kind: 'note', icon: 'info', tone: 't2' })
    expect(calloutKind('info').icon).toBe('info')
    expect(calloutKind('warning')).toMatchObject({ icon: 'warning', tone: 'yellow' })
    expect(calloutKind('error')).toMatchObject({ kind: 'danger', icon: 'error', tone: 'red' })
    expect(calloutKind('quote').icon).toBe('quote')
    expect(calloutKind('奇怪')).toMatchObject({ kind: 'note', label: '奇怪' })
    expect(parseCallout('> 普通引用')).toBeNull()
  })

  it('[!ai]：画写它的那一家的标志（标题里写着），没写哪家画对话图标、不画闪光；能收起；[!x]- 默认收着', () => {
    const ai = parseCallout('> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 3 页')!
    expect(ai).toMatchObject({ kind: 'ai', engine: 'claude', tone: 'acc', foldable: true, folded: false, title: 'AI 讲解 · Claude Code · Opus 5.5 · 看了第 3 页' })
    expect(parseCallout('> [!ai] AI 讲解 · Codex · 看了这一屏')).toMatchObject({ engine: 'codex' })
    expect(parseCallout('> [!ai] AI 讲解')).toMatchObject({ icon: 'comment-discussion', engine: null })
    expect(parseCallout('> [!note] 注')).toMatchObject({ engine: null })
    expect(parseCallout('> [!note]- 收着的')).toMatchObject({ foldable: true, folded: true })
    expect(parseCallout('> [!note] 不能收')).toMatchObject({ foldable: false })
  })
})

describe('能收起的块', () => {
  const doc = [
    '开头',
    '',
    '<details><summary>没讲通 · 第 1 版：用 CPU 和 GPU 跑矩阵乘法</summary>',
    '',
    '旧讲法：CPU 是几个大厨。',
    '',
    '</details>',
    '',
    '> [!ai] AI 讲解 · Claude Code · Opus 5.5',
    '> 第一段讲解。',
    '> 第二段。',
    '',
    '<details><summary>不配对</summary>',
    '',
    '最后',
  ].join('\n')

  it('配对的 <details> 一块，默认收着；不配对的不算；[!ai] 一块到空行为止', () => {
    const bs = foldBlocks(doc)
    expect(bs).toHaveLength(2)
    expect(bs[0]).toMatchObject({ kind: 'details', title: '没讲通 · 第 1 版：用 CPU 和 GPU 跑矩阵乘法', folded: true })
    expect(doc.slice(bs[0]!.from, bs[0]!.to)).toMatch(/^<details>[\s\S]*<\/details>$/)
    expect(doc.slice(bs[0]!.closeFrom, bs[0]!.to)).toBe('</details>')
    expect(bs[1]).toMatchObject({ kind: 'callout', folded: false })
    expect(doc.slice(bs[1]!.from, bs[1]!.to)).toBe('> [!ai] AI 讲解 · Claude Code · Opus 5.5\n> 第一段讲解。\n> 第二段。')
  })

  it('代码块里的 <details> 不算', () => {
    expect(foldBlocks('```\n<details><summary>x</summary>\n</details>\n```')).toEqual([])
  })

  it('<details open> 默认展开', () => {
    expect(foldBlocks('<details open><summary>x</summary>\ny\n</details>')[0]!.folded).toBe(false)
  })

  it('<details> 和 <summary> 分两行写（GitHub、Obsidian 常见）：也是一块，标题行占两行', () => {
    const doc = '开头\n\n<details>\n<summary>别处的写法</summary>\n\n里面\n\n</details>\n'
    const [b] = foldBlocks(doc)
    expect(b).toMatchObject({ kind: 'details', title: '别处的写法', folded: true })
    expect(doc.slice(b!.from, b!.headTo)).toBe('<details>\n<summary>别处的写法</summary>')
    expect(doc.slice(b!.closeFrom, b!.to)).toBe('</details>')
    expect(foldBlocks('<details open>\n<summary>x</summary>\ny\n</details>')[0]!.folded).toBe(false)
    // 只有 <details> 一行、下一行不是 <summary>：不算
    expect(foldBlocks('<details>\n里面\n</details>')).toEqual([])
  })
})

describe('AI 回答、白板卡片里的 md', () => {
  it('提示块画成带图标的块，不露 [!question]；折叠块是 <details>，不露 <summary> 原文', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: '> [!question] 我的疑惑\n> 为什么？\n\n<details><summary>旧讲法</summary>\n\n里面\n\n</details>' }))
    expect(html).not.toContain('[!question]')
    expect(html).toContain('class="md-callout tone-yellow"')
    expect(html).toMatch(/<summary><svg class="ci".*<\/svg><span>旧讲法<\/span><\/summary>/)
    expect(html).not.toContain('&lt;summary')
    expect(html).toContain('里面')
  })

  it('两行写的折叠块也画成 <details>，不露 HTML 原文', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: '<details>\n<summary>别处的写法</summary>\n\n里面\n\n</details>' }))
    expect(html).toMatch(/<summary><svg class="ci".*<\/svg><span>别处的写法<\/span><\/summary>/)
    expect(html).not.toContain('&lt;')
    expect(html).toContain('里面')
  })
})

describe('<details> 和 <summary> 中间空行、<summary> 写成好几行（第 4 轮）', () => {
  const forms = ['<details>\n\n<summary>旧的预算</summary>\n\n正文。\n\n</details>\n', '<details>\n<summary>\n旧的预算\n</summary>\n\n正文。\n\n</details>\n']
  it('认成折叠块，标题是字；收着、展开都看不到 HTML 标签', () => {
    for (const doc of forms) {
      const [b] = foldBlocks(doc)
      expect(b).toMatchObject({ kind: 'details', title: '旧的预算', from: 0, to: doc.trimEnd().length })
      expect(doc.slice(b!.titleFrom, b!.titleTo)).toBe('旧的预算')
      let state = EditorState.create({ doc, extensions: [foldBlock] })
      const shown = () => {
        const hidden: [number, number][] = []
        for (const ext of state.facet(EditorView.decorations)) {
          const set = typeof ext === 'function' ? null : ext
          if (!set) continue
          // 替换（藏起来）的范围；标题字上的 mark（有 class）不算
          set.between(0, state.doc.length, (from, to, d) => void (!(d.spec as { class?: string }).class && ((d.spec as { widget?: unknown }).widget !== undefined || from < to) ? hidden.push([from, to]) : 0))
        }
        let out = ''
        for (let i = 0; i < state.doc.length; i++) if (!hidden.some(([a, z]) => i >= a && i < z)) out += state.doc.sliceString(i, i + 1)
        return out
      }
      expect(shown()).not.toMatch(/<\/?details|summary/)
      state = state.update({ effects: toggleFold.of(0) }).state
      expect(shown()).not.toMatch(/<\/?details|summary/)
      expect(shown()).toContain('旧的预算')
      expect(shown()).toContain('正文。')
    }
  })
})

describe('套着的折叠块', () => {
  const nested = '<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n最里面。\n\n</details>\n\n</details>\n'
  it('外层两行写法套内层：外层到最后那个 </details> 是一块，内层也认出来', () => {
    const bs = foldBlocks(nested)
    expect(bs.map((b) => b.title)).toEqual(['外层', '内层'])
    expect(nested.slice(bs[0]!.from, bs[0]!.to)).toBe(nested.trimEnd())
    expect(nested.slice(bs[1]!.from, bs[1]!.to)).toBe('<details>\n<summary>内层</summary>\n\n最里面。\n\n</details>')
  })
  it('文档里收着时只画一行「外层」，展开外层后内层也收成一行，看不到 HTML 标签', () => {
    let state = EditorState.create({ doc: nested, extensions: [foldBlock] })
    const shown = () => {
      // 被替换掉的范围（收起的块、藏起来的标签）以外的字
      const hidden: [number, number][] = []
      for (const ext of state.facet(EditorView.decorations)) {
        const set = typeof ext === 'function' ? null : ext
        if (!set) continue
        set.between(0, state.doc.length, (from, to, d) => void ((d.spec as { widget?: unknown }).widget !== undefined || from < to ? hidden.push([from, to]) : 0))
      }
      let out = ''
      for (let i = 0; i < state.doc.length; i++) if (!hidden.some(([a, b]) => i >= a && i < b)) out += state.doc.sliceString(i, i + 1)
      return out
    }
    expect(shown()).not.toMatch(/<\/?details|summary/)
    state = state.update({ effects: toggleFold.of(0) }).state
    expect(shown()).not.toMatch(/<\/?details|summary/)
  })
})

describe('展开的折叠块标题末尾按回车', () => {
  /** 展开着的折叠块，光标放在标题末尾（at 给了就放在那儿） */
  function opened(doc: string, at?: (b: ReturnType<typeof foldBlocks>[number]) => number) {
    let state = EditorState.create({ doc, extensions: [foldBlock] })
    const view = {
      get state() {
        return state
      },
      dispatch(spec: TransactionSpec) {
        state = state.update(spec).state
      },
    } as unknown as EditorView & { state: EditorState }
    const b = foldBlocks(doc)[0]!
    view.dispatch({ effects: toggleFold.of(b.from), selection: { anchor: at ? at(b) : b.titleTo } })
    return view
  }
  const typed = (v: EditorView & { state: EditorState }, t: string) => {
    v.dispatch({ changes: { from: v.state.selection.main.head, insert: t } })
    return v.state.doc.toString()
  }

  it('块里有字：在正文最前面新起一段，接着打的字不粘到第一段后面（两种写法都一样）', () => {
    const two = '<details>\n<summary>折叠甲</summary>\n\n第一段里面。\n\n</details>\n'
    const v = opened(two)
    expect(enterInFoldTitle(v)).toBe(true)
    expect(typed(v, '新起一行')).toBe('<details>\n<summary>折叠甲</summary>\n\n新起一行\n\n第一段里面。\n\n</details>\n')
    const one = '<details><summary>折叠庚</summary>\n第一段里面。\n</details>\n'
    const w = opened(one)
    expect(enterInFoldTitle(w)).toBe(true)
    expect(typed(w, '新起一行')).toBe('<details><summary>折叠庚</summary>\n\n新起一行\n\n第一段里面。\n</details>\n')
  })

  it('光标在藏着的 </summary> 后面（标题末尾再按 → 落在这儿）：照样新起一段，和标题、第一段之间都空一行（第 4 轮）', () => {
    const two = '<details>\n<summary>标题甲</summary>\n\n第一段里面。\n\n</details>\n'
    const v = opened(two, (b) => b.headTo)
    expect(enterInFoldTitle(v)).toBe(true)
    expect(typed(v, '**加粗**新起')).toBe('<details>\n<summary>标题甲</summary>\n\n**加粗**新起\n\n第一段里面。\n\n</details>\n')
    const one = '<details><summary>折叠庚</summary>\n第一段里面。\n</details>\n'
    const w = opened(one, (b) => b.headTo)
    expect(enterInFoldTitle(w)).toBe(true)
    expect(typed(w, '新起')).toBe('<details><summary>折叠庚</summary>\n\n新起\n\n第一段里面。\n</details>\n')
  })

  it('块里只有空行（斜杠刚插出来的）：进空行接着写', () => {
    const v = opened('<details><summary>标题</summary>\n\n\n\n</details>\n')
    expect(enterInFoldTitle(v)).toBe(true)
    expect(typed(v, '旧的讲法')).toBe('<details><summary>标题</summary>\n\n旧的讲法\n\n</details>\n')
  })
})
