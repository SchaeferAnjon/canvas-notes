# Canvas Notes 开发说明

Canvas Notes（画布笔记）的代码结构、命令、测试和发版。给用户看的介绍在 [README.zh-CN.md](../README.zh-CN.md)。产品上的决定在 `docs/HANDOFF.md`（私有仓库里），界面规范在 `DESIGN.md`。

名字、Bundle ID、仓库、官网网址、许可证只写在 `release/brand.json` 一处：改了以后跑 `node scripts/brand.mjs`，它生成 `apps/notes/src/shared/brand.ts`、改两个 package.json，把 README、官网、待执行清单里的旧值换掉；`node scripts/brand.mjs --check` 只检查（单元测试里也跑）。打包配置 `apps/notes/electron-builder.cjs` 和发版脚本直接读它。设置目录 `~/Library/Application Support/canvas-notes`、库里的 `.canvas-notes/` 是内部标识，不跟着名字换（换了用户的设置和首页会丢）。

## 结构

```
packages/design   颜色、字号、组件（起点是 MeetCaption v3 的 tokens.css / ui.css）
packages/format   md 读写、三方合并（不依赖 Electron）
packages/git      调系统 git
apps/notes        笔记软件（Electron + React + TypeScript，electron-vite 构建）
```

## 命令

```
pnpm install
pnpm dev          # 开发：打开窗口，选一个文件夹当库；CN_VAULT=<文件夹> 可以直接指定
pnpm test         # 单元测试（Vitest）
pnpm test:e2e     # 端到端测试：构建后用 Playwright 驱动真的 Electron 窗口
pnpm typecheck
pnpm --filter @cn/notes dist:mac   # 打一个本机用的 .app（本地签名，不公证）：apps/notes/release/mac-arm64/Canvas Notes.app
```

## 第一版有什么

- 库：一个文件夹，里面是 md 文件，自动建 Git。这台 Mac 上 git 没有署名（全局、库里都没设，新 Mac 常见）时，打开库就给这个库设一个（`main/git-identity.ts`：名字是 macOS 用户全名，邮箱 `<用户名>@<电脑名>.local`），设置 › Git和同步「提交署名」能改（只改库里的 .git/config）；提交失败的 git 原话由 `shared/git-errors.ts` 的 `commitErrorText` 换成中文原因。`收件箱/` 放新东西，`素材/<主题>/` 放剪来的，其余是「我写的」；frontmatter 里 `type: board` 的是白板。
- 文档：实时预览（光标所在行露出 md 原文）和「源文件」；⌘N 新建（默认进 `收件箱/`；目录树里点过的文件夹、开着的文件夹首页优先），第一行标题就是文件名（`renderer/title-follow.ts`），标题下「所在文件夹 ▾」能挪走（`renderer/folder-chip.ts`），点标签改名（别处的 `[[旧名]]` 一起改），⌘ 点双链打开；自动保存，内容没变不写盘。存的时候原来的文件不在了（外面删了、挪走了认不出去哪），字存回原来的位置（文件夹没了也建回来），提示一句；写不进去（被锁成只读、盘满了）时另存一篇「<名字>（没存上的字 hh-mm）」在旁边（`vault.rescue`，再失败覆盖同一篇），提示条带「打开另存的」，标签上红点「没存上」，底栏红点「N篇没存上」代替「都提交了」，退出时 quit.log 记「没存好：…」不记「存完」。
  - 编辑器的几块（`src/renderer/`，都只加装饰不改文字，「打开再保存不变」不受影响；样子见 `DESIGN.v3.md` 6.5）：`live-preview.ts` 藏记号（只在光标停着、没有选区时露那一处；链接网址收成域名小块；提示块 `[!type]`、「我的评价」弯钩、高亮 `==字==`），`fold-block.ts` 折叠块 `<details>` 和能收起的提示块（跨行替换只能放 StateField），`callout.ts` 提示块类型和图标（白板 / AI 回答的 `md-render.tsx` 也用），`atomic-blocks.ts` 画成卡片的整块（退格先选中），`insert-flash.ts` 插进文档（`NoteDoc.insertAtCursor`：插在这一段后面、光标落到下面新的空段落、左边一道竖线），`insert-point.ts` 系统选区 + 没焦点时的插入点，`doc-keys.ts` 回车 / Tab，`highlight.ts` 高亮 ⇧⌘M，`doc-toc.tsx` 右边目录条和宽版，`base/` 数据库代码块（解析和排序在 `packages/format/src/base.ts`）。块部件一律不用上下外边距（CodeMirror 量高度不算，点击会落到下一行）。
  - 文档切到白板（`src/renderer/doc-board/`）：规则和回写都是 `packages/format/src/doc-board.ts` 的纯函数（`splitDoc`、`moveUnit`、`placeUnit`、`unplaceUnit`、`resetLayout`，规则文字 `DOC_BOARD_RULES` 也给 `/整理当前白板` 用）；`type: board` 的白板和导图还是 `BoardView.tsx`。
  - 图片附件按文档存 `附件/<笔记路径>/`（`packages/format/src/attachments.ts`），剪贴板截图叫「截图 N」；`Vault.rename` / `move` 时 `carryAttachments` 挪文件夹、改链接。老的 `附件/*.png` 不自动挪。
