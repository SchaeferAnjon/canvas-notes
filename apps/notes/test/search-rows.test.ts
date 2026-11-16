import { describe, expect, it } from 'vitest'
import { buildRows, type Group, type RowsInput } from '../src/renderer/search/rows'

const base = (o: Partial<RowsInput<{ name: string }>>): RowsInput<{ name: string }> => ({
  q: '矩阵',
  recent: [],
  pdfNames: [],
  hits: [],
  pdfHits: [],
  meaning: [],
  commands: [],
  url: 'https://www.google.com/search?q=%E7%9F%A9%E9%98%B5',
  looksUrl: false,
  expanded: new Set<Group>(),
  claude: { phase: 'idle' },
  ...o,
})

const kinds = (rows: { kind: string; group: string }[]) => rows.map((r) => `${r.group}:${r.kind}`)

describe('⌘F 的行', () => {
  it('空着：最近打开 5 篇加全部命令', () => {
    const rows = buildRows(base({ q: '', recent: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'], commands: [{ name: '换主题…' }] }))
    expect(kinds(rows)).toEqual([...Array(5).fill('recent:note'), 'cmd:cmd'])
  })

  it('三层的顺序：文字（名字里有的 PDF、标题命中的笔记在前，再正文和 PDF 页轮流）→ 意思相近 → 命令 → 网页 → 最后一行让 Claude 找', () => {
    const rows = buildRows(
      base({
        pdfNames: ['课程/矩阵论.pdf', '课程/别的.pdf'],
        hits: [
          { path: '正文里有.md', snippet: '…矩阵…' },
          { path: '矩阵笔记.md', snippet: '' },
        ],
        pdfHits: [{ path: '课程/第3讲.pdf', page: 4, snippet: '矩阵 A' }],
        meaning: [
          { path: '课程/第3讲.pdf', page: 4, snippet: '重复的，不列', score: 0.9 },
          { path: '课程/第3讲.pdf', page: 5, snippet: '旋转', score: 0.88 },
          { path: '线性映射.md', snippet: '映射', score: 0.86 },
        ],
        commands: [{ name: '矩阵计算器' }, { name: '换主题…' }],
      }),
    )
    expect(kinds(rows)).toEqual(['text:pdfName', 'text:note', 'text:note', 'text:pdfPage', 'meaning:meaning', 'meaning:meaning', 'cmd:cmd', 'web:url', 'claude:claude'])
    expect(rows[1]).toMatchObject({ path: '矩阵笔记.md' })
    expect(rows[4]).toMatchObject({ hit: { page: 5 } })
  })

  it('每组最多 5 条，多的「还有 N 条」，点开后多给一些但也不全铺开', () => {
    const hits = Array.from({ length: 40 }, (_, i) => ({ path: `n${i}.md`, snippet: '矩阵' }))
    const rows = buildRows(base({ hits }))
    expect(kinds(rows).filter((k) => k.startsWith('text'))).toEqual([...Array(5).fill('text:note'), 'text:more'])
    expect(rows[5]).toMatchObject({ kind: 'more', n: 35 })
    const more = buildRows(base({ hits, expanded: new Set<Group>(['text']) }))
    expect(more.filter((r) => r.group === 'text')).toHaveLength(21)
    expect(more[20]).toMatchObject({ kind: 'more', n: 20 })
  })

  it('像网址的放最前；Claude 找完换成它找到的几条', () => {
    const rows = buildRows(base({ q: 'example.com', url: 'https://example.com', looksUrl: true, claude: { phase: 'done', found: [{ path: 'a.pdf', page: 5, why: '因为' }] } }))
    expect(kinds(rows)).toEqual(['web:url', 'claude:found'])
    // 找完一条都没有：还是那一行（显示「也没找到」，回车再找）
    expect(kinds(buildRows(base({ claude: { phase: 'done', found: [] } })))).toEqual(['web:url', 'claude:claude'])
  })

  it('打全了一条命令的名字：这条命令排第一，搜索结果晚到也挤不掉它（回车总是跑命令）', () => {
    const rows = buildRows(
      base({
        q: '拍一张导图',
        hits: [{ path: '导图笔记.md', snippet: '拍一张导图' }],
        meaning: [{ path: '别的.md', snippet: '照片', score: 0.9 }],
        commands: [{ name: '拍一张导图' }, { name: '拍一张导图（从文件）' }, { name: '新建笔记' }],
      }),
    )
    expect(rows[0]).toMatchObject({ kind: 'cmd', cmd: { name: '拍一张导图' } })
    // 只是名字里有的命令照旧排在文字、意思相近后面，打全的那条不重复列
    const cmds = rows.filter((r) => r.kind === 'cmd').map((r) => (r as { cmd: { name: string } }).cmd.name)
    expect(cmds).toEqual(['拍一张导图', '拍一张导图（从文件）'])
  })
})
