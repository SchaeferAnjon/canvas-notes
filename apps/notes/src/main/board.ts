/**
 * 白板（2026-11-21 方向 A「一份文字两种看法」）主进程这边：
 * - 旧白板（用注释存列的）第一次打开时一次转成「## 列名」写法，单独一次提交；撤回 = 文件回到转之前一个字节不差，
 *   这块白板记进 `.canvas-notes/白板旧写法.json`，以后不再自动转（还用以前的自由白板看），「⋯」里能再转；
 * - 「AI 总结的」卡还是一段普通的字的（task-5yp97 以前存的），第一次打开时一次写成 `> [!ai] AI 总结` 提示块（能选一句开旁支），
 *   单独一次提交；撤回同上，记进 `.canvas-notes/总结卡旧写法.json`，以后不再自动改；
 * - 工具板「数据库」：库里已有的数据库（```base 块的数据源文件夹）、各有几条；
 * - 白板上一次改两篇（卡拖进另一个标签里的文档）：一次提交、能撤回。
 */
import * as git from '@cn/git'
import { baseFoldersIn, convertBoard, convertSummaryCards, needsConvert, needsSummaryConvert } from '@cn/format'
import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import type { BoardBase, BoardConverted, SummaryConverted } from '../shared/api'
import { commitErrorText } from '../shared/git-errors'
import { titleOf } from '../shared/layout'
import { writeFileAtomic } from './atomic'
import type { Vault } from './vault'

export const KEEP_OLD_FILE = '.canvas-notes/白板旧写法.json'
/** 撤回过「AI 总结的」卡改写法的那几篇：以后打开不再自动改（task-5yp97） */
export const KEEP_SUMMARY_FILE = '.canvas-notes/总结卡旧写法.json'

async function readKeep(v: Vault, file = KEEP_OLD_FILE, key = '白板'): Promise<string[]> {
  try {
    const j = JSON.parse(await readFile(v.abs(file), 'utf8')) as Record<string, unknown>
    const list = j[key]
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch (e) {
    // 没有文件是没撤回过；文件坏了（手改、合并冲突）当没撤回过
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return []
    throw e
  }
}

async function writeKeep(v: Vault, list: string[], file = KEEP_OLD_FILE, key = '白板'): Promise<void> {
  await writeFileAtomic(v.abs(file), JSON.stringify({ 版本: 1, [key]: [...new Set(list)].sort() }, null, 2) + '\n')
}

async function commit(v: Vault, paths: string[], message: string): Promise<string | null> {
  try {
    return await git.commitPaths(v.root, paths, message)
  } catch (e) {
    if (e instanceof git.GitError) throw new Error(commitErrorText(e.message))
    throw e
  }
}

/**
 * 打开一块白板：还是旧写法就一次转好、写回、提交。没什么要转的、用户撤回过（还要旧写法）的返回 null；
 * force：「⋯」里「改成按「##」分列的写法」，撤回过的也转，并从旧写法名单里拿掉
 */
export async function convertOnOpen(v: Vault, rel: string, force = false): Promise<BoardConverted | null> {
  const { text: old, readOnly } = await v.read(rel)
  if (readOnly || !needsConvert(old)) return null
  const keep = await readKeep(v)
  if (keep.includes(rel) && !force) return null
  const r = convertBoard(old)
  if (r.text === old) return null
  const w = await v.write(rel, r.text, old)
  // 读完到写之间别处改过：这次不转，下次打开再说
  if (!w.ok) return null
  const paths = [rel]
  if (keep.includes(rel)) {
    await writeKeep(v, keep.filter((p) => p !== rel))
    paths.push(KEEP_OLD_FILE)
  }
  // 转好了、写进文件了，只是没提交上（锁文件、没署名）：照样用新写法，提交没成功的原因交回去说一句，改动留着下次提交带上
  let hash: string | null = null
  let commitError: string | undefined
  try {
    hash = await git.commitPaths(v.root, paths, `白板改成按「##」分列：${titleOf(rel)}`)
  } catch (e) {
    if (!(e instanceof git.GitError)) throw e
    commitError = commitErrorText(e.message)
  }
  return { text: r.text, old, hash, columns: r.columns, cards: r.cards, commitError }
}

/**
 * 撤回转写法：文件回到转之前（一个字节不差），记进旧写法名单，一次提交。
 * 转完以后这块白板又改过（磁盘上不是转好的那份）就不撤，说清楚
 */
export async function keepOld(v: Vault, rel: string, old: string, converted: string): Promise<string | null> {
  const w = await v.write(rel, old, converted)
  if (!w.ok) throw new Error(`《${titleOf(rel)}》转完以后又改过，撤不回了；要旧的那份在历史里找「白板改成按「##」分列」那一次`)
  await writeKeep(v, [...(await readKeep(v)), rel])
  return commit(v, [rel, KEEP_OLD_FILE], `撤回：白板改成按「##」分列：${titleOf(rel)}`)
}

/**
 * 打开一篇：还有以前写法的「AI 总结的」卡（编号行后面一段普通的字）就一次写成 AI 总结块、写回、单独一次提交（task-5yp97）。
 * 没什么要改、用户撤回过的返回 null。打开再保存不变那条规矩照旧：这是一次有意的改写，只做一次，转完再打开不再动
 */
export async function convertSummaryOnOpen(v: Vault, rel: string): Promise<SummaryConverted | null> {
  const { text: old, readOnly } = await v.read(rel)
  if (readOnly || !needsSummaryConvert(old)) return null
  if ((await readKeep(v, KEEP_SUMMARY_FILE, '文件')).includes(rel)) return null
  const r = convertSummaryCards(old)
  if (r.text === old) return null
  const w = await v.write(rel, r.text, old)
  // 读完到写之间别处改过：这次不改，下次打开再说
  if (!w.ok) return null
  let hash: string | null = null
  let commitError: string | undefined
  try {
    hash = await git.commitPaths(v.root, [rel], `AI 总结卡改成提示块写法：${titleOf(rel)}`)
  } catch (e) {
    if (!(e instanceof git.GitError)) throw e
    commitError = commitErrorText(e.message)
  }
  return { text: r.text, old, hash, cards: r.cards, commitError }
}

/** 撤回总结卡改写法：文件回到改之前（一个字节不差），记进名单以后不再自动改，一次提交；改完以后又改过就不撤，说清楚 */
export async function keepOldSummary(v: Vault, rel: string, old: string, converted: string): Promise<string | null> {
  const w = await v.write(rel, old, converted)
  if (!w.ok) throw new Error(`《${titleOf(rel)}》改完以后又改过，撤不回了；要以前的那份在历史里找「AI 总结卡改成提示块写法」那一次`)
  await writeKeep(v, [...(await readKeep(v, KEEP_SUMMARY_FILE, '文件')), rel], KEEP_SUMMARY_FILE, '文件')
  return commit(v, [rel, KEEP_SUMMARY_FILE], `撤回：AI 总结卡改成提示块写法：${titleOf(rel)}`)
}

/** 库里的数据库：数据源文件夹、名字、几条、第一个写着它的 ```base 块（放到白板上照它的列） */
export async function listBases(v: Vault): Promise<BoardBase[]> {
  const texts = await v.texts()
  const found = new Map<string, { src: string; at: string }>()
  for (const [path, text] of texts) {
    if (!text.includes('```base')) continue
    for (const m of text.matchAll(/^```base[^\n]*\n([\s\S]*?)^```/gm)) {
      for (const folder of baseFoldersIn('```base\n' + m[1] + '```')) if (!found.has(folder)) found.set(folder, { src: m[1]!.replace(/\n$/, ''), at: path })
    }
  }
  const out: BoardBase[] = []
  for (const [folder, f] of found) {
    const count = [...texts.keys()].filter((p) => p.startsWith(folder + '/') && !p.slice(folder.length + 1).includes('/')).length
    out.push({ folder, name: folder.split('/').pop()!, count, src: f.src, from: f.at })
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder, 'zh'))
}

