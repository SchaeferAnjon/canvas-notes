/**
 * 合一里删掉的那几行画成文档样子（梦游对照复审，偏好「只文档白板不露源码」）：
 * @codemirror/merge 的合一把删掉的行画成一段纯文字（「# 标题」「**粗体**」原样露着），文档看法下这里把那一段换成一个只读的小编辑器，
 * 用和正文同一套实时预览画（标题是标题、粗体是粗体、图是图），删掉的字照旧深一层红（原来那几个 .cm-deletedText 的位置）。
 * 历史的「文档」看法和梦游对照共用（TextDiff）。
 */
import { EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'

/** 一段删掉的行（.cm-deletedChunk 里一行一个 .cm-deletedLine）读回原文，和删掉的字在原文里的位置 */
function readChunk(lines: HTMLElement[]): { text: string; marks: [number, number][] } {
  let text = ''
  const marks: [number, number][] = []
  lines.forEach((line, i) => {
    if (i) text += '\n'
    const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = n.nodeValue ?? ''
      if (n.parentElement?.closest('.cm-deletedText')) marks.push([text.length, text.length + s.length])
      text += s
    }
  })
  return { text, marks }
}

const changed = Decoration.mark({ class: 'cm-deletedText' })

/** ext：画文档样子的那几样（只读、实时预览、链接能点），每段删掉的行一个小编辑器 */
export function deletedAsDoc(ext: Extension): Extension {
  return ViewPlugin.fromClass(
    class {
      inner = new Set<EditorView>()
      constructor(readonly view: EditorView) {
        this.swap()
      }
      update() {
        this.swap()
      }
      swap() {
        this.view.requestMeasure({
          key: this,
          read: () => null,
          write: () => {
            let any = false
            for (const chunk of this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-deletedChunk:not([data-doc])')) {
              const lines = [...chunk.querySelectorAll<HTMLElement>(':scope > .cm-deletedLine')]
              chunk.dataset.doc = ''
              if (!lines.length) continue
              const { text, marks } = readChunk(lines)
              const host = document.createElement('div')
              host.className = 'dv-deldoc'
              const v = new EditorView({
                parent: host,
                state: EditorState.create({
                  doc: text,
                  extensions: [ext, EditorView.decorations.of(Decoration.set(marks.filter(([a, b]) => b > a).map(([a, b]) => changed.range(a, b))))],
                }),
              })
              this.inner.add(v)
              for (const l of lines) l.remove()
              chunk.append(host)
              any = true
            }
            // 换了以后这一段的高变了：外面的编辑器重新量一次（行号、折叠条、滚到哪都跟着）
            if (any) requestAnimationFrame(() => this.view.requestMeasure())
          },
        })
      }
      destroy() {
        for (const v of this.inner) v.destroy()
      }
    },
  )
}
