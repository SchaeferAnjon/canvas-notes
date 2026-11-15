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
  // AI 用的是用户自己装的命令行（claude、codex、gemini、opencode），包里不带任何 AI 的程序或 SDK
  files: ['out/**', 'package.json'],
  // 自动更新还没做：不写 publish，Release 由 scripts/release.mjs --publish 用 gh 建
  publish: null,
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
    },
  },
  dmg: { title: `${brand.name} \${version}` },
}
