#!/usr/bin/env node
// 界面文字的中文表（task-zojmg）：扫代码里 t() / tv() / tIn() 的原句和登记的数据表，写进 src/shared/i18n/zh.ts。
//   node apps/notes/scripts/i18n.mjs            加了、改了句子之后跑：重写 zh.ts（英文表 src/shared/i18n/en/ 手改）
//   node apps/notes/scripts/i18n.mjs --check    只检查 zh.ts 是不是最新的（单元测试也查）
//   node apps/notes/scripts/i18n.mjs --strays   抽完的文件（DONE）里还有没包 t() 的中文吗
//   node apps/notes/scripts/i18n.mjs --todo <文件…>  列出这几个文件里带中文的字（抽下一批时用）
//   node apps/notes/scripts/i18n.mjs --missing [renderer/settings …]  中文表里有、英文表还没有的（可按头一次出现的文件筛）
//
// 不算「漏抽」的中文：console 里的、正则、TS 类型里的、import、对象的键、kw（搜索用的别名，中英都认）、
// 这一行或上一行注释里写着「不翻」的（写进文件的格式、给 AI 的提示词、和磁盘上的名字比的）。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(APP, 'src')
export const ZH_FILE = join(SRC, 'shared', 'i18n', 'zh.ts')

const HAN = /\p{Script=Han}/u
/** 句子里不该有的全角标点、中文：模板里挨着译好的字时就是在拼句子 */
const CJK_OR_WORD = /[\p{Script=Han}　-〿！-｠A-Za-z]/u
/** 取字的函数：t（界面语言）、tNow（组件里要「说的那一刻」的语言时，全局的 t 换个名字引进来）、tv（库语言）、tIn（指定语言，第二个参数是键） */
const CALLS = { t: 0, tNow: 0, tv: 0, tIn: 1 }
/** 参数是分类身份（中文名，shared/categories.ts 的 CatId）的函数：换成这个库的文件夹名，不是界面字 */
const ID_CALLS = new Set(['catName', 'underCat', 'isChildOf'])

/**
 * 抽完的文件（按批加）：这些文件里中文只能在 t() 里，或者在标了「不翻」的地方。路径相对 apps/notes/src
 */
