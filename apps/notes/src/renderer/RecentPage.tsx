/**
 * 中间的「最近」整页（2026-11-17 左栏重组，替掉原来的「全部笔记」）：顶上写个标题回车新建一篇（先放进「收件箱」），
 * 下面筛选框（标题、文件夹、正文）和类型筛选，按时间分组：今天、这周，更早的按月收起；每篇两行（名字 + 一行预览）。
 * 每组先列 100 篇，多的点「再显示」（别把上万条全铺开）；筛选时各组都展开。
 * 2026-11-24：和左栏一样也列打开过的 PDF、HTML（配对笔记并进去）、右栏看过的网页，类型筛选只出有的几类。
 */
import { folderLabel } from './vault-name'
import { when } from '../shared/when'
import { Codicon } from '@cn/design'
import { useMemo, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { folderOfPath } from '../shared/files'
import { INBOX, titleOf } from '../shared/layout'
import { isOpened, RECENT_PAGE, type RecentItem, recentItems, recentOf, type RecentOpened } from '../shared/recent'
import { menuAt } from './ctx/menu'
import { useOpenedAt, useRecentWeb, useVaultFiles } from './files/store'
import { Progress } from './search/QuickOpen'
import type { ArchiveDays } from '../shared/sidebar'
import { onFileMenu } from './ctx/file-menu'
import { recentType, type TypeFilter, TypeChips } from './files/type-filter'
import { fileIcon } from './Palette'
import { PageNote, TabActs } from './shell/TabActs'
import './recent-page.css'
import { usePrefs } from './settings-store'
import { useT } from './i18n'
import { recentLabel } from './Sidebar'

export function RecentPage(props: {
  notes: NoteFile[]
  pins: string[]
  archiveDays: ArchiveDays
  activePath: string | null
  onOpen(path: string): void
  /** 点了打开过的 PDF、HTML */
  onOpenFile(path: string): void
  /** 点了看过的网页：在右栏开 */
  onOpenWeb(url: string): void
  /** 写了标题回车：在收件箱里新建这一篇并打开 */
  onCreate(title: string): Promise<void>
}) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const showTodo = usePrefs((s) => s.files.showTodo)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState<Record<string, number>>({})
  const now = Date.now()
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const { files } = useVaultFiles()
  const openedAt = useOpenedAt()
  const web = useRecentWeb()
  const items = useMemo(() => recentItems(props.notes, files, openedAt, web), [props.notes, files, openedAt, web])
  const kinds = useMemo(() => [...new Set(items.map(recentType))] as TypeFilter[], [items])
  const hay = (n: RecentItem) => (isOpened(n) ? n.path + '\n' + (n.title ?? '') : n.path + '\n' + (n.excerpt ?? '')).toLowerCase()
  const m = useMemo(
    () =>
      recentOf<RecentItem>(items, {
        pins: [],
        now,
        archiveDays: props.archiveDays,
        withArchived: true,
        keep: (n) => (type === 'all' || recentType(n) === type) && (!words.length || words.every((w) => hay(n).includes(w))),
        // 名字叫「待办」的笔记在左边「待办」格里，设置 › 文件没开「文件树里显示待办」时这里不列（task-pd1d1）
        hideTodo: !showTodo,
      }),
    // now 每次渲染都变，只在笔记、筛选变了时重算
    [items, props.archiveDays, type, q, showTodo],
  )
  const create = async () => {
    const name = title.trim()
    if (!name) return
    await props.onCreate(name)
    setTitle('')
  }

  return (
    <section className="pane recentp" data-testid="recent-page">
      <TabActs active>
        <PageNote>
          <span className="num">{t('{n}篇 · 按修改时间', { n: m.total })}</span>
        </PageNote>
      </TabActs>
      <div className="body">
        <div className="rp-in">
          <form
            className="rp-new"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <Codicon name="new-file" size={16} />
            <input aria-label={t('新建一篇的标题')} placeholder={t('写个标题，回车新建一篇 · 放进「{folder}」', { folder: INBOX })} value={title} onChange={(e) => setTitle(e.target.value)} />
            <button className="go" type="submit" aria-label={t('新建')} disabled={!title.trim()}>
              <Codicon name="arrow-right" size={14} />
            </button>
          </form>
          <div className="rp-bar">
            <label className="rp-find">
              <Codicon name="search" size={14} />
              <input aria-label={t('筛选')} placeholder={t('筛选标题、文件夹、正文')} value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <TypeChips value={type} onChange={setType} kinds={kinds} />
          </div>
          <div role="list" aria-label={t('最近的笔记')}>
            {m.groups.map((g) => {
              const folded = g.key !== 'today' && g.key !== 'week' && !words.length
              const isOpen = !folded || open.has(g.key)
              const limit = shown[g.key] ?? RECENT_PAGE
              return (
                <div key={g.key} className="rp-group" role="group" aria-label={recentLabel(g)}>
                  {folded ? (
                    <button className="rp-fold" aria-expanded={isOpen} onClick={() => setOpen((s) => (s.has(g.key) ? new Set([...s].filter((x) => x !== g.key)) : new Set([...s, g.key])))}>
                      <Codicon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
                      {recentLabel(g)}
                      <span className="c num">{t('{n}篇', { n: g.items.length })}</span>
                    </button>
                  ) : (
                    <div className="rp-g">{recentLabel(g)}</div>
                  )}
                  {isOpen &&
                    g.items.slice(0, limit).map((n) =>
                      isOpened(n) ? (
                        <OpenedRow key={n.path} x={n} now={now} on={props.activePath === n.path} onOpen={n.opened === 'web' ? props.onOpenWeb : props.onOpenFile} onOpenNote={props.onOpen} />
                      ) : (
                        <div key={n.path} role="listitem">
                        <button className={'rp-row' + (props.activePath === n.path ? ' on' : '')} onClick={() => props.onOpen(n.path)} onContextMenu={(e) => onFileMenu(e, n.path)} title={n.path}>
                          <span className="ic">{n.board ? <i className="sw" style={{ background: n.board.color }} /> : <Codicon name={fileIcon(n.path, false, n.digest)} />}</span>
                          <span className="ti t">{titleOf(n.path)}</span>
                          <span className="rt">
                            {folderLabel(folderOfPath(n.path))} · <span className="num">{when(n.mtimeMs, { now })}</span>
                          </span>
                          <span className="pv">{n.board ? t('{n}张卡片', { n: n.board.cards }) : n.excerpt || t('空的')}</span>
                        </button>
                        </div>
                      ),
                    )}
                  {isOpen && g.items.length > limit && (
                    <button className="rp-fold rp-more" onClick={() => setShown((s) => ({ ...s, [g.key]: limit + RECENT_PAGE }))}>
                      <Codicon name="chevron-down" size={12} />
                      <span className="num">{t('再显示{n}篇', { n: Math.min(RECENT_PAGE, g.items.length - limit) })}</span>
                      <span className="c num">{t('还有{n}篇', { n: g.items.length - limit })}</span>
                    </button>
                  )}
                </div>
              )
            })}
            {!m.groups.length && <p className="rp-none">{words.length || type !== 'all' ? t('没有对得上的笔记') : t('还没有笔记。上面写个标题，回车就有第一篇')}</p>}
          </div>
        </div>
      </div>
    </section>
  )
}

