/**
 * 同步来源共用的一块（main/sources/runner.ts）+ Get笔记 适配（main/sources/getnote.ts），对着本机的假 Get笔记（e2e/fixtures/fake-getnote.ts）：
 * 第一次只拉勾的、拉两遍不重复、挪走改名后照样认得、库里删了不拉回来、那边改了/删了、图下进附件、Key 错了说人话、
 * 记进自动化记录一次提交、撤回（连图一起）。真的临时 Git 库。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseSyncState, prop, syncStatePath } from '@cn/format'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type FakeGetnote, GN_CLIENT, GN_KEY, gid, sampleNotes, startFakeGetnote, VAULT_HAS } from '../e2e/fixtures/fake-getnote'
import { AutoEngine } from '../src/main/automation-engine'
import { SourceError } from '../src/main/sources/adapter'
import { getnoteAdapter, type GetnoteKey } from '../src/main/sources/getnote'
import { SourceRunner } from '../src/main/sources/runner'
import { Vault } from '../src/main/vault'

let fake: FakeGetnote
beforeAll(async () => {
  fake = await startFakeGetnote(sampleNotes())
  process.env.CN_GETNOTE_API = fake.base
  process.env.CN_GETNOTE_GAP_MS = '0'
})
afterAll(() => fake.server.close())
beforeEach(() => {
  fake.notes = sampleNotes()
  fake.mode = 'ok'
  fake.requests = []
})

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
const g = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const FOLDER = '40-Clippings/Getnotes'

function makeVault(files: Record<string, string> = VAULT_HAS) {
  const base = mkdtempSync(join(tmpdir(), 'cn-src-'))
  roots.push(base)
  const root = join(base, '库')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  g(root, 'config', 'user.name', 'T')
  g(root, 'config', 'user.email', 't@example.com')
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), t)
  }
  writeFileSync(join(root, 'README.md'), '# 库\n')
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', '样本')
  return root
}

function world(root: string, key: GetnoteKey | null = { key: GN_KEY, client: GN_CLIENT }) {
  const v = new Vault(root)
  const clock = { now: new Date(2026, 10, 23, 17, 48) }
  const r = new SourceRunner(getnoteAdapter(() => key), {
    vault: () => v,
    now: () => clock.now,
    async download(url, signal) {
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(String(res.status))
      return new Uint8Array(await res.arrayBuffer())
    },
  })
  const e = new AutoEngine({ vault: () => v, now: () => clock.now, prefs: () => ({ on: true, missed: 'once', notify: false }), lastSeen: () => null, setLastSeen: () => {}, ask: async () => ({ text: '', by: '' }), aiRow: async () => ({ ok: true }) as never, notify: () => {}, tell: () => {}, emit: () => {} })
  return { v, r, e, clock }
}
const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8')
const state = (root: string) => parseSyncState(read(root, syncStatePath('getnote')), '')!
const sig = () => AbortSignal.timeout(20_000)

describe('第一次连上', () => {
  it('分出比库里最新那篇还新的、更早的；文件夹认出 40-Clippings/Getnotes', async () => {
    const root = makeVault()
    const { r } = world(root)
    expect(await r.folderGuess()).toBe(FOLDER)
    const p = await r.firstPlan(sig())
    expect(p).toMatchObject({ total: sampleNotes().length, inVault: 10, newest: '2026-09-07 10:00:00' })
    expect(p.newer.map((x) => x.title)).toEqual(['旧 Kindle 越狱：装上读书插件', '鼠标垫', '对人骨的疑问', '多 Agent 配置指南', '金融学习记录'])
    expect(p.newer.filter((x) => x.empty).map((x) => x.title)).toEqual(['鼠标垫'])
    expect(p.older.map((x) => x.title)).toEqual(['更早的一篇', '没有标题的随手记'])
  })

  it('只拉勾的：空录音跳过，没勾的以后也不拉；图下进附件，md 照用户库的写法；拉两遍不重复', async () => {
    const root = makeVault()
    const { r, v } = world(root)
    const plan = await r.firstPlan(sig())
    const res = await r.pull({ pick: plan.newer.map((x) => x.id) }, sig())
    expect(res.error).toBeNull()
    expect(res.pulled.sort()).toEqual([`${FOLDER}/多 Agent 配置指南.md`, `${FOLDER}/对人骨的疑问.md`, `${FOLDER}/旧 Kindle 越狱：装上读书插件.md`, `${FOLDER}/金融学习记录.md`])
    expect(res.skippedEmpty).toBe(1)
    expect(res.images).toBe(4)
    expect(res.did).toEqual(['拉了4篇 · 下了4张图', '跳过1篇空录音'])
    const kindle = read(root, `${FOLDER}/旧 Kindle 越狱：装上读书插件.md`)
    expect(prop(kindle, 'getnote_id')).toBe(gid(30))
    expect(kindle).toContain('![](../../附件/40-Clippings/Getnotes/旧%20Kindle%20越狱：装上读书插件/图1.png)')
    expect(existsSync(join(root, '附件/40-Clippings/Getnotes/旧 Kindle 越狱：装上读书插件/图1.png'))).toBe(true)
    // 四处老毛病
    expect(kindle).not.toMatch(/Expires=|127\.0\.0\.1|getnotes\.seek|pass_ticket|chksm/)
    expect(kindle).toContain('对比如下：\n\n| 项 | 值 |')
    // 链接原文里的图也下了
    expect(kindle).toMatch(/> !\[越狱后\.jpg\]\(\.\.\/\.\.\/附件\/40-Clippings\/Getnotes\/旧%20Kindle%20越狱：装上读书插件\/图2\.png\)/)
    expect(read(root, `${FOLDER}/对人骨的疑问.md`)).toContain('> [!note]- 录音转写（7:51）')
    expect(read(root, `${FOLDER}/多 Agent 配置指南.md`)).toContain('## 图片\n\n![](../../附件/40-Clippings/Getnotes/多%20Agent%20配置指南/图1.png)')
    expect(read(root, `${FOLDER}/金融学习记录.md`)).toContain('## 追加 · 2026-09-11 10:00\n\n补一句：组合与因子投资')
    const st = state(root)
    expect(st.skipped.sort()).toEqual([gid(10), gid(29), gid(9)].sort())
    expect(Object.keys(st.notes)).toHaveLength(4)
    expect(st.lastFull).toBe('2026-11-23T17:48:00')

    // 再拉一遍：一篇都不多，增量只翻一页
    await v.list()
    fake.requests = []
    const again = await r.pull({}, sig())
    expect(again.pulled).toEqual([])
    expect(again.did).toEqual(['没有新的'])
    expect(fake.requests.filter((x) => x.includes('/list')).length).toBe(1)
    expect(fake.requests.filter((x) => x.includes('/detail')).length).toBe(0)
  })
})

describe('以后每次拉', () => {
  async function connected() {
    const root = makeVault()
    const w = world(root)
    const plan = await w.r.firstPlan(sig())
    await w.r.pull({ pick: plan.newer.map((x) => x.id) }, sig())
    return { root, ...w }
  }

  it('那边新加的拉进来；挪走、改了名的不重复；库里删了的不拉回来', async () => {
    const { root, r } = await connected()
    fake.notes.unshift({ id: gid(40), title: '新存的一篇', content: '新的', note_type: 'plain_text', created_at: '2026-11-23 09:00:00', updated_at: '2026-11-23 09:00:00' })
    // 梦游把一篇挪进子文件夹、改了名；用户删了一篇
    mkdirSync(join(root, FOLDER, 'AI-Tech'), { recursive: true })
    renameSync(join(root, FOLDER, '对人骨的疑问.md'), join(root, FOLDER, 'AI-Tech', '人骨.md'))
    unlinkSync(join(root, FOLDER, '金融学习记录.md'))
    const res = await r.pull({}, sig())
    expect(res.pulled).toEqual([`${FOLDER}/新存的一篇.md`])
    expect(existsSync(join(root, FOLDER, '对人骨的疑问.md'))).toBe(false)
    expect(existsSync(join(root, FOLDER, '金融学习记录.md'))).toBe(false)
    expect(state(root).dropped).toEqual([gid(26)])
  })

  it('每天对账：那边改了没人动过的换新、动过的只标；那边删了只标不删', async () => {
    const { root, r, clock } = await connected()
    // 用户改了 Kindle 那篇；对人骨那篇没人动
    writeFileSync(join(root, FOLDER, '旧 Kindle 越狱：装上读书插件.md'), read(root, `${FOLDER}/旧 Kindle 越狱：装上读书插件.md`) + '\n我自己加的一行\n')
    const kindle = fake.notes.find((n) => n.id === gid(30))!
    kindle.updated_at = '2026-11-24 08:00:00'
    kindle.content += '\n\n那边补了一段'
    const bone = fake.notes.find((n) => n.id === gid(28))!
    bone.updated_at = '2026-11-24 08:00:00'
    bone.content = '### 📑 智能总结\n- 那边重写了总结'
    fake.notes = fake.notes.filter((n) => n.id !== gid(101))
    clock.now = new Date(2026, 10, 24, 9, 0)
    const res = await r.pull({}, sig())
    expect(res).toMatchObject({ replaced: 1, marked: 1, deleted: 1 })
    expect(read(root, `${FOLDER}/对人骨的疑问.md`)).toContain('那边重写了总结')
    const k = read(root, `${FOLDER}/旧 Kindle 越狱：装上读书插件.md`)
    expect(k).toContain('我自己加的一行')
    expect(k).not.toContain('那边补了一段')
    expect(prop(k, 'getnote_newer')).toBe('2026-11-24 08:00:00')
    expect(prop(read(root, `${FOLDER}/AI-Tech/早就有的 1.md`), 'getnote_deleted')).toBe('2026-11-24')
    // 同一天再拉：不再全量（只翻一页），标过的不再标
    const again = await r.pull({}, sig())
    expect(again).toMatchObject({ replaced: 0, marked: 0, deleted: 0 })
  })
})

describe('Key 错了、要会员、次数用完：说人话', () => {
  it.each([
    ['auth', 'ok', { key: 'gk_live_wrong000', client: GN_CLIENT }, /不认这个 Key/],
    ['member', 'member', { key: GN_KEY, client: GN_CLIENT }, /要会员/],
    ['quota', 'quota', { key: GN_KEY, client: GN_CLIENT }, /今天的读取次数用完了/],
  ] as const)('%s', async (kind, mode, key, said) => {
    fake.mode = mode
    const { r } = world(makeVault(), key)
    const e = await r.firstPlan(sig()).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(SourceError)
    expect((e as SourceError).kind).toBe(kind)
    expect((e as SourceError).message).toMatch(said)
    expect((e as SourceError).message).not.toMatch(/10004|10201|42900/)
  })
  it('连不上', async () => {
    process.env.CN_GETNOTE_API = 'http://127.0.0.1:1'
    try {
      const e = await world(makeVault()).r.firstPlan(sig()).catch((x: unknown) => x)
      expect((e as SourceError).kind).toBe('net')
    } finally {
      process.env.CN_GETNOTE_API = fake.base
    }
  })
})

describe('记录和撤回（走自动化的）', () => {
  it('一次提交，撤回连图一起收回，撤回的不再拉回来', async () => {
    const root = makeVault()
    const { r, e, v } = world(root)
    const plan = await r.firstPlan(sig())
    const res = await r.pull({ pick: plan.newer.map((x) => x.id) }, sig())
    const entry = await e.record({ rule: '同步来源 · Get笔记', where: 'lib', by: 'run', why: '第一次连上', did: res.did, files: res.files, ok: true }, '同步来源 Get笔记：拉了 4 篇')
    expect(g(root, 'log', '-1', '--format=%s').trim()).toBe('同步来源 Get笔记：拉了 4 篇')
    expect(g(root, 'status', '--porcelain').trim()).toBe('')
    expect(g(root, 'show', '--name-only', '--format=', 'HEAD')).toContain('附件/40-Clippings/Getnotes/旧 Kindle 越狱：装上读书插件/图1.png')
    expect(await e.undo(entry.id)).toEqual({ ok: true, hash: expect.any(String) })
    expect(existsSync(join(root, FOLDER, '旧 Kindle 越狱：装上读书插件.md'))).toBe(false)
    expect(existsSync(join(root, '附件/40-Clippings/Getnotes/旧 Kindle 越狱：装上读书插件/图1.png'))).toBe(false)
    expect(g(root, 'status', '--porcelain').trim()).toBe('')
    await v.list()
    const again = await r.pull({}, sig())
    expect(again.pulled).toEqual([])
    expect(state(root).dropped).toHaveLength(4)
  })
})
