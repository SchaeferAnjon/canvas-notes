// 应用图标和菜单栏图标：从 design/v3/icon/ 里选定的那一个生成
//   build/icon.png（1024，开发时的程序坞图标）、build/icon.icns（打包用，electron-builder.yml 的 mac.icon）、
//   src/main/tray-icon.ts（菜单栏模板图 16 和 32，base64）。
// 换图标只改下面 PICK 一处，再跑 `node scripts/make-icons.mjs`。要 macOS 自带的 sips 和 iconutil。
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PICK = '1-cards'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(app, '../../design/v3/icon')
const icon = join(src, `icon-${PICK}.png`)
const build = join(app, 'build')
mkdirSync(build, { recursive: true })
copyFileSync(icon, join(build, 'icon.png'))

const tmp = mkdtempSync(join(tmpdir(), 'cn-icon-'))
const set = join(tmp, 'icon.iconset')
mkdirSync(set)
for (const s of [16, 32, 128, 256, 512]) {
  execFileSync('sips', ['-z', String(s), String(s), icon, '--out', join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
  execFileSync('sips', ['-z', String(s * 2), String(s * 2), icon, '--out', join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(build, 'icon.icns')])
rmSync(tmp, { recursive: true, force: true })

const b64 = (f) => 'data:image/png;base64,' + readFileSync(join(src, f)).toString('base64')
writeFileSync(
  join(app, 'src/main/tray-icon.ts'),
  `/** 菜单栏图标：design/v3/icon/menubar-${PICK}Template（「一叠卡片」），黑色模板图（系统按深浅色自己换色），16px 和 32px 两份。由 scripts/make-icons.mjs 生成 */\n` +
    `export const TRAY_1X = '${b64(`menubar-${PICK}Template.png`)}'\n` +
    `export const TRAY_2X = '${b64(`menubar-${PICK}Template@2x.png`)}'\n`,
)
console.log('好了：build/icon.png、build/icon.icns、src/main/tray-icon.ts')
