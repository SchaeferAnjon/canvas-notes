import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { rename } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, shell: {} }))

const { noteAttachments, trashNoteWith, undoTrash } = await import('../src/main/note-attach')
const { Vault } = await import('../src/main/vault')
const { sizeText } = await import('../src/shared/attach')

const NOTE = '课程/ecp/Lecture05 笔记.md'
const DIR = '附件/课程/ecp/Lecture05 笔记'
const TEXT = '# Lecture05 笔记\n\n![](../../附件/课程/ecp/Lecture05%20笔记/截图%202.png)\n\n## 为什么要先看符号\n\n![](../../附件/课程/ecp/Lecture05%20笔记/截图%201.png) ![](../../附件/旧图.png)\n'

let root: string
let trash: string
let stage: string
const put = (f: string, data: string | Buffer) => {
  mkdirSync(dirname(join(root, f)), { recursive: true })
  writeFileSync(join(root, f), data)
}
const toTrash = async (abs: string) => rename(abs, join(trash, `${Date.now()}-${Math.random()}-${abs.split('/').pop()}`))

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'cn-attach-'))
  root = join(base, '库')
  trash = join(base, 'trash')
  stage = join(base, 'stage')
  mkdirSync(trash, { recursive: true })
  put(NOTE, TEXT)
  put(`${DIR}/截图 1.png`, Buffer.alloc(2000))
  put(`${DIR}/截图 2.png`, Buffer.alloc(3000))
  put(`${DIR}/没用到.png`, Buffer.alloc(10))
  put(`${DIR}/别人也用.png`, Buffer.alloc(20))
  put('附件/旧图.png', Buffer.alloc(40))
  put('复习.md', '# 复习\n\n![](附件/课程/ecp/Lecture05%20笔记/别人也用.png)\n')
  put('.canvas-notes/置顶.json', JSON.stringify([NOTE]))
})
afterEach(() => rmSync(dirname(root), { recursive: true, force: true }))

describe('一篇笔记的附件', () => {
  it('列出文中用到的（按先后、写在哪一节）和自己附件文件夹里没用到的；查全库时写出别的笔记也在用的', async () => {
    const v = new Vault(root)
    const a = await noteAttachments(v, NOTE, true)
    expect(a.dir).toBe(DIR)
    expect(a.dirExists).toBe(true)
    expect(a.items.map((i) => [i.path.split('/').pop(), i.where, i.own, i.sharedWith ?? null])).toEqual([
      ['截图 2.png', '第 1 段', true, null],
      ['截图 1.png', '为什么要先看符号', true, null],
      ['旧图.png', '为什么要先看符号', false, null],
      ['别人也用.png', null, true, ['复习.md']],
      ['没用到.png', null, true, null],
    ])
    expect(a.bytes).toBe(2000 + 3000 + 10 + 20 + 40)
    expect(sizeText(1.8 * 1024 * 1024)).toBe('1.8 MB')
    expect(sizeText(640 * 1024)).toBe('640 KB')
  })

  it('删笔记连同图：只删自己文件夹里、别的笔记没在用的；文件夹外的老图不动；撤回全放回原处、置顶也回来', async () => {
    const v = new Vault(root)
    const r = await trashNoteWith(v, NOTE, true, stage, toTrash)
    expect(r.images).toBe(3)
    expect(r.kept).toBe(1)
    expect(existsSync(join(root, NOTE))).toBe(false)
    expect(readdirSync(join(root, DIR))).toEqual(['别人也用.png'])
    expect(existsSync(join(root, '附件/旧图.png'))).toBe(true)
    expect(readdirSync(trash)).toHaveLength(4)
    expect(JSON.parse(readFileSync(join(root, '.canvas-notes/置顶.json'), 'utf8'))).toEqual([])
    await undoTrash(v, r.id, stage)
    expect(readFileSync(join(root, NOTE), 'utf8')).toBe(TEXT)
    expect(readdirSync(join(root, DIR)).sort()).toEqual(['别人也用.png', '截图 1.png', '截图 2.png', '没用到.png'])
    expect(JSON.parse(readFileSync(join(root, '.canvas-notes/置顶.json'), 'utf8'))).toEqual([NOTE])
    await expect(undoTrash(v, r.id, stage)).rejects.toThrow('撤回不了了')
  })

  it('不勾「连同图」只删笔记；图都删光了，空的附件文件夹也收掉', async () => {
    const v = new Vault(root)
    const r = await trashNoteWith(v, NOTE, false, stage, toTrash)
    expect(r.images).toBe(0)
    expect(readdirSync(join(root, DIR))).toHaveLength(4)
    await undoTrash(v, r.id, stage)
    rmSync(join(root, DIR, '别人也用.png'))
    rmSync(join(root, '复习.md'))
    const r2 = await trashNoteWith(v, NOTE, true, stage, toTrash)
    expect(r2.images).toBe(3)
    expect(existsSync(join(root, '附件/课程'))).toBe(false)
    expect(existsSync(join(root, '附件/旧图.png'))).toBe(true)
  })

  it('不是 md、跳出库的拒绝', async () => {
    const v = new Vault(root)
    await expect(noteAttachments(v, '../外面.md', false)).rejects.toThrow('笔记不对')
    await expect(trashNoteWith(v, 'a.pdf', true, stage, toTrash)).rejects.toThrow('笔记不对')
    await expect(undoTrash(v, '../x', stage)).rejects.toThrow('撤回的号不对')
  })
})
