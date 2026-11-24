// AI 对话按地方存（D 组 CN-132）：每个地方一份、各有各的会话号；以前全库一份的迁成「以前的对话」；菜单列问过的（含读 PDF 的），按时间排
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readingChats, readingKey } from '../src/main/reading/chats'
import { AgentStore } from '../src/main/agent/store'
import { findLost, knownSessions, projectDirName, RECOVERED } from '../src/main/agent/recover'
import type { StoredMsg } from '../src/shared/agent'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-chats-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const V = '/库/测试库'
const q = (id: number, text: string, time?: number): StoredMsg => ({ id, role: 'user', text, ...(time ? { time } : {}) })
const a = (id: number, text: string, time?: number): StoredMsg => ({ id, role: 'ai', text, ...(time ? { time } : {}) })

describe('AgentStore 按地方存', () => {
  it('每个地方各存各的对话和会话号；没问过的不在菜单里；新对话清掉这一个地方', () => {
    const s = new AgentStore(dir)
    s.saveMsgs(V, 'folder:周记', '周记', [q(1, '周记里写了什么', 1000), a(2, '一篇', 1001)])
    s.setSession(V, 'folder:周记', 'claude', 'sess-week')
    s.saveMsgs(V, 'file:随手记.md', '随手记', [q(3, '你好', 2000)])
    s.saveMsgs(V, 'home', '首页', [])
    expect(s.chat(V, 'folder:周记').msgs.map((m) => m.text)).toEqual(['周记里写了什么', '一篇'])
    expect(s.chat(V, 'folder:周记').sessions).toEqual({ claude: 'sess-week' })
    expect(s.chat(V, 'file:随手记.md').sessions).toEqual({})
    expect(s.chat(V, 'inbox').msgs).toEqual([])
    // 按最后问的时间，新的在前；首页没问过不列
    expect(s.list(V)).toMatchObject([
      { key: 'file:随手记.md', label: '随手记', asks: 1, at: 2000 },
      { key: 'folder:周记', label: '周记', asks: 1, at: 1001 },
    ])
    // 别的库看不到
    expect(s.list('/库/别的')).toEqual([])
    s.clear(V, 'folder:周记')
    expect(s.chat(V, 'folder:周记')).toMatchObject({ msgs: [], sessions: {} })
    expect(s.list(V).map((c) => c.key)).toEqual(['file:随手记.md'])
  })

  it('以前全库一份的对话（chat-<库>.json）：迁成「以前的对话」，会话号带过来，旧文件删掉；没问过的旧文件直接删', () => {
    const h = createHash('sha1').update(V).digest('hex').slice(0, 12)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `chat-${h}.json`), JSON.stringify({ vault: V, msgs: [q(1, '冰岛几月去最好'), a(2, '九月到三月')], sessions: { codex: 'old' } }))
    utimesSync(join(dir, `chat-${h}.json`), 1_700_000_000, 1_700_000_000)
    const s = new AgentStore(dir)
    expect(s.list(V)).toEqual([{ key: 'legacy', label: '以前的对话', asks: 1, at: 1_700_000_000_000 }])
    expect(s.chat(V, 'legacy').msgs.map((m) => m.text)).toEqual(['冰岛几月去最好', '九月到三月'])
    expect(s.chat(V, 'legacy').sessions).toEqual({ codex: 'old' })
    expect(existsSync(join(dir, `chat-${h}.json`))).toBe(false)
    // 空的旧文件：删掉，不多一条
    const W = '/库/空的'
    const h2 = createHash('sha1').update(W).digest('hex').slice(0, 12)
    writeFileSync(join(dir, `chat-${h2}.json`), JSON.stringify({ vault: W, msgs: [], sessions: {} }))
    expect(new AgentStore(dir).list(W)).toEqual([])
    expect(existsSync(join(dir, `chat-${h2}.json`))).toBe(false)
  })

  it('文件改了名：对话跟到新名字，旧的不留', () => {
    const s = new AgentStore(dir)
    s.saveMsgs(V, 'file:草稿.md', '草稿', [q(1, '帮我改改', 5)])
    s.move(V, 'file:草稿.md', 'file:写作/定稿.md', '定稿')
    expect(s.chat(V, 'file:写作/定稿.md').msgs.map((m) => m.text)).toEqual(['帮我改改'])
    expect(s.chat(V, 'file:草稿.md').msgs).toEqual([])
    expect(s.list(V)).toMatchObject([{ key: 'file:写作/定稿.md', label: '定稿', asks: 1, at: 5 }])
  })
})

