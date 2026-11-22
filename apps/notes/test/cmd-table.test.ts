/**
 * 命令表（task-spsmf）：每条一个身份、默认的键写法对、同一处能按的不撞、默认的键都给得出去；
 * 设键、回到默认、对调照「在哪儿能按」让键（编辑器里和 ⌘K 里不会同时按到，加链接有意和搜索同键）；不能给的键说为什么。
 */
import { describe, expect, it } from 'vitest'
import { isCombo, keyProblem, RESERVED } from '../src/shared/cmd-keys'
import { canShare, clashOf, isRebindable, KEYMAP, keyDef, keyProblemFor } from '../src/shared/cmd-table'
import { type Avail, defaultCommands, effectiveKeys, GROUPS, resetKey, setKey, swapKey } from '../src/shared/commands'
import { MENU_CMDS } from '../src/renderer/keys'

const AVAIL: Avail[] = KEYMAP.filter((d) => isRebindable(d) && !d.store).map((d) => ({ id: d.id, keys: d.keys?.[0], also: d.keys?.slice(1) }))
const keysOf = (c = defaultCommands()) => (id: string) => effectiveKeys(c, AVAIL, id)

describe('命令表', () => {
  it('每条一个身份，名字不空；默认的键写法对（固定的只是写给人看）', () => {
    const ids = KEYMAP.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of KEYMAP) {
      expect(d.name.trim()).not.toBe('')
      if (isRebindable(d)) for (const k of d.keys ?? []) expect(isCombo(k), `${d.id} ${k}`).toBe(true)
    }
    expect(KEYMAP.length).toBeGreaterThanOrEqual(80)
  })

  it('默认的键：同一处能按的两条不撞；都给得出去；不抢系统和编辑器本身的键', () => {
    const rb = KEYMAP.filter(isRebindable)
    for (const a of rb)
      for (const b of rb) {
        if (a.id >= b.id) continue
        const same = (a.keys ?? []).filter((k) => (b.keys ?? []).includes(k))
        if (same.length) expect(canShare(a.id, b.id), `${a.id} 和 ${b.id} 都是 ${same.join(' ')}`).toBe(true)
      }
    for (const d of rb) for (const k of d.keys ?? []) {
      expect(RESERVED[k], `${d.id} 用了系统的 ${k}`).toBeUndefined()
      expect(keyProblemFor(d.id, k), `${d.id} ${k}`).toBeNull()
    }
    // 全局的不占编辑器里加粗、斜体，不占 ⌘W 以外的系统键
    const app = rb.filter((d) => d.area === 'app').flatMap((d) => d.keys ?? [])
    for (const k of ['⌘B', '⌘I', '⌘Z', '⌘C', '⌘V', '⌘X', '⌘A', '⌘Q', '⌘H', '⌘M']) expect(app).not.toContain(k)
  })

  it('常用的都有默认键（照 Obsidian、VS Code、Notion、macOS 的习惯）', () => {
    const k = (id: string) => keyDef(id)?.keys?.[0]
    expect([k('search'), k('goto'), k('new-note'), k('new-board'), k('ask-ai'), k('settings'), k('close')]).toEqual(['⌘K', '⌘O', '⌘N', '⇧⌘N', '⌘J', '⌘,', '⌘W'])
    expect([k('toggle-left'), k('toggle-right'), k('left-files'), k('left-recent'), k('back'), k('forward'), k('home')]).toEqual(['⌘\\', '⌥⌘\\', '⇧⌘E', '⇧⌘R', '⌘[', '⌘]', '⇧⌘H'])
    expect([k('toggle-view'), k('history'), k('outline'), k('open-web'), k('clip-page'), k('capture'), k('quick-note'), k('dream-report')]).toEqual(['⌘E', '⌘Y', '⌥⌘O', '⌥⌘W', '⇧⌘S', '⇧⌘C', '⌥⌘N', '⇧⌘D'])
    expect(keyDef('search')?.keys).toEqual(['⌘K', '⌘F'])
  })

  it('⌘K 里默认的组都是有的组；菜单栏上的每一项都在命令表里', () => {
    const groups = new Set(GROUPS.map((g) => g.id))
    for (const d of KEYMAP) if (d.home) expect(groups.has(d.home), d.id).toBe(true)
    for (const id of MENU_CMDS) expect(keyDef(id), id).toBeDefined()
  })

  it('撞了谁：同一处能按才算；编辑器里和 ⌘K 里不撞；速记是全局键，和谁都撞', () => {
    expect(clashOf('sync', '⌘N', keysOf())).toEqual({ id: 'new-note', name: '新建笔记' })
    expect(clashOf('bold', '⌘P', keysOf())).toBeNull()
    expect(clashOf('bold', '⌘J', keysOf())).toEqual({ id: 'ask-ai', name: '问AI' })
    expect(clashOf('quick-note', '⌘B', keysOf())).toEqual({ id: 'bold', name: '加粗' })
    // 加链接有意和搜索同一个 ⌘K
    expect(clashOf('add-link', '⌘K', keysOf())).toBeNull()
    // 命令表以外的（自己加的命令）在「软件里」
    const c = setKey(defaultCommands(), [...AVAIL, { id: 'own-a1' }], 'own-a1', '⌥⌘1')
    expect(clashOf('sync', '⌥⌘1', (id) => effectiveKeys(c, [...AVAIL, { id: 'own-a1' }], id), [{ id: 'own-a1', name: '打开讲义' }])).toEqual({ id: 'own-a1', name: '打开讲义' })
  })

  it('不能给的键说为什么：系统的、编辑时用的、不带 ⌘ ⌃ 的；视频的只认 ⌥ 加字母；双语翻译能用 ⌥ 加字母', () => {
    expect(keyProblemFor('sync', '⌘Q')).toBe('⌘Q 是退出，换一个')
    expect(keyProblemFor('sync', '⌘←')).toBe('⌘← 编辑时要用，换一个')
    expect(keyProblemFor('sync', '⌥T')).toBe('要带上 ⌘ 或 ⌃，不然打字时会按到')
    expect(keyProblemFor('translate', '⌥T')).toBeNull()
    expect(keyProblemFor('video-moment', '⌘S')).toBe('视频的键只能用 ⌥ 加一个字母或数字：网站自己的键都不带 ⌥，不会打架')
    expect(keyProblemFor('video-moment', '⌥K')).toBe('⌥K 是「播放 / 暂停」，换一个')
    expect(keyProblemFor('video-moment', '⌥X')).toBeNull()
    // 命令表里本来就这么用的编辑键（⌘↵、⌥⇧↑）给得出去，别的不给
    expect(keyProblemFor('ask-page', '⌘↵')).toBeNull()
    expect(keyProblem('⌘↵')).toBe('⌘↵ 编辑时要用，换一个')
    // Tab / ⇧Tab（task-busas）：文档里的缩进 / 写评价默认就是它们，能改；不带 ⌘ ⌃ ⌥ 的 ⇥ 不给文档以外的命令
    expect([keyDef('indent')?.keys, keyDef('outdent')?.keys]).toEqual([['⇥'], ['⇧⇥']])
    expect(isRebindable(keyDef('indent')!)).toBe(true)
    expect(keyProblemFor('outdent', '⇥')).toBeNull()
    expect(keyProblemFor('sync', '⇥')).toBe('⇥ 编辑时要用，换一个')
  })
})

