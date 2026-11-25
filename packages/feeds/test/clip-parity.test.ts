/**
 * 存进画布笔记 = 画布笔记「剪藏这一页」：同一页同时跑两边，比字节。
 * 画布笔记那边是真的代码：apps/notes/src/preload/webview-page.ts 的 extract（网页预加载里抽正文、转 md）、
 * apps/notes/src/main/web/page-clip.ts 的 pageClipText、clipFileName、localizeImages；这里给它一个 jsdom 当网页
 * （它在 Electron 里用的是 Chromium 的 DOM）。双语翻译插件的预加载换成「没开翻译」，electron 换成空壳。
 * 网页由本机服务器给（端口 0），画布订阅这边从订阅、抓全文到写进库全走真的 openFeeds。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { clipFileName, localStamp, pageClipText } from '../src/clip'
import { extractPage } from '../src/node/extract'
import { clock, openTest, rssOf, tempDir } from './helpers'
import { send, startServer } from './server'

vi.mock('../../../apps/notes/node_modules/electron/index.js', () => ({ ipcRenderer: { on: () => undefined, send: () => undefined, sendToHost: () => undefined, invoke: async () => undefined }, ipcMain: { on: () => undefined } }))
vi.mock('../../../apps/notes/src/preload/plugins/translate', () => ({ clipKeepsTranslation: () => false, prepareClip: () => undefined }))

const html = readFileSync(join(__dirname, 'fixtures/page-article.html'), 'utf8')
// 1×1 的 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const PAGE = '/2026/local-first.html'
const srv = await startServer({
  [PAGE]: send(html, 'text/html; charset=utf-8'),
  '/feed.xml': (req, res) =>
    send(rssOf('示例周刊', [{ guid: '374', title: '本地优先软件的第二春', link: `http://${req.headers.host}${PAGE}`, date: Date.UTC(2026, 10, 24), body: '<p>只有一句摘要。</p>' }]))(req, res),
  '/img/desk.jpg': send(PNG, 'image/png'),
  '/img/lazy.png': send(PNG, 'application/octet-stream'),
})
afterAll(() => srv.close())

// 画布笔记的预加载要一个「网页」：同一页、同一个网址
const dom = new JSDOM(html, { url: srv.url(PAGE), virtualConsole: new VirtualConsole() })
const saved: Record<string, PropertyDescriptor | undefined> = {}
for (const k of ['window', 'document', 'location', 'getComputedStyle', 'Node', 'Element', 'HTMLElement', 'HTMLScriptElement', 'HTMLAnchorElement', 'HTMLImageElement', 'HTMLTableElement', 'DragEvent', 'MouseEvent', 'KeyboardEvent', 'innerWidth', 'innerHeight', 'navigator']) {
  saved[k] = Object.getOwnPropertyDescriptor(globalThis, k)
  const v = (dom.window as unknown as Record<string, unknown>)[k]
  Object.defineProperty(globalThis, k, { value: typeof v === 'function' && k === 'getComputedStyle' ? v.bind(dom.window) : v, configurable: true, writable: true })
}
afterAll(() => {
  for (const [k, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(globalThis, k, d)
    else delete (globalThis as Record<string, unknown>)[k]
  }
})
const notesPage = await import('../../../apps/notes/src/preload/webview-page')
const notesClip = await import('../../../apps/notes/src/main/web/page-clip')

describe('和画布笔记剪藏一字不差', () => {
  it('抽正文、转 md、拼成一篇：两边一样', () => {
    const theirs = notesPage.extract()
    const ours = extractPage(html, srv.url(PAGE))
    expect(ours.title).toBe(theirs.title)
    expect(ours.byline).toBe(theirs.byline)
    expect(ours.markdown).toBe(theirs.markdown)
    const stamp = '2026-11-25 09:30'
    expect(pageClipText({ url: ours.url, title: ours.title, markdown: ours.markdown, ...(ours.byline ? { byline: ours.byline } : {}) }, stamp)).toBe(notesClip.pageClipText(theirs, stamp))
    expect(clipFileName(ours.title, ours.url)).toBe(notesClip.clipFileName(theirs.title, theirs.url))
    // 抽出来的确实是正文：有小标题、代码块带语言、懒加载的图换成了真地址、导航和广告不在
    expect(ours.markdown).toContain('## 阅读器为什么适合本地优先')
    expect(ours.markdown).toContain('```python\ndef fetch(url):')
    expect(ours.markdown).toContain(`](${srv.url('/img/lazy.png')})`)
    expect(ours.markdown).not.toMatch(/广告|首页|版权所有/)
  })

  it('真的存进库：订阅 → 存进画布笔记（不带图）写出来的文件 = 画布笔记剪藏这一页写的', async () => {
    const vault = tempDir('cn-vault-')
    const data = tempDir()
    const c = clock(Date.UTC(2026, 10, 25, 8, 30))
    const commits: { paths: string[]; message: string }[] = []
    const core = await openTest(data.dir, { vaultDir: vault.dir, now: c.now, commit: async (_d, paths, message) => (commits.push({ paths, message }), 'abc1234') })
    try {
      const feed = await core.subscribe({ url: srv.url('/feed.xml') })
      const [art] = (await core.listArticles({ feedId: feed.id })).rows
      const preview = await core.previewSave(art!.id, { images: false })
      const res = await core.saveToNotes(art!.id, { images: false })
      const theirs = notesPage.extract()
      const expected = notesClip.pageClipText(theirs, localStamp(new Date(c.now())))
      expect(res.path).toBe(`收件箱/${notesClip.clipFileName(theirs.title, theirs.url)}.md`)
      expect(readFileSync(join(vault.dir, res.path), 'utf8')).toBe(expected)
      expect(preview).toEqual({ path: res.path, markdown: expected })
      expect(commits).toEqual([{ paths: [res.path], message: '存进画布笔记：本地优先软件的第二春 - 示例周刊' }])
      expect(res.commit).toBe('abc1234')

      // 再存一次：撞名加「 2」，内容照旧
      const again = await core.saveToNotes(art!.id, { images: false })
      expect(again.path).toBe(res.path.replace(/\.md$/, ' 2.md'))
      expect(readFileSync(join(vault.dir, again.path), 'utf8')).toBe(expected)

      // 带图：图下进这篇的附件文件夹，正文换成相对路径，和画布笔记 localizeImages 换出来的一样
      const withImg = await core.saveToNotes(art!.id)
      const text = readFileSync(join(vault.dir, withImg.path), 'utf8')
      expect(withImg.files.sort()).toEqual([`附件/${withImg.path.replace(/\.md$/, '')}/desk.png`, `附件/${withImg.path.replace(/\.md$/, '')}/lazy.png`].sort())
      for (const f of withImg.files) expect(readFileSync(join(vault.dir, f))).toEqual(PNG)
      const byUrl = new Map([
        [srv.url('/img/desk.jpg'), withImg.files.find((f) => f.endsWith('desk.png'))!],
        [srv.url('/img/lazy.png'), withImg.files.find((f) => f.endsWith('lazy.png'))!],
      ])
      const theirsLocal = await notesClip.localizeImages(expected, withImg.path, async (url: string) => {
        const p = byUrl.get(url)
        if (!p) throw new Error('没有')
        return p
      })
      expect(text).toBe(theirsLocal.text)
      expect(text).toContain('](../附件/收件箱/')
      expect(commits.at(-1)!.paths[0]).toBe(withImg.path)
      expect(commits.at(-1)!.paths.slice(1).sort()).toEqual([...withImg.files].sort())

      // 库里只多了这几篇和它们的图（没有别的地方被写）
      await core.sync()
      expect(readdirSync(vault.dir).sort()).toEqual(['.canvas-feeds', '收件箱', '附件'])
      expect(readdirSync(join(vault.dir, '.canvas-feeds'))).toEqual([`${core.deviceId}.jsonl`])
      expect(readdirSync(join(vault.dir, '收件箱')).sort()).toEqual(['本地优先软件的第二春 2.md', '本地优先软件的第二春 3.md', '本地优先软件的第二春.md'])
    } finally {
      await core.close()
      vault.done()
      data.done()
    }
  })

  it('不抓全文时用源里的正文；带 AI 摘要和划线；英文库存进 Inbox', async () => {
    const vault = tempDir('cn-vault-')
    const data = tempDir()
    const c = clock(Date.UTC(2026, 10, 25, 8, 30))
    const core = await openTest(data.dir, { vaultDir: vault.dir, now: c.now })
    try {
      const feed = await core.subscribe({ url: srv.url('/feed.xml') })
      const [art] = (await core.listArticles({ feedId: feed.id })).rows
      await core.addHighlight(art!.id, { quote: '只有一句' }, { note: '短' })
      const p = await core.previewSave(art!.id, { fullText: false, summary: { text: '一句话：讲本地优先。', by: 'Claude Code' } })
      expect(p.markdown).toBe(
        [
          '---',
          'created: 2026-11-25 09:30',
          `source: ${srv.url(PAGE)}`,
          '---',
          '# 本地优先软件的第二春',
          '',
          `—— [本地优先软件的第二春](${srv.url(PAGE)})`,
          '',
          '> [!ai] AI 总结 · Claude Code',
          '> 一句话：讲本地优先。',
          '',
          '只有一句摘要。',
          '',
          '## 划线',
          '',
          '- ==只有一句==',
          '  短',
          '',
        ].join('\n'),
      )
      // 没装好画布笔记分类、只有英文的 Inbox：存进 Inbox
      const { mkdirSync } = await import('node:fs')
      mkdirSync(join(vault.dir, 'Inbox'))
      expect((await core.previewSave(art!.id, { fullText: false })).path).toBe('Inbox/本地优先软件的第二春.md')
      expect(existsSync(join(vault.dir, 'Inbox/本地优先软件的第二春.md'))).toBe(false)
    } finally {
      await core.close()
      vault.done()
      data.done()
    }
  })
})
