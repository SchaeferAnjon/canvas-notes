import { app } from '../ctx/actions'
import { NoteDoc } from '../note-doc'

/**
 * 打开一篇并跳到某一段（目录树笔记行上的「疑惑 N」→ 我的疑惑里这一讲那段）：
 * 文档标签刚开时编辑器还没建好，等它出来再把光标放到那个标题、滚到它
 */
export async function revealHeading(path: string, heading: string) {
  app().openFile(path)
  for (let i = 0; i < 60; i++) {
    const doc = [...NoteDoc.open].find((d) => d.path === path)
    if (doc) {
      const state = doc.view.state
      for (let n = 1; n <= state.doc.lines; n++) {
        const line = state.doc.line(n)
        if (/^#{1,6}\s/.test(line.text) && line.text.replace(/^#+\s+/, '').trim() === heading) {
          doc.view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
          return
        }
      }
      return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}