describe('设键、清掉、回到默认、对调', () => {
  it('两个默认键的（搜索 ⌘K ⌘F）：别人拿走一个，留着另一个；回到默认两个都回来，拿走的那条让出来', () => {
    let c = setKey(defaultCommands(), AVAIL, 'sync', '⌘F')
    expect(keysOf(c)('search')).toEqual(['⌘K'])
    expect(keysOf(c)('sync')).toEqual(['⌘F'])
    c = setKey(defaultCommands(), AVAIL, 'sync', '⌘K')
    expect(keysOf(c)('search')).toEqual(['⌘F'])
    // ⌘K 在文档里（选了字）是加链接：给了别的全局命令，加链接也让出来，不然文档里按的是加链接
    expect(keysOf(c)('add-link')).toEqual([])
    c = resetKey(c, AVAIL, 'search')
    expect(keysOf(c)('search')).toEqual(['⌘K', '⌘F'])
    expect(keysOf(c)('sync')).toEqual([])
    expect(c.keys).toEqual({ 'add-link': '' })
    c = resetKey(c, AVAIL, 'add-link')
    expect(c.keys).toEqual({})
  })

  it('不会同时按到的不用让：⌘↵ 在 ⌘K 里、网页里、读 PDF 时各是各的；⌘S 网页里是剪藏、文档里是存盘', () => {
    let c = setKey(defaultCommands(), AVAIL, 'ask-page', null)
    expect(keysOf(c)('ask-page')).toEqual([])
    c = resetKey(c, AVAIL, 'ask-page')
    expect(keysOf(c)('ask-page')).toEqual(['⌘↵'])
    expect(keysOf(c)('pal-web')).toEqual(['⌘↵'])
    expect(keysOf(c)('quote-selection')).toEqual(['⌘↵'])
    // 网页里选了字：剪藏 ⌘S（和文档里的马上存盘不会同时按到）
    expect(keysOf(c)('clip-selection')).toEqual(['⌘S'])
    expect(canShare('clip-selection', 'save-now')).toBe(true)
    expect(c.keys).toEqual({})
    // ⌘K 里的 ⌘P（钉住）给了文档里的加粗：两处不会同时按到，钉住不让
    c = setKey(defaultCommands(), AVAIL, 'bold', '⌘P')
    expect(keysOf(c)('pal-pin')).toEqual(['⌘P'])
  })

  it('没有默认键的设了能用、清掉不留记录；对调：这一条拿新键，原来那条拿这一条原来的键', () => {
    let c = setKey(defaultCommands(), AVAIL, 'sync', '⌥⌘Y')
    expect(c.keys).toEqual({ sync: '⌥⌘Y' })
    c = setKey(c, AVAIL, 'sync', null)
    expect(c.keys).toEqual({})
    c = swapKey(defaultCommands(), AVAIL, 'new-note', '⌘J')
    expect(keysOf(c)('new-note')).toEqual(['⌘J'])
    expect(keysOf(c)('ask-ai')).toEqual(['⌘N'])
    c = setKey(defaultCommands(), AVAIL, 'new-note', null)
    expect(c.keys).toEqual({ 'new-note': '' })
    expect(resetKey(c, AVAIL, 'new-note').keys).toEqual({})
  })
})
