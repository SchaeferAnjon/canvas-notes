import { Codicon, type CodiconName } from '@cn/design'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Clip, DreamItem, DreamReport, GitState, NoteFile, VaultInfo } from '../shared/api'
import { CLIPS, clipMarkdown, INBOX, titleOf } from '../shared/layout'
import { AiPanel } from './AiPanel'
import { EngineLogo } from './engine-logo'
import type { EngineId } from '../shared/agent'
import { contextOf, useAiBridge } from './ai-bridge'
import { DreamPanel } from './dream/DreamPanel'
import { PreviewOverlay, useDreamPreview } from './dream/preview'
import { expectDreamChange } from './dream/own-change'
import { dreamPaths, pendingOf, useDream } from './dream/useDream'
import { ActivityBar, type BarItem, MenuItem, Popover, TitleBar, Tooltips } from './shell/Shell'
import { StatusBar } from './shell/StatusBar'
import { OutlineView } from './shell/OutlineView'
import { ActsSlot, noteLeavers, noteRenamers } from './shell/TabActs'
import { revealLeft, tabEdges } from './shell/tab-scroll'
import { onFileMenu } from './ctx/file-menu'
import { app, setAppActions } from './ctx/actions'
import { copy, type MenuEntry, menuAt, setMenuNotice } from './ctx/menu'
import { reloadHome, resetHome } from './home-store'
import { HomeView } from './HomeView'
import { HistoryPanel } from './HistoryPanel'
import { DiffTab } from './diff/DiffTab'
import { OldImagesTab } from './dream/OldImages'
import type { DiffSource } from '../shared/diff'
import { UpdateBarItem, useUpdateState } from './update'
import { ListView } from './ListView'
import type { ViewMode } from './note-doc'
import { NoteIndex } from './NoteIndex'
import { RecentPage } from './RecentPage'
import { type TrashAsk, TrashDialog } from './TrashDialog'
import { NoteTab, primeNote } from './NoteTab'
import { holdTyping } from './new-note-hold'
import { COURSES, INBOX_DIR, Sidebar, type SideView, viewName } from './Sidebar'
import { INBOX_WARN } from '../shared/sidebar'
import { NoteDoc } from './note-doc'
import { Palette, type PaletteCommand } from './Palette'
import { QuickOpen } from './search/QuickOpen'
import { fileOpened, refreshVaultFiles, requestReveal, treePicked, vaultFiles } from './files/store'
import { allFolders } from './ctx/move-menu'
import { loadLeft, setHomeLooks, updateLeft, useLeft } from './files/left-store'
import { FolderGlyph, LookPicker } from './files/look'
import { dropLeft, moveLeft, putLeft, takeLeft } from '../shared/left'
import { usePluginCommands, usePluginEntries } from './plugins'
import { setActiveFile } from './plugins/host'
import { Settings, type SettingsPage } from './Settings'
import { homeWinBg, useAppSettings } from './theme'
import { fixedFolder } from '../shared/files'
import { CENTER_MIN, fitPanels, loadSideW, RIGHT_MIN, SIDE_DEFAULT, SideSash } from './shell/SideSash'
import { loadTabs, newId, retargetTabs, saveTabs, type Tab, tabsOutside } from './tabs'
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
import { onOpenFolderHome, openFolderHome } from './folder-home/store'
import { type AskFrom, setCenter, videoHost } from './video/store'
import { useAskJobs } from './video/ask-pending'
import { VideoToast } from './video/VideoToast'
import { VIDEO_FOLDER, videoOf } from '../shared/video'
// 四条栏的骨架最后加载，盖过各组件自己的旧摆法
import './shell/shell.css'

