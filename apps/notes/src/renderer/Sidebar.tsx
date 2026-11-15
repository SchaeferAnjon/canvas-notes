import { Icon } from '@cn/design'
import { Archive, ChevronDown, FileText, Files, Folder, Home, Inbox, Library, Moon, Palette, Plus, Quote, Search, Settings, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { NoteFile } from '../shared/api'
import { titleOf } from '../shared/layout'
import { type ArchiveDays, INBOX_WARN, sidebarOf } from '../shared/sidebar'
import { noteMenu, RenameInput } from './note-menu'
import './sidebar.css'
import type { Tab } from './tabs'

/**
 * 左栏只放「活着的」：置顶的、最近的白板、这周动过的文档、最近剪过的素材主题；
 * 其余在底部「全部笔记」「归档」里。库再大，左栏也只有二三十行。
 */
export function Sidebar(props: {
  vaultName: string
  notes: NoteFile[]
  pins: string[]
  archiveDays: ArchiveDays
  active: Tab | null
  onOpenNote(path: string): void
  onOpenInbox(): void
  onOpenHome(): void
  onOpenTopic(topic: string): void
  onOpenAll(): void
  onOpenArchive(): void
  onNewNote(): void
  onNewBoard(): void
  onSearch(): void
  onDream(): void
  dreamCount: number
  /** 收件箱堆多了：让 AI 分一分 */
  onTidy(): void
  /** 左栏底部「外观」：打开设置的外观页 */
  onAppearance(): void
  onSettings(): void
  /** 点库名：打开设置的「库」页 */
  onVault(): void
  /** 右键菜单里点了「重命名」后，在左栏原地改名 */
  onRename(path: string, name: string): void
  onTrash(path: string): void
  /** 右键置顶 / 取消置顶之后 */
  onPinsChanged(): void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const { notes, active } = props
  const m = useMemo(() => sidebarOf(notes, props.pins, Date.now(), props.archiveDays), [notes, props.pins, props.archiveDays])
  const menu = (e: React.MouseEvent, path: string) =>
    void noteMenu(e, path, { rename: setRenaming, trash: props.onTrash, pinned: props.onPinsChanged })
  const isOn = (path: string) => active?.type === 'note' && active.path === path

  const row = (n: NoteFile) => (
    <button key={n.path} className={'si' + (isOn(n.path) ? ' on' : '')} onClick={() => props.onOpenNote(n.path)} onContextMenu={(e) => menu(e, n.path)} title={n.path}>
      {n.board ? <i className="sw" style={{ background: n.board.color }} /> : <Icon of={n.kind === 'inbox' ? Inbox : n.kind === 'clip' ? Quote : FileText} />}
      {renaming === n.path ? (
        <RenameInput path={n.path} onDone={() => setRenaming(null)} onRename={props.onRename} />
      ) : (
        <span className="truncate">{titleOf(n.path)}</span>
      )}
      {n.board ? <span className="c num">{n.board.cards}</span> : n.draft && <span className="tag-draft">草稿</span>}
    </button>
  )
  const warn = m.inbox > INBOX_WARN

  return (
    <aside className="side">
      <button className="vault" title="换库、看库在哪" onClick={props.onVault}>
        <span className="vi">
          <Icon of={Library} />
        </span>
        <span className="vt">
          <b>{props.vaultName}</b>
          <span className="num">{notes.length} 篇 · 本地 Git</span>
        </span>
        <Icon of={ChevronDown} size={14} />
      </button>
      <button className="sfind" onClick={props.onSearch} aria-label="搜索">
        <Icon of={Search} size={14} />
        搜索
        <kbd>⌘F</kbd>
      </button>
      <nav className="nav" aria-label="笔记">
        <button className={'si' + (active?.type === 'home' ? ' on' : '')} onClick={props.onOpenHome}>
          <Icon of={Home} />
          首页
        </button>
        <button className={'si' + (active?.type === 'inbox' ? ' on' : '')} onClick={props.onOpenInbox}>
          <Icon of={Inbox} />
          收件箱
          {m.inbox > 0 && (
            <span className={'badge num' + (warn ? ' warn' : '')} data-testid="inbox-count" title={warn ? `收件箱超过 ${INBOX_WARN} 条了` : undefined}>
              {m.inbox}
            </span>
          )}
        </button>
        {warn && (
          <button className="si s-tidy" onClick={props.onTidy} title={`收件箱堆了 ${m.inbox} 条，让 AI 按主题分进素材`}>
            <Icon of={Sparkles} size={12} />
            让 AI 分一分
          </button>
        )}
        <button className="si" onClick={props.onDream}>
          <Icon of={Moon} />
          梦游报告
          {props.dreamCount > 0 && <span className="c num">{props.dreamCount} 条</span>}
        </button>

        {m.pinned.length > 0 && (
          <div className="s-group" role="group" aria-label="置顶">
            <div className="sh">置顶</div>
            {m.pinned.map(row)}
          </div>
        )}

        <div className="s-group" role="group" aria-label="最近的白板">
          <div className="sh">
            白板
            <button className="add" aria-label="新建白板" title="新建白板" onClick={props.onNewBoard}>
              <Icon of={Plus} size={14} />
            </button>
          </div>
          {m.boards.map(row)}
        </div>

        <div className="s-group" role="group" aria-label="这周动过的">
          <div className="sh">
            我写的
            <span className="sub">这周动过的</span>
            <button className="add" aria-label="新建笔记" title="新建笔记 ⌘N" onClick={props.onNewNote}>
              <Icon of={Plus} size={14} />
            </button>
          </div>
          {m.works.map(row)}
          {m.works.length === 0 && <p className="s-none">这周还没动过，旧的都在「全部笔记」</p>}
          {m.moreWorks > 0 && (
            <button className="si s-more" onClick={props.onOpenAll}>
              还有 <span className="num">{m.moreWorks}</span> 篇这周动过
            </button>
          )}
        </div>

        {m.topics.length > 0 && <div className="sh">素材 · 按主题</div>}
        {m.topics.map(({ topic, count }) => (
          <button key={topic} className={'si' + (active?.type === 'topic' && active.topic === topic ? ' on' : '')} onClick={() => props.onOpenTopic(topic)}>
            <Icon of={Folder} />
            <span className="truncate">{topic}</span>
            <span className="c num">{count}</span>
          </button>
        ))}
      </nav>
      <div className="sall">
        <button className={'si' + (active?.type === 'all' ? ' on' : '')} onClick={props.onOpenAll}>
          <Icon of={Files} />
          全部笔记
          <span className="c num" data-testid="all-count">
            {m.all} 篇
          </span>
        </button>
        <button className={'si' + (active?.type === 'archive' ? ' on' : '')} onClick={props.onOpenArchive} title={props.archiveDays ? `${props.archiveDays} 天没改过的，左栏不显示` : '没开自动归档'}>
          <Icon of={Archive} />
          归档
          <span className="c num" data-testid="archive-count">
            {m.archived} 篇
          </span>
        </button>
      </div>
      <div className="sfoot">
        <button className="si" onClick={props.onAppearance}>
          <Icon of={Palette} />
          外观
        </button>
        <button className="iconbtn" aria-label="设置" title="设置 ⌘," onClick={props.onSettings}>
          <Icon of={Settings} />
        </button>
      </div>
    </aside>
  )
}