- 文件夹：新建（放 `.gitkeep`）、改名（库里写着旧路径的相对链接、带路径的双链、置顶、本机记着的读 PDF 进度一起换，`packages/format` 的 `remapLinks`）、移到废纸篓，都在 `src/main/folder-ops.ts`，各一次提交。空文件夹能在目录树里看到是因为 `main/files.ts` 本来就列文件夹；`.gitkeep` 只是给 Git 的。
- 白板：双击空白处加卡片，左边工具板加待办、列、子白板；拖卡片挪位置、拖进列；卡片右边的小圆点拖到另一张卡上连线；选中按删除键删；⌘Z 撤销；右上「未整理」里是这篇没放进卡片的段落和收件箱，拖上白板。
- 网页（右栏）：选中一段，白板标签里「剪成卡片 · 到：收件箱」，文档标签里「剪进文档」插到光标处，⌘↵ 等于点它（网页预加载 `preload/webview.ts` 在捕获阶段接，焦点在网页自己的输入框里时不拦）；地址栏右边「⋯」里「导入 Chrome 登录」一键导入 Chrome 的登录（macOS 会问一次钥匙串）。
  - 右上按钮分两组：标签条最右只有 +（新网页，标签多了横着滚它不动；没有收起网页的 ×）；地址栏里只有双语翻译（图标 + 小箭头），网址不在打字时只显示域名和路径；右边是剪藏、固定的 Chrome 插件按钮（最多 2 个）和「⋯」（稍后再看、双语翻译、在 <网站> 不拦广告、加书签、新网页标签、书签和历史、插件、导入 Chrome 登录）。右栏的弹层都在 `WebPanel` 一处收起：点外面、按 Esc，以及点网页正文、在网页里按 Esc（网页预加载报 `cn:page-down` / `cn:page-esc`，`web/page-outside.ts` 转成一个窗口事件，书签栏的文件夹菜单也听它）。
  - 多标签：⌘T 新网页，网页焦点时 ⌘W 关网页标签，⌘L 到地址栏；新窗口链接开成新标签；标签记在本机，每个中间栏标签记住自己看的网页。标题栏最右「收起右栏」左边的「移到中间」把网页开成中间栏的一个宽标签读，右栏还有别的网页就显示别的，没有了就收起；看着宽标签时同一个位置是「放回右栏」（`Shell.tsx` 的 `TitleBar` 的 `web`，App 算现在看的网页在哪）。别处开网址时可以带 `reuse`（网站的 origin）：已经开着这个网站的标签就切过去（`web-tabs.ts` 的 `openOrSwitch`）。
  - 书签和历史：「⋯ › 加书签」是书签唯一的入口（书签管家开着时点一下就收藏并在「⋯」下面弹出这一页的小卡；收藏过的这一项写「已收藏 · 改标签和备注」：标题、标签、备注、文件夹，底下「整理全部书签」），书签栏摆书签栏里的书签，文件夹点开是菜单；「⋯ › 书签和历史」里按文件夹看、删、搜历史，「从 Chrome 导入」按 Chrome 用户导书签和历史。存在软件设置目录（`userData/web/`），不进库。
  - 新网页标签（⌘T 或标签条的 +，书签管家开着时）跑用户自己的开源插件 BookmarkKeeper（MIT，github.com/SchaeferAnjon/bookmark）的新标签页，不另做一个长得像的（网页预加载往页面里加一段样式，把它的颜色换成当前主题的、修右栏窄宽的排版，`shared/ext-theme.ts`）：主进程用 `cn-ext://bookmarkkeeper/` 提供它的文件，网页预加载（`src/preload/ext-page.ts`）给它补上 `chrome.*`，实事在 `src/main/web/bookmarkkeeper/`：
    - 插件文件只用包里自带的 `apps/notes/resources/bookmarkkeeper/`（打包时 `extraResources` 带上；测试可用 `CN_BOOKMARKKEEPER_DIR` 换）。这份是软件自己的一部分（2026-11-17 用户定，CN-34）：新标签页的字全是中文（问候、日期和首页同一套，不跟浏览器的语言），问候区下面的留白改小，直接改在这份文件里，改了什么记在它的 `SOURCE.json`。不再先找 Chrome 里装的或 `~/Documents/Projects/bookmark` 的源码；原来整份拷进来的 `scripts/vendor-bookmarkkeeper.mjs` 删了（会盖掉我们的改动）。上游有新版本时手动对着合，别整份覆盖。
    - `chrome.bookmarks` 接内置书签表（`bookmark-tree.ts`：路径摆成 0 根 / 1 书签栏 / 2 其他书签 / 3 移动设备书签，文件夹 id 由路径算，空文件夹记在 `userData/web/folders.json`，挪动的先后记在书签的 `order` 上）；`chrome.tabs` 是右栏的网页标签和中间栏的宽网页标签（界面报给主进程）；`chrome.storage` 存在 `userData/web/bookmarkkeeper/storage.json`；跨域 `fetch`（失效链接检测、AI 整理）由主进程用内置浏览器的分区发；`_favicon/` 给网站图标（`favicon-source.ts`，CN-33）：按 内置浏览器里网页报过的（记在 `userData/web/icons.json`）→ Chrome 自己的图标库（各个用户的 `Favicons`，拷到临时目录读，先按网址再按网站；测试实例没给 `CN_CHROME_ROOT` 时不读）→ 网页 HTML 里的 `<link rel=icon>`、apple-touch-icon → `/favicon.ico` 找，每一张都验（PNG / GIF / JPEG 至少 16×16，ICO 看目录，SVG 直接收，登录页的 HTML、1×1 透明图不算），都不行是地球。
    - 快捷书签：插件的 `sendNativeMessage` 由 `quick-store.ts` 回答，和它 Mac App 里 BKCore 的格式一样：iCloud 容器 `~/Library/Mobile Documents/iCloud~io~github~schaeferanjon~BookmarkKeeper/QuickLinks/` 里每个写入方一个 JSON，我们写 `mac-<这台 Mac 的标识>-canvasnotes.json`（标识和 BKCore 一样由硬件 UUID 算，同一台 Mac 上和 `-chrome`、`-safari` 前缀相同），读的时候合并全部，所以和 Chrome、Safari、别的 Mac 是同一份。容器不在（iCloud 云盘没开、没装过 App）就存 `userData/web/bookmarkkeeper/QuickLinks/`，页面上插件自己说「只保存在这台 Mac 上」；容器出现后本机的并进去。测试用 `CN_ICLOUD_CONTAINER` 指到临时目录。
    - 「⋯ › 稍后再看」放进插件自己的「稍后再看」（它的 `storage.local.deferred`）。没找到插件文件时新网页标签是一句说明。
  - Chrome 插件：「⋯ › 插件」里「从 Chrome 导入」把 Chrome 某个用户装的插件拷一份到 `userData/web/extensions/` 再加载（Chrome 那边不动），能开关、移除，每个插件写着能不能用、缺哪些接口；有按钮的插件点图钉固定到地址栏右边（最多 2 个，记在本机），点开是它的弹窗。Electron 只有一部分 Chrome 插件接口，拦广告、用户脚本、要和电脑上配套程序通信的插件多半用不了。
  - 拦广告（第四个内置插件，`main/plugins/adblock/`、`renderer/plugins/adblock/`、`shared/plugins/adblock.ts`，CN-51）：Chrome 的 AdBlock 是 Manifest V3 靠 `declarativeNetRequest`，Electron 没有，所以用 Ghostery 的引擎 `@ghostery/adblocker-electron`（Mozilla 公共许可证 2.0，写在 dependencies，原样放进包里的 node_modules，因为它的网页预加载要按文件路径注册）。挂在 `persist:web` 分区上：`webRequest` 的 onBeforeRequest / onHeadersReceived 交给引擎，分区注册它的网页预加载藏广告位；插件关着、网页在「不拦」名单里（`⋯ › 在 <网站> 不拦广告`，子域名也算）时放行，开关不用重开软件（`PluginHost.enabled()`）。规则 EasyList + EasyPrivacy，编好的引擎存在 `userData/plugins/adblock/engine.bin`，超过一周才重新取，取不到用旧的；什么时候取：网页里第一次去网站时（开软件只读存着的，用户没去任何网站就不对外连，第 4 轮），手里一条规则都没有时第一个网站等规则最多 3 秒（所有请求共用这一个点，2026-11-17 用户定）：取回来了第一页就拦，没取回来先放行这一页、这一页都不拦，下一页再用规则；等的时候地址栏留着打的网址、重新载入图标转着（`WebPanel.tsx` 的 `going`）。取规则失败后 10 分钟内网页不等，之后去网站时在后台重取（一条都没有时隔一分钟最多一次，有旧的隔一小时）。软件自带的新标签页（`resources/bookmarkkeeper/newtab`）只用本机字体，不连外网。防回归：`e2e/r4-read-ai.spec.ts` 用记账代理（`e2e/net.ts`）数开软件、开右栏网页、新网页、设置每一页的对外请求，要是 0。注意 Electron 每个事件只能挂一个 webRequest 监听，别处要用 `persist:web` 的 webRequest 得和这里合到一起。测试：`CN_ADBLOCK_LISTS` 指到本机的假规则，`CN_ADBLOCK_RESOURCES` 换掉引擎另外要取的 raw.githubusercontent.com 上的 resources.json；测试实例没给时不联网取规则。规则慢、一直不回：`e2e/r5-read-ai.spec.ts`。
  - 双语翻译（内置插件，`main/plugins/translate/`、`preload/plugins/translate.ts`、`renderer/plugins/translate/`）：地址栏里开关 + 小箭头菜单（语言、对照 / 只看译文、七种样式、术语表、「整页剪藏带上译文」），设置 › 插件 › 双语翻译里「翻译用什么」。引擎按设置「自动」（Claude Code → Codex → Gemini → OpenCode → DeepSeek → 智谱，用不了的换下一个）或「指定一个」；API 只给翻译用（OpenAI 兼容 chat/completions，流式），Key 用 Electron safeStorage 加密存在插件文件夹、加密钥匙在钥匙串，界面只拿到最后 4 位。没翻成分 11 种原因（`errors.ts`），一个能用的都没有时一开就说。课程术语表 `课程/<课>/术语表.md`（原文 | 译法 | 备注）：中间栏开着哪门课就照哪门课的表，这批出现的词进提示和缓存键；没有表时 AI 读课程里的笔记、PDF（PDFKit 取字）和当前网页起个头，一次提交。别处（PDF 对照读）用 `translateService().translateBlocks()`（主进程）或 `renderer/plugins/translate/api.ts` 的 `translateBlocks`：一串块进、一块块译文出，同一个缓存和设置。
    - 测试：`CN_AI_FAKE=1` 时命令行是假的，`CN_TR_FAKE_CLI=claude=login,codex=missing` 定状态，`CN_TR_FAKE_FAIL=claude=<原话>` 让它出错；`CN_TR_API_BASE_DEEPSEEK` / `CN_TR_API_BASE_ZHIPU` 指到本机假的 OpenAI 兼容服务；测试实例（`CN_E2E=1`）的 Key 只放内存，不碰钥匙串。
  - 看视频（设计 design-video 方向 A「视频条」；`main/video/`、`preload/video.ts`、`renderer/video/`、纯函数在 `shared/video.ts`）：右栏开到 YouTube（`/watch` `/shorts` `/live`）或 B 站（`/video/` `/list/`）的视频页，地址栏下面多一条视频条（字幕开关和菜单、记下这一刻 ⌥S、框一块问 ⌥D、记到哪）和一行时刻刻度。
    - 字幕：不自己拼地址（YouTube 要播放器算的 pot 校验，B 站接口要签名），用 `webContents.debugger` 的 Fetch 域读网页自己请求的回答（`main/web/tap.ts`）。YouTube 等播放器自己取一次字幕，照它带 pot 的地址换语言在网页里取；默认选视频说的那种语言的人工字幕，自动生成的按停顿断句。B 站从播放器接口 `x/player/wbi/v2` 读字幕列表，不登录时没有，菜单里说要登录。翻译交给双语翻译插件的 `translateService().translateBlocks`，先翻正在播的前后 2 分钟；「翻成」接受任何语言。字幕层画在 shadow DOM 里，不用 innerHTML（YouTube 有 Trusted Types）。B 站在右栏（窄于 1100）里注入 CSS 让播放器满宽。
    - 记到哪（`destFor`）：开着文档插到光标处（第一次先插视频卡），开着白板进这个视频的「时刻」列（`renderer/video/board.ts`，没有视频卡先放一张），开着字幕全文记进上一篇文档，中间没开文档就新建「收件箱/<视频标题>.md」开在中间（见下面「记到哪（2026-11-17 起）」）。每次一次提交（截图 + 文档），底部提示能撤回（反向提交）；视频这边的提交排队做（`serial`），撞上 index.lock 等一下再试（提交由 `@cn/git` 的 `commitPaths` / `commitAll` 自己等，撤回在 `main/git-retry.ts`）。截图 `附件/视频/<站>-<id>/<mm-ss>.jpg`，长边 1280。
    - md：时刻是 `<!-- moment video=youtube:<id> t=秒 -->` + 截图 + 带时间的链接 + 前后几行 `> 时间 原文 / 译文`（当前那行加粗）；问过 AI 的是 `<!-- moment-ask … -->`；文档里的视频卡前面一行 `<!-- video video=… -->`。文档模式画成卡片（`renderer/video/doc-widgets.ts`），白板上 `CardBody` 认 `video` 和 `moment`（光秃秃的 YouTube / B 站链接也画成视频卡，标题、封面从 oEmbed / B 站接口取）。
    - 框一块问：画面上拖框，截这一帧画上框，连同前后 30 秒字幕和当前文档问 Claude Code（`askWithImage`），不弹浮窗：文档光标处先出占位（`renderer/video/ask-pending.ts`，编辑器装饰，不写进 md；esc 停下走 `video:ask:stop`），答好原地换成问答块 + `[!ai]` 提示块（`@cn/format` 的 `aiCallout`），块下面空一段、光标停在那里；追问是问答块上「接着问」或 ⌘J，AI 开在右栏下格（`Center.askInRight`），也追加进同一个文件夹的「视频里的疑惑.md」（「我的疑惑.md」是读 PDF 那边重写的，不写它）。
    - 字幕全文：第一次拿到字幕就存「素材/视频/<视频标题>.md」（frontmatter `type: video`），翻完、AI 摘要（快模型，每条带时间链接）写好再更新；下次打开先用这篇里的译文。文档模式按章节收起（`renderer/video/material-fold.ts`）。
    - 本机记录 `userData/video/state.json`：设置（显示方式、放哪、快捷键）、每个视频看到哪一秒、选的字幕、时刻（刻度上画的）。快捷键 ⌥S / ⌥D 在设置 › 快捷键里改；⌥K / ⌥J / ⌥L 播放暂停和进退 5 秒，⌥A 在视频页上开关字幕。
    - 记到哪（2026-11-17 起）：中间没开文档（HTML、PDF、首页、什么都没开）时，新建「收件箱/<视频标题>.md」（属性「视频: <网址>」，已经有就用那篇）在中间开新标签再插，焦点还回视频；「记到」里明确选收件箱才只往那篇末尾追加。记到「未命名」「未命名 N」、这篇还没记过这个视频时，先改名成视频名、加属性「视频」（`renderer/video/dest.ts`）。梦游按视频卡、时刻、属性「视频」找同一视频散在两篇以上的，在「可能重复」里提醒合一篇。
    - 生成字幕（CN-69，`main/video/transcribe.ts` 核心、`main/video/stt.ts` 接进来）：内置 yt-dlp（`scripts/fetch-ytdlp.mjs` 钉版本和 sha256 下到 `resources/bin/yt-dlp`，postinstall 跑，打包 extraResources 带进 `Resources/bin/`）只下音频 → Soniox 异步接口（`stt-async-v6`，上传、建转写、等、取结果、删云端）→ 断句 → 存 `.canvas-notes/字幕/<站>-<视频号>.vtt` 一次提交 → 当一条「…（听写 · Soniox）」轨选上，后面走原来的翻译；翻完把库里这个视频没字幕的时刻块补上原文和译文（`fillMoments`，一次提交）。密钥在设置 › AI，和翻译插件的 Key 一样用 safeStorage 加密存在 `userData/stt/keys.json`；没填时用环境变量 SONIOX_API_KEY（测试实例不用，除非指了假服务或 `CN_REAL_STT=1`）。B 站把右栏的登录写成临时 cookies.txt 给 yt-dlp。
    - 测试：`CN_YTDLP` 指到假的 yt-dlp（`e2e/fixtures/fake-ytdlp.mjs`），`CN_SONIOX_BASE` 指到本机假 Soniox（`e2e/fixtures/fake-soniox.ts`）；真跑一次：`CN_REAL_STT=1 npx vitest run apps/notes/test/real-stt.test.ts`（19 秒的公开视频，约 $0.0005）。
    - 测试：`CN_VIDEO_TEST_ORIGIN` 把本机的假视频站（`e2e/fixtures/fake-video.ts`）当成 YouTube；真网站只读验证 `CN_REAL_VIDEO=1 npx playwright test e2e/real-video.spec.ts`（YouTube 看到 `navigator.webdriver` 就给空字幕，测试里用 `CN_E2E_ARGS=--disable-blink-features=AutomationControlled`，真软件没有这个标记）。`CN_VIDEO_LOG=<文件>` 记下拿字幕的每一步。
  - 微信读书（第三个内置插件，`main/plugins/weread/`、`preload/plugins/weread.ts`、`renderer/plugins/weread/`、`shared/plugins/weread.ts`）：右栏读 weread.qq.com，用它自带的划线；阅读页的书先按地址认（`/web/reader/<书的编号编出来的那串>`，`readerCode` / `bookIdOfReader`；真网站上 `__INITIAL_STATE__` 报的会是别的书），认不出再用网页的 `__INITIAL_STATE__`，拦到「划线」的请求（`/web/book/addBookmark`）或者网页里松开鼠标 1.5 秒后，去网页版接口 `weread.qq.com/web/book/bookmarklist`（带着右栏网页里的登录，和 obsidian-weread-plugin 一样；以前问的手机 App 接口 `i.weread.qq.com` 不认网页的 cookie，回 -2012，划线不插、设置里一直「没登录」，CN-37、CN-53）取这本书的划线，和见过的比，新的插进左边开着的文档光标处（`> 原文` + `—— [《书名》 · 章节](阅读页)`，和剪进文档同一个写法），右下角一行「已加到《…》」；打开书那一次没取成时不记「见过的」，下一次划线把 2 分钟内新建的当成新的（`marksToInsert`）；插不进去时右下角说原因（没登录 · 去登录、没认出这本书、左边没开文档）。登录：右栏 `persist:web` 里的 `wr_vid`、`wr_skey`；接口前先 HEAD 一次网站续 cookie（十分钟一次，打开软件时登录过才续），回 -2012 / 401 就再续一次重问；cookie 一变（`session.cookies` 的 changed）马上重查推给设置页。设置里登录一块：已登录（昵称从 `/web/user` 取）、同步数、上次同步、「现在同步」；没登录是「在右栏打开登录」（B 的设置弹窗同时关掉）。右竖条「网页」下面一格「微信读书」（插件清单的 `entry`，`renderer/plugins` 的 `usePluginEntries`；插件关着时没有）打开书架，已经开着微信读书就切过去，亮着时再点收起右栏。每本书的划线、想法、书评同步成「素材/微信读书/<书名>.md」，一本一次提交；设置 › 插件 › 微信读书里开关、同步状态、上次同步时间、「现在同步」（`/api/user/notebook` 里动过的书）。只读微信读书。测试：`CN_WEREAD_ORIGIN` 指到本机的假微信读书（`e2e/fixtures/fake-weread.ts`：阅读页、扫码登录页、书架、网页版接口认 `wr_skey`、HEAD 换新 cookie；手机 App 那套接口一律 -2012），`CN_WEREAD_API` 只换接口。真账号只读验证：`CN_REAL_WEREAD=1 npx playwright test e2e/real-weread.spec.ts`（用「导入 Chrome 登录」把 Chrome 的登录导进临时实例，macOS 会问一次钥匙串；`CN_REAL_CHROME_PROFILE` 指定 Chrome 用户；不新划线、不改账号，测完删临时目录）。
  - 整页剪藏：剪刀按钮把当前网页的正文（Readability 抽正文、Turndown 转 md）存成收件箱里新的一篇，带 created 和 source，单独一次提交，能撤回；AI 的 /剪藏当前网页 调同一个 `window.cn.clipCurrentPage`。
  - 图片：网页里的图片直接拖到白板上变成图片卡（带来源），访达里的图片拖进来、剪贴板里的图片粘贴进来也行；拖进文档插 `![说明](附件/…)`。图片存在库里的 `附件/`，界面用主线的只读 `cn-file://` 看库里的图。
