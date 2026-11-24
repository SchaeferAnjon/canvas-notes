/**
 * 文件夹首页组件底下「全部 N 份 · 打开列表看」开的整页（2026-11-24，以前开的是全库「最近」）：只列这个文件夹里那个组件的那一类，不截。
 * 样子照中间「最近」整页（版心 800、筛选框、每行两行），排序是一排小标签。
 * - ParaRead、课件进度：这个文件夹的 PDF，每份写读到多少、改过的时间，「读」「笔记」和组件里一样；按最近读、读到多少、修改时间、名字排。
 * - 笔记和导图、草稿、按条件列出、最近改的、可视化：和组件同一套挑法；按组件自己的排法、修改时间、名字排。
 * - 剪藏（主题）、在上的课（课程）：每行一个文件夹，点了开它的首页。
 */
import { Codicon } from '@cn/design'
import { notePathFor, readPct } from '@cn/format'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { type FolderHome, type PropFile, type WidgetData, wInfo } from '../../shared/folder-home'
import { folderOfPath } from '../../shared/files'
import type { FolderReads } from '../../shared/reading'
import { CLIPS, titleOf } from '../../shared/layout'
import { when } from '../../shared/when'
import { onFileMenu } from '../ctx/file-menu'
import { useFamily } from '../family-store'
import { useVaultFiles } from '../files/store'
import { useT } from '../i18n'
import { fileIcon } from '../Palette'
import { usePrefs } from '../settings-store'
import { PageNote, TabActs } from '../shell/TabActs'
import { folderLabel } from '../vault-name'
import { type Item, order, readPdf, readRight } from './ParaReadWidget'
import { openFolderHome } from './store'
import { clipTopics, courseList, fullList } from './widgets'
import '../recent-page.css'
import { ipcOn } from '../crash/ipc'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 标签上、页头写的这一类叫什么（ParaRead 组件列的是 PDF） */
export function listName(w: WidgetData): string {
  return w.type === 'pararead' ? 'PDF' : (w.cond?.name ?? wInfo(w.type).name)
}

type Sort = 'read' | 'pct' | 'mtime' | 'name' | 'lecture' | 'own'

const byName = (a: string, b: string) => titleOf(a).localeCompare(titleOf(b), 'zh-CN', { numeric: true })

/** 读到多少（0–100）：ParaRead 记的读到哪，没有就看画布笔记的「问到几 / 几页」；都没有是 -1，排最后 */
function pctOf(x: Item): number {
  if (x.read) return readPct(x.read) ?? 0
  const [a, b] = (x.asked ?? '').split('/').map(Number)
  return a && b ? Math.round((a / b) * 100) : -1
}

