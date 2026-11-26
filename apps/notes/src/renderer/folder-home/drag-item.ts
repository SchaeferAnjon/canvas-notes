/**
 * 文件夹首页卡里的条目拖走（task-r00en，用户看课程首页「课件进度」里的 PDF 问「这个pdf能不能拖动到其他的目录?」）：
 * 课件、笔记和导图、可视化这些列表里的一份按住能拖，松在左栏文件树的文件夹上、或中间标签条上别的文件夹首页标签上 = 移过去
 * （app().moveItem：PDF 连挂着的笔记、可视化一起走，链接改好，一次提交，底栏能撤回）。
 * 文件树那边和拖树里的笔记同一套：经过的文件夹亮、停 0.6 秒自己展开。
 * 文件树里 PDF / HTML 那一行也走这一套（2026-11-25 收件箱「PDF 没有办法直接拖到新建的文件夹里面」：以前只有 md 那一行能拖）。
 */

/** 文件树里拖着的一篇笔记（库里的路径）；松在文件树的文件夹上、文件夹首页上都是挪进去 */
export const DRAG_NOTE = 'application/x-cn-note'

/** 拖着的是首页卡里的一份（库里的路径） */
export const DRAG_ITEM = 'application/x-cn-item'

/** 正在拖的那一份：dragover 时读不到 dataTransfer 里的值，问这里（已经在那个文件夹里的不亮） */
let dragging: string | null = null
export const draggedItem = () => dragging

/** 拖起一份：卡里的条目、文件树里 PDF / HTML 那一行（连挂着的笔记一起挪，松在文件夹上走 app().moveItem） */
export function startItemDrag(e: React.DragEvent, path: string) {
  dragging = path
  e.dataTransfer.setData(DRAG_ITEM, path)
  e.dataTransfer.effectAllowed = 'move'
}
export const endItemDrag = () => {
  dragging = null
}

/** 放到卡里一份的按钮（行、封面、卡片、表格行）上：按住能拖；拖着时它自己变淡 */
export function itemDrag(path: string) {
  return {
    draggable: true,
    onDragStart(e: React.DragEvent<HTMLElement>) {
      startItemDrag(e, path)
      // 拖起来的影子先照着画好，再给原处加上变淡的样子
      const el = e.currentTarget
      requestAnimationFrame(() => el.classList.add('fw-dragging'))
    },
    onDragEnd(e: React.DragEvent<HTMLElement>) {
      endItemDrag()
      e.currentTarget.classList.remove('fw-dragging')
    },
  }
}
