# @cn/feeds

画布订阅（Canvas Feeds）的核心：抓源、解析、本机库、多台设备同步、存进画布笔记。界面在 `apps/feeds`。许可证 GPL-3.0-or-later。

定下来的（task-9b7w6，2026-11-24 用户定）：在这台 Mac 上抓，没有关注上限；社交平台走用户自己填的 RSSHub 地址（永远不默认用 rsshub.app，它回 403）；文章存本机 `node:sqlite`，只有「存进画布笔记」的那一篇进库；订阅、已读、星标、稍后读、划线经库里的 `.canvas-feeds/` 同步，每台设备一份只往后加的文件，跟着画布笔记已有的 Git 同步走。

## 两个入口

| 入口 | 能在哪用 | 有什么 |
|---|---|---|
| `@cn/feeds` | 哪都行（界面进程、主进程、以后照着移植的 iPad 版）：不碰 Electron、Node 模块、系统时间 | 类型（`types.ts`）、接口 `FeedsCore`（`api.ts`）、假实现 `createFakeFeeds`（`fake.ts`）、解析 `parseFeed`、`decodeBody`、`parseDate`、OPML `parseOpml` / `writeOpml`、找源 `findFeedLinks` / `knownFeeds` / `guessUrls`、RSSHub `resolveRoute` / `toRoute` / `suggestRoutes`、退避 `plan`、清洗 `sanitizeHtml`、同步 `replay` / `ordOf` / `effectsOf`、剪藏写法 `pageClipText` |
| `@cn/feeds/node` | Electron 主进程或普通 Node（22.5 以上） | `openFeeds(opts): Promise<FeedsCore>`：联网 `Http`、本机库 `Store`、抽全文 `extractPage` |

```ts
// 主进程
import { openFeeds } from '@cn/feeds/node'
const core = await openFeeds({ dataDir: app.getPath('userData'), deviceName: 电脑名, vaultDir: 画布笔记的库 ?? null })
core.startScheduler()
powerMonitor.on('resume', () => core.wake())
core.onChange((e) => win.webContents.send('feeds:changed', e))
// 界面开发、界面测试：不联网
import { createFakeFeeds } from '@cn/feeds'
```

## 规矩

- 编号：源 `f_` + sha256(规整后的地址) 前 16 位，文章 `a_` + sha256(源编号 + guid / 链接 / 内容哈希) 前 20 位，每台设备各抓各的也算得一样（`ids.ts`）。
- 去重：同一个源里先认 guid，没有认链接，再没有认标题加正文的哈希；guid 一样内容变了是改，不算新文章；guid 换了写法、链接一样也不算新的；两个源里同一个链接，全部和类型视图里只出一次（`dup_of`），标已读一起标。
- 抓：条件请求（ETag、Last-Modified），20 秒超时，最多 10 MB，自己跟跳转（一路 301 / 308 才换地址），同一站点同时最多 2 个、两次开始至少隔 0.5 秒，全局最多 8 个；编码按 BOM → HTTP 头 → `<?xml encoding>` → `<meta charset>` → UTF-8 → GB18030 → windows-1252 试，声明了读不通也往下试。
- 什么时候再抓（`schedule.ts`）：成功后按源的间隔（最少 15 分钟，ttl 更长听 ttl，最多 6 小时）；失败翻倍，24 小时封顶；连着 8 次、410、404 三次标坏，之后每天试一次；Retry-After 照办；每个源 ±10% 固定抖动。Mac 睡醒调 `wake()`。
- 清理：没星标、没稍后读、没划线的文章 90 天后清掉，每个源最多留 2000 篇（设置里能改）；清掉的记在 `gone` 里，源里还留着也不会再抓回来；90 天前发表的旧条目不进库。一篇正文最多存 512 KB，全文 1 MB。
- 搜索：FTS5 trigram（三个字以上走索引），一两个字（「缓存」）用 LIKE 在候选里筛；几个词都要有。
- 迁移：`store.ts` 的 `MIGRATIONS`，只往后加，`PRAGMA user_version` 记到第几步，一步一个事务。

## 同步（`sync.ts`）

`.canvas-feeds/<设备>.jsonl`，一行一条：`{v:1, d:设备, s:序号, t:时间, op, …}`，op 是 sub / unsub / feed / folder / unfolder / read / readAll / star / later / hl / unhl。设备名是电脑名加 4 位随机字（第一次打开时定，存在本机库里），两台同名的 Mac 也不撞文件。