type Right = 'web' | 'history' | 'outline' | null

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 标签上能改名的：笔记；文件夹首页（最外层固定的生活、写作除外） */
const canRenameTab = (t: Tab) => t.type === 'note' || (t.type === 'folder' && !fixedFolder(t.folder))

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
  /** 左栏宽度：拖过才有（没拖过用 CSS 里的默认 252）；记在本机 */
  const [sideW, setSideW] = useState(loadSideW)
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
      const v = localStorage.getItem('cn.leftView')
      // 2026-11-17 以前的「课程和文件夹首页」「收件箱」是现在摘在左边的课程、收件箱两格
      if (v === 'folders') return `dir:${COURSES}`
      if (v === 'inbox') return `dir:${INBOX_DIR}`
      return v === 'files' || v === 'recent' || v === 'dream' || v?.startsWith('dir:') ? (v as SideView) : 'recent'
    } catch {
      return 'recent'
    }
  })
  /** 左栏摘了哪些文件夹（.canvas-notes/左栏.json）；文件变了重读 */
  const leftCfg = useLeft()
  useEffect(() => {
    void loadLeft()
    return window.cn.onFilesChanged(() => void loadLeft())
  }, [])
  // 摘出来的那一格被拿下来了：左栏回到「文件」
  const shownView: SideView = leftView.startsWith('dir:') && !leftCfg.left.includes(leftView.slice(4)) ? 'files' : leftView
  const openLeft = (v: SideView) => {
    setLeftViewState(v)
    setSidebarHidden(false)
    try {
      localStorage.setItem('cn.leftView', v)
    } catch {
      // 记不住不影响使用
    }
  }
  /** 删笔记的确认框（有自己的附件时才问） */
  const [trashAsk, setTrashAsk] = useState<TrashAsk | null>(null)
  /** 活动栏右键「设图标和颜色…」：贴着那一格弹 */
  const [barLook, setBarLook] = useState<{ folder: string; el: HTMLElement } | null>(null)
  /** 摘出来的文件夹底下「在「文件」里看位置」、活动栏右键「在「文件」里显示」：换到「文件」，展开到它，一圈外圈 */
  const showInFiles = (folder: string) => {
    requestReveal(folder)
    openLeft('files')
  }
  /** 右键「放到左边」：摘到活动栏，换到它那一格 */
  const putOnLeft = (folder: string) => {
    void updateLeft((c) => putLeft(c, folder))
    openLeft(`dir:${folder}`)
  }
  /** 图标栏上点亮着的那个 = 收起左栏 */
  const toggleLeft = (v: SideView) => (!sidebarHidden && shownView === v ? setSidebarHidden(true) : openLeft(v))
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
  /** 提示后面带的别的按钮（撤回失败后的「在历史里看」）：也只跟着那一句 */
  const [noticeAct, setNoticeAct] = useState<{ text: string; label: string; icon: CodiconName; run(): void } | null>(null)
  /** 梦游撤不回：说原因，「撤回」换成「在历史里看」（打开右栏历史，那次收下在里面） */
  const undoFailed = (e: unknown) => {
    const text = errText(e)
    setNotice(text)
    setNoticeUndo(null)
    setNoticeAct({ text, label: '在历史里看', icon: 'history', run: () => setRight('history') })
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
  /** 让右栏开一个新网页标签（⌘K 里打的网址、宽标签放回右栏）；reuse：已经开着这个网站的标签就切过去（微信读书入口） */
  const [webOpen, setWebOpen] = useState<{ url: string; seq: number; reuse?: string } | null>(null)
  const openInWeb = (url: string, reuse?: string) => {
    setWebOpen((r) => ({ url, seq: (r?.seq ?? 0) + 1, ...(reuse ? { reuse } : {}) }))
    setRight('web')
  }
  /** 右栏现在显示的 http(s) 网页（标题栏「移到中间」看它），和右栏把它挪到中间的那一步 */
  const [rightWeb, setRightWeb] = useState<string | null>(null)
  const moveWebToCenter = useRef<(() => void) | null>(null)
  /** 插件在右竖条的格子（微信读书）：网页下面 */
  const pluginEntries = usePluginEntries({ webOpen: right === 'web', url: rightWeb }, { open: (u, reuse) => openInWeb(u, reuse), close: () => setRight(null) })
  // ---------- 检查更新 ----------
  const update = useUpdateState()
  useEffect(() => window.cn.onUpdateOpen(() => openSettings('update')), [])
  // AI 出错时「去设置 › AI」（ai-error.tsx）
  useEffect(() => {
    const on = (e: Event) => openSettings((e as CustomEvent<SettingsPage>).detail)
    window.addEventListener('cn:open-settings', on)
    return () => window.removeEventListener('cn:open-settings', on)
  }, [])
  // 更新后第一次打开：说一句（只一次）
  useEffect(() => {
    if (!update || update.phase === 'off') return
    try {
      const last = localStorage.getItem('cn.lastVersion')
      localStorage.setItem('cn.lastVersion', update.current)
      if (last && last !== update.current) setNotice(`已更新到${update.current}`)
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
  /** 窗口宽度：窗口变窄时左右栏跟着让（fitPanels），中间正在写的不被挤没 */
  const [winW, setWinW] = useState(window.innerWidth)
  useEffect(() => {
    const on = () => setWinW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
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
    refreshVaultFiles()
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
  /** 写不进去、字另存了的那几篇（底栏「N篇没存上」） */
  const [unsaved, setUnsaved] = useState<{ path: string; rescued: string | null }[]>([])
  useEffect(() => NoteDoc.onFailing(() => setUnsaved([...NoteDoc.failing].map((d) => ({ path: d.path, rescued: d.rescued })))), [])
  // 第一次写不进去：一句说清，带「打开另存的」（和「在历史里看」一样跟着这一句，停 10 秒）
  useEffect(
    () =>
      NoteDoc.onRescued((d, why) => {
        const to = d.rescued
        const text = `「${titleOf(d.path)}」没存上：${why}，字另存了一篇`
        setNotice(text)
        setNoticeUndo(null)
        setNoticeAct(to ? { text, label: '打开另存的', icon: 'go-to-file', run: () => openNote(to) } : null)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // 开着的笔记改了名、挪了地方：标签跟到新名字（编辑器跟着标签的路径走）。
  // 软件自己挪的（梦游收下、撤回）不说「在外面」，提示条由做这件事的地方说；真在外面改的底栏说一句，只挪了文件夹就说挪到哪
  useEffect(
    () =>
      window.cn.onNoteRenamed((from, to, own) => {
        // 编辑器马上换路径（不等标签重画）：紧接着来的新内容（梦游收下时挪了又改了字）按新路径认得出是它
        NoteDoc.follow(from, to)
        if (!tabsNow.current.some((t) => t.type === 'note' && t.path === from)) return
        setTabState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.type === 'note' && t.path === from ? { ...t, path: to } : t)) }))
        refreshNotes()
        if (NoteDoc.takeOwnMove(from, to) || own) return
        const dir = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '库的最外层'
        setNotice(titleOf(from) === titleOf(to) ? `「${titleOf(to)}」在外面挪到了${dir}，标签跟过去了` : `「${titleOf(from)}」在外面改名成了「${titleOf(to)}」，标签跟过去了`)
      }),
    [],
  )

  useEffect(() => saveTabs(vault.path, tabs, active), [vault.path, tabs, active])
  // 换了标签（点标签、从左栏开一篇）：设置标签退到后面
  useEffect(() => setSettingsFront(false), [active])

  /** 现在的提示（异步的删除接着记连删时读） */
  const noticeNow = useRef(notice)
  noticeNow.current = notice
  /** 鼠标停在提示条上：不计时（读完再点「撤回」） */
  const [noticeHover, setNoticeHover] = useState(false)
  const undoable = !!notice && noticeUndo?.text === notice
  const actable = !!notice && !undoable && noticeAct?.text === notice
  useEffect(() => {
    if (!notice || noticeHover) return
    // 带「撤回」的停 10 秒，别的 6 秒
    const t = setTimeout(() => setNotice(null), undoable || actable ? 10_000 : 6000)
    return () => clearTimeout(t)
  }, [notice, noticeHover, undoable, actable])
  const runNoticeUndo = () => {
    noticeUndo?.run()
    setNotice(null)
    setNoticeUndo(null)
    setNoticeHover(false)
  }
  const undoRef = useRef(runNoticeUndo)
  undoRef.current = runNoticeUndo
  // 提示条带着「撤回」时，⌘Z 就是点它（删笔记后马上反悔）；输入框里照常撤字。
  // 提示出来以后在文档里打过字：⌘Z 先撤打的字（恢复的那篇里接着写了几个字再 ⌘Z，多半是想撤字，不是再恢复下一篇）
  useEffect(() => {
    if (!undoable) return
    let typed = false
    const onInput = (e: Event) => {
      const t = (e as InputEvent).inputType
      if (!t.startsWith('history') && (e.target as HTMLElement | null)?.closest?.('.cm-editor')) typed = true
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea')) return
      if (typed && target?.closest?.('.cm-editor')) return
      e.preventDefault()
      e.stopPropagation()
      undoRef.current()
    }
    window.addEventListener('beforeinput', onInput, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('beforeinput', onInput, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [undoable, notice])

  /** 现在的标签（监听回调里读，不跟着重挂） */
  const tabsNow = useRef(tabs)
  tabsNow.current = tabs
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
        // 刚新建的一定开新标签：盘慢时上一篇新建的还在按标题改名、标签还记着旧路径「未命名」，按路径找会找回它
        // （第 5 轮：给新笔记打的字换掉了上一篇的正文）
        (t) => !fresh && t.type === 'note' && t.path === path,
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
  /** 梦游报告里一条的「收下」「丢掉」（左栏报告和「梦游预览 · 挪老图」标签同一条路）：做完换上新报告、刷新左栏和底栏 */
  const [dreamBusy, setDreamBusy] = useState(false)
  async function dreamAct(f: () => Promise<DreamReport>, done: string, undo?: { id: string; done: string; touched: string[] }): Promise<DreamReport | null> {
    setDreamBusy(true)
    try {
      const r = await f()
      dream.setReport(r)
      // 收下的：提示条上带「撤回」（一次反向提交，回到收下前的样子）
      const taken = undo ? r.items.find((i) => i.id === undo.id)?.taken : undefined
      noticeWithUndo(
        done,
        taken
          ? () => {
              // 撤回也是软件自己改开着的那篇：提示条说撤回了，不说外部改动
              NoteDoc.expectOwnChange(undo!.touched)
              void window.cn.dreamUndo({ ids: [undo!.id], taken }).then(
                (u) => (dream.setReport(u.report), setNotice(undo!.done), refreshNotes(), refreshGit()),
                undoFailed,
              )
            }
          : undefined,
      )
      refreshNotes()
      refreshGit()
      return r
    } catch (e) {
      setNotice(errText(e))
      return null
    } finally {
      setDreamBusy(false)
    }
  }
  /**
   * 收下一条：提示条写收下了什么、带撤回。挪老图改的笔记正开着时写「梦游挪了图，链接已更新」，
   * 那篇编辑器不再另说「外部改动已经合并进来」（那句会把带撤回的提示顶掉，说的也不是外部）
   */
  function dreamTake(it: DreamItem) {
    const base = dream.report?.base ?? 'main'
    const touched = dreamPaths([it])
    const open = [...NoteDoc.open].some((d) => touched.includes(d.path))
    expectDreamChange([it])
    const text = it.oldImages ? (open ? '梦游挪了图，链接已更新' : `老图挪好了，一次提交进了${base}`) : it.commit ? `收下了，一次提交进了${base}` : '看过了，没改任何文件'
    return dreamAct(() => window.cn.dreamTake(it.id), text, { id: it.id, done: it.oldImages ? '撤回了，老图回到了原处' : '撤回了，又回到待看', touched })
  }
  const dreamDrop = (it: DreamItem) => dreamAct(() => window.cn.dreamDrop(it.id), it.oldImages ? '这一条丢掉了，老图都留在原处' : `丢掉了，这条改动不会进${dream.report?.base ?? 'main'}`)
  /** 对比标签（CN-48）：已经开着同一个就切过去；不然换掉还没固定的那个预览标签（斜体），都没有就新开一个 */
  const openDiff = useCallback((src: DiffSource, title: string) => {
    const same = (t: Tab) => t.type === 'diff' && JSON.stringify({ ...t.src, focus: undefined }) === JSON.stringify({ ...src, focus: undefined })
    setTabState((s) => {
      const hit = s.tabs.find(same)
      if (hit) return { tabs: s.tabs.map((t) => (t.id === hit.id ? { ...t, src } : t)) as Tab[], active: hit.id }
      const t: Tab = { id: newId(), type: 'diff', src, title }
      const i = s.tabs.findIndex((x) => x.type === 'diff' && !x.pinned)
      if (i === -1) return { tabs: [...s.tabs, t], active: t.id }
      return { tabs: s.tabs.map((x, j) => (j === i ? t : x)), active: t.id }
    })
  }, [])
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
      setNotice(`建了${f} · 首页用的是「${r.template ? '课程模板' : '默认课程首页'}」`)
    } catch (e) {
      setNotice(errText(e))
    }
  }
  /** 按文件类型开成对的标签：PDF、HTML、md（搜索、⌘O、目录树用） */
  const openFile = useCallback((path: string) => (/\.pdf$/i.test(path) ? openPdf(path) : /\.html?$/i.test(path) ? openHtml(path) : openNote(path)), [openPdf, openHtml, openNote])
  const openHome = () => open((t) => t.type === 'home', () => ({ id: newId(), type: 'home' }))
  const openInbox = () => open((t) => t.type === 'inbox', () => ({ id: newId(), type: 'inbox' }))
  const openRecent = () => open((t) => t.type === 'recent', () => ({ id: newId(), type: 'recent' }))
  const openArchive = () => open((t) => t.type === 'archive', () => ({ id: newId(), type: 'archive' }))

  /** 标签右键（DESIGN.v3 9.2）：关闭这几种、改名、在访达中显示、拷贝路径、网页移到右栏 */
  function tabMenu(t: Tab): MenuEntry[] {
    const i = tabs.findIndex((x) => x.id === t.id)
    const path = 'path' in t ? t.path : null
    return [
      { label: '关闭', accel: 'CommandOrControl+W', run: () => closeTab(t.id) },
      { label: '关闭其他', enabled: tabs.length > 1, run: () => (leaveTabs(tabs.filter((x) => x.id !== t.id)), setTabState({ tabs: tabs.filter((x) => x.id === t.id), active: t.id })) },
      { label: '关闭右侧', enabled: i < tabs.length - 1, run: () => (leaveTabs(tabs.slice(i + 1)), setTabState((s) => ({ tabs: s.tabs.slice(0, i + 1), active: s.tabs.slice(0, i + 1).some((x) => x.id === s.active) ? s.active : t.id }))) },
      { label: '关闭全部', run: () => (leaveTabs(tabs), setTabState({ tabs: [], active: null })) },
      '-',
      canRenameTab(t) && { label: '重命名', accel: 'F2', run: () => setRenaming(t.id) },
      path && { label: '在访达中显示', run: () => window.cnMenu.reveal(path) },
      path && { label: '拷贝路径', run: () => copy(vault.path + '/' + path) },
      t.type === 'web' && { label: '移到右栏', run: () => (closeTab(t.id), openInWeb(t.url)) },
    ]
  }

  function closeTab(id: string) {
    const t = tabs.find((x) => x.id === id)
    if (t) leaveTabs([t])
    setTabState((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const next = s.active === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.active
      return { tabs, active: next }
    })
  }

  /** 新建笔记放哪（CN-11）：目录树里点过的文件夹；开着的文件夹首页；都不是就进收件箱，梦游再建议归类 */
  const newNoteWhere = useRef<() => string>(() => INBOX)
  /** 正在新建：连点两下只建一篇 */
  const creating = useRef(false)
  /** 这次新建、还没写过东西的笔记：关掉标签时还是空的就不留 */
  const freshNotes = useRef(new Set<string>())
  /** 新建笔记（⌘N、左栏按钮、文件夹右键都走这里，关掉时还空着就进废纸篓）；folder 不给就按 newNoteWhere */
  const newNote = useCallback(async (folder?: string) => {
    if (creating.current) return
    creating.current = true
    // 盘慢时建好、读好要一两秒：键盘先从原来那篇拿走，这中间打的字交给新笔记（不然进了原来那篇）
    const hold = holdTyping()
    try {
      const path = await window.cn.createNote(folder ?? newNoteWhere.current(), '未命名', '# 未命名\n\n')
      freshNotes.current.add(path)
      // 读好再开：标签出来时编辑器已经在、光标在标题里，紧接着打的字不丢
      primeNote(await window.cn.readNote(path))
      hold.handTo(path)
      refreshNotes()
      openNote(path, true)
    } catch (e) {
      hold.drop()
      setNotice(errText(e))
    } finally {
      creating.current = false
    }
  }, [openNote, refreshNotes])
  /**
   * 要关掉的标签里的笔记：先让它按标题改名（写了标题没回车就 ⌘W 也改），再看新建的是不是还空着。
   * 在标签从界面上拿掉之前叫（编辑器还在，NoteTab 登记的 leave 还能拿到）
   */
  function leaveTabs(closing: Tab[]) {
    for (const t of closing) {
      if (t.type !== 'note') continue
      const fresh = freshNotes.current.has(t.path)
      const leave = noteLeavers.get(t.id)
      void (async () => {
        const now = leave ? await leave() : t.path
        if (!fresh) return
        // 跟着标题改了名：写过标题，不是空的
        if (now !== t.path) freshNotes.current.delete(t.path)
        else await dropIfBlank(t.path)
      })().catch((e) => setNotice(errText(e)))
    }
  }
  /** 关掉一篇新建的笔记：只有「# 未命名」那一行（没写标题、没写正文）就移到废纸篓，收件箱和「最近」里不堆空的「未命名」 */
  async function dropIfBlank(path: string) {
    freshNotes.current.delete(path)
    // 等标签里的编辑器把没存的字存完（关标签时它先存再收）
    await NoteDoc.saveAll()
    const note = await window.cn.readNote(path)
    if (note.text.trim() !== `# ${titleOf(path)}`) return
    await window.cn.trashNote(path)
    refreshNotes()
  }

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
  newNoteWhere.current = () => treePicked() ?? (activeTab?.type === 'folder' ? activeTab.folder : INBOX)
  // 刚新建的笔记：fresh 只用一次（NoteTab 打开时已经记下：文档光标进标题，白板在标签上改名）
  useEffect(() => {
    if (activeTab?.type !== 'note' || !activeTab.fresh) return
    setTabs((x) => x.map((t) => (t.id === activeTab.id && t.type === 'note' ? { ...t, fresh: false } : t)))
  }, [activeTab])
  /** 标签上改名：笔记交给 NoteTab 登记的改名（顺手改开头的 # 标题、别处的 [[旧名]]） */
  async function renameTab(id: string, name: string) {
    setRenaming(null)
    const t = tabs.find((x) => x.id === id)
    if (t?.type === 'folder') return void (await renameFolderTo(t.folder, name))
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
  /** 视频框一块问正在答的（底栏「AI 在记笔记 · 未命名 3」，CN-84） */
  const askJobs = useAskJobs()
  const askInRightRef = useRef<(from?: AskFrom) => void>(() => undefined)

  // 布局阶段就挂上：窗口一画出来 ⌘N、⌘K、⌘J、⌘, 就能用（useEffect 要等画完下一帧才挂，刚打开时按的会丢）
  useLayoutEffect(() => {
    const run = (key: string): boolean => {
      if (key === 'n') void newNote()
      else if (key === 'k' || key === 'f') (setQuickOpen(false), setPaletteOpen((v) => !v))
      else if (key === 'o') (setPaletteOpen(false), setQuickOpen((v) => !v))
      else if (key === 'j') {
        // 文档里选了字、AI 还没开：带着这段打开，光标在输入框，不自动发（CN-67 A）
        const d = activeDoc.current
        const sel = d?.view.hasFocus ? d.view.state.selection.main : null
        const picked = sel && !sel.empty ? d!.view.state.sliceDoc(sel.from, sel.to).trim() : ''
        if (picked && !(readingPdf ? lower === 'ai' : aiFloat)) app().askAi(picked)
        else toggleAi()
      }
      else if (key === 'w' && active) closeTab(active)
      else if (key === ',') openSettings('look', true)
      else if (key === '\\') setSidebarHidden((h) => !h)
      else return false
      return true
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.altKey && !e.ctrlKey && run(e.key)) e.preventDefault()
      // ⌥⌘O：右栏打开大纲（文档右边目录浮层的头一行，CN-26）
      else if (e.metaKey && e.altKey && !e.ctrlKey && e.code === 'KeyO') (e.preventDefault(), setRight('outline'))
      // F2：改当前笔记的名字（焦点在输入框里时不抢；在目录树里是改树上选着的那一行）
      else if (e.key === 'F2' && activeTab && canRenameTab(activeTab) && !(e.target as HTMLElement).closest?.('input, textarea, [role=tree]')) {
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

  /** 左栏、目录树里改名：第一行是「# 旧名」就跟着改（开着的交给那个标签自己改，和标签上改名一样） */
  async function renameFromSidebar(path: string, name: string) {
    try {
      const open = tabs.find((t) => t.type === 'note' && t.path === path)
      const renamer = open && noteRenamers.get(open.id)
      if (renamer) {
        await renamer(name)
        refreshNotes()
        refreshGit()
        return
      }
      await NoteDoc.saveAll()
      if (/\.md$/i.test(path)) {
        const note = await window.cn.readNote(path)
        const old = titleOf(path)
        if (!note.readOnly && note.text.startsWith(`# ${old}\n`)) await window.cn.writeNote(path, `# ${name.trim()}\n` + note.text.slice(old.length + 3), note.text)
      }
      const p = await window.cn.renameNote(path, name)
      setTabs((x) => x.map((t) => (t.type === 'note' && t.path === path ? { ...t, path: p } : t)))
      refreshNotes()
      refreshGit()
    } catch (e) {
      setNotice(errText(e))
    }
  }

  /** 删一篇（md 连同只有它在用的图，能撤回；PDF、HTML 直接进废纸篓） */
  async function trash(path: string) {
    try {
      await NoteDoc.saveAll()
      const closeTabs = () =>
        setTabState((s) => {
          // 文档、PDF、HTML 开着的标签一起关
          const tabs = s.tabs.filter((t) => !('path' in t && t.path === path))
          return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : (tabs[tabs.length - 1]?.id ?? null) }
        })
      if (!/\.md$/i.test(path)) {
        closeTabs()
        await window.cn.trashNote(path)
        setNotice(`「${titleOf(path)}」移到了废纸篓，在访达的废纸篓里能找回`)
      } else {
        // 自己附件文件夹里有图：先问连不连图一起删（别的笔记也在用的，后台查完再告诉）；没有就直接删
        const a = await window.cnAttach.of(path, false)
        const own = a.items.filter((i) => i.own)
        let withImages = false
        if (own.length) {
          const shared = window.cnAttach.of(path, true).then((x) => x.items.filter((i) => i.own && i.sharedWith?.length).length)
          const answer = await new Promise<boolean | null>((done) => setTrashAsk({ path, dir: a.dir, own, shared, done }))
          setTrashAsk(null)
          if (answer === null) return
          withImages = answer
        }
        closeTabs()
        const r = await window.cnAttach.trashNote(path, withImages)
        // 上一篇的「已删除 · 撤回」还在：接着记，⌘Z 从这篇起一篇篇往回恢复（像访达）
        if (noticeNow.current === null || noticeNow.current !== trashNotice.current) trashChain.current = []
        trashChain.current.push({ path, id: r.id })
        const n = trashChain.current.length
        showTrashUndo(`已删除《${titleOf(path)}》${r.images ? `和${r.images}张图` : ''}${n > 1 ? `（连着删了${n}篇，撤回从这篇起依次恢复）` : ''}`)
      }
      refreshNotes()
      refreshGit()
    } catch (e) {
      setNotice(errText(e))
    }
  }

  /** 连着删的几篇（先删的在前）：「撤回」、⌘Z 从最后删的那篇起一篇篇恢复 */
  const trashChain = useRef<{ path: string; id: string }[]>([])
  /** 删笔记那条提示的字（看现在的提示是不是还是它，是就接着记） */
  const trashNotice = useRef<string | null>(null)
  function showTrashUndo(text: string) {
    const chain = trashChain.current
    const last = chain[chain.length - 1]
    trashNotice.current = last ? text : null
    if (!last) return setNotice(text)
    noticeWithUndo(text, () => {
      chain.pop()
      void window.cnAttach.undo(last.id).then(
        () => {
          refreshNotes()
          refreshGit()
          openNote(last.path)
          const next = chain[chain.length - 1]
          showTrashUndo(next ? `恢复了《${titleOf(last.path)}》，再撤回恢复《${titleOf(next.path)}》` : `恢复了《${titleOf(last.path)}》`)
        },
        (e) => setNotice(errText(e)),
      )
    })
  }

  /** 文件夹改名（左栏、目录树、首页标题、标签）：链接和置顶主进程一起改，开着的标签换成新路径 */
  async function renameFolderTo(folder: string, name: string): Promise<string | null> {
    const old = folder.split('/').pop()!
    if (!name.trim() || name.trim() === old) return null
    try {
      await NoteDoc.saveAll()
      const to = await window.cnFolder.rename(folder, name)
      setTabState((s) => ({ ...s, tabs: retargetTabs(s.tabs, folder, to) }))
      setNotice(`「${old}」改名为「${to.split('/').pop()}」，库里指向它的链接一起改好了`)
      refreshNotes()
      refreshGit()
      return to
    } catch (e) {
      setNotice(errText(e))
      return null
    }
  }

  /** 文件夹移到废纸篓：主进程先弹系统确认；里面开着的标签一起关 */
  async function trashFolder(folder: string) {
    try {
      await NoteDoc.saveAll()
      const n = await window.cnFolder.trash(folder)
      if (n === null) return
      setTabState((s) => {
        const tabs = tabsOutside(s.tabs, folder)
        return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : (tabs[tabs.length - 1]?.id ?? null) }
      })
      setNotice(`「${folder.split('/').pop()}」${n ? `和里面${n}个文件` : ''}移到了废纸篓，历史里能撤回`)
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
    { name: '最近', hint: '按时间看全部笔记，能筛选', icon: 'clockface', run: () => openRecent() },
    { name: '归档', hint: '很久没改过的，左栏不显示', icon: 'archive', run: () => openArchive() },
    { name: '回到首页', icon: 'home', run: () => openHome() },
    { name: '打开网页', hint: '右栏', icon: 'globe', run: () => setRight('web') },
    { name: '打开梦游报告', hint: '左栏', icon: 'wand', run: () => openLeft('dream') },
    { name: '换主题…', hint: '设置 · 外观', icon: 'symbol-color', run: () => openSettings('look') },
    { name: '编辑首页', icon: 'home', run: () => (openHome(), setHomeEditSeq((n) => n + 1)) },
    ...folders.map((f) => ({ name: `${f.folder.split('/').pop()} 首页`, hint: f.folder, icon: 'folder' as const, run: () => openFolder(f.folder) })),
    { name: '新建一门课', hint: '课程/新的课程，首页用课程模板', icon: 'folder', run: () => void newCourse() },
    { name: '导入旧笔记…', hint: '备忘录或Markdown文件夹，先进收件箱', icon: 'root-folder', run: () => openImport() },
    { name: '设置', icon: 'settings-gear', keys: '⌘,', run: () => openSettings('look') },
    { name: '看历史', hint: '每次提交改了哪些文件', icon: 'history', run: () => setRight('history') },
    { name: '现在提交', icon: 'git-commit', run: () => void commit() },
    { name: '同步', icon: 'refresh', run: () => void sync() },
    { name: '问AI', icon: 'sparkle', keys: '⌘J', run: () => setAiFloat(true) },
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
  if (update?.phase === 'ready') commands.unshift({ name: '重启更新', hint: `新版本${update.version}已下好`, icon: 'arrow-circle-up', run: () => void installUpdate() })

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
      if (r.kind === 'no-remote') setNotice('这个库还没有远程仓库，同步不了。先用git remote add加一个。')
      else if (r.kind === 'conflict') setNotice('远程和本机改了同一处，已经退回同步前，本机的字都在。需要手动合并一次。')
      else
        setNotice(
          [r.committed ? '先提交了本机的改动' : '', r.pulled ? `拉下${r.pulled}次提交` : '', r.pushed ? '推上去了' : '']
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
            Reading.stage(src, { page, url, png, web: { url: e.box.url, title: e.box.title || e.box.url, text: e.box.text }, ...(e.action === 'explain' || e.action === 'translate' ? { direct: true } : {}) })
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
    if (readingPdf) {
      if (lower !== 'ai') Reading.wantAiFocus()
      setLower(lower === 'ai' ? null : 'ai')
    }
    // 右栏开着视频：AI 开在右栏下格（和读 PDF 一样，不压中间栏的文档，CN-84）
    else if (right === 'web' && videoOf((active && webUrl[active]) || '')) askInRight()
    else setAiFloat((v) => !v)
  }

  /** 右栏网页（视频）下格开 AI；from 给了（问答块上「接着问」）就把那一问放进输入框当引文，标「00:06 · 视频名」 */
  askInRightRef.current = askInRight
  function askInRight(from?: AskFrom) {
    const cur = (active && webUrl[active]) || ''
    // 「接着问」：右栏开着的就是这个视频就接着用它；不是（或右栏没开网页）先把视频开到那一秒
    const same = !!from && videoOf(cur)?.key === videoOf(from.url)?.key
    const u = from && !same ? from.url : cur
    if (!/^https?:/i.test(u)) return setAiFloat(true)
    // 同一个视频：跳回那一秒停住，看着那一帧追问
    if (from) videoHost()?.openAt(from.url, from.t, same)
    const src = `web:${u}`
    if (lower !== 'ai' || webAsk !== src) Reading.wantAiFocus()
    setAiFloat(false)
    setWebAsk(src)
    setRight('web')
    setLower('ai')
    if (from)
      void Reading.load(src).then(() =>
        Reading.stage(src, {
          page: 0,
          quote: from.quote.slice(0, 2000),
          blank: true,
          ...(from.image ? { image: from.image } : {}),
          web: { url: from.url, title: from.title, t: from.t, ...(from.answer ? { answer: from.answer.slice(0, 4000) } : {}) },
        }),
      )
  }

  /** 梦游预览：左栏、全部笔记换成归类和改名以后的样子 */
  const pv = useDreamPreview(dream, notes, setNotice, undoFailed)
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
  useEffect(() => setHomeLooks(folders), [folders])
  const tabIcon = (t: Tab) => {
    if (t.type === 'folder') return <FolderGlyph folder={t.folder} size={15} />
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
      askInRight: (from) => askInRightRef.current(from),
      notice: setNotice,
      refresh: () => {
        refreshNotes()
        refreshGit()
      },
      open: (p) => openNote(p),
      rename: async (p, name) => {
        if (activeTab?.type === 'note' && activeTab.path === p) await noteRenamers.get(activeTab.id)?.(name)
      },
      openAiSettings: () => openSettings('ai'),
    })
  }, [activeTab, activeMode, aiFloat, refreshNotes, refreshGit, openNote])
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
    closeSettingsDialog: () => !settingsTab && setSettingsPage(null),
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
    // 文件夹右键「新建笔记」：和 ⌘N 同一条路（以前另建一份，关掉时空着也不进废纸篓）
    newNote: (folder) => newNote(folder),
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
    allFolders: () =>
      allFolders(
        [...notes.map((n) => n.path), ...pdfs.map((x) => x.path)],
        [...folders.map((f) => f.folder), ...vaultFiles().filter((f) => f.kind === 'dir').map((f) => f.path)],
      ),
    putOnLeft,
    async moveFolder(folder, parent) {
      try {
        await NoteDoc.saveAll()
        const to = await window.cnFolder.move(folder, parent)
        setTabState((s) => ({ ...s, tabs: retargetTabs(s.tabs, folder, to) }))
        setNotice(`「${folder.split('/').pop()}」挪到了${parent || '库的最外层'}，库里指向它的链接一起改好了`)
        refreshNotes()
        refreshGit()
      } catch (e) {
        setNotice(errText(e))
      }
    },
    async moveNote(path, folder) {
      await NoteDoc.saveAll()
      const to = await window.cnMenu.moveNote(path, folder)
      setTabs((x) => x.map((t) => (t.type === 'note' && t.path === path ? { ...t, path: to } : t)))
      const where = folder || '库的最外层'
      // 那里已经有同名的：存成了「X 2」，说出新名字（不悄悄改名）
      setNotice(titleOf(to) === titleOf(path) ? `「${titleOf(path)}」挪到了${where}` : `${where}里已经有一篇叫「${titleOf(path)}」，这篇挪过去存成「${titleOf(to)}」`)
      refreshNotes()
      refreshGit()
    },
    absPath: (rel) => vault.path + '/' + rel,
    openFolderHome: (f) => openFolder(f),
    openFolderHere(folder) {
      setTabState((s) => {
        const there = s.tabs.find((t) => t.type === 'folder' && t.folder === folder)
        if (there) return { ...s, active: there.id }
        const t: Tab = { id: newId(), type: 'folder', folder }
        const i = s.tabs.findIndex((x) => x.id === s.active)
        if (i === -1) return { tabs: [...s.tabs, t], active: t.id }
        return { tabs: s.tabs.map((x, j) => (j === i ? t : x)), active: t.id }
      })
    },
    renameFolder: renameFolderTo,
    trashFolder,
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
  // 两条图标栏，加上 B 右栏和中间之间 6 的缝（shell.css：右栏那一列是右栏宽 + 缝）：不算进去中间就少 6，变成 414
  const chromeW = 2 * (frame === 'a' ? 48 : 44) + (frame === 'b' && rightOpen ? 6 : 0)
  const fit = fitPanels(winW, chromeW, sidebarHidden ? 0 : (sideW ?? SIDE_DEFAULT), rightOpen ? rightW : 0)
  const aiOn = readingPdf ? lowerOpen === 'ai' : aiFloat
  const aiLabel = readingPdf ? 'AI在右栏（读PDF时）' : 'AI'
  const noOutline = !activeTab || !['note', 'pdf'].includes(activeTab.type)
  // 活动栏（左栏按维度组织）：上面「文件」按位置、「最近」按时间；分隔线下面是摘出来的文件夹（单色符号，能右键、能拖着排）；再下面梦游
  const barItem = (id: SideView, label: string, icon: BarItem['icon'], extra: Partial<BarItem> = {}): BarItem => ({ id, label, icon, on: !sidebarHidden && shownView === id, onClick: () => toggleLeft(id), ...extra })
  const viewItems: BarItem[] = [barItem('files', '文件', 'files', { key: '⇧⌘E' }), barItem('recent', '最近', 'clockface', { key: '⇧⌘R' })]
  const dirItems: BarItem[] = leftCfg.left.map((f) =>
    barItem(`dir:${f}`, viewName(`dir:${f}`), 'folder', {
      glyph: <FolderGlyph folder={f} mono size={0} />,
      ...(f === INBOX_DIR ? { badge: inboxCount, warn: inboxCount > INBOX_WARN, tid: 'inbox' } : {}),
      onContextMenu: (e) => {
        const el = e.currentTarget
        void menuAt(e, [
          { label: '打开首页', run: () => openFolder(f) },
          { label: '在「文件」里显示', run: () => showInFiles(f) },
          '-',
          { label: '设图标和颜色…', run: () => setBarLook({ folder: f, el }) },
          { label: '上移', enabled: leftCfg.left.indexOf(f) > 0, run: () => updateLeft((c) => moveLeft(c, f, -1)) },
          { label: '下移', enabled: leftCfg.left.indexOf(f) < leftCfg.left.length - 1, run: () => updateLeft((c) => moveLeft(c, f, 1)) },
          '-',
          { label: '从左边拿下来', run: () => updateLeft((c) => takeLeft(c, f)) },
        ])
      },
      drag: { key: f, onDrop: (from, before) => void updateLeft((c) => dropLeft(c, from, before)) },
    }),
  )
  const dreamItems: BarItem[] = [barItem('dream', '梦游报告', 'wand', { dot: pendingOf(dream.report) > 0 })]
  // 读 PDF 时竖条上只多「笔记」；AI 只有右下角那一个入口（CN-22 方向 A）
  const readingItems: BarItem[] = readingPdf
    ? [
        ...(Reading.isWebSrc(readingPdf) ? [] : [{ id: 'notes', label: '笔记', key: undefined, icon: 'note' as const, on: lowerOpen === 'notes', dot: !!reading?.fresh && lowerOpen !== 'notes', onClick: () => setLower(lower === 'notes' ? null : 'notes') }]),
      ]
    : []
  const rightItems: BarItem[] = [
    { id: 'outline', label: noOutline ? '大纲 · 这一页没有大纲' : '大纲', icon: 'list-tree' as const, dim: noOutline, on: right === 'outline', onClick: () => toggleRight('outline') },
    { id: 'web', label: '网页', icon: 'globe' as const, on: right === 'web' && !pluginEntries.some((e) => e.on), onClick: () => toggleRight('web') },
    ...pluginEntries,
    { id: 'history', label: '历史', icon: 'history' as const, on: right === 'history', onClick: () => toggleRight('history') },
  ]
  // AI 开着时右下角的入口藏起来，屏上只有一个 AI 的东西；面板头上「收起 ⌘J」收起它
  const aiCorner = aiOn ? null : frame === 'a' ? (
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
      style={{ '--right-w': `${fit.right}px`, ...(!sidebarHidden && (sideW || fit.side !== SIDE_DEFAULT) ? { '--side-w': `${fit.side}px` } : {}) } as React.CSSProperties}
    >
      {!sidebarHidden && <SideSash frame={frame} rightW={fit.right + chromeW - 2 * (frame === 'a' ? 48 : 44)} width={sideW} onWidth={setSideW} />}
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
            const w = Math.round(Math.min(window.innerWidth - chromeW - fit.side - CENTER_MIN, Math.max(RIGHT_MIN, window.innerWidth - abar - e.clientX)))
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
        web={
          activeTab?.type === 'web' && activeTab.id === shown
            ? { where: 'center', onMove: () => (closeTab(activeTab.id), openInWeb(activeTab.url)) }
            : right === 'web' && rightWeb
              ? { where: 'right', onMove: () => moveWebToCenter.current?.() }
              : null
        }
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
        groups={[viewItems, dirItems, dreamItems]}
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
      {trashAsk && <TrashDialog ask={trashAsk} />}
      {barLook && <LookPicker folder={barLook.folder} anchor={barLook.el} onClose={() => setBarLook(null)} />}
      {shownView === 'dream' ? (
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
          onOpenDiff={openDiff}
          onPreviewImages={(id) => open((t) => t.type === 'oldimages' && t.item === id, () => ({ id: newId(), type: 'oldimages', item: id }))}
          onNotice={setNotice}
          onTake={dreamTake}
          onDrop={dreamDrop}
          acting={dreamBusy}
          pv={pv}
        />
        )
      ) : (
        <Sidebar
          view={shownView}
          notes={pv.on ? pv.preview.notes : notes}
          preview={pv.on ? pv : null}
          active={activeTab}
          onOpenNote={(p) => openNote(pv.realPath(p))}
          onOpenInbox={openInbox}
          onOpenRecent={openRecent}
          onOpenArchive={openArchive}
          onAskAi={() => setAiFloat(true)}
          onShowInFiles={showInFiles}
          pins={pins}
          archiveDays={settings.archiveDays}
          onTidy={() => runAi('/整理收件箱')}
          onNewNote={() => void newNote()}
          onNewBoard={() => void newBoard()}
          onOpenFile={openFile}
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
                  className={'tab' + (on ? ' on' : '') + (t.type === 'diff' && !t.pinned ? ' preview' : '')}
                  role="tab"
                  aria-selected={on}
                  data-testid={on ? 'tab-on' : undefined}
                  onDoubleClick={() => (canRenameTab(t) ? setRenaming(t.id) : t.type === 'diff' && setTabs((x) => x.map((y) => (y.id === t.id ? { ...y, pinned: true } : y))))}
                  onContextMenu={(e) => renaming !== t.id && void menuAt(e, tabMenu(t))}
                >
                  {renaming === t.id ? (
                    <span className="tl">
                      {tabIcon(t)}
                      <input
                        className="tab-rename"
                        aria-label={t.type === 'folder' ? '文件夹名字' : '笔记名字'}
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
                    <button className="tl" onClick={() => (setTabs((x) => x, t.id), setSettingsFront(false))} data-tip={canRenameTab(t) ? '双击改名' : t.type === 'diff' && !t.pinned ? '预览：再开一个对比就换掉它，双击固定' : undefined} data-side="below">
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
              onMenu={(e, extra) => onFileMenu(e, t.path, { rename: () => setRenaming(t.id) }, extra)}
              onOpenOutline={() => setRight('outline')}
              onWantRename={() => setRenaming(t.id)}
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
          ) : t.type === 'oldimages' ? (
            (() => {
              const it = dream.report?.items.find((x) => x.id === t.item)
              return it?.oldImages ? (
                <OldImagesTab
                  key={t.id}
                  item={it}
                  active={t.id === shown}
                  busy={dreamBusy}
                  onTake={() => void dreamTake(it)}
                  onDrop={() => void dreamDrop(it)}
                />
              ) : (
                <section key={t.id} className="pane" hidden={t.id !== shown}>
                  <p className="dv-empty">这份梦游报告已经没有这一条了</p>
                </section>
              )
            })()
          ) : t.type === 'diff' ? (
            <DiffTab
              key={t.id}
              src={t.src}
              active={t.id === shown}
              gitVersion={gitVersion}
              onOpen={(p) => openFile(p)}
              onPreviewHtml={(p, dreamSide) => (dreamSide ? open((x) => x.type === 'html' && x.path === p && !!x.dream, () => ({ id: newId(), type: 'html', path: p, dream: true })) : openHtml(p))}
              onNotice={setNotice}
            />
          ) : t.type === 'html' ? (
            <HtmlTab key={t.id} path={t.path} dream={!!t.dream} by={t.dream ? dream.report?.items.find((i) => i.files.includes(t.path))?.by : undefined} active={t.id === shown} onAsk={() => setLower('ai')} onNotice={setNotice} />
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
                onOpenAll={openRecent}
                onOpenFolder={(f) => openFolder(f)}
                onNotice={noticeWithUndo}
                onRename={async (name) => {
                  const f = await renameFolderTo(t.folder, name)
                  if (f) setTabs((x) => x.map((y) => (y.id === t.id && y.type === 'folder' ? { ...y, fresh: false } : y)))
                  return f
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
              onClose={() => closeTab(t.id)}
            />
          ) : t.type === 'home' ? (
            t.id === shown && (
              <HomeView
                key={t.id}
                style={settings.appearance.homeStyle}
                winBg={homeWinBg(settings)}
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
          ) : t.type === 'recent' ? (
            t.id === shown && (
              <RecentPage
                key={t.id}
                notes={pv.on ? pv.preview.notes : notes}
                pins={pins}
                archiveDays={settings.archiveDays}
                activePath={null}
                onOpen={(p) => openNote(pv.realPath(p))}
                onCreate={async (title) => {
                  try {
                    const path = await window.cn.createNote(INBOX, title, `# ${title}\n\n`)
                    refreshNotes()
                    openNote(path)
                  } catch (e) {
                    setNotice(errText(e))
                  }
                }}
              />
            )
          ) : t.type === 'archive' ? (
            t.id === shown && (
              <NoteIndex
                key={t.id}
                which="archive"
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
      {historyOpen && <HistoryPanel version={gitVersion} changes={git?.changes ?? []} autoMinutes={git?.autoCommitMinutes ?? 0} onCommit={commit} onClose={() => setRight(null)} onOpenDiff={openDiff} />}
      <WebPanel
        hidden={right !== 'web'}
        owner={active}
        clipMode={clipMode}
        openRequest={webOpen}
        onShow={() => setRight('web')}
        onUrl={(u) => {
          setRightWeb(u)
          if (active) setWebUrl((m) => (m[active] === (u ?? undefined) ? m : { ...m, [active]: u ?? '' }))
        }}
        moveToCenter={moveWebToCenter}
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
          onNotice={setNotice}
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
        jobs={[...(dream.running ? [{ id: 'dream', icon: 'wand' as const, text: '梦游在整理', onClick: () => openLeft('dream') }] : []), ...askJobs.map((j) => ({ id: `ask-${j.id}`, icon: 'note' as const, text: j.text }))]}
        previewing={pv.on}
        onCommit={commit}
        onSync={sync}
        onHistory={() => setRight('history')}
        onOpen={(p) => openNote(p)}
        unsaved={unsaved}
        vaultPath={vault.path}
        update={<UpdateBarItem st={update} onInstall={installUpdate} onOpenSettings={() => openSettings('update')} />}
        ai={frame === 'a' ? aiCorner : undefined}
        toast={
          notice && (
          <div className={'toast-cn' + (undoable || actable ? ' with-act' : '')} role="status" data-testid="toast" onMouseEnter={() => setNoticeHover(true)} onMouseLeave={() => setNoticeHover(false)}>
            <span data-tip={notice}>{notice}</span>
            {undoable && (
              <button className="btn btn-ghost btn-sm" data-tip="撤回" data-key="⌘Z" onClick={runNoticeUndo}>
                <Codicon name="discard" size={14} />
                撤回
              </button>
            )}
            {actable && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  noticeAct!.run()
                  setNotice(null)
                  setNoticeAct(null)
                  setNoticeHover(false)
                }}
              >
                <Codicon name={noticeAct!.icon} size={14} />
                {noticeAct!.label}
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
    case 'recent':
      return '最近'
    case 'archive':
      return '归档'
    case 'topic':
      return t.topic
    case 'diff':
      return t.title
    case 'oldimages':
      return '梦游预览 · 挪老图'
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
  recent: 'clockface',
  archive: 'archive',
  topic: 'folder',
  diff: 'git-compare',
  oldimages: 'wand',
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
    case 'recent':
      return ['最近']
    case 'archive':
      return ['归档']
    case 'topic':
      return [CLIPS, t.topic]
    case 'web':
    case 'webread':
      return [t.title || hostOf(t.url)]
    case 'diff':
      return [t.src.kind === 'dream' ? '梦游报告' : t.src.kind === 'pair' ? '可能重复' : '历史', t.title]
    case 'oldimages':
      return ['梦游预览', '挪老图']
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
      <p>笔记就是这个文件夹里的md文件；没有Git的话会帮你建一个。</p>
      <button className="btn btn-primary" onClick={onOpen}>
        <Codicon name="folder-opened" size={14} />
        打开文件夹
      </button>
    </div>
  )
}