- 拍手写导图（设计稿 design-mindmap 方向 B「先核对再放」+ A 的长出来动画）：⌘K「拍一张导图」、菜单「文件 › 拍一张导图」（⇧⌘C）、白板工具板「拍导图」（拖到白板上时，做好后落点放一张指向它的卡片）打开三步窗口 ① 拍 ② 核对 ③ 放上白板。
  - 拍：iPhone（连续互通相机）/ Mac 摄像头 / 桌上视角，空格拍；也能拖进来、⌘V 粘贴、「从照片选…」、隔空投送（窗口开着时看「下载」里新来的照片，测试用 `CN_AIRDROP_DIR`）。HEIC 用系统的 `sips` 转 JPEG。桌上视角 2026-11-16 在 M3 Max 上实测：Mac 自带摄像头没有；iPhone 连着时系统有「Desk View Camera」，但 Electron 的 getUserMedia 列不出它，所以窗口里照实说、请用 iPhone 拍。
  - 认：Claude Code 看照片（`claude -p --input-format stream-json`，消息里带 base64 的图，不给任何工具，`src/main/mindmap/vision.ts`），回一棵树、每个节点在照片上的框、拿不准的和猜的写法、课程和第几讲。模型按设置 › AI 的「看图问」（`agent/index.ts` 的 `visionModel`），`CN_MAP_MODEL` 能换；`CN_AI_FAKE=1` 时用 `src/main/mindmap/fake.ts` 的固定回答。真认一次的测试：`CN_REAL_VISION=1 npx vitest run apps/notes/test/real-vision.test.ts`、`CN_REAL_AI=1 npx playwright test e2e/real-mindmap.spec.ts`（Haiku 约 9 秒）。
  - 核对：左边照片框出每个节点（拿不准的黄框），右边大纲直接改、Tab 缩进、回车加一行。
  - 放上白板：照片进 `附件/导图/2026-11-15-2140.jpg`，`收件箱/导图 11-15 21∶40.md`（冒号换成长得一样的「∶」）是一块 `白板样式: 导图` 的白板，一次提交；属性当场写好（类型: 导图、课程、第几讲、来源、日期，AI 认的记在 `AI填的:`），不挪不改名，归类改名留给梦游。打开时节点按中心 → 第一层 → 第二层一个个长出来。
  - 导图白板（`packages/format/src/mindmap.ts`、`src/shared/mindmap-layout.ts`、`src/renderer/mindmap/MindmapLayer.tsx`）：正文里的嵌套列表就是导图，打开文档就是大纲；行尾注释 `<!-- box=x,y,w,h unsure guesses="a|b" -->` 记照片上的框（文档视图里藏起来）。XMind 逻辑图那样往右排，原照片卡在左边；选中节点照片上框出那一块；拿不准的点「?」对照照片改；Tab 子节点、回车同级、⌫ 删、双击改字、空格收起、方向键走、拖到别的节点上换父节点、⌘Z。改一个节点只重写那一行。
  - 属性（`packages/format/src/props.ts`、`src/renderer/mindmap/PropsButton.tsx`、`props-block.ts`）：工具栏「属性」按钮开 320 宽小弹层（类型、课程下拉，别的直接改，「+ 加一个属性」）；文档视图里有属性时 frontmatter 原文藏起来，标题下面一张表，点一行露出原文。用户改过的属性从 `AI填的` 里去掉。
