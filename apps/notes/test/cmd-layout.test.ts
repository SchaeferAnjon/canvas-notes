import { describe, expect, it } from 'vitest'
import { defaultCommands, hideCmd, moveCmd, newGroup, pinCmd } from '../src/shared/commands'
import { emptySections, type LayoutCmd } from '../src/renderer/search/cmd-layout'
import { withoutTitle } from '../src/renderer/search/rows'

const CMDS: LayoutCmd[] = [
  { id: 'new-note', home: 'new', keys: '⌘N' },
  { id: 'ask-ai', home: 'ai', keys: '⌘J' },
  { id: 'goto', home: 'go', keys: '⌘O' },
  { id: 'home', home: 'go' },
  { id: 'inbox', home: 'go' },
  { id: 'recent', home: 'go' },
  { id: 'archive', home: 'go' },
  { id: 'new-board', home: 'new' },
  { id: 'tidy-inbox', home: 'ai' },
  { id: 'clip-page', home: 'web' },
  { id: 'tr-lang', home: 'web', searchOnly: true },
  { id: 'commit', home: 'lib' },
  { id: 'sync', home: 'lib' },
  { id: 'dup', home: 'lib' },
  { id: 'settings', home: 'app', keys: '⌘,' },
  { id: 'save-desk', home: 'desks' },
  { id: 'back', home: 'more', keys: '⌘[' },
  { id: 'outline', home: 'more' },
  { id: 'folder:课程/ecp', folder: '课程/ecp' },
  { id: 'folder:写作', folder: '写作' },
]
const base = { cfg: defaultCommands(), cmds: CMDS, recent: ['a.md', 'b.md', 'c.md', 'd.md'], foldersOpen: false, showHidden: false, dragging: false }
const shape = (s: ReturnType<typeof emptySections>) => s.map((x) => `${x.name || x.id}:${x.rows.map((r) => ('id' in r ? r.id : 'path' in r ? r.path : r.kind)).join(',')}`)

describe('⌘K 没打字时的八组', () => {
  it('从近到远：钉住的、最近打开 3 篇、去哪（文件夹首页收成一行）……空组不画；最后是加一条自己的命令', () => {
    expect(shape(emptySections(base))).toEqual([
      '钉住的:new-note,ask-ai,goto',
      '书桌:save-desk',
      '最近打开:a.md,b.md,c.md',
      '去哪:home,inbox,folders,recent,archive',
      '新建和导入:new-board',
      '让AI做:tidy-inbox',
      '网页:clip-page',
      '库和同步:commit,sync,dup',
      '设置和外观:settings',
      'more:more',
      'tail:add',
    ])
  })

  it('书桌一组（task-xy89o）：没有书桌时也在、只有「存成书桌…」；有书桌时书桌在前、「存成书桌…」在最后', () => {
    expect(shape(emptySections(base))).toContain('书桌:save-desk')
    const s = emptySections({ ...base, cmds: [...CMDS, { id: 'desk:a.json', desk: true }, { id: 'desk:b.json', desk: true }] })
    expect(s.find((x) => x.id === 'desks')!.rows).toEqual([
      { kind: 'desk', id: 'desk:a.json' },
      { kind: 'desk', id: 'desk:b.json' },
      { kind: 'cmd', id: 'save-desk', gid: 'desks' },
    ])
  })

  it('更多命令 ›（task-xy89o）：收成一行写几条，点开在下面一条条列出来（能钉住、换组）；只在打字时出的说明不进来', () => {
    const s = emptySections(base)
    expect(s.find((x) => x.id === 'more')).toEqual({ id: 'more', name: '', rows: [{ kind: 'more', n: 2, open: false }] })
    const o = emptySections({ ...base, moreOpen: true })
    expect(o.find((x) => x.id === 'more')!.rows).toEqual([
      { kind: 'more', n: 2, open: true },
      { kind: 'cmd', id: 'back', gid: 'more' },
      { kind: 'cmd', id: 'outline', gid: 'more' },
    ])
    expect(shape(o).join('|')).not.toContain('tr-lang')
    // 钉住的从更多命令里出来、在钉住的那组
    const cfg = pinCmd(defaultCommands(), CMDS, 'back')
    expect(shape(emptySections({ ...base, cfg }))).toContain('钉住的:new-note,ask-ai,goto,back')
    expect(emptySections({ ...base, cfg }).find((x) => x.id === 'more')!.rows[0]).toEqual({ kind: 'more', n: 1, open: false })
  })

  it('文件夹首页点开才一个个列出来', () => {
    const s = emptySections({ ...base, foldersOpen: true })
    expect(s.find((x) => x.id === 'go')!.rows.map((r) => r.kind)).toEqual(['cmd', 'cmd', 'folders', 'child', 'child', 'cmd', 'cmd'])
  })

  it('钉住、藏起、挪进自己建的组；藏着的 N 条点开能放回；钉空了留一行落点', () => {
    let cfg = pinCmd(defaultCommands(), CMDS, 'sync')
    cfg = hideCmd(cfg, 'archive')
    cfg = moveCmd(newGroup(cfg, CMDS, '常用', 'g-a'), CMDS, 'dup', 'g-a', null)
    const s = emptySections({ ...base, cfg })
    expect(shape(s)).toContain('钉住的:new-note,ask-ai,goto,sync')
    expect(shape(s)).toContain('去哪:home,inbox,folders,recent')
    expect(shape(s)).toContain('常用:dup')
    expect(s.at(-1)!.rows).toEqual([{ kind: 'add' }, { kind: 'hidden', n: 1, open: false }])
    expect(emptySections({ ...base, cfg, showHidden: true }).at(-1)!.rows.at(-1)).toEqual({ kind: 'put', id: 'archive' })
    let empty = defaultCommands()
    for (const id of ['new-note', 'ask-ai', 'goto']) empty = moveCmd(empty, CMDS, id, 'go', null)
    expect(emptySections({ ...base, cfg: empty })[0]).toEqual({ id: 'pin', name: '钉住的', rows: [{ kind: 'empty', gid: 'pin' }] })
  })

  it('正文那一小段开头就是标题：行里已经写了名字，不再重复', () => {
    expect(withoutTitle('2026-W47 这周把库同步到新电脑', '2026-W47')).toBe('这周把库同步到新电脑')
    expect(withoutTitle('…记下时间点再同步一次', 'Lecture05 笔记')).toBe('…记下时间点再同步一次')
    expect(withoutTitle('读书', '读书')).toBe('读书')
  })

  it('拖着的时候空组也画出来当落点', () => {
    let cfg = defaultCommands()
    cfg = moveCmd(cfg, CMDS, 'clip-page', 'lib', null)
    expect(emptySections({ ...base, cfg }).some((s) => s.id === 'web')).toBe(false)
    expect(emptySections({ ...base, cfg, dragging: true }).find((s) => s.id === 'web')!.rows).toEqual([{ kind: 'empty', gid: 'web' }])
  })
})
