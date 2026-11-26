#!/usr/bin/env node
// 白板自带贴纸（设计页 145，36 张，自己画的、CC0）：从设计稿 design/ink-decor/src/decor.js 取出每张的 SVG，
// 写成 packages/design/stickers/<k>.svg（Mac 直接用、第一次用时拷进库里的 附件/贴纸/），
// 再用 Playwright 的 Chromium 画成 PNG 给 iPhone / iPad（apps/apple/CanvasNotes/Resources/Stickers/<k>.png，四倍：读的时候 UIImage(data:scale: 4)）。
//   node scripts/stickers.mjs          重新生成（改了设计稿里的贴纸再跑）
//   node scripts/stickers.mjs --check  只核对 SVG 和设计稿一样（测试里跑）
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SVG_DIR = join(ROOT, 'packages/design/stickers')
const PNG_DIR = join(ROOT, 'apps/apple/CanvasNotes/Resources/Stickers')

export function designStickers() {
  const src = readFileSync(join(ROOT, 'design/ink-decor/src/decor.js'), 'utf8')
  const window = {}
  vm.runInNewContext(src, { window, encodeURIComponent, Math, Object, String, Number, Array })
  const { STICKERS, PACKS } = window.DECOR
  return Object.values(STICKERS).map((s) => ({ k: s.k, name: s.name, pack: s.pack, wide: s.wide, svg: s.svg.replace('<svg ', `<svg width="${s.wide ? 96 : 64}" height="${s.wide ? 48 : 64}" `), packName: PACKS[s.pack] }))
}

const list = designStickers()
if (list.length !== 36) throw new Error(`设计稿里的贴纸是 ${list.length} 张，不是 36 张`)

if (process.argv.includes('--check')) {
  const bad = list.filter((s) => {
    try {
      return readFileSync(join(SVG_DIR, `${s.k}.svg`), 'utf8') !== s.svg + '\n'
    } catch {
      return true
    }
  })
  if (bad.length) {
    console.error(`贴纸 SVG 和设计稿不一样：${bad.map((s) => s.k).join(' ')}（跑 node scripts/stickers.mjs）`)
    process.exit(1)
  }
  console.log('36 张贴纸 SVG 和设计稿一样')
  process.exit(0)
}

mkdirSync(SVG_DIR, { recursive: true })
mkdirSync(PNG_DIR, { recursive: true })
for (const s of list) writeFileSync(join(SVG_DIR, `${s.k}.svg`), s.svg + '\n')

// Playwright 用画布笔记 devDependencies 里的那份
const { chromium } = createRequire(join(ROOT, 'apps/notes/package.json'))('@playwright/test')
const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 4 })
for (const s of list) {
  const w = s.wide ? 96 : 64
  const h = s.wide ? 48 : 64
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<html><body style="margin:0;background:transparent">${s.svg}</body></html>`)
  await page.locator('svg').screenshot({ path: join(PNG_DIR, `${s.k}.png`), omitBackground: true })
}
await browser.close()
console.log(`写了 ${list.length} 张：${SVG_DIR}、${PNG_DIR}（${readdirSync(PNG_DIR).length} 个文件）`)