describe('AI 对话里的旁支（task-4edsc）：跟着这段对话存', () => {
  it('旁支和对话一起存（只留挂在留下来的回答上、问过的）；不给旁支时不动存着的；旁支自己的会话号单独记；新对话一起清掉；改名跟过去', () => {
    const s = new AgentStore(dir)
    const side = (id: string, msg: number, n: number) => ({ id, msg, quote: '那一句', msgs: n ? [q(100 + n, '为什么？'), a(200 + n, '因为。')] : [], createdAt: n })
    s.saveMsgs(V, 'file:周记.md', '周记', [q(1, '总结', 1000), a(2, '三句话', 1001)], [side('cs-1', 2, 1), side('cs-empty', 2, 0), side('cs-gone', 99, 2)])
    expect(s.sides(V, 'file:周记.md').map((x) => x.id)).toEqual(['cs-1'])
    // 主对话再存一次、不带旁支：旁支照旧在
    s.saveMsgs(V, 'file:周记.md', '周记', [q(1, '总结', 1000), a(2, '三句话', 1001), q(3, '还有呢', 1002)])
    expect(s.sides(V, 'file:周记.md').map((x) => x.id)).toEqual(['cs-1'])
    // 菜单里的「N问」只数主对话
    expect(s.list(V)).toMatchObject([{ key: 'file:周记.md', label: '周记', asks: 2, at: 1002 }])
    s.setSession(V, 'file:周记.md', 'claude', 'main-sess')
    s.setSideSession(V, 'file:周记.md', 'cs-1', 'claude', 'side-sess')
    expect(s.sideSession(V, 'file:周记.md', 'cs-1', 'claude')).toBe('side-sess')
    expect(s.sideSession(V, 'file:周记.md', 'cs-1', 'codex')).toBeUndefined()
    expect(s.chat(V, 'file:周记.md').sessions).toEqual({ claude: 'main-sess' })
    s.move(V, 'file:周记.md', 'file:周记/W47.md', 'W47')
    expect(s.sides(V, 'file:周记/W47.md').map((x) => x.id)).toEqual(['cs-1'])
    expect(s.sideSession(V, 'file:周记/W47.md', 'cs-1', 'claude')).toBe('side-sess')
    s.clear(V, 'file:周记/W47.md')
    expect(s.sides(V, 'file:周记/W47.md')).toEqual([])
    expect(s.sideSession(V, 'file:周记/W47.md', 'cs-1', 'claude')).toBeUndefined()
  })
})

describe('全能模式开关（2026-11-19，默认开）', () => {
  it('从没设过是开着；关了记在软件设置目录（重开软件还是关着），换引擎、改设置 › AI 不动它', () => {
    const s = new AgentStore(dir)
    expect(s.omni()).toBe(true)
    s.setOmni(false)
    expect(new AgentStore(dir).omni()).toBe(false)
    s.setChatEngine('codex')
    s.setCliPath('claude', '/x/claude')
    expect(new AgentStore(dir).omni()).toBe(false)
    expect(new AgentStore(dir).prefs().features.chat).toEqual({ engine: 'codex' })
    s.setOmni(true)
    expect(new AgentStore(dir).omni()).toBe(true)
  })

  it('会话号带着系统提示的版本：版本对得上才接着聊（Claude Code 接着聊时一直用会话第一次的系统提示）', () => {
    const s = new AgentStore(dir)
    s.setSession(V, 'home', 'claude', 'old')
    expect(s.session(V, 'home', 'claude', 2)).toBeUndefined()
    s.setSession(V, 'home', 'claude', 'new', 2)
    expect(s.session(V, 'home', 'claude', 2)).toBe('new')
    expect(s.session(V, 'home', 'claude', 3)).toBeUndefined()
    expect(s.session(V, 'home', 'codex', 2)).toBeUndefined()
  })
})

