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
import { checkMaterials, PASTED_NAME, withMaterials } from '../../shared/materials'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as git from '@cn/git'
import {
  type AskSection,
  attachDirFor,
  CONVO_DIR,
  lectureOf,
  parsePdfAnchor,
  newReadingNote,
  notePathFor,
  parseReadingNote,
  type PdfBlock,
  upsertSection,
  setProp,
  ATTACH_DIR,
  dayOf,
  renderSection,
  threadName,
} from '@cn/format'
import { siteOf } from '../../shared/web-reader'
import { fmtTime, videoOf } from '../../shared/video'
import { subsAround } from '../video'
import type { EngineId } from '../../shared/agent'
import type { CommitInfo } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import type { AnkiSendResult, AskEvent, AskRequest, AskResult, DoubtsView, PdfFile, ReadingMsg, ReadingSide, ReadingState, ReadingThread, SummarizeRequest, SummarizeResult, VizRequest, VizResult, WriteSectionRequest, WriteSectionResult } from '../../shared/reading'
import { chatRun, engine, FAST_MODEL, featureLabel, modelOpt } from '../agent'
import { E2E } from '../test-mode'
import { pdfHash, type PdfTextCache, readTextCache, textCachePath } from '../pdf-text-cache'
import type { EngineImage } from '../agent/engines'
import type { Vault } from '../vault'
import { askPrompt, extractHtml, fullTextOf, noteDigest, parseSummary, sidePrompt, SUMMARY_SYSTEM, summarizePrompt, TUTOR_SYSTEM, TUTOR_VERSION, VIZ_SYSTEM, vizFileStem, vizPrompt, vizTitle, withVizMeta } from './prompts'
import { buildSection, roundText } from './section'
import { AnkiConnectError, sendCards } from './anki'
import { readingKey } from './chats'
import { setupBilingual } from './bilingual'
import { setupCapture } from './capture'
import { ANKI_STATE, collectDoubts, courseName, dirOf, readAnkiState, writeAnkiState, writeDoubtsNote } from './doubts'

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
  if (typeof path !== 'string' || !/\.pdf$/i.test(path)) throw new Error('不是 PDF')
  return path
}

/**
 * 边读边问的来源：库里的 PDF、库里的 HTML（中间栏开着的可视化），或「web:<网址>」（右栏网页上框着问、中间栏没开 PDF 时）
 */
