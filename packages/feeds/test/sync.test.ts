/**
 * 多台设备：库里 .canvas-feeds/<设备>.jsonl，合并和读文件的先后无关。
 * 1. 纯重放：两台设备的记录打乱成各种顺序重放，结果一样。
 * 2. 本机库：同一组记录按不同顺序灌进两个新库，物化出来的表一样。
 * 3. 两个真的核心共用一个库文件夹：A 订阅、星标、划线 → B 同步后看到；B 取消、整源已读 → A 看到；谁先同步都一样。
 */
import { readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Clock, isRead, ordOf, replay, snapshotOf, type SyncEvent, type SyncOp } from '../src/sync'
import { Store } from '../src/node/store'
import { clock, openTest, rssOf, tempDir } from './helpers'
import { send, startServer } from './server'

const T0 = Date.UTC(2026, 10, 25, 8, 0)

/** 两台设备各写一串记录（时钟有快有慢、有同一毫秒的） */
function twoDevices(): SyncEvent[] {
  const mk = (d: string) => {
    let s = 0
    const ck = new Clock()
    return (t: number, op: SyncOp): SyncEvent => ({ v: 1, d, s: ++s, t: ck.tick(t), ...op }) as SyncEvent
  }
  const a = mk('mac-a1b2')
  const b = mk('mini-c3d4')
  const feed = { id: 'f_1', url: 'https://site.test/a.xml', title: 'A 源', kind: 'article' as const, folderId: null, intervalMin: 30 }
  const art = { feedId: 'f_1', title: '一篇', publishedAt: T0 - 1000 }
  return [
    a(T0, { op: 'sub', feed }),
    a(T0 + 1, { op: 'folder', id: 'd_1', name: '科技', order: 0 }),
    a(T0 + 2, { op: 'feed', feedId: 'f_1', folderId: 'd_1' }),
    a(T0 + 3, { op: 'star', id: 'a_1', on: true, art }),
    a(T0 + 4, { op: 'read', ids: ['a_1', 'a_2'], on: true }),
    b(T0 + 4, { op: 'read', ids: ['a_2'], on: false }), // 同一毫秒：按设备名排
    b(T0 + 5, { op: 'sub', feed: { ...feed, id: 'f_2', url: 'https://site.test/b.xml', title: 'B 源' } }),
    b(T0 + 6, { op: 'feed', feedId: 'f_1', title: 'A 源（改名）' }),
    a(T0 + 7, { op: 'hl', h: { id: 'h_1', articleId: 'a_1', anchor: { quote: '一句话' }, createdAt: T0 + 7, updatedAt: T0 + 7 }, art }),
    b(T0 + 8, { op: 'star', id: 'a_1', on: false }),
    b(T0 + 9, { op: 'readAll', feedIds: ['f_1'], before: T0 }),
    a(T0 + 10, { op: 'read', ids: ['a_3'], on: false }),
    b(T0 + 11, { op: 'unfolder', id: 'd_1' }),
    a(T0 + 12, { op: 'unsub', feedId: 'f_2' }),
    b(T0 + 13, { op: 'later', id: 'a_3', on: true, art: { ...art, title: '第三篇' } }),
    a(T0 + 14, { op: 'unhl', id: 'h_1', articleId: 'a_1' }),
  ]
}

/** 确定的「随机」打乱 */
function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

describe('合并规矩（纯重放）', () => {
  const events = twoDevices()
  const expected = snapshotOf(replay(events))

  it('同一组记录任意顺序、重放两遍，结果一样', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const order = shuffle(events, seed)
      expect(snapshotOf(replay(order))).toEqual(expected)
      expect(snapshotOf(replay([...order, ...shuffle(events, seed + 99)]))).toEqual(expected)
    }
    // 先 A 的整份再 B 的整份，或者反过来
    expect(snapshotOf(replay([...events.filter((e) => e.d.startsWith('mini')), ...events.filter((e) => e.d.startsWith('mac'))]))).toEqual(expected)
  })

  it('结果：后写的赢；同一毫秒按设备名；整源已读盖住它以前的', () => {
    const r = replay(events)
    expect(expected['feed:f_1:title']).toBe('A 源（改名）')
    expect(expected['sub:f_2']).toBeNull()
    expect(expected['star:a_1']).toBeNull()
    expect(expected['folder:d_1']).toBeNull()
    expect(expected['hl:h_1']).toBeNull()
    // a_2：A 在 T0+4 标已读，B 也在 T0+4 标未读，mini > mac，B 赢；然后 B 在 T0+9 整源已读（a_2 发表在 T0 以前时）又盖住
    expect(isRead(r, { id: 'a_2', feedId: 'f_1', publishedAt: T0 - 5000 })).toBe(true)
    expect(isRead(r, { id: 'a_2', feedId: 'f_1', publishedAt: T0 + 5000 })).toBe(false)
    // a_3：A 在 T0+10 标未读，比整源已读（T0+9）晚
    expect(isRead(r, { id: 'a_3', feedId: 'f_1', publishedAt: T0 - 5000 })).toBe(false)
    // 时钟：同一台设备的时间只往前走
    const ords = events.filter((e) => e.d === 'mac-a1b2').map(ordOf)
    expect([...ords].sort()).toEqual(ords)
  })
})

