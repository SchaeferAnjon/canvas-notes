# 第三方声明

Canvas Notes 本身按 GPL-3.0-or-later 授权（见 `LICENSE`），Copyright © 2026 Jia Zonghan。下面是随包分发的别人的东西、拷来或参照的代码，各自的许可证都和 GPL-3.0 兼容（MIT、ISC、BSD、Apache-2.0、CC0、CC BY 4.0）；只有安装包里带的 Git 是 GPL-2.0-only，它是单独的程序，见下面「Git」一节。包里不带任何 AI 的程序或 SDK：AI 用的是用户自己装的命令行（Claude Code、Codex、Gemini CLI、OpenCode），软件只是起它们的进程。

## MeetCaption 的设计变量和组件样式

`packages/design/src/tokens.css` 和 `packages/design/src/ui.css` 的起点拷自会议字幕（MeetCaption）v3 的 `src/renderer/shared/tokens.css`、`ui.css`（https://github.com/SchaeferAnjon/meetcaption ）。这两个文件来自同一作者的 MeetCaption，同为 GPL-3.0-or-later。

## Codicons

界面图标用的是 VS Code 的图标库 Codicons（@vscode/codicons 0.0.45，https://github.com/microsoft/vscode-codicons ），© Microsoft Corporation，按 Creative Commons Attribution 4.0 International（CC BY 4.0，https://creativecommons.org/licenses/by/4.0/ ）授权。用到的图标由 `scripts/codicons.mjs` 原样拷进 `packages/design/src/codicons.gen.ts`，没有改动图形。CC BY 4.0 允许再分发和改编，只要署名，和 GPL-3.0 一起分发没有冲突。

## yt-dlp

没字幕的视频生成字幕时，用 yt-dlp（https://github.com/yt-dlp/yt-dlp ）只下载视频的音频。安装包里带的是它官方 Release 的 macOS 单文件版（`yt-dlp_macos`，版本钉在 `apps/notes/scripts/fetch-ytdlp.mjs`，按 sha256 核对），原样不改，放在 `Resources/bin/yt-dlp`。yt-dlp 按 The Unlicense 授权（放进公有领域），和 GPL-3.0 一起分发没有冲突。这个单文件版里还打包了 Python 运行时和 yt-dlp 依赖的几个库，各自按自己的许可证（PSF、MIT、MPL-2.0 等，清单见 yt-dlp 仓库的 THIRD_PARTY_LICENSES.txt）。

## OpenCode（没装命令行时动手用）

一个 AI 命令行都没装、填了 API Key 要动手（改笔记、全能模式）时，AI 对话交给软件自带的 OpenCode（https://opencode.ai ，MIT，版权 (c) 2025 opencode）。安装包里带的是 npm 上 `opencode-darwin-arm64` / `opencode-darwin-x64` 包里的单文件版（版本钉在 `apps/notes/scripts/fetch-opencode.mjs`，按 npm 给的 sha512 核对），原样不改，放在 `Resources/opencode/opencode`。软件只开用户给了 Key 的那一家（`enabled_providers`），它自带的免费模型不用；它的设置和会话放在软件设置目录 `ai/opencode/` 里。MIT 和 GPL-3.0 一起分发没有冲突。

## Git（软件只用安装包里这一份）

画布笔记的历史、提交、同步都用 Git（https://git-scm.com ）。安装包里带的是 GitHub 为 Electron 软件编好的 dugite-native（https://github.com/desktop/dugite-native ）官方 Release 里的 macOS 版 Git（版本和 sha256 钉在 `apps/notes/scripts/fetch-git.mjs`），放在 `Resources/git`；程序本身原样不改，只去掉了用不着的部分（Git Credential Manager、git-lfs、scalar、服务器端的程序）。Git 按 GNU General Public License version 2（GPL-2.0-only）授权，全文在包里的 `Resources/git/COPYING`；对应的源码在 https://github.com/git/git 同版本的 tag，编译脚本在 dugite-native 同版本的 tag（`Resources/git/SOURCE.txt` 写着具体哪一版）。Git 是单独的程序，画布笔记只是起它的进程、读它的输出，两者没有链接在一起，属于 GPL 说的「聚合」（mere aggregation），可以和按 GPL-3.0-or-later 授权的画布笔记放在同一个安装包里分发。dugite-native 的编译脚本按 MIT 授权。

