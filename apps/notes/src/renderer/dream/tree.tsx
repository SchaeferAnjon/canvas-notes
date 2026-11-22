/**
 * 目录树里梦游的那几样（task-m552v，demo proto.html 第 5 节），放在这里让 FileTree.tsx 只改几行：
 * - 没收下的可视化：报告里还没收下的 HTML 补进文件列表（FileEntry.dream），挂在它的笔记下面、淡着写「没收下」，点了开报告里那一条；
 * - 正在看的这条梦游改了哪几个文件：树里那几行后面一个强调色小点；
 * - 「在树里看」（以前叫「预览」）时树顶上一条「正在看梦游挪完的样子 · 回到报告」，esc 也回去。
 */
import { Codicon } from '@cn/design'
import { useMemo } from 'react'
import type { FileEntry } from '../../shared/files'
import { pendingViz, touchedBy } from '../../shared/dream-order'
import type { DreamPreview } from './preview'
import { useDreamNav } from './nav'
import './dream-tree.css'

export function useDreamTree(): { ghosts: FileEntry[]; touched: ReadonlySet<string> } {
  const { report, cur } = useDreamNav()
  return useMemo(() => {
    const ghosts = pendingViz(report).map((v): FileEntry => ({ path: v.path, kind: 'html', mtimeMs: 0, vizOf: v.note, dream: v.item }))
    const it = report && !report.closed ? report.items.find((i) => i.id === cur && i.state === 'pending') : undefined
    return { ghosts, touched: new Set(touchedBy(it)) }
  }, [report, cur])
}

/** 「在树里看」时树顶上那一条 */
export function TreeStrip(props: { pv: DreamPreview }) {
  return (
    <div className="ft-dream-strip" data-testid="dream-tree-strip">
      <Codicon name="eye" size={14} />
      <span className="truncate">正在看梦游挪完的样子</span>
      <button onClick={() => props.pv.setOn(false)}>回到报告</button>
    </div>
  )
}

/** 筛「剪藏」时树下面一句规矩（偏好「剪藏只算真剪下来的」） */
export function ClipRule() {
  return (
    <p className="ft-cliprule" data-testid="clip-rule">
      剪藏只列从网页、视频剪下来的；PDF 和梦游做的可视化跟着自己的笔记走，不在这里。
    </p>
  )
}