- 右键菜单（每处有哪几项见 `DESIGN.v3.md` 第 9 节）：一律系统原生菜单，都从 `src/main/ctx-menu.ts` 的 `popup()` 弹，开着的记下来、退出时全收起（不然退出卡在菜单循环里）。界面用 `src/renderer/ctx/menu.ts` 的 `menuAt(e, [...])` 列出要哪几项（每项带点了做什么）；输入框和网页里选的字没人接管时，主进程兜底给标准编辑菜单（带拼写建议）；右栏网页里的右键由主进程转给界面（`ctx/web-menu.ts`）。要用到整个软件的动作（开标签、问 AI、通知）走 `ctx/actions.ts`。端到端测试用 `e2e/menu.ts` 读菜单、点其中一项。
- 对比标签（2026-11-17，CN-48 方向 A；`renderer/diff/DiffTab.tsx`、`main/diff.ts`、纯函数在 `shared/diff.ts`）：历史里单击文件、梦游报告里点一处改动、可能重复点「两篇并排看」都开它；标签类型 `diff`（来源：提交号 / 某次提交的一个文件 / 梦游条目 id / 两个文件），没 `pinned` 的是预览标签。两版全文都用 `git show <rev>:<path>` 读（挪走、删了也读得到），`git diff -U0` 拆出片段只用来拼那句人话；对比用 `@codemirror/merge`（MIT）的 `MergeView` / `unifiedMergeView`，`collapseUnchanged { margin: 3, minSize: 6 }`，文档看法挂编辑器的实时预览。IPC 是 `diff:files`（接在 `dream-main.ts`，梦游的要报告）。梦游动手时把每个文件改了什么记在条目的 `changes`。
- Git 底栏：未提交的文件、提交、同步（先提交，再拉，再推）、历史。没提交的改动按设置里的间隔自动提交（默认每 10 分钟，可关），退出和换库前也会提交。
- 左栏按维度组织（2026-11-17，`DESIGN.v3.md` 1.7）：活动栏「文件」（`renderer/files/FileTree.tsx`，树怎么拼、六种排序、篇数、置顶、类型筛选在 `shared/files.ts` 的 `buildTree`）、「最近」（`Sidebar.tsx` 的 `RecentSide`，分组在 `shared/recent.ts`：置顶、今天、这周、按月收起，每组先列 100 篇），分隔线下面是摘出来的文件夹（默认课程、收件箱；摘了哪些、文件夹的图标和颜色存在库里 `.canvas-notes/左栏.json`，`shared/left.ts` 纯函数、`main/left.ts` 读写、`renderer/files/left-store.ts` 界面那份；文件夹改名、挪、删时 `folder-ops.ts` 跟着改它）。类型筛选 `renderer/files/type-filter.tsx`；「设图标和颜色…」弹层 `renderer/files/look.tsx`（整套 Codicons 在 `@cn/design/codicons-all`，用到才加载）。中间的「最近」整页 `RecentPage.tsx`（原来的「全部笔记」）；每个文件夹都有首页，下半截「里面有什么」是 `folder-home/FolderContent.tsx`。底部「归档 · N 篇」打开可筛选、按修改时间排、虚拟滚动的长列表。
  - 附件（`DESIGN.v3.md` 1.8）：一篇的图在 `附件/<笔记路径>/`；文中用到哪些、在哪一节是 `packages/format` 的 `imageRefs`，别的笔记在不在用是 `linkedPaths`；列出、连图一起删、撤回在 `main/note-attach.ts`（撤回靠删前在 userData/trash-undo/ 留的一份，重开清掉），界面是 `renderer/TrashDialog.tsx` 和 `renderer/PropsAttach.tsx`。
  - 置顶：左栏或列表里右键「置顶 / 取消置顶」，存在库里 `.canvas-notes/置顶.json`（跟着 Git 走；文件夹写成「写作/」），改名、挪走、删掉时跟着变。
  - 自动归档：默认 90 天没改过的笔记算归档，只是左栏不显示，文件不挪、内容不改；置顶的和收件箱不归档；一编辑修改时间变了就回到左栏。天数在设置 › 库 里改（30 / 60 / 90 / 180 天 / 不自动归档），存在 `userData/settings.json`。
  - 收件箱超过 20 条：左栏计数和首页收件箱组件变成琥珀色提醒，多一个「让 AI 分一分」（跑 /整理收件箱）。
  - 大库：主进程按修改时间和大小缓存每篇的说明，没变的不再读；读到的全文顺手进搜索缓存。7000 篇的测试库（`node apps/notes/e2e/fixtures/big-vault.ts <文件夹>` 能造一个）启动到左栏出来约 1.3 秒，切到「文件」树约 0.3 秒，打开几百篇的文件夹首页约 60 毫秒，打开中间的「最近」约 40 毫秒，再列一次约 60 毫秒，⌘F 打字到出结果约 0.3 秒（`e2e/step10-archive.spec.ts` 量）。
