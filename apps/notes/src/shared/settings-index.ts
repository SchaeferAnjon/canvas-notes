/**
 * 设置的分页和每一项（2026-11-21 用户选方向 A「分组侧栏」，task-f7rib）：侧栏 5 段 15 页、侧栏顶上的搜索、
 * 从用的地方跳过来（翻到那页、那一行闪 1.6 秒）都从这一张表出。外观、首页、梦游、插件这几页照现在的样子画，
 * 表里只记它们能被搜到、能跳到的那几块（页面里同名的 data-row）。
 * 搜索：名字、说明、组名、页名、别的叫法（kw）都算，几个词用空格隔开时每个都要打中；名字里有的排前面。纯数据和纯函数。
 */

export type SettingsPageId = 'general' | 'look' | 'home' | 'editor' | 'files' | 'pdf' | 'web' | 'ai' | 'dream' | 'vault' | 'git' | 'privacy' | 'plugins' | 'keys' | 'advanced'

export interface SettingsPageInfo {
  id: SettingsPageId
  name: string
  /** Codicon 的名字；AI 页画 AI 对话那一家的标志（界面那边换） */
  icon: string
  /** 侧栏的段 */
  sec: string
  /** 页头那一句：这页管什么 */
  desc: string
}

export interface SettingsItem {
  id: string
  pg: SettingsPageId
  /** 页里的组名 */
  grp: string
  label: string
  desc?: string
  /** 别的叫法（搜索用） */
  kw?: string
}

export const SETTINGS_SECTIONS = ['常用', '写和读', 'AI', '库和同步', '其他'] as const

export const SETTINGS_PAGES: SettingsPageInfo[] = [
  { id: 'general', name: '一般', icon: 'settings-gear', sec: '常用', desc: '打开、速记、更新' },
  { id: 'look', name: '外观', icon: 'symbol-color', sec: '常用', desc: '主题、界面风格、窗口背景、首页样式' },
  { id: 'home', name: '首页', icon: 'home', sec: '常用', desc: '首页样式、封面、组件' },
  { id: 'editor', name: '文档和白板', icon: 'edit', sec: '写和读', desc: '写文档、摆白板、搜索时的习惯' },
  { id: 'files', name: '文件和附件', icon: 'files', sec: '写和读', desc: '新笔记放哪、附件、删除和归档' },
  { id: 'pdf', name: '读PDF', icon: 'file-pdf', sec: '写和读', desc: '读PDF边读边问' },
  { id: 'web', name: '网页和视频', icon: 'globe', sec: '写和读', desc: '右栏网页、下载、看视频和生成字幕' },
  { id: 'ai', name: 'AI', icon: 'comment-discussion', sec: 'AI', desc: '用哪家AI、能动手到哪' },
  { id: 'dream', name: '梦游', icon: 'wand', sec: 'AI', desc: '闲时整理库：什么时候、做哪些事' },
  { id: 'vault', name: '库', icon: 'library', sec: '库和同步', desc: '现在的库、导入旧笔记' },
  { id: 'git', name: 'Git和同步', icon: 'git-branch', sec: '库和同步', desc: '提交、同步到远程、备份' },
  { id: 'privacy', name: '隐私和联网', icon: 'shield', sec: '库和同步', desc: '软件什么时候联网、联到哪' },
  { id: 'plugins', name: '插件', icon: 'extensions', sec: '其他', desc: '内置的四个插件' },
  { id: 'keys', name: '快捷键', icon: 'record-keys', sec: '其他', desc: '每条命令都能设键；点一个键就能改，撞了别的会告诉你' },
  { id: 'advanced', name: '高级', icon: 'tools', sec: '其他', desc: '出问题时用' },
]

