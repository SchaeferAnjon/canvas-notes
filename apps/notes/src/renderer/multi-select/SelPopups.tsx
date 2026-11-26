/**
 * 操作条按钮弹出的两样（task-5ryf9）：出卡的说明小卡（原型 .info）、移到别的笔记时挑一篇（顶上能筛，先列开着的）。
 * 白板（board-bar.tsx）和文档（block-select.tsx）共用；不引编辑器、不碰页面以外的东西
 */
import { Codicon } from '@cn/design'
import { type ReactNode, useRef, useState } from 'react'
import { titleOf } from '../../shared/layout'
import { useT } from '../i18n'
import { composing } from '../ime'
import { FloatPop, type PopAnchor } from '../pop-place'
import { useDismiss } from '@cn/design/dismiss'

/** 说明小卡（原型 .info）：头一行图标 + 名字，下面一段说明，右下「知道了」 */
export function InfoCard(props: { at: PopAnchor; title: string; children: ReactNode; onClose(): void }) {
  const t = useT()
  // 点外面（网页里也算）、Esc、窗口失焦收起（公共的 useDismiss）；点「出卡」那颗按钮由按钮自己开关
  useDismiss(true, [], () => props.onClose(), { keep: '.sel-info, .selbar .sb.open' })
  return (
    <FloatPop at={props.at} gap={6} className="sel-info" role="dialog" aria-label={props.title} data-testid="sel-info" onMouseDown={(e) => e.stopPropagation()}>
      <h4>
        <Codicon name="symbol-event" size={14} />
        {props.title}
      </h4>
      <p>{props.children}</p>
      <div className="row">
        <button type="button" className="btn btn-sm" autoFocus onClick={props.onClose}>
          {t('知道了')}
        </button>
      </div>
    </FloatPop>
  )
}

/** 移到别的笔记：顶上一个筛选框，先列开着的、再按最近改的；↑↓ 换、↵ 选、esc 和点外面收起 */
export function NotePick(props: { at: PopAnchor; notes: readonly { path: string; mtimeMs: number; board?: unknown }[]; self: string; openPaths?: ReadonlySet<string>; onPick(path: string): void; onClose(): void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose
  // 点外面（网页里也算）、esc（焦点不在筛选框里也算）、窗口失焦收起
  useDismiss(true, [ref], () => closeRef.current())
  const open = props.openPaths ?? new Set<string>()
  const k = q.trim().toLowerCase()
  const list = props.notes
    .filter((x) => x.path !== props.self && /\.md$/i.test(x.path) && !x.board)
    .filter((x) => !k || titleOf(x.path).toLowerCase().includes(k) || x.path.toLowerCase().includes(k))
    .sort((a, b) => Number(open.has(b.path)) - Number(open.has(a.path)) || b.mtimeMs - a.mtimeMs)
    .slice(0, 12)
  const cur = list[Math.min(idx, list.length - 1)]
  return (
    <FloatPop at={props.at} gap={6} className="sel-menu" role="dialog" aria-label={t('移到别的笔记')} data-testid="sel-notepick">
      <div ref={ref} className="sel-menu-in">
        <div className="sm-head">{t('移到哪篇（拖到标签上也行）')}</div>
        <div className="sm-find">
          <Codicon name="search" size={14} />
          <input
            autoFocus
            aria-label={t('筛选笔记')}
            placeholder={t('筛选笔记')}
            value={q}
            onChange={(e) => (setQ(e.target.value), setIdx(0))}
            onKeyDown={(e) => {
              if (composing(e)) return
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
              } else if (e.key === 'Enter' && cur) {
                e.preventDefault()
                props.onPick(cur.path)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                props.onClose()
              }
            }}
          />
        </div>
        <div className="sm-list" role="listbox" aria-label={t('笔记')}>
          {list.map((x) => (
            <button key={x.path} type="button" role="option" aria-selected={x === cur} className={'sm-item' + (x === cur ? ' on' : '')} onMouseEnter={() => setIdx(list.indexOf(x))} onClick={() => props.onPick(x.path)}>
              <Codicon name="file" size={14} />
              <span className="lb">{titleOf(x.path)}</span>
              <span className="sub">{x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : ''}</span>
            </button>
          ))}
          {!list.length && <div className="sm-note">{t('没有对得上的笔记')}</div>}
        </div>
      </div>
    </FloatPop>
  )
}