describe('读 PDF 的对话也列进菜单', () => {
  it('只列这个库、问过的；名字是带扩展名的文件名，网页上问的是网页标题；时间是最后一条', () => {
    const rd = join(dir, 'reading')
    mkdirSync(rd)
    const put = (root: string, pdf: string, msgs: unknown[], threads: unknown[] = []) => writeFileSync(join(rd, `${readingKey(root, pdf)}.json`), JSON.stringify({ pdf, page: 1, msgs, threads }))
    put(V, '课程/线代/第3讲.pdf', [{ id: 1, role: 'user', thread: 't', text: '讲讲', time: 300 }, { id: 2, role: 'ai', thread: 't', text: '好', time: 310 }])
    put(V, '课程/线代/第4讲.pdf', [])
    put(V, 'web:https://www.youtube.com/watch?v=1', [{ id: 3, role: 'user', thread: 'w', text: '这一帧', time: 900 }], [{ id: 'w', page: 0, createdAt: 0, web: { url: 'https://www.youtube.com/watch?v=1', title: 'Linear maps' } }])
    put('/库/别的', '别的.pdf', [{ id: 4, role: 'user', thread: 'x', text: '问', time: 999 }])
    writeFileSync(join(rd, `${readingKey(V, '课程/线代/第3讲.pdf')}.sessions.json`), '{}')
    mkdirSync(join(rd, 'text'))
    const got = readingChats(rd, V).sort((x, y) => y.at - x.at)
    expect(got).toEqual([
      { key: 'read:web:https://www.youtube.com/watch?v=1', label: 'Linear maps', asks: 1, at: 900, first: '这一帧' },
      { key: 'read:课程/线代/第3讲.pdf', label: '第3讲.pdf', asks: 1, at: 310, first: '讲讲' },
    ])
    expect(readingChats(join(dir, '没有'), V)).toEqual([])
    expect(readdirSync(rd).length).toBe(6)
  })
})

describe('「这段 → 那页」表（AI 对话绑页面，2026-11-24）', () => {
  it('只记搬过家的；挂回自己那页从表里拿掉；文件改名时这段和挂到它上面的几段跟着改；按库分开', () => {
    const s = new AgentStore(dir)
    expect(s.pages(V)).toEqual({})
    s.setPage(V, 'file:甲.md', { page: 'read:web:https://a.com/x', label: '甲' })
    s.setPage(V, 'folder:周记', { page: 'file:甲.md', label: '周记' })
    // 挂到自己那页：不记
    s.setPage(V, 'home', { page: 'home', label: '首页' })
    expect(Object.keys(s.pages(V)).sort()).toEqual(['file:甲.md', 'folder:周记'])
    expect(s.pages(V)['file:甲.md']).toMatchObject({ page: 'read:web:https://a.com/x', label: '甲' })
    expect(s.pages('/库/别的')).toEqual({})
    s.move(V, 'file:甲.md', 'file:课/甲.md', '甲')
    expect(s.pages(V)['file:课/甲.md']?.page).toBe('read:web:https://a.com/x')
    expect(s.pages(V)['file:甲.md']).toBeUndefined()
    expect(s.pages(V)['folder:周记']?.page).toBe('file:课/甲.md')
    s.setPage(V, 'folder:周记', null)
    expect(Object.keys(s.pages(V))).toEqual(['file:课/甲.md'])
  })
})

describe('「+」收起来不删（2026-11-24 用户：首页点了几次新建对话就看不到曾经的对话了）', () => {
  it('问过的收进 older（会话号一起），空的不收；切回原样回来、现在这段收起；菜单那一条算上收起来的', () => {
    const s = new AgentStore(dir)
    s.saveMsgs(V, 'home', '首页', [q(1, '第一段', 1000), a(2, '答一', 1001)])
    s.setSession(V, 'home', 'claude', 'sess-1')
    s.shelve(V, 'home')
    expect(s.chat(V, 'home')).toMatchObject({ msgs: [], sessions: {} })
    s.shelve(V, 'home')
    expect(s.olderList(V, 'home').map((o) => o.label)).toEqual(['第一段'])
    s.saveMsgs(V, 'home', '首页', [q(3, '第二段', 2000)])
    expect(s.list(V)).toEqual([{ key: 'home', label: '首页', asks: 2, at: 2000, n: 2, first: '第二段' }])
    const id = s.olderList(V, 'home')[0]!.id
    expect(s.switchOlder(V, 'home', id)).toBe(true)
    expect(s.chat(V, 'home').msgs.map((m) => m.text)).toEqual(['第一段', '答一'])
    expect(s.chat(V, 'home').sessions).toEqual({ claude: 'sess-1' })
    expect(s.olderList(V, 'home').map((o) => o.label)).toEqual(['第二段'])
    expect(s.switchOlder(V, 'home', 12345)).toBe(false)
  })

  it('搬出去（挂到别页、不挂）：现在这段另起 conv: key，这一处开一段空的，收起来的留着', () => {
    const s = new AgentStore(dir)
    s.saveMsgs(V, 'file:甲.md', '甲', [q(1, '旧的', 1000)])
    s.shelve(V, 'file:甲.md')
    s.saveMsgs(V, 'file:甲.md', '甲', [q(2, '要搬的', 2000)])
    const key = s.detach(V, 'file:甲.md', '乙')!
    expect(key).toMatch(/^conv:/)
    expect(s.chat(V, key)).toMatchObject({ label: '乙', msgs: [{ text: '要搬的' }] })
    expect(s.chat(V, 'file:甲.md').msgs).toEqual([])
    expect(s.olderList(V, 'file:甲.md').map((o) => o.label)).toEqual(['旧的'])
    expect(s.detach(V, 'file:甲.md', '乙')).toBeNull()
  })
})