## Claudian

`apps/notes/src/main/agent/` 里接本机 AI 命令行的做法（找命令行、补全 PATH、Codex app-server 和 ACP 的 JSON-RPC 接法、只放行自己的工具）参照了 Claudian：
https://github.com/yishentu/claudian （看的是 2026-11-15 的 14c32a6）。涉及的文件开头都写了出处。

```
MIT License

Copyright (c) 2025 Yishen Tu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## BookmarkKeeper（新网页标签）

新网页标签显示的是 BookmarkKeeper（书签管家）0.8.0 的新标签页、整理书签页和设置页：
https://github.com/SchaeferAnjon/bookmark （从 bb383e7 拷来）。随包带的一份在 `apps/notes/resources/bookmarkkeeper/`，
是软件自己的一部分：新标签页的字改成了中文、问候区的间距改小了（改动记在那份的 `SOURCE.json`），里面有它的 `LICENSE`；新标签页的打开标签仪表盘改自
Tab Out（MIT，见那份里的 `newtab/LICENSE-tab-out.md`）。快捷书签仓库（`apps/notes/src/main/web/bookmarkkeeper/quick-store.ts`）
照它 Mac App 里 BKCore 的 QuickStore、Bridge、StoreLocation 的做法用 TypeScript 重写，读写同一种文件。

```
MIT License

Copyright (c) 2026 BookmarkKeeper contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 内置浏览器用到的库（随包分发，各自的许可证文件在 node_modules 里）

| 库 | 版本 | 许可证 | 用在哪 |
|---|---|---|---|
| electron-chrome-extensions（Samuel Maddock） | 4.10.0 | MIT | 给内置浏览器补 Chrome 插件接口：工具栏按钮和弹窗、tabs、windows、contextMenus 等（`apps/notes/src/main/web/extensions.ts`） |
| @mozilla/readability | 0.6.0 | Apache-2.0 | 整页剪藏时抽正文（`apps/notes/src/preload/webview-page.ts`） |
| turndown（Dom Christie） | 7.2.5 | MIT | 整页剪藏时把正文转成 Markdown（同上） |
| @ghostery/adblocker-electron（Ghostery，https://github.com/ghostery/adblocker ）和它带的 @ghostery/adblocker、@ghostery/adblocker-electron-preload、@ghostery/adblocker-content、@ghostery/adblocker-extended-selectors、@ghostery/url-parser、@remusao/*、tldts-experimental、tldts-core | 2.20.3 | MPL-2.0（tldts、@remusao/* 是 MIT） | 内置插件「拦广告」：内置浏览器里拦广告请求、藏广告位（`apps/notes/src/main/plugins/adblock/`）。原样放在包里的 node_modules，没改它的文件；MPL-2.0 的源码就是上面的仓库。规则是用户电脑上取的 EasyList、EasyPrivacy（CC BY-SA 3.0 / GPL-3.0），不随包分发 |

读 Chrome 书签和历史的 `flattenBookmarks`、`historyRowsToEntries`（`apps/notes/src/main/web/chrome-data.ts`）照着用户自己在 Dispatch IDE 里的实现写（`patches/browser-import-chrome.patch`，MIT）。

## 读 PDF：pdf.js 和 ParaRead

