import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// main/attachments.ts 在加载时要 electron；纯函数测试不需要它
vi.mock('electron', () => ({ net: {}, protocol: {}, dialog: {}, ipcMain: { on: () => undefined } }))

const { baseNameFor, saveImage, sniffImage } = await import('../src/main/web/save-image')
const { compareVersions, flattenBookmarks, historyRowsToEntries, listChromeExtensions, localizedName } = await import('../src/main/web/chrome-data')
const { hasAction, missingApis, verdictOf } = await import('../src/main/web/compat')
const { Bookmarks, History } = await import('../src/main/web/library')
const { clipFileName, localizeImages, pageClipText } = await import('../src/main/web/page-clip')

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-web-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.CN_CHROME_ROOT
})

it('书签：Chrome 的 Bookmarks 摊平成「书签栏 / 文件夹」路径，同网址只留一个，非网页不要', () => {
  const file = {
    roots: {
      bookmark_bar: {
        type: 'folder',
        name: 'Bookmarks bar',
        children: [
          { type: 'url', name: 'A', url: 'https://a.test/' },
          { type: 'folder', name: '工作 / 项目', children: [{ type: 'url', name: '', url: 'https://b.test/' }, { type: 'url', name: '重复', url: 'https://a.test/' }] },
          { type: 'url', name: '脚本', url: 'javascript:alert(1)' },
        ],
      },
      other: { type: 'folder', name: 'Other', children: [{ type: 'url', name: 'C', url: 'http://c.test/' }] },
    },
  }
  expect(flattenBookmarks(file)).toEqual([
    { title: 'A', url: 'https://a.test/', folder: '书签栏' },
    { title: 'https://b.test/', url: 'https://b.test/', folder: '书签栏 / 工作／项目' },
    { title: 'C', url: 'http://c.test/', folder: '其他书签' },
  ])
  expect(flattenBookmarks({})).toEqual([])
  expect(flattenBookmarks(null)).toEqual([])
})

it('历史：Chrome 的时间（1601 年起的微秒）换成毫秒，同网址只留一个，最多 max 条', () => {
  const t = BigInt(Math.round((1_800_000_000 + 11644473600) * 1e6))
  const rows = [
    { url: 'https://a.test/', title: 'A', visit_count: 3n, last_visit_time: t },
    { url: 'https://a.test/', title: 'A2', visit_count: 1n, last_visit_time: t },
    { url: 'file:///etc/hosts', title: 'x', visit_count: 1, last_visit_time: 0 },
    { url: 'https://b.test/', title: null, visit_count: 1, last_visit_time: 0 },
  ]
  expect(historyRowsToEntries(rows, 10)).toEqual([
    { url: 'https://a.test/', title: 'A', visits: 3, lastVisit: 1_800_000_000_000 },
    { url: 'https://b.test/', title: '', visits: 1, lastVisit: 0 },
  ])
  expect(historyRowsToEntries(rows, 1)).toHaveLength(1)
})

it('插件：版本号按数字比，名字到 _locales 里查（先中文），Chrome 里关着的标出来，主题不算', async () => {
  expect(compareVersions('1.10.0_0', '1.9.3_0')).toBeGreaterThan(0)
  expect(compareVersions('2.0', '2.0.0')).toBe(0)
  const prof = join(root, 'Default')
  const ext = (id: string, ver: string, manifest: object, files: Record<string, string> = {}) => {
    const d = join(prof, 'Extensions', id, ver)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'manifest.json'), '﻿' + JSON.stringify(manifest))
    for (const [n, c] of Object.entries(files)) {
      mkdirSync(join(d, n, '..'), { recursive: true })
      writeFileSync(join(d, n), c)
    }
    return d
  }
  const a = 'a'.repeat(32)
  ext(a, '1.9_0', { name: 'old', version: '1.9' })
  const d = ext(a, '1.10_0', { name: '__MSG_appName__', version: '1.10', default_locale: 'en' }, {
    '_locales/en/messages.json': JSON.stringify({ appName: { message: 'Reader' } }),
    '_locales/zh_CN/messages.json': JSON.stringify({ APPNAME: { message: '阅读器' } }),
  })
  ext('b'.repeat(32), '1_0', { name: 'Dark', version: '1', theme: {} })
  ext('c'.repeat(32), '2_0', { name: 'Off', version: '2' })
  writeFileSync(join(prof, 'Preferences'), JSON.stringify({ extensions: { settings: { ['c'.repeat(32)]: { state: 0 } } } }))
  process.env.CN_CHROME_ROOT = root
  expect(await localizedName(d, { name: '__MSG_appName__', default_locale: 'en' })).toBe('阅读器')
  const list = await listChromeExtensions('Default')
  expect(list.map((x) => [x.id[0], x.version, x.name, x.disabledInChrome])).toEqual([
    ['a', '1.10', '阅读器', false],
    ['c', '2', 'Off', true],
  ])
  await expect(listChromeExtensions('../x')).rejects.toThrow('Chrome 用户名不对')
  expect(await listChromeExtensions('Nobody')).toEqual([])
})

