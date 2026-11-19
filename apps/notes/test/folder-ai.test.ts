// 文件夹页空对话的建议（D 组小样 A：把这周的周记总结成三句话、收件箱里和周记有关的挪进来、照上周的样子开一篇 2026-W48）：
// 只放软件真做得到的（写小结、归类、新建），做不到的不放
import { describe, expect, it } from 'vitest'
import { fileInPrompt, folderSugs, latestNote, nextName, parseFileIn, skeleton, sumTargets } from '../src/renderer/folder-ai'
import type { NoteFile } from '../src/shared/api'

const n = (path: string, mtimeMs = 0, kind: NoteFile['kind'] = 'work'): NoteFile => ({ path, mtimeMs, createdMs: mtimeMs, kind })

describe('下一篇叫什么', () => {
  it('周记 2026-W47 的下一篇是 2026-W48；年底按 ISO 周换年（2026 有 53 周）', () => {
    expect(nextName('2026-W47', '2026-11-19')).toBe('2026-W48')
    expect(nextName('2026-W09', '2026-11-19')).toBe('2026-W10')
    expect(nextName('2026-W53', '2026-11-19')).toBe('2027-W01')
    expect(nextName('2025-W52', '2026-11-19')).toBe('2026-W01')
  })
  it('名字是日期的：下一篇是今天；今天那篇就是它的话没有下一篇', () => {
    expect(nextName('2026-11-12', '2026-11-19')).toBe('2026-11-19')
    expect(nextName('2026-11-19', '2026-11-19')).toBe(null)
  })
  it('名字末尾是编号的：编号加一，位数照旧；没有编号的不知道下一篇叫什么', () => {
    expect(nextName('Lecture05', '2026-11-19')).toBe('Lecture06')
    expect(nextName('第3讲', '2026-11-19')).toBe('第4讲')
    expect(nextName('随手记', '2026-11-19')).toBe(null)
  })
})

describe('文件夹里最新的一篇', () => {
  it('周记按周号排，不看修改时间；只看直接放在这个文件夹里的 md，白板和子文件夹里的不算', () => {
    const notes = [n('周记/2026-W47.md', 1), n('周记/2026-W45.md', 9), n('周记/旧/2026-W50.md', 9), n('随手记.md', 9)]
    expect(latestNote('周记', notes)?.path).toBe('周记/2026-W47.md')
  })
  it('别的文件夹按修改时间', () => {
    expect(latestNote('写作', [n('写作/a.md', 1), n('写作/b.md', 5)])?.path).toBe('写作/b.md')
    expect(latestNote('空的', [n('写作/a.md', 1)])).toBe(null)
  })
})

describe('文件夹页的建议', () => {
  const week = [n('周记/2026-W46.md', 1), n('周记/2026-W47.md', 2), n('收件箱/票.md', 3, 'inbox')]
  it('周记：照小样三颗，文字一字不差', () => {
    expect(folderSugs('周记', week, '2026-11-19')).toEqual([
      { kind: 'sum', icon: 'notebook', text: '把这周的周记总结成三句话' },
      { kind: 'file', icon: 'inbox', text: '收件箱里和周记有关的挪进来' },
      { kind: 'new', icon: 'new-file', text: '照上周的样子开一篇 2026-W48' },
    ])
  })
  it('收件箱是空的不放「挪进来」；下一篇已经有了、或者认不出下一篇叫什么，不放「开一篇」；空文件夹不放「总结」', () => {
    expect(folderSugs('周记', [...week.slice(0, 2), n('周记/2026-W48.md', 0)], '2026-11-19').map((s) => s.text)).toEqual(['把这周的周记总结成三句话', '照上周的样子开一篇 2026-W49'])
    // 最近改的是第3讲，第4讲已经有了：不开
    expect(folderSugs('课', [n('课/第3讲.md', 5), n('课/第4讲.md', 1)], '2026-11-19').map((s) => s.text)).toEqual(['把「课」总结成三句话'])
    expect(folderSugs('写作', [n('写作/冰岛.md', 1)], '2026-11-19').map((s) => s.text)).toEqual(['把「写作」总结成三句话'])
    expect(folderSugs('空的', [n('收件箱/票.md', 3, 'inbox')], '2026-11-19').map((s) => s.text)).toEqual(['收件箱里和空的有关的挪进来'])
  })
  it('不是周记的文件夹：开一篇写照哪一篇、新的叫什么', () => {
    expect(folderSugs('课程/ecpc', [n('课程/ecpc/第3讲.md', 1)], '2026-11-19').map((s) => s.text)).toEqual(['把「ecpc」总结成三句话', '照「第3讲」的样子开一篇「第4讲」'])
  })
  it('总结周记只读这周那篇；别的文件夹读最近改的（子文件夹里的也算），最多 20 篇', () => {
    expect(sumTargets('周记', week).map((x) => x.path)).toEqual(['周记/2026-W47.md'])
    const many = Array.from({ length: 25 }, (_, i) => n(`写作/${i}.md`, i))
    const got = sumTargets('写作', [...many, n('写作/旧/x.md', 100)])
    expect(got.length).toBe(20)
    expect(got[0]!.path).toBe('写作/旧/x.md')
  })
})

describe('照上一篇的样子开新的一篇', () => {
  it('留属性（日期换成今天）、小节标题和「- 读了：」这种开头，内容清空；第一行标题换成新名字', () => {
    const old = '---\ncreated: 2026-11-12\ntags: [周记]\n---\n# 2026-W47\n\n这周主要在读 ECP，冰岛的机票订好了。\n\n## 读了\n\n- 书：明朝那些事儿\n- 课：ECP 第 5 讲，LIF 神经元那一页看了三遍\n\n## 下周\n\n下周订住宿。\n'
    expect(skeleton(old, '2026-W47', '2026-W48', '2026-11-19')).toBe('---\ncreated: 2026-11-19\ntags: [周记]\n---\n# 2026-W48\n\n## 读了\n\n- 书：\n- 课：\n\n## 下周\n')
  })
  it('只有一个标题一段字的：开出来只有新标题', () => {
    expect(skeleton('# 2026-W47\n\n这周主要在读 ECP。\n', '2026-W47', '2026-W48', '2026-11-19')).toBe('# 2026-W48\n')
  })
})

describe('收件箱里和这个文件夹有关的', () => {
  const inbox = [n('收件箱/票.md', 0, 'inbox'), n('收件箱/菜谱.md', 0, 'inbox')]
  it('提示里有文件夹、已有的几篇和收件箱每一条；只要回答里收件箱真有的路径', () => {
    const p = fileInPrompt('周记', [{ path: '收件箱/票.md', text: '冰岛机票' }], ['2026-W47'])
    expect(p.split('\n')[0]).toBe('命令：挪进文件夹')
    expect(p).toContain('文件夹：周记')
    expect(p).toContain('2026-W47')
    expect(p).toContain('路径：收件箱/票.md')
    expect(parseFileIn('```json\n["收件箱/票.md", "收件箱/没有的.md", 3]\n```', inbox)).toEqual(['收件箱/票.md'])
    expect(parseFileIn('```json\n[]\n```', inbox)).toEqual([])
    expect(() => parseFileIn('不知道', inbox)).toThrow('AI没给出能用的方案')
  })
})
