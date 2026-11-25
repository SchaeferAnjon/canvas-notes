import { Codicon } from '@cn/design'
import { copy, menuAt, type MenuEntry, showMenu } from './ctx/menu'
import { app } from './ctx/actions'
import { useEffect, useRef, useState } from 'react'
import type { CommitInfo } from '../shared/api'
import type { DiffSource } from '../shared/diff'
import { titleOf } from '../shared/layout'
import { autoCommitLabel } from '../shared/appearance'
import { when } from '../shared/when'
import { fileIcon } from './Palette'
import { Popover } from './shell/Shell'
import { setHideInternal, useHideInternal } from './history-hide'
import { useT } from './i18n'

/** 软件自己的文件：主进程照 @cn/git 的 isInternalPath 标好（files、changes 上的 internal），这里不另写名单 */
const internal = (f: { internal?: boolean }) => !!f.internal
const isKeep = (p: string) => /(^|\/)\.gitkeep$/.test(p)

type Row = CommitInfo['files'][number] & { kind: 'mine' | 'folder' | 'gear' }

/**
 * 一次提交里列哪些文件：藏着设置文件时只列用户自己的；只建了空文件夹那次（只有 .gitkeep）列成「课程/ecpc/」一行。
 * 设置文件也列出来时，设置文件带齿轮、灰一点
 */
function rowsOf(c: CommitInfo, hide: boolean): Row[] {
  const rows: Row[] = c.files.map((f) => ({ ...f, kind: isKeep(f.path) ? 'folder' : internal(f) ? 'gear' : 'mine' }))
  // 自己的文件在前，文件夹、设置文件排在后面（git 按路径排，.canvas-notes 会跑到最前）
  if (!hide) return [...rows.filter((r) => r.kind === 'mine'), ...rows.filter((r) => r.kind === 'folder'), ...rows.filter((r) => r.kind === 'gear')]
  const mine = rows.filter((r) => r.kind === 'mine')
  return mine.length ? mine : rows.filter((r) => r.kind === 'folder')
}

/**
 * 右栏「历史」：每次提交改了哪些文件（CN-46 / 48）。侧栏只列文件，自己不画 diff：
 * 单击一个文件 = 中间栏开对比标签（滚到这个文件）；双击 = 打开这篇（换掉当前标签，同文件树）；
 * 右键：打开 · 在新标签打开 · 看这一版 ·（这次删掉的）放回这一篇 · 在访达中显示 · 拷贝路径（文件已经不在了，只有「看这一版」「放回」能用）。
 * 一次提交右键：看这次改了什么 ·（这次删过文件的）把删掉的 N 个文件放回来（CN-108 方向 A）· 拷贝提交号 · 拷贝说明。
 * 头上 ⋯ 里「藏起软件自己的设置文件」（CN-116 方向 A，默认开）：只动了设置的提交不出现，混着的只列自己的文件。
 */
