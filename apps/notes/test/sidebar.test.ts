import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NoteFile } from '../src/shared/api'
import { normalizeSettings } from '../src/shared/appearance'
import { kindOf } from '../src/shared/layout'
import { DAY_MS, isArchived, movePin, normalizePins, pinsJson, setPin } from '../src/shared/sidebar'
import { pinNote, readPins, repin } from '../src/main/pins'
import { Vault } from '../src/main/vault'
import { filterNotes } from '../src/renderer/NoteIndex'
import { when } from '../src/shared/when'

const NOW = new Date(2026, 10, 15, 12, 0).getTime()
const note = (path: string, daysAgo: number, extra: Partial<NoteFile> = {}): NoteFile => {
  const { kind, topic } = kindOf(path)
  return { path, mtimeMs: NOW - daysAgo * DAY_MS, createdMs: NOW - daysAgo * DAY_MS, kind, ...(topic ? { topic } : {}), ...extra }
}
const board = (path: string, daysAgo: number) => note(path, daysAgo, { board: { color: '#4A7FA7', cards: 3, thumb: [] } })
const paths = (ns: NoteFile[]) => ns.map((n) => n.path)

describe('归档', () => {
  it('超过天数没改的算归档；置顶的、收件箱的不算；0 = 不自动归档', () => {
    const none = new Set<string>()
    expect(isArchived(note('a.md', 91), NOW, 90, none)).toBe(true)
    expect(isArchived(note('a.md', 89), NOW, 90, none)).toBe(false)
    expect(isArchived(note('a.md', 91), NOW, 180, none)).toBe(false)
    expect(isArchived(note('a.md', 31), NOW, 30, none)).toBe(true)
    expect(isArchived(note('a.md', 900), NOW, 0, none)).toBe(false)
    expect(isArchived(note('a.md', 900), NOW, 90, new Set(['a.md']))).toBe(false)
    expect(isArchived(note('收件箱/x.md', 900), NOW, 90, none)).toBe(false)
    expect(isArchived(board('白板.md', 120), NOW, 90, none)).toBe(true)
    expect(isArchived(note('素材/旅行/x.md', 120), NOW, 90, none)).toBe(true)
  })
})

describe('置顶列表', () => {
  it('读到坏的、跑出库的、重复的都丢掉；写成两格缩进加换行', () => {
    expect(normalizePins('x')).toEqual([])
    expect(normalizePins(['a.md', 'a.md', '../b.md', '/etc/c.md', 3, 'd.txt', '文件夹/e.md'])).toEqual(['a.md', '文件夹/e.md'])
    expect(pinsJson(['a.md'])).toBe('[\n  "a.md"\n]\n')
    expect(setPin(['a.md'], 'b.md', true)).toEqual(['a.md', 'b.md'])
    expect(setPin(['a.md', 'b.md'], 'a.md', true)).toEqual(['b.md', 'a.md'])
    expect(setPin(['a.md', 'b.md'], 'a.md', false)).toEqual(['b.md'])
    expect(movePin(['a.md', 'b.md'], 'a.md', 'x/a.md')).toEqual(['x/a.md', 'b.md'])
    expect(movePin(['a.md', 'b.md'], 'a.md', null)).toEqual(['b.md'])
  })

  it('存在库里 .canvas-notes/置顶.json：没置顶过不建文件；改名、删掉跟着变；文件坏了当没置顶', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cn-pins-'))
    try {
      const v = new Vault(root)
      const file = join(root, '.canvas-notes', '置顶.json')
      expect(await readPins(v)).toEqual([])
      await repin(v, 'a.md', 'b.md')
      expect(existsSync(file)).toBe(false)
      expect(await pinNote(v, 'a.md', true)).toEqual(['a.md'])
      await pinNote(v, '文件夹/c.md', true)
      expect(readFileSync(file, 'utf8')).toBe('[\n  "a.md",\n  "文件夹/c.md"\n]\n')
      await repin(v, 'a.md', '新名.md')
      expect(await readPins(v)).toEqual(['新名.md', '文件夹/c.md'])
      await repin(v, '文件夹/c.md', null)
      expect(await readPins(v)).toEqual(['新名.md'])
      await expect(pinNote(v, '../外面.md', true)).rejects.toThrow('库外')
      mkdirSync(join(root, '.canvas-notes'), { recursive: true })
      writeFileSync(file, '<<<<<<< 合并冲突')
      expect(await readPins(v)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('设置里的归档天数', () => {
  it('默认 90；只认 30、60、90、180、0', () => {
    expect(normalizeSettings({}).archiveDays).toBe(90)
    expect(normalizeSettings({ archiveDays: 30 }).archiveDays).toBe(30)
    expect(normalizeSettings({ archiveDays: 0 }).archiveDays).toBe(0)
    expect(normalizeSettings({ archiveDays: 45 }).archiveDays).toBe(90)
    expect(normalizeSettings({ archiveDays: '30' }).archiveDays).toBe(90)
  })
})

describe('全部笔记、归档列表', () => {
  const notes = [note('读书/三体.md', 1), board('白板/冰岛.md', 3), note('收件箱/速记.md', 2), note('日记/2024/三月.md', 500)]
  it('筛选：每个词都要出现在标题或文件夹里；按类型；新的在前或旧的在前', () => {
    expect(paths(filterNotes(notes, '', 'any', false))).toEqual(['读书/三体.md', '收件箱/速记.md', '白板/冰岛.md', '日记/2024/三月.md'])
    expect(paths(filterNotes(notes, '', 'any', true))[0]).toBe('日记/2024/三月.md')
    expect(paths(filterNotes(notes, '日记 三', 'any', false))).toEqual(['日记/2024/三月.md'])
    expect(paths(filterNotes(notes, 'md', 'any', false))).toEqual([])
    expect(paths(filterNotes(notes, '', 'board', false))).toEqual(['白板/冰岛.md'])
    expect(paths(filterNotes(notes, '', 'work', false))).toEqual(['读书/三体.md', '日记/2024/三月.md'])
    expect(paths(filterNotes(notes, '', 'inbox', false))).toEqual(['收件箱/速记.md'])
  })
  it('日期：今天、昨天、今年、往年（和左栏、文件夹首页同一个 when）', () => {
    const now = new Date(2026, 10, 15, 12, 0).getTime()
    expect(when(new Date(2026, 10, 15, 9, 5).getTime(), { now })).toBe('09:05')
    expect(when(new Date(2026, 10, 14, 23, 0).getTime(), { now })).toBe('昨天')
    expect(when(new Date(2026, 2, 3).getTime(), { now })).toBe('3月3日')
    expect(when(new Date(2024, 10, 3).getTime(), { now })).toBe('2024年11月3日')
  })
})
