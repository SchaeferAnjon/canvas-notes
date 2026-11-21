import { describe, expect, it } from 'vitest'
import {
  addOwn,
  commandsJson,
  defaultCommands,
  deleteOwn,
  effectiveKey,
  hideCmd,
  layoutOf,
  materialize,
  moveCmd,
  newGroup,
  normalizeCommands,
  pinCmd,
  sameAsDefault,
  setAlias,
  setKey,
  unhideCmd,
  unpinCmd,
  updateOwn,
  webMenuOrder,
  toggleWebHidden,
  moveWebItem,
  type Avail,
} from '../src/shared/commands'

// home：它自己那一组（默认钉住的三条也有，取消钉住回到那里）
const AVAIL: Avail[] = [
  { id: 'new-note', home: 'new', keys: '⌘N' },
  { id: 'ask-ai', home: 'ai', keys: '⌘J' },
  { id: 'goto', home: 'go', keys: '⌘O' },
  { id: 'home', home: 'go', keys: '⇧⌘H' },
  { id: 'inbox', home: 'go' },
  { id: 'sync', home: 'lib' },
  { id: 'commit', home: 'lib' },
  { id: 'dup', home: 'lib' },
  { id: 'tidy-inbox', home: 'ai' },
  { id: 'translate', home: 'web', keys: '⌥A' },
  // 插件给的、默认表里没有的：接在它那一组最后
  { id: 'plugin:weread:sync', home: 'web' },
]

const items = (c: ReturnType<typeof defaultCommands>, gid: string) => materialize(c, AVAIL).find((g) => g.id === gid)?.items.filter((id) => AVAIL.some((a) => a.id === id)) ?? []

