/**
 * 数据库一次改好几篇（task-i921u 第三批）：关联列两边都写（这一讲的「练习」和那一题的「所属讲」）、关联对不上时补上、撤回。
 * 算要写什么是 packages/format 的 base-write.ts（setRelation、toggleRelation、fixRelationIssue、undoWrites）；
 * 这里只管写盘和提交：几篇一起写、一次提交，撤回也是一次（界面把 undoWrites 算好的再交给这里）。
 *
 * 每一篇的 before 是界面算的时候读到的字：有一篇和盘上不一样（别处刚改过）就一篇都不写，交回是哪一篇；
 * 写到一半被别处插进来改了（极少）：已经写了的换回去。这几篇里用户没提交的字先单独提交，这一次的提交里只有这次的改动，撤回不带走用户的字。
 * 空字是「没有这个文件」（数据库 AI 列撤回一批时用）：before 空字 = 原来没有这一篇（新建），after 空字 = 删掉这一篇。
 */
import * as git from '@cn/git'
import { ipcMain } from 'electron'
import { rm } from 'node:fs/promises'
import type { BaseWriteResult } from '../shared/api'
import { commitErrorText } from '../shared/git-errors'
import type { Vault } from './vault'

interface Write {
  path: string
  before: string
  after: string
}

function checkWrites(writes: unknown, message: unknown): { ws: Write[]; message: string } {
  if (!Array.isArray(writes) || !writes.length || typeof message !== 'string' || !message.trim()) throw new Error('数据库改动参数不对')
  const ws: Write[] = []
  for (const w of writes as Record<string, unknown>[]) {
    if (!w || typeof w.path !== 'string' || typeof w.before !== 'string' || typeof w.after !== 'string' || !/\.md$/i.test(w.path)) throw new Error('数据库改动参数不对')
    if (ws.some((x) => x.path === w.path)) throw new Error(`同一篇写了两次：${w.path}`)
    ws.push({ path: w.path, before: w.before, after: w.after })
  }
  return { ws, message: message.trim() }
}

/** 读一篇；不在了是空字 */
async function readOrEmpty(v: Vault, path: string): Promise<string> {
  try {
    return (await v.read(path)).text
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw e
  }
}

export async function applyBaseWrites(v: Vault, writes: unknown, message: unknown, tell: (path: string, text: string) => void): Promise<BaseWriteResult> {
  const { ws, message: msg } = checkWrites(writes, message)
  for (const w of ws) {
    const cur = await readOrEmpty(v, w.path)
    if (cur !== w.before) return { ok: false, path: w.path }
  }
  const paths = ws.map((w) => w.path)
  const pending = (await git.status(v.root)).filter((s) => paths.includes(s.path))
  let commitError: string | null = null
  try {
    if (pending.length) await git.commitPaths(v.root, pending.map((s) => s.path), git.describeChanges(pending))
  } catch (e) {
    if (!(e instanceof git.GitError)) throw e
    commitError = commitErrorText(e.message)
  }
  const done: Write[] = []
  /** 写一篇：after 空字是删掉 */
  const put = async (path: string, text: string, base: string) => {
    if (text !== '' || base === '') return v.write(path, text, base)
    await rm(v.abs(path), { force: true })
    return { ok: true as const }
  }
  for (const w of ws) {
    const r = await put(w.path, w.after, w.before)
    if (!r.ok) {
      for (const d of done.reverse()) await put(d.path, d.before, d.after)
      for (const d of done) tell(d.path, d.before)
      return { ok: false, path: w.path }
    }
    done.push(w)
    if (w.after !== '') tell(w.path, w.after)
  }
  if (commitError) return { ok: true, hash: null, commitError }
  try {
    return { ok: true, hash: await git.commitPaths(v.root, paths, msg) }
  } catch (e) {
    if (!(e instanceof git.GitError)) throw e
    return { ok: true, hash: null, commitError: commitErrorText(e.message) }
  }
}

export function registerBaseWrite(vault: () => Vault, tell: (path: string, text: string) => void, changed: () => void) {
  ipcMain.handle('base:write', async (_e, writes: unknown, message: unknown) => {
    const r = await applyBaseWrites(vault(), writes, message, tell)
    changed()
    return r
  })
}
