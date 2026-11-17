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
  // AI 用的是用户自己装的命令行（claude、codex、gemini、opencode），包里不带任何 AI 的程序或 SDK；
  // 按意思搜的本机小模型 multilingual-e5-small（MIT，scripts/fetch-model.mjs 下好的）跑在 onnxruntime-node 上：只带 Mac arm64 那份原生库，别的平台的去掉
  files: ['out/**', 'package.json', '!**/node_modules/onnxruntime-node/bin/napi-v*/{win32,linux}/**', '!**/node_modules/pdfjs-dist/{web,image_decoders,build}/**', '!**/node_modules/@napi-rs/**', '!**/*.map'],
  // 原生库（.node、.dylib）不能放在 asar 里
  asarUnpack: ['**/node_modules/onnxruntime-node/**'],
  // 新网页标签用的 BookmarkKeeper（MIT）：软件只用包里这一份（汉化过，见 resources/bookmarkkeeper/SOURCE.json）
  extraResources: [
    { from: 'resources/bookmarkkeeper', to: 'bookmarkkeeper' },
    { from: 'resources/models/multilingual-e5-small', to: 'models/multilingual-e5-small' },
    // 没字幕的视频生成字幕时下载音频用（scripts/fetch-ytdlp.mjs 下好，软件里 main/video/index.ts 的 bundledYtDlp 找它）
    { from: 'resources/bin', to: 'bin' },
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
      NSDownloadsFolderUsageDescription: `${brand.name} 拍导图的窗口开着时，拿你用隔空投送传到「下载」里的照片。`,
    },
  },
  dmg: { title: `${brand.name} \${version}` },
}
