/**
 * 白板装饰（设计页 145，格式 @cn/format ink-decor.ts）主进程这边：自带贴纸第一次用时把那张 SVG 拷进库里的 `附件/贴纸/<k>.svg`
 * （只拷一次，已经有了不动），换台设备、以后贴纸改版画出来都不变；拷了就提交这一个文件。贴纸那一行本身走 ink:write。
 */
import * as git from '@cn/git'
import { STICKERS, stickerPathOf } from '@cn/format'
import { atomicWrite } from '@cn/atomic'
import { ipcMain } from 'electron'
import { access } from 'node:fs/promises'
import { commitErrorText } from '../shared/git-errors'
import type { Vault } from './vault'

/** 拷进库里（已经有了不动）；返回库里的路径和这次是不是新拷的 */
export async function putSticker(v: Vault, k: string, svg: string): Promise<{ path: string; added: boolean }> {
  const rel = stickerPathOf(k)
  try {
    await access(v.abs(rel))
    return { path: rel, added: false }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  await atomicWrite(v.abs(rel), svg, { mkdir: true })
  if (await git.isRepo(v.root)) {
    try {
      await git.commitPaths(v.root, [rel], `贴纸：拷进库里 ${k}.svg`) // 不翻：提交说明
    } catch (e) {
      if (e instanceof git.GitError) throw new Error(commitErrorText(e.message))
      throw e
    }
  }
  return { path: rel, added: true }
}

export function registerDecor(vault: () => Vault, changed: () => void) {
  ipcMain.handle('decor:sticker', async (_e, k: unknown, svg: unknown) => {
    if (typeof k !== 'string' || !STICKERS.includes(k)) throw new Error('没有这张贴纸')
    if (typeof svg !== 'string' || !/^<svg[\s>]/.test(svg) || svg.length > 200_000) throw new Error('贴纸的图不对')
    const r = await putSticker(vault(), k, svg)
    if (r.added) changed()
    return r
  })
}
