#!/usr/bin/env node
// 官网自查：本机起静态服务器给 website/，用 Chromium 按 420、800、1200、1600 四个宽度、浅深两色截整页，
// 再查没有横向滚动、图片都加载了、下载按钮按 GitHub 接口换了链接、语言能切。不联网：GitHub 接口在这里假装。
//   node scripts/site-check.mjs [输出文件夹]   默认 website/.check/（不进 git）
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = path.join(ROOT, 'website')
const OUT = path.resolve(process.argv[2] || path.join(SITE, '.check'))
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'release/brand.json'), 'utf8'))
const require = createRequire(path.join(ROOT, 'apps/notes/package.json'))
const { chromium } = require('@playwright/test')
fs.mkdirSync(OUT, { recursive: true })

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }
const server = http.createServer((req, res) => {
  const p = path.join(SITE, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'))
  if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(fs.readFileSync(p))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

const RELEASE = {
  tag_name: 'v0.1.0',
  published_at: '2026-11-20T10:00:00Z',
  assets: ['arm64', 'x64'].flatMap((a) => [
    { name: `${brand.artifact}-0.1.0-mac-${a}.dmg`, size: 127_500_000, browser_download_url: `https://github.com/${brand.repo}/releases/download/v0.1.0/${brand.artifact}-0.1.0-mac-${a}.dmg` },
    { name: `${brand.artifact}-mac-${a}.dmg`, size: 127_500_000, browser_download_url: `https://github.com/${brand.repo}/releases/download/v0.1.0/${brand.artifact}-mac-${a}.dmg` },
  ]),
}

// 用本机装的 Chrome（无头、临时资料夹），不另下 Playwright 的浏览器
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const problems = []
const check = (ok, msg) => { if (!ok) problems.push(msg) }
try {
  for (const scheme of ['light', 'dark']) {
    for (const width of [420, 800, 1200, 1600]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme, locale: 'zh-CN', deviceScaleFactor: 1 })
      // 第一版发布之前：接口 404
      await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 404, body: '{"message":"Not Found"}' }))
      await page.goto(base + '?lang=zh', { waitUntil: 'networkidle' })
      await page.evaluate(() => Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r }) })))
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        broken: [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')),
        dl: document.querySelector('[data-dl="arm64"]').href,
        ver: document.querySelector('.ver2').textContent,
      }))
      check(m.sw <= m.cw, `${width} ${scheme}：有横向滚动（${m.sw} > ${m.cw}）`)
      check(!m.broken.length, `${width} ${scheme}：图片没加载 ${m.broken.join(', ')}`)
      check(m.dl === `https://github.com/${brand.repo}/releases`, `${width} ${scheme}：还没有 Release 时下载按钮应指向发布页，是 ${m.dl}`)
      check(m.ver.includes('第一版还在准备'), `${width} ${scheme}：还没有 Release 时没写「第一版还在准备」`)
      await page.screenshot({ path: path.join(OUT, `site-${width}-${scheme}.png`), fullPage: true })
      await page.screenshot({ path: path.join(OUT, `site-${width}-${scheme}-top.png`) })
      await page.close()
    }
  }

  // 有 Release 之后：按钮换成带版本号的文件，写上版本和日期；切英文
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: 'en-US' })
  await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RELEASE) }))
  await page.goto(base, { waitUntil: 'networkidle' })
  const en = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    h1: document.querySelector('h1').textContent,
    arm: document.querySelector('[data-dl="arm64"]').href,
    x64: document.querySelector('[data-dl="x64"]').href,
    fn: document.querySelector('[data-fn="arm64"]').textContent,
    ver: document.querySelector('.ver2').textContent,
    foot: document.getElementById('ver').textContent,
  }))
  check(en.lang === 'en' && en.h1.startsWith('Save anything'), `浏览器是英文时应该显示英文：${en.lang} ${en.h1}`)
  check(en.arm.endsWith(`${brand.artifact}-0.1.0-mac-arm64.dmg`) && en.x64.endsWith(`${brand.artifact}-0.1.0-mac-x64.dmg`), `下载链接没换成最新一版：${en.arm} ${en.x64}`)
  check(en.fn.includes('128 MB') || en.fn.includes('127 MB'), `文件名一行没写大小：${en.fn}`)
  check(en.ver.includes('v0.1.0') && en.foot === 'v0.1.0', `没写最新版本：${en.ver} / ${en.foot}`)
  await page.locator('#download').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(OUT, 'site-1200-en-download.png') })
  // 点「简」切回中文，记住选择
  await page.locator('.seg button[data-lang="zh"]').click()
  const zh = await page.evaluate(() => ({ lang: document.documentElement.lang, h1: document.querySelector('h1').textContent, saved: localStorage.getItem('cn.lang') }))
  check(zh.lang === 'zh-CN' && zh.h1.startsWith('随手存') && zh.saved === 'zh', `切回中文不对：${JSON.stringify(zh)}`)
  await page.close()
} finally {
  await browser.close()
  server.close()
}
if (problems.length) {
  console.error(problems.map((p) => '  ' + p).join('\n'))
  process.exit(1)
}
console.log(`官网自查都过了，截图在 ${OUT}`)