- 梦游的归类和改名（`src/main/dream.ts`、`dream-file.ts`，设计稿 design-mindmap 方向 B 第 7、8 节）：梦游在 `dream/MM-DD` 分支上把收件箱里的东西挪进 `课程/<课>/`、`项目/<项目>/`、`生活/`、`写作/`、`素材/<主题>/`，顺手起好名字；开头的标题、相对链接（图片、附件）、别的笔记里指向它的 `[[旧名]]` 在同一个提交里跟着改，提交前逐个核对（挪的源头在收件箱、别处只多了换名的双链）。AI 拿不准的留在收件箱，报告里一行「N 条留着不动」。
  - 报告里「归类和改名」按去处分小组，每条写新名字和「从 收件箱 挪来 · 原名 …」；点开看为什么、挪到哪、改名，「收下」「丢掉」都是次按钮（一屏一个主按钮留给预览条）。超过 12 条（导入旧笔记）只列组、默认收起，组里搜索加 5 条。
  - 「预览」：左栏和「最近」换成改好后的样子（`src/shared/dream-preview.ts`，只按路径换，不切工作目录），挪来的行标「新」、悬停能收下或丢掉这一处，收件箱原来的位置留划掉的影子「挪到 …」；中间栏顶上预览条：跟 AI 说哪里不对、退出预览（esc）、丢掉、收下这 N 处。以后的目录树和文件夹首页接 `useDreamPreview` 的 `preview.notes` / `marks` 就行。
  - 收下几条（一组、预览条、全部收下）= `cherry-pick --no-commit` 合成一次提交；底部提示带「撤回」（反向提交，这几条回到待看；分支删了提交还在，照样能再收下）。丢掉也能撤回。单条收下、一组、全部收下、撤回都走同一条「开着的那篇跟过去」（第 5 轮：全部收下时同一篇又挪又补双链，标签留在旧路径、打的字丢了）：`dream-main.ts` 的 `act` 把 git 这一步放进库的写队列（`vault.exclusive`，编辑器要存的字等着），做完按每条前后的状态（`dream.ts` 的 `movesOf`）算出挪了哪几篇，`vault.followOwnMove` 把旧路径上的写转到新路径，再发 `note:renamed`（带「软件自己挪的」）和新路径上的新内容；编辑器马上换路径（`NoteDoc.follow`）、按外部改动合并新内容，不说「在外面」。撤回时那篇在外面改了名又添了字（git 认不出改名）：看那次以后新出现的文件里有没有一篇留着原来八成以上的行，有就说「改名成了…」。挪动不算改过：收下和撤回时，挪到的新位置的修改时间设回原来那个文件的，所以导进来的旧笔记（导入时修改时间就是原来的 updated）收下后直接进归档，不占「这周动过的」；之后在哪改过一次，修改时间照常变新。
  - 补双链、找重复（3-gram + MinHash）不在主进程算：交给 `src/main/similar/`（Electron utilityProcess，入口 `worker.ts`，构建出 `out/main/similar-worker.js`，每件活一个进程、算完就退），⌘K「找重复」也走它。找重复先在这个进程里把每篇的 3-gram 换成排好序的整数编号、算签名（7000 篇约 3 秒），再拆成最多 8 份交给几个线程（同一个文件里的 `runPart`，编号和签名放共享内存）一起比，两篇都有的那段用后缀自动机找（`@cn/format` 的 `commonPassage`，以前的逐格表一对 30 多毫秒、上万对就是 10 分钟）。7000 篇的测试库（`e2e/fixtures/big-vault.ts`，词表小、像的对特别多，18700 对）约 13 秒出完整结果（`e2e/r3-dups.spec.ts` 量）。算的时候每 0.3 秒报「已比 N/M 篇」和新找到的几对（`notes:dups-progress`），AI 浮窗边算边列，不占着对话（照样能发新问题）；「停下」（`notes:duplicates-stop`）直接结束那个进程。以前在主进程里一口气算，7000 篇的库闲时梦游一起来，⌘Q 要等 13–18 分钟才存字退出；现在退出时直接停掉（quit.log 记「停下找像的笔记 N 个」），下次梦游重算。`e2e/rule3-quit.spec.ts` 最后一条量（约 0.3 秒）。单元测试不给 `similar` 时在本进程算。
  - 跟 AI 说哪里不对：在同一个梦游分支上按这句话重做（每次一个新提交，收下时跟着合进来），变了的标「按你说的改了」；说留在收件箱的那条挪回去、算丢掉。分支已经删了的按报告里记的最后一次提交重建。
  - 大批量：收件箱一次问 40 条（`CN_DREAM_BATCH`），第一批开的新去处告诉后面几批，后面三批同时问（`CN_DREAM_PARALLEL`）；双链一晚最多补 30 处、可能重复最多列 20 对，挑最像的，剩下的报告里说一句。真 AI 测导入旧笔记的归类：`CN_REAL_DREAM=1 npx vitest run apps/notes/test/real-import-dream.test.ts`（40 条编的备忘录，`CN_REAL_EMPTY=1` 从空库开始）。
- 导入旧笔记（`src/main/import/`、`src/renderer/importer/`，task-ibu60）：⌘K「导入旧笔记…」、设置 › 库、菜单「文件 › 导入旧笔记…」打开三步窗口 ① 选来源 ② 选文件夹 ③ 导入。在主进程后台导，窗口关了中间栏底下一条小进度，导完提示带「撤回」；导好了能「现在就让梦游整理」。
  - 备忘录：直接读它的数据库 `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`（拷到临时目录再用 `node:sqlite` 读，只读），系统规定读别的软件的数据要人在打开面板里点一下那个文件夹（面板直接停在那里，按钮叫「允许读取」），不用自动化授权、不开备忘录。笔记内容是 gzip 过的 protobuf（`protobuf.ts` 自己解，字段号照 Obsidian Importer，见第三方声明）：勾选清单分勾没勾变 `- [x]` / `- [ ]`，标题、小标题、列表、编号、引用、等宽、粗斜体、删除线、链接都转；图片和附件从 `Accounts/<账号>/Media/` 拷，表格转成 md 表格，扫描的文稿每页一张图，手写只有它生成的那张预览图，标签和提到的人照字留下，笔记之间的链接变 `[[标题]]`。上锁的、最近删除里的不导；附件还在 iCloud 里没下到这台 Mac 的写进结果里「没导全的」。
  - Markdown 文件夹（旧的 Obsidian 库）：`.` 开头的文件夹不进；md 原样拷，属性只加不删；`![[图.png]]`、`[[文件.pdf]]` 和指向附件的相对链接改成指到新位置的普通链接，`[[子文件夹/笔记|别名]]` 只留名字（按名字找，挪到哪都能点）；没有笔记用到的附件也拷。
  - 写到哪：笔记进 `收件箱/导入/<来源>/<原文件夹>/`，图片和附件进 `附件/导入/<来源>/`（同一份内容只拷一次）；开头加 `created`、`updated`（原来的时间，文件修改时间也设成原来的）、`来源`、`原文件夹`（梦游归类时参考）、`import-id`（再导一次时认出来跳过）。全部写完一次提交，撤回是反向提交；导到一半停下，写过的都删掉。
  - 测试：`CN_NOTES_DIR` 指到测试造的备忘录数据文件夹（`e2e/fixtures/apple-notes.ts` 照真的表和 protobuf 造）、`CN_IMPORT_DIR` 指到要导的 md 文件夹，都不弹打开面板；`CN_IMPORT_DELAY_MS` 让每条慢一点好看进度。`e2e/step16-import-500.spec.ts` 导 500 条、梦游、预览、收下全部，量时间和预览时有没有长任务。
- 框架（第三版方向 A）：网页、梦游、历史三个开关竖排在窗口最右边，点开右栏、再点收起；搜索在左栏顶上（⌘F / ⌘K，三层；⌘O 按名字跳）；AI 只在中间栏右下角（读 PDF、打开 HTML、在网页上框着问时例外，在右栏下格）。
- 首页：两种样式（A 封面长图加组件网格，B 整页背景加玻璃组件），设置里切换；「编辑首页」能拖动、收起、放回、换大小，封面能换（8 张自带照片、4 种渐变、从电脑选）和调位置。首页设置存在库里 `.canvas-notes/首页.json`，跟着 Git 走；从电脑选的封面拷进 `附件/封面/`。样式 B 能勾「整页背景用窗口背景那张图」（设置 › 外观，存在这台电脑的设置 `appearance.homeWinBg`，不进库；`theme.ts` 的 `homeWinBg`），勾上时首页的 `--cover-img` 是窗口背景那张图（不用图时是 `--title` 纯色），首页里「换封面」变灰（CN-52）。
- 文件夹首页（`src/shared/folder-home.ts`、`src/main/folder-home.ts`、`src/renderer/folder-home/`，设计稿 design-mindmap 方向 B 第 9 节）：每门课 `课程/<课>/`、每个项目 `项目/<项目>/`、`生活/`、`写作/` 各有一页，复用主页的组件网格（`home.css`）。左栏「文件夹」一组列出它们（选了颜色的是 16 的颜色方块；最多露 5 行加「还有 N 个」，占的行从「这周动过的」里扣，左栏总行数不变），点了开首页标签；别处（以后的目录树、⌘K）调 `openFolderHome('课程/线性代数')`（`folder-home/store.ts`）。
  - 组件：课件进度（一排第一页封面，默认整行；封面由界面 pdf.js 画好交给 `main/slides.ts` 存在软件设置目录 `thumbs/`，按路径 + 修改时间，不进库；问到第几页读旁边那篇读 PDF 笔记的属性「进度」，封面底边一条细条；多了只列没读完的和最近读完的 3 份，最后一格虚线框；头上「接着读 … · 第 N 页」；从访达拖 PDF 到课程主页：`slides:import` 拷进这门课的文件夹（重名照访达加「 2」），底栏提示能撤回，不是 PDF 的不收）、今天要复习（还没接 Anki，显示空状态）、考试倒计时、笔记和导图（按条件列出的预设：类型是笔记或导图，头上「拍一张」）、我的疑惑（`reading:doubts` 那份按讲汇总的清单，最近一讲 3 条加按讲的 chip，点一条翻到 PDF 那页，「全部 N 条」开我的疑惑页）、可视化（文件夹里 HTML 的 `<meta name="类型" content="可视化">`，点了开 HTML 标签）、学习日历、待办、快捷链接、嵌一块白板、自由文本、最近改的、进度、日历、草稿、素材、按条件列出（列表 / 卡片墙 / 表格）。列表型的只露几条加「全部 N 份 · 打开列表看」。
  - 编辑首页：拖动、换宽、收起（进下面的抽屉）、删除（只从这页拿掉，文件不动）、加组件（860 × 600 窗口，收在抽屉里的同类直接放回来）、按条件列出改条件（900 × 600 窗口，右边真尺寸预览）、样式 A / B、换封面和调位置、图标和颜色（颜色也上左栏和标签）。「⋯」里设为课程 / 项目模板、恢复默认（有模板用模板）。删组件、恢复默认的提示带「撤回」（App 的提示条，`onNotice(text, undo)`）。
  - 存哪：每页 `<文件夹>/.首页.json`，模板 `课程/.首页模板.json`、`项目/.首页模板.json`，都跟着 Git 走；读的时候不认识的丢掉、少的补默认。写盘走 `src/main/atomic.ts`（先写临时文件再改名，同一个文件排队写，内容一样不写；主页的 `首页.json` 也用它）。封面从电脑选的照主页拷进 `附件/封面/`。
  - 左栏「文件夹」的 + 新建一门课：建 `课程/新的课程/`，开它的首页进编辑，标题是输入框，回车改名（文件夹还空着时才能改）。
  - 梦游预览开着时，挪进这个文件夹的标「新」，只在预览里才有的新课先出现在左栏。
