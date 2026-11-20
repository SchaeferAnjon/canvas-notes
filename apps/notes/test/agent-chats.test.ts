// AI 对话按地方存（D 组 CN-132）：每个地方一份、各有各的会话号；以前全库一份的迁成「以前的对话」；菜单列问过的（含读 PDF 的），按时间排
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readingChats, readingKey } from '../src/main/reading/chats'
import { AgentStore } from '../src/main/agent/store'
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
    expect(s.list(V)).toEqual([
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
    expect(s.list(V)).toEqual([{ key: 'file:写作/定稿.md', label: '定稿', asks: 1, at: 5 }])
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
      { key: 'read:web:https://www.youtube.com/watch?v=1', label: 'Linear maps', asks: 1, at: 900 },
      { key: 'read:课程/线代/第3讲.pdf', label: '第3讲.pdf', asks: 1, at: 310 },
    ])
    expect(readingChats(join(dir, '没有'), V)).toEqual([])
    expect(readdirSync(rd).length).toBe(6)
  })
})
