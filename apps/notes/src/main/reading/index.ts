/**
 * 读 PDF 边读边问的主进程这一半：
 * - 把库里的 PDF 交给界面（pdf.js 在界面里画），列出库里的 PDF；
 * - 每份 PDF 本机记着上次看到哪页和对话（userData/reading/，不进库）；
 * - 问 AI：框的那块图 + 这一页的文字 + （这个会话第一次）整份 PDF 的文字 + 笔记里已经懂了的（每轮的小结）；
 *   旁支（CN-90）从主对话的会话分叉，告诉 AI 被问的那句和它所在的那一轮；
 * - 后台记笔记：这一处的问答（主对话 + 旁支）照原话、原文收成一段（section.ts），快的模型只写标题和一句小结，
 *   写进 PDF 旁边的「… 笔记.md」，一次提交。以前另写的完整对话（.canvas-notes/对话/）不再写：笔记里就是问答原文，
 *   界面里看对话在右栏 AI；那个路径只当这一处的身份用（笔记那一段第二行行尾的注释）。
 */
import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import { pastedImages, pastedPath } from '../pasted'
import { ocrImage } from '../ocr'
import { checkMaterials, PASTED_NAME, withMaterials } from '../../shared/materials'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as git from '@cn/git'
import {
  askUnits,
  attachDirFor,
  cleanQuestion,
  CONVO_DIR,
  cropCaption,
  cropGaps,
  formulaImagesNote,
  insertAfterAsk,
  insertCrop,
  lectureOf,
  linkFrom,
  type NoteAsk,
  parsePdfAnchor,
  notePathFor,
  parseReadingNote,
  pdfSrc,
  PREREQ,
  type PdfBlock,
  upsertSection,
  ATTACH_DIR,
  threadName,
  webSrc,
} from '@cn/format'
import { siteOf } from '../../shared/web-reader'
import { fmtTime, videoOf } from '../../shared/video'
import { subsAround } from '../video'
import type { EngineId } from '../../shared/agent'
import type { CommitInfo } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import type { AskEvent, AskRequest, AskResult, PdfFile, ReadingMsg, ReadingSide, ReadingState, ReadingThread, VizRequest, VizResult } from '../../shared/reading'
import type { NoteAppendResult, NoteAskRequest } from '../../shared/ai-note'
import { withoutEffort } from '@cn/ai-engines/shared'
import { chatRun, engine, featureLabel, langTail, modeLine, modelOpt, omniOn, runAgentTurn, vaultNotes } from '../agent'
import { E2E } from '../test-mode'
import { pdfHash, type PdfTextCache, readTextCache, textCachePath } from '../pdf-text-cache'
import type { EngineImage } from '@cn/ai-engines'
import type { Vault } from '../vault'
import { askPrompt, extractHtml, fullTextOf, noteDigest, sidePrompt, TUTOR_SYSTEM, TUTOR_VERSION, VIZ_SYSTEM, vizFileStem, vizPrompt, vizTitle, withVizMeta } from './prompts'
import { answerMd, matsOf, questionOf } from './section'
import { setupCards } from './cards'
import { setupAiNote } from './ai-note'
import { readingKey } from './chats'
import { setupBilingual } from './bilingual'
import { setupCapture } from './capture'
import { setupHighlights } from './highlights'
import { courseName, dirOf } from './doubts'
import { t } from '../../shared/i18n'
import { catName } from '../../shared/categories'
import { logDropped } from '../crash-log'
import { atomicCopy, atomicWrite, atomicWriteSync } from '@cn/atomic'
import { sharedRun } from '../shared-run'

const IDS: EngineId[] = ['claude', 'codex', 'gemini', 'opencode']
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.obsidian'])
/** 再大的 PDF 不往界面里送（几百 MB 的扫描件） */
const MAX_PDF = 300 * 1024 * 1024

export interface ReadingDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
}

const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')

function needPdf(path: unknown): string {
  if (typeof path !== 'string' || !/\.pdf$/i.test(path)) throw new Error(t('不是 PDF'))
  return path
}

/**
 * 边读边问的来源：库里的 PDF、库里的 HTML（中间栏开着的可视化），或「web:<网址>」（右栏网页上框着问、中间栏没开 PDF 时）
 */
/** 记进的笔记：库里的相对路径、.md */
function needNote(p: unknown): string {
  if (typeof p !== 'string' || !/\.md$/i.test(p) || p.startsWith('/') || p.split('/').includes('..')) throw new Error(t('笔记路径不对'))
  return p
}

