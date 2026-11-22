// 「突然白屏」兜底（task-pyb39）：出错日志滚动和限流，恢复上次状态时坏数据丢掉、记一行，不让渲染抛错
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatReport, logDropped, RollingLog, shareLog } from '../src/main/crash-log'
import { SettingsFile } from '../src/main/settings'
import { VideoStore } from '../src/main/video/store'
import { loadDock } from '../src/shared/dock'
import { parseTabs } from '../src/renderer/tabs'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-crash-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('出错日志', () => {
  it('写进 main.log，多行的堆栈缩进', () => {
    const log = new RollingLog(join(dir, 'logs'))
    log.write('renderer-render', 'Error: 坏了\n    at A\n    at B')
    const text = readFileSync(join(dir, 'logs', 'main.log'), 'utf8')
    expect(text).toMatch(/^\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}\] \[renderer-render\] Error: 坏了\n {6}at A\n {6}at B\n$/)
  })

  it('跨天换文件，连当天一共留 7 份', () => {
    let now = new Date(2026, 10, 1, 9)
    const log = new RollingLog(dir, { now: () => now })
    for (let d = 1; d <= 10; d++) {
      now = new Date(2026, 10, d, 9)
      log.write('x', `第 ${d} 天`)
      // 文件的修改时间就是写的那天（换文件按修改时间认天）
      utimesSync(join(dir, 'main.log'), now, now)
    }
    expect(readdirSync(dir).sort()).toEqual(['main.1.log', 'main.2.log', 'main.3.log', 'main.4.log', 'main.5.log', 'main.6.log', 'main.log'])
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toContain('第 10 天')
    expect(readFileSync(join(dir, 'main.6.log'), 'utf8')).toContain('第 4 天')
  })

  it('超过大小也换文件', () => {
    const log = new RollingLog(dir, { maxBytes: 100 })
    log.write('x', 'a'.repeat(120))
    log.write('x', 'b')
    expect(readFileSync(join(dir, 'main.1.log'), 'utf8')).toContain('aaa')
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toContain('b')
  })

  it('刷屏时每分钟只记前几条，下一分钟说省略了多少', () => {
    // 换文件按文件的修改时间认天：用今天的时间
    const base = Math.floor(Date.now() / 60000) * 60000
    let now = new Date(base)
    const log = new RollingLog(dir, { perMinute: 3, now: () => now })
    for (let i = 0; i < 10; i++) log.write('x', `第${i}条`)
    now = new Date(base + 60000)
    log.write('x', '下一分钟')
    const text = readFileSync(join(dir, 'main.log'), 'utf8')
    expect(text.match(/第\d条/g)).toEqual(['第0条', '第1条', '第2条'])
    expect(text).toContain('省略了 7 条')
    expect(text).toContain('下一分钟')
  })

  it('一条太长截掉', () => {
    const log = new RollingLog(dir)
    log.write('x', 'a'.repeat(5000))
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toContain('（截掉 1000 字）')
  })

  it('界面报上来的：只认几种类型，拼成哪一块 + 错误 + 堆栈 + 组件', () => {
    expect(formatReport({ kind: 'render', area: 'ai', message: 'TypeError: x is undefined', stack: 'TypeError: x\n at y', componentStack: '\n at AiDock\n at Desk' })).toEqual({
      what: 'renderer-render',
      text: '[ai] TypeError: x is undefined\nTypeError: x\n at y\n组件：at AiDock\n at Desk',
    })
    expect(formatReport({ kind: 'note-text', message: '笔记内容' })).toBeNull()
    expect(formatReport(null)).toBeNull()
  })
})

