/**
 * 白板笔迹（方案 B「白板笔迹层」，2026-11-25；格式在 packages/format/src/ink.ts）主进程这边：读、写这块白板的 `附件/<白板>/笔迹.ink`。
 * Mac 第一版只改不写（选中、挪、改色、删）：每一下是一次写、一次提交（只提交这一个文件）。
 * 写的时候盘上的和界面以为的（base）不一样（iPad 同步下来了、外面改了）：按编号三方合并（mergeInk，留界面这边），外面写的笔不丢。
 */
import * as git from '@cn/git'
import { inkPathOf, mergeInk, pdfInkPathOf } from '@cn/format'
import { atomicWrite } from '@cn/atomic'
import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { commitErrorText } from '../shared/git-errors'
import type { InkWriteResult } from '../shared/api'
import type { Vault } from './vault'

/** 笔迹文件在哪：白板是 附件/<白板>/笔迹.ink，读 PDF 的是 附件/<PDF 名>/笔迹.ink（iPad 读 PDF 手写，组行带 pg） */
export const inkFileOf = (path: string) => (/\.pdf$/i.test(path) ? pdfInkPathOf(path) : inkPathOf(path))

/** 这块白板（或这份 PDF）的笔迹全文；没有这个文件是 '' */
export async function readInk(v: Vault, notePath: string): Promise<string> {
  try {
    return await readFile(v.abs(inkFileOf(notePath)), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw e
  }
}

/** 写这块白板的笔迹：盘上的和 base 不一样就先三方合并；写完提交这一个文件（库不是 Git 仓库就只写） */
export async function writeInk(v: Vault, notePath: string, text: string, base: string, message: string): Promise<InkWriteResult> {
  const rel = inkFileOf(notePath)
  const disk = await readInk(v, notePath)
  const out = disk === base ? text : mergeInk(base, text, disk, 'local').text
  if (out !== disk) await atomicWrite(v.abs(rel), out, { mkdir: true })
  let commit: string | null = null
  if (out !== disk && (await git.isRepo(v.root))) {
    try {
      commit = await git.commitPaths(v.root, [rel], message)
    } catch (e) {
      if (e instanceof git.GitError) throw new Error(commitErrorText(e.message))
      throw e
    }
  }
  return { text: out, merged: disk !== base, commit }
}

export function registerInk(vault: () => Vault, changed: () => void) {
  ipcMain.handle('ink:read', (_e, notePath: unknown) => {
    if (typeof notePath !== 'string' || !notePath) throw new Error('白板路径不对')
    return readInk(vault(), notePath)
  })
  // 一次一个写（连着贴两张贴纸、删了马上撤回：后一个读盘时前一个还没写完，三方合并会把行的先后合乱）
  let queue: Promise<unknown> = Promise.resolve()
  ipcMain.handle('ink:write', async (_e, notePath: unknown, text: unknown, base: unknown, message: unknown) => {
    if (typeof notePath !== 'string' || !notePath || typeof text !== 'string' || typeof base !== 'string' || typeof message !== 'string' || !message.trim()) throw new Error('笔迹写入参数不对')
    const run = queue.then(() => writeInk(vault(), notePath, text, base, message))
    queue = run.catch(() => undefined)
    const r = await run
    changed()
    return r
  })
}
