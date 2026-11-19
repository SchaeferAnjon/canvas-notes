// CN-108 方向 A「放回文件」：历史里把那次删掉、现在又不在的文件放回原处，单独一次提交；之后又改过左栏也照样放得回
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as git from '@cn/git'

vi.mock('electron', () => ({ ipcMain: {}, dialog: {}, shell: {} }))

const { Vault } = await import('../src/main/vault')
const { restorable, restoreDeleted, undoRestore } = await import('../src/main/restore')
const { trashFolder, testTrash } = await import('../src/main/folder-ops')

let root: string
let trash: string
const put = (p: string, t: string) => (mkdirSync(dirname(join(root, p)), { recursive: true }), writeFileSync(join(root, p), t))
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const left = () => JSON.parse(read('.canvas-notes/左栏.json')) as { 左边: string[]; 图标: Record<string, unknown> }
const pins = () => JSON.parse(read('.canvas-notes/置顶.json')) as string[]
const head = async () => (await git.log(root, 1))[0]!

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cn-restore-'))
  trash = mkdtempSync(join(tmpdir(), 'cn-restore-trash-'))
  await git.init(root)
  await git.git(root, ['config', 'user.name', 'Test'])
  await git.git(root, ['config', 'user.email', 'test@example.com'])
  put('课程/ecp/Lecture05 笔记.md', '# Lecture05 笔记\n\n第 27 页。\n')
  put('课程/ecp/我的疑惑.md', '# 我的疑惑\n\n为什么用脉冲？\n')
  put('课程/ecp/Lecture05.pdf', '%PDF-1.4 fake')
  put('课程/ecp/.首页.json', '{ "style": "a" }\n')
  put('课程/ecp/空的/.gitkeep', '')
  put('收件箱/冰岛行程.md', '# 冰岛行程\n')
  // 现在的格式（「版本: 2」）：没有版本的老文件读的时候会补上整套顶级分类（shared/left.ts）
  put('.canvas-notes/左栏.json', JSON.stringify({ 版本: 2, 左边: ['课程', '课程/ecp', '收件箱'], 图标: { '课程/ecp': { icon: 'beaker', color: 'green' } } }, null, 2) + '\n')
  put('.canvas-notes/置顶.json', JSON.stringify(['收件箱/冰岛行程.md', '课程/ecp/我的疑惑.md', '课程/ecp/'], null, 2) + '\n')
  await git.commitAll(root, '样本')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(trash, { recursive: true, force: true })
})