export const DONE = [
  // 没装 Claude Code 时的 AI（task-587os）
  'renderer/ai-setup.tsx',
  'renderer/settings-sources.tsx',
  'main/agent/engine-api.ts',
  'main/agent/cc-setup.ts',
  'shared/ai-sources.ts',
  // 第一批（task-zojmg）：底座、语言设置、速记小窗和菜单栏图标、检查更新、日期
  'main/lang.ts',
  'main/quick.ts',
  'preload/lang.ts',
  'renderer/i18n.ts',
  'renderer/quick/Quick.tsx',
  'shared/quick.ts',
  'shared/update.ts',
  'shared/when.ts',
  // 第一批：设置（settings/files.tsx 等 task-wniqx 合进来再抽）
  'renderer/Settings.tsx',
  'renderer/settings/advanced.tsx',
  'renderer/settings/editor.tsx',
  'renderer/settings/general.tsx',
  'renderer/settings/git.tsx',
  'renderer/settings/jump.ts',
  'renderer/settings/keys.tsx',
  'renderer/settings/pdf.tsx',
  'renderer/settings/privacy.tsx',
  'renderer/settings/family.tsx',
  'renderer/settings/mcp.tsx',
  'renderer/settings/sources.tsx',
  'renderer/settings/ui.tsx',
  'renderer/settings/vault.tsx',
  'renderer/settings/web.tsx',
  'renderer/settings/lang.tsx',
  'renderer/settings-ai.tsx',
  'renderer/settings-dream.tsx',
  'renderer/settings-dream-roles.tsx',
  'renderer/embed-model.tsx',
  'renderer/settings-engines.tsx',
  'renderer/plugins/index.tsx',
  // 第一批：⌘K
  'renderer/Palette.tsx',
  'renderer/search/CmdForm.tsx',
  'renderer/search/PalMenus.tsx',
  'renderer/search/QuickOpen.tsx',
  'renderer/search/rows.ts',
  'renderer/search/cmd-layout.ts',
  'renderer/keys.ts',
  'shared/cmd-keys.ts',
  // 第一批：左栏、首页、底栏（目录树、图标栏、标题栏在 task-wniqx 改的 FileTree.tsx、App.tsx、Shell.tsx 里，合进来再抽）
  'renderer/Sidebar.tsx',
  'renderer/files/look.tsx',
  'renderer/files/move-pick.tsx',
  'renderer/files/type-filter.tsx',
  'renderer/HomeView.tsx',
  'renderer/update.tsx',
  'renderer/shell/StatusBar.tsx',
  'renderer/shell/StatusExtras.tsx',
  // 第一批抽过、这一批补登记的：待办、最近、废纸篓页、左栏的几个小文件
  'renderer/todo/store.ts',
  'renderer/todo/TaskView.tsx',
  'renderer/todo/TodoCard.tsx',
  'renderer/todo/TodoList.tsx',
  'renderer/todo/TodoPanel.tsx',
  'renderer/RecentPage.tsx',
  'renderer/TrashPage.tsx',
  'renderer/files/category-store.ts',
  'renderer/files/left-store.ts',
  'renderer/files/reveal.ts',
  // 第二批（task-zojmg）：外壳和设置 › 文件和附件（App.tsx、FileTree.tsx 还有几段在别的分支正改着，那几句合进来再抽，这两个先不登记）
  'renderer/shell/Shell.tsx',
  'renderer/shell/OutlineView.tsx',
  'renderer/shell/SideSash.tsx',
  'renderer/settings/files.tsx',
  'renderer/files/store.ts',
  // 第二批：白板、文档切成的白板
  'renderer/BoardView.tsx',
  'renderer/CardBody.tsx',
  'renderer/ListView.tsx',
  'renderer/board-drop.ts',
  'renderer/board-edit.ts',
  'renderer/board-link.ts',
  'renderer/board-zoom.ts',
  'renderer/doc-board/DocBoardView.tsx',
  'renderer/doc-board/base-card.tsx',
  'renderer/doc-board/cards.tsx',
  'renderer/doc-board/cross-doc.ts',
  'renderer/doc-board/inbox.tsx',
  'renderer/doc-board/inline-card.tsx',
  'renderer/doc-board/pdf-page.ts',
  'renderer/doc-board/selection.ts',
  'renderer/doc-board/top-hint.tsx',
  'renderer/doc-board/unit-editor.tsx',
  // 第二批：文档（/ 菜单、属性、嵌入）和数据库
  'renderer/slash-menu.tsx',
  'renderer/NoteTab.tsx',
  'renderer/PropsAttach.tsx',
  'renderer/doc-embeds.tsx',
  'renderer/base/BaseTable.tsx',
  'renderer/base/base-block.tsx',
  // 第二批：编辑器零碎、全部笔记、移到废纸篓、历史
  'renderer/HistoryPanel.tsx',
  'renderer/NoteIndex.tsx',
  'renderer/TrashDialog.tsx',
  'renderer/tex.ts',
  'renderer/block-handles.tsx',
  'renderer/link-card.tsx',
  'renderer/conflict-say.ts',
  'renderer/callout.ts',
  'renderer/fold-block.ts',
  'renderer/doc-toc.tsx',
  'renderer/chat-toc.tsx',
  'renderer/peek/peek.tsx',
  'renderer/review.ts',
  'renderer/md-render.tsx',
  'renderer/block-source.tsx',
  'renderer/tail-line.ts',
  'renderer/table-edit.ts',
  'renderer/page-link.ts',
  'renderer/note-menu.tsx',
  'renderer/md-link.ts',
  'renderer/layout-lines.ts',
  'renderer/engine-logo.tsx',
  // 第二批：文件夹首页、文档里的文件夹小块、右键菜单（ctx/actions、editor-menu、translate 在别的分支正改着）
  'renderer/folder-home/FolderHomeView.tsx',
  'renderer/folder-home/FolderContent.tsx',
  'renderer/folder-home/widgets.tsx',
  'renderer/folder-home/dialogs.tsx',
  'renderer/folder-home/cover.tsx',
  'renderer/folder-home/icons.tsx',
  'renderer/folder-home/slide-covers.ts',
  'renderer/folder-home/store.ts',
  'renderer/folder-chip.ts',
  'renderer/ctx/file-menu.ts',
  'renderer/ctx/web-menu.ts',
  'renderer/ctx/message-menu.ts',
  'renderer/ctx/link-row-menu.ts',
  'renderer/ctx/move-menu.ts',
  'renderer/ctx/board-ops.ts',
  'renderer/ctx/menu.ts',
  // 第二批：属性弹层和文档开头的属性表
  'renderer/mindmap/PropsButton.tsx',
  'renderer/mindmap/props-block.ts',
  // 第三批（task-zojmg）：AI 对话（AiPanel.tsx、ai-write.ts、ai-greet.ts 在别的分支正改着，合进来再抽）
  'renderer/composer.tsx',
  'shared/materials.ts',
  'renderer/AiDock.tsx',
  'renderer/ai-chats.ts',
  'renderer/ai-pick.ts',
  'renderer/ai-spot.ts',
  'renderer/ai-quick.tsx',
  'renderer/ai-place.ts',
  'renderer/ai-picker.tsx',
  'renderer/folder-ai.ts',
  'renderer/ai-bridge.ts',
  'renderer/ai-head.tsx',
  'renderer/ai-act.tsx',
  'renderer/ai-act-store.ts',
  'renderer/ai-glow.tsx',
  'renderer/ai-card-grow.ts',
  'renderer/ai-commands.ts',
  'renderer/ai-error.tsx',
  'shared/ai-act.ts',
  'shared/ai-errors.ts',
  'shared/agent.ts',
  'shared/ai-grow.ts',
  'shared/ai-logo.ts',
  // 第三批：AI 命令（commands/run.ts 在别的分支正改着）
  'shared/ai-cmds.ts',
  'renderer/commands/SlashMenu.tsx',
  'renderer/commands/SaveCmd.tsx',
  'renderer/commands/handoff.ts',
  'renderer/commands/proposals.ts',
  'renderer/commands/evidence.ts',
  'renderer/commands/store.ts',
  'renderer/commands/editor.ts',
  // 选中小条能自定义（task-26nz7）
  'shared/sel-bar.ts',
  'renderer/sel-bar/store.ts',
  'renderer/sel-bar/web.ts',
  'renderer/sel-bar/run.ts',
  'renderer/sel-bar/doc.ts',
  'renderer/sel-bar/doc-key.ts',
  'renderer/sel-bar/CapBar.tsx',
  'renderer/settings/sel-bar.tsx',
  'renderer/settings/sb-kit.tsx',
  'renderer/settings/replies.tsx',
  'renderer/replies/save-reply.tsx',
  // 回答下面那排（task-eavzx）
  'shared/replies.ts',
  'renderer/replies/store.ts',
  // 第三批：旁支
  'renderer/side/name.ts',
  'renderer/side/side-core.ts',
  'renderer/side/AskBox.tsx',
  'renderer/side/SideInline.tsx',
  'renderer/side/doc-side.tsx',
  'renderer/side/file-side.tsx',
  'renderer/side/host.ts',
  // 第三批：读 PDF 的笔记栏、出卡、/ 命令（PdfTab、ReadingAi、HtmlTab、WebReadTab、reading/store、双语在别的分支正改着）
  'renderer/reading/CardsDialog.tsx',
  'renderer/reading/ReadingNotes.tsx',
  'renderer/reading/cmds.ts',
  'renderer/reading/card-commands.ts',
  'renderer/reading/marks.ts',
  'renderer/reading/cards-store.ts',
  'renderer/reading/math.tsx',
  'renderer/reading/pdf.ts',
  // 第三批：主进程里给人看的报错（回给 AI 的话、写进文件和 Anki 的字标了不翻；agent/index.ts、tools.ts、reading/prompts.ts 在别的分支正改着）
  'main/reading/index.ts',
  'main/reading/anki.ts',
  'main/reading/cards.ts',
  'main/reading/capture.ts',
  'main/reading/section.ts',
  'main/reading/doubts.ts',
  'main/reading/card-prompt.ts',
  'main/reading/chats.ts',
  'main/agent/engines.ts',
  'main/agent/cli.ts',
  'main/agent/jsonrpc.ts',
  'main/agent/store.ts',
  'main/agent/engine-update.ts',
  'main/agent/engine-watch.ts',
  'main/agent/engine-models.ts',
  'main/agent/engine-check.ts',
  'main/agent/engine-proc.ts',
  'main/agent/web.ts',
  'main/agent/vault-ops.ts',
  'main/agent/context.ts',
  'main/agent/side-prompt.ts',
  'main/agent/board-ops.ts',
  'main/agent/doc-board-ops.ts',
  'main/agent/mcp-server.ts',
  // 数据库第三批第 2 块（task-i921u）：看板、日历、画廊
  'renderer/base/BaseLayout.tsx',
  'renderer/base/BaseKanban.tsx',
  'renderer/base/BaseCalendar.tsx',
  'renderer/base/BaseGallery.tsx',
  'renderer/base/layout-ctx.ts',
  // 数据库第三批第 3、4、5 块和 AI 列（task-i921u）：视图标签条和筛选、右栏一条、关联汇总公式列、AI 列
  'renderer/base/ViewBar.tsx',
  'renderer/base/FilterPanel.tsx',
  'renderer/base/view-state.ts',
  'renderer/base/record-open.ts',
  'renderer/base/RecordPeek.tsx',
  'renderer/base/cols.tsx',
  'renderer/base/ai-cells.tsx',
  'renderer/base/ai-col.ts',
  'renderer/base/AiColPane.tsx',
  'renderer/base/words.ts',
  // 数据库自动化、按钮列、设置 › 自动化和周记（task-i921u「当……就……」）
  'renderer/base/AutoPane.tsx',
  'renderer/base/auto-state.ts',
  'renderer/base/auto-text.tsx',
  'renderer/base/auto-ipc.ts',
  'renderer/base/button-col.tsx',
  'renderer/settings/auto.tsx',
  // 数据库表底合计（task-i921u「通用合计」）：表底算什么的菜单、表底一格、组头占比条
  'renderer/base/sums.tsx',
  // 思维导图第一批（task-wuv05）：标签条「布局 ▾」
  'renderer/mindmap/LayoutMenu.tsx',
  // 合进 dev 后补登记的（task-zojmg）：白板右上角的缩放和收件箱（task-wz7gb）、白板里的导图卡（task-wuv05）
  'renderer/doc-board/corner.tsx',
  'renderer/mindmap/MapThumb.tsx',
  // AI 对话回答下面那一排（task-83vl3）：拷贝 · 插进文档 · ⋯
  'renderer/answer-row.tsx',
  // 白板框选、文档选多块的操作条（task-5ryf9）
  'renderer/multi-select/SelBar.tsx',
  'renderer/multi-select/SelMenu.tsx',
  'renderer/doc-board/board-bar.tsx',
  'renderer/doc-board/board-select.ts',
  'renderer/multi-select/SelPopups.tsx',
  'renderer/ai-cards.ts',
  'renderer/commands/tidy.ts',
  'renderer/block-select.tsx',
  // 费曼的语音输入（task-yvabi）
  'renderer/voice/dictation.tsx',
  // 生长图（task-h7oy8）
  'renderer/growth/GrowthTab.tsx',
  'renderer/growth/GrowthSide.tsx',
  'renderer/growth/dates.ts',
  'renderer/growth/draw.ts',
]