function needSource(path: unknown): string {
  if (typeof path !== 'string' || !(/\.(pdf|html?)$/i.test(path) || /^web:https?:\/\//i.test(path))) throw new Error('不是 PDF、HTML 或网页')
  return path
}
const isWeb = (p: string) => p.startsWith('web:')
/** 截图、完整对话文件名用的名字 */
/** 截图、完整对话的文件名前缀：PDF 名；网页是「网页-域名」，视频是「视频-youtube-视频号」 */
function nameOf(p: string): string {
  if (!isWeb(p)) return stemOf(p)
  const v = videoOf(p.slice(4))
  return v ? `视频-${v.site}-${v.id}${v.p && v.p > 1 ? `-p${v.p}` : ''}` : `网页-${siteOf(p.slice(4))}`
}

/** 笔记那段第二行的来源：视频「接着问」写「▶ 00:06 · 视频名」（和那块问答一样），网页写域名，HTML 写文件名 */
function webSource(web: { url: string; title: string; t?: number }): { url: string; label: string; t?: number } {
  if (web.t !== undefined) return { url: web.url, label: `▶ ${fmtTime(web.t)} · ${web.title}`, t: web.t }
  return { url: web.url, label: /^https?:/i.test(web.url) ? siteOf(web.url) : (web.url.split('/').pop() ?? '') }
}
const attachOf = (p: string) => (isWeb(p) ? `${ATTACH_DIR}/网页` : attachDirFor(p))


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
    if (!v) throw new Error('还没有打开库')
    return v
  }
  const send = (ch: string, ...args: unknown[]) => deps.win()?.webContents.send(ch, ...args)
  setupBilingual({ vault: deps.vault, send })
  setupCapture(deps.win)

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
    writeFileSync(p + '.tmp', JSON.stringify(v))
    renameSync(p + '.tmp', p)
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
  ipcMain.handle('reading:listPdfs', async (): Promise<PdfFile[]> => {
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
    if (st.size > MAX_PDF) throw new Error(`这份 PDF 有 ${Math.round(st.size / 1024 / 1024)} MB，太大了打不开`)
    const data = await readFile(abs)
    return { data: new Uint8Array(data), hash: pdfHash(data) }
  })

  // Anki 卡背面「打开原文」：canvas-notes://open?file=<库里的路径>&page=5&rect=…，打开这份 PDF 翻到那一页
  const openAt = (raw: string) => {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return
    }
    if (u.protocol !== 'canvas-notes:' || u.hostname !== 'open') return
    const file = u.searchParams.get('file') ?? ''
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
    if (typeof path !== 'string' || !/\.html?$/i.test(path)) throw new Error('不是 HTML')
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
    const s = readJson<ReadingState | null>(statePath(p), null)
    return s && s.pdf === p ? s : { pdf: p, page: 1, msgs: [], threads: [] }
  })
  ipcMain.handle('reading:state:save', (_e, s: ReadingState) => {
    if (!s || !Array.isArray(s.msgs) || !Array.isArray(s.threads)) throw new Error('读 PDF 的记录不对')
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
    if (!(png instanceof Uint8Array) || png.length > 20 * 1024 * 1024) throw new Error('截图不对')
    const rel = freeName((n) => `${attachOf(p)}/${isWeb(p) ? `${nameOf(p).slice(3)}-` : ''}p${Math.max(1, Math.floor(page))}-${n}.png`)
    const abs = needVault().abs(rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, png)
    reserved.delete(rel)
    return rel
  })

  ipcMain.handle('reading:thread', async (_e, pdf: unknown, page: number) => {
    const p = needSource(pdf)
    // 以前问过的几处（笔记里的各段、对话记录里的）都算用掉了：完整对话不再写成文件，光看文件在不在会撞到老的那一段
    const taken = new Set(readJson<ReadingState | null>(statePath(p), null)?.threads.map((t) => t.id) ?? [])
    if (!isWeb(p)) for (const s of parseReadingNote((await readText(notePathFor(p))) ?? '', notePathFor(p))) taken.add(s.id)
    // 视频没有页码：「视频-youtube-视频号-1.md」
    return freeName((n) => `${CONVO_DIR}/${nameOf(p)}${isWeb(p) && videoOf(p.slice(4)) ? '' : `-p${Math.max(1, Math.floor(page))}`}-${n}.md`, taken)
  })

  // ---------- 全文（pdf-blocks 拼好的段落块，按内容指纹缓存） ----------
  ipcMain.handle('reading:text:set', (_e, hash: string, pdf: unknown, pages: PdfBlock[][], sizes: [number, number][]) => {
    const p = needPdf(pdf)
    if (typeof hash !== 'string' || !Array.isArray(pages) || !Array.isArray(sizes)) throw new Error('全文不对')
    writeJson(textPath(hash), { pdf: p, pages, sizes } satisfies PdfTextCache)
  })
  const textOf = (hash: string) => readTextCache(app.getPath('userData'), hash)?.pages ?? null
  ipcMain.handle('reading:text:get', (_e, hash: string) => (typeof hash === 'string' ? textOf(hash) : null))

  // ---------- 笔记 ----------
  async function readText(rel: string): Promise<string | null> {
    try {
      return (await needVault().read(rel)).text
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }
  ipcMain.handle('reading:note', async (_e, pdf: unknown) => {
    const src = needSource(pdf)
    // 网页上问的笔记记到中间栏开着的文档或收件箱，不是一篇固定的
    if (isWeb(src)) return { path: '', text: '' }
    const path = notePathFor(src)
    return { path, text: (await readText(path)) ?? '' }
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
    if (!req || typeof req.id !== 'number' || typeof req.text !== 'string' || !IDS.includes(req.engine) || !Array.isArray(req.images)) throw new Error('AI 参数不对')
    const side = req.side
    const optStr = (x: unknown) => x === undefined || (typeof x === 'string' && x.length <= 20_000)
    if (side !== undefined && (!side || typeof side.id !== 'string' || !/^[\w-]{1,80}$/.test(side.id) || typeof side.history !== 'string' || !optStr(side.quote) || !optStr(side.ask) || !optStr(side.title))) throw new Error('AI 参数不对')
    const pdf = needSource(req.pdf)
    const v = needVault()
    const mats = checkMaterials(req.mats)
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
      const note = isWeb(pdf) ? '' : ((await readText(notePathFor(pdf))) ?? '')
      const state = readJson<ReadingState | null>(statePath(pdf), null)
      // 旁支：告诉 AI 被问的那句和它所在的那一轮（第一问）；接着问只说接着这条旁支。引用的材料照样按 ①② 列出
      const prompt = side
        ? sidePrompt({ first: !mine, quote: side.quote ?? req.thread.quote ?? '', page: req.thread.page, ...(side.title ? { title: side.title } : {}), ...(side.ask ? { ask: side.ask } : {}), question: withMaterials(req.text, mats, req.images.length) })
        : askPrompt({
        pdfName: isWeb(pdf) ? (req.thread.web?.title ?? '网页') : stemOf(pdf),
        ...(req.thread.web ? { web: req.thread.web } : {}),
        ...(req.thread.web?.t !== undefined ? { subs: subsAround(req.thread.web.url, req.thread.web.t) } : {}),
        ...(/\.html?$/i.test(pdf) ? { html: true } : {}),
        page: req.thread.page,
        pages: req.pages,
        pageText: req.pageText,
        // 引用的材料（多段引用方向 B）：字里的 ①②，后面按同一套编号列出每块（图叫「图②」）；框的那块在附图里排第 1，材料里的图接着排
        question: withMaterials(req.text, mats, req.images.length),
        thread: req.thread,
        ...(needFull && pages ? { fullText: fullTextOf(pages) } : {}),
        fullPending: !side && !pages && /\.pdf$/i.test(pdf),
        digest: noteDigest(parseReadingNote(note, notePathFor(pdf))),
        // 「附上的图是…」说的是框的那块（或整页）；材料里的图在材料那几行里说（以前不带材料的粘贴的图照旧算）
        hasImage: req.images.length > 0 || (!mats?.length && (req.pasted?.length ?? 0) > 0),
      })
      const r = await engine(req.engine).run({
        ...chatRun(req.engine, req),
        prompt,
        // 讲透（CN-89）：附在 Claude Code 自己的系统提示后面，带上用户自己的 CLAUDE.md；effort 默认 High（chatRun）
        system: TUTOR_SYSTEM,
        appendSystem: true,
        cwd: v.root,
        session,
        ...(fork ? { fork: true } : {}),
        keepSession: true,
        images: [...(await imagesOf(req.images)), ...(await pastedImages(req.pasted))],
        history: side ? side.history : historyOf(state?.msgs ?? [], pages && needFull ? '' : pages ? fullTextOf(pages) : ''),
        signal: ac.signal,
        onText: (delta) => {
          text += delta
          send('reading:event', req.id, { type: 'text', delta } satisfies AskEvent)
        },
      })
      const next = readSessions(pdf)
      if (r.session && side) next.sides = { ...next.sides, [side.id]: { ...next.sides?.[side.id], [req.engine]: r.session } }
      else if (r.session) {
        next.sessions[req.engine] = r.session
        // 有全文时这个会话一定读过了：要么在这一轮的话里，要么会话接不上、新开时补在前面
        if (pages) next.fullIn[req.engine] = r.session
        else if (r.session !== session) delete next.fullIn[req.engine]
      }
      writeJson(sessionsPath(pdf), next)
      return { text: (r.text || text).replace(/\n{3,}/g, '\n\n') }
    } catch (e) {
      return { text, error: (e as Error).name === 'AbortError' || ac.signal.aborted ? '停下了' : String((e as Error).message ?? e) }
    } finally {
      asking.delete(req.id)
    }
  })

  // ---------- 后台记笔记 ----------
  /** 界面给的旁支（对话记录里的那几条）：只收这一处的，形状不对的不收 */
  const sidesOf = (sides: unknown, thread: string): ReadingSide[] => {
    if (sides === undefined) return []
    if (!Array.isArray(sides)) throw new Error('旁支不对')
    return (sides as ReadingSide[]).filter((s) => s && s.thread === thread && typeof s.quote === 'string' && Array.isArray(s.msgs))
  }

  // 后台的两件小活（CN-93、94、96）：这一轮的标题和一句小结，给快的模型；问题、回答原样写，不再让 AI 写疑惑、讲通的讲法、要点
  ipcMain.handle('reading:summarize', async (_e, req: SummarizeRequest): Promise<SummarizeResult> => {
    const pdf = needSource(req.pdf)
    const v = needVault()
    const msgs = req.msgs.filter((m) => m.thread === req.thread.id)
    const id = IDS.includes(req.engine) ? req.engine : 'claude'
    const title = typeof req.title === 'string' ? req.title : undefined
    let raw = ''
    try {
      const r = await engine(id).run({
        prompt: summarizePrompt({ pdfName: req.thread.web?.title ?? stemOf(pdf), thread: req.thread, round: roundText(msgs, sidesOf(req.sides, req.thread.id)), blocks: req.blocks, ...(title ? { title } : {}) }),
        system: SUMMARY_SYSTEM,
        cwd: v.root,
        ...(id === 'claude' ? { model: FAST_MODEL } : {}),
        signal: AbortSignal.timeout(180_000),
        onText: () => undefined,
      })
      raw = r.text
    } catch (e) {
      // 写不成就用原来的标题、最后一个回答的开头兜着，原因写进日志；这一处问过的照样记上
      console.error('写标题和小结失败', e)
    }
    return parseSummary(raw, { thread: req.thread, msgs, ...(title ? { title } : {}) })
  })

  /** 同一篇笔记一次只写一样（连着问几处、可视化做好时排队） */
  const queues = new Map<string, Promise<unknown>>()
  function queued<T>(note: string, f: () => Promise<T>): Promise<T> {
    const prev = queues.get(note) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(f)
    queues.set(note, run)
    return run
  }
  ipcMain.handle('reading:section', (_e, req: WriteSectionRequest) => {
    const src = needSource(req.pdf)
    if (isWeb(src)) {
      // 网页上问的：中间栏开着文档就交回 md 让界面插到光标处；没开就进收件箱那篇
      if (req.target?.kind === 'doc') return writeWebToDoc(req, req.target.path)
      const note = webNotePath(req.thread.web?.title ?? '网页')
      return queued(note, () => writeSection(req, note))
    }
    const note = notePathFor(src)
    return queued(note, () => writeSection(req, note))
  })
  /** 可视化做好时笔记里还没有那一段：先记着，写那一段时挂上 */
  const pendingViz = new Map<string, { path: string; title: string }>()

  // ---------- 我的疑惑、送 Anki ----------
  const needFolder = (f: unknown) => {
    if (typeof f !== 'string') throw new Error('文件夹不对')
    if (f) needVault().abs(f)
    return f
  }
  ipcMain.handle('reading:doubts', async (_e, folder: unknown): Promise<DoubtsView> => {
    const f = needFolder(folder)
    const v = needVault()
    const [items, st] = await Promise.all([collectDoubts(v, f), readAnkiState(v)])
    return { folder: f, course: courseName(f), items: items.map((it) => ({ ...it, sent: !!st.sent[it.id] })) }
  })

  ipcMain.handle('reading:anki:send', async (_e, folder: unknown, ids: unknown): Promise<AnkiSendResult> => {
    const f = needFolder(folder)
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new Error('要送的卡不对')
    const v = needVault()
    const want = new Set(ids as string[])
    const items = (await collectDoubts(v, f)).filter((it) => want.has(it.id))
    const course = courseName(f)
    const cards = await Promise.all(
      items.map(async (it) => ({
        id: it.id,
        pdf: it.pdf,
        course,
        section: it.section,
        // 问题是发出去的原话（新格式一问一张），旁支那一问带着被问的那句
        question: it.section.doubts[0] ?? it.section.title,
        ...(it.quote ? { quote: it.quote } : {}),
        ...(it.section.crop ? { png: await readFile(v.abs(it.section.crop)).catch(() => undefined) } : {}),
      })),
    )
    const st = await readAnkiState(v)
    let r
    try {
      r = await sendCards(cards, st.deckId)
    } catch (e) {
      if (e instanceof AnkiConnectError) return { added: [], duplicates: [], failed: {}, error: e.message, commit: null }
      throw e
    }
    const now = new Date().toISOString()
    for (const id of [...r.added, ...r.duplicates]) st.sent[id] = now
    st.deckId = r.deck.id
    await writeAnkiState(v, st)
    const doubts = await writeDoubtsNote(v, f)
    const hash = await git.commitPaths(v.root, [ANKI_STATE, ...(doubts ? [doubts] : [])], `送进 Anki：${course || '我的疑惑'} ${r.added.length} 张`)
    send('files:changed')
    return { added: r.added, duplicates: r.duplicates, failed: r.failed, deck: r.deck.name, commit: hash ? ((await git.log(v.root, 1))[0] ?? null) : null }
  })

  // ---------- 做个可视化（后台） ----------
  ipcMain.handle('reading:viz', async (_e, req: VizRequest): Promise<VizResult> => {
    const pdf = needPdf(req.pdf)
    if (!IDS.includes(req.engine) || !req.thread || typeof req.thread.id !== 'string') throw new Error('可视化参数不对')
    const v = needVault()
    const note = notePathFor(pdf)
    const msgs = req.msgs.filter((m) => m.thread === req.thread.id)
    // 讲到哪了：新格式用这一轮的小结，以前的笔记用讲通的讲法
    const was = parseReadingNote((await readText(note)) ?? '', note).find((x) => x.id === req.thread.id)
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
    if (!raw) throw new Error('AI 没做出能打开的网页，再点一次试试')
    const title = vizTitle(raw, `第 ${req.thread.page} 页的可视化`)
    const folder = dirOf(pdf)
    const course = courseName(folder)
    const lec = lectureOf(pdf)
    const html = withVizMeta(raw, { 类型: '可视化', 课程: course, 第几讲: lec !== undefined ? String(lec) : '', 来源: `[[${pdf.split('/').pop()}]] 第 ${req.thread.page} 页`, 模型: featureLabel('chat') })
    return queued(note, async () => {
      const path = freeName((n) => `${folder ? folder + '/' : ''}${vizFileStem(title)}${n > 1 ? ` ${n}` : ''}.html`)
      await writeFile(v.abs(path), html)
      reserved.delete(path)
      const paths = [path]
      const cur = await readText(note)
      const sec = cur ? parseReadingNote(cur, note).find((x) => x.id === req.thread.id) : undefined
      if (cur && sec) {
        const next = upsertSection(cur, { ...sec, viz: { path, title } }, note)
        const w = await v.write(note, next, cur)
        if (w.ok) {
          send('note:changed', note, next)
          paths.push(note)
        }
      } else pendingViz.set(req.thread.id, { path, title })
      const hash = await git.commitPaths(v.root, paths, `可视化：${title}（${stemOf(pdf)} 第 ${req.thread.page} 页）`)
      send('files:changed')
      return { path, title, commit: hash ? ((await git.log(v.root, 1))[0] ?? null) : null }
    })
  })

  /** 答完马上先写的那一次没提交：等标题、小结写好的那一次一起提交，不当成用户自己改的字先提交掉 */
  const unsaved = new Set<string>()

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
          await copyFile(pastedPath(name), abs)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw e
        }
      }
      out.set(name, rel)
    }
    return out
  }

  /**
   * 写笔记里这一处的那一段（新格式）：问题原话、回答原文、旁支挂在被问那一问后面；标题和小结用这一次给的，
   * 没给（答完马上先写的那一次）用笔记里原来那段的。笔记里原来那段的双链、可视化、配的图留着
   */
  async function writeSection(req: WriteSectionRequest, note: string): Promise<WriteSectionResult> {
    const v = needVault()
    const pdf = req.pdf
    const th = req.thread
    const sides = sidesOf(req.sides, th.id)
    const mats = await copyMats(pdf, th, req.msgs, sides)
    const paths = [note, ...mats.values()]
    let fig: { path: string; caption: string } | null = null
    if (req.figurePng instanceof Uint8Array && req.figurePng.length) {
      fig = { path: `${attachDirFor(pdf)}/${threadName(th.id).replace(/^.*-(p\d+-\d+)$/, '$1')}-fig.png`, caption: req.figureCaption || `第 ${th.page} 页的图` }
      await mkdir(dirname(v.abs(fig.path)), { recursive: true })
      await writeFile(v.abs(fig.path), req.figurePng)
      paths.push(fig.path)
    }
    for (const m of req.msgs) if (m.thread === th.id && m.image) paths.push(m.image)
    if (th.crop) paths.push(th.crop)
    // 笔记里用户自己没提交的字先单独提交，这次提交里只有记的这一段（答完马上先写、还没提交的那一次不算用户的）
    if (!unsaved.has(note)) {
      const pending = (await git.status(v.root)).filter((x) => x.path === note)
      if (pending.length) await git.commitPaths(v.root, [note], git.describeChanges(pending))
    }
    // 收件箱这类文件夹可能还没有
    await mkdir(dirname(v.abs(note)), { recursive: true })
    const fallback = parseSummary('', { thread: th, msgs: req.msgs.filter((m) => m.thread === th.id) })
    let s: AskSection | null = null
    for (let tries = 0; ; tries++) {
      const cur = await readText(note)
      const base = cur ?? ''
      const old = parseReadingNote(base, note).find((x) => x.id === th.id) ?? null
      s = buildSection({
        pdf,
        thread: th,
        msgs: req.msgs,
        sides,
        title: req.title ?? old?.title ?? fallback.title,
        recap: req.recap ?? (old?.qas ? old.recap : undefined) ?? fallback.recap,
        old,
        ...(th.web ? { web: webSource(th.web) } : {}),
        matPath: (n) => mats.get(n) ?? '',
      })
      const viz = pendingViz.get(th.id)
      if (viz) s.viz = viz
      if (fig) s.figures = [fig]
      let next = upsertSection(cur ?? (isWeb(pdf) ? newWebNote(th.web) : newReadingNote(pdf)), s, note)
      // 进度：问到第几页（问过的最大页码）/ 一共几页
      if (req.pages > 0) next = setProp(next, '进度', `${Math.max(...parseReadingNote(next, note).map((x) => x.page))}/${req.pages}`)
      const w = await v.write(note, next, base)
      if (w.ok) {
        // 主进程自己写的监听不到；开着这篇的编辑器按外部改动合并
        if (next !== base) send('note:changed', note, next)
        break
      }
      if (tries >= 2) throw new Error('笔记刚被改过，写不进去，等一下再问一轮会再记')
    }
    pendingViz.delete(th.id)
    if (req.commit === false) {
      unsaved.add(note)
      return { note, commit: null }
    }
    unsaved.delete(note)
    const doubts = isWeb(pdf) ? null : await writeDoubtsNote(v, dirOf(pdf))
    if (doubts) paths.push(doubts)
    const hash = await git.commitPaths(v.root, [...new Set(paths)], `笔记：${isWeb(pdf) ? (th.web?.title ?? '网页') : stemOf(pdf)}${th.page > 0 ? ` 第 ${th.page} 页` : ''} · ${s.title}`)
    let commit: CommitInfo | null = null
    if (hash) commit = (await git.log(v.root, 1))[0] ?? null
    send('files:changed')
    return { note, commit }
  }

  /** 网页上问的、中间栏开着文档：这一段的 md（新格式）交回界面插到光标处（界面存好后再一起提交） */
  async function writeWebToDoc(req: WriteSectionRequest, doc: string): Promise<WriteSectionResult> {
    const v = needVault()
    v.abs(doc)
    const th = req.thread
    const sides = sidesOf(req.sides, th.id)
    const mats = await copyMats(req.pdf, th, req.msgs, sides)
    const fallback = parseSummary('', { thread: th, msgs: req.msgs.filter((m) => m.thread === th.id) })
    const s = buildSection({ pdf: req.pdf, thread: th, msgs: req.msgs, sides, title: req.title ?? fallback.title, recap: req.recap ?? fallback.recap, ...(th.web ? { web: webSource(th.web) } : {}), matPath: (n) => mats.get(n) ?? '' })
    const files = [...(s.crop ? [s.crop] : []), ...mats.values(), ...req.msgs.flatMap((m) => (m.thread === th.id && m.image ? [m.image] : []))]
    return { note: doc, commit: null, markdown: renderSection(s, doc), files: [...new Set(files)] }
  }

  ipcMain.handle('reading:commit', async (_e, paths: unknown, message: unknown) => {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string') || typeof message !== 'string') throw new Error('提交的参数不对')
    const v = needVault()
    for (const p of paths as string[]) v.abs(p)
    const hash = await git.commitPaths(v.root, paths as string[], message.slice(0, 200))
    send('files:changed')
    return hash ? ((await git.log(v.root, 1))[0] ?? null) : null
  })
}