| 库 | 版本 | 许可证 | 用在哪 |
|---|---|---|---|
| pdfjs-dist（Mozilla pdf.js，https://github.com/mozilla/pdf.js ） | 6.4.299 | Apache-2.0 | 中间栏的 PDF 标签：画页面、文字层、读每页的文字和图的位置、截一块（`apps/notes/src/renderer/reading/`）。构建时把它的 `cmaps/`、`standard_fonts/`、`wasm/`、`iccs/` 拷进 `out/renderer/pdfjs/` 随包分发 |

`standard_fonts/` 里另有两组字体，许可证文件随着拷进包里：Foxit 字体（BSD-3-Clause，Copyright 2014 PDFium Authors，见 `LICENSE_FOXIT`）、Liberation 字体（SIL Open Font License 1.1，见 `LICENSE_LIBERATION`），都和 GPL-3.0 兼容。

`apps/notes/src/main/reading/anki.ts` 里「学习卡 · 问答」的模板和样式（卡片家族 v3）拷自同一作者的 anki-learn（`Core/Sources/AnkiLearnCore/Anki.swift`），不另附许可。

`packages/format/src/pdf-blocks.ts` 里拼行、栏序、分段的办法和 `apps/notes/src/renderer/reading/pdf.ts`、`PdfTab.tsx` 里 pdf.js 的用法，拷自同一作者的 ParaRead（Scholar Reader，`src/main/pdftext.ts`、`src/renderer/src/lib/pdf.ts`、`src/renderer/src/components/PdfView.tsx`），不另附许可。

## 按意思搜：本机小模型和它的运行库

| 东西 | 版本 | 许可证 | 用在哪 |
|---|---|---|---|
| multilingual-e5-small（Wang 等，intfloat，https://huggingface.co/intfloat/multilingual-e5-small ；Xenova 转成 ONNX 并量化成 int8，https://huggingface.co/Xenova/multilingual-e5-small ，提交 761b726） | `onnx/model_quantized.onnx`、`tokenizer.json` | MIT | ⌘F「意思相近」那一层：本机算段落的向量，不联网。`apps/notes/scripts/fetch-model.mjs` 按 sha256 下到 `apps/notes/resources/models/`，随安装包放在 `Resources/models/` |
| onnxruntime-node（Microsoft，https://github.com/microsoft/onnxruntime ） | 1.31.1 | MIT | 在搜索进程里跑上面的模型（原生库，只带 Mac arm64 那份）；随它装的 onnxruntime-common、adm-zip（MIT）、global-agent（BSD-3-Clause）和它们的依赖 |
| @huggingface/tokenizers（Tokenizers.js，https://github.com/huggingface/tokenizers.js ） | 0.2.0 | Apache-2.0 | 把文字切成模型认的词元，构建时打进搜索进程的 JavaScript |

搜索进程里读 PDF 的字也用上面的 pdfjs-dist（它的 Node 版 `legacy/build/`，原样放进包里的 node_modules）。

## 梦游前后动画和生长图：force-graph 和 Motion

构建时打进界面的 JavaScript（`apps/notes/src/renderer/growth/`），各自的许可证文件在 node_modules 里：

| 库 | 版本 | 许可证 | 用在哪 |
|---|---|---|---|
| force-graph（Vasco Asturiano，https://github.com/vasturiano/force-graph ） | 1.52.0 | MIT | 生长图的画布、拖点、拖画布、缩放、点选；梦游报告顶上前后对比小图的画布 |
| Motion（motion、framer-motion、motion-dom、motion-utils，Motion Division，https://github.com/motiondivision/motion ） | 14.12.0（motion-utils 14.7.0） | MIT | 前后对比小图的时间线（重播、暂停、拖进度、弹簧），生长图新点弹出来、新线伸过去、镜头飞过去 |
| force-graph 的依赖：kapsule、accessor-fn、index-array-by、canvas-color-tracker、float-tooltip、bezier-js、lodash-es、@tweenjs/tween.js、d3-force-3d、d3-binarytree、d3-octree、tinycolor2、preact | 见 `pnpm-lock.yaml` | MIT | 同上 |
| force-graph 的依赖：d3-zoom、d3-drag、d3-selection、d3-scale、d3-scale-chromatic、d3-array、d3-color、d3-dispatch、d3-format、d3-interpolate、d3-quadtree、d3-time、d3-time-format、d3-timer、d3-transition、internmap（Mike Bostock） | 见 `pnpm-lock.yaml` | ISC | 同上 |
| d3-ease（Mike Bostock，force-graph 经 d3-transition 带进来） | 3.0.2 | BSD-3-Clause | 同上 |
| tslib（Microsoft，Motion 的依赖） | 2.9.1 | 0BSD | 同上 |

