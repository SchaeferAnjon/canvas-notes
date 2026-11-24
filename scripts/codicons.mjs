// 把用到的 Codicons（VS Code 的图标库，CC BY 4.0，版本钉在 packages/design/package.json）拷成 packages/design/src/codicons.gen.ts。
// 要用新图标：加进下面的 USED，再跑一次 `node scripts/codicons.mjs`。名字查 https://microsoft.github.io/vscode-codicons/dist/codicon.html
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'packages/design/node_modules/@vscode/codicons')
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version

const USED = `
account add archive markdown debug-pause type-hierarchy-sub pass-filled arrow-both eye-closed arrow-circle-up arrow-down arrow-left arrow-right arrow-swap arrow-up beaker bell
blank book bookmark briefcase calendar check checklist chevron-down chevron-left chevron-right chevron-up circle-filled
circle-slash circuit-board claude clockface close cloud-download code coffee collapse-all comment
comment-discussion-sparkle copy cursor desktop-download device-camera device-camera-video device-mobile
discard edit ellipsis error extensions eye file file-code file-media file-pdf file-text files filter flag
folder folder-library folder-opened git-branch git-commit globe go-to-file graph gripper heart history home
horizontal-rule inbox info insert database symbol-string symbol-boolean symbol-enum sort-precedence key layers layout layout-centered layout-sidebar-left layout-sidebar-left-off layout-sidebar-right
layout-sidebar-right-off library lightbulb link link-external list-filter list-flat list-ordered list-tree
list-unordered loading lock mortar-board music new-file new-folder note open-in-product openai paintcan pass
pin pinned play preview primitive-square project question quote record-keys refresh robot root-folder
screen-full screen-normal search send settings settings-gear shield sign-in source-control sparkle split-horizontal
star-empty star-full symbol-color symbol-numeric sync table tag target terminal text-size trash type-hierarchy vm
wand warning whitespace whole-word workspace-trusted zoom-in zoom-out
save git-compare fold-up fold-down unfold fold mic debug-stop diff-single
notebook map rocket flame tools compass mail organization
symbol-keyword dash list-selection arrow-small-left arrow-small-right percentage triangle-down triangle-up check-all arrow-circle-down
graph-line move
comment-discussion symbol-operator location references
reply multiple-windows split-vertical mention
symbol-event
arrow-circle-right watch
group-by-ref-type issues symbol-method
expand-all
tasklist play-circle run-all
replace surround-with symbol-namespace export
milestone merge circle-large case-sensitive
combine screen-cut indent
mic-filled chip plug
remove graph-scatter
`.split(/\s+/).filter(Boolean)

const body = USED.map((n) => {
  const svg = readFileSync(join(pkg, 'src/icons', n + '.svg'), 'utf8')
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()
  // 大多数是 16 的格子，少数（files 等）是 24 的：照原样带上
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 16 16'
  return `  '${n}': [${JSON.stringify(vb)}, ${JSON.stringify(inner)}],`
}).join('\n')

writeFileSync(
  join(root, 'packages/design/src/codicons.gen.ts'),
  `// 生成的文件，别手改：node scripts/codicons.mjs\n// Codicons ${version} · © Microsoft Corporation · CC BY 4.0 · https://github.com/microsoft/vscode-codicons\nexport type CodiconName =\n${USED.map((n) => `  | '${n}'`).join('\n')}\n/** 名字 → [viewBox, 图形]：多数是 16 的格子，少数是 24 的 */\nexport const CODICONS: Record<CodiconName, readonly [string, string]> = {\n${body}\n}\n`,
)
// 整套（「设图标和颜色」里的搜索框搜整套用；界面用到时才加载，不进主包）：名字 → [viewBox, 图形, 搜索用的英文标签]
const meta = JSON.parse(readFileSync(join(pkg, 'dist/metadata.json'), 'utf8'))
const all = readdirSync(join(pkg, 'src/icons'))
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -4))
  .sort()
const allBody = all
  .map((n) => {
    const svg = readFileSync(join(pkg, 'src/icons', n + '.svg'), 'utf8')
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()
    const vb = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 16 16'
    const tags = (meta[n]?.tags ?? []).join(' ')
    return `  '${n}': [${JSON.stringify(vb)}, ${JSON.stringify(inner)}, ${JSON.stringify(tags)}],`
  })
  .join('\n')
writeFileSync(
  join(root, 'packages/design/src/codicons-all.gen.ts'),
  `// 生成的文件，别手改：node scripts/codicons.mjs\n// Codicons ${version} 整套 · © Microsoft Corporation · CC BY 4.0 · https://github.com/microsoft/vscode-codicons\nexport const ALL_CODICONS: Record<string, readonly [string, string, string]> = {\n${allBody}\n}\n`,
)
console.log(`Codicons ${version}：${USED.length} 个图标，整套 ${all.length} 个`)