export const SETTINGS_ITEMS: SettingsItem[] = [
  // ---------- 一般 ----------
  { id: 'reopen', pg: 'general', grp: '启动和窗口', label: '打开时回到上次的样子', desc: '上次的库、开着的标签、右栏的网页', kw: '恢复 标签 上次 启动' },
  { id: 'tray', pg: 'general', grp: '启动和窗口', label: '菜单栏图标', desc: '菜单栏里一叠卡片的小图标，点开速记', kw: '菜单栏 托盘 图标 状态栏' },
  { id: 'quickKey', pg: 'general', grp: '速记', label: '速记快捷键', desc: '在任何软件里按，弹出小输入框，回车进收件箱', kw: '速记 快捷键 全局 收件箱 捕捉' },
  { id: 'quickSrc', pg: 'general', grp: '速记', label: '选中文字时带上来源', desc: '在别的软件里选了字再按，记下是哪个软件、哪个网页', kw: '速记 来源' },
  { id: 'autoUpdate', pg: 'general', grp: '更新', label: '自动检查更新', desc: '打开30秒后查一次，之后每6小时；下好了底栏右端出「重启更新」', kw: '更新 升级 版本 新版本' },
  { id: 'checkNow', pg: 'general', grp: '更新', label: '检查更新', desc: '现在的版本，上次检查的时间', kw: '更新 版本 检查' },
  // ---------- 外观（照现在的页） ----------
  { id: 'skin', pg: 'look', grp: '主题', label: '主题', desc: '十套，浅色深色各五；能导入VS Code主题', kw: '主题 颜色 配色 皮肤 深色 浅色' },
  { id: 'importTheme', pg: 'look', grp: '主题', label: '导入VS Code主题', desc: '选 .json或 .vsix；对不上的颜色按底色和字色算', kw: 'VS Code 主题 导入 json vsix' },
  { id: 'follow', pg: 'look', grp: '主题', label: '跟着系统换浅深', desc: '白天用一套，夜里用一套', kw: '深色 夜间 暗色 跟随系统' },
  { id: 'frame', pg: 'look', grp: '界面风格', label: '界面风格', desc: 'A 照VS Code，平的；B 浮岛书桌，背景图铺满', kw: '风格 布局 VS Code 浮岛' },
  { id: 'winbg', pg: 'look', grp: '窗口背景', label: '窗口背景', desc: 'B 风格里铺满整个窗口', kw: '背景 壁纸 图片' },
  // ---------- 首页（照现在的页） ----------
  { id: 'homeStyle', pg: 'home', grp: '首页样式', label: '首页样式', desc: 'A 封面长图加组件；B 整页背景加玻璃组件', kw: '首页 样式 封面' },
  { id: 'homeWinBg', pg: 'home', grp: '首页样式', label: '整页背景用窗口背景那张图', desc: '只在样式 B 里有用', kw: '首页 背景' },
  { id: 'cover', pg: 'home', grp: '封面', label: '封面', desc: '存在库里，跟着Git走；首页上「编辑首页」改的也是它', kw: '封面 图片 首页' },
  { id: 'widgets', pg: 'home', grp: '组件', label: '组件', desc: '关掉的收进首页下面的抽屉', kw: '组件 小组件 首页' },
  // ---------- 文档和白板 ----------
  { id: 'font', pg: 'editor', grp: '文字', label: '正文字体', desc: '文档正文；标题、代码各用各的', kw: '字体 font 宋体 苹方' },
  { id: 'size', pg: 'editor', grp: '文字', label: '字号', desc: '文档正文的字号；打开着的文档当场跟着变', kw: '字号 大小 字体大小 放大' },
  { id: 'lineh', pg: 'editor', grp: '文字', label: '行距', desc: '', kw: '行距 行高 间距' },
  { id: 'width', pg: 'editor', grp: '文字', label: '版心宽', desc: '一篇单独开「⋯ › 宽版」的不跟这里', kw: '版心 宽度 宽版 行宽' },
  { id: 'newView', pg: 'editor', grp: '写的时候', label: '新建笔记先用', desc: '同一个md文件，两种看法随时切', kw: '默认 看法 白板 文档 新建' },
  { id: 'spell', pg: 'editor', grp: '写的时候', label: '拼写检查', desc: '英文拼错的词下面画红线；中文不查', kw: '拼写 错别字 spell' },
  { id: 'boardShrink', pg: 'editor', grp: '白板', label: '右栏开着时白板缩小', desc: '缩到0.8，白板不被右栏挡住', kw: '白板 缩放 右栏' },
  { id: 'boardDots', pg: 'editor', grp: '白板', label: '点阵背景', desc: '', kw: '白板 点阵 网格 背景' },
  { id: 'unsorted', pg: 'editor', grp: '白板', label: '白板右边列收件箱', desc: '白板右边那一格列收件箱里的笔记，拖进一列就放进那一节', kw: '未整理 收件箱 白板' },
  { id: 'semantic', pg: 'editor', grp: '搜索', label: '按意思找', desc: '本机小模型在后台建索引，搜「冰岛的冬天」也找得到「雷克雅未克一月」；不联网', kw: '搜索 意思 语义 索引' },
  // ---------- 文件和附件 ----------
  { id: 'newWhere', pg: 'files', grp: '新建', label: '新笔记放哪', desc: '{k:new-note}、速记、剪藏没选地方时', kw: '新建 新笔记 位置 收件箱 默认文件夹' },
  { id: 'attach', pg: 'files', grp: '附件', label: '图片和附件放在', desc: '附件/<笔记路径>/ · 改名、挪动笔记时跟着走，梦游也认这个规矩，所以不能改', kw: '附件 图片 截图 文件夹 assets' },
  { id: 'delAsk', pg: 'files', grp: '删除', label: '删笔记前问一声', desc: '删掉的进废纸篓，Git里也留着这一版', kw: '删除 确认 废纸篓' },
  { id: 'delImgs', pg: 'files', grp: '删除', label: '连同它的图一起删', desc: '删笔记时弹框里那个勾，这里改的是下次默认勾不勾', kw: '删除 图片 附件' },
  { id: 'archive', pg: 'files', grp: '归档', label: '多久没改算归档', desc: '从左栏收进「归档」；文件不挪，置顶的不归档', kw: '归档 旧笔记 左栏' },
  // ---------- 读PDF ----------
  { id: 'pdfZoom', pg: 'pdf', grp: '打开时', label: '新打开的PDF缩放', desc: '每份看到哪、缩放多少都记着；这里只管第一次打开', kw: 'PDF 缩放 大小 页面' },
  { id: 'pdfAi', pg: 'pdf', grp: '打开时', label: '打开PDF时开着AI', desc: '关着时框一块、点「问AI」才开', kw: 'PDF AI 右栏' },
  { id: 'pdfRecap', pg: 'pdf', grp: '笔记', label: '后台写每一轮的标题和小结', desc: '用读PDF那一家AI（Claude Code 时用 Haiku）；关了不再问AI，标题和小结截问和答的开头', kw: 'PDF 笔记 小结 标题' },
  // 送进Anki（task-tz7y3，方向 B「AI 先改成卡，一张张过」）：笔记类型、牌组照 ChatCards，出卡用哪家 AI，整个库没送的一次出卡
  { id: 'anki', pg: 'pdf', grp: '送进Anki', label: 'Anki', desc: '笔记类型、样式照ChatCards（学习卡 · 问答），课程和PDF写进标签', kw: 'Anki 卡片 导出 出卡 AnkiConnect 连上 我的疑惑' },
  { id: 'ankiDeck', pg: 'pdf', grp: '送进Anki', label: '送进哪个牌组', desc: '按文件夹分牌组；直接放在课里的用PDF的名字，别处的进「知识」。例：课程/ecp/Week 2/补充材料 → 课程::ecp::Week 2::补充材料', kw: 'Anki 牌组 deck 课程' },
  { id: 'ankiSides', pg: 'pdf', grp: '送进Anki', label: '旁支里问的也送', desc: '旁支的卡背面多一栏「原文」：被问的那一句', kw: 'Anki 旁支 出卡' },
  { id: 'ankiEngine', pg: 'pdf', grp: '送进Anki', label: '改写成卡用哪家AI', desc: '没单独选时跟设置 › AI 的默认', kw: 'Anki 出卡 AI 模型 改写' },
  { id: 'ankiOff', pg: 'pdf', grp: '送进Anki', label: 'Anki 没开、没装时', desc: '选好的卡先留着，开了接着送', kw: 'Anki AnkiConnect 插件 安装 没开' },
  { id: 'ankiAll', pg: 'pdf', grp: '送进Anki', label: '整个库读PDF时问过的', desc: '整个库问过的，没送的一次出卡', kw: 'Anki 出卡 整个库 全部' },
  // ---------- 网页和视频 ----------
  { id: 'engine', pg: 'web', grp: '网页', label: '地址栏搜索用', desc: '地址栏和{k:search}里打的不是网址时', kw: '搜索引擎 谷歌 百度 必应 Google Bing' },
  { id: 'newTab', pg: 'web', grp: '网页', label: '新网页标签打开', desc: '{k:web-new-tab} 和标签条的 +', kw: '新标签 首页 主页 起始页' },
  { id: 'chrome', pg: 'web', grp: '网页', label: 'Chrome的登录', desc: '把Chrome里的登录带进右栏网页；macOS会问一次钥匙串', kw: 'Chrome 登录 cookie 导入 账号' },
  { id: 'ext', pg: 'web', grp: '网页', label: 'Chrome插件', desc: '能用哪些接口写在每个插件上', kw: 'Chrome 插件 扩展 extension' },
  { id: 'dlDir', pg: 'web', grp: '下载', label: '下载放在', desc: '右栏网页里点了下载的文件放这里；下好了底下说一声', kw: '下载 文件 保存 download' },
  { id: 'autoSubs', pg: 'web', grp: '视频', label: '没字幕的视频打开就生成', desc: '要先填听写密钥；一小时约¥0.7', kw: '字幕 听写 自动 视频' },
  { id: 'soniox', pg: 'web', grp: '视频', label: '听写（Soniox）密钥', desc: '没字幕的视频「生成字幕」时用；加密存在这台Mac上', kw: 'Soniox 密钥 key 听写 字幕' },
  { id: 'subsShow', pg: 'web', grp: '视频', label: '字幕怎么显示、记到哪', desc: '在视频条的字幕菜单里，看视频时改最顺手', kw: '字幕 显示 视频条' },
  // ---------- AI ----------
  { id: 'aiDefault', pg: 'ai', grp: '默认', label: '默认用哪家AI', desc: '用这台Mac上已经登录的命令行，不另存密钥', kw: 'AI 引擎 默认 模型 Claude Codex Gemini OpenCode' },
  { id: 'fChat', pg: 'ai', grp: '各功能用哪个', label: 'AI对话', desc: '右栏AI那一格，读PDF边读边问也是它', kw: 'AI 对话 聊天' },
  { id: 'fDream', pg: 'ai', grp: '各功能用哪个', label: '梦游', desc: '夜里整理收件箱、写报告、做可视化', kw: '梦游 AI' },
  { id: 'fVision', pg: 'ai', grp: '各功能用哪个', label: '看图问', desc: '视频框一块问、拍导图识别；只有Claude Code能看图', kw: '看图 图片 识别' },
  { id: 'fTrans', pg: 'ai', grp: '各功能用哪个', label: '翻译', desc: '网页和视频字幕的双语翻译', kw: '翻译 双语' },
  { id: 'fQuick', pg: 'ai', grp: '各功能用哪个', label: '小活', desc: '视频摘要、起名、插件里的快问', kw: '小活 摘要 起名' },
  { id: 'omni', pg: 'ai', grp: '能动手到哪', label: '全能模式', desc: '开着能读写这台Mac上的文件、跑命令、上网；关着只在库里新建、改名、挪、删笔记。AI输入框下面那颗是同一个开关', kw: '全能 权限 命令 读写' },
  { id: 'prompt', pg: 'ai', grp: '能动手到哪', label: '给AI的长期说明', desc: '每次对话都带上，比如「回答用中文、先说结论」', kw: '提示词 prompt 说明 指令 系统提示' },
  // 各家命令行（task-m55m7）：版本、自查能不能用、拉到几个模型、检查更新 / 更新（settings-engines.tsx）
  { id: 'cliClaude', pg: 'ai', grp: '各家命令行', label: 'Claude Code', desc: '版本、能不能用、模型；检查更新', kw: '版本 更新 升级 兼容 命令行 模型 claude update' },
  { id: 'cliCodex', pg: 'ai', grp: '各家命令行', label: 'Codex', desc: '版本、能不能用、模型；检查更新', kw: '版本 更新 升级 兼容 命令行 模型 codex update' },
  { id: 'cliGemini', pg: 'ai', grp: '各家命令行', label: 'Gemini', desc: '版本、能不能用、模型；检查更新', kw: '版本 更新 升级 兼容 命令行 模型 gemini' },
  { id: 'cliOpencode', pg: 'ai', grp: '各家命令行', label: 'OpenCode', desc: '版本、能不能用、模型；检查更新', kw: '版本 更新 升级 兼容 命令行 模型 opencode upgrade' },
  // ---------- 梦游（照现在的页） ----------
  { id: 'dAuto', pg: 'dream', grp: '什么时候梦游', label: '自己梦游', desc: '关了只在点「现在梦游」时梦游', kw: '梦游 自动 闲时' },
  { id: 'dIdle', pg: 'dream', grp: '什么时候梦游', label: '没人动多久算闲', desc: '这台Mac没人碰键盘和鼠标这么久', kw: '梦游 闲' },
  { id: 'dGap', pg: 'dream', grp: '什么时候梦游', label: '两次之间至少隔', desc: '从上次梦游完算起', kw: '梦游 间隔' },
  { id: 'dWait', pg: 'dream', grp: '什么时候梦游', label: '等上一份报告看完', desc: '上一份还有没收下、没丢掉的就不自己梦游', kw: '梦游 报告' },
  { id: 'dSteps', pg: 'dream', grp: '能做哪些事', label: '能做哪些事', desc: '归类、改名、补双链、写小结、做可视化…八样各一个开关', kw: '梦游 归类 改名 双链 可视化 小结 重复' },
  { id: 'dFolders', pg: 'dream', grp: '能动哪些文件夹', label: '能动哪些文件夹', desc: '梦游只在勾上的文件夹里改字、建文件', kw: '梦游 文件夹 分类' },
  { id: 'dTake', pg: 'dream', grp: '改完怎么收', label: '改完怎么收', desc: '先预览，收下才进库；或改完直接收下', kw: '梦游 预览 收下' },
  { id: 'dAi', pg: 'dream', grp: '用哪家AI', label: '梦游用哪家AI', desc: '在设置 › AI的「梦游」那一行换', kw: '梦游 AI 引擎' },
  // ---------- 库 ----------
  { id: 'vaultNow', pg: 'vault', grp: '现在的库', label: '现在的库', desc: '一个普通文件夹，里面是md文件', kw: '库 文件夹 换库 vault' },
  { id: 'import', pg: 'vault', grp: '导入', label: '导入旧笔记', desc: '备忘录或旧的Obsidian库：先进收件箱，梦游时分好类', kw: '导入 Obsidian 备忘录 迁移' },
  // ---------- Git和同步 ----------
  { id: 'gitId', pg: 'git', grp: '提交', label: '提交署名', desc: '每次提交记进历史的名字和邮箱', kw: '署名 名字 邮箱 作者' },
  { id: 'autoCommit', pg: 'git', grp: '提交', label: '自动提交', desc: '没提交的改动到点提交一次；退出、换库前也提交', kw: '自动提交 间隔 commit' },
  { id: 'hideInternal', pg: 'git', grp: '提交', label: '历史里藏起软件自己的设置文件', desc: '左栏、首页、置顶这些设置的改动不列出来', kw: '历史 设置文件 隐藏' },
  { id: 'remote', pg: 'git', grp: '同步', label: '远程地址', desc: 'GitHub 之类的远程仓库', kw: '远程 GitHub 地址 仓库 remote' },
  { id: 'autoSync', pg: 'git', grp: '同步', label: '自动同步', desc: '同步 = 先提交，再拉，再推；现在只在你点「同步」时联网', kw: '自动同步 定时 推 拉 push pull' },
  { id: 'pullOpen', pg: 'git', grp: '同步', label: '打开库时先拉一次', desc: '在别的电脑上改过时，先拿到那边的', kw: '拉 pull 打开 启动' },
  { id: 'pushQuit', pg: 'git', grp: '同步', label: '退出前推一次', desc: '退出时多等几秒', kw: '推 push 退出' },
  { id: 'conflict', pg: 'git', grp: '同步', label: '两边都改了同一篇', desc: '改的不是同一处的自动合；改了同一处的退回同步前，本机的字都在', kw: '冲突 合并 conflict' },
  { id: 'ignore', pg: 'git', grp: '不进Git的', label: '不进Git的文件', desc: '写在库里的 .gitignore', kw: 'gitignore 忽略 大文件 排除' },
  { id: 'backup', pg: 'git', grp: '备份', label: '每天备份一份到', desc: '没设远程时，Git历史只在这台Mac上；另存一份到iCloud云盘或外接盘', kw: '备份 iCloud 外接盘 安全' },
  // ---------- 隐私和联网 ----------
  { id: 'netList', pg: 'privacy', grp: '会联网的', label: '检查更新', desc: '连 GitHub Release；打开30秒后一次，之后每6小时', kw: '联网 隐私 更新' },
  { id: 'netAd', pg: 'privacy', grp: '会联网的', label: '拦广告的规则', desc: '每周取一次 EasyList、EasyPrivacy；关了网页不拦广告', kw: '拦广告 联网' },
  { id: 'netWeread', pg: 'privacy', grp: '会联网的', label: '微信读书同步划线', desc: '看微信读书时把每本书的划线和想法同步进「阅读」；插件页里那个开关是同一个', kw: '微信读书 同步 联网' },
  { id: 'netGit', pg: 'privacy', grp: '会联网的', label: 'Git同步', desc: '只在你点「同步」时（或开了自动同步）', kw: '同步 联网' },
  { id: 'netAi', pg: 'privacy', grp: '会联网的', label: 'AI、翻译、听写', desc: '你问、点翻译、点生成字幕、闲时梦游时，由各家的命令行或接口联网；软件自己不往外传你的笔记', kw: 'AI 联网 隐私 数据 梦游' },
  { id: 'netWeb', pg: 'privacy', grp: '会联网的', label: '网页、书签图标、视频卡片', desc: '右栏开着的网页、新网页标签上书签的图标、白板上视频卡的标题和封面，打开时联网；微信读书登录着时，打开软件会问一下登录还在不在', kw: '网页 图标 联网 网站' },
  { id: 'netNone', pg: 'privacy', grp: '不会做的', label: '不收集使用数据', desc: '没有统计、没有崩溃报告；搜索的意思索引在本机算', kw: '统计 隐私 数据 收集' },
  // ---------- 插件（照现在的页） ----------
  { id: 'plTranslate', pg: 'plugins', grp: '内置插件', label: '双语翻译', desc: '翻译用什么、六个引擎排顺序、试一句、默认怎么翻', kw: '翻译 插件 双语 引擎 DeepSeek 术语表' },
  { id: 'plBook', pg: 'plugins', grp: '内置插件', label: '书签管家', desc: '新网页标签是它；收藏、标签、备注', kw: '书签 插件 BookmarkKeeper' },
  { id: 'plWeread', pg: 'plugins', grp: '内置插件', label: '微信读书', desc: '划线插进开着的文档；划线和想法同步进「阅读」', kw: '微信读书 插件 划线' },
  { id: 'plAd', pg: 'plugins', grp: '内置插件', label: '拦广告', desc: '规则、现在更新、不拦的网站', kw: '广告 插件 拦截 EasyList' },
  // ---------- 快捷键 ----------
  { id: 'kQuick', pg: 'keys', grp: '全局', label: '速记', desc: '在任何软件里都能按', kw: '快捷键 速记' },
  { id: 'k-cmd-ask-ai', pg: 'keys', grp: '命令', label: '打开 / 关上AI', desc: '在网页里也能按', kw: '快捷键 AI' },
  { id: 'k-cmd-new-note', pg: 'keys', grp: '命令', label: '新建笔记', desc: '', kw: '快捷键 新建' },
  { id: 'kSnap', pg: 'keys', grp: '看视频时', label: '记下这一刻', desc: '视频页', kw: '快捷键 视频 截图' },
  { id: 'kBox', pg: 'keys', grp: '看视频时', label: '框一块问', desc: '视频页', kw: '快捷键 视频 框 问' },
  // ---------- 高级 ----------
  { id: 'cfgDir', pg: 'advanced', grp: '这台Mac上的东西', label: '软件设置目录', desc: '设置、对话截图、意思索引', kw: '设置文件 目录 位置' },
]