const KIND_ICON = { pdf: 'file-pdf', html: 'file-code', web: 'globe' } as const
const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 打开过的 PDF、HTML、看过的网页：名字、在哪（网页是域名）· 时间；第二行类型小标、问到第几页、配对笔记的「笔记」 */
function OpenedRow(props: { x: RecentOpened; now: number; on: boolean; onOpen(path: string): void; onOpenNote(path: string): void }) {
  const t = useT()
  const { x } = props
  const web = x.opened === 'web'
  const name = web ? x.title || hostOf(x.path) : (x.path.split('/').pop() ?? x.path).replace(/\.(pdf|html?)$/i, '')
  return (
    <div role="listitem">
      <div
        className={'rp-row rp-rec' + (props.on ? ' on' : '')}
        data-kind={x.opened}
        role="button"
        tabIndex={0}
        onClick={() => props.onOpen(x.path)}
        onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && props.onOpen(x.path)}
        onContextMenu={(e) => (web ? void menuAt(e, [{ label: t('从最近里去掉'), run: () => window.cnWeb.removeRecent(x.path) }]) : onFileMenu(e, x.path))}
        title={x.path}
      >
        <span className="ic">
          <Codicon name={KIND_ICON[x.opened]} />
        </span>
        <span className="ti t">{name}</span>
        <span className="rt">
          {web ? hostOf(x.path) : folderLabel(folderOfPath(x.path))} · <span className="num">{when(x.mtimeMs, { now: props.now })}</span>
        </span>
        <span className="pv rp-meta">
          <span className="rp-kind">{x.opened === 'pdf' ? 'PDF' : x.opened === 'html' ? 'HTML' : t('网页')}</span>
          {x.progress && <Progress p={x.progress} />}
          {x.note && (
            <button
              className="rp-note"
              onClick={(e) => {
                e.stopPropagation()
                props.onOpenNote(x.note!)
              }}
            >
              {t('笔记')}
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
