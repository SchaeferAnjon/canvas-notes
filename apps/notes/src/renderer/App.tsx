import { Icon } from '@cn/design'
import { Archive, CircleArrowUp, FilePlus, FileText, Files, Folder, FolderOpen, GitCommitHorizontal, Globe, History, Home, Inbox, LayoutGrid, Moon, Palette as PaletteIcon, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings as SettingsIcon, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Clip, GitState, NoteFile, VaultInfo } from '../shared/api'
import { CLIPS, clipMarkdown, titleOf } from '../shared/layout'
import { AiPanel } from './AiPanel'
import { contextOf, useAiBridge } from './ai-bridge'
import { DreamPanel } from './dream/DreamPanel'
import { pendingOf, useDream } from './dream/useDream'
import { GitBar } from './GitBar'
import { reloadHome, resetHome } from './home-store'
import { HomeView } from './HomeView'
import { HistoryPanel } from './HistoryPanel'
import { UpdateBarItem, useUpdateState } from './update'
import { ListView } from './ListView'
import type { ViewMode } from './note-doc'
import { NoteIndex } from './NoteIndex'
import { NoteTab } from './NoteTab'
import { Sidebar } from './Sidebar'
import { NoteDoc } from './note-doc'
import { Palette, type PaletteCommand } from './Palette'
import { usePluginCommands } from './plugins'
import { Rail } from './Rail'
import { Settings, type SettingsPage } from './Settings'
import { useAppSettings } from './theme'
import { loadTabs, newId, saveTabs, type Tab } from './tabs'
import { type ClipMode, hostOf, WebPanel } from './WebPanel'
import { WebTab } from './web/WebTab'

type Right = 'web' | 'history' | 'dream' | null

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function App() {
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined)
  useEffect(() => {
    void window.cn.vault().then(setVault)
  }, [])
  if (vault === undefined) return null
  if (vault === null) return <Welcome onOpen={() => void window.cn.chooseVault().then(setVault)} />
  // 换库：整个书桌按新库重新建一遍（标签、AI 对话都跟着库走）
  return (
    <Desk
      key={vault.path}
      vault={vault}
      onSwitchVault={(v) => {
        resetHome()
        setVault(v)
      }}
    />
  )
}

