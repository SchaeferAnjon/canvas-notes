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

- 库：一个文件夹，里面是 md 文件，自动建 Git。`收件箱/` 放新东西，`素材/<主题>/` 放剪来的，其余是「我写的」；frontmatter 里 `type: board` 的是白板。
- 文档：实时预览（光标所在行露出 md 原文）和「源文件」；⌘N 新建，点标题改名（别处的 `[[旧名]]` 一起改），⌘ 点双链打开；自动保存，内容没变不写盘。
- 白板：双击空白处加卡片，左边工具板加待办、列、子白板；拖卡片挪位置、拖进列；卡片右边的小圆点拖到另一张卡上连线；选中按删除键删；⌘Z 撤销；右上「未整理」里是这篇没放进卡片的段落和收件箱，拖上白板。
- 网页（右栏）：选中一段，白板标签里「剪成卡片 · 到：收件箱」，文档标签里「剪进文档」插到光标处；右上登录图标一键导入 Chrome 的登录（macOS 会问一次钥匙串）。
  - 多标签：⌘T 新网页，网页焦点时 ⌘W 关网页标签，⌘L 到地址栏；新窗口链接开成新标签；标签记在本机，每个中间栏标签记住自己看的网页。网页标签条右边的「在中间栏打开」把网页开成一个宽标签读，「放回右栏」再放回来。
  - 书签和历史：地址栏里的星星加书签，书签栏摆书签栏里的书签，文件夹点开是菜单；书签图标里按文件夹看、删、搜历史，「从 Chrome 导入」按 Chrome 用户导书签和历史。存在软件设置目录（`userData/web/`），不进库。
  - Chrome 插件：插件图标里「从 Chrome 导入」把 Chrome 某个用户装的插件拷一份到 `userData/web/extensions/` 再加载（Chrome 那边不动），能开关、移除，每个插件写着能不能用、缺哪些接口；有按钮的插件摆在地址栏右边，点开是它的弹窗。Electron 只有一部分 Chrome 插件接口，拦广告、用户脚本、要和电脑上配套程序通信的插件多半用不了。
  - 整页剪藏：剪刀按钮把当前网页的正文（Readability 抽正文、Turndown 转 md）存成收件箱里新的一篇，带 created 和 source，单独一次提交，能撤回；AI 的 /剪藏当前网页 调同一个 `window.cn.clipCurrentPage`。
  - 图片：网页里的图片直接拖到白板上变成图片卡（带来源），访达里的图片拖进来、剪贴板里的图片粘贴进来也行；拖进文档插 `![说明](附件/…)`。图片存在库里的 `附件/`，界面用主线的只读 `cn-file://` 看库里的图。
- Git 底栏：未提交的文件、提交、同步（先提交，再拉，再推）、历史。没提交的改动按设置里的间隔自动提交（默认每 10 分钟，可关），退出和换库前也会提交。
- 左栏只放「活着的」（库里 7 篇还是 7 万篇，左栏都不超过 30 行，置顶的另算）：置顶的、最近 5 块白板、最近 7 天动过的文档（最多 10 篇，多的写「还有 N 篇」）、最近剪过的 6 个素材主题；底部「全部笔记 · N 篇」「归档 · N 篇」打开可筛选（标题、文件夹、类型）、按修改时间排、虚拟滚动的长列表。
  - 置顶：左栏或列表里右键「置顶 / 取消置顶」，存在库里 `.canvas-notes/置顶.json`（跟着 Git 走），改名、挪走、删掉时跟着变。
  - 自动归档：默认 90 天没改过的笔记算归档，只是左栏不显示，文件不挪、内容不改；置顶的和收件箱不归档；一编辑修改时间变了就回到左栏。天数在设置 › 库 里改（30 / 60 / 90 / 180 天 / 不自动归档），存在 `userData/settings.json`。
  - 收件箱超过 20 条：左栏计数和首页收件箱组件变成琥珀色提醒，多一个「让 AI 分一分」（跑 /整理收件箱）。
  - 大库：主进程按修改时间和大小缓存每篇的说明，没变的不再读；读到的全文顺手进搜索缓存。7000 篇的测试库（`node apps/notes/e2e/fixtures/big-vault.ts <文件夹>` 能造一个）启动到左栏出来约 1.2 秒，再列一次约 60 毫秒，⌘F 打字到出结果约 0.25 秒。