合并：每条记录的全序键 `(t, d, s)`（时间、设备名、序号）；每条拆成字段写（`sub:<源>`、`feed:<源>:title`、`read:<文章>`、`star:<文章>`、`hl:<划线>`……），每个字段只认键最大的那一次（后写的赢）；整源已读每条都留着，一篇是不是已读看它自己的 read 写和盖住它的整源已读里键最大的那个。时钟 `t = max(现在, 见过的最大 t + 1)`，读到别的设备更晚的记录往上推，所以钟慢的那台后改的照样排在后面。同一组记录不管按什么顺序、读几遍，结果一样（`test/sync.test.ts` 打乱 50 种顺序比）。

除了存进画布笔记的那一篇和它的图，核心不往库里 `.canvas-feeds/` 以外写东西。`@cn/git` 的 `isInternalPath` 认 `.canvas-feeds/`：画布笔记的自动提交说明写「同步了订阅和已读」，历史默认不列。压缩以后做：一台设备把自己那份重写成还在赢的字段写，序号不变，别的设备发现文件变短从头读、按（设备，序号）去重。

## 存进画布笔记

写成和画布笔记「剪藏这一页」一字不差的一篇（`test/clip-parity.test.ts` 拿同一页同时跑画布笔记的 `webview-page.ts` extract、`page-clip.ts` pageClipText / localizeImages 和这里，比字节）：默认进收件箱（只有 `Inbox/` 的英文库进 `Inbox`），撞名加「 2」，图下到 `附件/<笔记路径>/`，一次提交能撤回。可选：AI 摘要（`[!ai] AI 总结` 块，放来源行下面）、划线（文末「## 划线」）。

剪藏的代码现在只在 `apps/notes` 里，这一批不动画布笔记，所以 `src/clip.ts`、`src/node/extract.ts`、`src/node/images.ts` 是照着的一份，以后抽成 `packages/clip` 时整份换成导入：

| 要抽的 | 现在在哪 |
|---|---|
| `pageClipText`、`clipFileName`、`localizeImages` | `apps/notes/src/main/web/page-clip.ts` |
| `extract`、`toMarkdown`（Turndown 规则）、`fixLazyImages`、`stripNoise`、`readableUrl` | `apps/notes/src/preload/webview-page.ts` |
| `codeLang`、`prepareMath`（公式读源 TeX、代码语言、藏起来的页签）、`texOf` 一族 | `apps/notes/src/preload/webview-md.ts` |
| `prepareClip`、`clipKeepsTranslation`（双语翻译的译文带不带） | `apps/notes/src/preload/plugins/translate.ts` |
| `mdUrl` | `apps/notes/src/shared/layout.ts` |
| `safeName` | `apps/notes/src/shared/file-name.ts` |
| `localStamp` | `apps/notes/src/main/vault.ts` |
| `saveImage`、`sniffImage`、`baseNameFor`、`download` | `apps/notes/src/main/web/save-image.ts` |

没照搬的：公式（读 MathJax / KaTeX 的源 TeX）和双语翻译插进去的译文；画布笔记用内置浏览器的登录分区下图，这里用普通联网，要登录才看得到的图留网址；画布笔记剪藏后记一条 `.canvas-notes/` 活动记录，这里不写（不碰 `.canvas-notes/`）。

## 第二批加的（task-w0w97）

- `Feed.mode`：`normal` 逐条、`muted` 静音、`digest` 汇总（`digestEvery` 每几篇），`updateFeed` 改，走同步记录 `feed`（字段 `feed:<源>:mode`、`feed:<源>:digest`）；静音、汇总的源不进全部、类型视图、文件夹的列表和未读数，`listArticles({ feedId })` 照样逐篇列。迁移第 2 步加了两列。
- `savedNote(id)`、`appendToNote(id, { highlights, text, message })`：存进画布笔记过的那篇（本机库 meta 里记着哪个库、库内路径），补上新划的线（接在「## 划线」一节的列表末尾，已经有同样 `==字==` 的不重写）、接一段 md（AI 问答），一次提交；`SaveOptions.extra` 存的时候接在文末。
- `syncStatus()`：库里的 .canvas-feeds/、上次同步的时间和没成的原因、这台设备还没写出去几条、读到过的设备。
- `later.ts`：稍后读写成画布今日的待办行（`laterLine`、`addLater`、`doneLater`、`laterTasks`），用 `@cn/tasks`；读写文件在 apps/feeds。
- RSSHub 路由 2026-11-25 照官方仓库 lib/routes 的路由定义核对过（见 `rsshub.ts` 的注释）；X、小红书的候选带 `hint`（要实例配登录）。

## 测试

`pnpm vitest run packages/feeds`：解析每种格式和坏源、编码、时间、清洗、找源、OPML 来回、条件请求和跳转（本机服务器，端口 0）、退避、定时器、迁移、搜索、去重、清理、两台设备同步、存进画布笔记和画布笔记一字不差。真联网的冒烟测试默认跳过：`FEEDS_SMOKE=1 pnpm vitest run packages/feeds/test/smoke.test.ts`。