/**
 * 数据表（别人正在改、这一批不动文件本身的；或者本来就是表）：表里的这些字在用的地方 t(变量) 翻，键从这里登记。
 * props：这些属性名的值；objects：这些常量整张对象的值；arrays：这些常量数组的元素；calls：[函数名, 第几个参数]；
 * within：只看这个函数里的（function 或 const 箭头函数）；all：范围里的中文字面量全算；ctx：这张表里的字都是「用在哪::原句」
 */
export const DATA = [
  { file: 'shared/settings-index.ts', props: ['name', 'desc', 'grp', 'label'], arrays: ['SETTINGS_SECTIONS'] },
  // 菜单栏（main/lang.ts 的 menuIn 照「菜单栏::原句」翻）
  { file: 'main/index.ts', within: 'buildMenu', props: ['label'], calls: [['cmd', 1]], ctx: '菜单栏' },
  // 命令表：命令名、说明、在哪能按、设置 › 快捷键的分段
  { file: 'shared/cmd-table.ts', props: ['hint'], calls: [['T', 1]], objects: ['AREA_NAME', 'SECTION_NAME'] },
  // ⌘K 的组名
  { file: 'shared/commands.ts', props: ['name'] },
  // 分类：说明和组名（文件夹名照磁盘上的，不翻）
  { file: 'shared/categories.ts', props: ['desc', 'group'] },
  // 十套主题的名字和一句说明
  { file: 'shared/appearance.ts', props: ['name', 'note'] },
  // 首页组件名、换大小、问候
  { file: 'shared/home.ts', props: ['name'] },
  { file: 'shared/home.ts', within: 'sizeAction', all: true },
  { file: 'shared/home.ts', within: 'greeting', all: true },
  // 设置 › 文档和白板的字体、行距、版心，网页的搜索引擎
  { file: 'shared/prefs.ts', props: ['name'] },
  // 文件夹的颜色名（换图标和颜色）、翻译引擎的状态（底栏「译 · …」）
  { file: 'shared/left.ts', objects: ['COLOR_NAMES'] },
  { file: 'shared/plugins/translate.ts', objects: ['STATE_TEXT'] },
  // 设置 › AI 每家那一行：自查出的问题影响哪
  { file: 'shared/engine-health.ts', objects: ['SCOPE_TEXT'] },
  // 设置 › 插件：权限名、三个内置插件的说明（双语翻译归 task-6cxtc，那边改完再登记）
  { file: 'shared/plugins.ts', objects: ['PERMISSION_LABEL'] },
  { file: 'shared/plugins/weread.ts', props: ['description'] },
  { file: 'shared/plugins/bookmarks.ts', props: ['description'] },
  { file: 'shared/plugins/adblock.ts', props: ['description'] },
  // 读PDF 的缩放名（PdfTab 还拼在中文句子里，设置页画的时候翻）
  { file: 'renderer/settings/pdf.tsx', within: 'PDF_ZOOMS', all: true },
  // 首页封面的名字、窗口背景的说法
  { file: 'renderer/covers.ts', props: ['name'] },
  { file: 'renderer/theme.ts', within: 'winBgName', all: true },

  // ---------- 第二批（task-zojmg）：外壳和目录树 ----------
  // 设置 › 文件和附件：新笔记放哪、删之前问不问
  { file: 'renderer/settings/files.tsx', within: 'WHERE', all: true },
  { file: 'renderer/settings/files.tsx', within: 'ASK', all: true },
  // App 交给 ⌘K 的那几条命令（Palette 画的时候 t(c.name)）；右栏几个标签的名字；目录树的排法
  { file: 'renderer/App.tsx', within: 'commands', props: ['name', 'hint'] },
  { file: 'shared/dock.ts', objects: ['VIEW_NAME'] },
  { file: 'shared/files.ts', within: 'TREE_SORTS', props: ['label', 'hint'] },
  // 目录树最外层的组名：分类的两组在 categories.ts 登记了，这里是最后一组「不在分类里的」
  { file: 'shared/files.ts', within: 'topGroups', all: true },
  // 白板：工具板（格子里一个短词，悬停提示写全）、文档卡的种类、行内卡的空提示
  { file: 'renderer/BoardView.tsx', within: 'PAL', props: ['label'], ctx: '工具板' },
  { file: 'renderer/BoardView.tsx', within: 'PAL', props: ['title'], ctx: '工具板提示' },
  { file: 'renderer/doc-board/DocBoardView.tsx', within: 'PAL', props: ['label'], ctx: '工具板' },
  { file: 'renderer/doc-board/DocBoardView.tsx', within: 'PAL', props: ['tip'] },
  { file: 'renderer/doc-board/cards.tsx', objects: ['KIND_NAME'], ctx: '卡片种类' },
  { file: 'renderer/doc-board/inline-card.tsx', within: 'EMPTY_HINT', all: true },
  // 文档：/ 菜单（名字带「插入菜单」）、数据库的列类型、筛选条件、计算（@cn/format 里的表，路径相对 apps/notes/src）
  { file: 'renderer/slash-menu.tsx', within: 'ITEMS', props: ['label'], ctx: '插入菜单' },
  { file: 'renderer/slash-menu.tsx', within: 'ITEMS', props: ['desc'] },
  { file: 'renderer/slash-menu.tsx', within: 'CALLOUTS', all: true, ctx: '插入菜单' },
  { file: 'renderer/slash-menu.tsx', arrays: ['GROUPS'], ctx: '插入菜单' },
  { file: '../../../packages/format/src/base.ts', props: ['label'], objects: ['CALC_LABEL', 'DATE_CALC_LABEL'], ctx: '数据库' },
  // 数据库第三批（task-i921u）：列的类型、看法、加一列的几组、汇总怎么算、筛选条件和日期的几个选择（画的时候 t(label, { ctx: '数据库' })，renderer/base/words.ts）
  { file: '../../../packages/format/src/base-types.ts', props: ['label', 'group'], ctx: '数据库' },
  { file: '../../../packages/format/src/base-filter.ts', props: ['label'], objects: ['OTHER_OPS', 'DATE_OTHER'], ctx: '数据库' },
  // 自动化「当」「就」的菜单（task-i921u，AutoPane.tsx 画的时候 t(label, { ctx: '数据库' })）
  { file: '../../../packages/format/src/automation.ts', within: 'AUTO_WHENS', props: ['label', 'desc'], ctx: '数据库' },
  { file: '../../../packages/format/src/automation.ts', within: 'AUTO_STEPS', props: ['label', 'group'], ctx: '数据库' },
  // 编辑器零碎：全部笔记的筛选、提示块的名字、块菜单、改写法的提示、文末那一行
  { file: 'renderer/NoteIndex.tsx', within: 'KINDS', all: true },
  { file: 'renderer/callout.ts', within: 'KINDS', props: ['label'] },
  { file: 'renderer/block-handles.tsx', props: ['label'], ctx: '块菜单' },
  { file: 'renderer/block-source.tsx', within: 'RAW_HINT', all: true },
  { file: 'renderer/tail-line.ts', within: 'TAIL_TEXT', all: true },
  { file: 'renderer/tail-line.ts', within: 'NEW_NOTE_TEXT', all: true },
  // 文件夹首页：空着时的话、星期、加组件的分组、条件的值；组件目录、文件夹种类、条件（shared/folder-home.ts，存进 .首页.json 的原值不翻，画的时候 t）
  { file: 'renderer/folder-home/widgets.tsx', objects: ['EMPTY'] },
  { file: 'renderer/folder-home/widgets.tsx', arrays: ['WEEK'], ctx: '星期' },
  { file: 'renderer/folder-home/dialogs.tsx', within: 'GROUPS', all: true },
  { file: 'renderer/folder-home/dialogs.tsx', within: 'VALUES', all: true },
  { file: 'shared/folder-home.ts', props: ['name', 'desc'] },
  { file: 'shared/folder-home.ts', objects: ['KIND_LABEL'], ctx: '文件夹种类' },
  { file: 'shared/folder-home.ts', within: 'COND_OPS', all: true, ctx: '条件' },
  { file: 'shared/folder-home.ts', within: 'matchRule', all: true },
  // 属性弹层：属性的名字（文件里的键不改，界面上照软件的语言）、类型下拉的值（写进文件的值不改，显示翻）
  { file: 'shared/prop-view.ts', objects: ['LABELS'] },
  { file: 'shared/prop-view.ts', arrays: ['COMMON'] },
  { file: 'shared/prop-view.ts', within: 'KEYS_BY_TYPE', all: true },
  { file: 'renderer/mindmap/PropsButton.tsx', arrays: ['TYPES'], ctx: '笔记类型' },
  // ---------- 第三批（task-zojmg）：AI 和读 ----------
  // AI 对话：「能动手」那颗的几句（AiPanel 画的时候 t）、整块动手时顶上那条
  { file: 'renderer/ai-place.ts', objects: ['HANDS'] },
  { file: 'renderer/ai-act.tsx', objects: ['TEXT'] },
  // AI 命令：自带命令的名字、说明、小标签、规矩（复制一份再改时照界面语言），在哪能用、写到哪、存在哪
  { file: 'shared/ai-cmds.ts', within: 'BUILTINS', all: true },
  { file: 'shared/ai-cmds.ts', within: 'WHERE', all: true, ctx: '在哪能用' },
  { file: 'shared/ai-cmds.ts', within: 'WRITES', all: true, ctx: '写到哪' },
  { file: 'shared/ai-cmds.ts', within: 'STORES', all: true },
  // 选中小条（task-26nz7）：在哪出现、自带的几颗、提示词里的空、编辑页的例子
  { file: 'shared/sel-bar.ts', within: 'BAR_PLACES', all: true, ctx: '在哪能用' },
  { file: 'shared/sel-bar.ts', within: 'BAR_BUILTINS', props: ['name', 'note', 'r'] },
  { file: 'shared/sel-bar.ts', within: 'PROMPT_VARS', props: ['zh'] },
  { file: 'renderer/settings/sel-bar.tsx', within: 'SUGS', all: true },
  // 回答下面那排（task-eavzx）：在哪能用、自带的三颗、那句里的空
  { file: 'shared/replies.ts', within: 'REPLY_PLACES', all: true, ctx: '在哪能用' },
  { file: 'shared/replies.ts', within: 'REPLY_BUILTINS', props: ['name', 'note'] },
  { file: 'shared/replies.ts', within: 'REPLY_VARS', props: ['zh'] },
  // 设置 › 回答下面那排：预览的示例回答、编辑页的例子
  { file: 'renderer/settings/replies.tsx', within: 'SAMPLE', all: true },
  { file: 'renderer/settings/replies.tsx', within: 'SUGS', all: true },
  { file: 'shared/ai-cmds.ts', within: 'WRITE_TAG', all: true },
  { file: 'shared/ai-cmds.ts', within: 'tagsOf', all: true },
  { file: 'renderer/commands/SaveCmd.tsx', objects: ['EV_TEXT'] },
  // 旁支里空着回车问的那句；读 PDF 笔记栏的筛选（英文写短 All · Mine · Threads）
  { file: 'renderer/side/name.ts', within: 'ASK_THIS', all: true },
  { file: 'renderer/reading/ReadingNotes.tsx', within: 'FILTERS', all: true, ctx: '笔记筛选' },
]