上面的许可证都和 GPL-3.0 兼容（2026-11-25 按 node_modules 里各包的 package.json 核过）。

## 首页封面和窗口背景照片

`apps/notes/src/renderer/assets/covers/` 里的 8 张照片来自 Wikimedia Commons，都是 CC0（公有领域），缩到 1800 宽重新压缩过：

| 文件 | 原图 | 作者 |
|---|---|---|
| aurora.jpg | https://commons.wikimedia.org/wiki/File:Northern_Lights_above_Iceland_(Unsplash).jpg | Vincent Guth |
| kirkjufell.jpg | https://commons.wikimedia.org/wiki/File:Kirkjufell_mountain_(Unsplash).jpg | Ivars Krutainis |
| ice-cave.jpg | https://commons.wikimedia.org/wiki/File:Glacier-cave-man-iceland_(Unsplash).jpg | Davide Cantelli |
| icebergs.jpg | https://commons.wikimedia.org/wiki/File:Iceland_icebergs_in_water_(Unsplash).jpg | L.W. |
| gullfoss.jpg | https://commons.wikimedia.org/wiki/File:Gullfoss,_Island.jpg | SinaSabet28 |
| black-beach.jpg | https://commons.wikimedia.org/wiki/File:Ice_on_black_beach_(Unsplash).jpg | Andy Mai |
| vik.jpg | https://commons.wikimedia.org/wiki/File:Vík_í_Mýrdal_-_Víkurkirkja_-_Jeff_Sheldon_2014-11-05_(Unsplash_4IPe3tnBKK0).jpg | Jeff Sheldon |
| myvatn.jpg | https://commons.wikimedia.org/wiki/File:Mývatn,_Iceland_(Unsplash).jpg | Jan |

## 随包分发的其他库（许可证按 `pnpm licenses list` 核过，2026-11-15）

界面、预加载脚本和主进程打进包里的：