function Desk({ vault, onSwitchVault }: { vault: VaultInfo; onSwitchVault(v: VaultInfo): void }) {
  const [settings, setSettings, systemDark] = useAppSettings()
  /** 设置面板开着哪一页（⌘, 打开） */
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null)
  const [notes, setNotes] = useState<NoteFile[]>([])
  /** 置顶的笔记（库里 .canvas-notes/置顶.json） */
  const [pins, setPins] = useState<string[]>([])
  const [{ tabs, active }, setTabState] = useState(() => {
    const t = loadTabs(vault.path)
    if (t.tabs.length) return t
    const home: Tab = { id: newId(), type: 'home' }
    return { tabs: [home], active: home.id }
  })
  /** AI 只浮在中间栏右下角（⌘J 开关），不进右栏 */
  const [aiFloat, setAiFloat] = useState(false)
  /** 左栏收起来了（红绿灯旁的按钮或 ⌘\\），记在本机 */
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem('cn.sideHidden') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('cn.sideHidden', sidebarHidden ? '1' : '0')
    } catch {
      // 记不住不影响使用
    }
  }, [sidebarHidden])
  const [git, setGit] = useState<GitState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [right, setRight] = useState<Right>(null)
  const historyOpen = right === 'history'
  const toggleRight = (r: Exclude<Right, null>) => setRight((v) => (v === r ? null : r))
  /** 每个标签记住自己开着的网页 */
  const [webUrl, setWebUrl] = useState<Record<string, string>>({})
  const [activeMode, setActiveMode] = useState<ViewMode>('doc')
  const [gitVersion, setGitVersion] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** ⌘K 里点「编辑首页」：首页进编辑状态 */
  const [homeEditSeq, setHomeEditSeq] = useState(0)
  /** 让右栏开一个新网页标签（⌘K 里打的网址、宽标签放回右栏） */
  const [webOpen, setWebOpen] = useState<{ url: string; seq: number } | null>(null)
  const openInWeb = (url: string) => {
    setWebOpen((r) => ({ url, seq: (r?.seq ?? 0) + 1 }))
    setRight('web')
  }
  // ---------- 检查更新 ----------
  const update = useUpdateState()
  useEffect(() => window.cn.onUpdateOpen(() => setSettingsPage('update')), [])
  // 更新后第一次打开：说一句（只一次）
  useEffect(() => {
    if (!update || update.phase === 'off') return
    try {
      const last = localStorage.getItem('cn.lastVersion')
      localStorage.setItem('cn.lastVersion', update.current)
      if (last && last !== update.current) setNotice(`已更新到 ${update.current}`)
    } catch {
      // 记不住就不说
    }
  }, [update?.current, update?.phase === 'off'])
  async function installUpdate() {
    await NoteDoc.saveAll()
    if (!(await window.cn.installUpdate())) setNotice('新版本还没下载好')
  }

  /** 让 AI 一打开就跑的命令（首页「让 AI 分一分」、⌘K 里的 AI 命令） */
  const [aiAuto, setAiAuto] = useState<{ text: string; seq: number } | null>(null)
  /** 右栏宽度，能拖；记在本机 */
  const [rightW, setRightW] = useState(() => {
    try {
      return Number(localStorage.getItem('cn.rightW')) || 420
    } catch {
      return 420
    }
  })
  const dream = useDream()
  const dreamNow = () => {
    dream.setRunning(true)
    window.cn.dreamNow().then(dream.setReport, (e) => setNotice(errText(e)))
  }
  /** 当前标签的编辑器（剪进文档、AI 用） */
  const activeDoc = useRef<NoteDoc | null>(null)

  const refreshGit = useCallback(() => {
    void window.cn.gitState().then(setGit)
    setGitVersion((v) => v + 1)
  }, [])
  const refreshNotes = useCallback(() => {
    void window.cn.listNotes().then(setNotes)
    void window.cn.pins().then(setPins)
  }, [])

  useEffect(() => {
    refreshNotes()
    refreshGit()
    return window.cn.onFilesChanged(() => {
      refreshNotes()
      refreshGit()
    })
  }, [refreshNotes, refreshGit])

  useEffect(() => saveTabs(vault.path, tabs, active), [vault.path, tabs, active])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const setTabs = (f: (tabs: Tab[]) => Tab[], activate?: string | null) =>
    setTabState((s) => ({ tabs: f(s.tabs), active: activate === undefined ? s.active : activate }))

  const open = useCallback((match: (t: Tab) => boolean, make: () => Tab) => {
    setTabState((s) => {
      const found = s.tabs.find(match)
      if (found) return { ...s, active: found.id }
      const t = make()
      return { tabs: [...s.tabs, t], active: t.id }
    })
  }, [])

  const openNote = useCallback(
    (path: string, fresh = false) =>
      open(
        (t) => t.type === 'note' && t.path === path,
        () => ({ id: newId(), type: 'note', path, fresh }),
      ),
    [open],
  )
  const openHome = () => open((t) => t.type === 'home', () => ({ id: newId(), type: 'home' }))
  const openInbox = () => open((t) => t.type === 'inbox', () => ({ id: newId(), type: 'inbox' }))
  const openAll = () => open((t) => t.type === 'all', () => ({ id: newId(), type: 'all' }))
  const openArchive = () => open((t) => t.type === 'archive', () => ({ id: newId(), type: 'archive' }))
  const openTopic = (topic: string) =>
    open(
      (t) => t.type === 'topic' && t.topic === topic,
      () => ({ id: newId(), type: 'topic', topic }),
    )

  function closeTab(id: string) {
    setTabState((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const next = s.active === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.active
      return { tabs, active: next }
    })
  }

  const newNote = useCallback(async () => {
    try {
      const path = await window.cn.createNote('', '未命名', '# 未命名\n\n')
      refreshNotes()
      openNote(path, true)
    } catch (e) {
      setNotice(errText(e))
    }
  }, [openNote, refreshNotes])

  const newBoard = useCallback(async () => {
    try {
      const path = await window.cn.createBoard('', '未命名白板')
      refreshNotes()
      openNote(path, true)
    } catch (e) {
      setNotice(errText(e))
    }
  }, [openNote, refreshNotes])

  const openLink = useCallback(
    (target: string) => {
      const name = target.toLowerCase()
      const hit = notes.find((n) => titleOf(n.path).toLowerCase() === name || n.path.toLowerCase() === name + '.md')
      if (hit) openNote(hit.path)
      else setNotice(`库里没有叫「${target}」的笔记`)
    },
    [notes, openNote],
  )

  // 布局阶段就挂上：窗口一画出来 ⌘N、⌘K、⌘J、⌘, 就能用（useEffect 要等画完下一帧才挂，刚打开时按的会丢）
  useLayoutEffect(() => {
    const run = (key: string): boolean => {
      if (key === 'n') void newNote()
      else if (key === 'k' || key === 'f') setPaletteOpen((v) => !v)
      else if (key === 'j') toggleAi()
      else if (key === 'w' && active) closeTab(active)
      else if (key === ',') setSettingsPage((p) => (p ? null : 'look'))
      else if (key === '\\') setSidebarHidden((h) => !h)
      else return false
      return true
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.altKey && !e.ctrlKey && run(e.key)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    const offApp = window.cn.onAppKey((k) => void run(k))
    return () => {
      window.removeEventListener('keydown', onKey)
      offApp()
    }
  }, [newNote, active, right, aiFloat])

  function runAi(text: string) {
    setAiFloat(true)
    setAiAuto((a) => ({ text, seq: (a?.seq ?? 0) + 1 }))
  }

  async function renameFromSidebar(path: string, name: string) {
    try {
      await NoteDoc.saveAll()
      const p = await window.cn.renameNote(path, name)
      setTabs((x) => x.map((t) => (t.type === 'note' && t.path === path ? { ...t, path: p } : t)))
      refreshNotes()
      refreshGit()
    } catch (e) {
      setNotice(errText(e))
    }
  }

  async function trash(path: string) {
    try {
      await NoteDoc.saveAll()
      setTabState((s) => {
        const tabs = s.tabs.filter((t) => !(t.type === 'note' && t.path === path))
        return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : (tabs[tabs.length - 1]?.id ?? null) }
      })
      await window.cn.trashNote(path)
      setNotice(`「${titleOf(path)}」移到了废纸篓，在访达的废纸篓里能找回`)
      refreshNotes()
      refreshGit()
    } catch (e) {
      setNotice(errText(e))
    }
  }

  const pluginCommands = usePluginCommands()
  const commands: PaletteCommand[] = [
    { name: '新建笔记', icon: FilePlus, keys: '⌘N', run: () => void newNote() },
    { name: '新建白板', icon: LayoutGrid, run: () => void newBoard() },
    { name: '打开收件箱', icon: Inbox, run: () => openInbox() },
    { name: '全部笔记', hint: '按修改时间排，能筛选', icon: Files, run: () => openAll() },
    { name: '归档', hint: '很久没改过的，左栏不显示', icon: Archive, run: () => openArchive() },
    { name: '回到首页', icon: Home, run: () => openHome() },
    { name: '打开网页', hint: '右栏', icon: Globe, run: () => setRight('web') },
    { name: '打开梦游报告', hint: '右栏', icon: Moon, run: () => setRight('dream') },
    { name: '换主题…', hint: '设置 · 外观', icon: PaletteIcon, run: () => setSettingsPage('look') },
    { name: '编辑首页', icon: Home, run: () => (openHome(), setHomeEditSeq((n) => n + 1)) },
    { name: '设置', icon: SettingsIcon, keys: '⌘,', run: () => setSettingsPage('look') },
    { name: '看历史', hint: '每次提交改了哪些文件', icon: History, run: () => setRight('history') },
    { name: '现在提交', icon: GitCommitHorizontal, run: () => void commit() },
    { name: '同步', icon: RefreshCw, run: () => void sync() },
    { name: '问 AI', icon: Sparkles, keys: '⌘J', run: () => setAiFloat(true) },
    { name: '整理收件箱', hint: 'AI', icon: Sparkles, run: () => runAi('/整理收件箱') },
    { name: '总结这块白板', hint: 'AI', icon: Sparkles, run: () => runAi('/总结这块白板') },
    { name: '写成文章', hint: 'AI', icon: Sparkles, run: () => runAi('/写成文章') },
    { name: '找重复', hint: 'AI', icon: Sparkles, run: () => runAi('/找重复') },
    { name: '剪藏当前网页', hint: '整页进收件箱', icon: Sparkles, run: () => runAi('/剪藏当前网页') },
    { name: '现在梦游', hint: '不等夜里，现在整理一遍', icon: Moon, run: () => runAi('/现在梦游') },
    ...(update && update.phase !== 'off' ? [{ name: '检查更新', hint: '设置 · 更新', icon: CircleArrowUp, run: () => (setSettingsPage('update'), void window.cn.checkUpdate()) }] : []),
    ...pluginCommands,
  ]
  if (update?.phase === 'ready') commands.unshift({ name: '重启更新', hint: `新版本 ${update.version} 已下好`, icon: CircleArrowUp, run: () => void installUpdate() })

  async function commit() {
    try {
      const c = await window.cn.commit()
      setNotice(c ? `提交好了：${c.subject}` : '没有要提交的改动')
    } catch (e) {
      setNotice(errText(e))
    }
    refreshGit()
  }

  async function sync() {
    try {
      const r = await window.cn.sync()
      if (r.kind === 'no-remote') setNotice('这个库还没有远程仓库，同步不了。先用 git remote add 加一个。')
      else if (r.kind === 'conflict') setNotice('远程和本机改了同一处，已经退回同步前，本机的字都在。需要手动合并一次。')
      else
        setNotice(
          [r.committed ? '先提交了本机的改动' : '', r.pulled ? `拉下 ${r.pulled} 次提交` : '', r.pushed ? '推上去了' : '']
            .filter(Boolean)
            .join('，') || '已经是最新的',
        )
    } catch (e) {
      setNotice(errText(e))
    }
    refreshGit()
    refreshNotes()
    // 同步可能拉下来别处改过的首页
    void reloadHome()
  }

  async function switchVault() {
    try {
      await NoteDoc.saveAll()
      const v = await window.cn.chooseVault()
      if (v && v.path !== vault.path) {
        setSettingsPage(null)
        onSwitchVault(v)
      }
    } catch (e) {
      setNotice(errText(e))
    }
  }

  function toggleAi() {
    setAiFloat((v) => !v)
  }

  const activeTab = tabs.find((t) => t.id === active) ?? null
  // AI 动手时要的：现在看的是什么、编辑器、打开右栏网页
  const aiState = {
    tab: activeTab,
    mode: activeMode,
    doc: activeDoc.current,
    notes,
    webOpen: right === 'web',
    webUrl: (active && webUrl[active]) || null,
    openWeb: openInWeb,
  }
  useAiBridge(aiState)
  const clipMode: ClipMode =
    activeTab?.type === 'note' && activeMode !== 'board' ? { mode: 'doc', target: titleOf(activeTab.path) } : { mode: 'inbox' }

  async function clip(c: Clip) {
    const doc = activeDoc.current
    try {
      if (clipMode.mode === 'doc' && doc && !doc.readOnly) {
        doc.insertAtCursor(clipMarkdown(c.text, c.title, c.url))
        void window.cn.logActivity('clip', doc.path)
        setNotice(`插到「${clipMode.target}」光标处，带来源标题和链接`)
      } else {
        await window.cn.clipToInbox(c)
        setNotice('剪成卡片，放进收件箱了')
        refreshNotes()
        refreshGit()
      }
    } catch (e) {
      setNotice(errText(e))
    }
  }

  return (
    <div
      className={'win' + (sidebarHidden ? ' side-hidden' : '') + (right ? ' with-right' : '') + (right === 'web' ? ' web-open' : '') + (aiFloat && !right ? ' ai-float' : '') + (aiFloat ? ' ai-on' : '')}
      style={{ '--right-w': `${rightW}px` } as React.CSSProperties}
    >
      {right && (
        <div
          className="vsplit"
          role="separator"
          aria-label="拖动调整右栏宽度"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            document.body.classList.add('resizing')
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
            const w = Math.round(Math.min(window.innerWidth - 236 - 56 - 420, Math.max(340, window.innerWidth - 56 - e.clientX)))
            setRightW(w)
          }}
          onPointerUp={(e) => {
            document.body.classList.remove('resizing')
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
            try {
              localStorage.setItem('cn.rightW', String(rightW))
            } catch {
              // 记不住宽度不影响使用
            }
          }}
        />
      )}
      <button
        className="side-toggle iconbtn"
        aria-label={sidebarHidden ? '展开左栏' : '收起左栏'}
        aria-pressed={!sidebarHidden}
        title={(sidebarHidden ? '展开左栏' : '收起左栏') + ' · ⌘\\'}
        onClick={() => setSidebarHidden((h) => !h)}
      >
        <Icon of={sidebarHidden ? PanelLeftOpen : PanelLeftClose} size={16} />
      </button>
      {paletteOpen && (
        <Palette
          notes={notes}
          commands={commands}
          onOpen={(p) => openNote(p)}
          onUrl={openInWeb}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      <Sidebar
        vaultName={vault.name}
        notes={notes}
        active={activeTab}
        onOpenNote={(p) => openNote(p)}
        onOpenInbox={openInbox}
        onOpenHome={openHome}
        onOpenTopic={openTopic}
        onOpenAll={openAll}
        onOpenArchive={openArchive}
        pins={pins}
        archiveDays={settings.archiveDays}
        onTidy={() => runAi('/整理收件箱')}
        onPinsChanged={() => {
          refreshNotes()
          refreshGit()
        }}
        onNewNote={() => void newNote()}
        onNewBoard={() => void newBoard()}
        onSearch={() => setPaletteOpen(true)}
        onDream={() => setRight('dream')}
        dreamCount={pendingOf(dream.report)}
        onAppearance={() => setSettingsPage('look')}
        onSettings={() => setSettingsPage('look')}
        onVault={() => setSettingsPage('vault')}
        onRename={(p, n) => void renameFromSidebar(p, n)}
        onTrash={(p) => void trash(p)}
      />

      <main className="center">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <div key={t.id} className={'tab' + (t.id === active ? ' on' : '')} role="tab" aria-selected={t.id === active}>
              <button className="tl" onClick={() => setTabs((x) => x, t.id)}>
                {t.type === 'note' && notes.find((n) => n.path === t.path)?.board ? (
                  <i className="sw" style={{ background: notes.find((n) => n.path === t.path)!.board!.color }} />
                ) : (
                  <Icon
                    of={t.type === 'note' ? FileText : t.type === 'inbox' ? Inbox : t.type === 'home' ? Home : t.type === 'web' ? Globe : t.type === 'all' ? Files : t.type === 'archive' ? Archive : Folder}
                    size={14}
                  />
                )}
                <span className="truncate">
                  {t.type === 'note'
                    ? titleOf(t.path)
                    : t.type === 'inbox'
                      ? '收件箱'
                      : t.type === 'home'
                        ? '首页'
                        : t.type === 'web'
                          ? t.title || hostOf(t.url)
                          : t.type === 'all'
                            ? '全部笔记'
                            : t.type === 'archive'
                              ? '归档'
                              : t.topic}
                </span>
              </button>
              <button className="x" aria-label="关闭标签" onClick={() => closeTab(t.id)}>
                <Icon of={X} size={14} />
              </button>
            </div>
          ))}
        </div>

        {tabs.length === 0 && (
          <div className="empty">
            <p>从左边选一篇，或者</p>
            <button className="btn btn-primary" onClick={() => void newNote()}>
              <Icon of={FileText} size={14} />
              新建笔记
            </button>
          </div>
        )}

        {tabs.map((t) =>
          t.type === 'note' ? (
            <NoteTab
              key={t.id}
              path={t.path}
              active={t.id === active}
              fresh={!!t.fresh}
              notes={notes}
              rightOpen={right !== null || aiFloat}
              onDoc={(d) => (activeDoc.current = d)}
              onMode={setActiveMode}
              onOpenPath={(p, fresh) => {
                refreshNotes()
                openNote(p, fresh)
              }}
              onRenamed={(p) => {
                setTabs((x) => x.map((y) => (y.id === t.id ? { ...y, path: p, fresh: false } : y)))
                refreshNotes()
                refreshGit()
              }}
              onSaved={() => {
                refreshGit()
                refreshNotes()
              }}
              onNotice={setNotice}
              onOpenLink={openLink}
            />
          ) : t.type === 'web' ? (
            <WebTab
              key={t.id}
              url={t.url}
              active={t.id === active}
              onUrl={(url, title) => setTabs((x) => x.map((y) => (y.id === t.id && y.type === 'web' && (y.url !== url || y.title !== title) ? { ...y, url, title } : y)))}
              onClip={(c) => void clip(c)}
              onNotice={setNotice}
              onToRight={(url) => {
                closeTab(t.id)
                openInWeb(url)
              }}
              onClose={() => closeTab(t.id)}
            />
          ) : t.type === 'home' ? (
            t.id === active && (
              <HomeView
                key={t.id}
                style={settings.appearance.homeStyle}
                notes={notes}
                version={gitVersion}
                dream={dream.report}
                dreamRunning={dream.running}
                editSeq={homeEditSeq}
                onOpenDream={() => setRight('dream')}
                onDreamNow={dreamNow}
                onOpen={(p) => openNote(p)}
                onInbox={openInbox}
                onTidy={() => runAi('/整理收件箱')}
                onNewBoard={() => void newBoard()}
                onOpenWeb={() => setRight('web')}
                onChooseFolder={() => void switchVault()}
                onNotice={setNotice}
              />
            )
          ) : t.type === 'all' || t.type === 'archive' ? (
            t.id === active && (
              <NoteIndex
                key={t.id}
                which={t.type}
                notes={notes}
                pins={pins}
                archiveDays={settings.archiveDays}
                onOpen={(p) => openNote(p)}
                onRename={(p, n) => void renameFromSidebar(p, n)}
                onTrash={(p) => void trash(p)}
                onPinsChanged={() => {
                  refreshNotes()
                  refreshGit()
                }}
                onOpenSettings={() => setSettingsPage('vault')}
              />
            )
          ) : t.id === active ? (
            <ListView
              key={t.id}
              title={t.type === 'inbox' ? '收件箱' : t.topic}
              hint={t.type === 'inbox' ? '新东西先放这里，整理交给以后' : `${CLIPS} / ${t.topic}`}
              items={notes.filter((n) => (t.type === 'inbox' ? n.kind === 'inbox' : n.kind === 'clip' && n.topic === t.topic))}
              capture={t.type === 'inbox'}
              onOpen={(p) => openNote(p)}
              onCaptured={() => {
                refreshNotes()
                refreshGit()
              }}
              onNotice={setNotice}
            />
          ) : null,
        )}

        {/* 入口一直在；浮窗开着时加一圈强调色内描，再点收起 */}
        <button className={'ai-fab' + (aiFloat ? ' on' : '')} aria-label={aiFloat ? 'AI ⌘J' : '打开 AI'} aria-pressed={aiFloat} title="AI · ⌘J" onClick={toggleAi}>
          <Icon of={Sparkles} size={18} />
        </button>
        {/* 一直挂着、关上只是藏起来：正在生成的那一轮不断，再打开对话还在 */}
        <AiPanel
          open={aiFloat}
          tab={activeTab}
          mode={activeMode}
          doc={() => activeDoc.current}
          notes={notes}
          webUrl={aiState.webUrl}
          context={(mentions) => contextOf(aiState, mentions)}
          onClose={() => setAiFloat(false)}
          onOpen={(p) => openNote(p)}
          onShowHistory={() => setRight('history')}
          onShowDream={() => setRight('dream')}
          autoRun={aiAuto}
          onChanged={() => {
            refreshNotes()
            refreshGit()
          }}
        />
        {notice && (
          <div className="toast-cn" role="status">
            {notice}
          </div>
        )}
      </main>

      {right === 'dream' && (
        <DreamPanel
          report={dream.report}
          running={dream.running}
          onReport={dream.setReport}
          onClose={() => setRight(null)}
          onOpen={(p) => openNote(p)}
          onNotice={setNotice}
        />
      )}
      {historyOpen && <HistoryPanel version={gitVersion} onClose={() => setRight(null)} onOpen={(p) => openNote(p)} />}
      <WebPanel
        hidden={right !== 'web'}
        owner={active}
        clipMode={clipMode}
        openRequest={webOpen}
        onShow={() => setRight('web')}
        onUrl={(u) => active && setWebUrl((m) => (m[active] === (u ?? undefined) ? m : { ...m, [active]: u ?? '' }))}
        onClip={(c) => void clip(c)}
        onNotice={setNotice}
        onClose={() => setRight(null)}
        onOpenWide={(url, title) => open((t) => t.type === 'web' && t.url === url, () => ({ id: newId(), type: 'web', url, title }))}
        wideTabs={tabs.flatMap((t) => (t.type === 'web' ? [{ id: t.id, url: t.url, title: t.title }] : []))}
        onActivateWide={(id) => setTabs((x) => x, id)}
        onCloseWide={closeTab}
        onOpenNote={(p) => openNote(p)}
        onPluginSettings={() => setSettingsPage('plugins')}
      />

      <Rail right={right} dreamDot={pendingOf(dream.report) > 0} onToggle={toggleRight} />

      {settingsPage && (
        <Settings
          page={settingsPage}
          onPage={setSettingsPage}
          settings={settings}
          systemDark={systemDark}
          onChange={setSettings}
          vault={vault}
          onSwitchVault={() => void switchVault()}
          onSync={sync}
          onNotice={setNotice}
          onGitChanged={refreshGit}
          onClose={() => setSettingsPage(null)}
          updateReady={update?.phase === 'ready'}
          onInstallUpdate={installUpdate}
          onOpenUrl={(u) => (setSettingsPage(null), openInWeb(u))}
        />
      )}

      <GitBar
        vaultName={vault.name}
        git={git}
        historyOpen={historyOpen}
        onCommit={commit}
        onSync={sync}
        onToggleHistory={() => toggleRight('history')}
        onOpen={(p) => openNote(p)}
        right={<UpdateBarItem st={update} onInstall={installUpdate} onOpenSettings={() => setSettingsPage('update')} />}
      />
    </div>
  )
}

function Welcome({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="welcome">
      <h1>打开一个文件夹当库</h1>
      <p>笔记就是这个文件夹里的 md 文件；没有 Git 的话会帮你建一个。</p>
      <button className="btn btn-primary" onClick={onOpen}>
        <Icon of={FolderOpen} size={14} />
        打开文件夹
      </button>
    </div>
  )
}