- 设置（⌘,；A 风格开成中间的标签，B 是弹窗）：外观（十套主题画廊：薄荷、天青、樱花、丁香、石白 / 松林、深湖、可可、墨夜、石墨，变量在 `packages/design/src/themes.css`；导入 VS Code 主题 .json / .vsix，换算在 `src/shared/vscode-theme.ts`、存在 `userData/themes/`；跟着系统时白天、夜里各用哪套；界面风格 A / B；窗口背景；首页样式）、首页、库（换到别的文件夹、自动归档天数）、AI 默认引擎、Git（自动提交间隔、远程地址、现在同步）、快捷键。存在软件设置目录 `userData/settings.json`。
- AI（只在中间栏右下角，⌘J 开关）：头部选引擎（Claude Code、Codex、Gemini、OpenCode，用这台 Mac 上已登录的命令行，不另存密钥；改的是设置 › AI 的「AI 对话」那一行，`AgentStore.setChatEngine`，不动默认和梦游；设置一改主进程发 `ai:prefs:changed`，开着的浮窗、读 PDF 右栏马上换），库目录就是 AI 的工作目录；回答边生成边显示，对话记录存在软件设置目录（`userData/ai/`），关了再开还在。直接说话时 AI 能动手：网页（打开、读、点、输入、滚动、剪进收件箱）、白板（加卡片、改、挪、放进列、连线、按网格或按列排整齐）、文档（读、在光标处插入、替换选中）。每一轮 AI 改的文件是单独一次提交，浮窗里有改动预览和「撤回」。/ 命令：/整理收件箱、/总结这块白板、/写成文章、/翻译、/找重复、/剪藏当前网页、/现在梦游（后三条等对应功能接上）。
  - 怎么接的：软件起一个只听 127.0.0.1、带随机令牌的 MCP 服务（`src/main/agent/mcp-server.ts`），各家命令行接上它；AI 自己写文件、跑命令一律不许，改笔记只能走这些工具。
  - 测试：`CN_AI_FAKE=1` 用假引擎（按说的话走固定的工具调用）；`test/fixtures/` 里有假的 claude、codex app-server、ACP 命令行，单元测试用它们测各家的接法；`CN_AI_MODEL` 换 Claude 的模型，`CN_CODEX_MODEL` 换 Codex 的模型；`CN_FAKE_SAY_MS` 让假引擎吐字慢一点（每 4 个字隔多久，默认 25）。