it('插件能不能用：内置浏览器没有的接口记下来；要和电脑上的程序通信、按规则拦请求的多半用不了', () => {
  expect(missingApis({ permissions: ['storage', 'tabs', 'contextMenus', 'activeTab', '<all_urls>', 'https://*/*'] })).toEqual([])
  expect(verdictOf([])).toBe('ok')
  const m = missingApis({ permissions: ['storage', 'alarms', 'nativeMessaging'], side_panel: { default_path: 'p.html' } })
  expect(m).toEqual(['alarms', 'nativeMessaging', 'sidePanel'])
  expect(verdictOf(m)).toBe('unlikely')
  expect(verdictOf(['alarms', 'idle'])).toBe('partial')
  expect(verdictOf(['declarativeNetRequest'])).toBe('unlikely')
  expect(hasAction({ action: {} })).toBe(true)
  expect(hasAction({ browser_action: {} })).toBe(true)
  expect(hasAction({})).toBe(false)
})

it('书签存在设置目录：加、同网址不重复、删、导入时跳过已有的；重新读出来一样', () => {
  const f = join(root, 'web', 'bookmarks.json')
  const b = new Bookmarks(f)
  b.add({ title: 'A', url: 'https://a.test/' }, 1)
  b.add({ title: 'A again', url: 'https://a.test/' }, 2)
  expect(() => b.add({ title: 'x', url: 'javascript:1' })).toThrow('http')
  expect(b.merge([{ title: 'A', url: 'https://a.test/', folder: '书签栏' }, { title: 'B', url: 'https://b.test/', folder: '书签栏 / 工作' }])).toBe(1)
  expect(b.all().map((x) => [x.title, x.folder])).toEqual([
    ['A', '书签栏'],
    ['B', '书签栏 / 工作'],
  ])
  const again = new Bookmarks(f)
  expect(again.all()).toEqual(b.all())
  again.remove(again.all()[0]!.id)
  expect(new Bookmarks(f).all().map((x) => x.title)).toEqual(['B'])
  expect(readdirSync(join(root, 'web'))).toEqual(['bookmarks.json'])
})

it('历史：同一网址合并成一条挪到最前；按标题和网址（中文网址也行）搜；导入合并次数和时间', () => {
  const f = join(root, 'history.json')
  const h = new History(f)
  h.visit('https://a.test/冰岛', '', 1)
  h.title('https://a.test/冰岛', '冰岛攻略')
  h.visit('https://b.test/', 'B', 2)
  h.visit('https://a.test/冰岛', '', 3)
  h.visit('chrome://settings', 'x', 4)
  expect(h.search('').map((x) => [x.url, x.visits, x.title])).toEqual([
    ['https://a.test/冰岛', 2, '冰岛攻略'],
    ['https://b.test/', 1, 'B'],
  ])
  expect(h.search('攻略').length).toBe(1)
  expect(h.search('a.test 冰岛').length).toBe(1)
  expect(h.search('冰岛 b.test').length).toBe(0)
  expect(h.merge([{ url: 'https://b.test/', title: 'B', visits: 9, lastVisit: 10 }, { url: 'https://c.test/', title: 'C', visits: 1, lastVisit: 0 }])).toBe(1)
  expect(h.search('').map((x) => x.url)).toEqual(['https://b.test/', 'https://a.test/冰岛', 'https://c.test/'])
  expect(new History(f).search('').length).toBe(3)
})

