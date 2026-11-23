/**
 * 笔记编辑器的键（⌘S 之外）：CodeMirror 自带的一套和撤销、重做，加上新建笔记标题末尾回车。
 *
 * ⌘/（toggleComment）和 ⇧⌃A（toggleBlockComment）在 md 里是把这一段包成 `<!-- … -->`：屏上露出原文；选区跨过摆在白板上的段落时
 * 把位置行也包进去，白板上的卡换了内容（第 6 轮）。换成 Obsidian 的 `%%…%%` 也一样拆块：这里不认 %%，包进去的照样露出来、
 * 跟着上白板、跨过位置行时位置行进了注释里。所以这两个键在笔记里什么都不做（不改字，也不交给别处）。
 *
 * 每个会改文档的键在 test/hidden-syntax.test.ts 里对着每种藏起来的语法按一遍；这里多了、少了键，那边的分类测试会先报。
 */
import { defaultKeymap, historyKeymap, toggleBlockComment, toggleComment } from '@codemirror/commands'
import type { KeyBinding } from '@codemirror/view'
import { runAppKey } from './keys'
import { editorHost } from './editor-host'
import { docBarKey } from './sel-bar/doc-key'
import { enterAfterTitle } from './title-follow'

/** 按了不做事、也不往外传的键 */
export const noop = () => true

export const noteKeys: KeyBinding[] = [
  // 软件的快捷键（命令表里「软件里」的）比下面 CodeMirror 自带的先轮到：⌘[ ⌘] 是后退前进、⌥⌘\ 收右栏，不是缩进；
  // 文档自己的（加粗、高亮……）在更高一层先认，也比这里先
  // 选着字时选中小条上自己那几颗的键（task-26nz7，⌥ 加字母也行）：比软件的快捷键先轮到
  { any: (v, e) => docBarKey(v, e, () => v.state.facet(editorHost).path() || null) },
  { any: (_v, e) => runAppKey(e) },
  {
    // 新建的笔记：标题末尾回车，光标到标题下空一行的正文处（title-follow.ts）
    key: 'Enter',
    run: (v) => {
      const sel = v.state.selection.main
      const to = sel.empty ? enterAfterTitle(v.state.doc.toString(), sel.head) : null
      if (to === null) return false
      v.dispatch({ selection: { anchor: to }, scrollIntoView: true, userEvent: 'select' })
      return true
    },
  },
  { key: 'Mod-/', run: noop, preventDefault: true },
  { key: 'Alt-A', mac: 'Ctrl-A', run: noop, preventDefault: true },
  ...defaultKeymap.filter((b) => b.run !== toggleComment && b.run !== toggleBlockComment),
  ...historyKeymap,
]
