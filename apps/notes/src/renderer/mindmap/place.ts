/**
 * 拍好的导图挂在哪（task-wuv05，DESIGN.v3 6.7）：
 * - 白板看法里拍（工具板「拍导图」点一下 / 拖到哪、空白处右键、⌘K、⇧⌘C、菜单）：这块白板的子白板，落点一张子白板卡；
 * - 文档看法里拍（/ 菜单「拍导图」、⌘K、⇧⌘C、菜单）：这篇旁边，光标处一块 `![[导图]]` 缩略图；
 * - 别处（首页、文件夹首页、没开着文档）：进收件箱。
 * 挂上去的：主线放好照片和导图（不提交），这里把父白板 / 笔记存好，三样一次提交，底栏「撤回」一次全回去。
 */
import { titleOf } from '../../shared/layout'
import type { Placed } from '../../shared/mindmap'
import { app } from '../ctx/actions'
import { NoteDoc } from '../note-doc'
import { boardCapture, openCapture } from './capture-store'

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 父白板 / 笔记里的链接插好以后：存好、三样一次提交，底栏一句带「撤回」 */
export async function settlePlaced(into: string, r: Placed, said: string): Promise<void> {
  await NoteDoc.saveAll()
  const hash = await window.cn.boardCommit([into, r.path, r.photo].filter(Boolean), `拍导图：${titleOf(r.path).replace('∶', ':')} 放进《${titleOf(into)}》`)
  app().noticeUndo(said, () => {
    if (!hash) return
    void NoteDoc.saveAll()
      .then(() => window.cn.boardRevert(hash))
      .then(
        () => app().notice(`撤回了：导图和照片拿掉了，《${titleOf(into)}》回到拍之前`),
        (e) => app().notice(errText(e)),
      )
  })
}

/** 文档看法里拍：做好后在光标处（这次打开后没点进去过就接在末尾）插一块缩略图 */
export function captureIntoDoc(doc: NoteDoc) {
  openCapture({
    into: { path: doc.path, as: 'note' },
    async onPlaced(r) {
      // 不另补空段落（focus: false）：文件里只多这一行和前后的空行；焦点再交回文档
      doc.insertAtCursor(`![[${titleOf(r.path)}]]`, { end: !doc.cursorPlaced, focus: false })
      doc.view.focus()
      await settlePlaced(doc.path, r, `导图插进了《${titleOf(doc.path)}》：文件在这篇旁边`)
    },
  })
}

/** / 菜单「拍导图」：这个编辑器是哪一篇；只读的不插，返回 false */
export function captureIntoView(view: NoteDoc['view']): boolean {
  const doc = [...NoteDoc.open].find((d) => d.view === view)
  if (!doc || doc.readOnly) return false
  captureIntoDoc(doc)
  return true
}

/** ⌘K、⇧⌘C、菜单「拍一张导图」：前面是白板就挂在白板上，是文档就插在光标处，别的进收件箱 */
export function captureHere(o: { path: string | null; mode: 'doc' | 'board'; doc: NoteDoc | null }) {
  const b = o.path && o.mode === 'board' ? boardCapture(o.path) : null
  if (b) return b.capture()
  if (o.path && o.mode === 'doc' && o.doc && o.doc.path === o.path && !o.doc.readOnly) return captureIntoDoc(o.doc)
  openCapture()
}
