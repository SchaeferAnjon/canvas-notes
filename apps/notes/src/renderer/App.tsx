import { composing } from './ime'
import { jumpToChat } from '@cn/ai-chat/chat-jump'
import { Codicon, type CodiconName } from '@cn/design'
import { askUnits } from '@cn/format'
import { PanelGuard } from './crash/Guard'
import { dropped } from './crash/report'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DreamItem, DreamReport, GitState, NoteFile, StrandedNote, TrashItem, VaultInfo } from '../shared/api'
import { CLIPS, INBOX, titleOf } from '../shared/layout'
import { AiDock, NotesDock } from './AiDock'
import { EngineLogo, useChatEngine } from './engine-logo'
import { contextOf, useAiBridge } from './ai-bridge'
import { DreamPanel } from './dream/DreamPanel'
import { GrowthTab } from './growth/GrowthTab'
import { setGrowth } from './growth/store'
import { PreviewOverlay, useDreamPreview } from './dream/preview'
import { expectDreamChange } from './dream/own-change'
import { dreamPaths, pendingOf, useDream } from './dream/useDream'
import { ActivityBar, type BarItem, MenuItem, Popover, TitleBar, Tooltips } from './shell/Shell'
import { DockFrame, gridTracks, startCenterColDrag } from './shell/Dock'
import { layoutSig, liveMax, maxColumns, parseMax, type Max } from './shell/max'
import { MaxButton, MaxHint } from './shell/MaxButton'
import * as Dk from '../shared/dock'
import { StatusBar } from './shell/StatusBar'
import { BellItem, logNotice, TranslateItem } from './shell/StatusExtras'
import { OutlineView } from './shell/OutlineView'
import { RelatedView } from './shell/RelatedView'
import { ActsSlot, noteLeavers, noteRenamers } from './shell/TabActs'
import { revealLeft, snapLeft, tabEdges, tabTail } from './shell/tab-scroll'
import { onFileMenu } from './ctx/file-menu'
import { app, setAppActions } from './ctx/actions'
import { pickForAi } from './ai-pick'
import { copy, type MenuEntry, menuAt, setMenuNotice } from './ctx/menu'
import { reloadHome, resetHome } from './home-store'
import { HomeView } from './HomeView'
import { HistoryPanel } from './HistoryPanel'
import { CompareTab, openFirstDream, useDreamWiring } from './dream/wire'
import { getProposal } from './commands/proposals'
import { OldImagesTab } from './dream/OldImages'
import type { DiffSource } from '../shared/diff'
import { UpdateBarItem, useUpdateState } from './update'
import { ListView } from './ListView'
import type { ViewMode } from './note-doc'
import { NoteIndex } from './NoteIndex'
import { RecentPage } from './RecentPage'
import { pickTrash, TrashPage, TrashPanel } from './TrashPage'
import { t } from '../shared/i18n'
import { loadTrashImages, type TrashAsk, TrashDialog } from './TrashDialog'
import { NoteTab, primeNote } from './NoteTab'
import { holdTyping } from './new-note-hold'
import { COURSES, INBOX_DIR, Sidebar, type SideView, viewName } from './Sidebar'
import { INBOX_WARN } from '../shared/sidebar'
import { NoteDoc } from './note-doc'
import { EditorView } from '@codemirror/view'
import { flashRange } from './insert-flash'
import { goToLine } from './goto-line'
import { TodoPanel } from './todo/TodoPanel'
import { TodoHome } from './todo/TodoHome'
import { CalendarPage, CalendarSide } from './calendar/CalendarPage'
import { DOC_OWNER, TodoPop } from './todo/TodoList'
import { refreshTodos, useTodayCount } from './todo/store'
import { isTodoNote, todoLabel } from '../shared/todo'
import { isBookDigest } from '../shared/plugins/weread'
import { Palette, type PaletteCommand } from './Palette'
import { QuickOpen } from './search/QuickOpen'
import { fileOpened, markRestored, refreshVaultFiles, requestReveal, treePicked, useTrashCount, useVaultFiles, vaultFiles } from './files/store'
import { noteMovedTo } from './files/move-pick'
import { DRAG_ITEM, draggedItem } from './folder-home/drag-item'
import { allFolders } from './ctx/move-menu'
import { loadLeft, setHomeLooks, updateLeft, useLeft } from './files/left-store'
import { loadDescs } from './files/category-store'
import { folderLabel, setVaultName } from './vault-name'
import { CATEGORY_NAMES, catName, groupLeft } from '../shared/categories'
import { FolderGlyph, LookPicker } from './files/look'
import { dropLeft, moveLeft, presetsOn, putLeft, takeLeft } from '../shared/left'
import { DRAG_DIR, draggedFolder } from './files/FileTree'
import { leftConfig } from './files/left-store'
import { usePluginCommands, usePluginEntries } from './plugins'
import { loadCmds, noteUsed, setRegistry, useCmds } from './search/cmd-store'
import { accelFor, keyFor, PaneFocus, replayAppKey, runAppKey, runLocal, setAppRunner, WEB_ESC, withKeys } from './keys'
import * as Sp from '../shared/center-split'
import { SplitSash, type SplitDrop, useTabDrag } from './shell/CenterSplit'
import { runFindInPage } from './find/find-hub'
import { keyDef } from '../shared/cmd-table'
import type { OwnCommand } from '../shared/commands'
import { aiCmdJson, aiCmdOf, tagsOf } from '../shared/ai-cmds'
import { CmdEditorHost } from './commands/SaveCmd'
import { useLocalAiCmds } from './commands/store'
import { SaveReplyHost } from './replies/save-reply'
import { Settings, type SettingsPage } from './Settings'
import { homeWinBg, useAppSettings } from './theme'
import { appSettings, publishSettings } from './settings-store'
import { pageOf } from '../shared/settings-index'
import { VIDEO_SUBS_EVENT, WEB_EXTENSIONS_EVENT } from './settings/jump'
import { applyEditorPrefs } from './editor-prefs'
import { fileName, fixedFolder, folderOfPath, isBaseFolder } from '../shared/files'
import { fitPanels, loadSideW, RIGHT_MIN, SIDE_DEFAULT, SideSash } from './shell/SideSash'
import { loadTabs, newId, retargetTabs, saveTabs, type Tab, tabsOutside } from './tabs'
import { CLIP_PAGE_EVENT, hostOf, WebPanel, type WebDeskApi } from './WebPanel'
import { WebNotes } from './web-notes/WebNotes'
import { WhereHost } from './web-notes/Where'
import { anchorOf, boxIntoConvo, CLIPPED, clipWeb, ensureAsk, type NoticeAct, pickTarget, setWebNotesHost } from './web-notes/flow'
import { readSrc } from '../shared/ai-chats'
import { convoFor } from './ai-web-stay'
import { FullChip } from './web/FullChip'
import { refreshWebNotes, setBridgeCenter, setMarkHandler } from './web-notes/bridge'
import { targetOf, useTargets } from './web-notes/target'
import { parseFragment } from '../shared/web-link'
import { openTranslateSettings } from './plugins/translate/shared'
import type { PagePos } from '../shared/read-along'
import { type BookRequest, followNote, setReadAlongHost, unpairNote } from './read-along/pairing'
import { ReadAlongLayer, openPairPop, unpairLabel } from './read-along/ReadAlongLayer'
import { DeskDialogHost, DeskPanel, openDeskDialog } from './read-along/Desks'
import { backToBefore, deskChanged, openDesk, quietAway, setDeskHost } from './read-along/desk-ops'
import { awayNow, flushPositions, loadAway, loadDesks, loadPositions, noteCoOpen, notesOfUrl, pairOf, rightPage, setPairNotes, useAway, useDesks, usePairs } from './read-along/store'
import { WebTab } from './web/WebTab'
import { CaptureHost } from './mindmap/CaptureSheet'
import { captureHere } from './mindmap/place'
import { ImportHost } from './importer/ImportSheet'
import { openImport } from './importer/store'
import { PdfTab } from './reading/PdfTab'
import { CardsHost } from './reading/CardsDialog'
import { MergeHost } from './feynman-after/MergeCheck'
import { useCardCommands } from './reading/card-commands'
import { HtmlTab } from './reading/HtmlTab'
import { WebReadTab } from './reading/WebReadTab'
import { clearWebBox, onOpenWebRead, onWebBox } from './reading/web-bridge'
import * as Reading from './reading/store'
import type { PdfFile } from '../shared/reading'
import type { FolderEntry } from '../shared/folder-home'
import { FolderHomeView } from './folder-home/FolderHomeView'
import { onOpenFolderHome, openFolderHome } from './folder-home/store'
import { type AskFrom, setCenter, useSavedToast, videoHost } from './video/store'
import { useAskJobs } from './video/ask-pending'
import { VideoToast } from './video/VideoToast'
import { VIDEO_FOLDER, videoOf } from '../shared/video'
import { list, t as tNow, tv } from '../shared/i18n'
import { useT } from './i18n'
// 四条栏的骨架最后加载，盖过各组件自己的旧摆法
import './shell/shell.css'
import '@cn/design/wall.css'
import './shell/winbg.css'
import { RecordPeek, RecordTools } from './base/RecordPeek'
import { onRecordOpen, useRecord } from './base/record-open'
import { AiColPane, useAiColTitle } from './base/AiColPane'
import { AutoPane, useAutoTitle } from './base/AutoPane'
import { closeAuto, onAutoOpen, wireAuto } from './base/auto-state'
import { closeAiCol, onAiColOpen } from './base/ai-col'

/** 当前栏（CN-98 方向 A）：左栏、中间，或右边的一组标签（工作区里一组、一个浮窗的 id） */
type Pane = string

/**
 * 点了哪、焦点到了哪是哪一栏：按窗口里那一块（.win 的直接子元素）认，不靠 document.activeElement
 * （历史、大纲这类格子拿不到焦点）。图标栏、标题栏、底栏不算（点它们不换当前栏）
 */
function paneOf(target: EventTarget | null): Pane | null {
  const el = target instanceof Element ? target : null
  if (!el) return null
  // 右边的一组（组头、浮窗，摆在组上的内容 .dview 记着它在哪一组）
  const g = el.closest('[data-group]')
  if (g) return g.getAttribute('data-group')
  const top = el.closest('.win > *')
  if (!top) return null
  if (top.matches('.side')) return 'left'
  if (top.matches('main.center')) return 'center'
  return null
}

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 标签上能改名的：笔记；文件夹首页（最外层固定的生活、写作除外） */
const canRenameTab = (t: Tab) => t.type === 'note' || (t.type === 'folder' && !fixedFolder(t.folder))

/** 标签条里每个标签在内容里的左边和宽（量 getBoundingClientRect，缩放、小数都对得上） */
function tabBoxes(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return [...el.querySelectorAll<HTMLElement>(':scope > .tab')].map((t) => {
    const b = t.getBoundingClientRect()
    return { left: b.left - r.left + el.scrollLeft, width: b.width }
  })
}