const PAGE_NAME = new Map(SETTINGS_PAGES.map((p) => [p.id, p.name]))
const BY_ID = new Map(SETTINGS_ITEMS.map((i) => [i.id, i]))

/** 这一项在哪一页；没有这一项给 null */
export const pageOf = (id: string): SettingsPageId | null => BY_ID.get(id)?.pg ?? null
export const settingsItem = (id: string): SettingsItem | null => BY_ID.get(id) ?? null

/** 搜设置：每个词都要打中（名字、说明、别的叫法、组名、页名）；名字里有 3 分、别的叫法里有 2 分、组名里有 1 分，分高的在前，同分照表里的顺序 */
export function searchSettings(query: string): SettingsItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const words = q.split(/\s+/)
  const hits: [number, SettingsItem][] = []
  for (const it of SETTINGS_ITEMS) {
    const hay = [it.label, it.desc ?? '', it.kw ?? '', it.grp, PAGE_NAME.get(it.pg) ?? ''].join(' ').toLowerCase()
    if (!words.every((w) => hay.includes(w))) continue
    const score = (it.label.toLowerCase().includes(q) ? 3 : 0) + ((it.kw ?? '').toLowerCase().includes(q) ? 2 : 0) + (it.grp.toLowerCase().includes(q) ? 1 : 0)
    hits.push([score, it])
  }
  return hits.sort((a, b) => b[0] - a[0]).map((h) => h[1])
}
