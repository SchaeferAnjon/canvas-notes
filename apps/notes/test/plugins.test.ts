import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PluginRegistry, type HostDeps, type MainPlugin } from '../src/main/plugins/host'
import { buildPrompt, parseLine, parseWhole, TranslationCache, Translator, type AskFn } from '../src/main/plugins/translate/translator'
import { Bookmarks } from '../src/main/web/library'
import { allTags, bookmarkNote, type BookmarkRow, matchBookmark, normalizeTags, sortBookmarks, splitTags } from '../src/shared/plugins/bookmarks'
import { detectLang, effectiveTarget, normalizeTranslate } from '../src/shared/plugins/translate'
import { mdUrl } from '../src/shared/layout'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-plugins-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('认语言、翻成什么', () => {
  it('按文字系统认：中文、日文、韩文、俄文；拉丁字母看 <html lang>，没写当英文', () => {
    expect(detectLang('冰岛是北大西洋上的岛国，首都是雷克雅未克。')).toBe('zh-CN')
    expect(detectLang('冰島是北大西洋上的島國', 'zh-TW')).toBe('zh-TW')
    expect(detectLang('アイスランドは北大西洋の島国です。')).toBe('ja')
    expect(detectLang('아이슬란드는 북대서양의 섬나라입니다.')).toBe('ko')
    expect(detectLang('Исландия — островное государство.')).toBe('ru')
    expect(detectLang('Iceland is a Nordic island country.')).toBe('en')
    expect(detectLang("L'Islande est un pays insulaire.", 'fr')).toBe('fr')
    expect(detectLang('12345 !!!')).toBeNull()
    // 中文里夹几个英文词还是中文
    expect(detectLang('今天用 Claude Code 写了一个 Electron 插件')).toBe('zh-CN')
  })

  it('网页本身就是目标语言：中文网页翻成英文，别的翻成简体中文', () => {
    expect(effectiveTarget('zh-CN', 'en')).toBe('zh-CN')
    expect(effectiveTarget('zh-CN', 'zh-CN')).toBe('en')
    expect(effectiveTarget('zh-CN', 'zh-TW')).toBe('en')
    expect(effectiveTarget('en', 'en')).toBe('zh-CN')
    expect(effectiveTarget('ja', null)).toBe('ja')
  })

  it('设置：空的、坏的语言和认不得的显示方式回到默认；常用之外的语言（视频字幕「翻成「斯瓦希里语」」）照样记住', () => {
    expect(normalizeTranslate(undefined)).toMatchObject({ target: 'zh-CN', display: 'below' })
    expect(normalizeTranslate({ target: '', display: 'weird' })).toMatchObject({ target: 'zh-CN', display: 'below' })
    expect(normalizeTranslate({ target: 'a\n"b' })).toMatchObject({ target: 'zh-CN' })
    expect(normalizeTranslate({ target: 'x'.repeat(41) })).toMatchObject({ target: 'zh-CN' })
    expect(normalizeTranslate({ target: '斯瓦希里语' })).toMatchObject({ target: '斯瓦希里语' })
    expect(normalizeTranslate({ target: 'ja', display: 'only' })).toMatchObject({ target: 'ja', display: 'only' })
  })
})