describe('恢复上次开着的标签', () => {
  const drops: string[] = []
  const onDrop = (w: string) => drops.push(w)
  beforeEach(() => (drops.length = 0))

  it('好的照样恢复', () => {
    const raw = JSON.stringify({ tabs: [{ id: 'a', type: 'home' }, { id: 'b', type: 'note', path: '收件箱/x.md', fresh: true }, { id: 'c', type: 'web', url: 'https://zh.d2l.ai/' }], active: 'b' })
    expect(parseTabs(raw, onDrop)).toEqual({
      tabs: [{ id: 'a', type: 'home' }, { id: 'b', type: 'note', path: '收件箱/x.md', fresh: false }, { id: 'c', type: 'web', url: 'https://zh.d2l.ai/' }],
      active: 'b',
    })
    expect(drops).toEqual([])
  })

  it('少字段、不认识的种类、重复的 id、null 丢掉，记一行（不带路径）', () => {
    const raw = JSON.stringify({
      tabs: [{ id: 'a', type: 'note' }, { id: 'b', type: 'pdf', path: 3 }, null, { id: 'c', type: '外星' }, { id: 'd', type: 'home' }, { id: 'd', type: 'recent' }, { type: 'home' }, { id: 'e', type: 'diff', title: 'x' }],
      active: 'a',
    })
    const r = parseTabs(raw, onDrop)
    expect(r.tabs).toEqual([{ id: 'd', type: 'home' }])
    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatch(/^丢掉 7 个标签/)
  })

  it('整份坏了：不是 JSON、没有列表', () => {
    expect(parseTabs('{tabs:', onDrop)).toEqual({ tabs: [], active: null })
    expect(parseTabs('{"tabs":{"0":1}}', onDrop)).toEqual({ tabs: [], active: null })
    expect(parseTabs('null', onDrop)).toEqual({ tabs: [], active: null })
    expect(drops).toEqual(['标签记录不是 JSON', '标签记录里没有标签列表', '标签记录里没有标签列表'])
  })

  it('旧的「全部笔记」换成「最近」，「我的疑惑」不再开，都不算坏数据', () => {
    const r = parseTabs(JSON.stringify({ tabs: [{ id: 'a', type: 'all' }, { id: 'b', type: 'doubts' }], active: 'a' }), onDrop)
    expect(r.tabs).toEqual([{ id: 'a', type: 'recent' }])
    expect(drops).toEqual([])
  })
})

describe('恢复右栏布局', () => {
  it('坏的当没有，记一行', () => {
    const drops: string[] = []
    expect(loadDock('{oops', {}, (w) => drops.push(w)).cols).toEqual([{ id: 'center' }])
    expect(loadDock('{"v":2}', {}, (w) => drops.push(w)).cols).toEqual([{ id: 'center' }])
    expect(drops).toHaveLength(2)
  })
})

describe('主进程的本机记录', () => {
  it('视频记录：坏的那条丢掉、时刻不是数组补成空的，记一行', () => {
    const log = new RollingLog(join(dir, 'logs'))
    shareLog(log)
    const f = join(dir, 'state.json')
    writeFileSync(f, JSON.stringify({ videos: { a: { pos: 'x', moments: 'oops' }, b: 3, c: { pos: 12, moments: [{ t: 1, note: '记' }, { t: 'x' }] } } }))
    const s = new VideoStore(f)
    expect(s.get('a')?.moments).toEqual([])
    expect(s.get('a')?.pos).toBe(0)
    expect(s.get('b')).toBeUndefined()
    expect(s.get('c')?.moments).toEqual([{ t: 1, note: '记' }])
    expect(readFileSync(log.file, 'utf8')).toContain('[video] 恢复时丢掉了坏数据')
  })

  it('settings.json 坏了：改名成 .broken 留着、按默认打开，记一行', () => {
    const log = new RollingLog(join(dir, 'logs'))
    shareLog(log)
    mkdirSync(join(dir, 'u'))
    const f = join(dir, 'u', 'settings.json')
    writeFileSync(f, '{"lastVault": "/x", ')
    const s = new SettingsFile(f)
    expect(s.read()).toEqual({})
    expect(readFileSync(f + '.broken', 'utf8')).toBe('{"lastVault": "/x", ')
    expect(readFileSync(log.file, 'utf8')).toContain('settings.json 读不出来')
    s.patch({ quickHint: true })
    expect(s.read()).toEqual({ quickHint: true })
  })

  it('没建日志时 logDropped 不出错', () => {
    expect(() => logDropped('x', 'y')).not.toThrow()
  })
})
