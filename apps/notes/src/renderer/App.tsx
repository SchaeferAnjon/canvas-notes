import { Codicon, type CodiconName } from '@cn/design'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Clip, GitState, NoteFile, VaultInfo } from '../shared/api'
import { CLIPS, clipMarkdown, titleOf } from '../shared/layout'
import { AiPanel } from './AiPanel'
import { EngineLogo } from './engine-logo'
import type { EngineId } from '../shared/agent'
import { contextOf, useAiBridge } from './ai-bridge'
import { DreamPanel } from './dream/DreamPanel'
import { PreviewOverlay, useDreamPreview } from './dream/preview'
import { pendingOf, useDream } from './dream/useDream'
import { ActivityBar, type BarItem, MenuItem, Popover, TitleBar, Tooltips } from './shell/Shell'
import { StatusBar } from './shell/StatusBar'
import { OutlineView } from './shell/OutlineView'
import { ActsSlot, noteRenamers } from './shell/TabActs'
import { revealLeft, tabEdges } from './shell/tab-scroll'
import { onFileMenu } from './ctx/file-menu'
import { setAppActions } from './ctx/actions'
import { copy, type MenuEntry, menuAt, setMenuNotice } from './ctx/menu'
import { reloadHome, resetHome } from './home-store'
import { HomeView } from './HomeView'
import { HistoryPanel } from './HistoryPanel'
import { UpdateBarItem, useUpdateState } from './update'
import { ListView } from './ListView'
import type { ViewMode } from './note-doc'
import { NoteIndex } from './NoteIndex'
import { NoteTab } from './NoteTab'
import { Sidebar, type SideView } from './Sidebar'
import { INBOX_WARN } from '../shared/sidebar'
import { NoteDoc } from './note-doc'
import { Palette, type PaletteCommand } from './Palette'
import { QuickOpen } from './search/QuickOpen'
import { fileOpened } from './files/store'
import { usePluginCommands } from './plugins'
import { setActiveFile } from './plugins/host'
import { Settings, type SettingsPage } from './Settings'
import { useAppSettings } from './theme'
import { loadTabs, newId, saveTabs, type Tab } from './tabs'
import { type ClipMode, hostOf, WebPanel } from './WebPanel'
import { WebTab } from './web/WebTab'
import { CaptureHost } from './mindmap/CaptureSheet'
import { openCapture } from './mindmap/capture-store'
import { ImportHost } from './importer/ImportSheet'
import { openImport } from './importer/store'
import { PdfTab } from './reading/PdfTab'
import { DoubtsTab } from './reading/DoubtsTab'
import { HtmlTab } from './reading/HtmlTab'
import { WebReadTab } from './reading/WebReadTab'
import { onOpenWebRead, onWebBox } from './reading/web-bridge'
import { type Lower, ReadingPanel } from './reading/ReadingPanel'
import * as Reading from './reading/store'
import type { PdfFile } from '../shared/reading'
import { defaultFolderHome, type FolderEntry, folderKind, foldersOfPaths, sortFolders } from '../shared/folder-home'
import { FolderHomeView } from './folder-home/FolderHomeView'
import { FolderMark } from './folder-home/icons'
import { onOpenFolderHome, openFolderHome } from './folder-home/store'
import { setCenter } from './video/store'
import { VideoToast } from './video/VideoToast'
import { VIDEO_FOLDER } from '../shared/video'
// 四条栏的骨架最后加载，盖过各组件自己的旧摆法
import './shell/shell.css'