export function App() {
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined)
  /** 开库、读设置没成（以前这里一直画空的：白屏，task-pyb39）：抛给整窗兜底，显示出错页 */
  const [failed, setFailed] = useState<{ error: unknown } | null>(null)
  useEffect(() => {
    // 设置先读好再画书桌：「打开时回到上次的样子」、字号这些第一帧就要用
    void Promise.all([window.cn.vault(), window.cn.settings()]).then(
      ([v, s]) => {
        publishSettings(s)
        setVault(v)
      },
      (error: unknown) => setFailed({ error }),
    )
  }, [])
  if (failed) throw failed.error
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
  const t = useT()
  // 设置 › 文档和白板：字体、字号、行距、版心、白板点阵、拼写检查，改了开着的文档当场跟着变
  useEffect(() => applyEditorPrefs(settings.editor), [settings.editor])
  /** 设置面板开着哪一页（⌘, 打开） */
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null)
  /** 上次看的那一页（⌘, 打开它；第一次是「外观」，同 0.4.6） */
  const lastSettingsPage = useRef<SettingsPage>('look')
  useEffect(() => {
    if (settingsPage) lastSettingsPage.current = settingsPage
  }, [settingsPage])
  /** 要翻到、闪一下的那一行（搜索回车、从用的地方跳过来） */
  const [settingsFocus, setSettingsFocus] = useState<{ row: string; seq: number } | null>(null)
  /** 打开设置的某一页（不给就是上次那页）：A 是中间一个标签（放到前面），B 是弹窗；⌘, 再按一次收起。row：翻到那一行、闪 1.6 秒 */
  function openSettings(page?: SettingsPage, toggle = false, row?: string) {
    const to = page ?? lastSettingsPage.current
    setSettingsFocus(row ? { row, seq: Date.now() } : null)
    if (settings.appearance.frame === 'a') {
      if (toggle && settingsPage && settingsFront) return setSettingsPage(null)
      setSettingsFront(true)
      setSettingsPage(to)
    } else setSettingsPage((p) => (toggle && p ? null : to))
  }
  /** 翻到设置里的某一行（shared/settings-index.ts 的 id） */
  const openSettingsAt = (row: string) => {
    const page = pageOf(row) ?? (row.startsWith('k-') ? 'keys' : null)
    if (page) openSettings(page, false, row)
  }
  const openSettingsRef = useRef({ openSettings, openSettingsAt })
  openSettingsRef.current = { openSettings, openSettingsAt }
  const [notes, setNotes] = useState<NoteFile[]>([])
  // 哪几篇和网页配成了一对（属性 read-along，task-kbnc0）：目录树、网页标签上的小标、点开时网页跟着开都看它
  useEffect(() => setPairNotes(notes), [notes])
  // 退出、关窗口前：等着写的读到哪马上写
  useEffect(() => {
    const off = () => void flushPositions()
    window.addEventListener('beforeunload', off)
    return () => window.removeEventListener('beforeunload', off)
  }, [])
  /** 置顶的笔记（库里 .canvas-notes/置顶.json） */
  const [pins, setPins] = useState<string[]>([])
  // 库名：最外层写库名（CN-106）；子组件、编辑器里的位置条从 vault-name 拿
  setVaultName(vault.name)
  const [{ tabs, active }, setTabState] = useState(() => {
    // 设置 › 一般「打开时回到上次的样子」关着：从首页开始，不接上次开着的标签
    const t = appSettings().general.reopen ? loadTabs(vault.path, (why) => dropped('tabs', why)) : { tabs: [], active: null }
    // 打开时整理了顶级分类（素材/ → 剪藏/、素材/微信读书/ → 阅读/）：上次开着的标签换成新路径
    for (const m of vault.organized ?? []) t.tabs = retargetTabs(t.tabs, m.from, m.to)
    // 整理了「一个 PDF 一篇笔记」：改名的、合进去的换成新路径，删掉的「我的疑惑.md」关掉
    for (const m of vault.tidied?.moves ?? []) t.tabs = m.to ? retargetTabs(t.tabs, m.from, m.to) : t.tabs.filter((x) => !('path' in x && x.path === m.from))
    if (!t.tabs.some((x) => x.id === t.active)) t.active = t.tabs[t.tabs.length - 1]?.id ?? null
    if (t.tabs.length) return t
    const home: Tab = { id: newId(), type: 'home' }
    return { tabs: [home], active: home.id }
  })
  /**
   * 中间栏分屏（照 VS Code、Obsidian，规则 design/split/README.md）：标签还是上面那一串，这里记哪些在第二格、
   * 不是当前格的那一格前面是哪个、分隔条在几成；记在本机（cn.split:<库>），关了再开照旧。当前格前面的就是 active
   */
  const splitKey = `cn.split:${vault.path}`
  const [split, setSplitState] = useState<Sp.Split | null>(() => {
    if (!appSettings().general.reopen) return null
    let raw: string | null = null
    try {
      raw = localStorage.getItem(splitKey)
    } catch {
      // 本机存储打不开：从一格开始
    }
    const s = Sp.parseSplit(raw)
    const ids = tabs.map((t) => t.id)
    return Sp.settle(s, ids, active, { ids, active, focus: Sp.paneOf(s, active) })
  })
  const splitNow = useRef(split)
  const setSplit = (s: Sp.Split | null) => {
    splitNow.current = s
    setSplitState(s)
  }
  /** 上一次对上时的标签、当前标签、当前格：新开的标签落在哪一格、换格时另一格前面换成哪个 */
  const splitPrev = useRef<Sp.Prev>({ ids: tabs.map((t) => t.id), active, focus: Sp.paneOf(split, active) })
  useLayoutEffect(() => {
    const ids = tabs.map((t) => t.id)
    const next = Sp.settle(splitNow.current, ids, active, splitPrev.current)
    splitPrev.current = { ids, active, focus: Sp.paneOf(next, active) }
    if (next !== splitNow.current) setSplit(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, active, split])
  useEffect(() => {
    try {
      if (split) localStorage.setItem(splitKey, JSON.stringify(split))
      else localStorage.removeItem(splitKey)
    } catch {
      // 记不住只影响下次打开
    }
  }, [split, splitKey])
  /** 重开软件时恢复的宽网页标签：点开才载入，视频不自己播（task-0t4jq） */
  const [restoredWeb] = useState(() => new Set(tabs.filter((t) => t.type === 'web').map((t) => t.id)))
  /**
   * 工作区布局（2026-11-20 方向 A「拖到哪就在哪」，shared/dock.ts、shell/Dock.tsx）：右栏里网页、笔记、AI、大纲、历史都是标签，
   * 开着哪几样、在哪一栏哪一组、浮窗在哪都记在本机（cn.dock，一台机器一套）；以前的 cn.aiOpen、cn.rightW 第一次读的时候换成它。
   * 打开 PDF 不自己开 AI；框一块、点工具条、右键「问 AI」、AI 命令才开
   */
  const [dock, setDockState] = useState<Dk.Dock>(() => {
    // 不回到上次的样子：右栏也不接上次开着的网页、AI
    if (!appSettings().general.reopen) return Dk.emptyDock()
    try {
      return Dk.loadDock(localStorage.getItem('cn.dock'), { aiOpen: localStorage.getItem('cn.aiOpen'), rightW: localStorage.getItem('cn.rightW') }, (why) => dropped('dock', why))
    } catch {
      return Dk.emptyDock()
    }
  })
  /** 最新的布局（同一下里连着改几次时按最新的改） */
  const dockNow = useRef(dock)
  const setDock = (f: Dk.Dock | ((d: Dk.Dock) => Dk.Dock)) => {
    const next = typeof f === 'function' ? f(dockNow.current) : f
    if (next === dockNow.current) return
    dockNow.current = next
    setDockState(next)
  }
  useEffect(() => {
    try {
      localStorage.setItem('cn.dock', JSON.stringify(dock))
    } catch {
      // 记不住只影响下次打开
    }
  }, [dock])
  /** 开一个标签（开着在后面就换到它）；cur：它那一组成了当前栏 */
  const openView = (v: Dk.ViewId, cur = true) => {
    setDock((d) => Dk.openView(d, v))
    const f = Dk.findView(dockNow.current, v)
    if (cur && f) setPane(f.group.id)
  }
  const closeView = (v: Dk.ViewId) => setDock((d) => Dk.closeView(d, v))
  /**
   * 打开 AI 标签。当前栏不换（同以前的右栏下格）：在 PDF 上框一块问、文档里选字问 AI 时 AI 顺手开出来，⌘W 关的还是刚才在看的那页；
   * 焦点进了 AI 的输入框（⌘J、右下角圆钮）才算 AI 那一组
   */
  const openAi = () => openView('ai', false)
  /** 库里的 PDF（⌘K 里能搜到、能打开） */
  const [pdfs, setPdfs] = useState<PdfFile[]>([])
  /** 有首页的文件夹：左栏「文件夹」、标签图标 */
  const [folders, setFolders] = useState<FolderEntry[]>([])
  /** 左栏收起来了（红绿灯旁的按钮或 ⌘\\），记在本机 */
  /** 左栏宽度：拖过才有（没拖过用 CSS 里的默认：A 252，B 248）；记在本机 */
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
  /**
   * 每一栏都能占满（shell/max.ts，用户 2026-11-24「每个框都能占满」）：中间那栏或其中一格、右边一组、浮窗盖住整个窗口，别的栏原地看不见。
   * 网页那一组占满时就是以前的「网页占满」（task-kbnc0、task-05p2w）：中间那篇还开着（看不见），网页上剪的、记下这一刻、框一块问照样写进它。
   * 各栏标签条右边那颗、⌃⌘\（当前这栏）、双击标签条空处、网页 ⋯ 是同一个开关（toggleMax）；记在本机（以前的 cn.centerFold 当网页占满接着用）
   */
  const [max, setMax] = useState<Max | null>(() => {
    try {
      return parseMax(localStorage.getItem('cn.max')) ?? (localStorage.getItem('cn.centerFold') === '1' ? { kind: 'web' } : null)
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('cn.max', JSON.stringify(max))
      localStorage.removeItem('cn.centerFold')
    } catch {
      // 记不住只影响下次打开
    }
  }, [max])
  /** 中间那栏让给了右边一组（还没对上布局，先这么算：网页的笔记目标不选看不见的那篇） */
  const centerFold = !!max && max.kind !== 'center'
  /** 中间要看得见（左栏点一篇、开生长图、看一眼）：右边一组占满着就回原样；中间自己占满不动 */
  const showCenter = () => setMax((m) => (m && m.kind !== 'center' ? null : m))
  /** 网页占满时（task-05p2w 方向 A）：地址栏小牌里选了「这一阵剪进收件箱」、占满以后剪了几条；还原就清掉 */
  const [fullInbox, setFullInbox] = useState(false)
  const [fullCount, setFullCount] = useState(0)
  /** 占满时在小牌里「换一篇…」选的那篇（这一阵剪进它，配对、选过的都不管） */
  const [fullPick, setFullPick] = useState<string | null>(null)
  /** 左边图标栏选中的那一页，记在本机；默认「最近」 */
  const [leftView, setLeftViewState] = useState<SideView>(() => {
    try {
      const v = localStorage.getItem('cn.leftView')
      // 2026-11-17 以前的「课程和文件夹首页」「收件箱」是现在摘在左边的课程、收件箱两格
      if (v === 'folders') return `dir:${COURSES}`
      if (v === 'inbox') return `dir:${INBOX_DIR}`
      // 整理了顶级分类：摘在左边的「素材/微信读书」这一格现在是「阅读」
      let view = v
      for (const m of vault.organized ?? []) if (view && (view === `dir:${m.from}` || view.startsWith(`dir:${m.from}/`))) view = `dir:${m.to}${view.slice(4 + m.from.length)}`
      return view === 'files' || view === 'todo' || view === 'calendar' || view === 'recent' || view === 'dream' || view === 'desks' || view === 'trash' || view?.startsWith('dir:') ? (view as SideView) : 'recent'
    } catch {
      return 'recent'
    }
  })
  /** 左栏摘了哪些文件夹（.canvas-notes/左栏.json）；文件变了重读 */
  const leftCfg = useLeft()
  useEffect(() => {
    void loadLeft()
    void loadPositions()
    void loadDesks()
    loadAway(vault.path)
    void loadDescs()
    void loadCmds()
    return window.cn.onFilesChanged(() => (void loadLeft(), void loadDescs(), void loadCmds(), void loadPositions(), void loadDesks()))
  }, [])
  /** ⌘K 的自定义（.canvas-notes/命令.json）：自己加的命令、改过的快捷键 */
  const cmdCfg = useCmds()
  /** 只在这台 Mac 上的 AI 命令（task-9womr）：和库里的一样进 ⌘K「让AI做」、能设快捷键 */
  const localAiCmds = useLocalAiCmds()
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
  /** 活动栏右键「换图标和颜色…」：贴着那一格弹 */
  const [barLook, setBarLook] = useState<{ folder: string; el: HTMLElement } | null>(null)
  /** 摘出来的文件夹底下、活动栏右键「在「文件」里看位置」：换到「文件」，展开到它，一圈外圈 */
  const showInFiles = (folder: string) => {
    requestReveal(folder)
    openLeft('files')
  }
  /** 右键「放到左边」、从树里拖到活动栏（task-wniqx，before：放到那一格前面）：摘到活动栏，换到它那一格；底部能撤回 */
  const putOnLeft = (folder: string, before: string | null = null) => {
    const was = leftConfig()
    if (was.left.includes(folder)) return
    void updateLeft((c) => putLeft(c, folder, before))
    // 和点那一格一样：左栏是它那一枝，中间开它的首页（原型、图 3-放上去以后）
    openLeft(`dir:${folder}`)
    openFolder(folder)
    noticeWithUndo(tNow('「{name}」放到左边了：图标栏多了一格', { name: folder.split('/').pop() }), () => void updateLeft(() => was))
  }
  /** 图标栏上点亮着的那个 = 收起左栏 */
  const toggleLeft = (v: SideView) => (!sidebarHidden && shownView === v ? setSidebarHidden(true) : (openLeft(v), setPane('left')))
  /** 库菜单、设置菜单（左下角）：贴着点它的按钮弹出 */
  const [menu, setMenu] = useState<{ kind: 'vault' | 'gear'; el: HTMLElement } | null>(null)
  const [git, setGit] = useState<GitState | null>(null)
  /** 标签条右端：每页自己的动作挂在这里（shell/TabActs） */
  const [actsEl, setActsEl] = useState<HTMLDivElement | null>(null)
  /** 中间栏分成两格时第二格标签条右端的动作（中间栏分屏） */
  const [acts2El, setActs2El] = useState<HTMLDivElement | null>(null)
  /** 正在标签上改名的那个标签（双击标签、F2、面包屑最后一节、「更多 › 改名」） */
  const [renaming, setRenaming] = useState<string | null>(null)
  /** AI 对话用的是哪家：右下角圆钮、A 底栏那一项画它的标志、写它的名字（设置里一换当场跟着换，CN-127） */
  const chatEngine = useChatEngine()
  /** 方向 A：设置开成中间的一个标签，这个标签在前面时为 true */
  const [settingsFront, setSettingsFront] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** 打开库时整理了一次「一个 PDF 一篇笔记」：底栏左边一句，带「撤回」，关掉之前一直在 */
  const [tidy, setTidy] = useState(vault.tidied ?? null)
  useEffect(() => {
    if (vault.tidyError) setNotice(tNow('整理「我的疑惑」和笔记没成功：{err}', { err: vault.tidyError }))
  }, [])
  /** 提示后面带的「撤回」：只跟着那一句（别处换了提示就不显示） */
  /** noKey：⌘Z 不当成点「撤回」（关标签、收起一格的撤回：⌘Z 留给文档里撤字） */
  const [noticeUndo, setNoticeUndo] = useState<{ text: string; run(): void; noKey?: boolean } | null>(null)
  /** 首页卡里拖来的一份正停在哪个文件夹首页的标签上（task-r00en）：那个标签亮 */
  const [tabDrop, setTabDrop] = useState<string | null>(null)
  useEffect(() => {
    if (!tabDrop) return
    // 按 esc 取消、松在别处：dragend 只发给拖起来的那一份，标签收不到，冒泡到 window 时收起（同图标栏的落点）
    const end = () => setTabDrop(null)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => (window.removeEventListener('dragend', end), window.removeEventListener('drop', end))
  }, [!!tabDrop])
  const noticeWithUndo = (text: string, run?: () => void) => {
    setNotice(text)
    setNoticeUndo(run ? { text, run } : null)
  }
  /** 从左边拿下（活动栏右键、树上文件夹右键）：底部能撤回（放回原来的位置） */
  const takeOffLeft = (f: string) => {
    const before = leftCfg
    void updateLeft((c) => takeLeft(c, f))
    noticeWithUndo(tNow('「{name}」从左边拿下了；文件夹没动，右键文件夹「放到左边」能放回', { name: f.split('/').pop() }), () => void updateLeft(() => before))
  }
  /** 关标签、收起一格（CN-98）：提示条带「撤回」，⌘Z 不当成点它（留给文档里撤字） */
  const noticeClosed = (text: string, run: () => void) => {
    setNotice(text)
    setNoticeUndo({ text, run, noKey: true })
  }
  /** 提示前面的小图标（放回了：绿色对勾；说明：info）：也只跟着那一句（CN-108 小样） */
  const [noticeIcon, setNoticeIcon] = useState<{ text: string; icon: CodiconName; ok?: boolean } | null>(null)
  /** 提示后面带的别的按钮（撤回失败后的「在历史里看」）：也只跟着那一句 */
  const [noticeAct, setNoticeAct] = useState<{ text: string; label: string; icon: CodiconName; run(): void } | null>(null)
  /** 那句话后面的第二颗按钮（「这段已经剪过了 · 跳到那一处 · 再剪一份」） */
  const [noticeMore, setNoticeMore] = useState<{ text: string; label: string; icon: CodiconName; run(): void } | null>(null)
  /** 出卡送好了（task-tz7y3）：提示条前面绿色对勾，带「打开Anki」「撤回」 */
  const cardsToast = (t: { text: string; act?: { label: string; run(): void }; undo?: () => void }) => {
    setNotice(t.text)
    setNoticeIcon({ text: t.text, icon: 'pass-filled', ok: true })
    setNoticeAct(t.act ? { text: t.text, label: t.act.label, icon: 'link-external', run: t.act.run } : null)
    setNoticeUndo(t.undo ? { text: t.text, run: t.undo } : null)
  }
  /** 梦游撤不回：说原因，「撤回」换成「在历史里看」（打开右栏历史，那次收下在里面） */
  const undoFailed = (e: unknown) => {
    const text = errText(e)
    setNotice(text)
    setNoticeUndo(null)
    setNoticeAct({ text, label: tNow('在历史里看'), icon: 'history', run: () => openView('history') })
  }
  /** ⌘J、右键「问 AI」带进 AI 输入框的那一段（成为第一块引用，src 是来源「《文档标题》」） */
  const [aiDraft, setAiDraft] = useState<{ text: string; src: string; seq: number } | null>(null)
  /** 历史开着（在哪一组、在不在前面都算）：挂上历史面板 */
  const historyOpen = Dk.isOpen(dock, 'history')
  /** 当前栏（CN-98）：点哪一栏、焦点到哪一栏就是它；⌘W 关的是它里面的东西 */
  const [pane, setPaneState] = useState<Pane>('center')
  const paneNow = useRef<Pane>('center')
  const setPane = (p: Pane) => {
    paneNow.current = p
    setPaneState(p)
  }
  useEffect(() => {
    const on = (e: Event) => {
      const p = paneOf(e.target)
      if (p && p !== paneNow.current) setPane(p)
    }
    // 点进右栏网页正文：宿主页面收不到 pointerdown、focusin，只有窗口的 blur，焦点落到 <webview> 上
    let t = 0
    const onBlur = (e: FocusEvent) => {
      if (e.target !== window) return
      clearTimeout(t)
      t = window.setTimeout(() => {
        const a = document.activeElement
        if (a?.tagName === 'WEBVIEW') on({ target: a } as unknown as Event)
      })
    }
    window.addEventListener('pointerdown', on, true)
    window.addEventListener('focusin', on, true)
    window.addEventListener('blur', onBlur)
    return () => (clearTimeout(t), window.removeEventListener('pointerdown', on, true), window.removeEventListener('focusin', on, true), window.removeEventListener('blur', onBlur))
  }, [])
  /** 竖条上点一格：看得见再点是收起，开着在后面是换到它，没开是开；开了的那一组成了当前栏 */
  const toggleView = (v: Dk.ViewId) => {
    setDock((d) => Dk.toggleView(d, v))
    const f = Dk.findView(dockNow.current, v)
    if (f) setPane(f.group.id)
  }
  /** 上次开的右栏那一样：标题栏最右开回来时什么都没开过就开它（没有就开大纲） */
  const lastRight = useRef<Dk.ViewId>('outline')
  const toggleRightRef = useRef<() => void>(() => undefined)
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
    openView('web')
  }
  /**
   * 回到网页那一段（task-6cxtc，笔记里「↩」那种 #:~:text= 的链接、右栏「笔记」里点一条）：右栏开着这一页就用它，没开新开；
   * 滚到那几句、亮 1.6 秒（读到哪那一套找法，quote 是笔记里引着的全文）
   */
  const openWebAt = (url: string, quote?: string) => {
    const f = parseFragment(url)
    const page = f?.page ?? url.replace(/#.*$/, '')
    setReadReq((x) => ({ book: page, url: page, pos: { url: page, text: f?.text ?? '', before: '', after: '', ratio: 0 }, flash: true, quote: quote ?? f?.text ?? '', seq: (x?.seq ?? 0) + 1 }))
    openView('web', false)
  }
  /**
   * AI 开网页（web_open，右栏还没开网页）：AI 看得见时网页开在 AI 那一组的后面，AI 不被换下去，用户点「网页」看、想两样一起看自己拖开
   * （2026-11-20 用户「右栏别硬切两截」「只开 AI 时占满整栏，保留」）；AI 没露出来时照常开在前面
   */
  const openWebForAi = (url: string) => {
    if (!Dk.isShown(dockNow.current, 'ai')) return openInWeb(url)
    const had = Dk.isOpen(dockNow.current, 'web')
    setWebOpen((r) => ({ url, seq: (r?.seq ?? 0) + 1 }))
    setDock((d) => Dk.addBehind(d, 'web', 'ai'))
    if (had) return
    // 网页开在 AI 后面：底栏说一句，带「看网页」（同「记进笔记」那句的「在笔记里看」）
    const text = tNow('AI在「网页」标签里打开了{host}', { host: new URL(url).host })
    setNotice(text)
    setNoticeUndo(null)
    setNoticeAct({ text, label: tNow('看网页'), icon: 'globe', run: () => openView('web') })
  }
  /**
   * 右栏现在显示的 http(s) 网页（AI 圆钮问的视频、AI 看得到的网页、网页占满时的「记进」小牌都看它）。
   * 以前另记了一份「每个中间标签开着的网页」：在 PDF 上开的视频记在 PDF 标签下，回到别的文档时那一份是空的，
   * 圆钮就当右栏没开视频（task-ajtr9）；右栏自己按中间标签切网页（web-tabs 的 owners），这里只认它现在显示的
   */
  const [rightWeb, setRightWeb] = useState<string | null>(null)
  /** 右栏开一本书读到的地方（点开配好对的笔记、对着看的菜单、书桌，task-kbnc0） */
  const [readReq, setReadReq] = useState<BookRequest | null>(null)
  /** 右栏网页借给书桌的本事、问它现在读到哪 */
  const webDesk = useRef<WebDeskApi | null>(null)
  const webNow = useRef<(() => Promise<PagePos | null>) | null>(null)
  /** 插件在右竖条的格子（微信读书）：网页下面 */
  const pluginEntries = usePluginEntries({ webOpen: Dk.isShown(dock, 'web'), url: rightWeb }, { open: (u, reuse) => openInWeb(u, reuse), close: () => closeView('web') })
  // ---------- 检查更新 ----------
  const update = useUpdateState()
  useEffect(() => window.cn.onUpdateOpen(() => openSettingsRef.current.openSettingsAt('checkNow')), [])
  // AI 出错时「去设置 › AI」（ai-error.tsx）；从用的地方跳过来（PDF、网页「⋯」、底栏「同步」、文件树、文档「⋯」）带着要闪的那一行
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<SettingsPage | { row: string }>).detail
      if (typeof d === 'string') openSettingsRef.current.openSettings(d)
      else openSettingsRef.current.openSettingsAt(d.row)
    }
    window.addEventListener('cn:open-settings', on)
    return () => window.removeEventListener('cn:open-settings', on)
  }, [])
  // 更新后第一次打开：说一句（只一次）
  useEffect(() => {
    if (!update || update.phase === 'off') return
    try {
      const last = localStorage.getItem('cn.lastVersion')
      localStorage.setItem('cn.lastVersion', update.current)
      if (last && last !== update.current) setNotice(tNow('已更新到{v}', { v: update.current }))
    } catch {
      // 记不住就不说
    }
  }, [update?.current, update?.phase === 'off'])
  async function installUpdate() {
    await NoteDoc.saveAll()
    if (!(await window.cn.installUpdate())) setNotice(tNow('新版本还没下载好'))
  }

  /** 让 AI 一打开就跑的命令（首页「让 AI 分一分」、⌘K 里的 AI 命令） */
  const [aiAuto, setAiAuto] = useState<{ text: string; seq: number } | null>(null)
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
    // 待办三处（左边「待办」格、首页待办卡、任务界面）跟着库里的改动重读（task-pd1d1）
    refreshTodos()
    void window.cn.pins().then(setPins)
    // 列表没变就不换（免得整个书桌跟着重画）
    void window.cnReading.listPdfs().then((next) => setPdfs((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next)))
    void window.cnFolder.list().then((next) => setFolders((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next)))
  }, [])

  useEffect(() => {
    refreshNotes()
    refreshGit()
    const again = () => {
      refreshNotes()
      refreshGit()
    }
    // 读 PDF 的回答下面撤回了 AI 那一问的改动：左栏、底栏跟着刷新（AI 对话那边自己调 onChanged）
    window.addEventListener(Reading.AI_CHANGED, again)
    const off = window.cn.onFilesChanged(again)
    return () => {
      off()
      window.removeEventListener(Reading.AI_CHANGED, again)
    }
  }, [refreshNotes, refreshGit])
  /** 哪都写不进去、字只在内存里的那几篇（底栏「N篇写不进去，字只在内存里」；stash：设置目录里的备份） */
  const [unsaved, setUnsaved] = useState<StrandedNote[]>([])
  useEffect(() => NoteDoc.onFailing(() => setUnsaved([...NoteDoc.failing].map((d) => ({ path: d.path, stash: d.stash })))), [])
  // 原文件写不进去、字另存成了一篇：编辑器已经指向那篇，标签跟过去（标签上标明「原文件写不进去，字在这里」）；
  // 提示条说清楚，带「打开另存的」（标签在后台时切过去）
  useEffect(
    () =>
      NoteDoc.onRescued((d, from, why) => {
        const to = d.path
        setTabState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.type === 'note' && t.path === from ? { ...t, path: to } : t)) }))
        refreshNotes()
        const text = tNow('「{name}」写不进去：{why}。字另存成了「{to}」，以后都存在那篇', { name: titleOf(from), why, to: titleOf(to) })
        setNotice(text)
        setNoticeUndo(null)
        setNoticeAct({ text, label: tNow('打开另存的'), icon: 'go-to-file', run: () => openNote(to) })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // 哪都写不进去：字只在内存里，备份进了设置目录。一句说清，先别退出；带「在访达中显示」（看备份）
  useEffect(
    () =>
      NoteDoc.onStranded((d, why) => {
        const stash = d.stash
        const text = stash
          ? tNow('「{name}」写不进去，字只在内存里：{why}。备了一份在软件设置目录，先别退出', { name: titleOf(d.path), why })
          : tNow('「{name}」写不进去，字只在内存里：{why}。备份也没写进去，先别退出', { name: titleOf(d.path), why })
        setNotice(text)
        setNoticeUndo(null)
        setNoticeAct(stash ? { text, label: tNow('在访达中显示'), icon: 'folder-opened', run: () => void window.cn.revealStash(stash) } : null)
      }),
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
        const dir = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : vault.name
        setNotice(titleOf(from) === titleOf(to) ? tNow('「{name}」在外面挪到了{dir}，标签跟过去了', { name: titleOf(to), dir }) : tNow('「{name}」在外面改名成了「{to}」，标签跟过去了', { name: titleOf(from), to: titleOf(to) }))
      }),
    [],
  )

  useEffect(() => saveTabs(vault.path, tabs, active), [vault.path, tabs, active])
  // 换了标签（点标签、从左栏开一篇）：设置标签退到后面
  useEffect(() => setSettingsFront(false), [active])

  /** 现在的提示（异步的删除接着记连删时读） */
  const noticeNow = useRef(notice)
  noticeNow.current = notice
  // 说过的每一句记进通知铃（A 底栏右端），提示条收了还能再看
  useEffect(() => {
    if (notice) logNotice(notice)
  }, [notice])
  // 主进程要说的话（自动同步、打开库时先拉）：听上以后先把排着的取走
  useEffect(() => {
    const off = window.cn.onMainNotice((t) => setNotice(t))
    void window.cn.takeNotices().then((list) => list.length && setNotice(list[list.length - 1]!))
    return off
  }, [])
  // 右栏网页里的下载（设置 › 网页和视频「下载放在」）：下好了说放哪、能在访达中显示；没下成说一句
  useEffect(
    () =>
      window.cn.onDownloaded((d) => {
        if (!d.path) return setNotice(d.state === 'cancelled' ? tNow('「{name}」没下载成：取消了', { name: d.name }) : tNow('「{name}」没下载成：网络断了或网站拒绝了', { name: d.name }))
        const text = tNow('下载好了：{name}', { name: d.name })
        setNotice(text)
        setNoticeAct({ text, label: tNow('在访达中显示'), icon: 'search', run: () => void window.cn.revealDownload(d.path!) })
      }),
    [],
  )
  /** 鼠标停在提示条上：不计时（读完再点「撤回」） */
  const [noticeHover, setNoticeHover] = useState(false)
  const undoable = !!notice && noticeUndo?.text === notice
  // 「放回」那句两个都带：「打开文件夹」「撤回」
  const actable = !!notice && noticeAct?.text === notice
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
    if (!undoable || noticeUndo?.noKey) return
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
  /** 点了书桌、换了一整套（底栏「已切到书桌「…」· 回到刚才」那句在）：焦点不在文档、输入框里时 ⌘Z 就是回到刚才；提示条自己带「撤回」时让给它 */
  const away = useAway()
  const awayKeyOn = !!away && !away.quiet && !(undoable && !noticeUndo?.noKey)
  useEffect(() => {
    if (!awayKeyOn) return
    // 换上来的那篇光标在里面、还没打字：⌘Z 也是回到刚才（同提示条的撤回）；打过字就是撤字
    let typed = false
    const onInput = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.('.cm-editor')) typed = true
    }
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== 'z' || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('.cm-editor') ? typed : target?.closest?.('input, textarea, [contenteditable="true"], main.center')) return
      e.preventDefault()
      e.stopPropagation()
      backToBefore()
    }
    window.addEventListener('beforeinput', onInput, true)
    window.addEventListener('keydown', onKey, true)
    return () => (window.removeEventListener('beforeinput', onInput, true), window.removeEventListener('keydown', onKey, true))
  }, [awayKeyOn, away])

  /** 现在的标签（监听回调里读，不跟着重挂） */
  const tabsNow = useRef(tabs)
  tabsNow.current = tabs
  const setTabs = (f: (tabs: Tab[]) => Tab[], activate?: string | null) =>
    setTabState((s) => ({ tabs: f(s.tabs), active: activate === undefined ? s.active : activate }))

  const open = useCallback((match: (t: Tab) => boolean, make: () => Tab) => {
    setTabState((s) => {
      // 分成两格时只在当前格里找：另一格开着同一篇，也在当前格再开一个（照 VS Code、Obsidian，左栏点的落在当前格）
      const here = Sp.paneOf(splitNow.current, s.active)
      const found = s.tabs.find((t) => match(t) && Sp.paneOf(splitNow.current, t.id) === here)
      if (found) return { ...s, active: found.id }
      const t = make()
      return { tabs: [...s.tabs, t], active: t.id }
    })
  }, [])

  const openNote = useCallback(
    (path: string, fresh = false, noWeb = false) => {
      open(
        // 刚新建的一定开新标签：盘慢时上一篇新建的还在按标题改名、标签还记着旧路径「未命名」，按路径找会找回它
        // （第 5 轮：给新笔记打的字换掉了上一篇的正文）
        (t) => !fresh && t.type === 'note' && t.path === path,
        () => ({ id: newId(), type: 'note', path, fresh }),
      )
      // 中间栏收着：点一篇就展开（task-kbnc0）
      showCenter()
      // 和网页配成一对的：网页跟着在右栏开到上次读到的那段（task-kbnc0 方向 A）；右键「只打开笔记，网页不跟着开」不跟
      if (!fresh && !noWeb) followNote(path)
    },
    [open],
  )
  const openPdf = useCallback(
    (path: string) => {
      open(
        (t) => t.type === 'pdf' && t.path === path,
        () => ({ id: newId(), type: 'pdf', path }),
      )
      // 设置 › 读PDF「打开PDF时开着AI」（默认关：框一块、点「问AI」才开）
      if (appSettings().pdf.openAi) openView('ai', false)
    },
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
      // 收下的：提示条还带「在历史里看」（task-m552v，demo 的收下提示）
      if (taken) setNoticeAct({ text: done, label: '在历史里看', icon: 'history', run: () => openView('history') })
      noticeWithUndo(
        done,
        taken
          ? () => {
              // 撤回也是软件自己改开着的那篇：提示条说撤回了，不说外部改动
              NoteDoc.expectOwnChange(undo!.touched)
              void NoteDoc.saveAll().then(() => window.cn.dreamUndo({ ids: [undo!.id], taken })).then(
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
    const text = it.oldImages ? (open ? '梦游挪了图，链接已更新' : `老图挪好了，一次提交进了${base}`) : it.commit ? `收下了「${it.title.length > 14 ? it.title.slice(0, 14) + '…' : it.title}」，一次提交进了${base}` : '看过了，没改任何文件'
    // 编辑器里刚打、还没自动保存的字先存盘，和梦游的改动一起合（不然收下后那次保存把梦游改的当成「外面改了」，另出冲突副本）
    return dreamAct(async () => (await NoteDoc.saveAll(), window.cn.dreamTake(it.id)), text, { id: it.id, done: it.oldImages ? '撤回了，老图回到了原处' : '撤回了，又回到待看', touched })
  }
  const dreamDrop = (it: DreamItem) => dreamAct(() => window.cn.dreamDrop(it.id), it.oldImages ? '这一条丢掉了，老图都留在原处' : `丢掉了「${it.title.length > 14 ? it.title.slice(0, 14) + '…' : it.title}」，这条不会进${dream.report?.base ?? 'main'}`)
  /** 对比标签（CN-48）：已经开着同一个就切过去；不然换掉还没固定的那个预览标签（斜体），都没有就新开一个 */
  const openDiff = useCallback((src: DiffSource, title: string) => {
    const same = (t: Tab) => t.type === 'diff' && JSON.stringify({ ...t.src, focus: undefined }) === JSON.stringify({ ...src, focus: undefined })
    setTabState((s) => {
      const hit = s.tabs.find(same)
      if (hit) return { tabs: s.tabs.map((t) => (t.id === hit.id ? { ...t, src } : t)) as Tab[], active: hit.id }
      // AI 命令「先给你看」的标签开出来就是固定的：等着收下的改动不被下一个对比换掉（task-9womr）
      const t: Tab = { id: newId(), type: 'diff', src, title, ...(src.kind === 'proposal' ? { pinned: true } : {}) }
      if (src.kind === 'proposal') return { tabs: [...s.tabs, t], active: t.id }
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
  /** 打开 PDF 翻到那一页、那一块闪一下（出卡的卡上、Anki 卡上的「打开原文」） */
  const openPdfAt = useCallback(
    (path: string, page: number, rect?: [number, number, number, number], text?: string) => {
      openPdf(path)
      // PDF 标签刚开时页面还没量好；等它画出来再跳
      setTimeout(() => Reading.jumpTo(path, page, rect, text), 300)
    },
    [openPdf],
  )
  useEffect(() => window.cnReading.onOpenAt((a) => openPdfAt(a.file, a.page, a.rect)), [openPdfAt])
  // 画布今日「打开笔记，到这一行」：canvas-notes://open?file=<笔记>.md&line=N
  const openFolder = useCallback(
    (folder: string, fresh = false) =>
      open(
        (t) => t.type === 'folder' && t.folder === folder,
        () => ({ id: newId(), type: 'folder', folder, fresh }),
      ),
    [open],
  )
  // 深链 canvas-notes://open?file=…：md 打开到那一行；文件夹（ParaRead「在画布笔记里继续」带回来的）开它的首页
  useEffect(() => window.cn.onOpenNoteAt((a) => (a.folder ? openFolder(a.file) : (openNote(a.file), a.line && void goToLine(a.file, a.line)))), [openNote, openFolder])
  // 左栏、目录树、⌘K 都调 openFolderHome('课程/线性代数')
  useEffect(() => onOpenFolderHome((f) => openFolder(f)), [openFolder])
  /** ⌘K、「课程」右键的「新建一门课」：建 课程/新的课程，开它的首页进编辑，标题能改 */
  async function newCourse() {
    try {
      const f = await window.cnFolder.create(`${catName('课程')}/${tv('新的课程')}`)
      refreshNotes()
      openFolder(f, true)
      const r = await window.cnFolder.get(f)
      setNotice(tNow('建了{path} · 首页用的是「{name}」', { path: f, name: r.template ? tNow('课程模板') : tNow('默认课程首页') }))
    } catch (e) {
      setNotice(errText(e))
    }
  }
  /** 按文件类型开成对的标签：PDF、HTML、md（搜索、⌘O、目录树用） */
  const openFile = useCallback((path: string) => (/\.pdf$/i.test(path) ? openPdf(path) : /\.html?$/i.test(path) ? openHtml(path) : openNote(path)), [openPdf, openHtml, openNote])
  const openHome = () => open((t) => t.type === 'home', () => ({ id: newId(), type: 'home' }))
  const openInbox = () => open((t) => t.type === 'inbox', () => ({ id: newId(), type: 'inbox' }))
  const openRecent = () => open((t) => t.type === 'recent', () => ({ id: newId(), type: 'recent' }))
  /** 左栏换成「最近删掉的」（图标栏底部那一格，task-iq2ow；以前是目录树最底下一行，task-5yp97） */
  const openTrash = () => (openLeft('trash'), setPane('left'))
  /** 待办首页（task-kzr3n）：只开一个「待办」标签，开着就换到它 */
  const openTodoHome = () => open((t) => t.type === 'todo', () => ({ id: newId(), type: 'todo' }))
  /** 整页日历（task-kzr3n）：只开一个「日历」标签 */
  const openCalendar = () => open((t) => t.type === 'calendar', () => ({ id: newId(), type: 'calendar' }))
  /** 生长图（task-h7oy8）：中间开「生长」标签（开着就换过去） */
  const openGrowth = () => (open((t) => t.type === 'growth', () => ({ id: newId(), type: 'growth' })), showCenter())
  /** 左栏「最近删掉的」点了一条：中间开「最近删掉的」标签看它删掉前的样子 */
  const showTrashItem = (it: TrashItem | 'orphans') => (pickTrash(it), open((t) => t.type === 'trash', () => ({ id: newId(), type: 'trash' })))
  const openArchive = () => open((t) => t.type === 'archive', () => ({ id: newId(), type: 'archive' }))

  /** 标签右键（DESIGN.v3 9.2）：关闭这几种、改名、在访达中显示、拷贝路径、网页移到右栏 */
  function tabMenu(t: Tab): MenuEntry[] {
    // 分成两格时「关闭其他 / 右侧 / 全部」只管这个标签所在的那一格（照 VS Code）；关空了合回一格
    const p = Sp.paneOf(split, t.id)
    const mine = tabs.filter((x) => Sp.paneOf(split, x.id) === p)
    const i = mine.findIndex((x) => x.id === t.id)
    const drop = (gone: Tab[], keep: string) => {
      leaveTabs(gone)
      const ids = new Set(gone.map((x) => x.id))
      setTabState((s) => ({ tabs: s.tabs.filter((x) => !ids.has(x.id)), active: ids.has(s.active ?? '') ? keep : s.active }))
    }
    const path = 'path' in t ? t.path : null
    return [
      { label: tNow('关闭'), accel: accelFor('close'), run: () => closeByUser(t.id) },
      { label: tNow('关闭其他'), enabled: mine.length > 1, run: () => drop(mine.filter((x) => x.id !== t.id), t.id) },
      { label: tNow('关闭右侧'), enabled: i < mine.length - 1, run: () => drop(mine.slice(i + 1), t.id) },
      split
        ? { label: tNow('关闭这一格'), run: () => drop(mine, split.other) }
        : { label: tNow('关闭全部'), run: () => (leaveTabs(tabs), setTabState({ tabs: [], active: null })) },
      '-',
      !split && { label: tNow('向右分屏'), accel: accelFor('split-center'), run: () => splitCopyOf(t, 'row') },
      !split && { label: tNow('向下分屏'), run: () => splitCopyOf(t, 'col') },
      split && { label: split.dir === 'row' ? (p === 0 ? tNow('挪到右边那一格') : tNow('挪到左边那一格')) : p === 0 ? tNow('挪到下面那一格') : tNow('挪到上面那一格'), run: () => moveTabTo(t.id, p === 0 ? 1 : 0, null) },
      split && { label: tNow('合成一格'), accel: accelFor('split-center'), run: () => setSplit(null) },
      // 占满（每一栏都能占满）：中间窄到标签条右端那颗收起时也找得到
      { label: maxNow ? tNow('还原') : split ? tNow('占满这一格') : tNow('占满这一栏'), accel: accelFor('fold-center'), run: () => toggleMax({ kind: 'center', pane: p }) },
      '-',
      canRenameTab(t) && { label: tNow('重命名'), accel: accelFor('rename'), run: () => setRenaming(t.id) },
      path && { label: tNow('在访达中显示'), run: () => window.cnMenu.reveal(path) },
      path && { label: tNow('拷贝路径'), run: () => copy(vault.path + '/' + path) },
      t.type === 'web' && { label: tNow('放回右栏'), run: () => putWebBack(t) },
    ]
  }

  // ---- 中间栏分屏（shared/center-split.ts，shell/CenterSplit.tsx）
  /** 照着这个标签复制一个放到右边 / 下面成一格，焦点到新的那格（快捷键、右键「向右分屏」，照 VS Code 的「Split Editor」） */
  function splitCopyOf(t: Tab, dir: Sp.SplitDir) {
    if (splitNow.current) return
    const copy = { ...t, id: newId(), ...(t.type === 'note' || t.type === 'folder' ? { fresh: false } : {}) } as Tab
    const r = Sp.splitCopy(t.id, copy.id, dir)
    setSplit(r.split)
    setTabState((s) => {
      const i = s.tabs.findIndex((x) => x.id === t.id)
      return { tabs: [...s.tabs.slice(0, i + 1), copy, ...s.tabs.slice(i + 1)], active: r.active }
    })
  }
  /** 把一个标签挪到第 to 格、排在 before 前面（拖到标签条上、拖到另一格、右键「挪到…那一格」）；它成了当前标签 */
  function moveTabTo(id: string, to: Sp.PaneNo, before: string | null) {
    const r = Sp.moveTab(tabsNow.current.map((t) => t.id), splitNow.current, id, to, before)
    setSplit(r.split)
    setTabState((s) => {
      const by = new Map(s.tabs.map((t) => [t.id, t]))
      return { tabs: r.ids.map((i) => by.get(i)).filter((t): t is Tab => !!t), active: id }
    })
  }
  /** 换当前格：另一格前面那个成了当前标签（点进另一格的内容、⌘1 / ⌘2） */
  function goPane(p: Sp.PaneNo, moveFocus = false) {
    const s = splitNow.current
    if (!s || Sp.paneOf(s, activeNow.current) === p) return
    setTabState((x) => ({ ...x, active: s.other }))
    setSettingsFront(false)
    // 按键换格（⌘1 / ⌘2）：键盘焦点也跟过去，不然接着打的字还进原来那格的编辑器
    if (moveFocus)
      requestAnimationFrame(() => {
        const slot = centerRef.current?.querySelector<HTMLElement>(`:scope > .cslot[data-pane="${p}"]:not([hidden])`)
        const ed = slot?.querySelector<HTMLElement>('.cm-content')
        if (ed && ed.offsetParent) ed.focus()
        else if (slot && !slot.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur?.()
      })
  }
  /**
   * 对照看（中间栏分屏，用户：「同一个文档也想对照着看」）：笔记标签条上那颗、⌥ 点「白板」。另一格（没分屏就分出右边那格）
   * 用白板开同一篇，同一份字；焦点留在原来这一格接着打。另一格正开着这一篇时再点：那一份关掉、合回一格
   */
  function toggleCompare(t: Extract<Tab, { type: 'note' }>) {
    const s = splitNow.current
    const mine = Sp.paneOf(s, t.id)
    const there = s ? tabsNow.current.find((x) => x.id === (Sp.paneOf(s, activeNow.current) === mine ? s.other : activeNow.current)) : null
    if (s && there?.type === 'note' && there.path === t.path) {
      leaveTabs([there])
      setSplit(null)
      setTabState((x) => ({ tabs: x.tabs.filter((y) => y.id !== there.id), active: t.id }))
      return
    }
    const copy: Tab = { id: newId(), type: 'note', path: t.path, view: 'board' }
    const to: Sp.PaneNo = s ? (mine === 0 ? 1 : 0) : 1
    const second = s ? (to === 1 ? [...s.second, copy.id] : s.second) : [copy.id]
    // 新开的这一份落在另一格，不按「落在当前格」那条规矩算：先当它已经在了
    splitPrev.current = { ...splitPrev.current, ids: [...splitPrev.current.ids, copy.id] }
    setSplit({ dir: s?.dir ?? 'row', ratio: s?.ratio ?? 0.5, second, other: copy.id })
    setTabState((x) => {
      const i = x.tabs.findIndex((y) => y.id === t.id)
      return { tabs: [...x.tabs.slice(0, i + 1), copy, ...x.tabs.slice(i + 1)], active: t.id }
    })
  }
  /** 分屏 / 合成一格（快捷键）：没分屏时把当前标签复制一份到右边；分了就合回一格 */
  function toggleSplit() {
    if (splitNow.current) return setSplit(null)
    const t = tabsNow.current.find((x) => x.id === activeNow.current)
    if (t) splitCopyOf(t, 'row')
  }
  const tabDrag = useTabDrag(
    () => ({
      center: centerRef.current,
      split: !!splitNow.current,
      paneOf: (id) => Sp.paneOf(splitNow.current, id),
      canSplit: () => Sp.canSplitOut(tabsNow.current.map((t) => t.id), splitNow.current),
    }),
    (id, d: SplitDrop) => {
      setSettingsFront(false)
      if (d.kind === 'strip') return moveTabTo(id, d.pane, d.before)
      if (d.kind === 'pane') return moveTabTo(id, d.pane, null)
      const r = Sp.splitOut(tabsNow.current.map((t) => t.id), activeNow.current, id, d.side)
      if (!r) return
      setSplit(r.split)
      setTabState((s) => ({ ...s, active: r.active }))
    },
  )

  /** 中间那一页网页放回右栏（task-05p2w：这一页的「⋯」、标签右键「放回右栏」），回到原来那一组 */
  const putWebBack = (t: Extract<Tab, { type: 'web' }>) => (closeTab(t.id), openInWeb(t.url))

  function closeTab(id: string) {
    const t = tabs.find((x) => x.id === id)
    if (t) leaveTabs([t])
    setTabState((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      return { tabs, active: Sp.afterClose(s.tabs.map((t) => t.id), splitNow.current, s.active, id) }
    })
  }

  /**
   * 用户关一个标签（×、⌘W、右键「关闭」、标签列表里的 ×）：提示条「关掉了「…」」带「撤回」，撤回放回原来的位置、切过去
   * （笔记关的时候跟着标题改了名的，撤回开改名以后的那篇）。只剩一个首页时不关（标签关完就是首页）。
   * 刚新建、还空着的笔记关掉就扔了，不说
   */
  function closeByUser(id: string) {
    const i = tabs.findIndex((x) => x.id === id)
    const t = tabs[i]
    if (!t) return
    if (tabs.length === 1 && t.type === 'home') return
    const blank = t.type === 'note' && freshNotes.current.has(t.path) && [...NoteDoc.open].find((d) => d.path === t.path)?.view.state.doc.toString().trim() === `# ${titleOf(t.path)}`
    const left = leaveTabs([t])
    setTabState((s) => {
      const rest = s.tabs.filter((x) => x.id !== id)
      // 分成两格时接上同一格里挨着的；这一格关空了合回一格（center-split.ts）
      return { tabs: rest, active: Sp.afterClose(s.tabs.map((x) => x.id), splitNow.current, s.active, id) }
    })
    if (blank) return
    noticeClosed(tNow('关掉了「{name}」', { name: tabName(t) }), () =>
      void (left.get(t.id) ?? Promise.resolve(null)).then((now) => {
        const back: Tab = t.type === 'note' && now ? { ...t, path: now, fresh: false } : t
        setTabState((s) => {
          if (s.tabs.some((x) => x.id === back.id)) return { ...s, active: back.id }
          // 关完以后自己开的那个首页：撤回时换回来
          const base = s.tabs.length === 1 && s.tabs[0]!.id === autoHome.current ? [] : s.tabs
          return { tabs: [...base.slice(0, i), back, ...base.slice(i)], active: back.id }
        })
      }),
    )
  }
  /** 标签关完了（⌘W 关到最后一个、右键「关闭全部」、删了开着的那篇）：回到首页，不留一块空白（用户 2026-11-18 补的） */
  const autoHome = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (tabs.length) return
    const home: Tab = { id: newId(), type: 'home' }
    autoHome.current = home.id
    setTabState({ tabs: [home], active: home.id })
  }, [tabs.length])

  /** 新建笔记放哪（CN-11）：目录树里点过的文件夹；开着的文件夹首页；都不是就进收件箱，梦游再建议归类 */
  const newNoteWhere = useRef<() => string>(() => INBOX)
  /** 正在新建：连点两下只建一篇 */
  const creating = useRef(false)
  /** 这次新建、还没写过东西的笔记：关掉标签时还是空的就不留 */
  const freshNotes = useRef(new Set<string>())
  /** 正在新建时换了标签：之后打的字归换到的那篇，新笔记在后台开（new-note-hold.ts） */
  const activeNow = useRef(active)
  activeNow.current = active
  const holdNow = useRef<{ hold: ReturnType<typeof holdTyping>; from: string | null } | null>(null)
  useEffect(() => {
    const h = holdNow.current
    if (h && active !== h.from) h.hold.release()
  }, [active])
  /** 新建笔记（⌘N、左栏按钮、文件夹右键都走这里，关掉时还空着就进废纸篓）；folder 不给就按 newNoteWhere */
  const newNote = useCallback(async (folder?: string) => {
    if (creating.current) return
    creating.current = true
    // 盘慢时建好、读好要一两秒：键盘先从原来那篇拿走，这中间打的字交给新笔记（不然进了原来那篇）
    const hold = holdTyping()
    const from = activeNow.current
    holdNow.current = { hold, from }
    try {
      // 设置 › 文档和白板「新建笔记先用」白板：建一块白板（同一个 md，type: board，默认用白板看法打开）
      if (appSettings().editor.newView === 'board') {
        hold.drop()
        const path = await window.cn.createBoard(folder ?? newNoteWhere.current(), '未命名白板') // 不翻：新建时的默认名字（写进文件）
        refreshNotes()
        openNote(path, true)
        return
      }
      const path = await window.cn.createNote(folder ?? newNoteWhere.current(), '未命名', '# 未命名\n\n') // 不翻：新建时的默认名字（写进文件）
      freshNotes.current.add(path)
      // 读好再开：标签出来时编辑器已经在、光标在标题里，紧接着打的字不丢
      primeNote(await window.cn.readNote(path))
      hold.handTo(path)
      refreshNotes()
      // 建的时候用户换到了别的标签：新笔记在后台开一个标签，不切过去、不抢焦点（第 6 轮）
      if (activeNow.current !== from) setTabs((ts) => [...ts, { id: newId(), type: 'note', path, fresh: true }])
      else openNote(path, true)
    } catch (e) {
      hold.drop()
      setNotice(errText(e))
    } finally {
      creating.current = false
      holdNow.current = null
    }
  }, [openNote, refreshNotes])
  /**
   * 要关掉的标签里的笔记：先让它按标题改名（写了标题没回车就 ⌘W 也改），再看新建的是不是还空着。
   * 在标签从界面上拿掉之前叫（编辑器还在，NoteTab 登记的 leave 还能拿到）
   */
  function leaveTabs(closing: Tab[]): Map<string, Promise<string | null>> {
    /** 标签 id → 关掉以后那篇在哪（跟着标题改了名就是新名字）；空的新笔记扔了是 null */
    const out = new Map<string, Promise<string | null>>()
    for (const t of closing) {
      if (t.type !== 'note') continue
      const fresh = freshNotes.current.has(t.path)
      const leave = noteLeavers.get(t.id)
      const done = (async () => {
        const now = leave ? await leave() : t.path
        if (!fresh) return now
        // 跟着标题改了名：写过标题，不是空的
        if (now !== t.path) {
          freshNotes.current.delete(t.path)
          return now
        }
        return (await dropIfBlank(t.path)) ? null : now
      })()
      done.catch((e) => setNotice(errText(e)))
      out.set(t.id, done.catch(() => t.path))
    }
    return out
  }
  /** 关掉一篇新建的笔记：只有「# 未命名」那一行（没写标题、没写正文）就移到废纸篓，收件箱和「最近」里不堆空的「未命名」 */
  async function dropIfBlank(path: string): Promise<boolean> {
    freshNotes.current.delete(path)
    // 等标签里的编辑器把没存的字存完（关标签时它先存再收）
    await NoteDoc.saveAll()
    const note = await window.cn.readNote(path)
    if (note.text.trim() !== `# ${titleOf(path)}`) return false
    await window.cn.trashNote(path)
    refreshNotes()
    return true
  }

  const newBoard = useCallback(async () => {
    try {
      const path = await window.cn.createBoard('', '未命名白板') // 不翻：新建时的默认名字（写进文件）
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
      else setNotice(tNow('库里没有叫「{name}」的笔记', { name: target }))
    },
    [notes, pdfs, openNote, openPdf],
  )

  const activeTab = tabs.find((t) => t.id === active) ?? null
  // 右栏「相关」：库里笔记变了、梦游报告变了就重读；梦游给开着的这篇连了新的、还没看过时图标上一个小点
  const notesVersion = useMemo(() => notes.reduce((m, n) => Math.max(m, n.mtimeMs), 0) + notes.length, [notes])
  const dreamVersion = (dream.report?.items.filter((i) => i.state === 'taken').length ?? 0) + (dream.report?.finished ?? 0)
  const activeNotePath = useRef<string | null>(null)
  activeNotePath.current = activeTab?.type === 'note' ? activeTab.path : null
  const [relatedDot, setRelatedDot] = useState(false)
  useEffect(() => {
    const p = activeTab?.type === 'note' ? activeTab.path : null
    if (!p) return setRelatedDot(false)
    let live = true
    void window.cn.relatedDot(p).then(
      (on) => live && setRelatedDot(on),
      () => live && setRelatedDot(false),
    )
    return () => void (live = false)
  }, [activeTab?.type === 'note' ? activeTab.path : null, dreamVersion])
  /** 「开在后面的标签里了」那句（AI 回答里 ⇧⌘点，task-3e53q）：切到那个标签时就不对了，收掉 */
  const behindNotice = useRef<{ text: string; is(t: Tab): boolean } | null>(null)
  useEffect(() => {
    const b = behindNotice.current
    if (!b || !activeTab) return
    if (notice !== b.text) return void (behindNotice.current = null)
    if (b.is(activeTab)) (setNotice(null), (behindNotice.current = null))
  }, [activeTab?.id, notice])
  /** 中间在前面的那篇笔记、库里的书桌（task-kbnc0：⌘K、网页「⋯」、书桌要它们） */
  const activeNote = activeTab?.type === 'note' ? activeTab.path : null
  /** 从白板、笔记拍的导图：它挂着的那一篇（同一个文件夹里，属性 所属白板 / 所属笔记），面包屑多一节回去（task-wuv05） */
  const crumbParent = parentNoteOf(activeNote, notes)
  const deskList = useDesks()
  /** 视频「记下这一刻」记好的那一条（平时在中间栏底部）：中间栏收着时看不见，改在底栏说（task-kbnc0） */
  const videoSaved = useSavedToast()
  // 新笔记放哪（设置 › 文件和附件）：收件箱，目录树里点过的文件夹、开着的文件夹首页优先；总是收件箱；正在看的那篇旁边
  newNoteWhere.current = () => {
    const where = settings.files.newWhere
    if (where === 'inbox') return INBOX
    if (where === 'beside') {
      if (activeTab?.type === 'note' || activeTab?.type === 'pdf') return activeTab.path.includes('/') ? activeTab.path.slice(0, activeTab.path.lastIndexOf('/')) : ''
      return activeTab?.type === 'folder' ? activeTab.folder : INBOX
    }
    return treePicked() ?? (activeTab?.type === 'folder' ? activeTab.folder : INBOX)
  }
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
  /** 中间栏分屏：当前格是第几格；另一格前面的标签；看得见的（两格前面的都算） */
  const focusPane = Sp.paneOf(split, active)
  const otherShown = split ? split.other : null
  const seen = (id: string) => id === shown || id === otherShown
  const otherTab = otherShown ? (tabs.find((t) => t.id === otherShown) ?? null) : null
  /**
   * 标签多了横着滚（照 VS Code）：换了当前标签就把它整个滚进来；标签条宽度变了（右端动作区换了内容、
   * 比如页面说明晚一步出来把标签条挤窄、窗口变窄）也再滚一次。能滚的那一侧画渐隐（.fl / .fr）。
   */
  const tlistRef = useRef<HTMLDivElement>(null)
  const [tabFade, setTabFade] = useState({ left: false, right: false })
  /** 标签放不下（要滚）：这时右端才有「N ⌄」 */
  const [tabsOver, setTabsOver] = useState(false)
  /**
   * B 的动作带字时当前标签放不下（中间还宽于 640，可动作多：白板「属性 · 任务 / 白板 / 文档 · 80% · 收件箱」）：
   * 动作只留图标，位置让给标签（同中间窄于 640）。收着时先拿掉 .tight 量一下带字放不放得下，放得下才让字回来（同一帧里量，不闪）
   */
  const [tabsTight, setTabsTight] = useState(false)
  const tight = useRef(false)
  const syncTabs = useCallback(() => {
    const el = tlistRef.current
    if (!el) return
    // 标签多了方向 A：标签照原来的宽排、名字是全的（最宽 280，再长打省略号），放不下就横着滚
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0
    const onAt = [...el.querySelectorAll<HTMLElement>(':scope > .tab')].findIndex((t) => t.classList.contains('on'))
    // 停在标签边上（方向 A）：滚到最右时左端也停在某个标签开头，差的那一段补在标签后面（.tlist[data-tail]::after）
    const boxes = tabBoxes(el)
    const center = el.closest('.frame-b .center')
    if (onAt >= 0 && center) {
      const fits = () => el.clientWidth + 0.5 >= boxes[onAt]!.width
      let want = tight.current
      if (!want) want = !fits()
      else {
        center.classList.remove('tight')
        want = !fits()
        center.classList.add('tight')
      }
      if (want !== tight.current) {
        tight.current = want
        center.classList.toggle('tight', want)
        setTabsTight(want)
      }
    }
    const tail = tabTail(boxes, el.clientWidth)
    if (tail > 0) {
      // 补的那一段本身也算一个标签条里的东西，前面带着标签之间的间隔（B 2）：只补剩下的
      el.style.setProperty('--tab-tail', `${Math.max(0, tail - gap)}px`)
      el.setAttribute('data-tail', '')
    } else el.removeAttribute('data-tail')
    if (onAt >= 0) {
      const next = revealLeft(el.scrollLeft, el.clientWidth, boxes, onAt)
      if (next !== Math.round(el.scrollLeft)) el.scrollLeft = next
    }
    const e = tabEdges(el.scrollLeft, el.scrollWidth, el.clientWidth)
    setTabFade((f) => (f.left === e.left && f.right === e.right ? f : e))
    // 右端「N ⌄」只在放不下时画：它自己也占地方，量的时候把它让出来的宽算回标签条
    const last = boxes[boxes.length - 1]
    const more = el.parentElement?.nextElementSibling
    const room = el.clientWidth + (more instanceof HTMLElement && more.dataset.testid === 'tab-more' ? more.offsetWidth + (parseFloat(getComputedStyle(more).marginLeft) || 0) + (parseFloat(getComputedStyle(more).marginRight) || 0) : 0)
    const over = !!last && last.left + last.width > room + 0.5
    setTabsOver((o) => (o === over ? o : over))
  }, [])
  useLayoutEffect(syncTabs, [shown, settingsFront, tabs, syncTabs])
  /**
   * 滚一下、点两端的箭头：挪一整个标签，停在标签边上（标签多了方向 A）。滚着的那一下还没停时接着按，从要停的地方往下算
   */
  const snapTo = useRef<{ left: number; until: number } | null>(null)
  const snapTabs = useCallback((dir: 1 | -1) => {
    const el = tlistRef.current
    if (!el) return
    const base = snapTo.current && snapTo.current.until > performance.now() ? snapTo.current.left : el.scrollLeft
    const left = snapLeft(base, el.clientWidth, tabBoxes(el), dir)
    snapTo.current = { left, until: performance.now() + 400 }
    el.scrollTo({ left, behavior: 'smooth' })
  }, [])
  useEffect(() => {
    const el = tlistRef.current
    if (!el) return
    const ro = new ResizeObserver(syncTabs)
    ro.observe(el)
    const onScroll = () => {
      const e = tabEdges(el.scrollLeft, el.scrollWidth, el.clientWidth)
      setTabFade((f) => (f.left === e.left && f.right === e.right ? f : e))
    }
    // 鼠标滚轮一格、触控板每划 60 挪一整个标签；横着竖着都算
    let acc = 0
    let last = 0
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return
      e.preventDefault()
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!d) return
      const now = performance.now()
      if (now - last > 250) {
        acc = 0
        last = now
        return snapTabs(d > 0 ? 1 : -1)
      }
      acc += d
      if (Math.abs(acc) < 60) return
      snapTabs(acc > 0 ? 1 : -1)
      acc = 0
      last = now
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => (ro.disconnect(), el.removeEventListener('scroll', onScroll), el.removeEventListener('wheel', onWheel))
  }, [syncTabs, snapTabs])
  /** 标签条右端「12 ⌄」：列出开着的全部标签 */
  const [tabsMenu, setTabsMenu] = useState<HTMLElement | null>(null)
  /** 中间窄于 640 时 B 的标签条右端动作只留图标，把位置让给标签 */
  const centerRef = useRef<HTMLElement>(null)
  const [centerNarrow, setCenterNarrow] = useState(false)
  /** 中间窄于 900 时页面说明最宽 140 */
  const [centerCompact, setCenterCompact] = useState(false)
  /** 没分屏、中间窄于 440（挤到最窄 420 附近）：标签条右端那颗「占满」收起，空处留给按住拖整栏（⌃⌘\、双击空处、标签右键照样能占满） */
  const [centerTiny, setCenterTiny] = useState(false)
  // 左右分成两格时按窄的那一格量（中间栏分屏：两格各一条标签条，动作跟着只留图标）
  const measureCenter = useCallback(() => {
    const el = centerRef.current
    if (!el) return
    const s = splitNow.current
    const w = s?.dir === 'row' ? el.clientWidth * Math.min(s.ratio, 1 - s.ratio) : el.clientWidth
    setCenterNarrow(w < 640)
    setCenterCompact(w < 900)
    setCenterTiny(!s && w < 440)
  }, [])
  useEffect(() => {
    const el = centerRef.current
    if (!el) return
    const ro = new ResizeObserver(measureCenter)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measureCenter])
  useEffect(measureCenter, [split, measureCenter])
  // 第二格的标签条：前面那个标签整个露着（第一格的走上面 syncTabs 那一套）
  useLayoutEffect(() => {
    const el = centerRef.current?.querySelector<HTMLElement>(':scope > .tabs.p1 .tlist')
    const on = el?.querySelector<HTMLElement>(':scope > .tab.on')
    if (!el || !on) return
    const r = el.getBoundingClientRect()
    const b = on.getBoundingClientRect()
    if (b.left < r.left) el.scrollLeft -= r.left - b.left
    else if (b.right > r.right) el.scrollLeft += b.right - r.right
  })
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
    // 关掉的标签跳过；跳过关掉的以后又落在现在这个标签上的也跳过（不然按了后退看着像没反应）。
    // 开着同一篇的另一个标签也跳过：⌃\ 分屏是把这一篇复制一份到另一格，合回一格以后两个同名标签挨着记在历史里，
    // 后退只是在这两份之间换，看着像退不动（收尾清单「分屏合回后 AI 输入框 ⌘[ 退不动」）
    const docOf = (id: string | null) => {
      const t = tabs.find((x) => x.id === id)
      return t && 'path' in t ? `${t.type}:${t.path}` : id
    }
    const here = docOf(active)
    while (j >= 0 && j < n.list.length && (!tabs.some((t) => t.id === n.list[j]) || n.list[j] === active || docOf(n.list[j]!) === here)) j += d
    // 点书桌换了一整套：退到切之前就是回到刚才（原来那几个标签已经换掉了，照标签退不回去）
    const away = awayNow()
    if (d < 0 && away?.exact && away.navAt >= 0 && j < away.navAt) return backToBefore()
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
  // 网页开着（在不在前面都算）：在网页上框着问的那段对话还在 AI 标签里
  const readingPdf = readingDoc ?? (Dk.isOpen(dock, 'web') ? webAsk : null)
  /** ⌘K「出卡」那几条对着哪份 PDF：正在读的，没有就最近打开过的 */
  const lastPdf = readingPdf ?? tabs.flatMap((t) => (t.type === 'pdf' ? [t.path] : [])).pop() ?? null
  /** 网页的笔记（task-6cxtc）：配好对、选过记到哪篇的那一篇（中间没开 PDF、HTML 时），右栏「笔记」标签列那篇里来自这个网页的几条 */
  useTargets()
  const webCenter = activeTab?.type === 'note' && activeMode !== 'board' && !centerFold ? activeTab.path : null
  const webNotePath = !readingDoc && rightWeb && /^https?:/i.test(rightWeb) ? targetOf(rightWeb, webCenter, (p) => notes.some((n) => n.path === p)) : null
  /** 这一页有边读边记的笔记（PDF、HTML；右栏网页配好对时是那篇里来自这个网页的几条） */
  const notesOk = (!!readingPdf && !Reading.isWebSrc(readingPdf)) || !!webNotePath
  /** 网页上点了小标、底栏「在笔记里看」：笔记标签翻到那一条（头一行的原文） */
  const [webNoteFocus, setWebNoteFocus] = useState<{ line: string; seq: number } | null>(null)
  /** 画出来的工作区：不读 PDF / HTML 时笔记那个标签拿掉（它独占的那栏一起不画），布局里照旧记着，回到 PDF 又在原处 */
  /** 数据库里点开的一条（右栏「记录」标签，数据库第三批第 4 块）：一条都没开过时这个标签不画 */
  const record = useRecord()
  /** 数据库 AI 列的右栏一页（「AI 生成一列」）：没开过一列时这个标签不画 */
  const aiColTitle = useAiColTitle()
  /** 数据库的「自动化」一页：没从块头开过时这个标签不画 */
  const autoTitle = useAutoTitle()
  const dockShown = Dk.shownDock(dock, (v) => (v !== 'note' || notesOk) && (v !== 'record' || !!record) && (v !== 'aicol' || !!aiColTitle) && (v !== 'auto' || !!autoTitle))
  // 数据库里点一条（表格行、看板卡、日历条、画廊卡）：右栏开「记录」标签（开着在后面就换到前面），它那一组成当前栏
  const openViewRef = useRef(openView)
  openViewRef.current = openView
  useEffect(() => onRecordOpen(() => openViewRef.current('record')), [])
  useEffect(() => onAiColOpen(() => openViewRef.current('aicol')), [])
  useEffect(() => onAutoOpen(() => openViewRef.current('auto')), [])
  // 自动化在后台跑：跑完底部说一句、交给 AI 对话跑存过的命令（右栏「自动化」不开也要接上）
  useEffect(() => wireAuto(), [])
  /** 这个标签看得见（开着、是它那一组前面那个） */
  const vis = (v: Dk.ViewId) => Dk.isShown(dockShown, v)
  /** 现在占满的是哪一栏（对上了布局：那一组收了、拖走了就不算） */
  const maxNow = liveMax(max, dockShown, !!split)
  /** 中间那栏让给了右边一组或浮窗：看不见、点不到，里面的东西都还在 */
  const centerOff = maxNow?.kind === 'group'
  /** 网页那一组占满、网页在前面（以前的「网页占满」）：剪的照样记进中间那篇，地址栏挂「记进」小牌 */
  const folded = centerOff && Dk.findView(dockShown, 'web')?.group.id === maxNow.id && vis('web')
  useEffect(() => {
    if (folded) return
    setFullInbox(false)
    setFullCount(0)
    setFullPick(null)
  }, [folded])
  /** 网页看得见（右栏一组、浮窗都算）：网页 ⋯ 里有「占满 / 还原」 */
  const webGroup = vis('web') ? (Dk.findView(dockShown, 'web')?.group.id ?? null) : null
  /** 当前这栏（⌃⌘\ 占满它）：右边一组、浮窗是它自己；中间、左栏是中间正在用的那一格 */
  const maxTarget = (): Max => (livePane !== 'left' && livePane !== 'center' ? { kind: 'group', id: livePane } : { kind: 'center', pane: focusPane })
  /** 占满 ↔ 还原：占满着时哪一颗、哪个键都是还原；中间的一格占满时那一格成当前格 */
  const toggleMax = (m?: Max) => {
    if (maxNow) return setMax(null)
    const next = m ?? maxTarget()
    if (next.kind === 'center' && split && next.pane !== focusPane) goPane(next.pane)
    if (next.kind === 'group') setPane(next.id)
    setMax(next)
  }
  // 布局变了（开了别的栏、拖了、收了右栏、开关左栏、分屏）、中间换了一篇（一组占满时）：先回原样（不在看不见的地方变）
  const maxSig = maxNow ? [layoutSig(dock, maxNow.kind === 'group' ? maxNow.id : null), sidebarHidden, shownView, !!split, maxNow.kind === 'center' ? focusPane : active].join('|') : ''
  const maxBase = useRef<string | null>(null)
  useEffect(() => {
    if (!maxNow) return void (maxBase.current = null)
    if (maxBase.current === null) maxBase.current = maxSig
    else if (maxBase.current !== maxSig) setMax(null)
  }, [maxSig])
  // 记着的占满对不上了（那一组收了）：清掉，不在下次开网页时又冒出来
  useEffect(() => {
    if (max && !maxNow && max.kind !== 'web') setMax(null)
  }, [!!maxNow])
  // Esc 回原样：焦点不在输入框、编辑器里，别处也没接这一下（白板取消选中、弹层关掉）；网页里按的由主进程看过不在表单里才转来（cn:web-esc）
  const maxOnRef = useRef(false)
  maxOnRef.current = !!maxNow
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || !maxOnRef.current) return
      const a = e.target instanceof HTMLElement ? e.target : null
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return
      if (document.querySelector('.shell-menu, [role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      setMax(null)
    }
    const onWeb = () => maxOnRef.current && setMax(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener(WEB_ESC, onWeb)
    return () => (window.removeEventListener('keydown', onKey), window.removeEventListener(WEB_ESC, onWeb))
  }, [])
  /** 占满时中间那篇（看不见；文档看法才算，白板、首页是 null）：剪的、问的照样记进它 */
  const foldNote = folded && activeTab?.type === 'note' && activeMode !== 'board' ? activeTab.path : null
  // 网页离开右栏（开成中间的一页、关掉、浮起来）：占满跟着结束，回到右栏时中间那篇不会跟着不见（task-05p2w）
  const webInCol = !!Dk.findView(dock, 'web')?.col
  const webInColWas = useRef(webInCol)
  useEffect(() => {
    if (webInColWas.current && !webInCol) showCenter()
    webInColWas.current = webInCol
  }, [webInCol])
  // 占满以后剪了几条（地址栏小牌上的数）
  const foldedRef = useRef(folded)
  foldedRef.current = folded
  useEffect(() => {
    const on = () => foldedRef.current && setFullCount((n) => n + 1)
    window.addEventListener(CLIPPED, on)
    return () => window.removeEventListener(CLIPPED, on)
  }, [])
  /** AI 标签开着（在别的标签后面也算） */
  const aiOpen = Dk.isOpen(dockShown, 'ai')
  /** AI 看得见 */
  const aiShown = vis('ai')
  /** 竖条「笔记」、页边标记、「在笔记里看」：开笔记标签（在后面就换到它） */
  const openNotes = () => openView('note')
  const reading = Reading.useReading(readingPdf)
  /** 记进了笔记（主对话、旁支答完，原型 proto-a）：底栏说一句记到了哪；笔记标签没露出来时带「在笔记里看」 */
  const notedRef = useRef<(d: Reading.Noted) => void>(() => undefined)
  notedRef.current = (d) => {
    setNotice(d.text)
    setNoticeUndo(null)
    if (vis('note') && readingPdf === d.pdf) return setNoticeAct(null)
    setNoticeAct({
      text: d.text,
      label: tNow('在笔记里看'),
      icon: 'note',
      run: () => {
        if (readingPdf !== d.pdf) openFile(d.pdf)
        openNotes()
        if (d.quote !== undefined) Reading.focusSide(d.pdf, d.thread, d.quote)
        else Reading.focusSection(d.pdf, d.thread)
      },
    })
  }
  useEffect(() => {
    const on = (e: Event) => notedRef.current((e as CustomEvent<Reading.Noted>).detail)
    window.addEventListener(Reading.NOTED, on)
    return () => window.removeEventListener(Reading.NOTED, on)
  }, [])
  /** 视频框一块问正在答的（底栏「AI 在记笔记 · 未命名 3」，CN-84） */
  const askJobs = useAskJobs()
  const askInRightRef = useRef<(from?: AskFrom) => void>(() => undefined)

  // 快捷键（命令表 shared/cmd-table.ts，task-spsmf）：布局阶段就挂上，窗口一画出来就能按（useEffect 要等画完下一帧才挂，刚打开时按的会丢）。
  // 窗口上按的、编辑器里按的（note-keys 里先轮到它）、网页有焦点时主进程转回来的（照样再按一下）、菜单栏点的都走这里，跑法是下面的 keyRunRef
  useLayoutEffect(() => {
    setAppRunner((id) => keyRunRef.current(id))
    const onKey = (e: KeyboardEvent) => {
      if (runAppKey(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    const offApp = window.cn.onAppKey(replayAppKey)
    return () => {
      setAppRunner(null)
      window.removeEventListener('keydown', onKey)
      offApp()
    }
  }, [])

  /** ⌘K「剪藏这一页」：右栏换到网页标签（工作区方向 A：开着在后面就换到它），交给网页面板剪（WebPanel 的 CLIP_PAGE_EVENT） */
  function clipThisPage() {
    openView('web')
    requestAnimationFrame(() => {
      if (window.dispatchEvent(new Event(CLIP_PAGE_EVENT, { cancelable: true }))) setNotice(tNow('右栏没有开着的网页'))
    })
  }

  function runAi(text: string) {
    openAi()
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

  /** 删一篇（md 连同只有它在用的图，能撤回；PDF、HTML、图片进废纸篓并单独一次提交）。右键、⌘⌫、标签的「⋯」、属性里都走这里 */
  async function trash(path: string) {
    return trashMany([path])
  }

  /**
   * 删一个或好几个（文件树里选了好几个，CN-105）：跟着要删的笔记走的图（自己附件文件夹里的、文中用到的 附件/ 别处的）
   * 先问连不连一起删（别的笔记也在用的，后台查完再说）；一篇、没有图时不问直接删，好几个时总要问一次。
   * 笔记删完底部能撤回；PDF、HTML 进废纸篓；文件夹整个进废纸篓、一次提交（历史里能撤回）
   */
  async function trashMany(paths: string[]) {
    try {
      await NoteDoc.saveAll()
      const dirs = new Set(vaultFiles().filter((f) => f.kind === 'dir').map((f) => f.path))
      // 选着的在另一个选着的文件夹里面：删外面那个就够了
      const top = paths.filter((p) => !paths.some((d) => d !== p && dirs.has(d) && p.startsWith(d + '/')))
      const folderList = top.filter((p) => dirs.has(p))
      const notesMd = top.filter((p) => !dirs.has(p) && /\.md$/i.test(p))
      const others = top.filter((p) => !dirs.has(p) && !/\.md$/i.test(p))
      const atts = await Promise.all(notesMd.map((p) => window.cnAttach.of(p, false)))
      const own = atts.flatMap((a) => a.items.filter((i) => i.mine))
      // 删笔记前问一声（设置 › 文件和附件）：带图的才问（选了好几个时也问）、每次都问、不问（图照弹框里那个勾上次的样子）
      const ask = settings.files.delAsk
      let withImages = ask === 'never' && own.length > 0 && loadTrashImages()
      if (ask === 'always' || (ask === 'images' && (own.length || top.length > 1))) {
        const shared = Promise.all(notesMd.map((p) => window.cnAttach.of(p, true))).then((xs) => xs.reduce((n, x) => n + x.items.filter((i) => i.mine && i.sharedWith?.length).length, 0))
        const where = [...new Set(own.map((i) => i.path.slice(0, i.path.lastIndexOf('/'))))]
        const answer = await new Promise<boolean | null>((done) => setTrashAsk({ paths: top, dirs: where, own, shared, done }))
        setTrashAsk(null)
        if (answer === null) return
        withImages = answer
      }
      const gone = (p: string) => top.some((x) => p === x || p.startsWith(x + '/'))
      setTabState((s) => {
        // 文档、PDF、HTML、文件夹首页开着的标签一起关
        const tabs = s.tabs.filter((t) => !(('path' in t && gone(t.path)) || ('folder' in t && gone(t.folder))))
        return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : (tabs[tabs.length - 1]?.id ?? null) }
      })
      let images = 0
      // 上一篇的「已删除 · 撤回」还在：接着记，⌘Z 从这篇起一篇篇往回恢复（像访达）
      if (noticeNow.current === null || noticeNow.current !== trashNotice.current) trashChain.current = []
      for (const p of notesMd) {
        const r = await window.cnAttach.trashNote(p, withImages)
        images += r.images
        trashChain.current.push({ path: p, id: r.id })
      }
      // PDF、HTML、图片：一次进废纸篓、当场一次提交（不挂在工作区里等下一次别的提交顺带进去）
      if (others.length) await window.cn.trashFiles(others)
      let inFolders = 0
      for (const f of folderList) {
        const r = await window.cnFolder.trash(f, top.length > 1)
        inFolders += r?.files ?? 0
        images += r?.attachments ?? 0
      }
      const n = trashChain.current.length
      if (top.length === 1 && notesMd.length === 1) {
        const title = titleOf(notesMd[0]!)
        showTrashUndo(
          n > 1
            ? images
              ? tNow('已删除《{title}》和{images}张图（连着删了{n}篇，撤回从这篇起依次恢复）', { title, images, n })
              : tNow('已删除《{title}》（连着删了{n}篇，撤回从这篇起依次恢复）', { title, n })
            : images
              ? tNow('已删除《{title}》和{images}张图', { title, images })
              : tNow('已删除《{title}》', { title }),
        )
      } else if (top.length === 1 && others.length === 1) setNotice(tNow('「{name}」移到了废纸篓，在访达的废纸篓里能找回', { name: titleOf(others[0]!) }))
      else if (top.length === 1 && folderList.length === 1) {
        const name = folderList[0]!.split('/').pop()
        setNotice(
          images
            ? tNow('「{name}」和里面{n}个文件、{images}个附件移到了废纸篓，历史里能撤回', { name, n: inFolders, images })
            : inFolders
              ? tNow('「{name}」和里面{n}个文件移到了废纸篓，历史里能撤回', { name, n: inFolders })
              : tNow('「{name}」移到了废纸篓，历史里能撤回', { name }),
        )
      } else if (notesMd.length) {
        const n = top.length
        showTrashUndo(
          folderList.length
            ? images
              ? tNow('已删除{n}个和{images}张图，文件夹在历史里能撤回', { n, images })
              : tNow('已删除{n}个，文件夹在历史里能撤回', { n })
            : images
              ? tNow('已删除{n}个和{images}张图', { n, images })
              : tNow('已删除{n}个', { n }),
        )
      } else setNotice(folderList.length ? tNow('{n}个移到了废纸篓，文件夹在历史里能撤回', { n: top.length }) : tNow('{n}个移到了废纸篓', { n: top.length }))
      refreshNotes()
      refreshGit()
    } catch (e) {
      setNotice(errText(e))
    }
  }

  /** 好几个一起挪（CN-105）：一次提交；开着的标签跟着换路径；挂在笔记下面的数据库跟着那篇挪了的也说一句（task-5yp97） */
  async function moveMany(paths: string[], folder: string) {
    try {
      await NoteDoc.saveAll()
      const r = await window.cnMenu.moveMany(paths, folder)
      setTabState((s) => ({ ...s, tabs: r.moves.reduce((tabs, m) => retargetTabs(tabs, m.from, m.to), s.tabs) }))
      const where = folder ? tNow('「{name}」', { name: folder }) : tNow('「{name}」最外层', { name: vault.name })
      const own = r.moves.filter((m) => !m.with)
      const dbs = r.moves.filter((m) => m.with)
      const n = own.length
      const skipped = r.skipped.length
      const names = list(dbs.map((d) => tNow('「{title}」的数据库「{name}」', { title: titleOf(d.with!), name: fileName(d.to) })))
      setNotice(
        !n
          ? tNow('都已经在{where}里了', { where })
          : dbs.length
            ? skipped
              ? tNow('{n}个挪进了{where}，{names}跟着挪了，库里指向它们的链接一起改好了；{m}个PDF、HTML没挪', { n, where, names, m: skipped })
              : tNow('{n}个挪进了{where}，{names}跟着挪了，库里指向它们的链接一起改好了', { n, where, names })
            : skipped
              ? tNow('{n}个挪进了{where}，库里指向它们的链接一起改好了；{m}个PDF、HTML没挪', { n, where, m: skipped })
              : tNow('{n}个挪进了{where}，库里指向它们的链接一起改好了', { n, where }),
      )
      refreshNotes()
      refreshGit()
    } catch (e) {
      setNotice(errText(e))
    }
  }

  /**
   * 文件夹首页卡里拖走的一份、右键「移到…」（task-r00en）：PDF 连挂着的笔记、可视化一起挪进 folder，一次提交；
   * 开着的标签跟着换路径；底栏说挪到了哪、连同什么，「撤回」= 原样挪回去
   */
  async function moveItem(path: string, folder: string) {
    try {
      await NoteDoc.saveAll()
      const from = folderOfPath(path)
      const r = await window.cnFolder.moveItem(path, folder)
      if (!r.moves.length) return setNotice(t('已经在「{folder}」里了', { folder: folder || vault.name }))
      setTabState((s) => ({ ...s, tabs: r.moves.reduce((tabs, m) => retargetTabs(tabs, m.from, m.to), s.tabs) }))
      const main = r.moves[0]!
      const name = fileName(main.to).replace(/\.md$/i, '')
      const where = folder || vault.name
      // 跟着走的：挂着的那篇笔记、笔记里的可视化
      const note = r.moves.some((m, i) => i > 0 && /\.md$/i.test(m.to))
      const viz = r.moves.filter((m, i) => i > 0 && !/\.md$/i.test(m.to)).length
      const text = viz
        ? t('「{name}」和它的笔记、{n}个可视化挪到了「{folder}」', { name, n: viz, folder: where })
        : note
          ? t('「{name}」和它的笔记挪到了「{folder}」', { name, folder: where })
          : t('「{name}」挪到了「{folder}」', { name, folder: where })
      noticeWithUndo(text, () => void moveItem(main.to, from))
      refreshNotes()
      refreshGit()
    } catch (e) {
      setNotice(errText(e))
    }
  }

  /** 文件夹首页的标签收首页卡里拖来的一份（task-r00en「拖到另一个课程首页上也行」）：停在上面那个标签亮，松手挪进那个文件夹；本来就在的不亮 */
  const folderTabDrop = (id: string, folder: string) => ({
    onDragOver(e: React.DragEvent) {
      const it = [...e.dataTransfer.types].includes(DRAG_ITEM) ? draggedItem() : null
      if (!it || folderOfPath(it) === folder) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (tabDrop !== id) setTabDrop(id)
    },
    onDragLeave(e: React.DragEvent) {
      if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return
      if (tabDrop === id) setTabDrop(null)
    },
    onDrop(e: React.DragEvent) {
      const it = e.dataTransfer.getData(DRAG_ITEM)
      setTabDrop(null)
      if (!it || folderOfPath(it) === folder) return
      e.preventDefault()
      noteMovedTo(folder)
      void moveItem(it, folder)
    },
  })

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
          showTrashUndo(next ? tNow('恢复了《{title}》，再撤回恢复《{next}》', { title: titleOf(last.path), next: titleOf(next.path) }) : tNow('恢复了《{title}》', { title: titleOf(last.path) }))
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
      setNotice(tNow('「{name}」改名为「{to}」，库里指向它的链接一起改好了', { name: old, to: to.split('/').pop() }))
      refreshNotes()
      refreshGit()
      return to
    } catch (e) {
      setNotice(errText(e))
      return null
    }
  }

  /**
   * 历史里「放回」（CN-108 方向 A）：那次删掉、现在又不在的文件取回原处，一次提交「放回：…」。
   * 提示条「放回了「课程/ecp」里的 4 个文件 · 打开文件夹 · 撤回」；目录树正开着时那一处亮一下。返回放回那次的提交号
   */
  /** say：放回了一篇、原名放回时底栏说的话（「最近删掉的」里写「「草稿 2」放回了「收件箱」」） */
  async function restoreFromHistory(hash: string, only?: string[], say?: string): Promise<string | null> {
    try {
      await NoteDoc.saveAll()
      const r = await window.cn.restoreDeleted(hash, only)
      refreshNotes()
      refreshGit()
      const shown = (p: string) => (/\.md$/i.test(p) ? titleOf(p) : p.split('/').pop()!)
      const first = r.files[0]!.to
      const many = r.files.length > 1
      const renamed = r.files.filter((f) => f.from !== f.to)
      const text =
        say && !renamed.some((f) => f.from === only?.[0])
          ? say
          : many
            ? renamed.length === 1
              ? tNow('放回了「{folder}」里的{n}个文件，原处已经有同名的，放成了「{to}」', { folder: r.folder || tNow('库的最外层'), n: r.files.length, to: shown(renamed[0]!.to) })
              : renamed.length
                ? tNow('放回了「{folder}」里的{n}个文件，{m}个原处已经有同名的，名字后面加了数字', { folder: r.folder || tNow('库的最外层'), n: r.files.length, m: renamed.length })
                : tNow('放回了「{folder}」里的{n}个文件', { folder: r.folder || tNow('库的最外层'), n: r.files.length })
            : renamed.length === 1
              ? tNow('放回了「{name}」，原处已经有同名的，放成了「{to}」', { name: shown(first), to: shown(renamed[0]!.to) })
              : renamed.length
                ? tNow('放回了「{name}」，{m}个原处已经有同名的，名字后面加了数字', { name: shown(first), m: renamed.length })
                : tNow('放回了「{name}」', { name: shown(first) })
      setNotice(text)
      setNoticeIcon({ text, icon: 'check', ok: true })
      markRestored(r.files.map((f) => f.to))
      setNoticeUndo({
        text,
        run: () =>
          void window.cn.undoRestore(r.commit).then(
            () => (markRestored(r.files.map((f) => f.to), false), refreshNotes(), refreshGit(), setNotice(tNow('撤回了，又回到删掉的样子'))),
            (e) => setNotice(errText(e)),
          ),
      })
      setNoticeAct(many && r.folder ? { text, label: tNow('打开文件夹'), icon: 'folder-opened', run: () => openFolder(r.folder!) } : { text, label: tNow('打开'), icon: 'go-to-file', run: () => openFile(first) })
      // 目录树里放回的那一处亮约 2 秒（列表读回来以后）
      setTimeout(() => (many && r.folder ? requestReveal(r.folder, true, r.files.map((f) => f.to)) : requestReveal(first)), 400)
      return r.commit
    } catch (e) {
      setNotice(errText(e))
      return null
    }
  }

  /**
   * 「最近删掉的」里放回一篇（task-5yp97）：还没提交的删除先单独提交这一篇的删除，再走历史里的放回
   * （那次删掉的这一篇取回原处，一次提交「放回：…」，底栏撤回）；放回了返回 true
   */
  async function restoreFromTrash(it: TrashItem): Promise<boolean> {
    try {
      await NoteDoc.saveAll()
      const paths = [it.path, ...(it.with ?? [])]
      const hash = it.commit ?? (await window.cn.trashCommitPending(paths))
      const name = /\.md$/i.test(it.path) ? titleOf(it.path) : it.path.split('/').pop()!
      const into = folderLabel(folderOfPath(it.path))
      const say = it.attachOf
        ? tNow('「{name}」的{n}个附件放回了原处', { name: titleOf(it.attachOf), n: paths.length })
        : it.with?.length
          ? tNow('「{name}」放回了「{folder}」，连同{n}张图', { name, folder: into, n: it.with.length })
          : tNow('「{name}」放回了「{folder}」', { name, folder: into })
      return !!(await restoreFromHistory(hash, paths, say))
    } catch (e) {
      setNotice(errText(e))
      return false
    }
  }

  /** 「最近删掉的」里没人用的附件（以前删笔记时没跟着走的）：这些一起移到废纸篓，一次提交，底栏撤回（反向提交）；移了返回 true */
  async function trashOrphans(paths: string[]): Promise<boolean> {
    try {
      const r = await window.cnAttach.trashOrphans(paths)
      refreshNotes()
      refreshGit()
      if (!r.n || !r.commit) {
        setNotice(tNow('这些附件又有笔记在用了，没有动'))
        return false
      }
      const commit = r.commit
      const text = tNow('{n}个没人用的附件移到了废纸篓，在「最近删掉的」里能放回', { n: r.n })
      noticeWithUndo(text, () =>
        void window.cn.undoRestore(commit).then(
          () => (refreshNotes(), refreshGit(), setNotice(tNow('撤回了，{n}个附件放回了原处', { n: r.n }))),
          (e) => setNotice(errText(e)),
        ),
      )
      setNoticeIcon({ text, icon: 'check', ok: true })
      return true
    } catch (e) {
      setNotice(errText(e))
      return false
    }
  }

  /** 文件夹移到废纸篓：主进程先弹系统确认；里面开着的标签一起关 */
  async function trashFolder(folder: string) {
    try {
      await NoteDoc.saveAll()
      const r = await window.cnFolder.trash(folder)
      if (r === null) return
      setTabState((s) => {
        const tabs = tabsOutside(s.tabs, folder)
        return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : (tabs[tabs.length - 1]?.id ?? null) }
      })
      const name = folder.split('/').pop()
      setNotice(
        r.attachments
          ? tNow('「{name}」和里面{n}个文件、{images}个附件移到了废纸篓，历史里能撤回', { name, n: r.files, images: r.attachments })
          : r.files
            ? tNow('「{name}」和里面{n}个文件移到了废纸篓，历史里能撤回', { name, n: r.files })
            : tNow('「{name}」移到了废纸篓，历史里能撤回', { name }),
      )
      refreshNotes()
      refreshGit()
    } catch (e) {
      setNotice(errText(e))
    }
  }

  const pluginCommands = usePluginCommands()
  const cardCommands = useCardCommands({ pdf: lastPdf, folder: activeTab?.type === 'folder' ? activeTab.folder : null, openNotes: (pdf) => app().openWithNote(pdf), openSettings: () => openSettingsAt('ankiAll') })
  /** 新建文件夹（⌘K、它的快捷键）：左栏换到「文件」，目录树画出来以后在树里原地新建（树登记了 new-folder） */
  function newFolderInTree() {
    openLeft('files')
    const tryIt = (n: number) => void (!runLocal('new-folder') && n > 0 && requestAnimationFrame(() => tryIt(n - 1)))
    requestAnimationFrame(() => tryIt(20))
  }
  /** 找文件（⌥⌘F，task-4891y）：同上，左栏换到「文件」，树画出来以后光标到它上面那个框（树登记了 find-file） */
  function findInTree() {
    openLeft('files')
    const tryIt = (n: number) => void (!runLocal('find-file') && n > 0 && requestAnimationFrame(() => tryIt(n - 1)))
    requestAnimationFrame(() => tryIt(20))
  }
  /** 命令表里的一条（名字、默认在哪组、说明照命令表 shared/cmd-table.ts），加上 ⌘K 里的图标和跑法 */
  const C = (id: string, icon: CodiconName, run: () => void, more: Partial<PaletteCommand> = {}): PaletteCommand => {
    const d = keyDef(id)!
    return { id, name: d.name, home: d.home, ...(d.hint ? { hint: d.hint } : {}), icon, run, ...more }
  }
  // ⌘K 的命令（DESIGN.v3 3.1）：id 是记在 .canvas-notes/命令.json 里的身份，home 是没改过时在哪一组（钉住的三条写的是取消钉住回到哪）。
  // 键都不写在这里：命令表里有默认的键，改过的在 命令.json
  const commands: PaletteCommand[] = [
    C('new-note', 'new-file', () => void newNote()),
    C('new-board', 'layout', () => void newBoard()),
    C('goto', 'go-to-file', () => setQuickOpen(true)),
    // 白板看法里拍：这块白板的子白板；文档看法里拍：光标处插缩略图；别处进收件箱（task-wuv05，mindmap/place.ts）
    C('capture', 'device-camera', () => captureHere({ path: activeTab?.type === 'note' ? activeTab.path : null, mode: activeMode, doc: activeDoc.current })),
    C('inbox', 'inbox', () => openInbox()),
    C('recent', 'clockface', () => openRecent()),
    C('archive', 'archive', () => openArchive()),
    C('home', 'home', () => openHome()),
    C('open-web', 'globe', () => openView('web')),
    C('dream-report', 'wand', () => openLeft('dream')),
    C('theme', 'symbol-color', () => openSettings('look')),
    C('edit-home', 'home', () => (openHome(), setHomeEditSeq((n) => n + 1))),
    // 文件夹首页一个个的：⌘K 没打字时收成一行「文件夹首页 › N 个」
    ...folders.map((f) => ({ id: `folder:${f.folder}`, folder: f.folder, name: tNow('{name} 首页', { name: f.folder.split('/').pop() }), hint: f.folder, icon: 'folder' as const, run: () => openFolder(f.folder) })),
    C('new-course', 'folder-library', () => void newCourse()),
    C('import', 'root-folder', () => openImport()),
    C('settings', 'settings-gear', () => openSettings()),
    C('history', 'history', () => openView('history')),
    C('commit', 'git-commit', () => void commit()),
    C('sync', 'sync', () => void sync()),
    C('ask-ai', 'comment-discussion', () => openAi(), { ai: 'chat' }),
    // 出卡（task-tz7y3）：这份 PDF、这门课没送的，设置那一行；打「我的疑惑」说那一页去哪了
    ...cardCommands,
    // 交给 AI 跑的画跑它的那一家的标志（偏好「AI 图标用引擎标志」）；找重复是本机比对、剪藏这一页不经 AI，用它们自己的图标
    // 提示字写做什么（标志已经说了是 AI）
    C('tidy-inbox', 'inbox', () => runAi('/整理收件箱'), { ai: 'chat' }), // 不翻：交给 AI 的命令名
    C('sum-board', 'layout', () => runAi('/总结这块白板'), { ai: 'chat' }), // 不翻：交给 AI 的命令名
    C('article', 'edit', () => runAi('/写成文章'), { ai: 'chat' }), // 不翻：交给 AI 的命令名
    C('dup', 'files', () => runAi('/找重复')), // 不翻：交给 AI 的命令名
    // 和网页「⋯」第一项、地址栏旁的引号按钮同一件事、同一个名字：右栏开着网页、剪下来底部提示带「打开」
    C('clip-page', 'quote', () => clipThisPage()),
    C('dream-now', 'wand', () => runAi('/现在梦游'), { ai: 'dream' }), // 不翻：交给 AI 的命令名
    // 以前只有快捷键的（task-spsmf）：⌘K 里打字搜得到、没打字时多半在「更多命令」里（task-xy89o），能右键设键
    C('back', 'arrow-left', () => navTo(-1)),
    C('forward', 'arrow-right', () => navTo(1)),
    C('toggle-left', 'layout-sidebar-left', () => setSidebarHidden((h) => !h)),
    C('toggle-right', 'layout-sidebar-right', () => toggleRightRef.current()),
    C('left-files', 'files', () => openLeft('files')),
    C('left-recent', 'clockface', () => openLeft('recent')),
    C('left-desks', 'layout', () => openLeft('desks')),
    C('left-trash', 'trash', () => openTrash()),
    C('find-file', 'search', () => findInTree()),
    C('find-in-page', 'search', () => void runFindInPage()),
    C('fold-center', maxNow ? 'screen-normal' : 'screen-full', () => toggleMax()),
    C('split-center', split ? 'close' : 'split-horizontal', () => toggleSplit(), split ? { name: '合成一格' } : { name: '向右分屏' }), // 不翻：键，⌘K 画的时候翻
    C('save-desk', 'layout', () => openDeskDialog()),
    // 书桌一张一条（⌘K 里「书桌」一组，打字搜名字也行）
    ...deskList.map((e) => ({ id: `desk:${e.file}`, desk: true, name: tNow('书桌：{name}', { name: e.desk.name }), hint: tNow('{n} 篇笔记 · {m} 个网页', { n: e.desk.notes.length, m: e.desk.web.length }), icon: 'layout' as const, run: () => openDesk(e.file) })),
    // 和右栏这个网页配成一对… / 解除这篇和网页的配对：中间开着笔记、右栏开着网页时
    ...(activeNote && rightWeb && vis('web')
      ? [
          pairOf(activeNote) && notesOfUrl(rightWeb).includes(activeNote)
            ? C('pair-web', 'close', () => void unpairNote(activeNote), { name: '解除这篇和网页的配对', hint: unpairLabel(activeNote) }) // 不翻：键，⌘K 画的时候翻（Palette 的 t(c.name)）
            : C('pair-web', 'link', () => {
                const pg = rightPage()
                if (pg) openPairPop(activeNote, pg, document.querySelector('.titlebar .cmd') ?? new DOMRect(innerWidth / 2 - 180, 48, 360, 0), 'left')
              }),
        ]
      : []),
    C('outline', 'list-tree', () => openView('outline')),
    ...(activeTab?.type === 'note' ? [C('related', 'references', () => openView('related'))] : []),
    ...(notesOk ? [C('notes', 'note', () => openView('note'))] : []),
    C('close', 'close', () => closeHereRef.current()),
    ...(activeTab && canRenameTab(activeTab) ? [C('rename', 'edit', () => setRenaming(activeTab.id))] : []),
    C('new-folder', 'new-folder', () => newFolderInTree()),
    ...(activeTab?.type === 'note' ? [C('toggle-view', 'layout', () => void runLocal('toggle-view'))] : []),
    // 导图白板开着时（task-wuv05）：收起到第一层、全部展开（NoteTab 登记的跑法，mindmap/LayoutMenu.tsx）
    ...(activeNote && notes.find((n) => n.path === activeNote)?.board?.nodes !== undefined ? [C('mm-fold-all', 'collapse-all', () => void runLocal('mm-fold-all')), C('mm-unfold-all', 'expand-all', () => void runLocal('mm-unfold-all')), C('mm-export', 'export', () => void runLocal('mm-export'))] : []),
    C('keys-settings', 'record-keys', () => openSettings('keys')),
    C('ai-new-chat', 'add', () => (openAi(), requestAnimationFrame(() => void runLocal('ai-new-chat'))), { ai: 'chat' }),
    C('web-new-tab', 'add', () => void (runLocal('web-new-tab') || openView('web'))),
    ...(Dk.isOpen(dock, 'web') ? [C('web-address', 'globe', () => void runLocal('web-address')), C('web-reload', 'refresh', () => void runLocal('web-reload'))] : []),
    // 网页栏顶上收起 / 展开、书签栏开关（task-sta8n）：右栏网页开着时
    ...(Dk.isOpen(dock, 'web') ? [C('web-top-fold', 'chevron-up', () => void runLocal('web-top-fold')), C('web-bookmarks-bar', 'bookmark', () => void runLocal('web-bookmarks-bar'))] : []),
    ...(update && update.phase !== 'off' ? [{ id: 'update', home: 'app', name: '检查更新', icon: 'arrow-circle-up' as const, run: () => (openSettingsAt('checkNow'), void window.cn.checkUpdate()) }] : []), // 不翻：键，⌘K 画的时候翻（Palette 的 t(c.name)）
    ...(update?.phase === 'ready' ? [{ id: 'restart-update', home: 'app', name: '重启更新', hint: tNow('新版本{v}已下好', { v: update.version }), icon: 'arrow-circle-up' as const, run: () => void installUpdate() }] : []), // 不翻：键，⌘K 画的时候翻（Palette 的 t(c.name)）
    ...pluginCommands,
    // 自己加的（.canvas-notes/命令.json）
    ...cmdCfg.own.map(ownCommand),
    ...localAiCmds.map((c) => ownCommand(aiCmdJson(c))),
  ]
  /** 现在的命令（快捷键按下时找它跑） */
  const commandsRef = useRef(commands)
  commandsRef.current = commands
  // 每次画完把现在有的命令交给快捷键那一份（命令表以外的：插件的、自己加的；哪个键归谁、网页有焦点时要转回来哪几个在 keys.ts）
  useEffect(() => {
    setRegistry(commandsRef.current.map((c) => ({ id: c.id ?? c.name, name: c.name, ...(c.keys ? { keys: c.keys } : {}), ...(c.fixedKeys ? { fixedKeys: true } : {}) })))
  })
  /** 跑一条命令（⌘K 里点的、菜单栏点的、快捷键按的） */
  function runById(id: string) {
    const c = commandsRef.current.find((x) => (x.id ?? x.name) === id)
    if (!c) return false
    noteUsed(id)
    setPaletteOpen(false)
    c.run()
    return true
  }

  /**
   * 按键跑一条全局命令：有的按键和 ⌘K 里点的不一样（按一下开、再按一下收），要看场合的交给登记了它的那一块（keys.ts 的 runLocal）；
   * 返回 false 是这会儿不归它（场合不对、焦点在输入框里），按键接着往下走（放大缩小在白板、PDF 以外交给系统菜单缩整个窗口）
   */
  const keyRunRef = useRef<(id: string) => boolean>(() => false)
  keyRunRef.current = (id) => {
    switch (id) {
      case 'search':
        return (setQuickOpen(false), setPaletteOpen((v) => !v), true)
      case 'goto':
        return (setPaletteOpen(false), setQuickOpen((v) => !v), true)
      case 'ask-ai': {
        // 文档里选了字、AI 还没开：带着这段打开，光标在输入框，不自动发（CN-67 A）
        const d = activeDoc.current
        const sel = d?.view.hasFocus ? d.view.state.selection.main : null
        const picked = sel && !sel.empty ? d!.view.state.sliceDoc(sel.from, sel.to).trim() : ''
        if (picked && !aiShown) app().askAi(picked)
        else toggleAi()
        return true
      }
      case 'settings':
        return (openSettings(undefined, true), true)
      // 栏目：按一下开、看得见再按收起（和点图标栏上那一格一样）
      case 'left-files':
        return (toggleLeft('files'), true)
      case 'left-recent':
        return (toggleLeft('recent'), true)
      case 'left-desks':
        return (toggleLeft('desks'), true)
      case 'left-trash':
        return (toggleLeft('trash'), true)
      case 'fold-center':
        return (toggleMax(), true)
      case 'split-center':
        return (toggleSplit(), true)
      // ⌘1 / ⌘2：换到那一格（照 VS Code）；没分屏时 ⌘2 向右分屏，⌘1 不归它
      case 'pane-1':
        return !!splitNow.current && (goPane(0, true), true)
      case 'pane-2':
        return splitNow.current ? (goPane(1, true), true) : (toggleSplit(), true)
      case 'dream-report':
        return (toggleLeft('dream'), true)
      case 'outline':
        return (toggleView('outline'), true)
      case 'related':
        return (toggleView('related'), true)
      case 'open-web':
        return (toggleView('web'), true)
      case 'history':
        return (toggleView('history'), true)
      case 'notes':
        return notesOk && (toggleView('note'), true)
      case 'rename': {
        // 焦点在输入框里时不抢；在目录树里是改树上选着的那一行（树自己接）
        if (!activeTab || !canRenameTab(activeTab) || (document.activeElement as HTMLElement | null)?.closest?.('input, textarea, [role=tree]')) return false
        return (setRenaming(activeTab.id), true)
      }
      // 右栏网页开着（在别的标签后面也算）就加一个标签；没开过就打开它，空着的网页那一格自己开一个新标签
      case 'web-new-tab':
        return runLocal(id) || (openView('web'), true)
      // 在这一页里找（⇧⌘F）：焦点在哪一栏就找哪一栏（find/find-hub.ts）
      case 'find-in-page':
        return runFindInPage()
    }
    if (runLocal(id)) return true
    // 要看场合的（放大缩小、问这一页、引用、地址栏……）这会儿没有那一块：不归它
    if (keyDef(id) && !keyDef(id)!.home) return false
    return runById(id)
  }
  /** 自己加的命令：打开库里一处（文件夹开首页）、右栏打开网址；kind 是 ai 的交给 AI 对话（以后「存成自己的 AI 命令」） */
  function ownCommand(o: OwnCommand): PaletteCommand {
    return {
      id: o.id,
      own: o,
      name: o.name,
      // AI 命令（存成命令那张表存的）：提示字写它的标签（改这一篇 · 先给你看 · 能撤回），图标画跑它的那一家的标志
      hint:
        o.kind === 'url'
          ? o.target.replace(/^https?:\/\/(www\.)?/, '')
          : o.kind === 'ai'
            ? aiCmdOf(o, 'vault')?.reply
              ? // 快捷回复（task-eavzx）：跑它就是在右栏 AI 对话里发那句
                tNow('快捷回复 · {say}', { say: (aiCmdOf(o, 'vault')!.prompt ?? aiCmdOf(o, 'vault')!.desc).split('\n')[0]!.slice(0, 40) })
              : tagsOf(aiCmdOf(o, 'vault') ?? { write: 'inplace' })
                  .map((t) => t[0])
                  .join(' · ')
            : o.target.slice(0, 26),
      icon: o.kind === 'url' ? 'globe' : o.kind === 'ai' ? 'comment-discussion' : 'folder-opened',
      ...(o.kind === 'ai' ? { ai: 'chat' as const } : {}),
      home: o.kind === 'ai' ? 'ai' : 'go',
      run: () => {
        if (o.kind === 'url') return openInWeb(o.target)
        // 交给 AI 对话照 / 命令跑（和在输入框里打 /名字 一样：先给你看、一次提交、能撤回）；
        // 快捷回复在 AI 对话那边认出来，发它那句（空照这段对话最新那条回答填好，AiPanel 的 run）
        if (o.kind === 'ai') return runAi('/' + o.name)
        const f = vaultFiles().find((x) => x.path === o.target)
        if (!f) return setNotice(withKeys(tNow('库里没有「{target}」了：在 {k:search} 里右键「{name}」改一下', { target: o.target, name: o.name })))
        if (f.kind === 'dir') openFolder(o.target)
        else openFile(o.target)
      },
    }
  }

  async function commit() {
    try {
      const c = await window.cn.commit()
      setNotice(c ? tNow('提交好了：{subject}', { subject: c.subject }) : tNow('没有要提交的改动'))
    } catch (e) {
      setNotice(errText(e))
    }
    refreshGit()
  }

  async function sync() {
    try {
      const r = await window.cn.sync()
      if (r.kind === 'no-remote') setNotice(tNow('这个库还没有远程仓库，同步不了。先用git remote add加一个。'))
      else if (r.kind === 'conflict') setNotice(tNow('远程和本机改了同一处，已经退回同步前，本机的字都在。需要手动合并一次。'))
      else {
        const n = r.pulled
        setNotice(
          r.committed && n && r.pushed
            ? tNow('先提交了本机的改动，拉下{n}次提交，推上去了', { n })
            : r.committed && n
              ? tNow('先提交了本机的改动，拉下{n}次提交', { n })
              : r.committed && r.pushed
                ? tNow('先提交了本机的改动，推上去了')
                : n && r.pushed
                  ? tNow('拉下{n}次提交，推上去了', { n })
                  : r.committed
                    ? tNow('先提交了本机的改动')
                    : n
                      ? tNow('拉下{n}次提交', { n })
                      : r.pushed
                        ? tNow('推上去了')
                        : tNow('已经是最新的'),
        )
      }
    } catch (e) {
      setNotice(errText(e))
    }
    refreshGit()
    refreshNotes()
    // 同步可能拉下来别处改过的首页
    void reloadHome()
  }

  /** 设置里「去那里」：网页「⋯ › 插件」、视频条的字幕菜单。去不了时说一句为什么 */
  function goPlace(place: 'web-extensions' | 'video-subs') {
    setSettingsPage(null)
    openView('web')
    // 网页那一格画出来再开它的菜单；没有开着的视频时说一句
    setTimeout(() => {
      if (window.dispatchEvent(new CustomEvent(place === 'web-extensions' ? WEB_EXTENSIONS_EVENT : VIDEO_SUBS_EVENT, { cancelable: true })))
        setNotice(place === 'web-extensions' ? tNow('右栏没有开着的网页') : tNow('右栏没有开着的视频：开着YouTube、B站的视频时，视频条上「字幕」那个菜单里改'))
    }, 120)
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

  // 右栏网页上按住 ⌘ 框好一块：截下来放进右栏 AI 的输入框（中间开着 PDF / HTML 就进它的 AI，不然进网页的）；工具条上的按钮直接问；
  // 引用（task-6cxtc）：这块截图成为输入框顶上的一块材料、光标进去；「⋯」里拷贝这块、翻译设置
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
        if (e.action === 'settings') return openTranslateSettings()
        if (!e.box) return
        const src = doc ?? `web:${e.box.url}`
        // 进哪段对话同引用（ai-web-stay.ts 的 convoFor）：进别的一段时框好先不放进网页自己那段（不把右栏拽回来），点了引用、讲解再截图交过去
        const to = doc ? null : convoFor(e.box.url)
        try {
          if (to && e.action === 'stage') return
          if (to && (e.action === 'explain' || e.action === 'translate' || e.action === 'quote')) {
            // 进普通对话的问答也照网页的「记笔记」写进剪藏那篇（AiPanel 认带着网页图的一问）：没定记到哪篇先问一句
            const r = e.box.rect
            if (!readSrc(to.key) && !(await ensureAsk(e.box.url, anchorOf(e.box.bar ?? { x: r.x, y: r.y + r.h + 8, w: r.w, h: 32 }, e.view.getBoundingClientRect())))) return
            const png = await window.cnReading.capture(e.wcId, e.box.rect)
            clearWebBox(e.view)
            return await boxIntoConvo(to, { url: e.box.url, title: e.box.title, text: e.box.text, ...(e.box.head ? { head: e.box.head } : {}) }, png, e.action)
          }
          // 讲解、翻译、引用：网页上框着问（中间没开 PDF、HTML）还没定记到哪篇先问一句，框和工具条留着、弹层贴在工具条下面
          // （同选字的小条，task-6cxtc）；取消了框照旧留着，可以换一颗点；定了（或不用问）收起框和工具条
          if (e.action === 'explain' || e.action === 'translate' || e.action === 'quote') {
            const r = e.box.rect
            if (!doc && !(await ensureAsk(e.box.url, anchorOf(e.box.bar ?? { x: r.x, y: r.y + r.h + 8, w: r.w, h: 32 }, e.view.getBoundingClientRect())))) return
            clearWebBox(e.view)
          }
          if (e.action === 'copy') {
            const png = to ? await window.cnReading.capture(e.wcId, e.box.rect) : Reading.get(src).pending?.png
            if (!png) return setNotice('这块还没截好，再框一次')
            await window.cnMenu.copyImage(png)
            return setNotice('这块图拷贝好了')
          }
          // 先截图再开 AI：右栏下格一开，网页就变矮了
          const shot = e.action === 'stage' || !Reading.get(src).pending?.web ? await window.cnReading.capture(e.wcId, e.box.rect) : null
          if (!doc) setWebAsk(src)
          openAi()
          await Reading.load(src)
          if (shot) {
            const png = shot
            const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }))
            const page = doc && /\.pdf$/i.test(doc) ? Reading.get(doc).state.page : 0
            Reading.stage(src, { page, url, png, web: { url: e.box.url, title: e.box.title || e.box.url, text: e.box.text, ...(e.box.head ? { head: e.box.head } : {}) }, ...(e.action === 'explain' || e.action === 'translate' ? { direct: true } : {}) })
          }
          if (e.action === 'explain') await Reading.send(src, '给我讲解一下')
          else if (e.action === 'translate') await Reading.send(src, '先把这块翻译成中文，再讲一讲')
          else if (e.action === 'quote') await Reading.quotePending(src)
        } catch (err) {
          setNotice(errText(err))
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /** ⌘J、右下角圆钮：AI 看得见就收起这个标签；开着在后面就换到它；没开就打开 */
  function toggleAi() {
    if (aiShown) return closeView('ai')
    // 右栏开着视频、还没在问它：AI 问的是这个视频（和读 PDF 一样，CN-84）
    if (!readingPdf && Dk.isOpen(dock, 'web') && videoOf(rightWeb ?? '')) return askInRight()
    if (readingPdf) Reading.wantAiFocus()
    openAi()
  }

  /** 右栏网页（视频）下格开 AI；from 给了（问答块上「接着问」）就把那一问放进输入框当引文，标「00:06 · 视频名」 */
  askInRightRef.current = askInRight
  function askInRight(from?: AskFrom) {
    const cur = rightWeb ?? ''
    // 「接着问」：右栏开着的就是这个视频就接着用它；不是（或右栏没开网页）先把视频开到那一秒
    const same = !!from && videoOf(cur)?.key === videoOf(from.url)?.key
    const u = from && !same ? from.url : cur
    if (!/^https?:/i.test(u)) return openAi()
    // 同一个视频：跳回那一秒停住，看着那一帧追问
    if (from) videoHost()?.openAt(from.url, from.t, same)
    const src = `web:${u}`
    if (!aiShown || webAsk !== src) Reading.wantAiFocus()
    setWebAsk(src)
    openView('web')
    openAi()
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
  // 点了「在树里看」：左栏换到「文件」页，看改好以后的目录（spec 第 5 节）；点「回到报告」、esc 退出时回到梦游报告（task-m552v）
  const pvLeft = useRef(false)
  useEffect(() => {
    if (pv.on) {
      pvLeft.current = true
      openLeft('files')
    } else if (pvLeft.current) {
      pvLeft.current = false
      openLeft('dream')
    }
  }, [pv.on])
  // 梦游重新设计（task-m552v）：左栏报告、中间对照、目录树共用的那份，和打开一条、收下、丢掉、撤回的跑法
  useDreamWiring({
    report: dream.report,
    setReport: dream.setReport,
    openDiff,
    take: dreamTake,
    drop: dreamDrop,
    notice: setNotice,
    undoFailed,
    refresh: () => (refreshNotes(), refreshGit()),
    openHtml: (p, branch) => (branch ? open((t) => t.type === 'html' && t.path === p && !!t.dream, () => ({ id: newId(), type: 'html', path: p, dream: true })) : openHtml(p)),
  })
  useEffect(() => setHomeLooks(folders), [folders])
  const tabIcon = (t: Tab) => {
    if (t.type === 'folder') return <FolderGlyph folder={t.folder} mono size={15} />
    const board = t.type === 'note' ? notes.find((n) => n.path === t.path)?.board : null
    if (board) return <i className="sw" style={{ background: board.color }} />
    // 书摘（微信读书同步来的，frontmatter 有 bookId）：quote，和「阅读」首页标签的 book 分得开（DESIGN.v3 1.7）
    if (t.type === 'note' && isDigestTab(t.path)) return <Codicon name="quote" size={15} />
    return <Codicon name={TAB_ICON[t.type]} size={15} />
  }
  // AI 动手时要的：现在看的是什么、编辑器、打开右栏网页
  const aiState = {
    tab: activeTab,
    mode: activeMode,
    doc: activeDoc.current,
    notes,
    webOpen: Dk.isOpen(dockShown, 'web'),
    webUrl: rightWeb,
    openWeb: openWebForAi,
    closeUnder: (path: string) =>
      setTabState((s) => {
        const tabs = tabsOutside(s.tabs, path)
        return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : (tabs[tabs.length - 1]?.id ?? null) }
      }),
    retarget: (from: string, to: string) => {
      setTabState((s) => ({ ...s, tabs: retargetTabs(s.tabs, from, to) }))
      refreshNotes()
    },
  }
  useAiBridge(aiState)
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
      aiOpen: aiShown,
      openAi: () => openAi(),
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
      // 视频「先在设置里填Soniox密钥」：到设置 › 网页和视频那一行（以前在 AI 页最下面）
      openAiSettings: () => openSettingsAt('soniox'),
    })
  }, [activeTab, activeMode, aiShown, refreshNotes, refreshGit, openNote])
  /** 中间开着能写的文档（文档看法，不是白板）：右键「插进文档」插它的光标处 */
  const docMode = activeTab?.type === 'note' && activeMode !== 'board'

  // 网页的笔记（task-6cxtc）：网页小条上点的讲解、引用、剪藏走 web-notes/flow.ts，这里交进去中间开着什么、底栏、AI 那一格
  const webSay = (text: string, o?: { act?: NoticeAct; more?: NoticeAct; undo?: () => void }) => {
    setNotice(text)
    setNoticeIcon(null)
    setNoticeUndo(o?.undo ? { text, run: o.undo } : null)
    setNoticeAct(o?.act ? { text, ...o.act } : null)
    setNoticeMore(o?.more ? { text, ...o.more } : null)
  }
  /** 中间看得见、能写的那篇（文档看法，中间没收起） */
  const webCenterNow = () => (docMode && !folded && activeDoc.current && !activeDoc.current.readOnly && activeDoc.current.path === activeTab.path ? activeTab.path : null)
  /** 那篇（不在中间就开它，配成一对的网页不跟着跳）里 find 找到的那段滚到当中、左边亮一道；找不到只打开 */
  const showInNote = (path: string, find: (text: string) => { from: number; to: number } | null) => {
    showCenter()
    if (activeNote !== path) openNote(path, false, true)
    let tries = 0
    const look = () => {
      const d = [...NoteDoc.open].find((x) => x.path === path)
      const r = d ? find(d.text) : null
      if (!d || !r || !d.view.dom.getClientRects().length) return void (tries++ < 30 && setTimeout(look, 50))
      d.view.dispatch({ effects: EditorView.scrollIntoView(r.from, { y: 'center' }) })
      flashRange(d.view, r)
    }
    requestAnimationFrame(look)
  }
  setWebNotesHost({
    center: webCenterNow,
    readingDoc: () => readingDoc,
    notes: () => notes.flatMap((n) => (/\.md$/i.test(n.path) ? [n.path] : [])),
    clipToInbox: async (c) => {
      await window.cn.clipToInbox(c)
      setNotice('剪成卡片，放进收件箱了')
      refreshNotes()
      refreshGit()
    },
    askIn: (src) => {
      if (Reading.isWebSrc(src)) setWebAsk(src)
      openAi()
    },
    showAi: () => openAi(),
    notice: webSay,
    openTranslateSettings: () => openTranslateSettings(),
    notesShown: () => vis('note'),
    showNote: (_path, line) => {
      openView('note')
      if (line) setWebNoteFocus((f) => ({ line, seq: (f?.seq ?? 0) + 1 }))
    },
    refresh: () => {
      refreshNotes()
      refreshGit()
    },
    full: () => (folded ? { note: foldNote, pick: fullPick, inbox: fullInbox } : null),
    showWeb: () => {
      setWebAsk(null)
      openView('web')
    },
    // 「看一眼」：还原，那篇里刚剪的那段滚到当中、左边亮一道
    peek: (path, md) => {
      const want = md.trimEnd()
      showInNote(path, (text) => {
        const at = text.lastIndexOf(want)
        return at < 0 ? null : { from: at, to: at + want.length }
      })
    },
    showAsk: (path, msg) =>
      showInNote(path, (text) => {
        const u = askUnits(text, path).find((x) => x.ask.msg === msg)
        return u ? { from: u.from, to: u.end } : null
      }),
  })
  setBridgeCenter(webCenterNow)
  // 网页上点了问过、剪过那一段的小标：右栏笔记标签翻到那几条里的第一条
  setMarkHandler((_url, ids) => {
    openView('note')
    const line = ids[0]!.slice(0, ids[0]!.lastIndexOf('\n'))
    setWebNoteFocus((f) => ({ line, seq: (f?.seq ?? 0) + 1 }))
  })
  // 网页占满时地址栏的「记进《这篇》」小牌（task-05p2w 方向 A）：写的那篇和 flow.ts 的 targetNow 同一个算法
  const fullUrl = rightWeb && /^https?:/i.test(rightWeb) ? rightWeb : null
  const fullTarget = folded ? (fullPick ?? (fullUrl ? targetOf(fullUrl, foldNote, (p) => notes.some((n) => n.path === p)) : null) ?? foldNote) : null
  const fullChip = (
    <FullChip
      target={fullTarget}
      inbox={fullInbox}
      paired={!!fullTarget && !!fullUrl && notesOfUrl(fullUrl).includes(fullTarget)}
      count={fullCount}
      onInbox={setFullInbox}
      onPick={(r) => {
        if (!fullUrl) return
        void pickTarget(fullUrl, { left: r.left, top: r.top, bottom: r.bottom, right: r.right }).then((w) => {
          if (w?.kind === 'doc') (setFullPick(w.path), setFullInbox(false))
          else if (w?.kind === 'inbox') setFullInbox(true)
        })
      }}
    />
  )
  // 中间换了一篇、配对变了、笔记列表变了：网页上的剪藏提示、记号重发
  const pairsSig = [...usePairs()].join('\n')
  useEffect(() => refreshWebNotes(), [webCenter, pairsSig, notes, folded, foldNote, fullInbox, fullPick])

  // 右键菜单要用的整个软件的动作（ctx/actions.ts）：每次渲染都换成最新的
  const openWide = (url: string, title?: string) => open((t) => t.type === 'web' && t.url === url, () => ({ id: newId(), type: 'web', url, title }))
  /** 当前标签换成这一篇（右键「打开」）；它已经开在别的标签就切过去 */
  const openHere = (path: string) => {
    if (!/\.md$/i.test(path)) return openFile(path)
    showCenter()
    followNote(path)
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
    openFileBehind(path) {
      const type = /\.pdf$/i.test(path) ? 'pdf' : /\.html?$/i.test(path) ? 'html' : 'note'
      setTabState((s) => (s.tabs.some((t) => t.type === type && 'path' in t && t.path === path) ? s : { ...s, tabs: [...s.tabs, { id: newId(), type, path } as Tab] }))
    },
    openDiff(src, title, behind) {
      if (!behind) return openDiff(src, title)
      const same = (t: Tab) => t.type === 'diff' && JSON.stringify(t.src) === JSON.stringify(src)
      setTabState((s) => (s.tabs.some(same) ? s : { ...s, tabs: [...s.tabs, { id: newId(), type: 'diff', src, title }] }))
    },
    openPdfAt,
    openHere,
    openNoteOnly: (path) => openNote(path, false, true),
    pairWeb(path) {
      const pg = rightPage()
      if (pg) openPairPop(path, pg, document.querySelector('.titlebar .cmd') ?? new DOMRect(innerWidth / 2 - 180, 48, 360, 0), 'left')
    },
    unpairWeb: (path) => void unpairNote(path),
    openWikilink(target, here) {
      const name = target.toLowerCase()
      const hit = notes.find((n) => titleOf(n.path).toLowerCase() === name || n.path.toLowerCase() === name + '.md')
      if (hit && here) openHere(hit.path)
      else openLink(target)
    },
    openReading(path) {
      openFile(path)
      openAi()
    },
    openWithNote(path) {
      openFile(path)
      if (!Dk.isOpen(dockNow.current, 'note')) openNotes()
    },
    openInWeb,
    openWide,
    closeSettingsDialog: () => !settingsTab && setSettingsPage(null),
    sendAi: (text) => runAi(text),
    askAi(text, src) {
      // 来源：给了用给的（右栏网页「网页《标题》」），不然是当前这一页「《文档标题》」
      const from = src ?? (activeTab && 'path' in activeTab && activeTab.path ? `《${titleOf(activeTab.path)}》` : tNow('选中的字'))
      if (readingDoc) {
        // 读 PDF / HTML 时那一格是读 PDF 的 AI：这段字成为那边输入框的第一块引用
        openAi()
        Reading.addMaterial(readingDoc, { kind: 'quote', text: text.trim().slice(0, 20_000), src: from }, { doc: true })
        return
      }
      setWebAsk(null)
      openAi()
      setAiDraft((d) => ({ text, src: from, seq: (d?.seq ?? 0) + 1 }))
    },
    openChat(key, msg) {
      setWebAsk(null)
      openAi()
      jumpToChat(key, msg)
    },
    askAiFiles(items) {
      setWebAsk(null)
      openAi()
      pickForAi(items, activeTab?.id ?? null)
    },
    // 白板、文档的选中操作条（task-5ryf9）：问AI 只打开，AI整理当场跑 /整理这几张、/整理这几段
    runAi(text) {
      setWebAsk(null)
      if (text) runAi(text)
      else openAi()
    },
    notice: (t, icon) => (noticeWithUndo(t), setNoticeIcon(icon ? { text: t, icon } : null)),
    noticeUndo: (t, run) => (noticeWithUndo(t, run), setNoticeIcon(null)),
    noticeDrop: (t) => setNotice((n) => (n === t ? null : n)),
    noticeBehind(text, is) {
      noticeWithUndo(text)
      setNoticeIcon(null)
      behindNotice.current = { text, is }
    },
    toast(x) {
      noticeWithUndo(x.text, x.undo)
      setNoticeIcon(x.icon ? { text: x.text, icon: x.icon } : null)
      setNoticeAct(x.act ? { text: x.text, ...x.act } : null)
    },
    doc: () => (docMode && activeDoc.current && !activeDoc.current.readOnly ? activeDoc.current : null),
    async clip(c, to) {
      if (to === 'doc') {
        // 右键「剪进文档」：同小条上的剪藏（记进这个网页正在剪进去的那篇，还没定先问一句，贴着右栏网页问）
        const r = document.querySelector('.right.web webview.on')?.getBoundingClientRect() ?? new DOMRect(innerWidth - 380, 120, 340, 40)
        return clipWeb(c, { left: r.left + 16, top: r.top + 40, bottom: r.top + 72, right: r.right - 16 })
      }
      await window.cn.clipToInbox(c)
      setNotice(tNow('剪成卡片，放进收件箱了'))
      refreshNotes()
      refreshGit()
    },
    openWebAt,
    refresh: () => (refreshNotes(), refreshGit()),
    // 文件夹右键「新建笔记」：和 ⌘N 同一条路（以前另建一份，关掉时空着也不进废纸篓）
    newNote: (folder) => newNote(folder),
    newCourse: () => newCourse(),
    async newBoard(folder) {
      const path = await window.cn.createBoard(folder, '未命名白板') // 不翻：新建时的默认名字（写进文件）
      refreshNotes()
      openNote(path, true)
    },
    trash,
    trashMany,
    moveMany,
    moveItem,
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
    allFolders: () => {
      const all = allFolders(
        [...notes.map((n) => n.path), ...pdfs.map((x) => x.path)],
        // 附件文件夹不当「移到」的去处（附件跟着笔记走）；整套分类总在（还没建的挪进去时建）
        [...CATEGORY_NAMES, ...folders.map((f) => f.folder), ...vaultFiles().filter((f) => f.kind === 'dir' && f.path !== '附件' && !f.path.startsWith('附件/')).map((f) => f.path)], // 不翻：「附件」是磁盘上的附件文件夹名（分类在 CATEGORY_NAMES 里，跟着库语言）
      )
      // 数据库的记录文件夹也不当去处（挪进去就成了一条记录，task-5yp97）
      const bases = vaultFiles().filter(isBaseFolder).map((f) => f.path)
      return bases.length ? all.filter((f) => !bases.some((b) => f === b || f.startsWith(b + '/'))) : all
    },
    putOnLeft,
    takeOffLeft,
    async moveFolder(folder, parent) {
      try {
        await NoteDoc.saveAll()
        const to = await window.cnFolder.move(folder, parent)
        setTabState((s) => ({ ...s, tabs: retargetTabs(s.tabs, folder, to) }))
        setNotice(tNow('「{name}」挪到了{where}，库里指向它的链接一起改好了', { name: folder.split('/').pop(), where: parent || vault.name }))
        refreshNotes()
        refreshGit()
      } catch (e) {
        setNotice(errText(e))
      }
    },
    async moveNote(path, folder) {
      await NoteDoc.saveAll()
      const { to, with: dbs } = await window.cnMenu.moveNote(path, folder)
      setTabs((x) => x.map((t) => (t.type === 'note' && t.path === path ? { ...t, path: to } : t)))
      // 挂在它下面的数据库记录文件夹跟着挪了（task-5yp97）：开着的首页、里面的条目跟着换路径
      if (dbs.length) setTabState((s) => ({ ...s, tabs: dbs.reduce((tabs, m) => retargetTabs(tabs, m.from, m.to), s.tabs) }))
      const where = folder || vault.name
      // 那里已经有同名的：存成了「X 2」，说出新名字（不悄悄改名）
      const said = titleOf(to) === titleOf(path) ? tNow('「{name}」', { name: titleOf(path) }) : tNow('「{name}」（{where}里已经有一篇叫「{name}」，这篇存成「{to}」）', { name: titleOf(path), where, to: titleOf(to) })
      if (dbs.length) {
        const names = dbs.map((m) => (fileName(m.to) === fileName(m.from) ? tNow('「{name}」', { name: fileName(m.to) }) : tNow('「{name}」（那里已经有一个，存成「{to}」）', { name: fileName(m.from), to: fileName(m.to) })))
        setNotice(tNow('{said}和它的数据库{names}挪到了{where}，库里指向它们的链接一起改好了', { said, names: list(names), where }))
      } else setNotice(titleOf(to) === titleOf(path) ? tNow('「{name}」挪到了{where}', { name: titleOf(path), where }) : tNow('{where}里已经有一篇叫「{name}」，这篇挪过去存成「{to}」', { where, name: titleOf(path), to: titleOf(to) }))
      refreshNotes()
      refreshGit()
    },
    absPath: (rel) => vault.path + '/' + rel,
    openTrash,
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
  // ---------------------------------------------------------------- 长期一起看的网页和笔记（task-kbnc0）
  const say = (text: string, o?: { undo?: () => void; act?: { label: string; icon: CodiconName; run(): void } }) => {
    setNoticeIcon(null)
    if (o?.act) {
      setNotice(text)
      setNoticeUndo(null)
      setNoticeAct({ text, ...o.act })
    } else noticeWithUndo(text, o?.undo)
  }
  setReadAlongHost({
    notice: say,
    openBook: (r) => {
      setReadReq((x) => ({ ...r, seq: (x?.seq ?? 0) + 1 }))
      // 网页跟着开：不换当前栏（光标还在笔记里）
      openView('web', false)
    },
    pageNow: () => webNow.current?.() ?? Promise.resolve(null),
    refresh: () => refreshNotes(),
    quiet: () => setNotice(null),
  })
  const cols = Dk.sideCols(dockShown).length
  setDeskHost({
    notice: say,
    center: () => ({ notes: tabs.flatMap((t) => (t.type === 'note' ? [t.path] : [])), active: activeTab?.type === 'note' ? activeTab.path : null }),
    setCenter(list, at) {
      const prev = { tabs, active }
      const have = new Set(notes.map((n) => n.path))
      const next: Tab[] = list.filter((p) => have.has(p)).map((p) => tabs.find((t) => t.type === 'note' && t.path === p) ?? { id: newId(), type: 'note', path: p })
      if (!next.length) next.push({ id: newId(), type: 'home' })
      const front = next.find((t) => t.type === 'note' && t.path === at) ?? next[next.length - 1]!
      setTabState({ tabs: next, active: front.id })
      return prev
    },
    restoreCenter: (prev) => setTabState(prev as { tabs: Tab[]; active: string | null }),
    web: () => webDesk.current,
    layout: () => ({ left: !sidebarHidden, web: vis('web'), center: !folded }),
    setLayout(l) {
      const prev = { left: !sidebarHidden, web: vis('web'), center: !folded }
      setSidebarHidden(!l.left)
      if (l.web) openView('web', false)
      else if (vis('web')) closeView('web')
      setMax(!l.center && l.web ? { kind: 'web' } : null)
      return prev
    },
    layoutText: () =>
      list([
        !cols ? tNow('右栏收着') : cols === 1 ? tNow('右栏一栏') : cols === 2 ? tNow('右栏两栏') : cols === 3 ? tNow('右栏三栏') : cols === 4 ? tNow('右栏四栏') : tNow('右栏{n}栏', { n: cols }),
        vis('web') ? tNow('网页在前') : Dk.isOpen(dock, 'web') ? tNow('网页在后面') : tNow('网页没开'),
        sidebarHidden ? tNow('左栏收着') : tNow('左栏开着'),
        ...(folded ? [tNow('中间栏收着')] : []),
      ]),
    showDesks: () => openLeft('desks'),
    navAt: () => nav.current.i + 1,
    quiet: () => setNotice(null),
  })
  // 这篇在中间开着、右栏开着一个网站：记一次「一起开」（提示「配成一对？」看它）
  const webShownNow = vis('web')
  useEffect(() => {
    if (activeNote && rightWeb && webShownNow) noteCoOpen(activeNote, rightWeb)
  }, [activeNote, rightWeb, webShownNow])
  // 开着的书桌：中间的标签、样子变了就自动记下（网页那边 WebPanel 的 onWebChange）
  const pairsNow = usePairs()
  useEffect(() => deskChanged(pairsNow.values()), [tabs, active, sidebarHidden, folded])
  useEffect(() => {
    if (folded && videoSaved) setNotice(videoSaved.text)
  }, [videoSaved?.seq])
  useEffect(() => {
    const on = () => openDeskDialog()
    window.addEventListener('cn:save-desk', on)
    return () => window.removeEventListener('cn:save-desk', on)
  }, [])
  const frame = settings.appearance.frame
  // 梦游预览时数的是改好以后的收件箱
  // 收件箱/待办.md 是放随手加的待办的（在左边「待办」格里），不算等着整理的
  const inboxCount = (pv.on ? pv.preview.notes : notes).filter((n) => n.kind === 'inbox' && !isTodoNote(n.path)).length
  const todoToday = useTodayCount()
  /** 「最近删掉的」有几篇（图标栏底部那一格的数字，task-iq2ow）：库里的文件变了就重数 */
  const trashCount = useTrashCount(useVaultFiles().files)
  /**
   * ⌘W、菜单「文件 › 关闭」（CN-98 方向 A「关这一格」）：当前栏有标签就关当前标签，没有标签就收起这一格。
   * 中间、左栏：关中间的当前标签（左栏只是导航）；右栏网页：关当前网页标签，最后一个关掉网页这格收起；
   * 历史、大纲、右栏下格（AI 那一格：AI 或读 PDF 的笔记）：收起这一格。每次都在底栏说一句，带「撤回」。B 的设置弹窗开着时关它
   */
  const closeHereRef = useRef<() => void>(() => undefined)
  closeHereRef.current = () => {
    if (settingsPage && !settingsTab) return setSettingsPage(null)
    // 右边的一组（或浮窗）是当前栏：网页关当前网页标签；别的收起这个标签，底栏能撤回（放回原处）
    const g = Dk.findGroup(dockShown, livePane)
    if (g) {
      const v = g.group.active
      if (v === 'web') return webClose.current?.()
      const before = dockNow.current
      closeView(v)
      return noticeClosed(tNow('收起了「{name}」', { name: tNow(Dk.VIEW_NAME[v]) }), () => (setDock(before), setPane(g.group.id)))
    }
    if (settingsTab && settingsFront) {
      setSettingsPage(null)
      return setNotice(tNow('关掉了「设置」'))
    }
    if (active) closeByUser(active)
  }
  /** 右栏网页：关当前网页标签（WebPanel 交进来） */
  const webClose = useRef<(() => void) | null>(null)
  /** 最后一个网页标签关掉、网页收起之前的布局：撤回时照原样放回 */
  const webShut = useRef<Dk.Dock | null>(null)

  /** 标题栏最右的按钮、⌥⌘\：右边开着几栏、浮窗就全收起；收着时照原样开回来；什么都没开过就开上次那一样（没有就开大纲） */
  const toggleRightBar = () => {
    const d = dockNow.current
    if (d.hidden || Dk.hasSide(d) || d.floats.length) return setDock(Dk.hideAll(d))
    openView(lastRight.current)
  }
  toggleRightRef.current = toggleRightBar
  const rightOpen = Dk.hasSide(dockShown)
  /** 当前栏那一组收起了：回中间 */
  const livePane: Pane = pane === 'left' && sidebarHidden ? 'center' : pane !== 'left' && pane !== 'center' && !Dk.findGroup(dockShown, pane) ? 'center' : pane
  // 两条图标栏，加上 B 的缝：各栏之间一道 6，中间在最右时它和右图标栏之间也一道 6（shell/Dock.tsx 的 gridTracks），
  // 左栏收起时最左一栏左边也有一道 6（左栏开着时那道缝算在左栏宽里）。不算进去中间就少 6，变成 414
  const sideCols = Dk.sideCols(dockShown)
  const onlyCenter = dockShown.cols.length === 1
  const gaps = frame === 'b' ? 6 * (dockShown.cols.length - 1) + (onlyCenter ? 6 : 0) + (sidebarHidden ? 6 : 0) : 0
  const chromeW = 2 * (frame === 'a' ? 48 : 44) + gaps
  const colsW = sideCols.reduce((a, c) => a + c.w, 0)
  const fit = fitPanels(winW, chromeW, sidebarHidden ? 0 : (sideW ?? SIDE_DEFAULT[frame]), colsW, Math.min(colsW, RIGHT_MIN * sideCols.length))
  const colWidths = Dk.fitCols(dockShown, fit.right)
  const centerIdx = dockShown.cols.findIndex(Dk.isCenter)
  /** 挪过布局：每次打开软件第一次挪时底栏说一句，带「恢复默认」 */
  const dockSaid = useRef(false)
  /** 恢复默认：右栏一栏，开着的几样叠成一组，浮窗停回来 */
  const resetDock = () => {
    const next = Dk.resetDock(dockNow.current)
    setDock(next)
    const names = Dk.openViews(next).map((v) => tNow(Dk.VIEW_NAME[v]))
    setNotice(names.length > 1 ? tNow('回到默认：右栏一栏，{names}是{n}个标签', { names: list(names), n: '零一两三四五'[names.length] ?? names.length }) : tNow('回到默认：右栏一栏')) // 不翻：中文的几个（英文那句不用 {n}）
  }
  const onDock = (next: Dk.Dock, op: 'layout' | 'view') => {
    setDock(next)
    if (op !== 'layout' || dockSaid.current) return
    dockSaid.current = true
    const text = tNow('布局记住了：下次打开还是这样')
    setNotice(text)
    setNoticeUndo(null)
    setNoticeAct({ text, label: tNow('恢复默认'), icon: 'discard', run: resetDock })
  }
  /** 第一次有两个以上标签时的小卡：关过、拖过就不再出 */
  const [dockHint, setDockHint] = useState(() => {
    try {
      return localStorage.getItem('cn.dockHint') !== '1'
    } catch {
      return false
    }
  })
  const hintDone = () => {
    if (!dockHint) return
    setDockHint(false)
    try {
      localStorage.setItem('cn.dockHint', '1')
    } catch {
      // 记不住下次再说一次
    }
  }
  const noOutline = !activeTab || !['note', 'pdf'].includes(activeTab.type)
  const noRelated = activeTab?.type !== 'note'
  // 活动栏（左栏按维度组织）：上面「文件」按位置、「最近」按时间；分隔线下面是摘出来的文件夹：默认整套顶级分类，
  // 按「收件箱 | 读进来的 | 自己写的 | 自己摘的」分段（方案 v2 分类与入口方向 A、分类方案 3），单色符号，能右键、能拖着排；再下面梦游
  const barItem = (id: SideView, label: string, icon: BarItem['icon'], extra: Partial<BarItem> = {}): BarItem => ({ id, label, icon, on: !sidebarHidden && shownView === id, onClick: () => toggleLeft(id), ...extra })
  const viewItems: BarItem[] = [
    barItem('files', t('文件'), 'files', { key: keyFor('left-files') ?? undefined }),
    // 「文件」下面一格「待办」（task-pd1d1）：库里所有笔记的「- [ ]」，数字是今天（含过期）没做的
    // 窗口矮时它和「书桌」都不收，收进「⋯」的是末尾的分类（2026-11-22 用户看图定「用旧做法」，task-2okp6）
    // 点它：左栏是待办列表，中间开「待办」首页（task-kzr3n，和分类格开分类首页同一个规矩）；亮着的再点一下收起左栏，标签还在
    barItem('todo', t('待办'), 'checklist', { badge: todoToday, tid: 'todo', onClick: () => (!sidebarHidden && shownView === 'todo' ? setSidebarHidden(true) : (openLeft('todo'), openTodoHome())) }),
    // 「日历」格（画布今日 v2 原型，task-kzr3n；用户「日历做到左边」）：左栏小月历和系统日历，中间整页日历；窗口矮时分类都收完了才收它
    barItem('calendar', t('日历'), 'calendar', { fold: true, onClick: () => (!sidebarHidden && shownView === 'calendar' ? setSidebarHidden(true) : (openLeft('calendar'), openCalendar())) }),
    barItem('recent', t('最近'), 'clockface', { key: keyFor('left-recent') ?? undefined }),
    // 书桌（task-kbnc0 方向 B）：存好的一整套
    barItem('desks', t('书桌'), 'layout', { tip: t('书桌：存好的一整套（笔记、网页、读到哪）'), key: keyFor('left-desks') ?? undefined }),
  ]
  const presets = presetsOn(leftCfg)
  const trashOn = !sidebarHidden && shownView === 'trash'
  const dirItem = (f: string): BarItem =>
    barItem(`dir:${f}`, viewName(`dir:${f}`), 'folder', {
      glyph: <FolderGlyph folder={f} mono size={0} />,
      ...(f === INBOX_DIR ? { badge: inboxCount, warn: inboxCount > INBOX_WARN, tid: 'inbox' } : {}),
      // 点一格：左栏是它那一枝，中间开它的首页；亮着的再点一下收起左栏
      onClick: () => (!sidebarHidden && shownView === `dir:${f}` ? setSidebarHidden(true) : (openLeft(`dir:${f}`), openFolder(f))),
      onContextMenu: (e) => {
        const el = e.currentTarget
        // 「换图标和颜色…」排最前（task-wniqx：放上去的几格默认都是文件夹图标，先换图标才分得清）；分类那几格最后一项去设置里关掉预设
        void menuAt(e, [
          { label: tNow('换图标和颜色…'), run: () => setBarLook({ folder: f, el }) },
          { label: tNow('从左边拿下'), run: () => takeOffLeft(f) },
          { label: tNow('在「文件」里看位置'), run: () => showInFiles(f) },
          '-',
          // 只在这一段里挪（moveLeft）：段里第一个没有上移、最后一个没有下移
          { label: tNow('上移'), enabled: moveLeft(leftCfg, f, -1) !== leftCfg, run: () => updateLeft((c) => moveLeft(c, f, -1)) },
          { label: tNow('下移'), enabled: moveLeft(leftCfg, f, 1) !== leftCfg, run: () => updateLeft((c) => moveLeft(c, f, 1)) },
          ...(presets && CATEGORY_NAMES.includes(f) ? (['-', { label: tNow('不想要预设分类？去设置里关掉…'), run: () => openSettingsAt('leftPresets') }] as const) : []),
        ])
      },
      drag: {
        key: f,
        onDrop: (from, before) => {
          const next = dropLeft(leftCfg, from, before)
          if (next === leftCfg || next.left.join('\n') === leftCfg.left.join('\n')) return
          void updateLeft((c) => dropLeft(c, from, before))
          const seg = groupLeft(next.left, presets).find((g) => g.includes(from))!
          setNotice(tNow('「{name}」挪到了第{n}格', { name: from.split('/').pop(), n: seg.indexOf(from) + 1 }))
          setNoticeUndo(null)
        },
      },
      fold: true,
    })
  const leftGroups = groupLeft(leftCfg.left, presets)
  const dirGroups: BarItem[][] = leftGroups.map((g) => g.map(dirItem))
  // 从树里拖文件夹到图标栏（task-wniqx）：落点在自己放上去的那一段（不是分类的几格）；那一段还空着时线画在最后一格分类下面
  const ownCells = leftCfg.left.filter((f) => (presets ? !CATEGORY_NAMES.includes(f) : f !== INBOX_DIR))
  const lastDir = leftGroups.flat().at(-1) ?? null
  const barAccept = {
    type: DRAG_DIR,
    ok: () => {
      const f = draggedFolder()
      return !!f && !leftConfig().left.includes(f)
    },
    cells: ownCells.map((f) => `dir:${f}`),
    after: lastDir && `dir:${lastDir}`,
    onDrop: (before: string | null) => {
      const f = draggedFolder()
      if (f) putOnLeft(f, before && before.slice(4))
    },
  }
  const dreamItems: BarItem[] = [barItem('dream', t('梦游报告'), 'wand', { dot: pendingOf(dream.report) > 0, key: keyFor('dream-report') ?? undefined })]
  // 「笔记」一直在最上面（右图标栏方向 A「原地变淡」）：读 PDF / HTML 时开关笔记标签（工作区方向 A：独立的标签，在哪由布局记着）；
  // 别的页变淡，点了说为什么；换页面五格一点都不挪。AI 只有右下角那一个入口（CN-22 方向 A）
  const notesOn = vis('note')
  const readingItems: BarItem[] = [
    {
      id: 'notes',
      label: notesOk ? '笔记' : '笔记（打开 PDF、或右栏开着配好对的网站时才有笔记）',
      icon: 'note' as const,
      dim: !notesOk,
      why: '打开 PDF、或右栏开着配好对的网站时才有笔记',
      on: notesOn,
      dot: notesOk && !!reading?.fresh && !notesOn,
      onClick: () => toggleView('note'),
    },
  ]
  const rightItems: BarItem[] = [
    { id: 'outline', label: noOutline ? t('大纲（这一页没有标题，没有大纲）') : t('大纲'), icon: 'list-tree' as const, dim: noOutline, why: t('这一页没有标题，没有大纲'), on: vis('outline'), onClick: () => toggleView('outline'), key: keyFor('outline') ?? undefined },
    // 「相关」在大纲下面一格（task-h7oy8，设计页 44 定 2）：默认不开；梦游给这篇连了新的、还没在相关栏里看过时右上一个小点
    { id: 'related', label: noRelated ? t('相关（这一页不是笔记）') : t('相关'), icon: 'references' as const, dim: noRelated, why: t('这一页不是笔记'), on: vis('related'), dot: relatedDot && !vis('related'), onClick: () => toggleView('related'), key: keyFor('related') ?? undefined },
    { id: 'web', label: t('网页'), icon: 'globe' as const, on: vis('web') && !pluginEntries.some((e) => e.on), onClick: () => toggleView('web'), key: keyFor('open-web') ?? undefined },
    ...pluginEntries,
    {
      id: 'record',
      label: record ? t('记录：{name}', { name: titleOf(record.path) }) : t('记录（在数据库里点一条，在这里打开）'),
      icon: 'database' as const,
      dim: !record,
      why: t('在数据库里点一条，在这里打开'),
      on: vis('record'),
      onClick: () => toggleView('record'),
    },
    {
      id: 'auto',
      label: autoTitle ? t('自动化') : t('自动化（在数据库块头点「自动化」，在这里打开）'),
      icon: 'symbol-event' as const,
      dim: !autoTitle,
      why: t('在数据库块头点「自动化」，在这里打开'),
      on: vis('auto'),
      onClick: () => toggleView('auto'),
    },
    { id: 'history', label: t('历史'), icon: 'history' as const, on: vis('history'), onClick: () => toggleView('history'), key: keyFor('history') ?? undefined },
  ]
  // AI 的入口一直在（D 组方向 A）：B 是右图标栏最下面的圆钮（窗口右下角），A 是底栏最右一项；画正在用的那家的标志（CN-127），AI 开着时多一圈强调色
  /** 占满时顶上那条提示写的名字：中间写那一篇（那一格前面的标签），右边一组写前面那个标签 */
  const maxGroup = maxNow?.kind === 'group' ? Dk.findGroup(dockShown, maxNow.id)?.group : null
  const maxName = !maxNow ? '' : maxGroup ? (maxGroup.active === 'record' && record ? titleOf(record.path) : maxGroup.active === 'aicol' && aiColTitle ? aiColTitle : maxGroup.active === 'auto' && autoTitle ? autoTitle : tNow(Dk.VIEW_NAME[maxGroup.active])) : settingsTab && settingsFront ? tNow('设置') : activeTab ? tabName(activeTab) : tNow('中间这栏')
  const aiCorner =
    frame === 'a' ? (
      <button className={'bi ai-corner' + (aiShown ? ' on' : '')} aria-label={aiShown ? t('收起 AI') : t('打开 AI')} aria-pressed={aiShown} data-tip="AI" data-key={keyFor('ask-ai') ?? undefined} data-side="above-left" onClick={toggleAi}>
        <EngineLogo id={chatEngine.id} size={14} />
        {chatEngine.label}
      </button>
    ) : (
      <button className={'ai-fab' + (aiShown ? ' on' : '')} aria-label={aiShown ? t('收起 AI') : t('打开 AI')} aria-pressed={aiShown} data-tip="AI" data-key={keyFor('ask-ai') ?? undefined} data-side="left" onClick={toggleAi}>
        <EngineLogo id={chatEngine.id} size={18} />
      </button>
    )

  return (
    <div
      className={
        'win frame-' + frame +
        (sidebarHidden ? ' side-hidden' : '') +
        (rightOpen ? ' with-right' : '') +
        (vis('web') ? ' web-open' : '') +
        (pv.on ? ' previewing' : '') +
        (maxNow ? ' maxed' : '')
      }
      data-pane={livePane}
      data-max={maxNow ? (maxNow.kind === 'center' ? `center-${maxNow.pane}` : maxNow.float ? 'float' : 'group') : undefined}
      style={{ gridTemplateColumns: gridTracks(dockShown, frame, colWidths), ...(maxNow ? { '--max-col': maxColumns(dockShown, !sidebarHidden) } : {}), ...(!sidebarHidden && (sideW || fit.side !== SIDE_DEFAULT[frame]) ? { '--side-w': `${fit.side}px` } : {}) } as React.CSSProperties}
    >
      {!sidebarHidden && <SideSash frame={frame} rightW={fit.right + chromeW - 2 * (frame === 'a' ? 48 : 44)} width={sideW} onWidth={setSideW} />}
      <DockFrame
        stored={dock}
        shown={dockShown}
        frame={frame}
        pane={livePane}
        widths={colWidths}
        aiLogo={<EngineLogo id={chatEngine.id} size={15} />}
        subs={webNotePath ? { note: `《${titleOf(webNotePath)}》· 来自这个网页` } : undefined}
        names={{ ...(record ? { record: titleOf(record.path) } : {}), ...(aiColTitle ? { aicol: aiColTitle } : {}), ...(autoTitle ? { auto: autoTitle } : {}) }}
        tools={{ record: <RecordTools /> }}
        onDock={onDock}
        onCloseView={(v) => {
          if (v === 'note' || v === 'ai' || v === 'outline' || v === 'related' || v === 'history' || v === 'web' || v === 'record') lastRight.current = v
          closeView(v)
          if (v === 'auto') closeAuto()
        }}
        onPane={setPane}
        onReset={resetDock}
        hint={dockHint}
        onHintDone={hintDone}
        max={maxNow?.kind === 'group' ? maxNow.id : null}
        onMax={(id) => toggleMax({ kind: 'group', id })}
      />
      {maxNow && <MaxHint name={maxName} onRestore={() => setMax(null)} />}
      <Tooltips />
      <WhereHost />
      <PaneMark pane={livePane} />
      <TitleBar
        leftOpen={!sidebarHidden}
        rightOpen={rightOpen}
        canBack={nav.current.i > 0 || (!!away?.exact && away.navAt >= 0)}
        canForward={nav.current.i < nav.current.list.length - 1}
        location={frame === 'b' && activeTab ? withParent(locationOf(activeTab), crumbParent).join(' / ') : null}
        vaultName={vault.name}
        onToggleLeft={() => setSidebarHidden((h) => !h)}
        onToggleRight={toggleRightBar}
        onBack={() => navTo(-1)}
        onForward={() => navTo(1)}
        onHome={openHome}
        onSearch={() => (setQuickOpen(false), setPaletteOpen(true))}
      />
      {/* 文档里一行待办点「看详情」弹的那张小卡（task-kzr3n，todo/doc-dates.ts） */}
      <TodoPop owner={DOC_OWNER} />
      <CardsHost onToast={cardsToast} onNotice={setNotice} onOpenPdfAt={(pdf, page) => openPdfAt(pdf, page)} />
      <MergeHost />
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
      {/* 和网页配成一对、对着看的菜单、存成书桌（task-kbnc0） */}
      <ReadAlongLayer />
      <DeskDialogHost />
      {/* 存成命令、⌘K 从头写一条 AI 命令、改自己的（commands/SaveCmd.tsx，task-9womr）；从头写时拿开着的那一篇举例 */}
      <CmdEditorHost onNotice={setNotice} here={activeTab?.type === 'note' ? activeTab.path : null} />
      {/* 「存成快捷回复」那张小卡（你发的那句悬停、右键，task-eavzx） */}
      <SaveReplyHost />
      <ActivityBar
        side="left"
        label={t('左栏')}
        groups={[viewItems, ...dirGroups, dreamItems]}
        accept={barAccept}
        bottom={
          <>
            {/* 「最近删掉的」（task-iq2ow，用户看图说「放到左栏的左下方」）：库、设置上面一格，算底部固定的，窗口矮时不收进「⋯」 */}
            <button
              className={'ab' + (trashOn ? ' on' : '')}
              aria-label={t('最近删掉的')}
              aria-pressed={trashOn}
              data-tip={t('最近删掉的')}
              data-key={keyFor('left-trash') ?? undefined}
              data-side="right"
              data-testid="ab-trash"
              onClick={() => toggleLeft('trash')}
            >
              <Codicon name="trash" size={0} />
              <span className="sr">{t('最近删掉的')}</span>
              {!!trashCount && (
                <span className="badge num" data-testid="trash-count">
                  {trashCount}
                </span>
              )}
            </button>
            <button className="ab" aria-label={t('库')} data-tip={t('库：{name}', { name: vault.name })} data-key={t('换库、在访达里显示')} data-side="right" onClick={(e) => setMenu({ kind: 'vault', el: e.currentTarget })}>
              <Codicon name="library" size={0} />
            </button>
            <button className="ab" aria-label={t('设置和外观')} data-tip={t('设置和外观')} data-key={keyFor('settings') ?? undefined} data-side="right" onClick={(e) => setMenu({ kind: 'gear', el: e.currentTarget })}>
              <Codicon name="settings-gear" size={0} />
            </button>
          </>
        }
      />
      {menu?.kind === 'vault' && (
        <Popover anchor={menu.el} label={t('库')} onClose={() => setMenu(null)}>
          <div className="mh">{t('库')}</div>
          <MenuItem icon="check" label={vault.name} right={vault.path.replace(/^\/Users\/[^/]+/, '~')} onClick={() => (setMenu(null), openSettings('vault'))} />
          <div className="ms" />
          <MenuItem icon="folder-opened" label={t('换一个库…')} onClick={() => (setMenu(null), void switchVault())} />
          <MenuItem icon="cloud-download" label={t('导入旧笔记…')} onClick={() => (setMenu(null), openImport())} />
        </Popover>
      )}
      {menu?.kind === 'gear' && (
        <Popover anchor={menu.el} label={t('设置和外观')} onClose={() => setMenu(null)}>
          <MenuItem icon="settings-gear" label={t('设置')} right={keyFor('settings') ?? undefined} onClick={() => (setMenu(null), openSettings())} />
          <MenuItem icon="paintcan" label={t('外观和主题')} onClick={() => (setMenu(null), openSettings('look'))} />
          <MenuItem icon="record-keys" label={t('快捷键')} onClick={() => (setMenu(null), openSettings('keys'))} />
          <MenuItem icon="extensions" label={t('插件')} onClick={() => (setMenu(null), openSettings('plugins'))} />
          <div className="ms" />
          <MenuItem icon="arrow-circle-up" label={t('检查更新')} onClick={() => (setMenu(null), openSettingsAt('checkNow'), void window.cn.checkUpdate())} />
        </Popover>
      )}
      {trashAsk && <TrashDialog ask={trashAsk} />}
      {barLook && <LookPicker folder={barLook.folder} anchor={barLook.el} onClose={() => setBarLook(null)} />}
      {/* 每一块各自兜底（task-pyb39）：一块渲染出错只那一块换成出错卡，别的照常 */}
      <PanelGuard area="left" label="左栏" shape="side" hidden={sidebarHidden}>
      {shownView === 'dream' ? (
        !sidebarHidden && (
        <DreamPanel
          report={dream.report}
          running={dream.running}
          onReport={dream.setReport}
          onClose={() => setSidebarHidden(true)}
          onOpenRoles={() => openSettingsAt('dRoles')}
          onPreviewImages={(id) => open((t) => t.type === 'oldimages' && t.item === id, () => ({ id: newId(), type: 'oldimages', item: id }))}
          onNotice={setNotice}
          acting={dreamBusy}
          pv={pv}
          settings={settings.dream}
          onOpenGrowth={openGrowth}
          onOpenNote={(p) => openNote(p)}
        />
        )
      ) : shownView === 'desks' ? (
        !sidebarHidden && <DeskPanel />
      ) : shownView === 'todo' ? (
        !sidebarHidden && <TodoPanel />
      ) : shownView === 'calendar' ? (
        !sidebarHidden && <CalendarSide />
      ) : shownView === 'trash' ? (
        !sidebarHidden && <TrashPanel version={notes} onRestore={restoreFromTrash} onPick={showTrashItem} onTrashOrphans={trashOrphans} />
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
          onAskAi={() => openAi()}
          onShowInFiles={showInFiles}
          pins={pins}
          archiveDays={settings.archiveDays}
          onTidy={() => runAi('/整理收件箱')} // 不翻：交给 AI 的命令名
          onNewNote={() => void newNote()}
          onNewBoard={() => void newBoard()}
          onOpenFile={openFile}
          onOpenWeb={(url) => openInWeb(url)}
          onRename={(p, n) => void renameFromSidebar(p, n)}
          onOpenFolder={(f) => openFolder(f)}
        />
      )}
      </PanelGuard>

      {/* 中间那一栏：工作区里排第几栏就放在 .win 的第几列（不挪 DOM，里面的网页、HTML 不重新加载） */}
      <main className={'center' + (pv.on ? ' previewing' : '') + (centerNarrow ? ' narrow' : '') + (centerCompact ? ' compact' : '') + (centerTiny ? ' tiny' : '') + (tabsTight ? ' tight' : '') + (centerIdx > 0 ? ' not-first' : '') + (centerOff ? ' folded' : '') + (maxNow?.kind === 'center' ? ` maxed max-p${maxNow.pane}` : '') + (split ? ` split ${split.dir}` : '')} ref={centerRef} style={{ gridColumn: 3 + 2 * centerIdx, ...(split ? { '--split': `${split.ratio * 100}%` } : {}) } as React.CSSProperties} {...(centerOff ? { inert: true, 'aria-hidden': true } : {})}>
        {/* B：分着时两格各是一块岛（垫在最底下），中间的缝露出背景 */}
        {split && frame === 'b' && ([0, 1] as const).map((p) => <div key={`isle${p}`} className={`cisle p${p}`} aria-hidden />)}
        {([0, 1] as const).filter((p) => p === 0 || split).map((p) => (
        <div key={p} className={'tabs' + (split ? ` p${p}` : '') + (split && p !== focusPane ? ' idle' : '')} data-strip={p}>
          <div className="tstrip">
          {/* 标签后面的空处按住拖：整个中间这一栏和右边几栏换位置（工作区方向 A，startCenterColDrag 只认按在空处的） */}
          <div className={'tlist' + (p === 0 && tabFade.left ? ' more-l' : '') + (p === 0 && tabFade.right ? ' more-r' : '')} role="tablist" ref={p === 0 ? tlistRef : undefined} data-testid={p === 0 ? 'tab-list' : 'tab-list-2'} onPointerDown={startCenterColDrag} onDoubleClick={(e) => e.target === e.currentTarget && toggleMax({ kind: 'center', pane: p })}>
            {tabs.filter((t) => Sp.paneOf(split, t.id) === p).map((t) => {
              const on = t.id === (p === focusPane ? shown : otherShown)
              const name = tabName(t)
              return (
                <div
                  key={t.id}
                  className={'tab' + (on ? ' on' : '') + (t.type === 'diff' && !t.pinned ? ' preview' : '') + (tabDrop === t.id ? ' drop' : '')}
                  {...(t.type === 'folder' ? folderTabDrop(t.id, t.folder) : {})}
                  role="tab"
                  aria-selected={on}
                  data-testid={on ? (p === focusPane ? 'tab-on' : 'tab-on-other') : undefined}
                  data-tab={t.id}
                  data-path={'path' in t ? t.path : undefined}
                  // 按住标签拖：换顺序、拖到另一格、拖到中间内容的边上分出一格（中间栏分屏）；按在 × 上、改名框里不算
                  onPointerDown={(e) => renaming !== t.id && !(e.target as HTMLElement).closest('.x') && tabDrag.start(e, { id: t.id, icon: tabIcon(t), name })}
                  onDoubleClick={() => (canRenameTab(t) ? setRenaming(t.id) : t.type === 'diff' && setTabs((x) => x.map((y) => (y.id === t.id ? { ...y, pinned: true } : y))))}
                  onContextMenu={(e) => renaming !== t.id && void menuAt(e, tabMenu(t))}
                >
                  {renaming === t.id ? (
                    <span className="tl">
                      {tabIcon(t)}
                      <input
                        className="tab-rename"
                        aria-label={t.type === 'folder' ? tNow('文件夹名字') : tNow('笔记名字')}
                        defaultValue={name}
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => void renameTab(t.id, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (composing(e)) return
                          // 拦住这个键，不然焦点回到正文后回车会打进正文
                          if (e.key === 'Enter' || e.key === 'Escape') e.preventDefault()
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') (e.currentTarget.value = name), e.currentTarget.blur()
                        }}
                      />
                    </span>
                  ) : (
                    <button className="tl" onClick={() => (setTabs((x) => x, t.id), setSettingsFront(false))} data-tip={canRenameTab(t) ? tNow('双击改名') : t.type === 'diff' && !t.pinned ? tNow('预览：再开一个对比就换掉它，双击固定') : undefined} data-side="below">
                      {tabIcon(t)}
                      <span className="truncate">{name}</span>
                    </button>
                  )}
                  {/* 只剩一个首页时不能关（标签关完就是首页）：不画 × */}
                  {!(tabs.length === 1 && t.type === 'home') && (
                    <button className="x" aria-label={tNow('关闭标签')} onClick={() => closeByUser(t.id)}>
                      <Codicon name="close" size={14} />
                    </button>
                  )}
                </div>
              )
            })}
            {settingsTab && p === focusPane && (
              <div className={'tab' + (settingsFront ? ' on' : '')} role="tab" aria-selected={settingsFront}>
                <button className="tl" onClick={() => setSettingsFront(true)}>
                  <Codicon name="settings-gear" size={15} />
                  <span className="truncate">{t('设置')}</span>
                </button>
                <button className="x" aria-label={t('关闭标签')} onClick={() => setSettingsPage(null)}>
                  <Codicon name="close" size={14} />
                </button>
              </div>
            )}
          </div>
          {/* 两端还藏着标签：淡出加一个小箭头，点一下挪一整个标签（标签多了方向 A） */}
          {p === 0 && tabFade.left && (
            <button className="tedge l" aria-label={t('往左看标签')} data-testid="tab-edge-left" onClick={() => snapTabs(-1)}>
              <Codicon name="chevron-left" size={13} />
            </button>
          )}
          {p === 0 && tabFade.right && (
            <button className="tedge r" aria-label={t('往右看标签')} data-testid="tab-edge-right" onClick={() => snapTabs(1)}>
              <Codicon name="chevron-right" size={13} />
            </button>
          )}
          </div>
          {p === 0 && (tabsOver || tabsMenu) && <button className={'tmore' + (tabsMenu ? ' open' : '')} aria-label={t('开着的标签')} aria-expanded={!!tabsMenu} data-tip={t('开着的标签')} data-side="below" data-testid="tab-more" onClick={(e) => setTabsMenu(tabsMenu ? null : e.currentTarget)}>
            <Codicon name="list-flat" size={13} />
            <span className="num">{`${tabs.length + (settingsTab ? 1 : 0)}`}</span>
            <Codicon name="chevron-down" size={11} />
          </button>}
          {p === 0 && tabsMenu && (
            <Popover anchor={tabsMenu} label={t('开着的标签')} className="pop12 tabs-pop" align="end" onClose={() => setTabsMenu(null)}>
              <div className="mh">{t('开着的{n}个标签', { n: tabs.length + (settingsTab ? 1 : 0) })}</div>
              <div className="tl-rows" role="menu" aria-label={t('开着的标签')}>
                {tabs.map((t) => (
                  <div
                    key={t.id}
                    className={'tl-row' + (t.id === shown ? ' on' : '')}
                    role="menuitemradio"
                    aria-checked={t.id === shown}
                    onClick={() => (setTabs((x) => x, t.id), setSettingsFront(false), setTabsMenu(null))}
                  >
                    <span className="ck">{t.id === shown && <Codicon name="check" size={12} />}</span>
                    {tabIcon(t)}
                    <span className="truncate">{tabName(t)}</span>
                    {!(tabs.length === 1 && t.type === 'home') && (
                      <button className="x" aria-label={tNow('关闭「{name}」', { name: tabName(t) })} onClick={(e) => (e.stopPropagation(), closeByUser(t.id))}>
                        <Codicon name="close" size={11} />
                      </button>
                    )}
                  </div>
                ))}
                {settingsTab && (
                  <div className={'tl-row' + (settingsFront ? ' on' : '')} role="menuitemradio" aria-checked={settingsFront} onClick={() => (setSettingsFront(true), setTabsMenu(null))}>
                    <span className="ck">{settingsFront && <Codicon name="check" size={12} />}</span>
                    <Codicon name="settings-gear" size={13} />
                    <span className="truncate">{t('设置')}</span>
                    <button className="x" aria-label={t('关闭「设置」')} onClick={(e) => (e.stopPropagation(), setSettingsPage(null))}>
                      <Codicon name="close" size={11} />
                    </button>
                  </div>
                )}
              </div>
            </Popover>
          )}
          {p === 0 ? <div className="acts" id="tab-acts" data-testid="tab-acts" ref={setActsEl} /> : <div className="acts" data-testid="tab-acts-2" ref={setActs2El} />}
          <MaxButton on={maxNow?.kind === 'center'} name={!split ? tNow('中间这栏') : split.dir === 'row' ? (p === 0 ? tNow('左边这格') : tNow('右边这格')) : p === 0 ? tNow('上面这格') : tNow('下面这格')} tid={`max-center-${p}`} size={16} onClick={() => toggleMax({ kind: 'center', pane: p })} />
        </div>
        ))}
        {split && <SplitSash dir={split.dir} ratio={split.ratio} center={() => centerRef.current} onRatio={(r) => r !== splitNow.current?.ratio && setSplit({ ...splitNow.current!, ratio: r })} />}

        {frame === 'a' && activeTab && !(settingsTab && settingsFront) && (
          <Crumbs className={split ? `p${focusPane}` : undefined} parts={withParent(locationOf(activeTab), crumbParent)} parentAt={crumbParent ? locationOf(activeTab).length - 1 : undefined} vaultName={vault.name} onFolder={(f) => openFolder(f)} onParent={() => crumbParent && openNote(crumbParent)} onRename={activeTab.type === 'note' ? () => setRenaming(activeTab.id) : undefined} />
        )}
        {frame === 'a' && otherTab && <Crumbs className={`p${focusPane === 0 ? 1 : 0}`} parts={locationOf(otherTab)} vaultName={vault.name} onFolder={(f) => openFolder(f)} onParent={() => undefined} />}

        {settingsTab && settingsFront && settingsPage && (
          <div className={'cslot' + (split ? ` p${focusPane}` : '')} data-pane={focusPane}>
          <ActsSlot.Provider value={focusPane === 1 ? acts2El : actsEl}>
          <PanelGuard area="settings" label="设置" shape="pane">
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
            onOpenDream={() => (!settingsTab && setSettingsPage(null), openLeft('dream'))}
            focus={settingsFocus}
            appNotice={undoable || actable ? null : notice}
            onGoRow={openSettingsAt}
            onGoPlace={goPlace}
          />
          </PanelGuard>
          </ActsSlot.Provider>
          </div>
        )}

        {tabs.map((t) => {
          const p = Sp.paneOf(split, t.id)
          return (
          // 一个标签一格位置（中间栏分屏）：分着时 .p0 / .p1 摆到那一格，挪格只换样式、不重新挂（网页、PDF 不重新载入）
          <div key={t.id} className={'cslot' + (split ? ` p${p}` : '')} data-pane={p} hidden={!seen(t.id)} onPointerDownCapture={split ? () => goPane(p) : undefined} onFocusCapture={split ? () => goPane(p) : undefined}>
          <ActsSlot.Provider value={p === 1 ? acts2El : actsEl}>
          <PaneFocus.Provider value={!split || p === focusPane}>
          <PanelGuard area={`tab:${t.type}`} label={`「${tabName(t)}」`} shape="pane" hidden={!seen(t.id)}>
          {t.type === 'note' ? (
            <NoteTab
              key={t.id}
              tabId={t.id}
              renaming={renaming === t.id}
              onMenu={(e, extra) => onFileMenu(e, t.path, { rename: () => setRenaming(t.id) }, extra)}
              onOpenOutline={() => openView('outline')}
              onWantRename={() => setRenaming(t.id)}
              path={t.path}
              active={seen(t.id)}
              fresh={!!t.fresh}
              notes={notes}
              rightOpen={rightOpen}
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
                // 数据库里的一条、AI 列建的那篇在自己的标签里改了：画着它所在文件夹的表跟着重读（自己存的不来「外面改了」的通知）
                window.dispatchEvent(new CustomEvent('cn-base-wrote', { detail: t.path.includes('/') ? t.path.slice(0, t.path.lastIndexOf('/')) : '' }))
              }}
              onNotice={setNotice}
              onOpenLink={openLink}
              view={t.view}
              compare={{ on: !!split && seen(t.id) && (() => {
                const o = tabs.find((x) => x.id === (t.id === shown || t.id === active ? otherShown : active))
                return o?.type === 'note' && o.path === t.path && o.id !== t.id
              })(), toggle: () => toggleCompare(t) }}
            />
          ) : t.type === 'pdf' ? (
            <PdfTab
              key={t.id}
              path={t.path}
              active={seen(t.id)}
              onAsk={() => openAi()}
              onShowNote={(id) => {
                openNotes()
                Reading.focusSection(t.path, id)
              }}
              onNotice={setNotice}
            />
          ) : t.type === 'webread' ? (
            <WebReadTab key={t.id} url={t.url} title={t.title} active={seen(t.id)} onBackToWeb={openInWeb} onOpenNote={(p) => openNote(p)} onNotice={setNotice} />
          ) : t.type === 'oldimages' ? (
            (() => {
              const it = dream.report?.items.find((x) => x.id === t.item)
              return it?.oldImages ? (
                <OldImagesTab
                  key={t.id}
                  item={it}
                  active={seen(t.id)}
                  busy={dreamBusy}
                  onTake={() => void dreamTake(it)}
                  onDrop={() => void dreamDrop(it)}
                />
              ) : (
                <section key={t.id} className="pane" hidden={!seen(t.id)}>
                  <p className="dv-empty">{tNow('这份梦游报告已经没有这一条了')}</p>
                </section>
              )
            })()
          ) : t.type === 'diff' ? (
            <CompareTab
              key={t.id}
              src={t.src}
              title={t.title}
              active={seen(t.id)}
              gitVersion={gitVersion}
              report={dream.report}
              onOpen={(p, line) => (openFile(p), line && /\.md$/i.test(p) && void goToLine(p, line))}
              onPreviewHtml={(p, dreamSide) => (dreamSide ? open((x) => x.type === 'html' && x.path === p && !!x.dream, () => ({ id: newId(), type: 'html', path: p, dream: true })) : openHtml(p))}
              openDiff={openDiff}
              onShowReport={() => openLeft('dream')}
              onNotice={setNotice}
            />
          ) : t.type === 'html' ? (
            <HtmlTab key={t.id} path={t.path} dream={!!t.dream} by={t.dream ? dream.report?.items.find((i) => i.files.includes(t.path))?.by : undefined} active={seen(t.id)} onAsk={() => openAi()} onNotice={setNotice} />
          ) : t.type === 'folder' ? (
            seen(t.id) && (
              <FolderHomeView
                key={t.id}
                folder={t.folder}
                fresh={!!t.fresh}
                notes={pv.on ? pv.preview.notes : notes}
                pv={pv}
                version={gitVersion}
                onOpen={(p) => (/\.pdf$/i.test(p) ? openPdf(p) : /\.html?$/i.test(p) ? openHtml(p) : openNote(p))}
                onOpenAt={(f, page) => openPdfAt(f, page)}
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
              active={seen(t.id)}
              restored={restoredWeb.has(t.id)}
              onUrl={(url, title) => setTabs((x) => x.map((y) => (y.id === t.id && y.type === 'web' && (y.url !== url || y.title !== title) ? { ...y, url, title } : y)))}
              onNotice={setNotice}
              onClose={() => closeByUser(t.id)}
              onPutBack={() => putWebBack(t)}
            />
          ) : t.type === 'home' ? (
            seen(t.id) && (
              <HomeView
                key={t.id}
                style={settings.appearance.homeStyle}
                winBg={homeWinBg(settings)}
                notes={notes}
                version={gitVersion}
                dream={dream.report}
                dreamRunning={dream.running}
                dreamSettings={settings.dream}
                editSeq={homeEditSeq}
                onOpenDream={() => (openLeft('dream'), openFirstDream(dream.report))}
                onDreamNow={dreamNow}
                onOpen={(p) => openNote(p)}
                onInbox={openInbox}
                onTidy={() => runAi('/整理收件箱')} // 不翻：交给 AI 的命令名
                onNewBoard={() => void newBoard()}
                onOpenWeb={() => openView('web')}
                onChooseFolder={() => void switchVault()}
                onOpenCategory={(name) => {
                  // 方向 C 的分类卡：开它的首页；左栏不在「文件」时换到它那一枝（和点活动栏那一格一样）
                  openFolder(name)
                  if (shownView !== 'files' && leftCfg.left.includes(name)) openLeft(`dir:${name}`)
                }}
                onNotice={setNotice}
              />
            )
          ) : t.type === 'recent' ? (
            seen(t.id) && (
              <RecentPage
                key={t.id}
                notes={pv.on ? pv.preview.notes : notes}
                pins={pins}
                archiveDays={settings.archiveDays}
                activePath={null}
                onOpen={(p) => openNote(pv.realPath(p))}
                onOpenFile={openFile}
                onOpenWeb={(url) => openInWeb(url)}
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
          ) : t.type === 'trash' ? (
            seen(t.id) && <TrashPage key={t.id} onRestore={restoreFromTrash} onTrashOrphans={trashOrphans} />
          ) : t.type === 'todo' ? (
            seen(t.id) && <TodoHome key={t.id} active={!settingsFront} />
          ) : t.type === 'calendar' ? (
            seen(t.id) && <CalendarPage key={t.id} active={!settingsFront} />
          ) : t.type === 'growth' ? (
            seen(t.id) && (
              <GrowthTab
                key={t.id}
                active={!settingsFront}
                onOpen={(p) => openNote(p)}
                onOpenReport={() => {
                  setGrowth({ side: 'report' })
                  openLeft('dream')
                }}
              />
            )
          ) : t.type === 'archive' ? (
            seen(t.id) && (
              <NoteIndex
                key={t.id}
                which="archive"
                notes={pv.on ? pv.preview.notes : notes}
                pins={pins}
                archiveDays={settings.archiveDays}
                onOpen={(p) => openNote(p)}
                onRename={(p, n) => void renameFromSidebar(p, n)}
                onOpenSettings={() => openSettingsAt('archive')}
              />
            )
          ) : seen(t.id) ? (
            <ListView
              key={t.id}
              title={t.type === 'inbox' ? INBOX : t.topic}
              hint={t.type === 'inbox' ? tNow('新东西先放这里，整理交给以后') : `${CLIPS} / ${t.topic}`}
              items={notes.filter((n) => (t.type === 'inbox' ? n.kind === 'inbox' : n.kind === 'clip' && n.topic === t.topic))}
              capture={t.type === 'inbox'}
              onOpen={(p) => openNote(p)}
              onCaptured={() => {
                refreshNotes()
                refreshGit()
              }}
              onNotice={setNotice}
            />
          ) : null}
          </PanelGuard>
          </PaneFocus.Provider>
          </ActsSlot.Provider>
          </div>
          )
        })}

        <PreviewOverlay pv={pv} />
        <ImportHost
          onOpenInbox={openInbox}
          onShowFiles={() => openLeft('files')}
          onDreamNow={() => {
            openLeft('dream')
            dreamNow()
          }}
          onNotice={setNotice}
        />
        <CaptureHost
          notes={notes}
          onNotice={setNotice}
          onPlaced={(p, hung) => {
            refreshNotes()
            refreshGit()
            // 挂到白板、笔记上的留在那一篇（卡、缩略图块点开才进导图）；进收件箱的直接打开
            if (!hung) openNote(p)
          }}
        />
        <VideoToast />
        {tabDrag.overlay}
      </main>

      {/* 右边五样的内容（工作区方向 A）：一直挂在 .win 下面，shell/Dock.tsx 量着它们那一组的身子摆上去（挪来挪去不重新挂，网页不重新加载） */}
      <div className="dview" data-view="ai" data-testid="dview-ai" hidden={!aiShown}>
        <PanelGuard area="ai" label="AI">
        <AiDock
          open={aiOpen}
          shown={aiShown}
          reading={readingPdf}
          onShowNotes={openNotes}
          onClose={() => closeView('ai')}
          chat={{
            tab: activeTab,
            mode: activeMode,
            doc: () => activeDoc.current,
            notes,
            webUrl: aiState.webUrl,
            webOpen: Dk.isOpen(dockShown, 'web'),
            context: (mentions) => contextOf(aiState, mentions),
            onOpen: (p) => openNote(p),
            onShowHistory: () => openView('history'),
            onShowDream: () => openLeft('dream'),
            // AI 命令「先给你看」：改好的样子在中间栏的对比标签里，收下、不要以后关掉它（task-9womr）
            onOpenDiff: openDiff,
            onCloseDiff: (id) =>
              setTabState((s) => {
                const i = s.tabs.findIndex((t) => t.type === 'diff' && t.src.kind === 'proposal' && t.src.id === id)
                if (i < 0) return s
                const tabs = s.tabs.filter((_t, j) => j !== i)
                return { tabs, active: Sp.afterClose(s.tabs.map((t) => t.id), splitNow.current, s.active, s.tabs[i]!.id) }
              }),
            autoRun: aiAuto,
            draft: aiDraft,
            onChanged: () => {
              refreshNotes()
              refreshGit()
            },
          }}
          onOpenHtml={openHtml}
          onNotice={setNotice}
        />
        </PanelGuard>
      </div>
      <div className="dview" data-view="note" data-testid="dview-note" hidden={!vis('note')}>
        <PanelGuard area="note" label="笔记">
        {webNotePath && rightWeb && Dk.isOpen(dockShown, 'note') && (
          <WebNotes key={webNotePath} path={webNotePath} url={rightWeb} hidden={!vis('note')} focus={webNoteFocus} onGo={(e) => openWebAt(e.url, e.quote)} />
        )}
        {readingPdf && !Reading.isWebSrc(readingPdf) && Dk.isOpen(dockShown, 'note') && (
          <NotesDock
            key={readingPdf}
            pdf={readingPdf}
            shown={vis('note')}
            onShowAi={openAi}
            onOpenNote={(p) => openNote(p)}
            onOpenLink={openLink}
            onOpenHtml={openHtml}
            onOpenWeb={openInWeb}
          />
        )}
        </PanelGuard>
      </div>
      <div className="dview" data-view="aicol" data-testid="dview-aicol" hidden={!vis('aicol')}>
        <PanelGuard area="aicol" label="AI 列">
          {Dk.isOpen(dockShown, 'aicol') && (
            <AiColPane
              onClose={() => {
                closeView('aicol')
                closeAiCol()
              }}
            />
          )}
        </PanelGuard>
      </div>
      <div className="dview" data-view="auto" data-testid="dview-auto" hidden={!vis('auto')}>
        <PanelGuard area="auto" label="自动化">
          {Dk.isOpen(dockShown, 'auto') && <AutoPane />}
        </PanelGuard>
      </div>
      <div className="dview" data-view="record" data-testid="dview-record" hidden={!vis('record')}>
        <PanelGuard area="record" label="记录">
          {Dk.isOpen(dockShown, 'record') && (
            <RecordPeek
              shown={vis('record')}
              onClose={() => closeView('record')}
              onFull={(p) => {
                // 整页打开：中间开这一篇，右栏的这个标签收起（同 Notion 侧边预览的「整页打开」）
                closeView('record')
                openNote(p)
              }}
            />
          )}
        </PanelGuard>
      </div>
      <div className="dview" data-view="outline" data-testid="dview-outline" hidden={!vis('outline')}>
        <PanelGuard area="outline" label="大纲">
        {Dk.isOpen(dockShown, 'outline') && <OutlineView tab={activeTab} doc={() => activeDoc.current} mode={activeTab?.type === 'note' ? activeMode : undefined} onClose={() => closeView('outline')} onPdfPage={(f, page) => openPdfAt(f, page)} />}
        </PanelGuard>
      </div>
      <div className="dview" data-view="related" data-testid="dview-related" hidden={!vis('related')}>
        <PanelGuard area="related" label="相关">
        {Dk.isOpen(dockShown, 'related') && (
          <RelatedView
            tab={activeTab}
            doc={() => activeDoc.current}
            version={notesVersion + dreamVersion}
            shown={vis('related')}
            onClose={() => closeView('related')}
            onImport={() => openImport()}
            onDreamSettings={() => openSettings('dream')}
            onSearchSettings={() => openSettingsAt('semantic')}
            onSeen={(p) => void window.cn.relatedSeen(p).then(() => activeNotePath.current === p && setRelatedDot(false))}
          />
        )}
        </PanelGuard>
      </div>
      <div className="dview" data-view="history" data-testid="dview-history" hidden={!vis('history')}>
        <PanelGuard area="history" label="历史">
        {historyOpen && <HistoryPanel version={gitVersion} changes={git?.changes ?? []} autoMinutes={git?.autoCommitMinutes ?? 0} onCommit={commit} onClose={() => closeView('history')} onOpenDiff={openDiff} onRestore={restoreFromHistory} onNotice={setNotice} />}
        </PanelGuard>
      </div>
      <div className="dview" data-view="web" data-testid="dview-web" hidden={!vis('web')}>
        <PanelGuard area="web" label="网页">
        <WebPanel
          hidden={!vis('web')}
          owner={active}
          openRequest={webOpen}
          onShow={() => openView('web')}
          onUrl={setRightWeb}
          full={webGroup ? { on: folded, toggle: () => toggleMax({ kind: 'group', id: webGroup }) } : null}
          chip={folded ? fullChip : null}
          onNotice={setNotice}
          onClose={() => {
            webShut.current = dockNow.current
            closeView('web')
          }}
          onOpenWide={(url, title) => {
            // 在中间开成一页：网页离开了右栏，占满跟着结束（task-05p2w：不然放回右栏时中间那篇跟着不见）
            showCenter()
            open((t) => t.type === 'web' && t.url === url, () => ({ id: newId(), type: 'web', url, title }))
          }}
          wideTabs={tabs.flatMap((t) => (t.type === 'web' ? [{ id: t.id, url: t.url, title: t.title }] : []))}
          onActivateWide={(id) => setTabs((x) => x, id)}
          onCloseWide={closeTab}
          onOpenNote={(p, noWeb) => openNote(p, false, noWeb)}
          onPluginSettings={() => openSettings('plugins')}
          closeActive={webClose}
          readRequest={readReq}
          deskApi={webDesk}
          pageNow={webNow}
          centerNote={activeNote}
          onWebChange={() => deskChanged(pairsNow.values())}
          onClosedTab={(c) => {
            const before = c.last ? webShut.current : null
            noticeClosed(c.last ? tNow('关掉了网页「{title}」，网页标签收起了', { title: c.title }) : tNow('关掉了网页「{title}」', { title: c.title }), () => {
              c.undo()
              if (before) setDock(before)
              else openView('web')
            })
          }}
        />
        </PanelGuard>
      </div>

      <ActivityBar side="right" label={t('右栏')} groups={[readingItems, rightItems]} bottom={frame === 'b' ? aiCorner : undefined} />

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
          onOpenDream={() => (!settingsTab && setSettingsPage(null), openLeft('dream'))}
          focus={settingsFocus}
          appNotice={undoable || actable ? null : notice}
          onGoRow={openSettingsAt}
          onGoPlace={goPlace}
        />
      )}


      <StatusBar
        frame={frame}
        vaultName={vault.name}
        git={git}
        jobs={[...(dream.running ? [{ id: 'dream', icon: 'wand' as const, ai: 'dream' as const, text: t('梦游在整理'), onClick: () => openLeft('dream') }] : []), ...askJobs.map((j) => ({ id: `ask-${j.id}`, icon: 'note' as const, ai: 'vision' as const, text: j.text }))]}
        previewing={pv.on}
        onCommit={commit}
        onSync={sync}
        onHistory={() => openView('history')}
        onOpen={(p) => openNote(p)}
        unsaved={unsaved}
        onRevealStash={(f) => void window.cn.revealStash(f)}
        vaultPath={vault.path}
        update={<UpdateBarItem st={update} onInstall={installUpdate} onOpenSettings={() => openSettingsAt('checkNow')} />}
        ai={frame === 'a' ? aiCorner : undefined}
        away={away && !away.quiet ? { name: away.name, onBack: backToBefore, onClose: quietAway } : null}
        tidy={
          tidy && {
            said: tidy.said,
            onClose: () => setTidy(null),
            onUndo: () => {
              setTidy(null)
              window.cn.tidyUndo(tidy).then(
                (back) => {
                  setNotice(back)
                  refreshNotes()
                  refreshGit()
                },
                (e) => setNotice(errText(e)),
              )
            },
          }
        }
        translate={frame === 'a' ? <TranslateItem /> : undefined}
        bell={frame === 'a' ? <BellItem /> : undefined}
        toast={
          notice && (
          <div className={'toast-cn' + (undoable || actable ? ' with-act' : '')} role="status" data-testid="toast" onMouseEnter={() => setNoticeHover(true)} onMouseLeave={() => setNoticeHover(false)}>
            {noticeIcon?.text === notice && <Codicon name={noticeIcon.icon} size={14} className={'tl-ic' + (noticeIcon.ok ? ' ok' : '')} />}
            <span data-tip={notice}>{notice}</span>
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
            {actable && noticeMore?.text === notice && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  noticeMore.run()
                  setNotice(null)
                  setNoticeMore(null)
                  setNoticeHover(false)
                }}
              >
                <Codicon name={noticeMore.icon} size={14} />
                {noticeMore.label}
              </button>
            )}
            {undoable && (
              <button className="btn btn-ghost btn-sm" data-tip={t('撤回')} data-key={noticeUndo!.noKey ? undefined : (keyFor('undo') ?? undefined)} onClick={runNoticeUndo}>
                <Codicon name="discard" size={14} />
                {t('撤回')}
              </button>
            )}
          </div>
        )
        }
      />
    </div>
  )
}