function needSource(path: unknown): string {
  if (typeof path !== 'string' || !(/\.(pdf|html?)$/i.test(path) || /^web:https?:\/\//i.test(path))) throw new Error(t('不是 PDF、HTML 或网页'))
  return path
}
const isWeb = (p: string) => p.startsWith('web:')
/** 截图、完整对话文件名用的名字 */
/** 截图、完整对话的文件名前缀：PDF 名；网页是「网页-域名」，视频是「视频-youtube-视频号」 */
function nameOf(p: string): string {
  if (!isWeb(p)) return stemOf(p)
  const v = videoOf(p.slice(4))
  // 不翻：磁盘上的名字
  return v ? `视频-${v.site}-${v.id}${v.p && v.p > 1 ? `-p${v.p}` : ''}` : `网页-${siteOf(p.slice(4))}`
}

const attachOf = (p: string) => (isWeb(p) ? `${ATTACH_DIR}/网页` : attachDirFor(p)) // 不翻：磁盘上的文件夹名


/** 文件挪了（文件夹改名）：本机记着的读到哪、AI 会话跟着换到新路径 */
export function moveReadingState(root: string, from: string, to: string) {
  if (!/\.(pdf|html?)$/i.test(from)) return
  const dir = join(app.getPath('userData'), 'reading')
  for (const ext of ['.json', '.sessions.json']) {
    const a = join(dir, readingKey(root, from) + ext)
    if (existsSync(a)) renameSync(a, join(dir, readingKey(root, to) + ext))
  }
}

export function setupReading(deps: ReadingDeps) {
  const dir = join(app.getPath('userData'), 'reading')
  const needVault = () => {
    const v = deps.vault()
    if (!v) throw new Error(t('还没有打开库'))
    return v
  }
  const send = (ch: string, ...args: unknown[]) => deps.win()?.webContents.send(ch, ...args)
  setupBilingual({ vault: deps.vault, send })
  setupCapture(deps.win)
  setupHighlights({ win: deps.win, vault: deps.vault })

  // ---------- 本机记着的 ----------
  const keyOf = (pdf: string) => readingKey(needVault().root, pdf)
  const readJson = <T>(p: string, fallback: T): T => {
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw e
    }
  }
  const writeJson = (p: string, v: unknown) => {
    mkdirSync(dirname(p), { recursive: true })
    // 先写临时文件再换名，写到一半退出也不会坏
    atomicWriteSync(p, JSON.stringify(v))
  }
  const statePath = (pdf: string) => join(dir, `${keyOf(pdf)}.json`)
  /**
   * 会话号只有主进程写：哪家引擎在用哪个会话、哪个会话读过全文；v 是这些会话开的时候用的讲法版本（TUTOR_VERSION）；
   * sides 是旁支（CN-90）：旁支编号 → 每家引擎旁支自己的会话号（新对话时和主对话的一起忘掉）
   */
  type Sessions = { sessions: Partial<Record<EngineId, string>>; fullIn: Partial<Record<EngineId, string>>; v?: number; sides?: Record<string, Partial<Record<EngineId, string>>> }
  const sessionsPath = (pdf: string) => join(dir, `${keyOf(pdf)}.sessions.json`)
  /** 讲法改过（旧会话里记着旧的系统提示）的会话不再接着聊：当没有会话，开新的、补上全文和最近几轮 */
  const readSessions = (pdf: string): Sessions => {
    const s = readJson<Sessions>(sessionsPath(pdf), { sessions: {}, fullIn: {} })
    return s.v === TUTOR_VERSION ? s : { sessions: {}, fullIn: {}, v: TUTOR_VERSION }
  }
  const textPath = (hash: string) => textCachePath(app.getPath('userData'), hash)

  // ---------- PDF ----------
  ipcMain.handle('reading:listPdfs', () => listPdfs())
  // 整库的 PDF：同时只算一份（shared-run.ts）
  const listPdfs = sharedRun(async (): Promise<PdfFile[]> => {
    const v = needVault()
    const out: PdfFile[] = []
    const walk = async (d: string) => {
      for (const ent of await readdir(d, { withFileTypes: true })) {
        if (ent.name.startsWith('.')) continue
        const p = join(d, ent.name)
        if (ent.isDirectory()) {
          if (!SKIP_DIRS.has(ent.name)) await walk(p)
        } else if (ent.isFile() && /\.pdf$/i.test(ent.name)) {
          const st = await stat(p)
          out.push({ path: v.rel(p), mtimeMs: st.mtimeMs, size: st.size })
        }
      }
    }
    await walk(v.root)
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  })

  ipcMain.handle('reading:pdf', async (_e, path: unknown) => {
    const abs = needVault().abs(needPdf(path))
    const st = await stat(abs)
    if (st.size > MAX_PDF) throw new Error(t('这份 PDF 有 {mb} MB，太大了打不开', { mb: Math.round(st.size / 1024 / 1024) }))
    const data = await readFile(abs)
    return { data: new Uint8Array(data), hash: pdfHash(data) }
  })

  // Anki 卡背面「打开原文」：canvas-notes://open?file=<库里的路径>&page=5&rect=…，打开这份 PDF 翻到那一页；md 带 line= 是画布今日来的，打开那一篇到那一行
  const openAt = (raw: string) => {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return
    }
    if (u.protocol !== 'canvas-notes:' || u.hostname !== 'open') return
    // MeetCaption 跳过来的（带时间 t= 或哪一场 session=）归 main/meetcaption.ts：打开那一篇、滚到那个时间点
    if (u.searchParams.has('t') || u.searchParams.has('session')) return
    const file = u.searchParams.get('file') ?? ''
    // 画布今日「打开笔记，到这一行」：canvas-notes://open?file=<笔记>.md&line=<第几行，从 1 数>
    if (/\.md$/i.test(file)) {
      const w = deps.win()
      if (!w) return
      const line = Number(u.searchParams.get('line'))
      w.webContents.send('note:openAt', { file, ...(Number.isInteger(line) && line > 0 ? { line } : {}) })
      if (!E2E) w.show()
      return
    }
    // 文件夹（ParaRead「在画布笔记里继续」带回来的 back=）：开那个文件夹的首页
    const v = deps.vault()
    if (v && !/\.[a-z0-9]+$/i.test(file) && !file.split('/').includes('..')) {
      let dir = false
      try {
        dir = statSync(v.abs(file)).isDirectory()
      } catch {
        dir = false
      }
      const w = deps.win()
      if (dir && w) {
        w.webContents.send('note:openAt', { file, folder: true })
        if (!E2E) w.show()
      }
      return
    }
    const a = parsePdfAnchor(`${encodeURIComponent(file)}#${u.search.slice(1)}`)
    if (!a || !/\.pdf$/i.test(file)) return
    const w = deps.win()
    if (!w) return
    w.webContents.send('reading:openAt', { file, page: a.page, ...(a.rect ? { rect: a.rect } : {}) })
    if (!E2E) w.show()
  }
  app.on('open-url', (e, url) => {
    e.preventDefault()
    openAt(url)
  })
  // 只在装好的软件里登记（开发版、测试不改这台 Mac 的设置）
  if (app.isPackaged && !E2E) app.setAsDefaultProtocolClient('canvas-notes')

  ipcMain.handle('reading:htmlMeta', async (_e, path: unknown) => {
    if (typeof path !== 'string' || !/\.html?$/i.test(path)) throw new Error(t('不是 HTML'))
    const all = await readFile(needVault().abs(path), 'utf8')
    const head = all.slice(0, 20_000)
    const props: Record<string, string> = {}
    for (const m of head.matchAll(/<meta\s+name="([^"]+)"\s+content="([^"]*)"/gi)) props[m[1]!] = m[2]!.replace(/&quot;/g, '"')
    const title = /<title>([^<]*)<\/title>/i.exec(head)?.[1]?.trim()
    // 给 AI 看的字：去掉脚本、样式和标签（框着问的时候一起给）
    const text = all
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20_000)
    return { ...(title ? { title } : {}), props, text }
  })
  ipcMain.handle('reading:forget', (_e, pdf: unknown) => writeJson(sessionsPath(needSource(pdf)), { sessions: {}, fullIn: {}, v: TUTOR_VERSION } satisfies Sessions))
  ipcMain.handle('reading:reveal', (_e, pdf: unknown) => shell.showItemInFolder(needVault().abs(needPdf(pdf))))

  ipcMain.handle('reading:state', (_e, pdf: unknown): ReadingState => {
    const p = needSource(pdf)
    const fresh: ReadingState = { pdf: p, page: 1, msgs: [], threads: [] }
    // 记坏了的（写到一半、少了列表，task-pyb39）当没记过，记一行日志：对话里一渲染就抛错
    let s: ReadingState | null
    try {
      s = readJson<ReadingState | null>(statePath(p), null)
    } catch (e) {
      logDropped('reading', `本机的对话记录读不出来：${(e as Error).message}`) // 不翻：写进日志
      return fresh
    }
    if (!s || typeof s !== 'object' || s.pdf !== p) return fresh
    if (!Array.isArray(s.msgs) || !Array.isArray(s.threads) || (s.sides !== undefined && !Array.isArray(s.sides))) {
      logDropped('reading', '本机的对话记录少了消息或框的列表') // 不翻：写进日志
      return fresh
    }
    // 收起来的那几段（点「+」，task 读PDF新建对话）记坏了：只丢它们，现在这段照旧
    if (s.older !== undefined && !(Array.isArray(s.older) && s.older.every((c) => c && typeof c.id === 'number' && Array.isArray(c.msgs) && (c.sides === undefined || Array.isArray(c.sides))))) {
      logDropped('reading', '本机的对话记录里以前那几段记坏了') // 不翻：写进日志
      s = { ...s, older: [] }
    }
    return typeof s.page === 'number' && Number.isFinite(s.page) ? s : { ...s, page: 1 }
  })
  ipcMain.handle('reading:state:save', (_e, s: ReadingState) => {
    if (!s || !Array.isArray(s.msgs) || !Array.isArray(s.threads)) throw new Error(t('读 PDF 的记录不对'))
    writeJson(statePath(needSource(s.pdf)), s)
  })

  /** 已经发出去、还没写成文件的名字（同一页连着框两块不会撞名） */
  const reserved = new Set<string>()
  /** taken：别的已经用掉的名字（这一处的身份不再是一个文件：笔记里各段、对话记录里的那几处） */
  const freeName = (make: (n: number) => string, taken?: ReadonlySet<string>) => {
    const v = needVault()
    for (let n = 1; ; n++) {
      const p = make(n)
      if (!reserved.has(p) && !taken?.has(p) && !existsSync(v.abs(p))) {
        reserved.add(p)
        return p
      }
    }
  }

  ipcMain.handle('reading:crop', async (_e, pdf: unknown, page: number, png: Uint8Array) => {
    const p = needSource(pdf)
    if (!(png instanceof Uint8Array) || png.length > 20 * 1024 * 1024) throw new Error(t('截图不对'))
    const rel = freeName((n) => `${attachOf(p)}/${isWeb(p) ? `${nameOf(p).slice(3)}-` : ''}p${Math.max(1, Math.floor(page))}-${n}.png`)
    const abs = needVault().abs(rel)
    await mkdir(dirname(abs), { recursive: true })
    await atomicWrite(abs, png)
    reserved.delete(rel)
    return rel
  })

  // ---------- 补截图（task-yp8l7）：以前问过、笔记里那一段没有「我框的」图的，按记下的框补一张 ----------
  /**
   * 这份 PDF 的笔记里哪几段没有图：框的位置先看笔记里那一段的页码链接，没有再看以前的完整对话文件（.canvas-notes/对话/）的「回到第 N 页」、
   * 这台 Mac 上的对话记录；对话记录里那一处有截图、库里也还在的，直接拿来用（have）。missing：哪儿都没记下框的位置的几段
   */
  ipcMain.handle('reading:crop-gaps', async (_e, pdf: unknown) => {
    const p = needPdf(pdf)
    const note = notePathFor(p)
    const v = needVault()
    // 这份 PDF 不在库里了（笔记还在）：截不了
    const text = existsSync(v.abs(p)) ? await peekText(note) : null
    if (!text) return { note, gaps: [], missing: 0 }
    const state = readJson<ReadingState | null>(statePath(p), null)
    const gaps: { id: string; page: number; rect?: [number, number, number, number]; have?: string }[] = []
    let missing = 0
    for (const g of cropGaps(text, note)) {
      if (g.file !== p) continue
      const th = state?.threads.find((x) => x.id === g.id)
      if (th?.crop && existsSync(v.abs(th.crop))) {
        gaps.push({ id: g.id, page: g.page, have: th.crop })
        continue
      }
      let rect = g.rect ?? th?.rect
      if (!rect) {
        const convo = (await peekText(g.id)) ?? ''
        const back = /\[回到第\s*\d+\s*页\]\(([^)]+)\)/.exec(convo)
        rect = back ? parsePdfAnchor(back[1]!)?.rect : undefined
      }
      if (rect) gaps.push({ id: g.id, page: g.page, rect })
      else missing++
    }
    return { note, gaps, missing }
  })

  /** 补好的图写进库、插进笔记那几段（别的字不动），一次提交；返回补上了几张 */
  ipcMain.handle('reading:crop-fill', async (_e, pdf: unknown, items: unknown) => {
    const p = needPdf(pdf)
    if (!Array.isArray(items)) throw new Error(t('截图不对'))
    const v = needVault()
    const note = notePathFor(p)
    const base = await readText(note)
    if (base === null) return 0
    let next = base
    const files: string[] = []
    for (const it of items as { id: string; page: number; png?: Uint8Array; have?: string; w?: number }[]) {
      if (typeof it?.id !== 'string') continue
      let crop = typeof it.have === 'string' && existsSync(v.abs(it.have)) ? it.have : null
      if (!crop && it.png instanceof Uint8Array && it.png.length && it.png.length < 20 * 1024 * 1024) {
        crop = freeName((n) => `${attachOf(p)}/p${Math.max(1, Math.floor(Number(it.page) || 1))}-${n}.png`)
        await mkdir(dirname(v.abs(crop)), { recursive: true })
        await atomicWrite(v.abs(crop), it.png)
        reserved.delete(crop)
      }
      if (!crop) continue
      const after = insertCrop(next, note, it.id, crop, typeof it.w === 'number' ? it.w : undefined)
      if (after === next) continue
      next = after
      files.push(crop)
    }
    if (!files.length) return 0
    const w = await v.write(note, next, base)
    if (!w.ok) throw new Error(t('笔记刚被改过，截图没补进去，下次打开再补'))
    send('note:changed', note, next)
    // 不翻：提交说明
    await git.commitPaths(v.root, [note, ...files], `笔记：${stemOf(p)} 补上 ${files.length} 张截图`)
    send('files:changed')
    return files.length
  })

  /** 贴进来的截图（pasted/ 里的名字）认出的字：界面拿去 PDF 里找是哪一页（shared/locate.ts） */
  ipcMain.handle('reading:ocr', (_e, name: unknown) => {
    if (typeof name !== 'string' || !PASTED_NAME.test(name)) throw new Error(t('粘贴的图不对'))
    return ocrImage(pastedPath(name))
  })

  ipcMain.handle('reading:thread', async (_e, pdf: unknown, page: number) => {
    const p = needSource(pdf)
    // 以前问过的几处（笔记里的各段、对话记录里的）都算用掉了：完整对话不再写成文件，光看文件在不在会撞到老的那一段
    const taken = new Set(readJson<ReadingState | null>(statePath(p), null)?.threads.map((t) => t.id) ?? [])
    if (!isWeb(p)) for (const s of parseReadingNote((await peekText(notePathFor(p))) ?? '', notePathFor(p))) taken.add(s.id)
    // 视频没有页码：「视频-youtube-视频号-1.md」
    return freeName((n) => `${CONVO_DIR}/${nameOf(p)}${isWeb(p) && videoOf(p.slice(4)) ? '' : `-p${Math.max(1, Math.floor(page))}`}-${n}.md`, taken)
  })

  // ---------- 全文（pdf-blocks 拼好的段落块，按内容指纹缓存） ----------
  ipcMain.handle('reading:text:set', (_e, hash: string, pdf: unknown, pages: PdfBlock[][], sizes: [number, number][]) => {
    const p = needPdf(pdf)
    if (typeof hash !== 'string' || !Array.isArray(pages) || !Array.isArray(sizes)) throw new Error(t('全文不对'))
    writeJson(textPath(hash), { pdf: p, pages, sizes } satisfies PdfTextCache)
  })
  const textOf = (hash: string) => readTextCache(app.getPath('userData'), hash)?.pages ?? null
  ipcMain.handle('reading:text:get', (_e, hash: string) => (typeof hash === 'string' ? textOf(hash) : null))

  // ---------- 笔记 ----------
  /** 读来接着写回去的（写的时候拿它当 base）：走 vault.read，记成已知 */
  async function readText(rel: string): Promise<string | null> {
    try {
      return (await needVault().read(rel)).text
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }
  /** 只看不写的（右栏笔记、拼给 AI 的话、找空着的名字）：vault.peek，不记成已知，外部改动照常报给开着的编辑器（同 ainote:has） */
  const peekText = (rel: string) => needVault().peek(rel)
  ipcMain.handle('reading:note', async (_e, pdf: unknown) => {
    const src = needSource(pdf)
    // 网页上问的笔记记到中间栏开着的文档或收件箱，不是一篇固定的
    if (isWeb(src)) return { path: '', text: '' }
    const path = notePathFor(src)
    return { path, text: (await peekText(path)) ?? '' }
  })

  // ---------- 问 ----------
  const asking = new Map<number, AbortController>()
  ipcMain.handle('reading:stop', (_e, id: number) => asking.get(id)?.abort())

  async function imagesOf(paths: string[]): Promise<EngineImage[]> {
    const v = needVault()
    return Promise.all(
      paths.map(async (rel) => {
        const abs = v.abs(rel)
        return { mime: /\.jpe?g$/i.test(rel) ? ('image/jpeg' as const) : ('image/png' as const), data: (await readFile(abs)).toString('base64'), path: abs }
      }),
    )
  }

  ipcMain.handle('reading:ask', async (_e, req: AskRequest): Promise<AskResult> => {
    if (!req || typeof req.id !== 'number' || typeof req.text !== 'string' || !IDS.includes(req.engine) || !Array.isArray(req.images)) throw new Error(t('AI 参数不对'))
    const side = req.side
    const optStr = (x: unknown) => x === undefined || (typeof x === 'string' && x.length <= 20_000)
    if (side !== undefined && (!side || typeof side.id !== 'string' || !/^[\w-]{1,80}$/.test(side.id) || typeof side.history !== 'string' || !optStr(side.quote) || !optStr(side.ask) || !optStr(side.title))) throw new Error(t('AI 参数不对'))
    const pdf = needSource(req.pdf)
    const v = needVault()
    const mats = checkMaterials(req.mats)
    if (req.formulas !== undefined && (!Array.isArray(req.formulas) || !req.formulas.every((f) => f && typeof f.name === 'string' && typeof f.what === 'string' && f.what.length <= 200))) throw new Error(t('AI 参数不对'))
    const formulas = req.formulas ?? []
    const ac = new AbortController()
    asking.set(req.id, ac)
    let text = ''
    try {
      const ss = readSessions(pdf)
      // 旁支（CN-90）：有自己的会话就接着聊；第一问从主对话的会话分叉（主对话还没有会话、那一轮在「新对话」之前，就开新的，那一轮补在前面）
      const mine = side ? ss.sides?.[side.id]?.[req.engine] : undefined
      const session = mine ?? (side?.fresh ? undefined : ss.sessions[req.engine])
      const fork = !!side && !mine && !!session
      const pages = textOf(req.hash)
      // 旁支问的是回答里的一句：不再附整份 PDF 的字（分叉来的会话里本来就有）
      const needFull = !side && (!session || ss.fullIn[req.engine] !== session)
      const note = isWeb(pdf) ? '' : ((await peekText(notePathFor(pdf))) ?? '')
      const state = readJson<ReadingState | null>(statePath(pdf), null)
      // 旁支：告诉 AI 被问的那句和它所在的那一轮（第一问）；接着问只说接着这条旁支。引用的材料照样按 ①② 列出
      const prompt = side
        ? sidePrompt({ first: !mine, quote: side.quote ?? req.thread.quote ?? '', page: req.thread.page, ...(side.title ? { title: side.title } : {}), ...(side.ask ? { ask: side.ask } : {}), question: withMaterials(req.text, mats, req.images.length) })
        : askPrompt({
        pdfName: isWeb(pdf) ? (req.thread.web?.title ?? '网页') : stemOf(pdf), // 不翻：给 AI 的话
        ...(req.thread.web ? { web: req.thread.web } : {}),
        ...(req.thread.web?.t !== undefined ? { subs: subsAround(req.thread.web.url, req.thread.web.t) } : {}),
        ...(/\.html?$/i.test(pdf) ? { html: true } : {}),
        page: req.thread.page,
        pages: req.pages,
        pageText: req.pageText,
        // 引用的材料（多段引用方向 B）：字里的 ①②，后面按同一套编号列出每块（图叫「图②」）；框的那块在附图里排第 1，材料里的图接着排
        question: withMaterials(req.text, mats, req.images.length),
        thread: req.thread,
        ...(mats?.some((m) => m.kind === 'image') ? { shot: true } : {}),
        ...(needFull && pages ? { fullText: fullTextOf(pages) } : {}),
        fullPending: !side && !pages && /\.pdf$/i.test(pdf),
        digest: noteDigest(parseReadingNote(note, notePathFor(pdf))),
        // 「附上的图是…」说的是框的那块（或整页）；材料里的图在材料那几行里说（以前不带材料的粘贴的图照旧算）
        hasImage: req.images.length > 0 || (!mats?.length && (req.pasted?.length ?? 0) > 0),
        // 公式那几块的截图排在框的那块、粘贴的图后面
        formulaNote: formulaImagesNote(req.images.length + (req.pasted?.length ?? 0) + 1, formulas.map((f) => f.what)),
      })
      // 能动手（2026-11-19）：和 AI 对话同一套，给我们的工具（库里新建、改名、挪、删笔记……），全能模式开着时命令行自己的工具也全给；
      // 这一问改了的提交一次。外圈、「停下」认负的编号（和 AI 对话的消息编号分开）
      const omni = omniOn()
      const turn = await runAgentTurn({
        id: -req.id,
        engine: req.engine,
        omni,
        ac,
        subject: `读${isWeb(pdf) ? (req.thread.web?.title ?? '网页') : stemOf(pdf)}时：${req.text}`, // 不翻：提交说明（写进 Git）
        emit: (e) => send('reading:event', req.id, e satisfies AskEvent),
        run: {
          ...chatRun(req.engine, req),
          // 开头一行是现在开没开全能模式（系统提示在一个会话里定死了，开关随时会换）
          // 【库里的笔记】（task-3e53q）：提到库里的东西照这里的路径写成链接；读的这份 PDF 列在最前面
          prompt: `${modeLine(omni, req.engine, v.root, req.text)}\n${await vaultNotes(v.root, isWeb(pdf) ? null : { tab: { path: pdf } }, req.text)}\n\n${prompt}${langTail(req.text)}`,
          // 讲透（CN-89）：附在 Claude Code 自己的系统提示后面，带上用户自己的 CLAUDE.md；effort 默认 High（chatRun）
          system: TUTOR_SYSTEM,
          appendSystem: true,
          session,
          ...(fork ? { fork: true } : {}),
          keepSession: true,
          images: [...(await imagesOf(req.images)), ...(await pastedImages(req.pasted)), ...(await pastedImages(formulas.length ? formulas.map((f) => f.name) : undefined))],
          history: side ? side.history : historyOf(state?.msgs ?? [], pages && needFull ? '' : pages ? fullTextOf(pages) : ''),
          onText: (delta) => {
            text += delta
            send('reading:event', req.id, { type: 'text', delta } satisfies AskEvent)
          },
        },
      })
      const done = { ...(turn.commit ? { commit: turn.commit, kinds: turn.kinds } : {}), ...(turn.failed ? { failed: turn.failed, kinds: turn.kinds } : {}), ...(turn.moved ? { moved: turn.moved } : {}) }
      const r = turn.outcome
      if (!r) return { text, error: turn.error ?? t('没有回答'), ...done }
      const next = readSessions(pdf)
      if (r.session && side) next.sides = { ...next.sides, [side.id]: { ...next.sides?.[side.id], [req.engine]: r.session } }
      else if (r.session) {
        next.sessions[req.engine] = r.session
        // 有全文时这个会话一定读过了：要么在这一轮的话里，要么会话接不上、新开时补在前面
        if (pages) next.fullIn[req.engine] = r.session
        else if (r.session !== session) delete next.fullIn[req.engine]
      }
      writeJson(sessionsPath(pdf), next)
      return { text: (r.text || text).replace(/\n{3,}/g, '\n\n'), ...(turn.error ? { error: turn.error } : {}), ...done }
    } catch (e) {
      return { text, error: (e as Error).name === 'AbortError' || ac.signal.aborted ? t('停下了') : String((e as Error).message ?? e) }
    } finally {
      asking.delete(req.id)
    }
  })

  // ---------- 记笔记（2026-11-24 新写法，shared/ai-note.ts）：一问答完、开着「记笔记」时记一问，只往后加 ----------
  /** 同一篇笔记一次只写一样（连着问几处、可视化做好时排队） */
  const queues = new Map<string, Promise<unknown>>()
  function queued<T>(note: string, f: () => Promise<T>): Promise<T> {
    const prev = queues.get(note) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(f)
    queues.set(note, run)
    return run
  }
  // AI 对话写进笔记（新写法、开关）：读 PDF 记一问和别处记一问同一个排队
  const aiNote = setupAiNote({ vault: needVault, readText, send, queued })

  /**
   * 读 PDF、库里的 HTML、网页、视频「接着问」记一问：问的原话（看不懂那一问写回「看不懂：原文」）、回答原文、材料里的图拷进库；
   * 这一处在这篇里第一次记时带上框的图（或选的那段）和来源行；笔记里有这一处旧写法那一段时接在它后面（旧的一字节不动）
   */
  ipcMain.handle('reading:note:ask', (_e, req: NoteAskRequest): Promise<NoteAppendResult> => {
    const src = needSource(req?.src)
    const note = needNote(req.note)
    const th = req.thread
    if (!th || typeof th.id !== 'string' || !req.user || !req.ai || typeof req.ai.id !== 'number' || typeof req.key !== 'string' || !req.place || typeof req.place.heading !== 'string') throw new Error(t('记笔记的参数不对'))
    return queued(note, async () => {
      const cur = (await readText(note)) ?? ''
      const name = threadName(th.id)
      const old = parseReadingNote(cur, note).find((x) => x.id === th.id && !x.doc)
      const mats = await copyMats(src, th, [req.user], [])
      const ask: NoteAsk = {
        key: req.key,
        msg: req.ai.id,
        th: name,
        q: questionOf(req.user.text, old),
        a: answerMd(req.ai.text),
        // 写进文档的 AI 块头不带档（同 AI 讲解）
        ...(req.ai.by ? { by: withoutEffort(req.ai.by) } : {}),
        // AI 标了讲的是论文外的前置知识：小标题末尾带 #前置知识
        ...(req.ai.pre ? { pre: true as const } : {}),
      }
      // 不挂在论文哪一处的前置知识进末尾「前置知识」一节（界面给的标题）：不写回到哪一页的来源行
      const loose = req.place.heading === PREREQ && !req.place.page
      const m = matsOf(req.user.mats, (n) => mats.get(n) ?? '')
      if (m) ask.mats = m
      const files = [...mats.values()]
      if (req.side) ask.side = { quote: req.side.quote, ...(req.side.parent ? { parent: cleanQuestion(req.side.parent) } : {}), of: req.side.of }
      else {
        // 这一处在这篇里第一次记：带上框的图（或选的那段）；接着问的不再放
        const first = !askUnits(cur, note).some((u) => u.ask.th === name && !u.ask.side)
        const crop = first && th.crop && !(old && old.crop) ? th.crop : null
        if (crop) {
          // 不翻：写进文件的图说（cropCaption 给的）
          ask.crop = { path: crop, ...(th.cropW ? { w: th.cropW } : {}), ...(cropCaption(th) !== '我框的' ? { caption: cropCaption(th) } : {}) }
          files.push(crop)
        }
        // 「接着问」（文档里视频问答块、问框带到 AI 标签）的 quote 是上一问的原话，不是选中的那句：不写成引用（带着 web.answer 的就是这两条路）
        else if (first && !old && th.quote?.trim() && !th.web?.answer) ask.quote = th.quote.trim()
        // 来源行：网页那一段、视频那一秒每一问都写（右栏「笔记」认它回网页）；PDF、库里的 HTML 只在这一处第一次记时写（旧写法那段里已经有了不写）
        if (req.from) ask.src = webSrc(note, req.from.label, req.from.url)
        // 贴截图问、没定位或挪过来的：截图不是从那一页截的，不写来源行
        else if (first && !old && !loose && /\.pdf$/i.test(src) && th.page > 0 && th.found !== 'moved') ask.src = pdfSrc(note, src, th.page, th.rect)
        else if (first && !old && !isWeb(src) && !/\.pdf$/i.test(src)) ask.src = webSrc(note, `${stemOf(src)}.html`, src) // 不翻：写进文件的字（文件名）
      }
      return aiNote.appendNow({
        note,
        ask,
        place: { heading: req.place.heading, ...(req.place.page ? { page: req.place.page } : {}), ...(old ? { after: old.id } : {}) },
        ...(req.create ? { create: req.create } : {}),
        ...(req.inline ? { inline: true } : {}),
        files,
        ...(req.pages ? { pages: req.pages } : {}),
      })
    })
  })

  // ---------- 出卡送 Anki（task-tz7y3，cards.ts）：问过的每一问 AI 改成卡、一张张过、送进 Anki；「我的疑惑」那一页 2026-11-22 拿掉了 ----------
  setupCards({ vault: deps.vault, win: deps.win })

  // ---------- 做个可视化（后台） ----------
  ipcMain.handle('reading:viz', async (_e, req: VizRequest): Promise<VizResult> => {
    const pdf = needPdf(req.pdf)
    if (!IDS.includes(req.engine) || !req.thread || typeof req.thread.id !== 'string') throw new Error(t('可视化参数不对'))
    const v = needVault()
    const note = notePathFor(pdf)
    const msgs = req.msgs.filter((m) => m.thread === req.thread.id)
    // 讲到哪了：新格式用这一轮的小结，以前的笔记用讲通的讲法
    const was = parseReadingNote((await peekText(note)) ?? '', note).find((x) => x.id === req.thread.id)
    const good = was?.qas ? was.recap || was.good : was?.good
    const r = await engine(req.engine).run({
      ...modelOpt('chat', req.engine),
      prompt: vizPrompt({ pdfName: stemOf(pdf), thread: req.thread, msgs, pageText: req.pageText, ...(good ? { good } : {}) }),
      system: VIZ_SYSTEM,
      cwd: v.root,
      images: await imagesOf(req.thread.crop ? [req.thread.crop] : []),
      signal: AbortSignal.timeout(VIZ_TIMEOUT),
      onText: () => undefined,
    })
    const raw = extractHtml(r.text)
    if (!raw) throw new Error(t('AI 没做出能打开的网页，再点一次试试'))
    const title = vizTitle(raw, `第 ${req.thread.page} 页的可视化`) // 不翻：写进文件的标题
    const folder = dirOf(pdf)
    const course = courseName(folder)
    const lec = lectureOf(pdf)
    // 不翻：写进文件的属性
    const html = withVizMeta(raw, { 类型: '可视化', 课程: course, 第几讲: lec !== undefined ? String(lec) : '', 来源: `[[${pdf.split('/').pop()}]] 第 ${req.thread.page} 页`, 模型: featureLabel('chat') })
    return queued(note, async () => {
      const path = freeName((n) => `${folder ? folder + '/' : ''}${vizFileStem(title)}${n > 1 ? ` ${n}` : ''}.html`)
      await atomicWrite(v.abs(path), html)
      reserved.delete(path)
      const paths = [path]
      // 挂进笔记：新写法在这一处最后一问的 AI 块后面插一行；旧写法那一段照旧写进那一段；这一处没记进笔记就不挂
      const cur = await readText(note)
      let next = cur
      if (cur) {
        const name = threadName(req.thread.id)
        next = insertAfterAsk(cur, note, name, `![可视化 · ${title.replace(/[[\]]/g, '')}](${linkFrom(note, path)})`) // 不翻：写进笔记的字
        const sec = next === cur ? parseReadingNote(cur, note).find((x) => x.id === req.thread.id && !x.doc) : undefined
        if (sec) next = upsertSection(cur, { ...sec, viz: { path, title, embed: true } }, note)
      }
      if (cur && next && next !== cur) {
        const w = await v.write(note, next, cur)
        if (w.ok) {
          send('note:changed', note, next)
          paths.push(note)
        }
      }
      const hash = await git.commitPaths(v.root, paths, `可视化：${title}（${stemOf(pdf)} 第 ${req.thread.page} 页）`) // 不翻：提交说明
      send('files:changed')
      return { path, title, commit: hash ? ((await git.log(v.root, 1))[0] ?? null) : null }
    })
  })

  /**
   * 材料里的图（软件设置目录 pasted/ 里，不在库里）拷进这份 PDF 的附件：<这一处>-<名字前 8 位>.png（同一张拷过不再拷）。
   * 返回 pasted 名字 → 库里的路径；pasted 里已经没有的那张不写
   */
  async function copyMats(pdf: string, thread: ReadingThread, msgs: ReadingMsg[], sides: ReadingSide[]): Promise<Map<string, string>> {
    const v = needVault()
    const tag = threadName(thread.id).replace(/^.*-(p\d+-\d+)$/, '$1')
    const names = new Set<string>()
    for (const m of [...msgs.filter((x) => x.thread === thread.id), ...sides.flatMap((s) => s.msgs)]) for (const mat of m.mats ?? []) if (mat.kind === 'image' && PASTED_NAME.test(mat.name)) names.add(mat.name)
    const out = new Map<string, string>()
    for (const name of names) {
      const rel = `${attachOf(pdf)}/${tag}-${name.slice(0, 8)}.${name.endsWith('.jpg') ? 'jpg' : 'png'}`
      const abs = v.abs(rel)
      if (!existsSync(abs)) {
        try {
          await mkdir(dirname(abs), { recursive: true })
          await atomicCopy(pastedPath(name), abs)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw e
        }
      }
      out.set(name, rel)
    }
    return out
  }

  ipcMain.handle('reading:commit', async (_e, paths: unknown, message: unknown) => {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string') || typeof message !== 'string') throw new Error(t('提交的参数不对'))
    const v = needVault()
    for (const p of paths as string[]) v.abs(p)
    const hash = await git.commitPaths(v.root, paths as string[], message.slice(0, 200))
    send('files:changed')
    return hash ? ((await git.log(v.root, 1))[0] ?? null) : null
  })
}

export const VIZ_TIMEOUT = 8 * 60_000

/** 会话接不上时补的：全文（这个会话还没读过时已经在话里了，就不重复）和最近几轮 */
function historyOf(msgs: ReadingMsg[], full: string): string | undefined {
  const recent = msgs.filter((m) => m.text.trim() && !m.error).slice(-10)
  const parts: string[] = []
  // 不翻：给 AI 的话
  if (full) parts.push(`整份 PDF 的文字：\n<pdf>\n${full}\n</pdf>`)
  // 不翻：给 AI 的话
  if (recent.length) parts.push(`之前聊过的（供参考）：\n${recent.map((m) => `${m.role === 'user' ? '他' : 'AI'}（第 ${m.page ?? '?'} 页）：${m.text.slice(0, 600)}`).join('\n')}`)
  return parts.length ? parts.join('\n\n') : undefined
}