describe('找回清掉的对话（Claude Code 的会话记录，一次性）', () => {
  const line = (o: object) => JSON.stringify(o)
  const userLine = (ctx: string, text: string, ts: string) =>
    line({ type: 'user', timestamp: ts, message: { role: 'user', content: `模式说明\n${ctx}\n右栏网页：没开\n\n用户说：\n${text}\n\n【语言】用中文答。` } })
  const aiLine = (text: string, ts: string) => line({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'thinking', thinking: '想' }, { type: 'text', text }] } })
  const tool = line({ type: 'user', timestamp: '2026-11-20T10:00:03Z', message: { content: [{ type: 'tool_result', content: '工具' }] } })

  it('只收没被引用的会话：认出首页、文档的进那一处的「之前的对话」，认不出的进「找回的对话」；读 PDF 的（没有「用户说」）不收；只做一次', () => {
    const cdir = join(dir, 'claude')
    const proj = join(cdir, 'projects', projectDirName(V))
    mkdirSync(proj, { recursive: true })
    const id = (n: number) => `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`
    writeFileSync(join(proj, `${id(1)}.jsonl`), [userLine('当前标签：首页', '首页问的', '2026-11-20T10:00:00Z'), aiLine('先查一下', '2026-11-20T10:00:02Z'), tool, aiLine('首页答的', '2026-11-20T10:00:05Z'), userLine('当前标签：首页', '再问', '2026-11-20T10:01:00Z'), aiLine('再答', '2026-11-20T10:01:05Z')].join('\n'))
    writeFileSync(join(proj, `${id(2)}.jsonl`), [userLine('当前标签：文档「甲」（课/甲.md）', '甲问的', '2026-11-21T10:00:00Z'), aiLine('甲答的', '2026-11-21T10:00:05Z')].join('\n'))
    writeFileSync(join(proj, `${id(3)}.jsonl`), [userLine('当前标签：归档', '归档问的', '2026-11-22T10:00:00Z')].join('\n'))
    writeFileSync(join(proj, `${id(4)}.jsonl`), [line({ type: 'user', timestamp: '2026-11-22T10:00:00Z', message: { content: '读 PDF 的提示词' } })].join('\n'))
    // 还被引用着的不收
    writeFileSync(join(proj, `${id(5)}.jsonl`), [userLine('当前标签：首页', '还在的', '2026-11-23T10:00:00Z')].join('\n'))
    const s = new AgentStore(dir)
    s.saveMsgs(V, 'home', '首页', [q(1, '还在的', 1000)])
    s.setSession(V, 'home', 'claude', id(5))
    let n = -1
    const run = () => s.recoverOnce(V, () => findLost(cdir, V, knownSessions(s.chatFiles(V)), () => n--))
    expect(run()).toBe(3)
    const home = s.chat(V, 'home')
    expect(home.msgs.map((m) => m.text)).toEqual(['还在的'])
    expect(home.older?.[0]?.msgs.map((m) => [m.role, m.text])).toEqual([
      ['user', '首页问的'],
      ['ai', '先查一下\n\n首页答的'],
      ['user', '再问'],
      ['ai', '再答'],
    ])
    expect(home.older?.[0]?.sessions).toEqual({ claude: id(1) })
    expect(s.olderList(V, 'file:课/甲.md').map((o) => o.label)).toEqual(['甲问的'])
    expect(s.chat(V, 'file:课/甲.md').label).toBe('甲')
    expect(s.olderList(V, RECOVERED.key).map((o) => o.label)).toEqual(['归档问的'])
    expect(s.list(V).map((c) => c.key).sort()).toEqual(['file:课/甲.md', 'home', 'recovered'])
    // 只做一次
    expect(run()).toBe(0)
    expect(s.olderList(V, 'home')).toHaveLength(1)
  })
})
