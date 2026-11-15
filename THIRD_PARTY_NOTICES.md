# 第三方声明

Canvas Notes 本身按 GPL-3.0-or-later 授权（见 `LICENSE`），Copyright © 2026 Jia Zonghan。下面是随包分发的别人的东西、拷来或参照的代码，各自的许可证都和 GPL-3.0 兼容（MIT、ISC、BSD、Apache-2.0、CC0）。包里不带任何 AI 的程序或 SDK：AI 用的是用户自己装的命令行（Claude Code、Codex、Gemini CLI、OpenCode），软件只是起它们的进程。

## MeetCaption 的设计变量和组件样式

`packages/design/src/tokens.css` 和 `packages/design/src/ui.css` 的起点拷自会议字幕（MeetCaption）v3 的 `src/renderer/shared/tokens.css`、`ui.css`（https://github.com/SchaeferAnjon/meetcaption ）。这两个文件来自同一作者的 MeetCaption，同为 GPL-3.0-or-later。

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

## 内置浏览器用到的库（随包分发，各自的许可证文件在 node_modules 里）

| 库 | 版本 | 许可证 | 用在哪 |
|---|---|---|---|
| electron-chrome-extensions（Samuel Maddock） | 4.10.0 | MIT | 给内置浏览器补 Chrome 插件接口：工具栏按钮和弹窗、tabs、windows、contextMenus 等（`apps/notes/src/main/web/extensions.ts`） |
| @mozilla/readability | 0.6.0 | Apache-2.0 | 整页剪藏时抽正文（`apps/notes/src/preload/webview-page.ts`） |
| turndown（Dom Christie） | 7.2.5 | MIT | 整页剪藏时把正文转成 Markdown（同上） |

读 Chrome 书签和历史的 `flattenBookmarks`、`historyRowsToEntries`（`apps/notes/src/main/web/chrome-data.ts`）照着用户自己在 Dispatch IDE 里的实现写（`patches/browser-import-chrome.patch`，MIT）。

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
| lucide-react | ISC |
| node-diff3 | MIT |
| @mixmark-io/domino（turndown 的依赖） | BSD-2-Clause |
| electron-chrome-extensions 的依赖（debug、ms） | MIT |

`apps/notes` 写在 dependencies 里、原样放进包的只有 electron-chrome-extensions 和它的依赖 debug、ms（3 个，都是 MIT）；上表其余的库由构建打进 JavaScript 里。源码用到的第三方库连同它们的生产依赖一共 33 个（含这 3 个）：MIT 30、ISC 1（lucide-react）、Apache-2.0 1（@mozilla/readability）、BSD-2-Clause 1（@mixmark-io/domino），都和 GPL-3.0 兼容（2026-11-15 去掉 Claude Agent SDK 后重新核过）。只在构建时用、不进包的工具里有 MPL-2.0（lightningcss）、BlueOak-1.0.0、Python-2.0（argparse）、CC-BY-4.0（caniuse-lite 的数据）和 WTFPL（electron-builder 的几个小依赖），不影响发布出去的软件。
