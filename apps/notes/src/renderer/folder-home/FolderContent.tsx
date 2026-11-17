/**
 * 文件夹首页下半截「里面有什么」（2026-11-17 左栏重组，小样 1 的 6–10）：每个文件夹点开都有。
 * 一排类型筛选 + 篇数 + 排序（按钮带菜单）；子文件夹是卡片（名字、篇数、修改时间、里面前几篇），
 * 白板是缩略图（卡片的真实摆法），PDF 是封面（课件封面缓存那一份）和读到第几页，笔记每篇一行预览，多了「再显示 N 篇」。
 * 只列这一层；量大时每块先列一些（别把上万条全铺开）。
 */
import { when } from '../../shared/when'
import { Codicon } from '@cn/design'
import { useMemo, useState } from 'react'
import type { NoteFile, ThumbRect } from '../../shared/api'
import { buildTree, fileName, subtree, TREE_SORTS, type TreeNode, type TreeSort } from '../../shared/files'
import { folderMenu, onFileMenu } from '../ctx/file-menu'
import { menuAt, showMenu } from '../ctx/menu'
import { FolderGlyph } from '../files/look'
import { useVaultFiles } from '../files/store'
import { fileType, noteType, TypeChips, type TypeFilter } from '../files/type-filter'
import { fileIcon } from '../Palette'
import { useCover } from './slide-covers'
import './folder-content.css'

/** 每块先列几个 */
const FIRST = { folders: 6, boards: 4, pdfs: 4, notes: 4 }
const MORE = 50

const stem = (name: string) => name.replace(/\.(md|pdf|html?)$/i, '')

