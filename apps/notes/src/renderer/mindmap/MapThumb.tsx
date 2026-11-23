/**
 * 导图缩略（task-wuv05，designer 稿 /private/tmp/canvas-notes-visual/15-思维导图/proto.html thumbSvg）：
 * 白板里的导图卡（子白板卡）、笔记里的 `![[导图]]` 块都画它，只看不点，不露列表原文和 `<!-- box=… -->`。
 * 排法同导图白板（往右展开）：中心、第一层是小卡片（`--card` 底、1.5 `--line2` 边、圆角 9），往下一层只画下划线，
 * 连线 2 `--wire`；原照片缩小摆在中心左边（150 宽、左边空 40）。整张按比例缩进框里、居中。那一篇改了跟着变。
 */
import { Codicon } from '@cn/design'
import { parseMindmap } from '@cn/format'
import { useEffect, useMemo, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { t } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { layoutMindmap, wirePath, type Level, type Measure } from '../../shared/mindmap-layout'
import { imageSrc } from '../md-widgets'
import './map-thumb.css'

/** 字宽粗估（同首页缩略 mindmapThumb）：中文一个字一个字号，别的半个 */
const SIZE: Record<Level, number> = { c: 16, l1: 14, l2: 13 }
// 缩略图只粗估：一行多宽按字数估，到最宽（maxW）就折行、按行数算高，和大图一样换行（task-wuv05 节点换行以后 Measure 要宽和高）
const measure: Measure = (t, l, maxW) => {
  const one = [...t].reduce((w, ch) => w + (/[⺀-￿]/.test(ch) ? 1 : 0.55), 0) * SIZE[l]
  return { w: Math.min(one, maxW), h: Math.max(1, Math.ceil(one / maxW)) * SIZE[l] * 1.4 }
}
const PHOTO_W = 150
const PHOTO_GAP = 40

/** 读那一篇的字；改了跟着变 */
export function useNoteText(path: string): string | null {
  const [t, setT] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.readNote(path).then(
      (n) => live && setT(n.text),
      () => live && setT(''),
    )
    const off = window.cn.onNoteChanged((p, text) => p === path && setT(text))
    return () => ((live = false), off())
  }, [path])
  return t
}

export function MapThumb(props: { path: string }) {
  const text = useNoteText(props.path)
  const [aspect, setAspect] = useState(0.69)
  const shape = useMemo(() => {
    if (text === null) return null
    const doc = parseMindmap(text)
    const m = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(doc.before)
    const L = layoutMindmap(doc.roots, measure, null)
    return { L, photo: m ? imageSrc(props.path, m[1]!) : null }
  }, [text, props.path])
  useEffect(() => {
    if (!shape?.photo) return
    const img = new Image()
    img.onload = () => img.naturalWidth && setAspect(img.naturalHeight / img.naturalWidth)
    img.src = shape.photo
  }, [shape?.photo])
  if (!shape || !shape.L.nodes.length) return <svg className="mm-thumb" aria-hidden />
  const { L, photo } = shape
  let minX = Math.min(...L.nodes.map((n) => n.x))
  // 看得见的上沿：往下一层只画下划线（节点框底下那 2.4），中心和第一层是整个小卡片
  const minY = Math.min(...L.nodes.map((n) => (n.level === 'l2' ? n.y + n.h - 2 : n.y)))
  const maxX = Math.max(...L.nodes.map((n) => n.x + n.w))
  const maxY = Math.max(...L.nodes.map((n) => n.y + n.h))
  const root = L.nodes.find((n) => n.depth === 0)!
  const ph = PHOTO_W * aspect
  if (photo) minX -= PHOTO_W + PHOTO_GAP
  const top = Math.min(minY, photo ? root.y + root.h / 2 - ph / 2 : minY)
  const bottom = Math.max(maxY, photo ? root.y + root.h / 2 + ph / 2 : maxY)
  const pad = 14
  return (
    <svg className="mm-thumb" viewBox={`${minX - pad} ${top - pad} ${maxX - minX + pad * 2} ${bottom - top + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {photo && <image href={photo} x={minX} y={root.y + root.h / 2 - ph / 2} width={PHOTO_W} height={ph} preserveAspectRatio="none" opacity={0.9} />}
      {L.wires.map((w) => (
        <path key={w.from + '>' + w.to} d={wirePath(L.byKey[w.from]!, L.byKey[w.to]!)} fill="none" stroke="var(--wire)" strokeWidth={2} />
      ))}
      {L.nodes.map((n) =>
        n.level === 'l2' ? (
          <rect key={n.key} x={n.x} y={n.y + n.h - 2} width={n.w} height={2.4} fill="var(--wire)" />
        ) : (
          <rect key={n.key} x={n.x} y={n.y} width={n.w} height={n.h} rx={9} fill="var(--card)" stroke="var(--line2)" strokeWidth={1.5} />
        ),
      )}
    </svg>
  )
}

/** 「导图 · 16个主题」 */
export const mapCount = (note: NoteFile) => t('导图 · {n}个主题', { n: note.board?.nodes ?? 0 })

/** 白板里的导图卡（子白板卡的导图版）：上面一块缩略，下面图标 + 名字 + 「导图 · N个主题」；双击打开（打开交给白板） */
export function MapCard(props: { note: NoteFile }) {
  return (
    // 不翻：data-part 给 e2e 和样式认
    <div className="mm-card" data-part="白板里的导图卡">
      <div className="mm-card-th">
        <MapThumb path={props.note.path} />
      </div>
      <div className="mm-card-row">
        <Codicon name="type-hierarchy-sub" size={14} />
        <b className="truncate">{titleOf(props.note.path)}</b>
        <span>{mapCount(props.note)}</span>
      </div>
    </div>
  )
}