describe('翻译：一批问一次、按行拆、漏的重问、缓存', () => {
  const fakeAsk =
    (reply: (items: { id: number; text: string }[], call: number) => string, calls: string[] = []): AskFn =>
    async (_s, prompt, _signal, onText) => {
      calls.push(prompt)
      const items = JSON.parse(prompt.split('\n').pop()!) as { id: number; text: string }[]
      const out = reply(items, calls.length)
      // 一小段一小段吐，测按行拆
      for (let i = 0; i < out.length; i += 7) onText(out.slice(i, i + 7))
      return out
    }
  const line = (id: number, text: string) => JSON.stringify({ id, text })

  it('提示里写着目标语言，段落是 JSON；每行一个 {"id","text"}', () => {
    const p = buildPrompt([{ id: 3, text: 'Hello\n"world"' }], 'zh-CN')
    expect(p.split('\n')[0]).toBe('命令：翻译段落')
    expect(p).toContain('目标语言：简体中文（zh-CN）')
    expect(JSON.parse(p.split('\n').pop()!)).toEqual([{ id: 3, text: 'Hello\n"world"' }])
    expect(parseLine('{"id":1,"text":"你好"}')).toEqual({ id: 1, text: '你好' })
    expect(parseLine('```json {"id":"2","text":"世界"},')).toEqual({ id: 2, text: '世界' })
    expect(parseLine('好的，下面是译文')).toBeNull()
    expect(parseWhole('[{"id":1,"text":"一"},{"id":2,"text":"二"}]')).toEqual(new Map([[1, '一'], [2, '二']]))
    expect(parseWhole('{"1":"一","2":"二"}')).toEqual(new Map([[1, '一'], [2, '二']]))
  })

  it('边生成边给：每拆出一段就回调；同一段再翻从缓存拿，不再问 AI', async () => {
    const calls: string[] = []
    const t = new Translator(fakeAsk((items) => items.map((i) => line(i.id, `译：${i.text}`)).join('\n') + '\n', calls), new TranslationCache(null))
    const got: [number, string | null][] = []
    await t.translate([{ id: 1, text: 'one' }, { id: 2, text: 'two' }], 'zh-CN', (id, text) => got.push([id, text]), new AbortController().signal)
    expect(got).toEqual([[1, '译：one'], [2, '译：two']])
    expect(t.stats).toEqual({ aiCalls: 1, fromCache: 0, fromAi: 2 })
    const again: [number, string | null][] = []
    await t.translate([{ id: 9, text: 'two' }, { id: 10, text: 'three' }], 'zh-CN', (id, text) => again.push([id, text]), new AbortController().signal)
    expect(again).toEqual([[9, '译：two'], [10, '译：three']])
    expect(calls).toHaveLength(2)
    expect(JSON.parse(calls[1]!.split('\n').pop()!)).toEqual([{ id: 10, text: 'three' }])
    // 换了目标语言不算同一段
    await t.translate([{ id: 11, text: 'one' }], 'ja', () => undefined, new AbortController().signal)
    expect(calls).toHaveLength(3)
  })

  it('回答里漏了几段、格式乱：漏的再问一次；还漏就报「格式不对」', async () => {
    const calls: string[] = []
    // 第一次只回了第 1 段，还夹了废话；第二次回第 2 段；第 3 段永远不回
    const t = new Translator(
      fakeAsk((items, n) => (n === 1 ? `好的：\n${line(1, '一')}\n` : items.filter((i) => i.id === 2).map((i) => line(i.id, '二')).join('\n')), calls),
      new TranslationCache(null),
    )
    const got: [number, string | null, string?][] = []
    await t.translate([1, 2, 3].map((id) => ({ id, text: `p${id}` })), 'zh-CN', (id, text, err) => got.push([id, text, err?.code]), new AbortController().signal)
    expect(calls).toHaveLength(2)
    expect(JSON.parse(calls[1]!.split('\n').pop()!).map((i: { id: number }) => i.id)).toEqual([2, 3])
    expect(got).toEqual([[1, '一', undefined], [2, '二', undefined], [3, null, 'bad-output']])
  })

  it('AI 出错（退出了这类）：重试一次，还错就把原因给每一段；没登录这类不白试', async () => {
    let n = 0
    const t = new Translator(async () => {
      n++
      throw new Error('Claude Code 没答完')
    }, new TranslationCache(null))
    const got: unknown[] = []
    await t.translate([{ id: 1, text: 'a' }], 'zh-CN', (_id, _t, err) => got.push(err), new AbortController().signal)
    expect(n).toBe(2)
    expect(got).toEqual([{ code: 'exited', raw: 'Claude Code 没答完' }])
    let m = 0
    const t2 = new Translator(async () => {
      m++
      throw new Error('Not logged in · Please run /login')
    }, new TranslationCache(null))
    await t2.translate([{ id: 1, text: 'a' }], 'zh-CN', () => undefined, new AbortController().signal)
    expect(m).toBe(1)
  })

  it('同时最多 4 次 AI 调用', async () => {
    let running = 0
    let peak = 0
    const t = new Translator(async (_s, prompt) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 20))
      running--
      const items = JSON.parse(prompt.split('\n').pop()!) as { id: number }[]
      return items.map((i) => line(i.id, 'x')).join('\n')
    }, new TranslationCache(null))
    await Promise.all(Array.from({ length: 10 }, (_, i) => t.translate([{ id: i, text: `t${i}` }], 'zh-CN', () => undefined, new AbortController().signal)))
    expect(peak).toBe(4)
  })

  it('缓存存进文件，重开还在；坏文件当空的', () => {
    const file = join(root, 'cache.json')
    const c = new TranslationCache(file)
    c.set('zh-CN', 'hello', '你好')
    c.flush()
    expect(new TranslationCache(file).get('zh-CN', 'hello')).toBe('你好')
    expect(new TranslationCache(file).get('en', 'hello')).toBeUndefined()
    rmSync(file)
    writeFileSync(file, '{坏的')
    expect(new TranslationCache(file).size).toBe(0)
  })
})