export function FolderContent(props: { folder: string; notes: NoteFile[]; onOpen(path: string): void; onOpenFolder(folder: string): void }) {
  const { files } = useVaultFiles()
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<TreeSort>('mtime-desc')
  const [more, setMore] = useState<Record<string, number>>({})
  const byPath = useMemo(() => new Map(props.notes.map((n) => [n.path, n])), [props.notes])
  const noteTypes = useMemo(() => new Map(props.notes.flatMap((n) => (noteType(n) === 'doc' ? [] : [[n.path, noteType(n)] as const]))), [props.notes])
  const { here, total } = useMemo(() => {
    const keep = type === 'all' ? undefined : (f: Parameters<typeof fileType>[0]) => fileType(f, noteTypes) === type
    const all = buildTree(files, { sort, keep })
    const here = subtree(all, props.folder)
    return { here, total: here.reduce((s, n) => s + n.count, 0) }
  }, [files, sort, type, noteTypes, props.folder])
  const now = Date.now()
  const dirs = here.filter((n) => n.kind === 'dir')
  const boards = here.filter((n) => n.kind === 'md' && byPath.get(n.path)?.board)
  const pdfs = here.filter((n) => n.kind === 'pdf')
  const docs = here.filter((n) => (n.kind === 'md' && !byPath.get(n.path)?.board) || n.kind === 'html')
  const limit = (k: keyof typeof FIRST) => more[k] ?? FIRST[k]
  const moreBtn = (k: keyof typeof FIRST, list: unknown[], unit: string) =>
    list.length > limit(k) && (
      <button className="fc-more" onClick={() => setMore((m) => ({ ...m, [k]: limit(k) + MORE }))}>
        <Codicon name="chevron-down" size={12} />
        <span className="num">{`再显示${Math.min(MORE, list.length - limit(k))}${unit}`}</span>
        {list.length - limit(k) > MORE && <span className="c num">{`还有${list.length - limit(k)}${unit}`}</span>}
      </button>
    )
  const sortNow = TREE_SORTS.find((s) => s.id === sort)!
  const empty = !here.length

  return (
    <div className="fcontent" data-testid="folder-content">
      <div className="fc-bar">
        <TypeChips value={type} onChange={setType} />
        <span className="sp" />
        <span className="fc-n num">{`${total}篇`}</span>
        <button
          className="fc-sort"
          aria-label="排序"
          data-tip={`${sortNow.label} · ${sortNow.hint}`}
          data-side="below"
          onClick={() => void showMenu(TREE_SORTS.map((s) => ({ label: `${s.label}（${s.hint}）`, checked: s.id === sort, run: () => setSort(s.id) })))}
        >
          <Codicon name="sort-precedence" size={14} />
          {sortNow.label}
          <Codicon name="chevron-down" size={12} />
        </button>
      </div>
      {empty && <p className="fc-none">{type === 'all' ? '这个文件夹还是空的。右键左栏里的它，或者按 ⌘N 新建一篇。' : '这里没有这一类的文件'}</p>}

      {dirs.length > 0 && (
        <section className="fc-sec" aria-label="文件夹">
          <div className="fc-g">
            <span className="num">{`文件夹${dirs.length}`}</span>
          </div>
          <div className="fc-fgrid">
            {dirs.slice(0, limit('folders')).map((d) => (
              <button key={d.path} className="fc-fcard" onClick={() => props.onOpenFolder(d.path)} onContextMenu={(e) => void menuAt(e, folderMenu(d.path))}>
                <FolderGlyph folder={d.path} size={18} />
                <span className="fx">
                  <span className="fn">
                    <span className="truncate">{d.name}</span>
                    <span className="fm num">
                      {`${d.count}篇${d.time ? ` · ${when(d.time, { now })}` : ''}`}
                    </span>
                  </span>
                  <span className="fp">{firstNames(d)}</span>
                </span>
              </button>
            ))}
          </div>
          {moreBtn('folders', dirs, '个')}
        </section>
      )}

      {(boards.length > 0 || pdfs.length > 0) && (
        <div className={'fc-vis' + (boards.length && pdfs.length ? ' two' : '')}>
          {boards.length > 0 && (
            <section className="fc-sec" aria-label="白板">
              <div className="fc-g">
                <span className="num">{`白板${boards.length}`}</span>
              </div>
              <div className="fc-tgrid">
                {boards.slice(0, limit('boards')).map((b) => {
                  const n = byPath.get(b.path)!
                  return (
                    <button key={b.path} className="fc-tcard" onClick={() => props.onOpen(b.path)} onContextMenu={(e) => onFileMenu(e, b.path)}>
                      <BoardThumb rects={n.board!.thumb} color={n.board!.color} />
                      <span className="tn">
                        <span className="truncate">{stem(b.name)}</span>
                        <span className="fm num">
                          {n.board!.nodes !== undefined ? `${n.board!.nodes}个节点` : `${n.board!.cards}张卡片`} · {when(n.mtimeMs, { now })}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
              {moreBtn('boards', boards, '块')}
            </section>
          )}
          {pdfs.length > 0 && (
            <section className="fc-sec" aria-label="PDF">
              <div className="fc-g">
                <span className="num">{`PDF ${pdfs.length}`}</span>
              </div>
              <div className="fc-tgrid">
                {pdfs.slice(0, limit('pdfs')).map((p) => (
                  <PdfCard key={p.path} node={p} onOpen={() => props.onOpen(p.path)} />
                ))}
              </div>
              {moreBtn('pdfs', pdfs, '份')}
            </section>
          )}
        </div>
      )}

      {docs.length > 0 && (
        <section className="fc-sec" aria-label="笔记">
          <div className="fc-g">
            <span className="num">{`笔记${docs.length}`}</span>
          </div>
          {docs.slice(0, limit('notes')).map((d) => {
            const n = byPath.get(d.path)
            return (
              <button key={d.path} className="fc-row" onClick={() => props.onOpen(d.path)} onContextMenu={(e) => onFileMenu(e, d.path)} title={d.path}>
                <span className="ic">
                  <Codicon name={n && noteType(n) === 'clip' ? 'quote' : fileIcon(d.path)} />
                </span>
                <span className="ti">{stem(d.name)}</span>
                <span className="rt num">{when(d.entry?.mtimeMs ?? 0, { now })}</span>
                <span className="pv">{n?.excerpt || (d.kind === 'html' ? '做好的可视化' : '空的')}</span>
              </button>
            )
          })}
          {moreBtn('notes', docs, '篇')}
        </section>
      )}
    </div>
  )
}

/** 子文件夹卡片第二行：里面前几篇的名字 */
function firstNames(d: TreeNode): string {
  const names = d.children.filter((c) => c.kind !== 'dir').map((c) => stem(c.name))
  if (!names.length) return d.children.length ? d.children.map((c) => c.name).slice(0, 3).join(' · ') : '空的'
  return names.slice(0, 3).join(' · ') + (names.length > 3 ? ' · …' : '')
}

/** 白板缩略图：卡片、列按真实位置缩小摆在点阵底上 */
function BoardThumb(props: { rects: ThumbRect[]; color: string }) {
  const W = 260
  const H = 132
  const rects = props.rects.slice(0, 40)
  if (!rects.length)
    return (
      <span className="bth empty">
        <i className="sw" style={{ background: props.color }} />
      </span>
    )
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  const scale = Math.min((W - 24) / (maxX - minX || 1), (H - 20) / (maxY - minY || 1), 0.4)
  return (
    <span className="bth" aria-hidden>
      {rects.map((r, i) => (
        <i key={i} className={r.k} style={{ left: 12 + (r.x - minX) * scale, top: 10 + (r.y - minY) * scale, width: Math.max(10, r.w * scale), height: Math.max(8, r.h * scale) }}>
          <s />
          <s style={{ width: '60%' }} />
        </i>
      ))}
    </span>
  )
}

function PdfCard(props: { node: TreeNode; onOpen(): void }) {
  const e = props.node.entry!
  const url = useCover(e.path, e.mtimeMs)
  const p = e.progress
  return (
    <button className="fc-tcard" onClick={props.onOpen} onContextMenu={(ev) => onFileMenu(ev, e.path)}>
      <span className="pth">{url && url !== 'failed' ? <img src={url} alt="" /> : <Codicon name="file-pdf" size={28} />}</span>
      <span className="tn">
        <span className="truncate">{stem(fileName(e.path))}</span>
        <span className="fm num">{p ? `${p.pages}页 · ${p.asked ? `读到${p.asked}` : '没开始'}` : '没开始'}</span>
      </span>
    </button>
  )
}