describe('本机库照同一套规矩', () => {
  it('同一组记录按不同顺序灌进新库，物化出来的表一样', () => {
    const events = twoDevices()
    const dump = (seed: number) => {
      const tmp = tempDir()
      const st = new Store(join(tmp.dir, 'x.sqlite'))
      // 先抓到了两篇文章（a_2、a_3 发表在整源已读之前）；源的那一行由 sub 记录物化出来
      for (const [id, t] of [
        ['a_2', T0 - 5000],
        ['a_3', T0 - 5000],
      ] as const)
        st.db.prepare(`INSERT INTO articles(id, feed_id, title, published_at, fetched_at, summary, content_html, content_hash) VALUES(?, 'f_1', ?, ?, 0, '', '', ?)`).run(id, id, t, id)
      for (const e of shuffle(events, seed)) st.apply(e)
      const q = (sql: string) => JSON.stringify(st.db.prepare(sql).all())
      const out = [
        q('SELECT id, url, title, kind, folder_id, interval_min, added_at FROM feeds ORDER BY id'),
        q('SELECT * FROM folders ORDER BY id'),
        q('SELECT article_id, read, starred, later, snap FROM state ORDER BY article_id'),
        q('SELECT * FROM highlights ORDER BY id'),
        q('SELECT key, val FROM lww ORDER BY key'),
      ].join('\n')
      st.close()
      tmp.done()
      return out
    }
    const first = dump(1)
    for (const seed of [2, 3, 4, 5, 6, 7, 8]) expect(dump(seed)).toBe(first)
    expect(first).toContain('"article_id":"a_2","read":1')
    expect(first).toContain('"article_id":"a_3","read":0,"starred":0,"later":1')
  })
})

