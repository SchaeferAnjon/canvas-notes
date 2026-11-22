/**
 * 宽了在自己框里横着滚的一块（表格；task-83vl3，用户：「表格这里能不能左右滑动?」）：白板卡、AI 回答、读 PDF 讲解卡、
 * 文档切成的白板里的表格共用。还能往哪边滚，那一边 32 渐隐，滚到头去掉（tex.ts fadeEdges，和公式、文档里的表格同一套）；
 * 触控板横着拨、Shift+滚轮只滚它：横向滚到头也不传给外面（overscroll-behavior-x: contain，白板不跟着平移），竖着拨照常给外面。
 * 放得下的表不是滚动框，什么都不拦。文档编辑器里的表格是 CodeMirror 的块部件（table-edit.ts），同一个类名 scroll-x。
 */
import { type ReactNode, useEffect, useRef } from 'react'
import { fadeEdges } from './tex'

export function ScrollX(p: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => (ref.current ? fadeEdges(ref.current) : undefined), [])
  return (
    <div ref={ref} className={`scroll-x ${p.className}`}>
      {p.children}
    </div>
  )
}
