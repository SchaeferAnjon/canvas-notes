import { describe, expect, it } from 'vitest'
import type { DreamItem, DreamReport, NoteFile } from '../src/shared/api'
import { fileGroups, pendingMoves, previewLine, previewOf, searchGroup } from '../src/shared/dream-preview'

const note = (path: string, extra: Partial<NoteFile> = {}): NoteFile => ({ path, mtimeMs: 1, createdMs: 1, kind: path.startsWith('收件箱/') ? 'inbox' : 'work', ...extra })
const item = (id: string, from: string, to: string, state: DreamItem['state'] = 'pending', extra: Partial<DreamItem> = {}): DreamItem => ({
  id,
  group: 'file',
  title: to,
  sub: '',
  why: '',
  commit: 'c' + id,
  files: [from, to],
  state,
  move: { from, to },
  ...extra,
})
const report = (items: DreamItem[]): DreamReport => ({ branch: 'dream/11-16', base: 'main', baseCommit: 'x', started: 0, finished: 0, trigger: 'manual', items, notes: [], closed: false })

describe('梦游预览', () => {
  const items = [
    item('1', '收件箱/导图 11-15 21∶40.md', '课程/线性代数/第3讲 线性映射 导图.md'),
    item('2', '收件箱/一条速记.md', '生活/周末去花市.md', 'pending', { redo: '速记放 生活' }),
    item('3', '收件箱/剪的.md', '素材/旅行/剪的.md'),
    item('4', '收件箱/已收下.md', '写作/已收下.md', 'taken'),
    { id: '5', group: 'link', title: '', sub: '', why: '', commit: 'c5', files: [], state: 'pending' } as DreamItem,
  ]

  it('只换没收下的归类和改名：路径、分区、主题跟着变，原位置留影子', () => {
    const moves = pendingMoves(report(items))
    expect(moves.map((m) => [m.id, m.renamed, m.redo])).toEqual([
      ['1', true, undefined],
      ['2', true, '速记放 生活'],
      ['3', false, undefined],
    ])
    const notes = [note('收件箱/导图 11-15 21∶40.md', { board: { color: '#888', cards: 0, thumb: [] } }), note('收件箱/一条速记.md'), note('收件箱/剪的.md'), note('所思所想.md')]
    const pv = previewOf(notes, moves)
    expect(pv.notes.map((n) => [n.path, n.kind, n.topic])).toEqual([
      ['课程/线性代数/第3讲 线性映射 导图.md', 'work', undefined],
      ['生活/周末去花市.md', 'work', undefined],
      ['素材/旅行/剪的.md', 'clip', '旅行'],
      ['所思所想.md', 'work', undefined],
    ])
    expect(pv.notes[0]!.board).toBeDefined()
    expect([...pv.marks.keys()]).toEqual(['课程/线性代数/第3讲 线性映射 导图.md', '生活/周末去花市.md', '素材/旅行/剪的.md'])
    expect(pv.ghosts.map((g) => g.from)).toEqual(['收件箱/导图 11-15 21∶40.md', '收件箱/一条速记.md', '收件箱/剪的.md'])
    // 笔记列表里没有的（还没刷新）不画影子
    expect(previewOf([], moves).ghosts).toEqual([])
  })

  it('按去处分组，条数多的在前；改名的条数；按名字或原名找', () => {
    const many = [
      item('a', '收件箱/a.md', '生活/甲.md'),
      item('b', '收件箱/b.md', '生活/b.md', 'dropped'),
      item('c', '收件箱/c.md', '写作/c.md'),
      item('d', '收件箱/d.md', '收件箱/d.md', 'dropped'),
    ]
    const gs = fileGroups(many)
    expect(gs.map((g) => [g.folder, g.items.length, g.pending.length, g.renamed])).toEqual([
      ['生活', 2, 1, 1],
      ['收件箱', 1, 0, 0],
      ['写作', 1, 1, 0],
    ])
    expect(searchGroup(gs[0]!.items, '甲').map((i) => i.id)).toEqual(['a'])
    expect(searchGroup(gs[0]!.items, 'A').map((i) => i.id)).toEqual(['a'])
    expect(searchGroup(gs[0]!.items, ' ').map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('预览条上的一句：少的说几处，多的说分到几个文件夹', () => {
    expect(previewLine(pendingMoves(report(items)))).toBe('3 处挪动和改名')
    const bulk = Array.from({ length: 40 }, (_, i) => item(String(i), `收件箱/${i}.md`, `${['生活', '写作', '素材/旅行'][i % 3]}/${i}.md`))
    expect(previewLine(pendingMoves(report(bulk)))).toBe('40 条，分到 3 个文件夹')
  })
})