describe('两台设备共用一个库', () => {
  let srv: Awaited<ReturnType<typeof startServer>>
  beforeAll(async () => {
    srv = await startServer({
      '/a.xml': send(
        rssOf('A 源', [
          { guid: '1', title: '第一篇', link: 'https://site.test/1', date: T0 - 3600_000 },
          { guid: '2', title: '第二篇', link: 'https://site.test/2', date: T0 - 7200_000 },
        ]),
      ),
    })
  })
  afterAll(() => srv.close())

  it('A 订阅、建文件夹、星标、划线、已读 → B 同步后都有；B 取消星标、整源已读 → A 同步后看到', async () => {
    const vault = tempDir('cn-vault-')
    const da = tempDir()
    const db = tempDir()
    const ca = clock(T0)
    const cb = clock(T0 - 60_000) // B 的钟慢一分钟
    // 写出去的时机由测试自己调 sync（不让后台的自动写出抢先）
    const A = await openTest(da.dir, { deviceName: 'MacBook Pro', vaultDir: vault.dir, now: ca.now, pushDelayMs: 600_000 })
    const B = await openTest(db.dir, { deviceName: 'Mac mini', vaultDir: vault.dir, now: cb.now, pushDelayMs: 600_000 })
    try {
      expect(A.deviceId).toMatch(/^MacBook-Pro-[0-9a-f]{4}$/)
      const folder = await A.addFolder('科技')
      const feed = await A.subscribe({ url: srv.url('/a.xml'), folderId: folder.id })
      const [first, second] = (await A.listArticles({})).rows
      await A.setStarred(first!.id, true)
      await A.setLater(second!.id, true)
      await A.addHighlight(first!.id, { quote: '第一篇' }, { note: '好' })
      await A.markRead([second!.id])
      ca.add(1000)
      const pushed = await A.sync()
      expect(pushed.pushed).toBe(6)

      // 只写在 .canvas-feeds/ 里，一台设备一份
      expect(readdirSync(vault.dir)).toEqual(['.canvas-feeds'])
      expect(readdirSync(join(vault.dir, '.canvas-feeds'))).toEqual([`${A.deviceId}.jsonl`])

      const pulled = await B.sync()
      expect(pulled.pulled).toBe(6)
      // B 自己还没做过什么，没有自己那份
      expect(pulled.devices).toEqual([A.deviceId])
      expect((await B.listFeeds()).map((f) => [f.id, f.title, f.folderId])).toEqual([[feed.id, 'A 源', folder.id]])
      expect((await B.listFolders()).map((f) => f.name)).toEqual(['科技'])
      // B 还没抓：星标、稍后读的从快照列出来
      expect((await B.listArticles({ view: 'starred' })).rows.map((r) => r.title)).toEqual(['第一篇'])
      expect((await B.listArticles({ view: 'later' })).rows.map((r) => r.title)).toEqual(['第二篇'])
      await B.refresh()
      const rowsB = (await B.listArticles({})).rows
      expect(rowsB.map((r) => [r.id, r.read, r.starred, r.later, r.highlightCount])).toEqual([
        [first!.id, false, true, false, 1],
        [second!.id, true, false, true, 0],
      ])
      expect((await B.listHighlights(first!.id))[0]).toMatchObject({ anchor: { quote: '第一篇' }, note: '好' })

      // B 的钟慢，但它看过 A 的记录，它的改动排在后面
      await B.setStarred(first!.id, false)
      await B.markAllRead({ feedId: feed.id })
      await B.sync()
      const back = await A.sync()
      expect(back.pulled).toBe(2)
      const rowsA = (await A.listArticles({})).rows
      expect(rowsA.map((r) => [r.read, r.starred])).toEqual([
        [true, false],
        [true, false],
      ])
      expect((await A.counts()).views.all).toBe(0)

      // 再同步一遍什么都不变
      expect((await A.sync()).pulled).toBe(0)
      expect((await B.sync()).pulled).toBe(0)

      // 写坏的最后一行（另一台写到一半）跳过；补完后读得到
      const own = join(vault.dir, '.canvas-feeds', `${B.deviceId}.jsonl`)
      const lines = readFileSync(own, 'utf8')
      const fake = JSON.stringify({ v: 1, d: B.deviceId, s: 999, t: T0 + 999_999, op: 'later', id: first!.id, on: true })
      writeFileSync(own, lines + fake.slice(0, 20))
      expect((await A.sync()).pulled).toBe(0)
      writeFileSync(own, lines + fake + '\n')
      expect((await A.sync()).pulled).toBe(1)
      expect((await A.getArticle(first!.id))!.later).toBe(true)
      // 别的设备的文件不认识的行、坏 JSON 跳过
      appendFileSync(own, '{"v":2,"op":"future"}\nnot json\n')
      expect((await A.sync()).pulled).toBe(0)
    } finally {
      await A.close()
      await B.close()
      vault.done()
      da.done()
      db.done()
    }
  })

  it('两台都离线改了再同步：谁先同步结果都一样', async () => {
    const results: string[] = []
    for (const firstSync of ['A', 'B'] as const) {
      const vault = tempDir('cn-vault-')
      const da = tempDir()
      const db = tempDir()
      const ca = clock(T0)
      const cb = clock(T0)
      const A = await openTest(da.dir, { deviceName: 'a', vaultDir: vault.dir, now: ca.now })
      const B = await openTest(db.dir, { deviceName: 'b', vaultDir: vault.dir, now: cb.now })
      try {
        const feed = await A.subscribe({ url: srv.url('/a.xml') })
        await A.sync()
        await B.sync()
        await B.refresh()
        const [x] = (await A.listArticles({})).rows
        // 离线各改各的：A 星标 + 改名，B 稍后读 + 改名（B 晚一点）
        ca.add(10)
        cb.add(20)
        await A.setStarred(x!.id, true)
        await A.updateFeed(feed.id, { title: 'A 改的名字' })
        await B.setLater(x!.id, true)
        await B.updateFeed(feed.id, { title: 'B 改的名字' })
        const order = firstSync === 'A' ? [A, B, A] : [B, A, B]
        for (const c of order) await c.sync()
        const view = async (c: typeof A) => JSON.stringify([(await c.listFeeds()).map((f) => f.title), (await c.listArticles({})).rows.map((r) => [r.starred, r.later, r.read])])
        const va = await view(A)
        expect(await view(B)).toBe(va)
        results.push(va)
      } finally {
        await A.close()
        await B.close()
        vault.done()
        da.done()
        db.done()
      }
    }
    expect(results[0]).toBe(results[1])
    expect(results[0]).toContain('B 改的名字')
  })
})
