/**
 * 白板上「改字」：在排好的样子上直接改这一张卡的字（DESIGN.v3 6.6「双击看全文…里面能直接改字」）。
 * 文档切成的白板（看全文弹层里）、普通白板（type: board，卡片里就地改）都用它。
 * 用和文档同一套所见即所得（live-preview、块部件、藏记号），不露 [!quote]、书链接、weread://、** 这些写法
 * （偏好：只文档白板不露源码、剪藏卡片别露原文）。打开时光标放在最后；⌘Z 撤的是这里打的字。
 */
import { history } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, Prec } from '@codemirror/state'
import { EditorView, type KeyBinding, keymap } from '@codemirror/view'
import { useLayoutEffect, useRef } from 'react'
import { cardEditing } from '../doc-editing'
import { layoutLines } from '../layout-lines'
import { livePreview } from '../live-preview'
import { noteKeys } from '../note-keys'
import { askPending } from '../video/ask-pending'
import { videoDocWidgets } from '../video/doc-widgets'
import { materialFold } from '../video/material-fold'

export function UnitEditor(props: {
  text: string
  notePath: string
  onChange(text: string): void
  onNotice(text: string): void
  /** 输入框的名字（读屏、测试认它） */
  label?: string
  /** 先于编辑器自己的键（普通白板上 Esc、⌘↵ 收起） */
  keys?: KeyBinding[]
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef(props)
  cb.current = props
  useLayoutEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.text,
        selection: EditorSelection.cursor(props.text.length),
        extensions: [
          history(),
          markdown({ base: markdownLanguage }),
          livePreview,
          layoutLines,
          videoDocWidgets,
          askPending,
          materialFold,
          cardEditing({ path: () => cb.current.notePath, notice: (t) => cb.current.onNotice(t) }),
          EditorView.lineWrapping,
          Prec.highest(keymap.of(props.keys ?? [])),
          keymap.of(noteKeys),
          EditorView.contentAttributes.of({ 'aria-label': props.label ?? '这张卡的字' }),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString())),
        ],
      }),
    })
    view.focus()
    view.dispatch({ scrollIntoView: true })
    return () => view.destroy()
    // 只在打开时建一次：之后的字都在编辑器里
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div className={'doc ' + (props.className ?? 'db-full-ed')} ref={host} />
}