describe('书签管家', () => {
  it('标签：去 #、去重、空的不要；输入框里逗号顿号空格分开', () => {
    expect(normalizeTags(['#旅行', ' 旅行 ', '', '冰岛', 3])).toEqual(['旅行', '冰岛'])
    expect(splitTags('旅行，冰岛、 #城市 a,b')).toEqual(['旅行', '冰岛', '城市', 'a', 'b'])
  })

  it('搜标题、网址、标签、备注；排序；所有标签用得多的在前', () => {
    const rows: BookmarkRow[] = [
      { id: '1', title: 'Beta', url: 'https://b.test/%E5%86%B0', folder: '书签栏', addedMs: 1, lastVisit: 30, tags: ['冰岛'], note: '回头看' },
      { id: '2', title: 'Alpha', url: 'https://a.test/', folder: '书签栏', addedMs: 3, lastVisit: 10, tags: ['冰岛', '工作'] },
      { id: '3', title: 'Gamma', url: 'https://c.test/', folder: '书签栏', addedMs: 2, lastVisit: 0 },
    ]
    expect(rows.filter((b) => matchBookmark(b, '回头')).map((b) => b.id)).toEqual(['1'])
    expect(rows.filter((b) => matchBookmark(b, '#工作')).map((b) => b.id)).toEqual(['2'])
    expect(rows.filter((b) => matchBookmark(b, 'b.test 冰')).map((b) => b.id)).toEqual(['1'])
    expect(sortBookmarks(rows, 'added').map((b) => b.id)).toEqual(['2', '3', '1'])
    expect(sortBookmarks(rows, 'title').map((b) => b.id)).toEqual(['2', '1', '3'])
    expect(sortBookmarks(rows, 'visited').map((b) => b.id)).toEqual(['1', '2', '3'])
    expect(allTags(rows)).toEqual(['冰岛', '工作'])
  })

  it('存进库的那一篇：frontmatter 带 created、source、tags，正文是标题、来源行、备注', () => {
    const b = { id: '1', title: '黑沙滩 [攻略]', url: 'https://x.test/a b', folder: '书签栏', addedMs: 0, tags: ['旅行', 'a"b'], note: '冬天去' }
    expect(bookmarkNote(b, '2026-11-15 14:03', mdUrl)).toBe(
      '---\ncreated: 2026-11-15 14:03\nsource: https://x.test/a b\ntags: ["旅行", "a\\"b"]\n---\n# 黑沙滩 [攻略]\n\n—— [黑沙滩 攻略](https://x.test/a%20b)\n\n冬天去\n',
    )
    expect(bookmarkNote({ ...b, tags: [], note: '' }, 's', mdUrl)).toBe('---\ncreated: s\nsource: https://x.test/a b\n---\n# 黑沙滩 [攻略]\n\n—— [黑沙滩 攻略](https://x.test/a%20b)\n')
  })

  it('书签文件：加的时候带标签和备注，改哪项写哪项，标签清空就不写这一项；变了就叫一声', () => {
    const file = join(root, 'bookmarks.json')
    let changed = 0
    const bm = new Bookmarks(file, () => changed++)
    bm.add({ title: 'A', url: 'https://a.test/', tags: ['#x', 'x', 'y'], note: '  一句  话 ' }, 5)
    bm.add({ title: 'B', url: 'https://b.test/' }, 6)
    const [a, b] = bm.all()
    expect(a).toMatchObject({ title: 'A', folder: '书签栏', tags: ['x', 'y'], note: '一句 话', addedMs: 5 })
    expect(b).not.toHaveProperty('tags')
    expect(b).not.toHaveProperty('note')
    bm.update(a!.id, { title: 'A2', tags: [], folder: '书签栏 / 工作' })
    expect(bm.all()[0]).toEqual({ id: a!.id, title: 'A2', url: 'https://a.test/', folder: '书签栏 / 工作', addedMs: 5, note: '一句 话' })
    expect(() => bm.update(a!.id, { url: 'https://b.test/' })).toThrow('已经有书签了')
    expect(() => bm.update('nope', { title: 'x' })).toThrow('不在了')
    expect(JSON.parse(readFileSync(file, 'utf8'))[0].title).toBe('A2')
    expect(changed).toBe(3)
  })
})

