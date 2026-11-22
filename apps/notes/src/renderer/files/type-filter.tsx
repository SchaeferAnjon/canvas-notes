/**
 * 类型筛选（全部 / 文档 / 白板 / 剪藏，文件树多一个「附件」）：不单独占活动栏的入口，是「文件」「最近」顶上同一排；
 * 文件夹首页、中间的「最近」页也是这一排。左栏的那一排「文件」「最近」和摘出来的文件夹共用一个，记在本机。
 * 「附件」只在文件树里有（CN-104：附件挂在用它的那篇笔记下面）；别处选着「附件」时当「全部」。
 */
import { Codicon } from '@cn/design'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NoteFile } from '../../shared/api'
import type { FileEntry } from '../../shared/files'
import { list } from '../../shared/i18n'
import { menuAt } from '../ctx/menu'
import { useT } from '../i18n'

export type TypeFilter = 'all' | 'doc' | 'board' | 'clip' | 'att'
export const TYPE_FILTERS: TypeFilter[] = ['all', 'doc', 'board', 'clip', 'att']

/** 一篇笔记算哪类：白板；剪来的（剪藏/ 里的、收件箱里带来源的：从网页、视频剪下来的）是剪藏；其余是文档 */
export function noteType(n: Pick<NoteFile, 'kind' | 'board' | 'source'>): Exclude<TypeFilter, 'all' | 'att'> {
  if (n.board) return 'board'
  if (n.kind === 'clip' || (n.kind === 'inbox' && n.source)) return 'clip'
  return 'doc'
}

/**
 * 目录树里的一个文件：md 看笔记是哪类，附件/ 里的图和文件是附件。
 * PDF、HTML 自己不算哪一类（偏好「剪藏只算真剪下来的」，task-m552v）：跟着自己的笔记走，目录树里笔记留着时它带着（shared/files.ts 的 shell）
 */
export function fileType(f: FileEntry, notes: ReadonlyMap<string, Exclude<TypeFilter, 'all' | 'att'>>): Exclude<TypeFilter, 'all'> | null {
  if (f.kind === 'img' || f.kind === 'att') return 'att'
  if (f.kind === 'pdf' || f.kind === 'html') return null
  return notes.get(f.path) ?? 'doc'
}

const KEY = 'cn.typeFilter'
let cur: TypeFilter = (() => {
  try {
    const v = localStorage.getItem(KEY)
    return TYPE_FILTERS.some((k) => k === v) ? (v as TypeFilter) : 'all'
  } catch {
    return 'all'
  }
})()
const subs = new Set<() => void>()

/** 左栏共用的那一个 */
export function useSideType(): [TypeFilter, (t: TypeFilter) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => cur,
  )
  return [v, setSideType]
}

function setSideType(t: TypeFilter) {
  cur = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // 记不住筛选不影响使用
  }
  for (const s of subs) s()
}

/**
 * att：带不带「附件」（只有文件树带）；没带时选着「附件」显示成「全部」。
 * 栏窄、一排放不下时（英文「All Doc Board Clippings Attachments」在默认宽度下放不下，task-zojmg 设计稿第 2 节）：
 * 从最后往前把放不下的收进末尾一颗「⋯」，点开是这几样的菜单；选着的那一样一直露着。不缩字、不折行（偏好「窄的时候不许挤成一字一行」）
 */
export function TypeChips(props: { value: TypeFilter; onChange(t: TypeFilter): void; className?: string; att?: boolean }) {
  const t = useT()
  const value = props.value === 'att' && !props.att ? 'all' : props.value
  const label: Record<TypeFilter, string> = { all: t('全部'), doc: t('文档'), board: t('白板'), clip: t('剪藏'), att: t('附件') }
  const keys = TYPE_FILTERS.filter((k) => props.att || k !== 'att')
  const box = useRef<HTMLDivElement>(null)
  /** 收进「⋯」的几样（从最后往前数，跳过选着的） */
  const [fold, setFold] = useState(0)
  const hidden: TypeFilter[] = []
  for (let i = keys.length - 1; i >= 0 && hidden.length < fold; i--) if (keys[i] !== value) hidden.unshift(keys[i]!)
  // 量：最后一颗的右边出了这一排（或它的父元素）的内容区就再收一样（直到放得下）
  useLayoutEffect(() => {
    const el = box.current
    const p = el?.parentElement
    const last = el?.lastElementChild
    if (!el || !p || !last) return
    const inner = (x: Element) => x.getBoundingClientRect().right - parseFloat(getComputedStyle(x).paddingRight || '0')
    let limit = Math.min(inner(el), inner(p))
    // 真正把它截掉的是往上第一个不让内容溢出的（左栏的岛）
    for (let a = p.parentElement; a; a = a.parentElement) {
      if (getComputedStyle(a).overflowX === 'visible') continue
      limit = Math.min(limit, inner(a))
      break
    }
    if (last.getBoundingClientRect().right > limit + 0.5 && fold < keys.length - 1) setFold(fold + 1)
  })
  // 栏宽变了：从 0 重新量；这一排自己变宽了（字体载完、刚画出来）：再量一次，放不下接着收
  const [, remeasure] = useState(0)
  useEffect(() => {
    const el = box.current
    const p = el?.parentElement
    if (!el || !p) return
    let w = p.clientWidth
    const ro = new ResizeObserver(() => {
      if (p.clientWidth !== w) ((w = p.clientWidth), setFold(0))
      else remeasure((n) => n + 1)
    })
    ro.observe(p)
    ro.observe(el)
    void document.fonts?.ready.then(() => remeasure((n) => n + 1))
    return () => ro.disconnect()
  }, [])
  useEffect(() => setFold(0), [t, keys.length])
  return (
    <div ref={box} className={'tchips' + (props.className ? ' ' + props.className : '')} role="tablist" aria-label={t('类型')}>
      {keys
        .filter((k) => !hidden.includes(k))
        .map((k) => (
          <button key={k} role="tab" aria-selected={value === k} className={'chip' + (value === k ? ' on' : '')} onClick={() => props.onChange(k)}>
            {label[k]}
          </button>
        ))}
      {hidden.length > 0 && (
        <button
          className="chip more"
          aria-label={t('还有{n}样', { n: hidden.length })}
          data-tip={list(hidden.map((k) => label[k]))}
          onClick={(e) => void menuAt(e, hidden.map((k) => ({ label: label[k], checked: value === k, run: () => props.onChange(k) })))}
        >
          <Codicon name="ellipsis" size={14} />
        </button>
      )}
    </div>
  )
}