describe('放回删掉的文件', () => {
  it('删了整个文件夹、之后又改过左栏：整次放回，笔记、PDF、首页设置、空子文件夹都回来，左栏位置和图标、置顶只加回那一项', async () => {
    const v = new Vault(root)
    await trashFolder(v, '课程/ecp', testTrash(trash))
    const del = await head()
    expect(del.subject).toBe('移到废纸篓：课程/ecp（3 个文件）')
    expect(left().左边).toEqual(['课程', '收件箱'])
    expect(pins()).toEqual(['收件箱/冰岛行程.md'])
    // 之后又改过左栏（整次撤回这时会冲突）
    put('.canvas-notes/左栏.json', JSON.stringify({ 版本: 2, 左边: ['收件箱', '课程', '写作'], 图标: {} }, null, 2) + '\n')
    await git.commitPending(root)
    expect((await head()).subject).toBe('改了左栏设置')

    const r0 = await restorable(v, del.hash)
    expect(r0.deleted.sort()).toEqual(['课程/ecp/Lecture05 笔记.md', '课程/ecp/Lecture05.pdf', '课程/ecp/我的疑惑.md'])
    expect(r0.available.sort()).toEqual(r0.deleted.sort())

    const r = await restoreDeleted(v, del.hash)
    expect(r.folder).toBe('课程/ecp')
    expect(r.files.map((f) => f.to).sort()).toEqual(['课程/ecp/Lecture05 笔记.md', '课程/ecp/Lecture05.pdf', '课程/ecp/我的疑惑.md'])
    expect(read('课程/ecp/我的疑惑.md')).toBe('# 我的疑惑\n\n为什么用脉冲？\n')
    expect(read('课程/ecp/Lecture05.pdf')).toBe('%PDF-1.4 fake')
    expect(read('课程/ecp/.首页.json')).toBe('{ "style": "a" }\n')
    expect(existsSync(join(root, '课程/ecp/空的/.gitkeep'))).toBe(true)
    // 左栏：之后改的顺序和「写作」都留着，「课程/ecp」加回原来的第 2 位，图标颜色也回来
    expect(left().左边).toEqual(['收件箱', '课程/ecp', '课程', '写作'])
    expect(left().图标['课程/ecp']).toEqual({ icon: 'beaker', color: 'green' })
    expect(pins()).toEqual(['收件箱/冰岛行程.md', '课程/ecp/我的疑惑.md', '课程/ecp/'])
    const back = await head()
    expect(back.subject).toBe('放回：课程/ecp（3 个文件）')
    expect(back.hash).toBe(r.commit)
    expect(await git.status(root)).toEqual([])
    // 都放回来了：不能再放
    expect((await restorable(v, del.hash)).available).toEqual([])
    await expect(restoreDeleted(v, del.hash)).rejects.toThrow('删掉的都已经放回来了')

    // 撤回「放回」：又回到删掉的样子
    await undoRestore(v, r.commit)
    expect(existsSync(join(root, '课程/ecp/我的疑惑.md'))).toBe(false)
    expect(left().左边).toEqual(['收件箱', '课程', '写作'])
    expect((await restorable(v, del.hash)).available).toHaveLength(3)
  })

  it('只放回一篇；再右键那次只剩没放回的；原处已经有一篇同名的（内容不同）放成「名字 2」', async () => {
    const v = new Vault(root)
    await trashFolder(v, '课程/ecp', testTrash(trash))
    const del = await head()
    const one = await restoreDeleted(v, del.hash, ['课程/ecp/我的疑惑.md'])
    expect(one.files).toEqual([{ from: '课程/ecp/我的疑惑.md', to: '课程/ecp/我的疑惑.md' }])
    expect(one.folder).toBeNull()
    expect((await head()).subject).toBe('放回：课程/ecp/我的疑惑.md')
    // 只放回一篇：首页设置不跟着回来，左栏不加回
    expect(existsSync(join(root, '课程/ecp/.首页.json'))).toBe(false)
    expect(left().左边).toEqual(['课程', '收件箱'])
    expect((await restorable(v, del.hash)).available.sort()).toEqual(['课程/ecp/Lecture05 笔记.md', '课程/ecp/Lecture05.pdf'])

    // 同名的新一篇占着原处
    put('课程/ecp/Lecture05 笔记.md', '# Lecture05 笔记\n\n重写的一篇。\n')
    await git.commitPending(root)
    const two = await restoreDeleted(v, del.hash, ['课程/ecp/Lecture05 笔记.md'])
    expect(two.files).toEqual([{ from: '课程/ecp/Lecture05 笔记.md', to: '课程/ecp/Lecture05 笔记 2.md' }])
    expect(read('课程/ecp/Lecture05 笔记.md')).toBe('# Lecture05 笔记\n\n重写的一篇。\n')
    expect(read('课程/ecp/Lecture05 笔记 2.md')).toBe('# Lecture05 笔记\n\n第 27 页。\n')
    // 放成「名字 2」的也算放回过了
    expect((await restorable(v, del.hash)).available).toEqual(['课程/ecp/Lecture05.pdf'])
  })

  it('没删过文件的提交：什么都不能放', async () => {
    const v = new Vault(root)
    put('收件箱/冰岛行程.md', '# 冰岛行程\n\n第一天。\n')
    await git.commitPending(root)
    const c = await head()
    expect(await restorable(v, c.hash)).toEqual({ deleted: [], available: [] })
    await expect(restoreDeleted(v, c.hash)).rejects.toThrow('这次提交没有删掉文件')
    await expect(restorable(v, 'not-a-hash')).rejects.toThrow('提交号不对')
  })
})