| 库 | 许可证 |
|---|---|
| Electron 45（含 Chromium，许可证在包里的 `LICENSES.chromium.html`） | MIT |
| React、react-dom、scheduler | MIT |
| CodeMirror 6（@codemirror/*、@lezer/*、style-mod、w3c-keyname、crelt、@marijn/find-cluster-break） | MIT |
| pdfjs-dist（见上面「读 PDF」） | Apache-2.0 |
| KaTeX 0.19.0（https://github.com/KaTeX/KaTeX ，含它的字体）：AI 回答和读 PDF 笔记里的公式渲染 | MIT |
| node-diff3 | MIT |
| @mixmark-io/domino（turndown 的依赖） | BSD-2-Clause |
| electron-chrome-extensions 的依赖（debug、ms） | MIT |

`apps/notes` 写在 dependencies 里、原样放进包的有 electron-chrome-extensions、electron-updater、pdfjs-dist、onnxruntime-node 和它们的依赖（2026-11-16 按 `pnpm licenses list --prod` 核过：MIT、ISC、Apache-2.0、BSD-3-Clause、BlueOak-1.0.0、Python-2.0、MIT OR CC0-1.0，都和 GPL-3.0 兼容）；上表其余的库由构建打进 JavaScript 里。源码用到的第三方库连同它们的生产依赖一共 33 个（含这 3 个）：MIT 30、Apache-2.0 2（@mozilla/readability、pdfjs-dist）、BSD-2-Clause 1（@mixmark-io/domino），都和 GPL-3.0 兼容（2026-11-15 去掉 Claude Agent SDK 后重新核过；2026-11-16 加 pdfjs-dist，它可选的 @napi-rs/canvas 只在 Node 里用，不进包；同一天去掉 lucide-react，图标全换成 Codicons；2026-11-25 又加了 force-graph、Motion，连同它们的依赖一共 36 个，见上面「梦游前后动画和生长图」一节）。只在构建时用、不进包的工具里有 MPL-2.0（lightningcss）、BlueOak-1.0.0、Python-2.0（argparse）、CC-BY-4.0（caniuse-lite 的数据）和 WTFPL（electron-builder 的几个小依赖），不影响发布出去的软件。

## 翻译引擎的标志

`apps/notes/src/renderer/plugins/translate/logos/`、`apps/notes/src/renderer/assets/engine-logos/` 里 Claude、OpenAI（Codex、OpenAI API 用）、DeepSeek、OpenRouter、智谱、Gemini 的标志取自 LobeHub Icons（https://github.com/lobehub/lobe-icons，MIT，版权 (c) LobeHub），单色的改成跟着文字颜色。标志本身是各家公司的商标，这里只用来标明设置里那一行是哪家的服务。

## 导入备忘录：Obsidian Importer

`apps/notes/src/main/import/` 读备忘录数据库（NoteStore.sqlite 的表和列、笔记和表格的 protobuf 字段号、附件文件放在哪）参照了 Obsidian Importer 的 `src/formats/apple-notes/`：
https://github.com/obsidianmd/obsidian-importer （看的是 2026-11-12 的 fa9444a；它的字段表又来自 apple_cloud_notes_parser，MIT，版权 (c) 2019 Three Planets Software）。代码是我们自己写的，涉及的文件开头写了出处。

```
MIT License

Copyright (c) 2023 Obsidian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## iPhone / iPad 版：libgit2、node-diff3、turndown 的移植、Readability

- libgit2 1.9.7（https://github.com/libgit2/libgit2）：GPLv2 带链接例外（COPYING 第一段：链进别的程序不受 GPL 约束），静态链进 iPhone / iPad 版管库。`apps/apple/scripts/build-libgit2.sh` 按版本和 sha256 下载源码自己编，许可证全文随产物拷到 `apps/apple/CanvasGit/Vendor/libgit2-COPYING.txt`。libgit2 自带的 zlib（zlib 许可）、PCRE2（BSD）、llhttp（MIT）、SHA-1 碰撞检测（MIT）一起编进去。
- node-diff3 4.0.0（https://github.com/bhousel/node-diff3，MIT，© Bryan Housel 等）：电脑版直接用；iPhone / iPad 版把它的 LCS 和 diffIndices 一比一移植成 Swift（`apps/apple/CanvasCore/Sources/CanvasCore/Format/Diff3.swift`，文件头写明出处）。
- turndown 7.2.5（https://github.com/mixmark-io/turndown，MIT，© Dom Christie）和它带的 collapse-whitespace（MIT，© Luc Thevenard）：iPhone / iPad 版把整页剪藏 HTML 转 md 的规矩一比一移植成 Swift（`apps/apple/CanvasCore/Sources/CanvasCore/Clip/HTMLToMarkdown.swift`，文件头写明出处），和电脑版同一批样例对照。
- @mozilla/readability 0.6.0（Apache-2.0）：分享扩展的网页预处理脚本 `apps/apple/ShareExtension/ClipPage.js` 把它打包进去，在 Safari 里抽正文（和电脑版同一份）。
- 系统的 ICU（libicucore，iOS / macOS 自带，Unicode 许可）：剪进某篇时截「回到这一段」的开头用它的断词。