describe('⌘K 的自定义（.canvas-notes/命令.json）', () => {
  it('没改过：默认八组，钉住的是新建笔记、问AI、按名字跳到；没写进默认表的插件命令接在它那一组最后；和默认一样不建文件', () => {
    const c = defaultCommands()
    expect(layoutOf(c).map((g) => g.id)).toEqual(['pin', 'go', 'new', 'ai', 'web', 'lib', 'app'])
    expect(items(c, 'pin')).toEqual(['new-note', 'ask-ai', 'goto'])
    expect(items(c, 'web')).toEqual(['translate', 'plugin:weread:sync'])
    expect(sameAsDefault(c)).toBe(true)
  })

  it('钉住：从原来那组拿出来放到钉住的最后；取消钉住回到原来那组最前（照小样）', () => {
    let c = pinCmd(defaultCommands(), AVAIL, 'sync')
    expect(items(c, 'pin')).toEqual(['new-note', 'ask-ai', 'goto', 'sync'])
    expect(items(c, 'lib')).toEqual(['commit', 'dup'])
    expect(sameAsDefault(c)).toBe(false)
    c = unpinCmd(c, AVAIL, 'sync')
    expect(items(c, 'pin')).toEqual(['new-note', 'ask-ai', 'goto'])
    expect(items(c, 'lib')).toEqual(['sync', 'commit', 'dup'])
    // 默认就钉着的取消钉住：回到它默认的那组（问AI 是让AI做）
    c = unpinCmd(c, AVAIL, 'ask-ai')
    expect(items(c, 'ai')[0]).toBe('ask-ai')
  })

  it('挪到别的组、挪到某一条前面；挪进新的一组，那组空了就没了', () => {
    let c = moveCmd(defaultCommands(), AVAIL, 'dup', 'ai', null)
    expect(items(c, 'ai')).toEqual(['tidy-inbox', 'dup'])
    c = moveCmd(c, AVAIL, 'dup', 'ai', 'tidy-inbox')
    expect(items(c, 'ai')).toEqual(['dup', 'tidy-inbox'])
    const made = newGroup(c, AVAIL, '常用', 'g-test')
    c = moveCmd(made, AVAIL, 'sync', 'g-test', null)
    expect(layoutOf(c).at(-1)).toEqual({ id: 'g-test', name: '常用', items: ['sync'] })
    c = moveCmd(c, AVAIL, 'sync', 'lib', null)
    expect(layoutOf(c).some((g) => g.id === 'g-test')).toBe(false)
    // 挪到别的组以后再钉住、取消钉住：回到挪去的那一组
    c = moveCmd(c, AVAIL, 'inbox', 'lib', null)
    c = unpinCmd(pinCmd(c, AVAIL, 'inbox'), AVAIL, 'inbox')
    expect(items(c, 'lib')[0]).toBe('inbox')
  })

  it('藏起、放回；藏起的还在原来那组里（放回原处）', () => {
    let c = hideCmd(defaultCommands(), 'inbox')
    expect(c.hidden).toEqual(['inbox'])
    expect(items(c, 'go')).toContain('inbox')
    c = unhideCmd(c, 'inbox')
    expect(c.hidden).toEqual([])
  })

  it('别名：去掉首尾空格，空的是拿掉', () => {
    let c = setAlias(defaultCommands(), 'sync', '  tb ')
    expect(c.alias).toEqual({ sync: 'tb' })
    c = setAlias(c, 'sync', '')
    expect(c.alias).toEqual({})
  })

  it('快捷键：撞了别的命令就换给这一条，原来那条没有键了（默认的记成空串）；设回默认就不记', () => {
    let c = setKey(defaultCommands(), AVAIL, 'sync', '⌘N')
    expect(effectiveKey(c, 'sync', undefined)).toBe('⌘N')
    expect(effectiveKey(c, 'new-note', '⌘N')).toBeNull()
    expect(c.keys).toEqual({ sync: '⌘N', 'new-note': '' })
    c = setKey(c, AVAIL, 'new-note', '⌘N')
    expect(c.keys).toEqual({})
    expect(effectiveKey(c, 'sync', undefined)).toBeNull()
    // 自己设的键被别的抢了：直接拿掉，不记空串
    c = setKey(c, AVAIL, 'sync', '⌥⌘S')
    c = setKey(c, AVAIL, 'dup', '⌥⌘S')
    expect(c.keys).toEqual({ dup: '⌥⌘S' })
  })

  it('自己加的命令：放进选的那组；改名字、换组；删掉的连同别名、快捷键、藏起一起拿掉', () => {
    let c = addOwn(defaultCommands(), AVAIL, { id: 'own-a1', name: '打开讲义', kind: 'open', target: '课程/ecp/讲义' }, 'pin')
    expect(items({ ...c }, 'pin')).toEqual(['new-note', 'ask-ai', 'goto'])
    expect(layoutOf(c).find((g) => g.id === 'pin')!.items).toEqual(['new-note', 'ask-ai', 'goto', 'own-a1'])
    c = setAlias(c, 'own-a1', 'jy')
    c = updateOwn(c, AVAIL, { id: 'own-a1', name: '打开 ecp 讲义', kind: 'open', target: '课程/ecp/讲义' }, 'go')
    expect(c.own[0]!.name).toBe('打开 ecp 讲义')
    expect(layoutOf(c).find((g) => g.id === 'go')!.items).toContain('own-a1')
    expect(layoutOf(c).find((g) => g.id === 'pin')!.items).not.toContain('own-a1')
    c = hideCmd(c, 'own-a1')
    c = deleteOwn(c, 'own-a1')
    expect(c.own).toEqual([])
    expect(c.alias).toEqual({})
    expect(c.hidden).toEqual([])
    expect(layoutOf(c).some((g) => g.items.includes('own-a1'))).toBe(false)
  })

  it('写出来再读回去一样；不认识的字段（以后的 AI 命令、新版本的设置）原样留着', () => {
    let c = pinCmd(defaultCommands(), AVAIL, 'sync')
    c = setAlias(setKey(c, AVAIL, 'sync', '⌥⌘S'), 'sync', 'tb')
    c = addOwn(c, AVAIL, { id: 'own-b2', name: '课程网站', kind: 'url', target: 'https://example.com' }, 'go')
    const text = commandsJson(c)
    expect(text.endsWith('\n')).toBe(true)
    expect(commandsJson(normalizeCommands(JSON.parse(text)))).toBe(text)
    const future = { ...JSON.parse(text), later: { x: 1 }, own: [{ id: 'own-c3', name: '写周记', kind: 'ai', target: '把这周剪的写成周记', engine: 'claude', writes: ['周记/'] }] }
    const back = JSON.parse(commandsJson(normalizeCommands(future)))
    expect(back.later).toEqual({ x: 1 })
    expect(back.own[0]).toEqual({ id: 'own-c3', name: '写周记', kind: 'ai', target: '把这周剪的写成周记', engine: 'claude', writes: ['周记/'] })
  })

  it('读坏了的、手改错的：当没改过或只留对的那几样，不报错', () => {
    expect(sameAsDefault(normalizeCommands(null))).toBe(true)
    expect(sameAsDefault(normalizeCommands('乱写'))).toBe(true)
    const c = normalizeCommands({
      groups: [{ id: 'pin', items: ['sync', 'sync', 42] }, { id: 'g-x', items: ['dup'] }, { id: '../x', name: 'x', items: [] }],
      hidden: ['a', 'a', 3],
      alias: { sync: '  ', dup: 'cf' },
      keys: { sync: '⌥⌘S', dup: 'S', x: '⌘' },
      own: [{ id: 'own-ok1', name: '好的', kind: 'url', target: 'https://a.b' }, { id: 'bad', name: '', kind: 'open', target: '' }],
    })
    expect(layoutOf(c).find((g) => g.id === 'pin')!.items).toEqual(['sync'])
    // 自己建的组没名字：起名「我的一组」
    expect(layoutOf(c).find((g) => g.id === 'g-x')).toEqual({ id: 'g-x', name: '我的一组', items: ['dup'] })
    expect(c.hidden).toEqual(['a'])
    expect(c.alias).toEqual({ dup: 'cf' })
    expect(c.keys).toEqual({ sync: '⌥⌘S' })
    expect(c.own.map((o) => o.id)).toEqual(['own-ok1'])
  })

  it('网页「⋯」：藏起、在组里换顺序；插件…一直在', () => {
    let c = toggleWebHidden(defaultCommands(), 'later')
    expect(c.web.hidden).toEqual(['later'])
    c = toggleWebHidden(c, 'extensions')
    expect(c.web.hidden).toEqual(['later'])
    c = moveWebItem(c, 'page', ['clip', 'later', 'translate'], 'translate', 'clip')
    expect(webMenuOrder(c, 'page', ['clip', 'later', 'translate'])).toEqual(['translate', 'clip', 'later'])
    // 插件后来多给了一项：接在最后
    expect(webMenuOrder(c, 'page', ['clip', 'later', 'translate', 'new'])).toEqual(['translate', 'clip', 'later', 'new'])
  })
})