/**
 * 当前栏是左栏时：标题下面一道 2px 强调色，贴在栏头的底边（CN-98）。右边几组有标签，当前栏那一组的当前标签画强调色（shell/dock.css）。
 * 量着标题和格子头摆，每次画完都对一下（拖宽右栏、换左栏那一页都跟着）
 */
const PANE_TITLE: Record<string, string> = {
  left: '.win > .side .vh h2 .t, .win > .side .rhead > b',
}
function PaneMark({ pane }: { pane: Pane }) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const mark = ref.current
    if (!mark) return
    const place = () => {
      const sel = PANE_TITLE[pane]
      const t = sel ? document.querySelector<HTMLElement>(sel) : null
      const head = t?.closest<HTMLElement>('.rhead, .vh, .aih')
      if (!t || !head) return void (mark.hidden = true)
      const a = t.getBoundingClientRect()
      const h = head.getBoundingClientRect()
      mark.hidden = false
      mark.style.left = `${a.left - 2}px`
      mark.style.width = `${a.width + 4}px`
      mark.style.top = `${h.bottom - 2}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  })
  return <i ref={ref} className="pane-mark" data-testid="pane-mark" data-pane={pane} hidden />
}

/** 标签上写的名字 */
function tabName(t: Tab): string {
  switch (t.type) {
    case 'note':
      // 每个文件夹都有一篇「待办」：标签上带文件夹（「写作/待办」）才分得开
      return isTodoNote(t.path) ? todoLabel(t.path) : titleOf(t.path)
    case 'pdf':
      return t.path.split('/').pop()!
    case 'html':
      return t.path.split('/').pop()!.replace(/\.html?$/i, '')
    case 'webread':
      return tNow('{title} · 阅读视图', { title: t.title })
    case 'folder':
      return t.folder.split('/').pop()!
    case 'inbox':
      return INBOX
    case 'home':
      return tNow('首页')
    case 'web':
      return t.title || hostOf(t.url)
    case 'recent':
      return tNow('最近')
    case 'archive':
      return tNow('归档')
    case 'topic':
      return t.topic
    case 'diff':
      return t.title
    case 'oldimages':
      return tNow('梦游预览 · 挪老图')
    case 'trash':
      return tNow('最近删掉的')
    case 'todo':
      return '待办'
    case 'calendar':
      return '日历'
    case 'growth':
      return tNow('生长')
  }
}

/** 这个标签开着的是书摘吗：看开着的那份文档开头的属性（认 bookId，不看路径；读开头 4000 字就够看到属性） */
function isDigestTab(path: string): boolean {
  const d = [...NoteDoc.open].find((x) => x.path === path)
  return !!d && isBookDigest(d.view.state.doc.sliceString(0, Math.min(d.view.state.doc.length, 4000)))
}

/** 标的图标在 Desk 里画（白板用它自己的颜色方块、文件夹用它的图标） */
const TAB_ICON: Record<Exclude<Tab['type'], 'folder'>, CodiconName> = {
  note: 'file-text',
  pdf: 'file-pdf',
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
  trash: 'trash',
  todo: 'checklist',
  calendar: 'calendar',
  growth: 'graph-scatter',
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
    case 'home':
      return [tNow('首页')]
    case 'inbox':
      return [INBOX]
    case 'recent':
      return [tNow('最近')]
    case 'archive':
      return [tNow('归档')]
    case 'topic':
      return [CLIPS, t.topic]
    case 'web':
    case 'webread':
      return [t.title || hostOf(t.url)]
    case 'diff':
      // 先给你看：路径照那一篇所在的文件夹写（不是历史）
      if (t.src.kind === 'proposal') return [...(getProposal(t.src.id)?.files[0]?.path.split('/').slice(0, -1) ?? []), t.title]
      return [t.src.kind === 'dream' ? tNow('梦游报告') : t.src.kind === 'pair' ? tNow('可能重复') : tNow('历史'), t.title]
    case 'oldimages':
      return [tNow('梦游预览'), tNow('挪老图')]
    case 'trash':
      return [tNow('最近删掉的')]
    case 'todo':
      return ['待办']
    case 'calendar':
      return ['日历']
    case 'growth':
      return [tNow('梦游报告'), tNow('生长')]
  }
}

/** 这一篇挂着的那一篇（属性 所属白板 / 所属笔记，同一个文件夹里还在的才算；挪开了就照文件夹走） */
function parentNoteOf(path: string | null, notes: NoteFile[]): string | null {
  const name = path ? notes.find((n) => n.path === path)?.parent : undefined
  if (!path || !name) return null
  const want = `${dirOfPath(path) ? dirOfPath(path) + '/' : ''}${name}.md`.toLowerCase()
  const hit = notes.find((n) => n.path.toLowerCase() === want)
  return hit && hit.path !== path ? hit.path : null
}

/** 面包屑最后一节（这一篇）前面插上它挂着的那一篇 */
const withParent = (parts: string[], parent: string | null) => (parent ? [...parts.slice(0, -1), titleOf(parent), ...parts.slice(-1)] : parts)

/**
 * 方向 A：标签下面一行面包屑，库名打头；前面几节是文件夹，点了开它的首页；笔记的最后一节点了改名。
 * parentAt：那一节是它挂着的父白板 / 笔记（从白板、笔记拍的导图），点了回到那一篇
 */
function Crumbs(props: { className?: string; parts: string[]; parentAt?: number; vaultName: string; onFolder(folder: string): void; onParent(): void; onRename?(): void }) {
  const t = useT()
  return (
    <nav className={'crumbs' + (props.className ? ' ' + props.className : '')} aria-label={t('位置')}>
      <span className="cr root">
        <Codicon name="library" size={14} />
        {props.vaultName}
      </span>
      {props.parts.map((p, i) => (
        <span key={i} className="cr">
          <Codicon name="chevron-right" size={12} className="sep" />
          {i === props.parentAt ? (
            <button className="up" data-tip="回到它挂着的那一篇" data-side="below" onClick={props.onParent}>
              {p}
            </button>
          ) : i < props.parts.length - 1 ? (
            <button onClick={() => props.onFolder(props.parts.slice(0, i + 1).join('/'))}>{p}</button>
          ) : props.onRename ? (
            <button className="last" data-tip={t('点一下改名')} data-key={keyFor('rename') ?? undefined} data-side="below" onClick={props.onRename}>
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
  const t = useT()
  return (
    <div className="welcome">
      <h1>{t('打开一个文件夹当库')}</h1>
      <p>{t('笔记就是这个文件夹里的md文件；没有Git的话会帮你建一个。')}</p>
      <button className="btn btn-primary" onClick={onOpen}>
        <Codicon name="folder-opened" size={14} />
        {t('打开文件夹')}
      </button>
    </div>
  )
}
