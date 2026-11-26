// electron-builder 配置。名字、Bundle ID、签名证书读 release/brand.json（全仓库只写那一处）。
// 两种用法：
//   pnpm --filter @cn/notes dist:mac          本机自己用：本地签名（不用开发者证书）、不公证，只出 release/mac-arm64/<名字>.app
//   CN_RELEASE=1（scripts/release.mjs 设的）   发布：Developer ID 签名、hardened runtime、dmg + zip；
//                                             再加 CN_NOTARIZE=1 时 electron-builder 用钥匙串里 notarytool 的 profile 公证并钉上票据
const brand = require('../../release/brand.json')

const release = process.env.CN_RELEASE === '1'
const notarize = release && process.env.CN_NOTARIZE === '1'
if (notarize && !process.env.APPLE_KEYCHAIN_PROFILE) throw new Error('公证要 APPLE_KEYCHAIN_PROFILE（scripts/release.mjs 会设）')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: brand.appId,
  productName: brand.name,
  artifactName: `${brand.artifact}-\${version}-\${os}-\${arch}.\${ext}`,
  copyright: `Copyright © ${brand.year} ${brand.author}`,
  directories: { output: process.env.CN_RELEASE_OUT || 'release', buildResources: 'build' },
  // AI 先用用户自己装的命令行（claude、codex、gemini、opencode）；一个都没装、填了 API Key 要动手时用包里带的 OpenCode（MIT，task-587os，下面 extraResources）；
  // 按意思搜的本机小模型 multilingual-e5-small（MIT，scripts/fetch-model.mjs 下好的）跑在 onnxruntime-node 上：只带 Mac arm64 那份原生库，别的平台的去掉
  // 梦游找候选的 bge-m3 跑在 node-llama-cpp 上（MIT）：只带 Mac arm64 Metal 那份预编译（@node-llama-cpp/mac-arm64-metal），
  // 不带它本机编译用的 llama.cpp 源码包、CMake 脚本、模板；模型文件（GGUF）不进包，第一次用时下到用户的缓存目录（src/main/search/embed-model.ts）
  files: [
    'out/**',
    'package.json',
    '!**/node_modules/onnxruntime-node/bin/napi-v*/{win32,linux}/**',
    '!**/node_modules/pdfjs-dist/{web,image_decoders,build}/**',
    '!**/node_modules/@napi-rs/**',
    '!**/node_modules/node-llama-cpp/llama/{gitRelease.bundle,addon,cmake,toolchains,xpack,patches,profiles,CMakeLists.txt}',
    '!**/node_modules/node-llama-cpp/llama/{addon,cmake,toolchains,xpack,patches,profiles}/**',
    '!**/node_modules/node-llama-cpp/templates/**',
    '!**/node_modules/@node-llama-cpp/{mac-x64,linux-*,win-*}/**',
    '!**/*.{gguf,gguf.part}',
    '!**/*.map',
  ],
  // 原生库（.node、.dylib、Metal 的 .metallib）不能放在 asar 里；node-llama-cpp 按自己的目录结构找预编译，整个解出来
  asarUnpack: ['**/node_modules/onnxruntime-node/**', '**/node_modules/node-llama-cpp/**', '**/node_modules/@node-llama-cpp/**'],
  // 新网页标签用的 BookmarkKeeper（MIT）：软件只用包里这一份（汉化过，见 resources/bookmarkkeeper/SOURCE.json）
  extraResources: [
    { from: 'resources/bookmarkkeeper', to: 'bookmarkkeeper' },
    // 大模型 bge-m3 不进包：第一次用时下到用户级缓存（src/main/search/embed-model.ts）
    { from: 'resources/models/multilingual-e5-small', to: 'models/multilingual-e5-small' },
    // 没字幕的视频生成字幕时下载音频用（scripts/fetch-ytdlp.mjs 下好，软件里 main/video/index.ts 的 bundledYtDlp 找它）
    { from: 'resources/bin', to: 'bin' },
    // 对外接口的小程序 canvas-notes-mcp（task-av5t8）：一段 sh，用包里的 Electron 当 Node 跑 app.asar/out/main/mcp-stdio.js
    { from: 'resources/mcp', to: 'bin' },
    // 没装命令行时动手用的 OpenCode（MIT，scripts/fetch-opencode.mjs 钉死版本和 sha512 下好；按打的架构带那一份，main/agent/sources.ts 的 bundledOpencode 找它）
    { from: 'resources/opencode/darwin-${arch}', to: 'opencode', filter: ['opencode'] },
    // 软件只用的 git（GPL-2.0，scripts/fetch-git.mjs 从 dugite-native 官方 Release 下、按 sha256 核对、去掉用不着的，约 8 MB；
    // 按打的架构带那一份，main/bundled-git.ts 让 @cn/git 只起它）。签名时 electron-builder 连这里的 git 程序一起签（hardened runtime）
    { from: 'resources/git/darwin-${arch}', to: 'git', filter: ['**/*', '!VERSION'] },
  ],
  // 检查更新（src/main/updater.ts）查这个仓库的 Release 里的 latest-mac.yml。只有发布包写 publish：
  // 打包时会把 app-update.yml 放进包里，软件看到它才查更新；本机自己打的包没有它，不查。Release 还是由 scripts/release.mjs --publish 用 gh 建
  // Anki 卡背面「打开原文」的 canvas-notes://open?file=…&page=… 回到软件里这份 PDF 的那一页
  protocols: [{ name: brand.name, schemes: ['canvas-notes'] }],
  publish: release ? { provider: 'github', owner: brand.repo.split('/')[0], repo: brand.repo.split('/')[1], releaseType: 'release' } : null,
  mac: {
    category: 'public.app-category.productivity',
    // 应用图标「一叠卡片」：由 scripts/make-icons.mjs 从 design/v3/icon/ 生成
    icon: 'build/icon.icns',
    target: release ? ['dmg', 'zip'] : 'dir',
    identity: release ? brand.signing.identity : '-',
    hardenedRuntime: release,
    gatekeeperAssess: false,
    entitlements: release ? 'build/entitlements.mac.plist' : undefined,
    entitlementsInherit: release ? 'build/entitlements.mac.plist' : undefined,
    notarize,
    minimumSystemVersion: '12.0',
    extendInfo: {
      CFBundleDisplayName: brand.name,
      // 速记：从前台的浏览器读当前网页的标题和网址、让「系统事件」按 ⌘C 拿选中的字（osascript）
      NSAppleEventsUsageDescription: `${brand.name} 速记时读前台浏览器当前网页的标题和网址，并复制你选中的字，存进收件箱时带上来源。`,
      // 拍手写导图：用 Mac 摄像头或 iPhone（连续互通相机）拍；拍照窗口开着时看「下载」里隔空投送来的照片
      NSCameraUsageDescription: `${brand.name} 用摄像头拍你手写的导图，认成白板上的导图。`,
      NSCameraUseContinuityCameraDeviceType: true,
      // 费曼学习的语音输入：麦克风的声音送 Soniox 实时听写成字（task-yvabi）
      NSMicrophoneUsageDescription: `${brand.name} 在费曼学习里听你讲，用 Soniox 边说边转成字放进回答框。`,
      NSDownloadsFolderUsageDescription: `${brand.name} 拍导图的窗口开着时，拿你用隔空投送传到「下载」里的照片。`,
      // 让 iPhone / iPad 用这台 Mac 的 AI（task-wwqf0）：设置里打开后用 Bonjour 在局域网里报一声（macOS 15 起这算本地网络权限）
      NSLocalNetworkUsageDescription: `${brand.name} 在同一个 Wi‑Fi 里让你的 iPhone、iPad 找到这台 Mac，用这里的 AI 回答问题。`,
      NSBonjourServices: ['_canvasnotes._tcp'],
      // 「日历」格读系统日历（只读，task-kzr3n）：起的是画布今日的小助手，系统把它记在画布笔记名下问权限
      NSCalendarsFullAccessUsageDescription: `${brand.name} 在「日历」里只读显示系统日历的日程，排时间时避开它们。`,
      NSCalendarsUsageDescription: `${brand.name} 在「日历」里只读显示系统日历的日程，排时间时避开它们。`,
    },
  },
  dmg: { title: `${brand.name} \${version}` },
}