- 框架（第三版方向 A）：网页、梦游、历史三个开关竖排在窗口最右边，点开右栏、再点收起；搜索在左栏顶上（⌘F / ⌘K）；AI 只在中间栏右下角。
- 首页：两种样式（A 封面长图加组件网格，B 整页背景加玻璃组件），设置里切换；「编辑首页」能拖动、收起、放回、换大小，封面能换（8 张自带照片、4 种渐变、从电脑选）和调位置。首页设置存在库里 `.canvas-notes/首页.json`，跟着 Git 走；从电脑选的封面拷进 `附件/封面/`。
- 设置（⌘,）：外观（六套主题：家族灰浅/深、纯白、米白、纯黑、深海蓝；跟着系统时白天、夜里各用哪套；首页样式；深海蓝的窗口背景照片）、首页、库（换到别的文件夹、自动归档天数）、AI 默认引擎、Git（自动提交间隔、远程地址、现在同步）、快捷键。存在软件设置目录 `userData/settings.json`。
- AI（只在中间栏右下角，⌘J 开关）：头部选引擎（Claude Code、Codex、Gemini、OpenCode，用这台 Mac 上已登录的命令行，不另存密钥），库目录就是 AI 的工作目录；回答边生成边显示，对话记录存在软件设置目录（`userData/ai/`），关了再开还在。直接说话时 AI 能动手：网页（打开、读、点、输入、滚动、剪进收件箱）、白板（加卡片、改、挪、放进列、连线、按网格或按列排整齐）、文档（读、在光标处插入、替换选中）。每一轮 AI 改的文件是单独一次提交，浮窗里有改动预览和「撤回」。/ 命令：/整理收件箱、/总结这块白板、/写成文章、/翻译、/找重复、/剪藏当前网页、/现在梦游（后三条等对应功能接上）。
  - 怎么接的：软件起一个只听 127.0.0.1、带随机令牌的 MCP 服务（`src/main/agent/mcp-server.ts`），各家命令行接上它；AI 自己写文件、跑命令一律不许，改笔记只能走这些工具。
  - 测试：`CN_AI_FAKE=1` 用假引擎（按说的话走固定的工具调用）；`test/fixtures/` 里有假的 claude、codex app-server、ACP 命令行，单元测试用它们测各家的接法；`CN_AI_MODEL` 换 Claude 的模型，`CN_CODEX_MODEL` 换 Codex 的模型。
- 测试用的环境变量：`CN_MINUTE_MS` 把自动提交间隔里的「一分钟」缩短（默认 60000）。
- 应用图标「一叠卡片」：`node apps/notes/scripts/make-icons.mjs` 从 `design/v3/icon/` 生成 `apps/notes/build/icon.icns`（打包用）、`build/icon.png`（开发时的程序坞图标）和菜单栏模板图 `src/main/tray-icon.ts`；换图标改脚本里的 `PICK`。
- 自带的封面照片都是 CC0，出处见 `THIRD_PARTY_NOTICES.md`。

两条硬规矩的测试：
- 打开再保存文件不变：`packages/format/test/roundtrip.test.ts`、`apps/notes/e2e/rule1-roundtrip.spec.ts`
- 外部改动不丢正在打的字：`packages/format/test/sync.test.ts`、`apps/notes/e2e/rule2-external.spec.ts`

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
- 自动更新还没做：zip 先一起传上去，以后接 electron-updater 时用。
- 包里不带任何 AI 的程序或 SDK：四家 AI 都是起用户自己装的命令行（Claude Code 是 `claude -p --output-format stream-json`，见 `apps/notes/src/main/agent/engines.ts`）。

## 官网

单页官网在 `website/`（不用构建），推到 main 后 `.github/workflows/pages.yml` 发到 GitHub Pages。

```
cd apps/notes && npx electron-vite build && cd ../..
node scripts/site-shots.mjs      # 用真软件和临时样本库（冰岛自驾）重截 website/shots/
node scripts/site-check.mjs      # 本机起静态服务器，420/800/1200/1600 宽、浅深两色截整页，查横向滚动、图片、下载链接、语言切换
```

挂到家族总站 apps.us-cloud.uk 的改动在 `website/hub-entry/`（补丁，总站仓库另行提交）。