it('图片附件：按文件头认格式，名字取说明或网址最后一段，重名加 -2；不是图不存', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  expect(sniffImage(png)).toBe('png')
  expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg')
  expect(sniffImage(Buffer.from('hello'))).toBeNull()
  expect(baseNameFor('https://x.test/a/%E5%9B%BE%20one.jpg?x=1')).toBe('图-one')
  expect(baseNameFor('地图 (1) [草稿].png')).toBe('地图-1-草稿')
  expect(baseNameFor(undefined)).toBe('图片')
  expect(baseNameFor('..')).toBe('图片')
  const ses = {} as Electron.Session
  expect(await saveImage(root, ses, { kind: 'bytes', bytes: png, type: 'application/octet-stream' }, '黑沙滩')).toBe('附件/黑沙滩.png')
  expect(await saveImage(root, ses, { kind: 'bytes', bytes: png, type: 'image/png' }, '黑沙滩')).toBe('附件/黑沙滩-2.png')
  expect(await saveImage(root, ses, { kind: 'url', url: `data:image/png;base64,${png.toString('base64')}` })).toBe('附件/图片.png')
  await expect(saveImage(root, ses, { kind: 'bytes', bytes: Buffer.from('<html>'), type: 'text/html' })).rejects.toThrow('不是图片')
  await expect(saveImage(root, ses, { kind: 'url', url: 'file:///etc/hosts' })).rejects.toThrow('http')
  expect(readFileSync(join(root, '附件', '黑沙滩.png')).equals(png)).toBe(true)
  // 给了笔记：存进这篇自己的附件文件夹；剪贴板截图起名「截图 1」「截图 2」（CN-40 A）
  expect(await saveImage(root, ses, { kind: 'bytes', bytes: png, type: 'image/png', name: 'image.png' }, undefined, { note: '课程/未命名 3.md', shot: true })).toBe('附件/课程/未命名 3/截图 1.png')
  expect(await saveImage(root, ses, { kind: 'bytes', bytes: png, type: 'image/png', name: 'image.png' }, undefined, { note: '课程/未命名 3.md', shot: true })).toBe('附件/课程/未命名 3/截图 2.png')
  expect(await saveImage(root, ses, { kind: 'bytes', bytes: png, type: 'image/png' }, '黑沙滩', { note: '课程/未命名 3.md' })).toBe('附件/课程/未命名 3/黑沙滩.png')
})

it('整页剪藏顺手把网上的图存进这篇的附件、正文改成相对路径（第 8 轮）：套着链接的图只留图，同一张只存一次，存不下的留网址', async () => {
  const text =
    '# 冰岛\n\n![黑沙滩](https://x.test/a.png)\n\n[![](https://x.test/b%20c.jpg?w=250)](https://x.test/File:b)\n\n再来一次 ![](https://x.test/a.png) 在字里。\n\n![坏的](https://x.test/404.png)\n\n![本地](附件/已有.png)\n'
  const asked: string[] = []
  const save = async (url: string) => {
    asked.push(url)
    if (url.includes('404')) throw new Error('图片下载失败（404）')
    return url.includes('a.png') ? '附件/收件箱/冰岛/a.png' : '附件/收件箱/冰岛/b c.jpg'
  }
  const out = await localizeImages(text, '收件箱/冰岛.md', save)
  expect(asked.sort()).toEqual(['https://x.test/404.png', 'https://x.test/a.png', 'https://x.test/b%20c.jpg?w=250'])
  expect(out.files.sort()).toEqual(['附件/收件箱/冰岛/a.png', '附件/收件箱/冰岛/b c.jpg'])
  expect(out.text).toBe(
    '# 冰岛\n\n![黑沙滩](../附件/收件箱/冰岛/a.png)\n\n![](../附件/收件箱/冰岛/b%20c.jpg)\n\n再来一次 ![](../附件/收件箱/冰岛/a.png) 在字里。\n\n![坏的](https://x.test/404.png)\n\n![本地](附件/已有.png)\n',
  )
  // 过了时限还没轮到的留网址
  const late = await localizeImages(text, '收件箱/冰岛.md', save, { deadline: Date.now() - 1 })
  expect(late).toEqual({ text, files: [] })
})

it('整页剪藏的文件：文件名去掉网站名尾巴，frontmatter 带 created 和 source，正文前面是标题和来源', () => {
  expect(clipFileName('冰岛的黑沙滩 - 旅行杂志', 'https://x.test/a')).toBe('冰岛的黑沙滩')
  expect(clipFileName('A | B | Medium', 'https://x.test/a')).toBe('A | B')
  expect(clipFileName('', 'https://www.x.test/a')).toBe('x.test')
  expect(pageClipText({ url: 'https://x.test/a', title: '冰岛的黑沙滩 - 旅行杂志', markdown: '## 冰岛的黑沙滩\n\n正文' }, 's')).toBe(
    '---\ncreated: s\nsource: https://x.test/a\n---\n# 冰岛的黑沙滩 - 旅行杂志\n\n—— [冰岛的黑沙滩 - 旅行杂志](https://x.test/a)\n\n正文\n',
  )
  expect(pageClipText({ url: 'https://x.test/a (1)', title: '标题 [草稿]', byline: '张三', markdown: '正文\r\n\r\n\r\n\r\n下一段\n' }, '2026-11-15 10:00')).toBe(
    '---\ncreated: 2026-11-15 10:00\nsource: https://x.test/a (1)\n---\n# 标题 [草稿]\n\n—— [标题 草稿](https://x.test/a%20%281%29) · 张三\n\n正文\n\n下一段\n',
  )
})
