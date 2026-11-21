/**
 * 第 8 轮（r8-img1、r8-img2）：文档里图片显示成原文的两种写法。
 * - 白板卡片里的图：`![](../../附件/…png)` 下一行紧跟来源「—— [标题](网址)」，和图同一段，以前整段当普通段落不画图；
 * - 剪藏整页里的图：维基百科的图套着链接 `[![](https://…)](https://…/File:…)`，以前不认。
 * 两种都画成图（相对路径以写着它的那篇为基准），文字一个字节不变。
 */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { editorHost } from '../src/renderer/editor-host'
import { hiddenGuard, hiddenRanges } from '../src/renderer/hidden-syntax'
import { layoutLines } from '../src/renderer/layout-lines'
import { mdWidgets } from '../src/renderer/md-widgets'

;(globalThis as { window?: unknown }).window ??= {}

function images(path: string, doc: string): { src: string; line: string }[] {
  const s = EditorState.create({ doc, extensions: [editorHost.of({ path: () => path, notice: () => {} }), layoutLines, mdWidgets, hiddenGuard] })
  const out: { src: string; line: string }[] = []
  for (const set of s.facet(EditorView.decorations)) {
    if (typeof set === 'function') continue
    set.between(0, s.doc.length, (from, to, d) => {
      const w = d.spec.widget as { src?: string; constructor: { name: string } } | undefined
      if (w?.constructor.name === 'ImageWidget') out.push({ src: w.src!, line: s.doc.sliceString(from, to) })
    })
  }
  expect(s.doc.toString()).toBe(doc)
  return out
}

describe('文档里的图', () => {
  it('白板卡片里图片下一行紧跟来源：图画出来，../.. 以白板那篇所在的文件夹为基准', () => {
    const doc =
      '---\ntype: board\n---\n<!-- column id=d8 x=384 y=60 w=300 title=地图与图片 -->\n\n<!-- card id=b2 in=d8 -->\n![](../../附件/剪藏/冰岛旅行/ttravel/250px-Iceland_sat_cleaned.png)\n—— [Iceland sat cleaned - Geography of Iceland - Wikipedia](https://en.wikipedia.org/wiki/Geography_of_Iceland#/media/File:Iceland_sat_cleaned.png)\n\n<!-- card id=b3 in=d8 -->\n![地图](../../附件/剪藏/冰岛旅行/ttravel/500px-Map.svg.png)\n—— [Geography of Iceland](https://en.wikipedia.org/wiki/Geography_of_Iceland)\n'
    const got = images('剪藏/冰岛旅行/ttravel.md', doc)
    expect(got.map((g) => decodeURIComponent(g.src))).toEqual([
      'cn-file://vault/附件/剪藏/冰岛旅行/ttravel/250px-Iceland_sat_cleaned.png',
      'cn-file://vault/附件/剪藏/冰岛旅行/ttravel/500px-Map.svg.png',
    ])
    // 换的只是图那一行，来源行照旧是字
    expect(got.every((g) => g.line.startsWith('![') && !g.line.includes('\n'))).toBe(true)
  })

  it('剪藏整页里套着链接的图 [![](https://…)](https://…)：画成网络图片；单独成段的、紧挨着字的都认', () => {
    const img = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/06/Iceland_Dettifoss_1972-4.jpg/250px-Iceland_Dettifoss_1972-4.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail'
    const doc = `---\ncreated: 2026-11-20 11:59\nsource: https://en.wikipedia.org/wiki/Geography_of_Iceland\n---\n# Geography of Iceland\n\n## Statistics\n\n[![](${img})](https://en.wikipedia.org/wiki/File:Iceland_Dettifoss_1972-4.jpg)\n\n[![瀑布](http://127.0.0.1:9/a.png)](https://e.com/a)\nDettifoss, located in northeast Iceland.\n`
    const got = images('收件箱/Geography of Iceland.md', doc)
    expect(got.map((g) => g.src)).toEqual([img, 'http://127.0.0.1:9/a.png'])
  })

  it('图那一行藏起来（光标进不去），段里别的字照常能改', () => {
    const doc = '# 图\n\n![](附件/a.png)\n—— [来源](https://e.com)\n\n后一段。\n'
    const s = EditorState.create({ doc, extensions: [editorHost.of({ path: () => '写作/图.md', notice: () => {} }), mdWidgets, hiddenGuard] })
    const hs = hiddenRanges(s)
    const at = doc.indexOf('![')
    expect(hs.some((h) => h.from < at && h.to > doc.indexOf(')\n'))).toBe(true)
    // 来源行行首能停、能打字
    const src = doc.indexOf('——')
    const t = s.update({ selection: { anchor: src }, userEvent: 'select' }).state
    expect(t.selection.main.head).toBe(src)
  })

  it('段落里夹着字的图（一行里还有别的字）不当成图块：原文照旧', () => {
    expect(images('写作/图.md', '# 图\n\n看这张 ![](附件/a.png) 图。\n')).toEqual([])
  })
})