const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
const ast = (code) => parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true })

function walk(node, visit, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return
  if (visit(node, parent, key) === false) return
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k.endsWith('Comments') || k === 'extra') continue
    const v = node[k]
    if (Array.isArray(v)) for (const c of v) walk(c, visit, node, k)
    else if (v && typeof v.type === 'string') walk(v, visit, node, k)
  }
}

/** 静态的字（字面量，或者没有 ${} 的模板） */
function staticText(n) {
  if (!n) return null
  if (n.type === 'StringLiteral') return n.value
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked
  return null
}

function calleeName(n) {
  return n.callee?.type === 'Identifier' && n.callee.name in CALLS ? n.callee.name : null
}

/** t(key, { ctx: '…' }) 的 ctx */
function ctxOf(n, name) {
  const p = n.arguments[CALLS[name] + 1]
  if (p?.type !== 'ObjectExpression') return undefined
  const c = p.properties.find((x) => x.type === 'ObjectProperty' && (x.key.name ?? x.key.value) === 'ctx')
  return c ? (staticText(c.value) ?? undefined) : undefined
}

/** 注释里写着「不翻」的行（这一行和下一行都算） */
function skipLines(code) {
  const out = new Set()
  code.split('\n').forEach((l, i) => {
    if (/\/[/*].*不翻/.test(l)) (out.add(i + 1), out.add(i + 2))
  })
  return out
}

/** 一个文件：t() 的键、没包的中文、拼出来的句子 */
export function scanCode(code, file = '') {
  const keys = []
  const strays = []
  const concat = []
  const skip = skipLines(code)
  const inT = new Set()
  walk(ast(code).program, (n, parent, key) => {
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type.startsWith('TS') && n.type !== 'TSAsExpression' && n.type !== 'TSSatisfiesExpression' && n.type !== 'TSNonNullExpression') return false
    if (n.type === 'CallExpression') {
      const c = n.callee
      if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'console') return false
      if (c.type === 'Identifier' && ID_CALLS.has(c.name)) return false
      const name = calleeName(n)
      if (name) {
        const arg = n.arguments[CALLS[name]]
        const text = staticText(arg)
        if (text !== null) {
          keys.push({ key: text, ctx: ctxOf(n, name), line: n.loc.start.line, file })
          inT.add(arg)
        }
        // 第二个参数里 ctx（用在哪）不是界面上的字；别的变量照常看（里面可能还有 t()，也可能有没包的中文）
        const p = n.arguments[CALLS[name] + 1]
        if (p?.type === 'ObjectExpression') for (const x of p.properties) if (x.type === 'ObjectProperty' && (x.key.name ?? x.key.value) === 'ctx') inT.add(x.value)
        // 拼句子：t() 和别的字用 + 连、或者放进带字的模板里
        if (parent?.type === 'BinaryExpression' && parent.operator === '+') {
          const other = parent.left === n ? parent.right : parent.left
          const s = other.type === 'StringLiteral' ? other.value : other.type === 'TemplateLiteral' ? other.quasis.map((q) => q.value.cooked).join('') : ''
          if (calleeName(other) || CJK_OR_WORD.test(s)) concat.push({ line: n.loc.start.line, file, why: '用 + 接在别的字上' })
        }
        if (parent?.type === 'TemplateLiteral' && parent.quasis.some((q) => CJK_OR_WORD.test(q.value.cooked ?? ''))) concat.push({ line: n.loc.start.line, file, why: '放在带字的模板里' })
      }
    }
    if (n.type === 'ObjectProperty' && n.key && (n.key.name ?? n.key.value) === 'kw') return false
    if (inT.has(n)) return false
    const line = n.loc?.start.line
    if (skip.has(line)) return
    const isKey = parent && key === 'key' && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassProperty')
    if (isKey) return
    if (n.type === 'StringLiteral' && HAN.test(n.value)) strays.push({ line, file, text: n.value })
    else if (n.type === 'TemplateLiteral' && n.quasis.some((q) => HAN.test(q.value.cooked ?? ''))) strays.push({ line, file, text: n.quasis.map((q) => q.value.cooked).join('${…}') })
    else if (n.type === 'JSXText' && HAN.test(n.value)) strays.push({ line, file, text: n.value.trim() })
    else if (n.type === 'JSXAttribute' && n.value?.type === 'StringLiteral' && HAN.test(n.value.value) && !skip.has(n.value.loc.start.line)) {
      strays.push({ line, file, text: n.value.value })
      return false
    }
  })
  return { keys, strays, concat }
}

/** 数据表里登记的句子 */
export function scanData(rule) {
  const code = read(rule.file)
  const out = []
  const add = (n) => {
    const s = staticText(n)
    if (s !== null && HAN.test(s)) out.push({ key: s, ctx: rule.ctx, line: n.loc.start.line, file: rule.file })
  }
  const unwrap = (n) => (n && (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression') ? unwrap(n.expression) : n)
  const visitRoot = (root) =>
    walk(root, (n) => {
      if (rule.all && (n.type === 'StringLiteral' || n.type === 'TemplateLiteral')) add(n)
      if (n.type === 'ObjectProperty' && rule.props?.includes(n.key.name ?? n.key.value)) add(n.value)
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') {
        const init = unwrap(n.init)
        if (rule.objects?.includes(n.id.name) && init?.type === 'ObjectExpression') for (const p of init.properties) if (p.type === 'ObjectProperty') add(unwrap(p.value))
        if (rule.arrays?.includes(n.id.name) && init?.type === 'ArrayExpression') for (const e of init.elements) add(unwrap(e))
      }
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier') for (const [fn, i] of rule.calls ?? []) if (n.callee.name === fn) add(n.arguments[i])
    })
  const program = ast(code).program
  if (!rule.within) visitRoot(program)
  else
    walk(program, (n) => {
      if (n.type === 'FunctionDeclaration' && n.id?.name === rule.within) return (visitRoot(n.body), false)
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === rule.within && n.init) return (visitRoot(n.init), false)
    })
  return out
}

function srcFiles(dir = SRC) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'public' ? [] : srcFiles(p)
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') && p !== ZH_FILE && !p.includes(join('shared', 'i18n', 'en')) ? [p] : []
  })
}