- 读 PDF 边读边问（方向 A「右栏切换」，设计在 `design/pdf/`；第 1 段做了下面这些，第 2、3 段见后面，双语在第 4 段）：
  - 打开：⌘K 里按名字找到库里的 PDF，开成中间栏的 PDF 标签（`src/renderer/reading/PdfTab.tsx`，pdf.js 画页面和文字层，只画看得到的几页）；页码胶囊点了输入页码，「⋯」里放大、缩小、适合宽度、在访达中显示；记住每份看到哪页，重开时「回到上次看到的第 N 页」。
  - 框一块问：在页上拖一个框（在字上拖是选字，按住 ⌘ 在哪都框），框下面黑色工具条「讲解一下 ↵ / 翻译 + 讲一讲 / 改问法 / ×」，右栏 AI 输入框里已经放好截图、预填「给我讲解一下」并全选，回车就发；⌘↵ 或「问这一页」整页问；选中一段字问时截图换成引文。框的截图按 PDF 重新画（不受屏幕缩放影响），存进库的 `附件/<PDF 名>/`。
  - 右栏：读 PDF 时 AI 不在右下角浮着，在右栏下格；竖条最上面「AI」「笔记」二选一，再点收起；上格开着网页 / 梦游 / 历史时两格上下分。白板和文档页不变。
  - AI 怎么问（`src/main/reading/`）：每份 PDF 一个会话（Claude Code 不给工具但留会话，`--resume` 接着追问）；框的图作为图片给（Claude Code 是 `--input-format stream-json` 的 image 内容块，Codex 是 `localImage`，ACP 是 image 内容块，见 `engines.ts`）；这个会话第一次问时把整份 PDF 的文字一起给（AI 先读一遍），每次再附这一页的文字和笔记里已经弄懂的。
  - 全文：打开时后台用 pdf.js 一页页读出文字项和图的位置，`packages/format/src/pdf-blocks.ts` 拼成段落块（照 ParaRead：拼行、两栏排序、分段、标题、图块），按 PDF 内容指纹缓存在 `userData/reading/text/`，以后翻译和搜索也用它。
  - 自动笔记：每问完一轮，后台让 AI（Claude Code 用 Haiku）把这一处的问答收成一段 JSON（小标题、我的疑惑、讲通的讲法、要点、没讲通的几版各一行、这页最重要的图、双链），界面截下 AI 挑的图，主进程写进 PDF 旁边的「<PDF 名> 笔记.md」（格式和读写在 `packages/format/src/reading-note.ts`，同一处接着问整段换掉，按页排，用户自己写的段落不动），完整对话写进 `.canvas-notes/对话/`，连同截图一次提交「笔记：<PDF 名> 第 N 页 · <小标题>」。说「还是不懂」「换个方式讲」时上一版自动算没讲通。
  - PDF 精读增强（MinerU，可选、不进安装包；偏好「用到PDF再提示装MinerU」）：pdf.js 的块先出，读完全文后 `reading/store.ts` 的 `enhance` 找 MinerU（`src/main/mineru/find.ts`：① 设置 › AI 里填的路径 ② ParaRead 设置里的 mineruPath ③ `~/.mineru-venv/bin/mineru-kit` ④ ParaRead 装的那份 ⑤ `zsh -lc 'command -v mineru-kit'`；`--version` 要 4.0.12 ≤ v < 5、`models verify --tier basic` 要过；找到的不升级、不改），找到就后台 `mineru-kit parse <pdf> -o <临时>/middle.json -f middle_json --tier basic -v`（`run.ts`：一次一个、detached 整组杀、超时 60 秒 + 每页 10 秒、`MINERU_MODEL_SOURCE=local`、不加 `--remote`），原样结果存 `userData/reading/mineru/<指纹>.<版本>.basic.json`，`@cn/format` 的 `fromMiddle` 换成块存 `reading/text/<指纹>.m1.json`（和 b2 并排，`readTextCache` 有 m1 用 m1，搜索也是），界面换上（AI 提过的旧图编号按框重叠对到新块，下一问告诉 AI 一次）。新的三种块：`table`（text 是表格 HTML，界面按 `tableRows` 自己画表）、`formula`（LaTeX，KaTeX 渲染）、`caption`（跟着图、表）；AI 读页写成「[表 id]」+ 格子、`$$LaTeX$$`，表也能当配图；配图的取框层排第一的是 MinerU 的图框（`mineruFigure`，按 AI 回的框挑）。失败（找不到、版本不对、缺模型、退出码、超时、JSON 坏）照常用 pdf.js，标签条一行「增强识别没成功 · 重试」。哪都找不到时 PDF 标签条下面一行提示（`MineruBar.tsx`）：安装 / 不再提示 / 许可证；安装（`install.ts`，照 ParaRead）：下载 uv 到数据目录 `mineru/` → `uv venv --python 3.12 ~/.mineru-venv`（Python 在 `~/.mineru/python`）→ `uv pip install mineru==4.2.3`（缓存在数据目录、装完删）→ `mineru-kit models download --tier basic`，能续、有进度。设置 › AI 最下面能填路径、重新找、开关提示。
    - 测试：`CN_E2E=1` 时不碰本机的 MinerU，`CN_MINERU_HOME` 指一个当「~」用的临时目录（放假的 `e2e/fixtures/fake-mineru-kit.sh`，`CN_FAKE_MIDDLE` 给它要输出的 middle.json，`CN_FAKE_MINERU_FAIL=exit|hang|badjson`、`CN_FAKE_MINERU_VERSION`）；`CN_MINERU_UV_URL` 指本机放假 uv（`e2e/fixtures/fake-uv.sh`）的下载地址，`CN_MINERU_TIMEOUT_MS` 换解析超时。端到端 `e2e/step23-mineru.spec.ts`。真跑一次（只读用本机 `~/.mineru-venv`，解析 arXiv 1512.03385v1 约 35 秒）：`CN_REAL_MINERU=1 npx vitest run apps/notes/test/real-mineru.test.ts`、`CN_REAL_MINERU=1 npx playwright test e2e/real-mineru.spec.ts`。
  - 双向跳转：笔记里点「第 N 页」或我框的图，PDF 翻过去、框闪两下；PDF 页边「这里问过 N 轮」的小标记点了右栏切到笔记那一段；AI 回答里的「第 4 页」也能点。
  - 第 2 段：
    - 进度：工具栏「问到 5/10」（问过的最大页码 / 一共几页），也写进笔记属性「进度」。
    - 做个可视化：AI 觉得适合画图时在回答最后单独写一行「〔可以做个可视化〕」，界面上换成「做个可视化」按钮；点了后台让 AI 做一个单文件 HTML（`src/main/reading/prompts.ts` 的 `vizPrompt`），存在 PDF 所在的文件夹，属性写在 `<head>` 的 `<meta name="类型" content="可视化">` 等里，挂进笔记那一段的脚上，一次提交。中间栏 HTML 标签（`HtmlTab.tsx`）用 `cn-file://vault/…` 在 `sandbox="allow-scripts"` 的 iframe 里跑，响应头的 CSP 只许文件自己的脚本和样式、不联网（`attachments.ts` 的 `HTML_CSP`）。
    - 我的疑惑：一个文件夹（一门课）里各篇读 PDF 笔记问过的每一处，按讲分组（`packages/format/src/doubts.ts`）；中间栏「我的疑惑」标签按讲收起、正在读的那讲展开、每讲最多 5 条；每次记笔记、送 Anki 都重写 `<文件夹>/我的疑惑.md`。入口：笔记头上「全部疑惑 ›」、⌘K「我的疑惑」。
    - 送进 Anki：主进程直接走 AnkiConnect（`src/main/reading/anki.ts`，本机 127.0.0.1:8765，`CN_ANKI_URL` 能换），用和 Anki Learn、Ask Free、GetNewWord 同一个笔记类型「学习卡 · 问答」（卡片家族 v3，定义拷自 anki-learn 的 `Anki.swift`，要一字不差）；牌组「知识」，课程和讲写进标签（照 anki-learn DESIGN.md「往 Anki 里加卡」）；正面是问题和我框的图，背面讲通的讲法、要点，「打开原文」是 `canvas-notes://open?file=…&page=…`（只在装好的软件里登记这个网址）。送过的记在库里 `.canvas-notes/anki.json`，跟着 Git 走。
  - 第 3 段（搜索、⌘O、目录树）：
    - 三层搜索，都在 ⌘F / ⌘K 一个框（`renderer/Palette.tsx`，行怎么排在 `renderer/search/rows.ts`）：文字（笔记全文是主进程 `Vault.search`，PDF 里的字按页搜，命中的那一段闪一下）→ 意思相近（停手 300ms 后出）→ 命令、网页 → 最后一行「让 Claude 帮我找」。不管选着哪一行，⌘↵ 在右栏网页里搜（打的像网址就直接打开）、⌥↵ 让 Claude 找（CN-41）。每组最多 5 条，「还有 N 条」点了最多 20 条。
    - 搜索进程（`src/main/search/`，Electron utilityProcess，入口 `worker.ts`，构建出 `out/main/search-worker.js`）：读库里每份 PDF 的字（pdfjs-dist 的 Node 版，和 PDF 标签同一段拼法 `shared/pdf-page-text.ts`，写进同一个全文缓存 `userData/reading/text/`），再在后台一段一段算向量；自己盯着库，文件变了停 1.5 秒再扫，只算新的和改了的。优先级调低，ORT 线程不空转。
    - 本机小模型：multilingual-e5-small（MIT，intfloat；Xenova 转的 int8 ONNX，118 MB，384 维），onnxruntime-node 跑，分词 @huggingface/tokenizers。`pnpm install` 时 `scripts/fetch-model.mjs` 按钉死的版本和 sha256 下到 `apps/notes/resources/models/`（不进 git），打包时 extraResources 带进安装包（`Resources/models/`），onnxruntime-node 不进 asar、只带 Mac arm64 的库。`CN_MODEL_DIR` 能换模型目录，没有模型时意思那一层写「这台机器上没有本机模型」。索引存在 `userData/search/<库路径的指纹>/`（index.json + vectors.f32），不进库。实测（M 系列，4 线程）：1000 篇（3192 段）建索引 46.1 秒，查一次中位数 3.9 ms（最慢 4.5 ms）；重开没变的 25 ms（`CN_BENCH=1 npx vitest run apps/notes/test/search-model.test.ts`）。
    - 让 Claude 帮我找（`search/claude-find.ts`）：Claude Code 用快模型、只给 Read、Glob、Grep（`EngineRun.readOnly`），在库目录里自己翻，每调一次工具报一步（`onTool`），最后交一行 JSON（路径、页码、一句为什么）。假引擎按他的话里相邻两个字找 md（`CN_FAKE_FIND_MS` 调每步多久）。
    - ⌘O 按名字跳（`renderer/search/QuickOpen.tsx`）：md、PDF、HTML 和文件夹（每个文件夹都有首页），空着列最近打开的（本机记 30 个），字按顺序或都出现就算（`shared/files.ts` 的 `matchFiles`），PDF 右边是问到哪。
    - 左栏「最近 / 全部文件」（`renderer/files/FileTree.tsx`，独立组件，以后改成图标栏 + 侧栏时整个挪过去）：全部文件是整个库的树（主进程 `main/files.ts` 列 md、PDF、HTML 和文件夹，PDF 带旁边笔记的「进度」，HTML 带 `<meta name="第几讲">`），课程文件夹写「问完几讲 / 一共几讲」；顶层按 课程 / 项目 / 生活 / 写作 / 素材 / 收件箱 排，一门课里我的疑惑、术语表在上，再按讲次（课件 → 笔记 → 可视化）。点 课程/<课>、项目/<项目>、生活、写作 的名字开它的首页（`openFolderHome`），点箭头只展开；一个文件夹先列 100 个。梦游预览时树也画成改好以后的样子（挪来的标「新」，原来的位置留划掉的影子）。「最近」还是原来那套（含「文件夹」一组）。库里 PDF、HTML 变了也报「文件变了」（`Vault.watch`）。
  - 第 4 段（双语、网页上问、HTML、梦游做可视化）：
    - 双语对照读（`renderer/reading/bilingual/`，规则在 `packages/format/src/bilingual.ts`）：PDF 工具栏「原文 / 对照 / 只看译文」，⌥A 轮流（PDF 标签在 capture 阶段先接，网页翻译的 ⌥A 收不到）；对照有并排（左原页右译文，同一个滚动，悬停两边互相点亮）和重排（`ReflowView`，原文跟译文，PDF 和网页阅读视图共用）。默认版式在进对照那一刻按「右栏 AI 开着且中间栏窄于 1100 → 重排」定下，手选过的按 PDF 记在本机（`cn.bi:<路径>`）。翻译走双语翻译插件的 `translateBlocks`（同一个缓存、引擎、语言、课程术语表），看得到的组（上下多一屏）先翻，段落按 `blockHash` 记；「重新翻译」带 `fresh` 不读缓存（翻好的换掉旧的）。公式（`isFormula`：有数学符号、几乎没有成句的词）和图不翻，照原页裁图；页眉页脚（页面最上、最下一小条里的短行）不进对照。「存成双语笔记」先把没翻的翻完、裁好公式和图，主进程写 `<PDF 名> 双语.md`（每页一节，节头回到 PDF 那页；原文写成引用、跟着译文），裁图进 `附件/<PDF 名>/双语/`，一次提交。`translateBlocks` 等到每块译文都回来再停听（译文和「翻完」走两条 IPC，可能晚到）。
    - 网页阅读视图：翻译菜单里「在中间栏左右对照读」，网页预加载（`preload/webview-reader.ts`）用 Readability 抽正文拆成块（标题、段落、列表项；块级公式先换成「⟦公式 图片网址⟧」一段，免得 Readability 当杂物删掉；代码、表格、图不翻），中间栏开「<标题> · 阅读视图」标签（`WebReadTab.tsx`），存成双语笔记进 `收件箱/<标题> 双语.md`（来源是网址，图是原网址）。正文只在这次开着时记在内存，重开软件要回网页再点一次。
    - 网页上框着问：右栏网页里按住 ⌘ 拖（⌘ 点一下不拖还是网页自己的），预加载画框和黑色工具条（shadow DOM），发 `cn:read:box`；界面（`reading/web-bridge.ts`、`App.tsx`）用主进程 `reading:capture`（`webContents.capturePage`）截那一块。中间开着 PDF / HTML：进它的读 PDF AI，这一处带 `web`（网址、标题、框里的字），笔记段链接那行写「[域名](网址)」。没开：右栏下格 AI 的来源是 `web:<网址>`（对话、会话和 PDF 一样存在 `userData/reading/`），记笔记时中间栏开着文档就把这一段的 md 交回界面插到光标处、存好后连同完整对话和截图一次提交（`reading:commit`），没开文档进 `收件箱/<标题> 笔记.md`。截图在 `附件/网页/`，完整对话头上是回到网页的链接。
    - 打开 HTML（`HtmlTab.tsx`）：沙箱 iframe（`sandbox="allow-scripts"`、CSP 不联网）；「框一块问」按钮或按住 ⌘（焦点在软件里时）在 iframe 上面一层拖框，「问这一屏」⌘↵；截图用 `reading:capture(null, …)` 截窗口上画出来的那块，沙箱不开口子。AI 是这份 HTML 的（字由主进程去掉标签给），笔记写在旁边的 `<名字> 笔记.md`。
    - 梦游做可视化（`src/main/dream-viz.ts`，`dream.ts` 里只加了一步）：从今天的提交里找「笔记：<PDF> 第 N 页 · <小标题>」，在那篇读 PDF 笔记里挑追问过或换过讲法、还没有可视化的段，按「轮数 + 没讲通 ×2 + 疑惑条数」排，最多 3 处；每处让 AI 做一个单文件 HTML（`<meta name="做的" content="梦游">`），存进 PDF 所在的文件夹、挂到那一段的脚上，一处一个提交（提交前核对只动了这两个文件）。报告里一组「可视化」，点开一条「预览可视化」在中间栏开梦游分支上的那份（`cn-file://dream/…`，同一套沙箱 CSP），收下、丢掉和别的条目一样。
  - 对话和看到哪页存在 `userData/reading/`（不进库），会话号只有主进程写。测试：`CN_AI_FAKE=1` 的假引擎也会答读 PDF 的问题和收笔记（`CN_FAKE_NOTE_MS` 调收笔记要多久），`e2e/fixtures/pdf.ts` 手写一份测试用的 PDF。