type Right = 'web' | 'history' | 'outline' | null
const SIDE_VIEWS: SideView[] = ['files', 'recent', 'folders', 'inbox', 'dream']

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
  /** 打开设置的某一页：A 是中间一个标签（放到前面），B 是弹窗；⌘, 再按一次收起 */
  function openSettings(page: SettingsPage, toggle = false) {
    if (settings.appearance.frame === 'a') {
      if (toggle && settingsPage && settingsFront) return setSettingsPage(null)
      setSettingsFront(true)
      setSettingsPage(page)
    } else setSettingsPage((p) => (toggle && p ? null : page))
  }
  const [notes, setNotes] = useState<NoteFile[]>([])
  /** 置顶的笔记（库里 .canvas-notes/置顶.json） */
  const [pins, setPins] = useState<string[]>([])
  const [{ tabs, active }, setTabState] = useState(() => {
    const t = loadTabs(vault.path)
    if (t.tabs.length) return t
    const home: Tab = { id: newId(), type: 'home' }
    return { tabs: [home], active: home.id }
  })
  /** AI 只浮在中间栏右下角（⌘J 开关），不进右栏；读 PDF 时例外，AI 在右栏下格 */
  const [aiFloat, setAiFloat] = useState(false)
  /** 读 PDF 时右栏下格开着 AI 还是笔记（竖条上面那组），记在本机 */
  const [lower, setLowerState] = useState<Lower | null>(() => {
    try {
      const v = localStorage.getItem('cn.readingLower')
      return v === 'none' ? null : v === 'notes' ? 'notes' : 'ai'
    } catch {
      return 'ai'
    }
  })
  const setLower = (l: Lower | null) => {
    setLowerState(l)
    try {
      localStorage.setItem('cn.readingLower', l ?? 'none')
    } catch {
      // 记不住不影响使用
    }
  }
  /** 库里的 PDF（⌘K 里能搜到、能打开） */
  const [pdfs, setPdfs] = useState<PdfFile[]>([])
  /** 有首页的文件夹：左栏「文件夹」、标签图标 */
  const [folders, setFolders] = useState<FolderEntry[]>([])
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
  /** 左边图标栏选中的那一页，记在本机；默认「最近」 */
  const [leftView, setLeftViewState] = useState<SideView>(() => {
    try {
      const v = localStorage.getItem('cn.leftView') as SideView | null
      return v && SIDE_VIEWS.includes(v) ? v : 'recent'
    } catch {
      return 'recent'
    }
  })
  const openLeft = (v: SideView) => {
    setLeftViewState(v)
    setSidebarHidden(false)
    try {
      localStorage.setItem('cn.leftView', v)
    } catch {
      // 记不住不影响使用
    }
  }
  /** 图标栏上点亮着的那个 = 收起左栏 */
  const toggleLeft = (v: SideView) => (!sidebarHidden && leftView === v ? setSidebarHidden(true) : openLeft(v))
  /** 库菜单、设置菜单（左下角）：贴着点它的按钮弹出 */
  const [menu, setMenu] = useState<{ kind: 'vault' | 'gear'; el: HTMLElement } | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  /** 标签条右端：每页自己的动作挂在这里（shell/TabActs） */
  const [actsEl, setActsEl] = useState<HTMLDivElement | null>(null)
  /** 正在标签上改名的那个标签（双击标签、F2、面包屑最后一节、「更多 › 改名」） */
  const [renaming, setRenaming] = useState<string | null>(null)
  /** AI 用的是哪个引擎（A 的底栏 AI 项写它的名字） */
  const [aiEngine, setAiEngine] = useState('Claude Code')
  const [aiEngineId, setAiEngineId] = useState<EngineId>('claude')
  /** 方向 A：设置开成中间的一个标签，这个标签在前面时为 true */
  const [settingsFront, setSettingsFront] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** 提示后面带的「撤回」：只跟着那一句（别处换了提示就不显示） */
  const [noticeUndo, setNoticeUndo] = useState<{ text: string; run(): void } | null>(null)
  const noticeWithUndo = (text: string, run?: () => void) => {
    setNotice(text)
    setNoticeUndo(run ? { text, run } : null)
  }
  /** 右键「问 AI」放进输入框的引文 */
  const [aiDraft, setAiDraft] = useState<{ text: string; seq: number } | null>(null)
  const [right, setRight] = useState<Right>(null)
  const historyOpen = right === 'history'
  const toggleRight = (r: Exclude<Right, null>) => setRight((v) => (v === r ? null : r))
  const lastRight = useRef<Exclude<Right, null>>('outline')
  useEffect(() => {
    if (right) lastRight.current = right
  }, [right])
  /** 每个标签记住自己开着的网页 */
  const [webUrl, setWebUrl] = useState<Record<string, string>>({})
  const [activeMode, setActiveMode] = useState<ViewMode>('doc')
  const [gitVersion, setGitVersion] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** ⌘O 按名字跳 */
  const [quickOpen, setQuickOpen] = useState(false)
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
  useEffect(() => window.cn.onUpdateOpen(() => openSettings('update')), [])
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
      return Number(localStorage.getItem('cn.rightW')) || 340
    } catch {
      return 340
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
    // 列表没变就不换（免得整个书桌跟着重画）
    void window.cnReading.listPdfs().then((next) => setPdfs((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next)))
    void window.cnFolder.list().then((next) => setFolders((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next)))
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
  // 换了标签（点标签、从左栏开一篇）：设置标签退到后面
  useEffect(() => setSettingsFront(false), [active])

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
  const openPdf = useCallback(
    (path: string) =>
      open(
        (t) => t.type === 'pdf' && t.path === path,
        () => ({ id: newId(), type: 'pdf', path }),
      ),
    [open],
  )
  const openDoubts = useCallback(
    (folder: string) =>
      open(
        (t) => t.type === 'doubts' && t.folder === folder,
        () => ({ id: newId(), type: 'doubts', folder }),
      ),
    [open],
  )
  const openHtml = useCallback(
    (path: string) =>
      open(
        (t) => t.type === 'html' && t.path === path && !t.dream,
        () => ({ id: newId(), type: 'html', path }),
      ),
    [open],
  )
  // 右栏网页「在中间栏左右对照读」：开成阅读视图标签
  useEffect(
    () =>
      onOpenWebRead((p) =>
        open(
          (t) => t.type === 'webread' && t.url === p.url,
          () => ({ id: newId(), type: 'webread', url: p.url, title: p.title }),
        ),
      ),
    [open],
  )
  /** 打开 PDF 翻到那一页、那一块闪一下（我的疑惑、Anki 卡上的「打开原文」） */
  const openPdfAt = useCallback(
    (path: string, page: number, rect?: [number, number, number, number]) => {
      openPdf(path)
      // PDF 标签刚开时页面还没量好；等它画出来再跳
      setTimeout(() => Reading.jumpTo(path, page, rect), 300)
    },
    [openPdf],
  )
  useEffect(() => window.cnReading.onOpenAt((a) => openPdfAt(a.file, a.page, a.rect)), [openPdfAt])
  const openFolder = useCallback(
    (folder: string, fresh = false) =>
      open(
        (t) => t.type === 'folder' && t.folder === folder,
        () => ({ id: newId(), type: 'folder', folder, fresh }),
      ),
    [open],
  )
  // 左栏、目录树、⌘K 都调 openFolderHome('课程/线性代数')
  useEffect(() => onOpenFolderHome((f) => openFolder(f)), [openFolder])
  /** 左栏「文件夹」的 +：建 课程/新的课程，开它的首页进编辑，标题能改 */
  async function newCourse() {
    try {
      const f = await window.cnFolder.create('课程/新的课程')
      refreshNotes()
      openFolder(f, true)
      const r = await window.cnFolder.get(f)
      setNotice(`建了 ${f} · 首页用的是「${r.template ? '课程模板' : '默认课程首页'}」`)
    } catch (e) {
      setNotice(errText(e))
    }
  }
  /** 按文件类型开成对的标签：PDF、HTML、md（搜索、⌘O、目录树用） */
  const openFile = useCallback((path: string) => (/\.pdf$/i.test(path) ? openPdf(path) : /\.html?$/i.test(path) ? openHtml(path) : openNote(path)), [openPdf, openHtml, openNote])
  const openHome = () => open((t) => t.type === 'home', () => ({ id: newId(), type: 'home' }))
  const openInbox = () => open((t) => t.type === 'inbox', () => ({ id: newId(), type: 'inbox' }))
  const openAll = () => open((t) => t.type === 'all', () => ({ id: newId(), type: 'all' }))
  const openArchive = () => open((t) => t.type === 'archive', () => ({ id: newId(), type: 'archive' }))
  const openTopic = (topic: string) =>
    open(
      (t) => t.type === 'topic' && t.topic === topic,
      () => ({ id: newId(), type: 'topic', topic }),
    )

  /** 标签右键（DESIGN.v3 9.2）：关闭这几种、改名、在访达中显示、拷贝路径、网页移到右栏 */
  function tabMenu(t: Tab): MenuEntry[] {
    const i = tabs.findIndex((x) => x.id === t.id)
    const path = 'path' in t ? t.path : null
    return [
      { label: '关闭', accel: 'CommandOrControl+W', run: () => closeTab(t.id) },
      { label: '关闭其他', enabled: tabs.length > 1, run: () => setTabState({ tabs: tabs.filter((x) => x.id === t.id), active: t.id }) },
      { label: '关闭右侧', enabled: i < tabs.length - 1, run: () => setTabState((s) => ({ tabs: s.tabs.slice(0, i + 1), active: s.tabs.slice(0, i + 1).some((x) => x.id === s.active) ? s.active : t.id })) },
      { label: '关闭全部', run: () => setTabState({ tabs: [], active: null }) },
      '-',
      t.type === 'note' && { label: '重命名', accel: 'F2', run: () => setRenaming(t.id) },
      path && { label: '在访达中显示', run: () => window.cnMenu.reveal(path) },
      path && { label: '拷贝路径', run: () => copy(vault.path + '/' + path) },
      t.type === 'web' && { label: '移到右栏', run: () => (closeTab(t.id), openInWeb(t.url)) },
    ]
  }

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
      const pdf = pdfs.find((p) => p.path.toLowerCase() === name || p.path.split('/').pop()!.toLowerCase() === name)
      if (hit) openNote(hit.path)
      else if (pdf) openPdf(pdf.path)
      else setNotice(`库里没有叫「${target}」的笔记`)
    },
    [notes, pdfs, openNote, openPdf],
  )

  const activeTab = tabs.find((t) => t.id === active) ?? null
  // 刚新建的笔记：标签上直接改名；fresh 只用一次
  useEffect(() => {
    if (activeTab?.type !== 'note' || !activeTab.fresh) return
    setRenaming(activeTab.id)
    setTabs((x) => x.map((t) => (t.id === activeTab.id && t.type === 'note' ? { ...t, fresh: false } : t)))
  }, [activeTab])
  /** 标签上改名：笔记交给 NoteTab 登记的改名（顺手改开头的 # 标题、别处的 [[旧名]]） */
  async function renameTab(id: string, name: string) {
    setRenaming(null)
    const t = tabs.find((x) => x.id === id)
    if (t?.type !== 'note' || !name.trim() || name.trim() === titleOf(t.path)) return
    await noteRenamers.get(id)?.(name)
  }
  /** 中间显示的是哪个标签：A 的设置标签在前面时谁都不显示 */
  const settingsTab = settings.appearance.frame === 'a' && settingsPage !== null
  const shown = settingsTab && settingsFront ? null : active
  /**
   * 标签多了横着滚（照 VS Code）：换了当前标签就把它整个滚进来；标签条宽度变了（右端动作区换了内容、
   * 比如页面说明晚一步出来把标签条挤窄、窗口变窄）也再滚一次。能滚的那一侧画渐隐（.fl / .fr）。
   */
  const tlistRef = useRef<HTMLDivElement>(null)
  const [tabFade, setTabFade] = useState({ left: false, right: false })
  const syncTabs = useCallback(() => {
    const el = tlistRef.current
    if (!el) return
    const tab = el.querySelector<HTMLElement>('.tab.on')
    if (tab) {
      const tabLeft = tab.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
      const next = revealLeft(el.scrollLeft, el.clientWidth, el.scrollWidth, tabLeft, tab.offsetWidth)
      if (next !== Math.round(el.scrollLeft)) el.scrollLeft = next
    }
    const e = tabEdges(el.scrollLeft, el.scrollWidth, el.clientWidth)
    setTabFade((f) => (f.left === e.left && f.right === e.right ? f : e))
  }, [])
  useLayoutEffect(syncTabs, [shown, settingsFront, tabs.length, syncTabs])
  useEffect(() => {
    const el = tlistRef.current
    if (!el) return
    const ro = new ResizeObserver(syncTabs)
    ro.observe(el)
    const onScroll = () => {
      const e = tabEdges(el.scrollLeft, el.scrollWidth, el.clientWidth)
      setTabFade((f) => (f.left === e.left && f.right === e.right ? f : e))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => (ro.disconnect(), el.removeEventListener('scroll', onScroll))
  }, [syncTabs])
  /** 中间窄于 640 时 B 的标签条右端动作只留图标，把位置让给标签 */
  const centerRef = useRef<HTMLElement>(null)
  const [centerNarrow, setCenterNarrow] = useState(false)
  /** 中间窄于 900 时页面说明最宽 140 */
  const [centerCompact, setCenterCompact] = useState(false)
  useEffect(() => {
    const el = centerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => (setCenterNarrow(el.clientWidth < 640), setCenterCompact(el.clientWidth < 900)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /** 标题栏的后退 / 前进：走过的标签，最多记 50 个；关掉的标签跳过 */
  const nav = useRef<{ list: string[]; i: number; jumping: boolean }>({ list: [], i: -1, jumping: false })
  const [, bumpNav] = useState(0)
  useEffect(() => {
    const n = nav.current
    if (!active) return
    if (n.jumping) return void (n.jumping = false)
    if (n.list[n.i] === active) return
    n.list = [...n.list.slice(0, n.i + 1), active].slice(-50)
    n.i = n.list.length - 1
    bumpNav((x) => x + 1)
  }, [active])
  const navTo = (d: -1 | 1) => {
    const n = nav.current
    let j = n.i + d
    while (j >= 0 && j < n.list.length && !tabs.some((t) => t.id === n.list[j])) j += d
    if (j < 0 || j >= n.list.length) return
    n.i = j
    n.jumping = true
    setTabs((x) => x, n.list[j])
    bumpNav((x) => x + 1)
  }
  // 最近打开（⌘O 空着时列出来；文件夹首页记文件夹）
  const activePath = activeTab?.type === 'folder' ? activeTab.folder : activeTab && 'path' in activeTab ? activeTab.path : null
  useEffect(() => {
    if (activePath) fileOpened(activePath)
  }, [activePath])
  /** 中间栏开着的 PDF 或库里的 HTML：右栏下格是它的 AI 或笔记，AI 不浮在右下角 */
  const readingDoc = activeTab?.type === 'pdf' || (activeTab?.type === 'html' && !activeTab.dream) ? activeTab.path : null
  /** 右栏网页上框着问、中间栏没开 PDF / HTML 时：右栏下格 AI 的来源是「web:<网址>」，笔记记到中间开着的文档或收件箱 */
  const [webAsk, setWebAsk] = useState<string | null>(null)
  const readingPdf = readingDoc ?? (right === 'web' ? webAsk : null)
  /** ⌘K「我的疑惑」开哪个文件夹：正在读的 PDF 的，没有就最近打开过的 PDF 的 */
  const lastPdf = readingPdf ?? tabs.flatMap((t) => (t.type === 'pdf' ? [t.path] : [])).pop() ?? null
  const doubtsFolder = lastPdf === null ? null : dirOfPath(lastPdf)
  const lowerOpen = readingPdf ? lower : null
  const reading = Reading.useReading(readingPdf)

  // 布局阶段就挂上：窗口一画出来 ⌘N、⌘K、⌘J、⌘, 就能用（useEffect 要等画完下一帧才挂，刚打开时按的会丢）
  useLayoutEffect(() => {
    const run = (key: string): boolean => {
      if (key === 'n') void newNote()
      else if (key === 'k' || key === 'f') (setQuickOpen(false), setPaletteOpen((v) => !v))
      else if (key === 'o') (setPaletteOpen(false), setQuickOpen((v) => !v))
      else if (key === 'j') toggleAi()
      else if (key === 'w' && active) closeTab(active)
      else if (key === ',') openSettings('look', true)
      else if (key === '\\') setSidebarHidden((h) => !h)
      else return false
      return true
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.altKey && !e.ctrlKey && run(e.key)) e.preventDefault()
      // F2：改当前笔记的名字（焦点在输入框里时不抢）
      else if (e.key === 'F2' && activeTab?.type === 'note' && !(e.target as HTMLElement).closest?.('input, textarea')) {
        e.preventDefault()
        setRenaming(activeTab.id)
      }
    }
    window.addEventListener('keydown', onKey)
    const offApp = window.cn.onAppKey((k) => void run(k))
    return () => {
      window.removeEventListener('keydown', onKey)
      offApp()
    }
  }, [newNote, active, activeTab, right, aiFloat, readingPdf, lower, settingsPage, settingsFront, settings.appearance.frame])

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
        // 文档、PDF、HTML 开着的标签一起关
        const tabs = s.tabs.filter((t) => !('path' in t && t.path === path))
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
    { name: '新建笔记', icon: 'new-file', keys: '⌘N', run: () => void newNote() },
    { name: '新建白板', icon: 'layout', run: () => void newBoard() },
    { name: '按名字跳到…', hint: '库里的笔记、PDF、HTML', icon: 'go-to-file', keys: '⌘O', run: () => setQuickOpen(true) },
    { name: '拍一张导图', hint: '拍手写的导图，认成白板导图', icon: 'device-camera', keys: '⇧⌘C', run: () => openCapture() },
    { name: '打开收件箱', icon: 'inbox', run: () => openInbox() },
    { name: '全部笔记', hint: '按修改时间排，能筛选', icon: 'files', run: () => openAll() },
    { name: '归档', hint: '很久没改过的，左栏不显示', icon: 'archive', run: () => openArchive() },
    { name: '回到首页', icon: 'home', run: () => openHome() },
    { name: '打开网页', hint: '右栏', icon: 'globe', run: () => setRight('web') },
    { name: '打开梦游报告', hint: '左栏', icon: 'wand', run: () => openLeft('dream') },
    { name: '换主题…', hint: '设置 · 外观', icon: 'symbol-color', run: () => openSettings('look') },
    { name: '编辑首页', icon: 'home', run: () => (openHome(), setHomeEditSeq((n) => n + 1)) },
    ...folders.map((f) => ({ name: `${f.folder.split('/').pop()} 首页`, hint: f.folder, icon: 'folder' as const, run: () => openFolder(f.folder) })),
    { name: '新建一门课', hint: '课程/新的课程，首页用课程模板', icon: 'folder', run: () => void newCourse() },
    { name: '导入旧笔记…', hint: '备忘录或 Markdown 文件夹，先进收件箱', icon: 'root-folder', run: () => openImport() },
    { name: '设置', icon: 'settings-gear', keys: '⌘,', run: () => openSettings('look') },
    { name: '看历史', hint: '每次提交改了哪些文件', icon: 'history', run: () => setRight('history') },
    { name: '现在提交', icon: 'git-commit', run: () => void commit() },
    { name: '同步', icon: 'refresh', run: () => void sync() },
    { name: '问 AI', icon: 'sparkle', keys: '⌘J', run: () => setAiFloat(true) },
    ...(doubtsFolder !== null ? [{ name: '我的疑惑', hint: doubtsFolder || '库的根目录', icon: 'question' as const, run: () => openDoubts(doubtsFolder) }] : []),
    { name: '整理收件箱', hint: 'AI', icon: 'sparkle', run: () => runAi('/整理收件箱') },
    { name: '总结这块白板', hint: 'AI', icon: 'sparkle', run: () => runAi('/总结这块白板') },
    { name: '写成文章', hint: 'AI', icon: 'sparkle', run: () => runAi('/写成文章') },
    { name: '找重复', hint: 'AI', icon: 'sparkle', run: () => runAi('/找重复') },
    { name: '剪藏当前网页', hint: '整页进收件箱', icon: 'sparkle', run: () => runAi('/剪藏当前网页') },
    { name: '现在梦游', hint: '不等夜里，现在整理一遍', icon: 'wand', run: () => runAi('/现在梦游') },
    ...(update && update.phase !== 'off' ? [{ name: '检查更新', hint: '设置 · 更新', icon: 'arrow-circle-up' as const, run: () => (openSettings('update'), void window.cn.checkUpdate()) }] : []),
    ...pluginCommands,
  ]
  if (update?.phase === 'ready') commands.unshift({ name: '重启更新', hint: `新版本 ${update.version} 已下好`, icon: 'arrow-circle-up', run: () => void installUpdate() })

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

  // 右栏网页上按住 ⌘ 框好一块：截下来放进右栏 AI 的输入框（中间开着 PDF / HTML 就进它的 AI，不然进网页的）；工具条上的按钮直接问
  const webBoxDoc = useRef(readingDoc)
  webBoxDoc.current = readingDoc
  useEffect(
    () =>
      onWebBox(async (e) => {
        const doc = webBoxDoc.current
        if (e.action === 'cancel') {
          const src = doc ?? (e.box ? `web:${e.box.url}` : null)
          if (src && Reading.get(src).pending?.web) Reading.unstage(src)
          return
        }
        if (!e.box) return
        const src = doc ?? `web:${e.box.url}`
        try {
          // 先截图再开 AI：右栏下格一开，网页就变矮了
          const shot = e.action === 'stage' || !Reading.get(src).pending?.web ? await window.cnReading.capture(e.wcId, e.box.rect) : null
          if (!doc) setWebAsk(src)
          setLower('ai')
          await Reading.load(src)
          if (shot) {
            const png = shot
            const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }))
            const page = doc && /\.pdf$/i.test(doc) ? Reading.get(doc).state.page : 0
            Reading.stage(src, { page, url, png, web: { url: e.box.url, title: e.box.title || e.box.url, text: e.box.text } })
          }
          if (e.action === 'explain') await Reading.send(src, '给我讲解一下')
          else if (e.action === 'translate') await Reading.send(src, '先把这块翻译成中文，再讲一讲')
          else if (e.action === 'rephrase') Reading.stage(src, { ...Reading.get(src).pending!, blank: true })
        } catch (err) {
          setNotice(errText(err))
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function toggleAi() {
    if (readingPdf) setLower(lower === 'ai' ? null : 'ai')
    else setAiFloat((v) => !v)
  }

  /** 梦游预览：左栏、全部笔记换成归类和改名以后的样子 */
  const pv = useDreamPreview(dream, notes, setNotice)
  // 点了「预览」：左栏换到「文件」页，看改好以后的目录（spec 第 5 节）
  useEffect(() => {
    if (pv.on) openLeft('files')
  }, [pv.on])
  // 预览时梦游挪进新课程、新项目：左栏「文件夹」先多一行，标「新」
  const sideFolders: (FolderEntry & { fresh?: boolean })[] = !pv.on
    ? folders
    : sortFolders([
        ...folders,
        ...foldersOfPaths(pv.moves.map((m) => m.to))
          .filter((f) => !folders.some((x) => x.folder === f))
          .map((f) => {
            const kind = folderKind(f)!
            return { folder: f, kind, icon: defaultFolderHome(kind).icon, color: null, fresh: true }
          }),
      ])
  const folderOf = (f: string) => folders.find((x) => x.folder === f) ?? { icon: defaultFolderHome(folderKind(f) ?? 'course').icon, color: null }
  const tabIcon = (t: Tab) => {
    if (t.type === 'folder') return <FolderMark f={folderOf(t.folder)} size={15} />
    const board = t.type === 'note' ? notes.find((n) => n.path === t.path)?.board : null
    if (board) return <i className="sw" style={{ background: board.color }} />
    return <Codicon name={TAB_ICON[t.type]} size={15} />
  }
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
  // 插件要知道中间栏开着哪个文件（双语翻译照那门课的术语表翻）
  const activeFile = activeTab && 'path' in activeTab ? activeTab.path : null
  useEffect(() => setActiveFile(activeFile), [activeFile])
  // 视频条「记到哪」：中间栏开着什么、上一篇开着的文档
  const lastDoc = useRef<{ path: string; title: string } | null>(null)
  useEffect(() => {
    const path = activeTab?.type === 'note' ? activeTab.path : null
    const kind = !path ? 'none' : activeMode === 'board' ? 'board' : path.startsWith(VIDEO_FOLDER + '/') ? 'material' : 'doc'
    const center = path && kind !== 'none' ? { kind, path, title: titleOf(path) } : { kind: 'none' as const }
    const prev = lastDoc.current
    if (kind === 'doc' && path) lastDoc.current = { path, title: titleOf(path) }
    setCenter({
      center: center as Parameters<typeof setCenter>[0]['center'],
      lastDoc: kind === 'material' ? prev : lastDoc.current,
      doc: () => activeDoc.current,
      aiOpen: aiFloat,
      openAi: () => setAiFloat(true),
      notice: setNotice,
      refresh: () => {
        refreshNotes()
        refreshGit()
      },
    })
  }, [activeTab, activeMode, aiFloat, refreshNotes, refreshGit])
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

  // 右键菜单要用的整个软件的动作（ctx/actions.ts）：每次渲染都换成最新的
  const openWide = (url: string, title?: string) => open((t) => t.type === 'web' && t.url === url, () => ({ id: newId(), type: 'web', url, title }))
  /** 当前标签换成这一篇（右键「打开」）；它已经开在别的标签就切过去 */
  const openHere = (path: string) => {
    if (!/\.md$/i.test(path)) return openFile(path)
    setTabState((s) => {
      const there = s.tabs.find((t) => t.type === 'note' && t.path === path)
      if (there) return { ...s, active: there.id }
      const i = s.tabs.findIndex((t) => t.id === s.active)
      const t: Tab = { id: newId(), type: 'note', path }
      if (i === -1 || s.tabs[i]!.type !== 'note') return { tabs: [...s.tabs, t], active: t.id }
      return { tabs: s.tabs.map((x, j) => (j === i ? t : x)), active: t.id }
    })
  }
  setMenuNotice(setNotice)
  setAppActions({
    openFile,
    openHere,
    openWikilink(target, here) {
      const name = target.toLowerCase()
      const hit = notes.find((n) => titleOf(n.path).toLowerCase() === name || n.path.toLowerCase() === name + '.md')
      if (hit && here) openHere(hit.path)
      else openLink(target)
    },
    openReading(path) {
      openFile(path)
      setLower('ai')
    },
    openInWeb,
    openWide,
    askAi(text) {
      if (readingDoc) {
        // 读 PDF / HTML 时 AI 在右栏下格：引文放进那边的输入框
        setLower('ai')
        Reading.stage(readingDoc, { page: Reading.get(readingDoc).state.page ?? 1, quote: text.slice(0, 2000), blank: true })
        return
      }
      setWebAsk(null)
      setAiFloat(true)
      setAiDraft((d) => ({ text, seq: (d?.seq ?? 0) + 1 }))
    },
    notice: (t) => noticeWithUndo(t),
    doc: () => (clipMode.mode === 'doc' && activeDoc.current && !activeDoc.current.readOnly ? activeDoc.current : null),
    async clip(c, to) {
      const doc = activeDoc.current
      if (to === 'doc' && clipMode.mode === 'doc' && doc && !doc.readOnly) {
        doc.insertAtCursor(clipMarkdown(c.text, c.title, c.url))
        void window.cn.logActivity('clip', doc.path)
        setNotice(`插到「${clipMode.target}」光标处，带来源标题和链接`)
        return
      }
      await window.cn.clipToInbox(c)
      setNotice('剪成卡片，放进收件箱了')
      refreshNotes()
      refreshGit()
    },
    refresh: () => (refreshNotes(), refreshGit()),
    async newNote(folder) {
      const path = await window.cn.createNote(folder, '未命名', '# 未命名\n\n')
      refreshNotes()
      openNote(path, true)
    },
    async newBoard(folder) {
      const path = await window.cn.createBoard(folder, '未命名白板')
      refreshNotes()
      openNote(path, true)
    },
    trash,
    async togglePin(path, on) {
      await window.cnMenu.pin(path, on)
      refreshNotes()
      refreshGit()
    },
    pins: () => pins,
    folders: () => {
      const all = new Set<string>()
      for (const p of [...notes.map((n) => n.path), ...pdfs.map((x) => x.path)]) if (p.includes('/')) all.add(p.slice(0, p.indexOf('/')))
      for (const f of folders) all.add(f.folder)
      return [...all].sort((a, b) => a.localeCompare(b, 'zh')).slice(0, 30)
    },
    hasFolderHome: (f) => folders.some((x) => x.folder === f),
    async moveNote(path, folder) {
      await NoteDoc.saveAll()
      const to = await window.cnMenu.moveNote(path, folder)
      setTabs((x) => x.map((t) => (t.type === 'note' && t.path === path ? { ...t, path: to } : t)))
      setNotice(`「${titleOf(path)}」挪到了 ${folder || '库的最外层'}`)
      refreshNotes()
      refreshGit()
    },
    absPath: (rel) => vault.path + '/' + rel,
    openFolderHome: (f) => openFolder(f),
  })
  const frame = settings.appearance.frame
  // 梦游预览时数的是改好以后的收件箱
  const inboxCount = (pv.on ? pv.preview.notes : notes).filter((n) => n.kind === 'inbox').length
  /** 标题栏最右的按钮：右栏开着就全收起；关着就开回上次那页（没有就开大纲） */
  const toggleRightBar = () => {
    if (right || lowerOpen) {
      setRight(null)
      if (readingPdf) setLower(null)
    } else setRight(lastRight.current)
  }
  const rightOpen = right !== null || !!lowerOpen
  const aiOn = readingPdf ? lowerOpen === 'ai' : aiFloat
  const aiLabel = readingPdf ? 'AI 在右栏（读 PDF 时）' : 'AI'
  const noOutline = !activeTab || !['note', 'pdf'].includes(activeTab.type)
  const leftItems: BarItem[] = [
    { id: 'files', label: '文件', key: '⇧⌘E', icon: 'files' },
    { id: 'recent', label: '最近', key: '⇧⌘R', icon: 'clockface' },
    { id: 'folders', label: '课程和文件夹首页', icon: 'folder-library' },
    { id: 'inbox', label: '收件箱', icon: 'inbox', badge: inboxCount, warn: inboxCount > INBOX_WARN },
    { id: 'dream', label: '梦游报告', icon: 'wand', dot: pendingOf(dream.report) > 0 },
  ].map((it) => ({ ...it, icon: it.icon as BarItem['icon'], on: !sidebarHidden && leftView === it.id, onClick: () => toggleLeft(it.id as SideView) }))
  const readingItems: BarItem[] = readingPdf
    ? [
        { id: 'ai', label: 'AI', key: '⌘J', icon: 'sparkle' as const, on: lowerOpen === 'ai', onClick: () => setLower(lower === 'ai' ? null : 'ai') },
        ...(Reading.isWebSrc(readingPdf) ? [] : [{ id: 'notes', label: '笔记', key: undefined, icon: 'note' as const, on: lowerOpen === 'notes', dot: !!reading?.fresh && lowerOpen !== 'notes', onClick: () => setLower(lower === 'notes' ? null : 'notes') }]),
      ]
    : []
  const rightItems: BarItem[] = [
    { id: 'outline', label: noOutline ? '大纲 · 这一页没有大纲' : '大纲', icon: 'list-tree' as const, dim: noOutline, on: right === 'outline', onClick: () => toggleRight('outline') },
    { id: 'web', label: '网页', icon: 'globe' as const, on: right === 'web', onClick: () => toggleRight('web') },
    { id: 'history', label: '历史', icon: 'history' as const, on: right === 'history', onClick: () => toggleRight('history') },
  ]
  const aiCorner =
    frame === 'a' ? (
      <button className={'bi ai-corner' + (aiOn ? ' on' : '')} aria-label={aiFloat && !readingPdf ? 'AI ⌘J' : '打开 AI'} aria-pressed={aiOn} data-tip={aiLabel} data-key="⌘J" data-side="above-left" onClick={toggleAi}>
        <EngineLogo id={aiEngineId} size={14} />
        {aiEngine}
      </button>
    ) : (
      <button className={'ai-fab' + (aiOn ? ' on' : '')} aria-label={aiFloat && !readingPdf ? 'AI ⌘J' : '打开 AI'} aria-pressed={aiOn} data-tip={aiLabel} data-key="⌘J" data-side="left" onClick={toggleAi}>
        <Codicon name="sparkle" size={18} />
      </button>
    )

  return (
    <div
      className={
        'win frame-' + frame +
        (sidebarHidden ? ' side-hidden' : '') +
        (rightOpen ? ' with-right' : '') +
        (right && lowerOpen ? ' rsplit' : '') +
        (right === 'web' ? ' web-open' : '') +
        (pv.on ? ' previewing' : '') +
        (aiFloat && !right && !readingPdf ? ' ai-float' : '') +
        (aiFloat && !readingPdf ? ' ai-on' : '')
      }
      style={{ '--right-w': `${rightW}px` } as React.CSSProperties}
    >
      {rightOpen && (
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
            const abar = frame === 'a' ? 48 : 44
            const w = Math.round(Math.min(window.innerWidth - 2 * abar - 236 - 420, Math.max(300, window.innerWidth - abar - e.clientX)))
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
      <Tooltips />
      <TitleBar
        leftOpen={!sidebarHidden}
        rightOpen={rightOpen}
        canBack={nav.current.i > 0}
        canForward={nav.current.i < nav.current.list.length - 1}
        location={frame === 'b' && activeTab ? locationOf(activeTab).join(' / ') : null}
        vaultName={vault.name}
        onToggleLeft={() => setSidebarHidden((h) => !h)}
        onToggleRight={toggleRightBar}
        onBack={() => navTo(-1)}
        onForward={() => navTo(1)}
        onHome={openHome}
        onSearch={() => (setQuickOpen(false), setPaletteOpen(true))}
      />
      {quickOpen && <QuickOpen onOpen={openFile} onOpenFolder={openFolderHome} onClose={() => setQuickOpen(false)} />}
      {paletteOpen && (
        <Palette
          notes={notes}
          pdfs={pdfs}
          commands={commands}
          onOpen={openFile}
          onOpenPdfAt={openPdfAt}
          onUrl={openInWeb}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      <ActivityBar
        side="left"
        label="左栏"
        groups={[leftItems]}
        bottom={
          <>
            <button className="ab" aria-label="库" data-tip={`库：${vault.name}`} data-key="换库、在访达里显示" data-side="right" onClick={(e) => setMenu({ kind: 'vault', el: e.currentTarget })}>
              <Codicon name="library" size={0} />
            </button>
            <button className="ab" aria-label="设置和外观" data-tip="设置和外观" data-key="⌘," data-side="right" onClick={(e) => setMenu({ kind: 'gear', el: e.currentTarget })}>
              <Codicon name="settings-gear" size={0} />
            </button>
          </>
        }
      />
      {menu?.kind === 'vault' && (
        <Popover anchor={menu.el} label="库" onClose={() => setMenu(null)}>
          <div className="mh">库</div>
          <MenuItem icon="check" label={vault.name} right={vault.path.replace(/^\/Users\/[^/]+/, '~')} onClick={() => (setMenu(null), openSettings('vault'))} />
          <div className="ms" />
          <MenuItem icon="folder-opened" label="换一个库…" onClick={() => (setMenu(null), void switchVault())} />
          <MenuItem icon="cloud-download" label="导入旧笔记…" onClick={() => (setMenu(null), openImport())} />
        </Popover>
      )}
      {menu?.kind === 'gear' && (
        <Popover anchor={menu.el} label="设置和外观" onClose={() => setMenu(null)}>
          <MenuItem icon="settings-gear" label="设置" right="⌘," onClick={() => (setMenu(null), openSettings('look'))} />
          <MenuItem icon="paintcan" label="外观和主题" onClick={() => (setMenu(null), openSettings('look'))} />
          <MenuItem icon="record-keys" label="快捷键" onClick={() => (setMenu(null), openSettings('keys'))} />
          <MenuItem icon="extensions" label="插件" onClick={() => (setMenu(null), openSettings('plugins'))} />
          <div className="ms" />
          <MenuItem icon="arrow-circle-up" label="检查更新" onClick={() => (setMenu(null), openSettings('update'), void window.cn.checkUpdate())} />
        </Popover>
      )}
      {leftView === 'dream' ? (
        !sidebarHidden && (
        <DreamPanel
          report={dream.report}
          running={dream.running}
          onReport={dream.setReport}
          onClose={() => setSidebarHidden(true)}
          onOpen={(p) => openNote(p)}
          onPreviewHtml={(p) =>
            open(
              (t) => t.type === 'html' && t.path === p && !!t.dream,
              () => ({ id: newId(), type: 'html', path: p, dream: true }),
            )
          }
          onNotice={setNotice}
          pv={pv}
        />
        )
      ) : (
        <Sidebar
          view={leftView}
          notes={pv.on ? pv.preview.notes : notes}
          preview={pv.on ? pv : null}
          active={activeTab}
          onOpenNote={(p) => openNote(pv.realPath(p))}
          onOpenInbox={openInbox}
          onOpenTopic={openTopic}
          onOpenAll={openAll}
          onOpenArchive={openArchive}
          pins={pins}
          archiveDays={settings.archiveDays}
          onTidy={() => runAi('/整理收件箱')}
          onNewNote={() => void newNote()}
          onNewBoard={() => void newBoard()}
          onOpenFile={openFile}
          onQuickOpen={() => (setPaletteOpen(false), setQuickOpen(true))}
          onRename={(p, n) => void renameFromSidebar(p, n)}
          folders={sideFolders}
          onOpenFolder={(f) => openFolder(f)}
          onNewCourse={() => void newCourse()}
        />
      )}

      <ActsSlot.Provider value={actsEl}>
      <main className={'center' + (pv.on ? ' previewing' : '') + (centerNarrow ? ' narrow' : '') + (centerCompact ? ' compact' : '')} ref={centerRef}>
        <div className="tabs">
          <div className={'tlist' + (tabFade.left ? ' fl' : '') + (tabFade.right ? ' fr' : '')} role="tablist" ref={tlistRef} data-testid="tab-list">
            {tabs.map((t) => {
              const on = t.id === shown
              const name = tabName(t)
              return (
                <div
                  key={t.id}
                  className={'tab' + (on ? ' on' : '')}
                  role="tab"
                  aria-selected={on}
                  data-testid={on ? 'tab-on' : undefined}
                  onDoubleClick={() => t.type === 'note' && setRenaming(t.id)}
                  onContextMenu={(e) => renaming !== t.id && void menuAt(e, tabMenu(t))}
                >
                  {renaming === t.id ? (
                    <span className="tl">
                      {tabIcon(t)}
                      <input
                        className="tab-rename"
                        aria-label="笔记名字"
                        defaultValue={name}
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => void renameTab(t.id, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          // 拦住这个键，不然焦点回到正文后回车会打进正文
                          if (e.key === 'Enter' || e.key === 'Escape') e.preventDefault()
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') (e.currentTarget.value = name), e.currentTarget.blur()
                        }}
                      />
                    </span>
                  ) : (
                    <button className="tl" onClick={() => (setTabs((x) => x, t.id), setSettingsFront(false))} data-tip={t.type === 'note' ? '双击改名' : undefined} data-side="below">
                      {tabIcon(t)}
                      <span className="truncate">{name}</span>
                    </button>
                  )}
                  <button className="x" aria-label="关闭标签" onClick={() => closeTab(t.id)}>
                    <Codicon name="close" size={14} />
                  </button>
                </div>
              )
            })}
            {settingsTab && (
              <div className={'tab' + (settingsFront ? ' on' : '')} role="tab" aria-selected={settingsFront}>
                <button className="tl" onClick={() => setSettingsFront(true)}>
                  <Codicon name="settings-gear" size={15} />
                  <span className="truncate">设置</span>
                </button>
                <button className="x" aria-label="关闭标签" onClick={() => setSettingsPage(null)}>
                  <Codicon name="close" size={14} />
                </button>
              </div>
            )}
          </div>
          <div className="acts" id="tab-acts" data-testid="tab-acts" ref={setActsEl} />
        </div>

        {frame === 'a' && activeTab && !(settingsTab && settingsFront) && (
          <Crumbs parts={locationOf(activeTab)} vaultName={vault.name} onFolder={(f) => openFolder(f)} onRename={activeTab.type === 'note' ? () => setRenaming(activeTab.id) : undefined} />
        )}

        {settingsTab && settingsFront && settingsPage && (
          <Settings
            asTab
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

        {tabs.length === 0 && (
          <div className="empty">
            <p>从左边选一篇，或者</p>
            <button className="btn btn-primary" onClick={() => void newNote()}>
              <Codicon name="file-text" size={14} />
              新建笔记
            </button>
          </div>
        )}

        {tabs.map((t) =>
          t.type === 'note' ? (
            <NoteTab
              key={t.id}
              tabId={t.id}
              renaming={renaming === t.id}
              onMenu={(e) => onFileMenu(e, t.path, { rename: () => setRenaming(t.id) })}
              path={t.path}
              active={t.id === shown}
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
          ) : t.type === 'pdf' ? (
            <PdfTab
              key={t.id}
              path={t.path}
              active={t.id === shown}
              onAsk={() => setLower('ai')}
              onShowNote={(id) => {
                setLower('notes')
                Reading.focusSection(t.path, id)
              }}
              onNotice={setNotice}
              aiOpen={lowerOpen === 'ai'}
              onOpenNote={(p) => openNote(p)}
            />
          ) : t.type === 'doubts' ? (
            <DoubtsTab
              key={t.id}
              folder={t.folder}
              active={t.id === shown}
              current={tabs.flatMap((x) => (x.type === 'pdf' && dirOfPath(x.path) === t.folder ? [x.path] : [])).pop() ?? null}
              onOpenPdf={openPdfAt}
              onNotice={setNotice}
            />
          ) : t.type === 'webread' ? (
            <WebReadTab key={t.id} url={t.url} title={t.title} active={t.id === shown} onBackToWeb={openInWeb} onOpenNote={(p) => openNote(p)} onNotice={setNotice} />
          ) : t.type === 'html' ? (
            <HtmlTab key={t.id} path={t.path} dream={!!t.dream} active={t.id === shown} onAsk={() => setLower('ai')} onNotice={setNotice} />
          ) : t.type === 'folder' ? (
            t.id === shown && (
              <FolderHomeView
                key={t.id}
                folder={t.folder}
                fresh={!!t.fresh}
                notes={pv.on ? pv.preview.notes : notes}
                pv={pv}
                version={gitVersion}
                onOpen={(p) => (/\.pdf$/i.test(p) ? openPdf(p) : /\.html?$/i.test(p) ? openHtml(p) : openNote(p))}
                onOpenAt={(f, page) => openPdfAt(f, page)}
                onOpenDoubts={openDoubts}
                onOpenAll={openAll}
                onNotice={noticeWithUndo}
                onRenamed={(f) => {
                  setTabs((x) => x.map((y) => (y.id === t.id ? { ...y, folder: f, fresh: false } : y)))
                  refreshNotes()
                }}
              />
            )
          ) : t.type === 'web' ? (
            <WebTab
              key={t.id}
              url={t.url}
              active={t.id === shown}
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
            t.id === shown && (
              <HomeView
                key={t.id}
                style={settings.appearance.homeStyle}
                notes={notes}
                version={gitVersion}
                dream={dream.report}
                dreamRunning={dream.running}
                editSeq={homeEditSeq}
                onOpenDream={() => openLeft('dream')}
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
            t.id === shown && (
              <NoteIndex
                key={t.id}
                which={t.type}
                notes={pv.on ? pv.preview.notes : notes}
                pins={pins}
                archiveDays={settings.archiveDays}
                onOpen={(p) => openNote(p)}
                onRename={(p, n) => void renameFromSidebar(p, n)}
                onOpenSettings={() => openSettings('vault')}
              />
            )
          ) : t.id === shown ? (
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

        {/* 一直挂着、关上只是藏起来：正在生成的那一轮不断，再打开对话还在 */}
        <AiPanel
          open={aiFloat && !readingPdf}
          tab={activeTab}
          mode={activeMode}
          doc={() => activeDoc.current}
          notes={notes}
          webUrl={aiState.webUrl}
          context={(mentions) => contextOf(aiState, mentions)}
          onClose={() => setAiFloat(false)}
          onOpen={(p) => openNote(p)}
          onShowHistory={() => setRight('history')}
          onShowDream={() => openLeft('dream')}
          autoRun={aiAuto}
          draft={aiDraft}
          onEngine={(label, id) => (setAiEngine(label), setAiEngineId(id))}
          onChanged={() => {
            refreshNotes()
            refreshGit()
          }}
        />
        <PreviewOverlay pv={pv} />
        <ImportHost
          onOpenInbox={openInbox}
          onDreamNow={() => {
            openLeft('dream')
            dreamNow()
          }}
          onNotice={setNotice}
        />
        <CaptureHost
          notes={notes}
          onNotice={setNotice}
          onPlaced={(p) => {
            refreshNotes()
            refreshGit()
            openNote(p)
          }}
        />
        <VideoToast />
      </main>
      </ActsSlot.Provider>

      {right === 'outline' && <OutlineView tab={activeTab} doc={() => activeDoc.current} onClose={() => setRight(null)} onPdfPage={(f, page) => openPdfAt(f, page)} />}
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
        onPluginSettings={() => openSettings('plugins')}
      />

      {readingPdf && lowerOpen && (
        <ReadingPanel
          key={readingPdf}
          pdf={readingPdf}
          which={lowerOpen}
          onWhich={setLower}
          onOpenNote={(p) => openNote(p)}
          onOpenLink={openLink}
          onOpenHtml={openHtml}
          onOpenDoubts={openDoubts}
          onOpenWeb={openInWeb}
        />
      )}


      <ActivityBar side="right" label="右栏" groups={[readingItems, rightItems]} bottom={frame === 'b' ? aiCorner : undefined} />

      {settingsPage && !settingsTab && (
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


      <StatusBar
        frame={frame}
        vaultName={vault.name}
        git={git}
        jobs={dream.running ? [{ id: 'dream', icon: 'wand', text: '梦游在整理', onClick: () => openLeft('dream') }] : []}
        previewing={pv.on}
        onCommit={commit}
        onSync={sync}
        onHistory={() => setRight('history')}
        onOpen={(p) => openNote(p)}
        onVault={(e) => setMenu({ kind: 'vault', el: e.currentTarget })}
        update={<UpdateBarItem st={update} onInstall={installUpdate} onOpenSettings={() => openSettings('update')} />}
        ai={frame === 'a' ? aiCorner : undefined}
        toast={
          notice && (
          <div className={'toast-cn' + (noticeUndo?.text === notice ? ' with-act' : '')} role="status" data-testid="toast">
            <span>{notice}</span>
            {noticeUndo?.text === notice && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  noticeUndo.run()
                  setNotice(null)
                  setNoticeUndo(null)
                }}
              >
                <Codicon name="discard" size={14} />
                撤回
              </button>
            )}
          </div>
        )
        }
      />
    </div>
  )
}

/** 标签上写的名字 */
function tabName(t: Tab): string {
  switch (t.type) {
    case 'note':
      return titleOf(t.path)
    case 'pdf':
      return t.path.split('/').pop()!
    case 'doubts':
      return '我的疑惑'
    case 'html':
      return t.path.split('/').pop()!.replace(/\.html?$/i, '')
    case 'webread':
      return `${t.title} · 阅读视图`
    case 'folder':
      return t.folder.split('/').pop()!
    case 'inbox':
      return '收件箱'
    case 'home':
      return '首页'
    case 'web':
      return t.title || hostOf(t.url)
    case 'all':
      return '全部笔记'
    case 'archive':
      return '归档'
    case 'topic':
      return t.topic
  }
}

/** 标的图标在 Desk 里画（白板用它自己的颜色方块、文件夹用它的图标） */
const TAB_ICON: Record<Exclude<Tab['type'], 'folder'>, CodiconName> = {
  note: 'file-text',
  pdf: 'file-pdf',
  doubts: 'question',
  html: 'file-code',
  webread: 'globe',
  inbox: 'inbox',
  home: 'home',
  web: 'globe',
  all: 'files',
  archive: 'archive',
  topic: 'folder',
}

/** 标签在哪：A 的面包屑、B 的搜索框都用它 */
function locationOf(t: Tab): string[] {
  const parts = (p: string) => p.replace(/\.(md|pdf|html?)$/i, '').split('/')
  switch (t.type) {
    case 'note':
    case 'pdf':
    case 'html':
      return parts(t.path)
    case 'folder':
      return t.folder.split('/')
    case 'doubts':
      return [...(t.folder ? t.folder.split('/') : []), '我的疑惑']
    case 'home':
      return ['首页']
    case 'inbox':
      return ['收件箱']
    case 'all':
      return ['全部笔记']
    case 'archive':
      return ['归档']
    case 'topic':
      return [CLIPS, t.topic]
    case 'web':
    case 'webread':
      return [t.title || hostOf(t.url)]
  }
}

/** 方向 A：标签下面一行面包屑，库名打头；前面几节是文件夹，点了开它的首页；笔记的最后一节点了改名 */
function Crumbs(props: { parts: string[]; vaultName: string; onFolder(folder: string): void; onRename?(): void }) {
  return (
    <nav className="crumbs" aria-label="位置">
      <span className="cr root">
        <Codicon name="library" size={14} />
        {props.vaultName}
      </span>
      {props.parts.map((p, i) => (
        <span key={i} className="cr">
          <Codicon name="chevron-right" size={12} className="sep" />
          {i < props.parts.length - 1 ? (
            <button onClick={() => props.onFolder(props.parts.slice(0, i + 1).join('/'))}>{p}</button>
          ) : props.onRename ? (
            <button className="last" data-tip="点一下改名" data-key="F2" data-side="below" onClick={props.onRename}>
              {p}
            </button>
          ) : (
            <b>{p}</b>
          )}
        </span>
      ))}
    </nav>
  )
}

const dirOfPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

function Welcome({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="welcome">
      <h1>打开一个文件夹当库</h1>
      <p>笔记就是这个文件夹里的 md 文件；没有 Git 的话会帮你建一个。</p>
      <button className="btn btn-primary" onClick={onOpen}>
        <Codicon name="folder-opened" size={14} />
        打开文件夹
      </button>
    </div>
  )
}
