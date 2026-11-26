import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: {} }))

const { importPdfs, unimportPdfs } = await import('../src/main/slides')
const { propFiles } = await import('../src/main/folder-home')
const { Vault } = await import('../src/main/vault')

const root = mkdtempSync(join(tmpdir(), 'cn-slides-'))
const finder = mkdtempSync(join(tmpdir(), 'cn-finder-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(finder, { recursive: true, force: true })
})

it('CN-2：拖进来的 PDF 拷进课程文件夹（原文件不动），重名加「 2」，不是 PDF 的不收；撤回只删刚拷的', async () => {
  const v = new Vault(root)
  mkdirSync(join(root, '课程/ecp'), { recursive: true })
  writeFileSync(join(root, '课程/ecp/Lecture06.pdf'), '%PDF old')
  writeFileSync(join(finder, 'Lecture06.pdf'), '%PDF new')
  writeFileSync(join(finder, 'a.txt'), 'x')
  const r = await importPdfs(v, '课程/ecp', [join(finder, 'Lecture06.pdf'), join(finder, 'a.txt')])
  expect(r).toEqual({ added: ['课程/ecp/Lecture06 2.pdf'], skipped: ['a.txt'], already: [] })
  expect(readFileSync(join(root, '课程/ecp/Lecture06 2.pdf'), 'utf8')).toBe('%PDF new')
  expect(readFileSync(join(root, '课程/ecp/Lecture06.pdf'), 'utf8')).toBe('%PDF old')
  expect(existsSync(join(finder, 'Lecture06.pdf'))).toBe(true)
  // 课件进度认得「Lecture06」是第 6 讲
  const files = await propFiles(v, '课程/ecp')
  expect(files.find((f) => f.path === '课程/ecp/Lecture06 2.pdf')?.props).toMatchObject({ 类型: '课件', 第几讲: '6' })
  // 库最外层、软件自己的文件夹、跑出库的不收
  for (const bad of ['', '.canvas-notes', '课程/../..', '收件箱/.git']) await expect(importPdfs(v, bad, [join(finder, 'Lecture06.pdf')])).rejects.toThrow('只能拷进库里的一个文件夹')
  await expect(unimportPdfs(v, ['课程/ecp/Lecture06.pdf'])).rejects.toThrow('只能撤回刚拷进来的课件')
  await unimportPdfs(v, r.added)
  expect(existsSync(join(root, '课程/ecp/Lecture06 2.pdf'))).toBe(false)
  expect(existsSync(join(root, '课程/ecp/Lecture06.pdf'))).toBe(true)
})

it('第 2 轮：同一份 PDF 再拖进同一门课（内容一样，名字不管）：不再拷出「Lecture06 3.pdf」，报已经有了', async () => {
  const v = new Vault(root)
  mkdirSync(join(root, '课程/ecp/课件'), { recursive: true })
  writeFileSync(join(root, '课程/ecp/课件/L7.pdf'), '%PDF seven')
  writeFileSync(join(finder, 'Lecture07.pdf'), '%PDF seven')
  writeFileSync(join(finder, 'Lecture08.pdf'), '%PDF eight')
  const r = await importPdfs(v, '课程/ecp', [join(finder, 'Lecture07.pdf'), join(finder, 'Lecture08.pdf')])
  expect(r).toEqual({ added: ['课程/ecp/Lecture08.pdf'], skipped: [], already: ['课程/ecp/课件/L7.pdf'] })
  expect(existsSync(join(root, '课程/ecp/Lecture07.pdf'))).toBe(false)
  // 再拖一次 Lecture08：刚拷进来的那份就是一样的
  const again = await importPdfs(v, '课程/ecp', [join(finder, 'Lecture08.pdf')])
  expect(again).toEqual({ added: [], skipped: [], already: ['课程/ecp/Lecture08.pdf'] })
  expect(existsSync(join(root, '课程/ecp/Lecture08 2.pdf'))).toBe(false)
})

it('2026-11-25 收件箱：课程挪进「项目」以后（卡上照旧写「拖PDF」）、项目里新建的文件夹，PDF 照样拷得进去', async () => {
  const v = new Vault(root)
  mkdirSync(join(root, '项目/study project 2/论文/新文件夹'), { recursive: true })
  writeFileSync(join(finder, 'WESAD.pdf'), '%PDF wesad')
  const a = await importPdfs(v, '项目/study project 2', [join(finder, 'WESAD.pdf')])
  expect(a).toEqual({ added: ['项目/study project 2/WESAD.pdf'], skipped: [], already: [] })
  writeFileSync(join(finder, 'K-EmoCon.pdf'), '%PDF kemocon')
  const b = await importPdfs(v, '项目/study project 2/论文/新文件夹', [join(finder, 'K-EmoCon.pdf')])
  expect(b.added).toEqual(['项目/study project 2/论文/新文件夹/K-EmoCon.pdf'])
  expect(readFileSync(join(root, '项目/study project 2/论文/新文件夹/K-EmoCon.pdf'), 'utf8')).toBe('%PDF kemocon')
  expect(existsSync(join(finder, 'K-EmoCon.pdf'))).toBe(true)
})