/** 中文表：全部键（带用在哪的写成「用在哪::原句」），按头一次出现的文件分段 */
export function collect() {
  const seen = new Map()
  const push = (k) => {
    const id = k.ctx ? `${k.ctx}::${k.key}` : k.key
    if (!seen.has(id)) seen.set(id, k.file)
  }
  for (const f of srcFiles()) {
    const code = readFileSync(f, 'utf8')
    if (!/\b(t|tNow|tv|tIn)\(/.test(code)) continue
    for (const k of scanCode(code, relative(SRC, f)).keys) push(k)
  }
  for (const r of DATA) for (const k of scanData(r)) push(k)
  return seen
}

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

export function zhSource(seen = collect()) {
  const byFile = new Map()
  for (const [id, file] of seen) byFile.set(file, [...(byFile.get(file) ?? []), id])
  const files = [...byFile.keys()].sort()
  const body = files.map((f) => `  // ${f}\n` + byFile.get(f).map((id) => `  ${q(id)},`).join('\n')).join('\n')
  return `/**\n * 中文表：界面上每一句的原句（也是英文表的键），由 apps/notes/scripts/i18n.mjs 从代码里扫出来，别手改。\n * 加了、改了句子跑 node apps/notes/scripts/i18n.mjs，再在 en/ 里补英文。\n */\nexport const ZH: readonly string[] = [\n${body}\n]\n`
}

/** 抽完的文件里还没包的中文、拼出来的句子 */
export function doneProblems() {
  const strays = []
  const concat = []
  for (const f of DONE) {
    const r = scanCode(read(f), f)
    strays.push(...r.strays)
    concat.push(...r.concat)
  }
  return { strays, concat }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2]
  if (arg === '--check') {
    const now = readFileSync(ZH_FILE, 'utf8')
    if (now !== zhSource()) {
      console.error('zh.ts 不是最新的：跑 node apps/notes/scripts/i18n.mjs')
      process.exit(1)
    }
    console.log('zh.ts 是最新的')
  } else if (arg === '--strays') {
    const { strays, concat } = doneProblems()
    for (const s of strays) console.log(`${s.file}:${s.line}  ${s.text}`)
    for (const c of concat) console.log(`${c.file}:${c.line}  拼句子：${c.why}`)
    console.log(`${strays.length} 处没包，${concat.length} 处拼句子`)
  } else if (arg === '--missing') {
    // 英文表是 TS，node 读不了：用正则取出英文表里的键（键都写成单引号字符串或不带引号的中文）
    const enDir = join(SRC, 'shared', 'i18n', 'en')
    const have = new Set()
    for (const f of readdirSync(enDir)) {
      const code = readFileSync(join(enDir, f), 'utf8')
      walk(ast(code).program, (n, parent, key) => {
        if (parent?.type === 'ObjectProperty' && key === 'key') have.add(n.type === 'Identifier' ? n.name : n.value)
      })
    }
    const prefixes = process.argv.slice(3)
    let n = 0
    for (const [id, file] of collect()) {
      if (have.has(id) || (prefixes.length && !prefixes.some((p) => file.startsWith(p)))) continue
      console.log(`${file}  ${id}`)
      n++
    }
    console.log(`${n} 句还没有英文`)
  } else if (arg === '--todo') {
    for (const f of process.argv.slice(3)) {
      const rel = relative(SRC, join(process.cwd(), f))
      for (const s of scanCode(readFileSync(join(process.cwd(), f), 'utf8'), rel).strays) console.log(`${rel}:${s.line}  ${s.text}`)
    }
  } else {
    const seen = collect()
    writeFileSync(ZH_FILE, zhSource(seen))
    console.log(`zh.ts：${seen.size} 句`)
  }
}