/** 网页上问、中间栏没开文档时记进的那篇：收件箱/<网页标题> 笔记.md */
function webNotePath(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '网页'
  return `收件箱/${safe} 笔记.md`
}

/** 收件箱里新的网页笔记开头：类型 笔记、来源网址、日期 */
function newWebNote(web: { url: string; title: string } | undefined): string {
  let t = setProp('', '类型', '笔记')
  if (web) t = setProp(t, '来源', web.url)
  t = setProp(t, '日期', dayOf(new Date()))
  return `${t}\n# ${web?.title ?? '网页'} 笔记\n`
}

export const VIZ_TIMEOUT = 8 * 60_000

/** 会话接不上时补的：全文（这个会话还没读过时已经在话里了，就不重复）和最近几轮 */
function historyOf(msgs: ReadingMsg[], full: string): string | undefined {
  const recent = msgs.filter((m) => m.text.trim() && !m.error).slice(-10)
  const parts: string[] = []
  if (full) parts.push(`整份 PDF 的文字：\n<pdf>\n${full}\n</pdf>`)
  if (recent.length) parts.push(`之前聊过的（供参考）：\n${recent.map((m) => `${m.role === 'user' ? '他' : 'AI'}（第 ${m.page ?? '?'} 页）：${m.text.slice(0, 600)}`).join('\n')}`)
  return parts.length ? parts.join('\n\n') : undefined
}