- 测试用的环境变量：`CN_MINUTE_MS` 把自动提交间隔里的「一分钟」缩短（默认 60000）。
- 应用图标「一叠卡片」：`node apps/notes/scripts/make-icons.mjs` 从 `design/v3/icon/` 生成 `apps/notes/build/icon.icns`（打包用）、`build/icon.png`（开发时的程序坞图标）和菜单栏模板图 `src/main/tray-icon.ts`；换图标改脚本里的 `PICK`。
- 自带的封面照片都是 CC0，出处见 `THIRD_PARTY_NOTICES.md`。

两条硬规矩的测试：
- 打开再保存文件不变：`packages/format/test/roundtrip.test.ts`、`apps/notes/e2e/rule1-roundtrip.spec.ts`
- 外部改动不丢正在打的字：`packages/format/test/sync.test.ts`、`apps/notes/e2e/rule2-external.spec.ts`

- 设置 › AI（`renderer/settings-ai.tsx`、`shared/ai-features.ts`）：默认一家一个模型，AI 对话、梦游、看图问、小活各自「跟默认」或指定（存在 `userData/ai/settings.json` 的 `prefs`，旧设置只有 `engine` 的读成默认）；主进程按 `pickFor(feature)` / `modelOpt(feature, engine)` 跑，界面上「哪个模型做的」用 `featureLabel`。翻译那行读写双语翻译插件自己的「自动 / 指定一个」。`CN_AI_MODEL` 换默认的 Opus，`CN_FAST_MODEL` 换小活的模型。
- 读 PDF 笔记的配图（CN-60）：问的时候附了截图（框的那块或整页），提示里让 AI 在回答最后写一行 `〔配图 左,上,宽,高 · 说明〕`（`main/reading/prompts.ts` 的 `FIGURE_ASK`）；界面不显示这一行，换算成整页上的比例记在那条回答上（`@cn/format` 的 `figure-box.ts`），后台记笔记时按框从 PDF 重新画的页面裁（矢量画的图也裁得对）。框太小、几乎整页、出界的不算，退回 AI 从图片块里挑。取框是 `locateFigure` 一层，以后 MinerU 增强包给的版面块排在前面。假引擎 `CN_FAKE_FIGURE_MARK=<那一行>` 给固定框；真测 `CN_REAL_AI=1 npx playwright test e2e/real-figure.spec.ts`（下载 arXiv 1706.03762 第 3 页的矢量结构图，Haiku 约 20 秒）。
- AI 出错（`shared/ai-errors.ts`、`renderer/ai-error.tsx`）：原话认成被安全检查拦下、没登录、网络、模型不对、超时等，界面一句中文 + 下一步，原话收在「看原话」；翻译插件的 `classify` 也用它。
- AI 输入框粘图、拖图（`renderer/paste-images.tsx`、`main/pasted.ts`）：存进 `userData/pasted/`，不进库，发问时一起交给引擎，一次最多 4 张。

## 发版

照 MeetCaption 的流程，全部在本机做（`scripts/release.mjs`），步骤和每一步对外暴露什么见 `release/CHECKLIST.md`。

```
# 本机试打包：不管工作区干不干净、有没有 tag（这样的包不能 --publish）
node scripts/release.mjs --try                    # arm64 + x64；--arch=arm64 只打一种

# 正式：改 apps/notes/package.json 的 version，提交，git tag v<版本>
node scripts/release.mjs                          # Developer ID 签名，核对后放在 apps/notes/release/<版本>/；默认不公证，--notarize 才公证、钉票据
# 写 apps/notes/release/<版本>/notes.md，git push origin v<版本>
node scripts/release.mjs --publish                # 上传核对过的那一份，建 GitHub Release
```

- 签名用钥匙串里的 `Developer ID Application`（`release/brand.json` 的 `signing.identity`），hardened runtime，entitlements 在 `apps/notes/build/entitlements.mac.plist`（JIT、可执行内存、库校验、Apple 事件）。
- 不公证（2026-11-15 用户定，和 MeetCaption 一样）：README 和官网写了第一次打开时在访达里右键「打开」。以后要公证：加 `--notarize`，用 notarytool 的钥匙串 profile，名字默认 `canvas-notes-notary`，环境变量 `CN_NOTARY_PROFILE` 可换；先跑一次 `xcrun notarytool store-credentials canvas-notes-notary --apple-id <开发者账号> --team-id <团队>`。凭据不进仓库。
- 产出：`CanvasNotes-<版本>-mac-<arm64|x64>.dmg` 和 `.zip`，另有不带版本号的 `CanvasNotes-mac-<arch>.dmg`（README 和官网链到 `releases/latest/download/` 下的它），`SHA256SUMS.txt`。
- 检查更新（`src/main/updater.ts`，照 MeetCaption）：electron-updater 查 GitHub Release 的 `latest-mac.yml`，启动 30 秒后一次、之后每 6 小时；有新版在后台下 zip，Squirrel 验过签（要和装着的同一张 Developer ID）才算下好，底栏最右端出「● 重启更新到 x」，不点就下次退出时装上。设置 › 更新能手动查、关自动检查。只有发布包会查（`CN_RELEASE=1` 打包时才写 `publish`，包里才有 `app-update.yml`）；开发版、`dist:mac` 本机包、端到端测试都是「开发版，不自动更新」。所以发版时 `latest-mac.yml`、两个 zip 和 `.zip.blockmap` 都要传（`scripts/release.mjs` 会核对）。
  - 真更新怎么测：把 version 改成 0.1.98 用 `--try --arch=arm64` 打一份，再改成 0.1.99 打一份；用一个本机 http 服务放 `apps/notes/release/0.1.99/mac/`，`CN_E2E=1 CN_UPDATE_URL=http://127.0.0.1:<端口>/` 打开 0.1.98 那份，`window.cn.checkUpdate()` 后等到 ready，退出，那份 .app 的版本变成 0.1.99、签名照样过（2026-11-15 这样测过）。
- 包里不带任何 AI 的程序或 SDK：四家 AI 都是起用户自己装的命令行（Claude Code 是 `claude -p --output-format stream-json`，见 `apps/notes/src/main/agent/engines.ts`）。

## 官网

单页官网在 `website/`（不用构建），推到 main 后 `.github/workflows/pages.yml` 发到 GitHub Pages。

```
cd apps/notes && npx electron-vite build && cd ../..
node scripts/site-shots.mjs      # 用真软件和临时样本库（冰岛自驾）重截 website/shots/
node scripts/site-check.mjs      # 本机起静态服务器，420/800/1200/1600 宽、浅深两色截整页，查横向滚动、图片、下载链接、语言切换
```

挂到家族总站 apps.us-cloud.uk 的改动在 `website/hub-entry/`（补丁，总站仓库另行提交）。