export function HistoryPanel(props: {
  version: number
  onClose(): void
  onOpenDiff(src: DiffSource, title: string): void
  changes: { path: string; internal?: boolean }[]
  autoMinutes: number
  onCommit(): Promise<void>
  /** 放回那次删掉的文件（only：只放这几篇）；成功回放回那次的提交号 */
  onRestore(hash: string, only?: string[]): Promise<string | null>
  onNotice(text: string): void
}) {
  const t = useT()
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)
  const [committing, setCommitting] = useState(false)
  const [openHash, setOpenHash] = useState<string | null>(null)
  const [cur, setCur] = useState<string | null>(null)
  // 「藏起软件自己的设置文件」开关，记在本机，默认开（CN-116 方向 A）；设置 › Git和同步里是同一个
  const hide = useHideInternal()
  const [more, setMore] = useState<HTMLElement | null>(null)
  /** 刚放回的那次（左边一道强调色竖线）；放回以后删掉的那次还展开着 */
  const [fresh, setFresh] = useState<string | null>(null)
  /** 上次读到的最新一次：有新提交时才换展开的那次（别处的改动让列表重读时，展开着的不动） */
  const head = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    void window.cn.history(100, { hideInternal: hide }).then((c) => {
      if (!live) return
      setCommits(c)
      // 有新提交时展开最新那次（放回的那次除外，见 restore）
      const top = c[0]?.hash ?? null
      if (top !== head.current) setOpenHash(top)
      head.current = top
    })
    return () => {
      live = false
    }
  }, [props.version, hide])

  const short = (h: string) => h.slice(0, 7)
  const name = (p: string) => (/\.md$/i.test(p) ? titleOf(p) : p.split('/').pop()!)
  const diff = (c: CommitInfo, path: string) => {
    setCur(c.hash + ':' + path)
    props.onOpenDiff({ kind: 'commit', hash: c.hash, focus: path, ...(hide ? { hide: true } : {}) }, `${name(path)} · ${short(c.hash)}`)
  }
  const version = (c: CommitInfo, path: string) => props.onOpenDiff({ kind: 'version', hash: c.hash, path }, t('{name} · {hash}那一版', { name: name(path), hash: short(c.hash) }))
  /** 放回以后：放回的那次在最上面标出来（左边一道强调色竖线），删掉的那次还展开着（不管列表先读到还是后读到放回那次） */
  async function restore(c: CommitInfo, only?: string[]) {
    const commit = await props.onRestore(c.hash, only)
    if (!commit) return
    head.current = commit
    setFresh(commit)
    setOpenHash(c.hash)
  }
  function toggleHide() {
    const next = !hide
    setHideInternal(next)
    setMore(null)
    if (next) return props.onNotice(t('藏起了软件自己的设置文件'))
    void window.cn.history(100).then((all) => {
      const n = all.filter((c) => c.files.length > 0 && c.files.every((f) => internal(f) && !isKeep(f.path))).length
      props.onNotice(n ? t('设置文件也列出来了：多了{n}次提交', { n }) : t('设置文件也列出来了'))
    })
  }
  // 还没提交的改动：藏着设置文件时也不数它们
  const pending = hide ? props.changes.filter((c) => !internal(c)) : props.changes
  const pendingSettings = hide && !pending.length && props.changes.length > 0

  return (
    <aside className="right" aria-label={t('历史')}>
      <div className="rhead">
        <Codicon name="history" size={16} className="ci" />
        <b>{t('历史')}</b>
        <span className="meta">{t('最近100次')}</span>
        <span className="sp" />
        <button className={'iconbtn' + (more ? ' on' : '')} aria-label={t('更多')} aria-expanded={!!more} data-tip={t('更多')} data-side="below" onClick={(e) => setMore(more ? null : e.currentTarget)}>
          <Codicon name="ellipsis" size={14} />
        </button>
        <button className="iconbtn" aria-label={t('关上历史')} onClick={props.onClose}>
          <Codicon name="close" size={14} />
        </button>
      </div>
      {more && (
        <Popover anchor={more.closest<HTMLElement>('.rhead') ?? more} gap={6} label={t('历史的设置')} className="pop12 hist-more" align="end" onClose={() => setMore(null)}>
          <button className="pi" role="menuitemcheckbox" aria-checked={hide} onClick={toggleHide}>
            <Codicon name={hide ? 'eye-closed' : 'eye'} size={14} />
            <span>{t('藏起软件自己的设置文件')}</span>
            {hide && <Codicon name="check" size={14} className="ck" />}
          </button>
          <p className="pnote">{t('左栏、首页、置顶这些设置的改动不列出来')}</p>
        </Popover>
      )}
      <div className="rbody">
        {/* 刚打的字还没到自动提交的点：最上面一行说一声，点「现在提交」就进历史（列表只列提交） */}
        {props.changes.length > 0 && (
          <div className="hist-pending" data-testid="history-pending">
            {/* 点这一行：中间栏开对比标签，看上次提交以后改了什么（和点一次提交一样）；量词和底栏「N处没提交」一样用「处」 */}
            <button className="hp" onClick={() => props.onOpenDiff({ kind: 'working' }, t('还没提交的改动'))}>
              <i className="cdot" />
              <span className="subj">{t('还没提交的改动')}</span>
              {/* 一行放不下时省略号，悬停看全（英文的「Auto-commits every 10 minutes」长） */}
              <span
                className="when"
                title={[
                  pendingSettings ? t('软件自己的设置') : pending.length === 1 ? name(pending[0]!.path) : t('{n}处', { ctx: '没提交', n: pending.length }),
                  props.autoMinutes ? t('{every}自动提交', { every: autoCommitLabel(props.autoMinutes) }) : t('不自动提交'),
                ].join(' · ')}
              >
                {pendingSettings ? t('软件自己的设置') : pending.length === 1 ? name(pending[0]!.path) : t('{n}处', { ctx: '没提交', n: pending.length })} · {props.autoMinutes ? t('{every}自动提交', { every: autoCommitLabel(props.autoMinutes) }) : t('不自动提交')}
              </span>
            </button>
            <button
              className="btn btn-xs"
              disabled={committing}
              onClick={async () => {
                setCommitting(true)
                try {
                  await props.onCommit()
                } finally {
                  setCommitting(false)
                }
              }}
            >
              <Codicon name="git-commit" size={12} />
              {committing ? t('正在提交') : t('现在提交')}
            </button>
          </div>
        )}
        {commits?.length === 0 && !props.changes.length && <p className="list-empty">{t('还没有提交。')}</p>}
        {commits?.map((c, i) => {
          const rows = rowsOf(c, hide)
          const gear = !hide && c.files.length > 0 && c.files.every((f) => internal(f) && !isKeep(f.path))
          return (
            <div
              key={c.hash}
              className={'commit' + (openHash === c.hash ? ' open' : '') + (gear ? ' gear' : '') + (fresh === c.hash ? ' new' : '')}
              data-testid="history-commit"
              onContextMenu={(e) => {
                // 先拦住系统默认的菜单（再问主进程要不要「放回」，问完才弹）
                e.preventDefault()
                e.stopPropagation()
                const base: MenuEntry[] = [{ label: t('看这次改了什么'), run: () => props.onOpenDiff({ kind: 'commit', hash: c.hash, ...(hide ? { hide: true } : {}) }, `${c.subject.slice(0, 24)} · ${short(c.hash)}`) }]
                const tail: MenuEntry[] = ['-', { label: t('拷贝提交号'), run: () => copy(c.hash) }, { label: t('拷贝说明'), run: () => copy(c.subject) }]
                // 这次删过文件：问一下现在还能放回几个（同一个文件夹里有一样内容的就算放回过了）
                void window.cn.restorable(c.hash).then(
                  (r) => {
                    const back: MenuEntry[] = !r.deleted.length
                      ? []
                      : ['-', r.available.length ? { label: t('把删掉的 {n} 个文件放回来', { n: r.available.length }), run: () => void restore(c) } : { label: t('删掉的都已经放回来了'), enabled: false, run: () => undefined }]
                    void showMenu([...base, ...back, ...tail])
                  },
                  () => void showMenu([...base, ...tail]),
                )
              }}
            >
              <button className="ch" onClick={() => setOpenHash(openHash === c.hash ? null : c.hash)}>
                <i className={'cdot' + (i === 0 ? ' head' : '')} />
                <span className="subj">{c.subject}</span>
                <span className="when">
                  {when(Date.parse(c.date), { time: true })} · <code>{short(c.hash)}</code>
                  {rows.length ? ' · ' + t('{n}个文件', { n: rows.length }) : ''}
                </span>
              </button>
              {openHash === c.hash && rows.length > 0 && (
                <div className="files" role="list" aria-label={t('这次改的文件')}>
                  {rows.map((f) => {
                    const gone = f.exists === false
                    const label = f.kind === 'folder' ? f.path.replace(/\.gitkeep$/, '') : f.path
                    return (
                      <button
                        key={f.path}
                        role="listitem"
                        className={'fr' + (cur === c.hash + ':' + f.path ? ' on' : '') + (gone ? ' gone' : '') + (f.kind === 'gear' ? ' gear' : '')}
                        data-kind={f.kind}
                        title={gone ? t('{path}（现在已经不在原处了）', { path: label }) : label}
                        onClick={() => diff(c, f.path)}
                        onDoubleClick={() => {
                          if (!gone) return app().openHere(f.path)
                          // 这次删掉的：说一句右键能放回；别的（挪走了、后来删的）照旧说「看这一版」
                          void window.cn.restorable(c.hash).then(
                            (r) => app().notice(r.available.includes(f.path) ? t('这篇已经删了：右键「放回这一篇」') : t('「{name}」现在已经不在原处了（挪走或删了），右键「看这一版」', { name: name(f.path) }), 'info'),
                            () => app().notice(t('「{name}」现在已经不在原处了（挪走或删了），右键「看这一版」', { name: name(f.path) })),
                          )
                        }}
                        onContextMenu={(e) => {
                          const open: MenuEntry[] = [
                            { label: t('打开'), enabled: !gone, run: () => app().openHere(f.path) },
                            { label: t('在新标签打开'), enabled: !gone, run: () => app().openFile(f.path) },
                            { label: t('看这一版'), run: () => version(c, f.path) },
                          ]
                          const tail: MenuEntry[] = ['-', { label: t('在访达中显示'), enabled: !gone, run: () => window.cnMenu.reveal(f.path) }, { label: t('拷贝路径'), run: () => copy(app().absPath(f.path)) }]
                          if (!gone || f.kind !== 'mine') return void menuAt(e, [...open, ...tail])
                          e.preventDefault()
                          e.stopPropagation()
                          void window.cn.restorable(c.hash).then(
                            (r) => void showMenu([...open, ...(r.available.includes(f.path) ? [{ label: t('放回这一篇'), run: () => void restore(c, [f.path]) }] : []), ...tail]),
                            () => void showMenu([...open, ...tail]),
                          )
                        }}
                      >
                        <Codicon name={f.kind === 'folder' ? 'folder' : f.kind === 'gear' ? 'settings-gear' : fileIcon(f.path)} size={14} />
                        <span className="truncate">{label}</span>
                        {f.kind !== 'gear' && f.added > 0 && <span className="num add">+{f.added}</span>}
                        {f.kind !== 'gear' && f.removed > 0 && <span className="num del">−{f.removed}</span>}
                      </button>
                    )
                  })}
                  <p className="fhint">{t('单击看改动，双击打开，右键更多')}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