export function FolderListPage(props: {
  folder: string
  widget: string
  notes: NoteFile[]
  version: number
  onOpen(path: string): void
  onOpenAt(pdf: string, page: number): void
  onNotice(t: string): void
}) {
  const { folder } = props
  const t = useT()
  const fam = useFamily()
  const showTodo = usePrefs((s) => s.files.showTodo)
  const { files: vault } = useVaultFiles()
  const [home, setHome] = useState<FolderHome | null>(null)
  const [files, setFiles] = useState<PropFile[] | null>(null)
  const [reads, setReads] = useState<FolderReads | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort | null>(null)
  const w = home?.widgets[props.widget]
  const pdfMode = w?.type === 'pararead' || w?.type === 'slides'

  const load = useCallback(() => {
    void window.cnFolder.get(folder).then((r) => setHome(r.home), (e) => props.onNotice(errText(e)))
    void window.cnFolder.files(folder, 'folder').then(setFiles, (e) => props.onNotice(errText(e)))
  }, [folder])
  useEffect(load, [load, props.version])
  useEffect(() => {
    if (!pdfMode) return
    const get = () => void window.cnReading.folderReads(folder).then(setReads, (e) => props.onNotice(errText(e)))
    get()
    // 文件一变（这边、ParaRead 写了笔记、读到哪）重读，和组件一样
    const offA = ipcOn(window.cn.onFilesChanged, 'cn.onFilesChanged')(() => (get(), load()))
    const offB = ipcOn(window.cn.onNoteChanged, 'cn.onNoteChanged')(get)
    return () => (offA(), offB())
  }, [pdfMode, folder, load])

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (s: string) => !words.length || words.every((x) => s.toLowerCase().includes(x))
  const sub = (p: string) => {
    const dir = folderOfPath(p)
    return dir === folder ? '' : dir.startsWith(folder + '/') ? dir.slice(folder.length + 1) : folderLabel(dir)
  }
  const now = Date.now()

  if (!home || !files) return <section className="pane recentp" data-testid="folder-list" />
  if (!w)
    return (
      <section className="pane recentp" data-testid="folder-list">
        <div className="body">
          <div className="rp-in">
            <p className="rp-none">{t('首页上已经没有这个组件了。')}</p>
          </div>
        </div>
      </section>
    )
  const name = listName(w)
  const head = (n: string, by: React.ReactNode) => (
    <>
      <TabActs active>
        <PageNote>
          <span className="num">{n}</span>
        </PageNote>
      </TabActs>
      <div className="fl-hd">
        <button className="lnk" onClick={() => openFolderHome(folder)}>
          {folder.split('/').pop()}
        </button>
        <Codicon name="chevron-right" size={12} />
        <b>{t(name)}</b>
      </div>
      <div className="rp-bar">
        <label className="rp-find">
          <Codicon name="search" size={14} />
          <input aria-label={t('筛选')} placeholder={t('筛选名字')} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {by}
      </div>
    </>
  )
  const chips = (keys: [Sort, string][], value: Sort, label = t('排序')) => (
    <div className="tchips fl-sort" role="tablist" aria-label={label}>
      {keys.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} className={'chip' + (value === k ? ' on' : '')} onClick={() => setSort(k)}>
          {l}
        </button>
      ))}
    </div>
  )
  const shell = (body: React.ReactNode) => (
    <section className="pane recentp" data-testid="folder-list" data-folder={folder}>
      <div className="body">
        <div className="rp-in">{body}</div>
      </div>
    </section>
  )

  // ---------- PDF：读到多少、读、笔记 ----------
  if (pdfMode) {
    if (!reads || !fam) return shell(null)
    const installed = w.type === 'pararead' && !!fam.installed.pararead
    const mtime = new Map(files.map((f) => [f.path, f.mtimeMs]))
    const only = w.type === 'slides' ? new Set(fullList({ folder, files }, w, showTodo)!.map((f) => f.path)) : null
    const s = sort ?? 'read'
    const cmp: Record<string, (a: Item, b: Item) => number> = {
      read: order,
      pct: (a, b) => pctOf(b) - pctOf(a) || byName(a.pdf, b.pdf),
      mtime: (a, b) => (mtime.get(b.pdf) ?? 0) - (mtime.get(a.pdf) ?? 0) || byName(a.pdf, b.pdf),
      name: (a, b) => byName(a.pdf, b.pdf),
    }
    const items = reads.items.filter((x) => (!only || only.has(x.pdf)) && hit(titleOf(x.pdf))).sort(cmp[s])
    const total = reads.items.filter((x) => !only || only.has(x.pdf)).length
    const read = (x: Item) => readPdf(x, { installed, view: w.view ?? 'bilingual', folder, onOpenAt: props.onOpenAt, onError: props.onNotice })
    return shell(
      <>
        {head(
          t('{n}份 PDF', { n: total }),
          chips(
            [
              ['read', t('最近读')],
              ['pct', t('读到多少')],
              ['mtime', t('修改时间')],
              ['name', t('名字')],
            ],
            s,
          ),
        )}
        <div role="list" aria-label={t('这个文件夹里的 PDF')}>
          {items.map((x) => (
            <div key={x.pdf} role="listitem">
              <div className="rp-row rp-rec" data-testid="flist-pdf" role="button" tabIndex={0} title={x.pdf} onClick={() => read(x)} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && read(x)} onContextMenu={(e) => onFileMenu(e, x.pdf)}>
                <span className="ic">
                  <Codicon name="file-pdf" />
                </span>
                <span className="ti t">{titleOf(x.pdf).replace(/\.pdf$/i, '')}</span>
                <span className="rt">
                  {sub(x.pdf) && `${sub(x.pdf)} · `}
                  <span className="num">{mtime.has(x.pdf) ? when(mtime.get(x.pdf)!, { now }) : ''}</span>
                </span>
                <span className="pv rp-meta">
                  <span className="num fl-read" data-testid="flist-read">
                    {readRight(t, installed, x)}
                  </span>
                  <button className="rp-note" onClick={(e) => (e.stopPropagation(), read(x))}>
                    {t('读', { ctx: 'ParaRead组件' })}
                  </button>
                  <button className="rp-note" disabled={!x.note} title={x.note ? undefined : t('还没有笔记')} onClick={(e) => (e.stopPropagation(), props.onOpen(notePathFor(x.pdf)))}>
                    {t('笔记', { ctx: 'ParaRead组件' })}
                  </button>
                </span>
              </div>
            </div>
          ))}
          {!items.length && <p className="rp-none">{words.length ? t('没有对得上的') : t('这个文件夹里还没有PDF。')}</p>}
        </div>
      </>,
    )
  }

  // ---------- 文件夹：剪藏的主题、在上的课 ----------
  if (w.type === 'clips' || w.type === 'courses') {
    const rows =
      w.type === 'clips'
        ? clipTopics(props.notes).map(([topic, n]) => ({ folder: topic === '未分主题' ? CLIPS : `${CLIPS}/${topic}`, name: topic === '未分主题' ? t('未分主题') : topic, right: t('{n}篇', { n }) })) // 不翻：比的是 kindOf 给的「未分主题」
        : courseList(vault).map((x) => ({ folder: x.folder, name: x.folder.split('/')[1]!, right: x.total ? t('{done}/{total}讲', { done: x.done, total: x.total }) : '' }))
    const shown = rows.filter((r) => hit(r.name))
    return shell(
      <>
        {head(w.type === 'clips' ? t('{n}个主题', { n: rows.length }) : t('{n}门课', { n: rows.length }), null)}
        <div role="list" aria-label={t(name)}>
          {shown.map((r) => (
            <div key={r.folder} role="listitem">
              <button className="rp-row" data-testid="flist-folder" onClick={() => openFolderHome(r.folder)}>
                <span className="ic">
                  <Codicon name={w.type === 'clips' ? 'folder' : 'folder-library'} />
                </span>
                <span className="ti t">{r.name}</span>
                <span className="rt num">{r.right}</span>
              </button>
            </div>
          ))}
          {!shown.length && <p className="rp-none">{t('没有对得上的')}</p>}
        </div>
      </>,
    )
  }

  // ---------- 文件：笔记和导图、草稿、按条件列出、最近改的、可视化 ----------
  const list = fullList({ folder, files }, w, showTodo) ?? []
  const own: Sort = w.cond?.sort.prop === '第几讲' ? 'lecture' : w.cond?.sort.prop === '名字' ? 'name' : 'mtime'
  const s = sort ?? own
  const lecture = (f: PropFile) => Number(f.props['第几讲']) || 0 // 不翻：属性键
  const sorted =
    s === own && w.cond
      ? list // 组件自己的排法（升降照它的条件）
      : [...list].sort((a, b) => (s === 'name' ? byName(a.path, b.path) : s === 'lecture' ? lecture(b) - lecture(a) || byName(a.path, b.path) : b.mtimeMs - a.mtimeMs))
  const meta = new Map(props.notes.map((n) => [n.path, n]))
  const shown = sorted.filter((f) => hit(titleOf(f.path) + '\n' + (meta.get(f.path)?.excerpt ?? '')))
  return shell(
    <>
      {head(
        t('{n}篇', { n: list.length }),
        chips(
          [
            ...(own === 'lecture' ? [['lecture', t('第几讲')] as [Sort, string]] : []),
            ['mtime', t('修改时间')],
            ['name', t('名字')],
          ],
          s,
        ),
      )}
      <div role="list" aria-label={t(name)}>
        {shown.map((f) => {
          const n = meta.get(f.path)
          return (
            <div key={f.path} role="listitem">
              <button className="rp-row" data-testid="flist-file" onClick={() => props.onOpen(f.path)} onContextMenu={(e) => onFileMenu(e, f.path)} title={f.path}>
                <span className="ic">{n?.board ? <i className="sw" style={{ background: n.board.color }} /> : <Codicon name={/\.pdf$/i.test(f.path) ? 'file-pdf' : f.props['类型'] === '导图' ? 'type-hierarchy' : fileIcon(f.path, false, n?.digest)} />}</span>
                <span className="ti t">{titleOf(f.path).replace(/\.(pdf|html?)$/i, '')}</span>
                <span className="rt">
                  {sub(f.path) && `${sub(f.path)} · `}
                  {/* 不翻：属性键、属性值照文件里的写 */}
                  {f.props['第几讲'] && `${t('第{n}讲', { n: f.props['第几讲'] })} · `}
                  <span className="num">{when(f.mtimeMs, { now })}</span>
                </span>
                <span className="pv">{n?.board ? t('{n}张卡片', { n: n.board.cards }) : n?.excerpt || ''}</span>
              </button>
            </div>
          )
        })}
        {!shown.length && <p className="rp-none">{words.length ? t('没有对得上的') : t('没有符合条件的文件。改一改条件，或者等这个文件夹里多一些东西。')}</p>}
      </div>
    </>,
  )
}