export function registerBoard(vault: () => Vault, changed: () => void) {
  ipcMain.handle('board:convert', async (_e, path: unknown, force: unknown) => {
    if (typeof path !== 'string') throw new Error('白板路径不对')
    const r = await convertOnOpen(vault(), path, force === true)
    if (r) changed()
    return r
  })
  ipcMain.handle('board:keepOld', async (_e, path: unknown, old: unknown, converted: unknown) => {
    if (typeof path !== 'string' || typeof old !== 'string' || typeof converted !== 'string') throw new Error('撤回参数不对')
    const h = await keepOld(vault(), path, old, converted)
    changed()
    return h
  })
  ipcMain.handle('board:summaryConvert', async (_e, path: unknown) => {
    if (typeof path !== 'string') throw new Error('路径不对')
    const r = await convertSummaryOnOpen(vault(), path)
    if (r) changed()
    return r
  })
  ipcMain.handle('board:summaryKeepOld', async (_e, path: unknown, old: unknown, converted: unknown) => {
    if (typeof path !== 'string' || typeof old !== 'string' || typeof converted !== 'string') throw new Error('撤回参数不对')
    const h = await keepOldSummary(vault(), path, old, converted)
    changed()
    return h
  })
  ipcMain.handle('board:bases', () => listBases(vault()))
  // 白板上一次改了两篇（卡拖进另一个标签里的文档）：只提交这几篇，一次
  ipcMain.handle('board:commit', async (_e, paths: unknown, message: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string') || typeof message !== 'string' || !message.trim()) throw new Error('提交参数不对')
    const h = await commit(vault(), paths as string[], message)
    changed()
    return h
  })
  ipcMain.handle('board:revert', async (_e, hash: unknown) => {
    if (typeof hash !== 'string') throw new Error('提交号不对')
    const h = await git.revert(vault().root, hash)
    changed()
    return h
  })
}
