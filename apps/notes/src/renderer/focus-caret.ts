/**
 * 焦点给回编辑器时光标留在原处（不是点进来的：⌘1 / ⌘2 换格、弹层关掉还焦点、程序 focus()）。
 * 浏览器给可编辑区焦点时先把选区放到最前面；CodeMirror 只有在 200 毫秒内读到这次选区变化才认出来、改回编辑器自己的光标，
 * Mac 一忙（同步刚改完这篇、界面正重画）读晚了，就当成用户把光标放到了文首（微信读书划完线回来接着打，字打到了最前面）。
 * 这里在 focus 那一下就把编辑器记着的光标写回页面上，不等那 200 毫秒。点进来的（按下鼠标、手指）不管：光标照点的地方放
 */
import { ViewPlugin, type EditorView } from '@codemirror/view'

export const focusKeepsCaret = ViewPlugin.fromClass(
  class {
    /** 正在按下鼠标、手指（按下那一下里浏览器给的焦点就是点进来的，同一个任务里） */
    private pointing = false
    private readonly down = () => {
      this.pointing = true
      setTimeout(() => (this.pointing = false), 0)
    }
    private readonly focus = () => {
      const v = this.view
      if (this.pointing || v.root.activeElement !== v.contentDOM) return
      // 直接写页面上的选区：CodeMirror 这时还记着旧的选区（没读到浏览器刚放的），dispatch 同一个光标它会当成已经在那、不写
      const { anchor, head } = v.state.selection.main
      const a = v.domAtPos(anchor)
      const h = v.domAtPos(head)
      document.getSelection()?.setBaseAndExtent(a.node, a.offset, h.node, h.offset)
    }
    constructor(private readonly view: EditorView) {
      view.contentDOM.addEventListener('pointerdown', this.down, true)
      view.contentDOM.addEventListener('focus', this.focus)
    }
    destroy() {
      this.view.contentDOM.removeEventListener('pointerdown', this.down, true)
      this.view.contentDOM.removeEventListener('focus', this.focus)
    }
  },
)