describe('插件表：权限、开关、谁能调', () => {
  function registry(state: unknown = {}) {
    const written: unknown[] = []
    const deps: HostDeps = {
      dir: root,
      vault: () => ({ root }) as never,
      ai: async () => 'AI 回答',
      aiLabel: () => 'Claude Code · Haiku',
      sendApp: () => undefined,
      filesChanged: () => undefined,
      onQuit: () => undefined,
    }
    const r = new PluginRegistry(deps, { read: () => state, write: (s) => written.push(JSON.parse(JSON.stringify(s))) })
    return { r, written }
  }
  const ctx = (from: 'app' | 'page') => ({ from, sender: {} as never })

  it('没声明的权限拿不到：没「联网」不能问 AI，没「读写笔记」拿不到库', async () => {
    const { r } = registry()
    const p: MainPlugin<{ n: number }> = {
      manifest: { id: 'p', name: '小插件', description: '', permissions: ['page'] },
      normalizeSettings: (raw) => ({ n: typeof (raw as { n?: unknown })?.n === 'number' ? (raw as { n: number }).n : 1 }),
      setup(host) {
        host.handle('ai', () => host.ai('s', 'p', new AbortController().signal))
        host.handle('vault', () => host.vault().root)
        host.handle('n', () => host.settings().n, { page: true })
      },
    }
    r.add(p)
    await expect(r.call(ctx('app'), 'p', 'ai', [])).rejects.toThrow('没有声明联网的权限')
    await expect(r.call(ctx('app'), 'p', 'vault', [])).rejects.toThrow('没有声明读写笔记的权限')
    expect(await r.call(ctx('page'), 'p', 'n', [])).toBe(1)
  })

  it('网页只能调写了 page 的方法；关掉的插件谁都调不了；开关和设置存下来，默认开', async () => {
    const { r, written } = registry({ settings: { q: { n: 'bad' } } })
    r.add({
      manifest: { id: 'q', name: '翻译', description: '说明', permissions: ['net'] },
      normalizeSettings: (raw) => ({ n: typeof (raw as { n?: unknown })?.n === 'number' ? (raw as { n: number }).n : 7 }),
      setup(host) {
        host.handle('ask', () => host.ai('s', 'p', new AbortController().signal))
        host.handle('page', () => 'ok', { page: true })
      },
    })
    expect(r.list()).toEqual([{ id: 'q', name: '翻译', description: '说明', permissions: ['net'], enabled: true, settings: { n: 7 } }])
    expect(await r.call(ctx('app'), 'q', 'ask', [])).toBe('AI 回答')
    await expect(r.call(ctx('page'), 'q', 'ask', [])).rejects.toThrow('网页里不能调')
    expect(await r.call(ctx('page'), 'q', 'page', [])).toBe('ok')
    await expect(r.call(ctx('app'), 'q', 'nope', [])).rejects.toThrow('没有 nope')
    await expect(r.call(ctx('app'), 'zz', 'x', [])).rejects.toThrow('没有这个插件')
    r.setSettings('q', { n: 3 })
    r.setEnabled('q', false)
    await expect(r.call(ctx('page'), 'q', 'page', [])).rejects.toThrow('关着')
    expect(r.pageState()).toEqual({ q: { enabled: false, settings: { n: 3 } } })
    expect(written.at(-1)).toEqual({ enabled: { q: false }, settings: { q: { n: 3 } } })
  })
})
