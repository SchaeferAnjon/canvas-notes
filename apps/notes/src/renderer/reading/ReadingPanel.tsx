/** 读 PDF 时右栏下格：AI 和笔记二选一（竖条上「AI」「笔记」切换），两个都一直挂着，切换不丢输入框里的字 */
import { useEffect } from 'react'
import './reading.css'
import { ReadingAi } from './ReadingAi'
import { ReadingNotes } from './ReadingNotes'
import * as R from './store'

export type Lower = 'ai' | 'notes'

export function ReadingPanel(props: {
  pdf: string
  which: Lower
  onWhich(w: Lower | null): void
  onOpenNote(path: string): void
  onOpenLink(target: string): void
  onOpenHtml(path: string): void
  onOpenDoubts(folder: string): void
  onOpenWeb(url: string): void
  onNotice(text: string): void
}) {
  const { pdf } = props
  // 笔记在别处改了（中间栏当文档改、梦游、同步）：重新读
  useEffect(() => {
    const note = R.get(pdf).note.path
    const offA = window.cn.onFilesChanged(() => void R.reloadNote(pdf))
    const offB = window.cn.onNoteChanged((p) => p === note && void R.reloadNote(pdf))
    return () => {
      offA()
      offB()
    }
  }, [pdf])
  return (
    <>
      <ReadingAi
        pdf={pdf}
        hidden={props.which !== 'ai'}
        onShowNote={(id) => {
          props.onWhich('notes')
          R.focusSection(pdf, id)
        }}
        onOpenHtml={props.onOpenHtml}
        onNotice={props.onNotice}
        onCollapse={() => props.onWhich(null)}
      />
      <ReadingNotes
        pdf={pdf}
        hidden={props.which !== 'notes'}
        onOpenNote={props.onOpenNote}
        onOpenLink={props.onOpenLink}
        onOpenHtml={props.onOpenHtml}
        onOpenDoubts={props.onOpenDoubts}
        onOpenWeb={props.onOpenWeb}
        onShowConvo={(id) => {
          props.onWhich('ai')
          R.showConvo(pdf, id)
        }}
      />
    </>
  )
}
