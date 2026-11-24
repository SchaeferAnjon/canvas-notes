/**
 * 数据库 AI 列在主进程这一边（第三批 task-i921u「AI 生成一列」方向 B）：问 AI、写格子、一批一次提交、停下、撤回。
 * 写法和算法（问什么、答回来怎么认、一格写哪几行）都是 packages/format 的 base-ai.ts，这里只管读文件、问 AI、写盘、提交。
 *
 * - runAiRow：给一行跑一次 AI，写回格子或新建笔记（写盘、不提交）。AI 列每一格、以后「自动化 / 按钮列」的 AI 动作都调它。
 * - 一批（aicol:run）：一次 3 格同时写，写好一格存一格；跑完或停下（aicol:stop，界面按 esc）时这一批合成一次提交，
 *   底部「撤回」把这一批每个文件换回去（aicol:undo，也是一次提交）。关了文档也接着跑，进度一格一格发给界面（aicol:progress）。
 * - AI 读的时候那一条正文的样子（aiSourceKey）、这一列见过哪几条（新加的一讲自动填）记在这台 Mac 上（设置目录 ai-columns.json），不写进文件。
 */
import * as git from '@cn/git'
import {
  AI_BATCH,
  aiAsk,
  aiCellWrites,
  type AiColDef,
  aiColOf,
  aiNotePath,
  aiParse,
  aiSourceKey,
  baseContext,
  type BaseRec,
  type FileWrite,
  parseBaseDoc,
  recOf,
} from '@cn/format'
import { BrowserWindow, ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { AiColDone, AiColProgress, AiColRun } from '../shared/api'
import { commitErrorText } from '../shared/git-errors'
import { ask } from './ai'
import { columnPick } from './agent'
import { applyBaseWrites } from './base-write'
import type { Vault } from './vault'
import { atomicWriteSync } from '@cn/atomic'

// ---------------------------------------------------------------- 给一行跑一次 AI（能复用的那一个）

export interface AiRowRequest {
  /** ```base 块的 YAML：数据源、列的设置从这里读 */
  src: string
  /** 哪一列（base 块 properties 里 type: ai 的那一列） */
  col: string
  /** 那一条（库里的相对路径） */
  path: string
  /** 不在块里的 AI 动作（按钮列）直接给设置；给了就不从 src 找这一列 */
  def?: AiColDef
  signal: AbortSignal
  /** AI 边写边给的字（界面上「在读…」那一格用不到，按钮列想看可以接） */
  onText?(delta: string): void
}

export type AiRowResult =
  | {
      ok: true
      /** 这一格写了哪几个文件（改前改后；新建的那篇 before 是空字） */
      writes: FileWrite[]
      /** 写进格子的值 */
      value: string | string[]
      /** 「Claude Code · Opus 5.5」 */
      by: string
      /** 「读了《第3讲 生产》」 */
      read: string
      chars: number
      /** AI 读的时候那一条正文的样子（说「原文改过」用） */
      source: string
    }
  | { ok: false; error: string; stopped?: boolean }

/** 配着的 PDF、网页（reads: attached）：正文、「来源」里连着的库里的 .pdf / .html */
async function attachedOf(v: Vault, rec: BaseRec): Promise<{ name: string; text: string }[]> {
  const links = new Set<string>()
  for (const m of rec.text.matchAll(/\[\[([^\]|#]+\.(?:pdf|html?))(?:[#|][^\]]*)?\]\]/gi)) links.add(m[1]!.trim())
  for (const m of rec.text.matchAll(/\]\(([^)\s]+\.(?:pdf|html?))(?:#[^)]*)?\)/gi)) {
    try {
      links.add(decodeURIComponent(m[1]!))
    } catch {
      links.add(m[1]!)
    }
  }
  const out: { name: string; text: string }[] = []
  for (const l of [...links].slice(0, 4)) {
    if (/^[a-z]+:/i.test(l)) continue
    const rel = [posix.join(rec.folder, l), posix.normalize(l)].find((p) => !p.startsWith('..') && existsSync(v.abs(p)))
    if (!rel) continue
    const name = rel.split('/').pop()!
    if (/\.pdf$/i.test(rel)) {
      const { readPdfText } = await import('./search/pdf-read')
      const r = await readPdfText(v.abs(rel))
      out.push({ name, text: r.pages.map((p, i) => `第 ${i + 1} 页\n` + p.map((b) => b.text).join('\n')).join('\n\n') })
    } else {
      const html = readFileSync(v.abs(rel), 'utf8')
      out.push({ name, text: html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n') })
    }
  }
  return out
}

/** 读一篇（不在了是空字） */
async function textOf(v: Vault, path: string): Promise<string> {
  try {
    return (await v.read(path)).text
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw e
  }
}

/** 数据源里的每一篇（算选项、找那一条） */
async function recordsOf(v: Vault, folder: string | null): Promise<{ path: string; text: string }[]> {
  if (folder === null) return []
  const files = (await v.list()).filter((f) => f.path.startsWith(folder + '/') && /\.md$/i.test(f.path))
  return Promise.all(files.map(async (f) => ({ path: f.path, text: await textOf(v, f.path) })))
}

/**
 * 给一行跑一次 AI，写回格子或新建笔记：读那一条（和配着的 PDF、网页）→ 问那一列选的家（没选跟 AI 对话）→ 认回答 →
 * 再读一遍那一条、那篇（问的时候用户可能改过）算要写的几行 → 写盘（先比后写，不提交；提交由调的人一批合成一次）。
 * tell：写了一篇（开着这篇的编辑器合进来）
 */
export async function runAiRow(v: Vault, req: AiRowRequest, tell: (path: string, text: string) => void): Promise<AiRowResult> {
  const doc = parseBaseDoc(req.src)
  const def = req.def ?? aiColOf(doc, req.col)
  if (!def) return { ok: false, error: `「${req.col}」不是 AI 列` }
  if (req.def) doc.props[req.col] = req.def
  const recs = await recordsOf(v, doc.folder)
  const one = recs.find((r) => r.path === req.path)
  if (!one) return { ok: false, error: '这一条不在了' }
  const rec = recOf(one)
  const options = def.output === 'select' || def.output === 'multi' ? [...new Set(recs.flatMap((r) => (def.output === 'multi' ? (recOf(r).lists[req.col] ?? []) : [recOf(r).props[req.col] ?? ''])).filter(Boolean))] : []
  const attached = def.reads === 'attached' ? await attachedOf(v, rec) : []
  const q = aiAsk(def, req.col, rec, options, attached)
  const { pick, by } = columnPick(def.ai)
  let answer: string
  try {
    answer = await ask(q.system, q.prompt, req.signal, req.onText ?? (() => {}), 'chat', { pick })
  } catch (e) {
    if (req.signal.aborted) return { ok: false, error: '停下了', stopped: true }
    return { ok: false, error: String((e as Error).message ?? e).split('\n')[0]!.slice(0, 160) }
  }
  if (req.signal.aborted) return { ok: false, error: '停下了', stopped: true }
  const parsed = aiParse(def, answer, options)
  if ('error' in parsed) return { ok: false, error: parsed.error }
  // 问的时候用户可能改了那一条：照现在盘上的字算，只换那几行
  const fresh = await textOf(v, req.path)
  if (!fresh) return { ok: false, error: '这一条不在了' }
  const noteText = def.output === 'note' ? await textOf(v, aiNotePath(def, rec.name, req.col)) : null
  const ctx = baseContext(doc, [{ path: req.path, text: fresh }])
  const writes = aiCellWrites(ctx, { path: req.path, col: req.col, value: parsed.value, by, read: q.read, noteText })
  const done: FileWrite[] = []
  for (const w of writes) {
    const r = await v.write(w.path, w.after, w.before)
    if (!r.ok) {
      for (const d of done.reverse()) d.before === '' ? await rm(v.abs(d.path), { force: true }) : await v.write(d.path, d.before, d.after)
      return { ok: false, error: `《${w.path.split('/').pop()!.replace(/\.md$/, '')}》刚被别处改过，这一格没写` }
    }
    done.push(w)
    tell(w.path, w.after)
  }
  return { ok: true, writes, value: parsed.value, by, read: q.read, chars: q.chars, source: aiSourceKey(rec.text) }
}

// ---------------------------------------------------------------- 记在这台 Mac 上的：读的时候的样子、见过哪几条

interface Mem {
  /** 库 → 「数据源|列」→ 那一条 → 读的时候正文的样子 */
  sources: Record<string, Record<string, Record<string, string>>>
  /** 库 → 「数据源|列」→ 见过的那几条（新加的一讲自动填） */
  seen: Record<string, Record<string, string[]>>
}

class ColumnMemory {
  private mem: Mem
  constructor(private file: string) {
    try {
      const m = JSON.parse(readFileSync(file, 'utf8')) as Partial<Mem>
      this.mem = { sources: m.sources ?? {}, seen: m.seen ?? {} }
    } catch {
      this.mem = { sources: {}, seen: {} }
    }
  }
  private save() {
    atomicWriteSync(this.file, JSON.stringify(this.mem))
  }
  sources(root: string, key: string): Record<string, string> {
    return this.mem.sources[root]?.[key] ?? {}
  }
  setSource(root: string, key: string, path: string, source: string) {
    ;((this.mem.sources[root] ??= {})[key] ??= {})[path] = source
    this.save()
  }
  /** 这一列这几条里哪些是第一次见（第一次看这一列时全当见过，不跑） */
  fresh(root: string, key: string, paths: string[]): string[] {
    const all = (this.mem.seen[root] ??= {})
    const known = all[key]
    all[key] = [...new Set([...(known ?? []), ...paths])]
    if (all[key]!.length !== (known?.length ?? -1)) this.save()
    if (!known) return []
    return paths.filter((p) => !known.includes(p))
  }
  see(root: string, key: string, paths: string[]) {
    const all = (this.mem.seen[root] ??= {})
    all[key] = [...new Set([...(all[key] ?? []), ...paths])]
    this.save()
  }
}

// ---------------------------------------------------------------- 一批

interface Job {
  id: number
  root: string
  key: string
  col: string
  ctl: AbortController
  /** 每个文件：这一批第一次写之前、最后写完的字 */
  files: Map<string, { before: string; after: string }>
  done: number
  failed: number
  created: number
}

const jobs = new Map<number, Job>()
let nextJob = 1

/** 这一批每个文件改前（第一次写之前）改后（最后一次写完） */
const batchWrites = (j: Job): FileWrite[] => [...j.files].map(([path, w]) => ({ path, before: w.before, after: w.after }))

export function registerAiColumn(vault: () => Vault, userData: string, tell: (path: string, text: string) => void, changed: () => void) {
  const memory = new ColumnMemory(join(userData, 'ai-columns.json'))
  const send = (ch: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload)
  }

  ipcMain.handle('aicol:run', async (_e, raw: unknown): Promise<{ job: number } | { error: string }> => {
    const r = checkRun(raw)
    const v = vault()
    const doc = parseBaseDoc(r.src)
    const def = aiColOf(doc, r.col)
    if (!def || doc.folder === null) return { error: `「${r.col}」不是 AI 列` }
    const key = `${doc.folder}|${r.col}`
    const job: Job = { id: nextJob++, root: v.root, key, col: r.col, ctl: new AbortController(), files: new Map(), done: 0, failed: 0, created: 0 }
    jobs.set(job.id, job)
    memory.see(v.root, key, r.all)
    // 这几篇里用户没提交的字先单独提交：这一批的提交（和撤回）里只有 AI 写的
    const pending = (await git.status(v.root)).filter((s) => r.paths.includes(s.path) || (def.output === 'note' && def.folder && s.path.startsWith(def.folder + '/')))
    try {
      if (pending.length) await git.commitPaths(v.root, pending.map((s) => s.path), git.describeChanges(pending))
    } catch (e) {
      // 提交不了（git 锁着）：照样跑，这一批的提交时再说
      if (!(e instanceof git.GitError)) throw e
    }
    void runJob(v, job, r, def)
    return { job: job.id }
  })

  async function runJob(v: Vault, job: Job, r: AiColRun, def: AiColDef) {
    const queue = [...r.paths]
    const progress = (p: Omit<AiColProgress, 'job'>) => send('aicol:progress', { job: job.id, ...p } satisfies AiColProgress)
    for (const p of queue) progress({ path: p, state: 'queued' })
    const worker = async () => {
      for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
        if (job.ctl.signal.aborted) {
          progress({ path: p, state: 'stopped' })
          continue
        }
        progress({ path: p, state: 'running' })
        const res = await runAiRow(v, { src: r.src, col: r.col, path: p, signal: job.ctl.signal }, tell)
        if (res.ok) {
          for (const w of res.writes) {
            const had = job.files.get(w.path)
            job.files.set(w.path, { before: had?.before ?? w.before, after: w.after })
            if (!had && w.before === '') job.created++
          }
          job.done++
          memory.setSource(v.root, job.key, p, res.source)
          progress({ path: p, state: 'done' })
        } else if (res.stopped) progress({ path: p, state: 'stopped' })
        else {
          job.failed++
          progress({ path: p, state: 'error', error: res.error })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(AI_BATCH, queue.length || 1) }, worker))
    jobs.delete(job.id)
    const writes = batchWrites(job)
    let hash: string | null = null
    let commitError: string | undefined
    if (writes.length) {
      const msg = `${r.label}（${def.output === 'note' && job.created ? `新建 ${job.created} 篇笔记，` : ''}${job.done} 格）`
      try {
        hash = await git.commitPaths(v.root, writes.map((w) => w.path), msg)
      } catch (e) {
        if (!(e instanceof git.GitError)) throw e
        commitError = commitErrorText(e.message)
      }
      changed()
    }
    send('aicol:done', { job: job.id, writes, done: job.done, failed: job.failed, created: job.created, stopped: job.ctl.signal.aborted, hash, ...(commitError ? { commitError } : {}) } satisfies AiColDone)
  }

  ipcMain.handle('aicol:stop', (_e, id: unknown) => {
    const j = typeof id === 'number' ? jobs.get(id) : undefined
    j?.ctl.abort()
    return !!j
  })
  // 撤回这一批：每个文件换回这一批之前（新建的那几篇删掉），一次提交
  ipcMain.handle('aicol:undo', async (_e, writes: unknown, message: unknown) => {
    const r = await applyBaseWrites(vault(), writes, message, tell)
    changed()
    return r
  })
  ipcMain.handle('aicol:sources', (_e, folder: unknown, col: unknown) => {
    if (typeof folder !== 'string' || typeof col !== 'string') throw new Error('AI 列参数不对')
    return memory.sources(vault().root, `${folder}|${col}`)
  })
  // 新加的一讲：这一列第一次见到的那几条（第一次看这一列时全当见过）
  ipcMain.handle('aicol:fresh', (_e, folder: unknown, col: unknown, paths: unknown) => {
    if (typeof folder !== 'string' || typeof col !== 'string' || !Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) throw new Error('AI 列参数不对')
    return memory.fresh(vault().root, `${folder}|${col}`, paths as string[])
  })
  // AI 建的那几篇现在的字（删除这一列前先问一句：哪几篇里写过答案）
  ipcMain.handle('aicol:notes', async (_e, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string' || !/\.md$/i.test(p))) throw new Error('AI 列参数不对')
    const v = vault()
    const out: Record<string, string> = {}
    for (const p of paths as string[]) if (existsSync(v.abs(p))) out[p] = await textOf(v, p)
    return out
  })
}

function checkRun(raw: unknown): AiColRun {
  const o = (raw ?? {}) as Record<string, unknown>
  const strs = (x: unknown) => Array.isArray(x) && x.every((p) => typeof p === 'string' && /\.md$/i.test(p) && !p.startsWith('/') && !p.split('/').includes('..'))
  if (typeof o.src !== 'string' || typeof o.col !== 'string' || typeof o.label !== 'string' || !strs(o.paths) || !strs(o.all)) throw new Error('AI 列参数不对')
  return { src: o.src, col: o.col, label: o.label, paths: o.paths as string[], all: o.all as string[] }
}

