/**
 * 读 PDF 边读边问的主进程这一半：
 * - 把库里的 PDF 交给界面（pdf.js 在界面里画），列出库里的 PDF；
 * - 每份 PDF 本机记着上次看到哪页和对话（userData/reading/，不进库）；
 * - 问 AI：框的那块图 + 这一页的文字 + （这个会话第一次）整份 PDF 的文字 + 笔记里已经懂了的；
 * - 后台记笔记：AI 把这一处的问答收成一段，写进 PDF 旁边的「… 笔记.md」，完整对话写进 .canvas-notes/对话/，一次提交。
 */
import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as git from '@cn/git'
import {
  type AskSection,
  attachDirFor,
  clockOf,
  CONVO_DIR,
  lectureOf,
  parsePdfAnchor,
  conversationMd,
  newReadingNote,
  notePathFor,
  parseReadingNote,
  type PdfBlock,
  upsertSection,
  setProp,
  ATTACH_DIR,
  dayOf,
  linkFrom,
  renderSection,
} from '@cn/format'
import { siteOf } from '../../shared/web-reader'
import type { EngineId } from '../../shared/agent'
import type { CommitInfo } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import type { AnkiSendResult, AskEvent, AskRequest, AskResult, DoubtsView, PdfFile, ReadingMsg, ReadingState, SummarizeRequest, SummarizeResult, VizRequest, VizResult, WriteSectionRequest, WriteSectionResult } from '../../shared/reading'
import { engine, FAST_MODEL } from '../agent'
import { E2E } from '../test-mode'
import { pdfHash, type PdfTextCache, textCachePath } from '../pdf-text-cache'
import type { EngineImage } from '../agent/engines'
import type { Vault } from '../vault'
import { askPrompt, extractHtml, fullTextOf, noteDigest, parseSummary, SUMMARY_SYSTEM, summarizePrompt, TUTOR_SYSTEM, versionsOf, VIZ_SYSTEM, vizFileStem, vizPrompt, vizTitle, withVizMeta } from './prompts'
import { AnkiConnectError, sendCards } from './anki'
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
const nameOf = (p: string) => (isWeb(p) ? `网页-${siteOf(p.slice(4))}` : stemOf(p))
const attachOf = (p: string) => (isWeb(p) ? `${ATTACH_DIR}/网页` : attachDirFor(p))

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
  const keyOf = (pdf: string) => createHash('sha1').update(needVault().root + '\0' + pdf).digest('hex').slice(0, 16)
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
  /** 会话号只有主进程写：哪家引擎在用哪个会话、哪个会话读过全文 */
  type Sessions = { sessions: Partial<Record<EngineId, string>>; fullIn: Partial<Record<EngineId, string>> }
  const sessionsPath = (pdf: string) => join(dir, `${keyOf(pdf)}.sessions.json`)
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
  ipcMain.handle('reading:forget', (_e, pdf: unknown) => writeJson(sessionsPath(needSource(pdf)), { sessions: {}, fullIn: {} }))
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
  const freeName = (make: (n: number) => string) => {
    const v = needVault()
    for (let n = 1; ; n++) {
      const p = make(n)
      if (!reserved.has(p) && !existsSync(v.abs(p))) {
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

  ipcMain.handle('reading:thread', (_e, pdf: unknown, page: number) => {
    const p = needSource(pdf)
    return freeName((n) => `${CONVO_DIR}/${nameOf(p)}-p${Math.max(1, Math.floor(page))}-${n}.md`)
  })

  // ---------- 全文（pdf-blocks 拼好的段落块，按内容指纹缓存） ----------
  ipcMain.handle('reading:text:set', (_e, hash: string, pdf: unknown, pages: PdfBlock[][], sizes: [number, number][]) => {
    const p = needPdf(pdf)
    if (typeof hash !== 'string' || !Array.isArray(pages) || !Array.isArray(sizes)) throw new Error('全文不对')
    writeJson(textPath(hash), { pdf: p, pages, sizes } satisfies PdfTextCache)
  })
  const textOf = (hash: string) => readJson<PdfTextCache | null>(textPath(hash), null)?.pages ?? null
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
    const pdf = needSource(req.pdf)
    const v = needVault()
    const ac = new AbortController()
    asking.set(req.id, ac)
    let text = ''
    try {
      const ss = readJson<Sessions>(sessionsPath(pdf), { sessions: {}, fullIn: {} })
      const session = ss.sessions[req.engine]
      const pages = textOf(req.hash)
      const needFull = !session || ss.fullIn[req.engine] !== session
      const note = isWeb(pdf) ? '' : ((await readText(notePathFor(pdf))) ?? '')
      const state = readJson<ReadingState | null>(statePath(pdf), null)
      const prompt = askPrompt({
        pdfName: isWeb(pdf) ? (req.thread.web?.title ?? '网页') : stemOf(pdf),
        ...(req.thread.web ? { web: req.thread.web } : {}),
        ...(/\.html?$/i.test(pdf) ? { html: true } : {}),
        page: req.thread.page,
        pages: req.pages,
        pageText: req.pageText,
        question: req.text,
        thread: req.thread,
        ...(needFull && pages ? { fullText: fullTextOf(pages) } : {}),
        fullPending: !pages && /\.pdf$/i.test(pdf),
        digest: noteDigest(parseReadingNote(note, notePathFor(pdf))),
        hasImage: req.images.length > 0,
      })
      const r = await engine(req.engine).run({
        prompt,
        system: TUTOR_SYSTEM,
        cwd: v.root,
        session,
        keepSession: true,
        images: await imagesOf(req.images),
        history: historyOf(state?.msgs ?? [], pages && needFull ? '' : pages ? fullTextOf(pages) : ''),
        signal: ac.signal,
        onText: (delta) => {
          text += delta
          send('reading:event', req.id, { type: 'text', delta } satisfies AskEvent)
        },
      })
      const next: Sessions = readJson<Sessions>(sessionsPath(pdf), { sessions: {}, fullIn: {} })
      if (r.session) {
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
  async function noteTitles(): Promise<string[]> {
    return (await needVault().list()).map((n) => titleOf(n.path))
  }

  ipcMain.handle('reading:summarize', async (_e, req: SummarizeRequest): Promise<SummarizeResult> => {
    const pdf = needSource(req.pdf)
    const v = needVault()
    const msgs = req.msgs.filter((m) => m.thread === req.thread.id)
    const { answers, failed } = versionsOf(msgs)
    const titles = (await noteTitles()).filter((t) => t !== `${stemOf(pdf)} 笔记`)
    const id = IDS.includes(req.engine) ? req.engine : 'claude'
    let raw = ''
    try {
      const r = await engine(id).run({
        prompt: summarizePrompt({ pdfName: req.thread.web?.title ?? stemOf(pdf), thread: req.thread, msgs, blocks: req.blocks, failed, titles }),
        system: SUMMARY_SYSTEM,
        cwd: v.root,
        ...(id === 'claude' ? { model: FAST_MODEL } : {}),
        signal: AbortSignal.timeout(180_000),
        onText: () => undefined,
      })
      raw = r.text
    } catch (e) {
      // 收不成就用对话本身兜一段，原因写进日志；这一处问过的照样记上
      console.error('收笔记段失败', e)
    }
    const p = parseSummary(raw, { thread: req.thread, msgs, failed, titles, blocks: req.blocks })
    const first = msgs[0]
    const section: AskSection = {
      id: req.thread.id,
      file: isWeb(pdf) ? '' : pdf,
      page: req.thread.page,
      ...(req.thread.web ? { web: { url: req.thread.web.url, label: /^https?:/i.test(req.thread.web.url) ? siteOf(req.thread.web.url) : (req.thread.web.url.split('/').pop() ?? '') } } : {}),
      ...(req.thread.rect ? { rect: req.thread.rect } : {}),
      title: p.title,
      time: clockOf(new Date(first?.time ?? req.thread.createdAt)),
      ...(req.thread.crop ? { crop: req.thread.crop } : {}),
      figures: [],
      doubts: p.doubts,
      good: p.good,
      ...(failed.length ? { goodVersion: answers.length } : {}),
      points: p.points,
      failed: failed.map((ver) => ({ version: ver, line: p.failedLines[ver] ?? '', text: answers[ver - 1]?.text ?? '' })),
      rounds: msgs.filter((m) => m.role === 'user').length,
      links: p.links,
    }
    return { section, ...(p.figure ? { figure: { block: p.figure, caption: p.figureCaption ?? '' } } : {}) }
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
        question: it.section.doubts[0] ?? it.section.title,
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
    const good = parseReadingNote((await readText(note)) ?? '', note).find((x) => x.id === req.thread.id)?.good
    const r = await engine(req.engine).run({
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
    const html = withVizMeta(raw, { 类型: '可视化', 课程: course, 第几讲: lec !== undefined ? String(lec) : '', 来源: `[[${pdf.split('/').pop()}]] 第 ${req.thread.page} 页` })
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

  async function writeSection(req: WriteSectionRequest, note: string): Promise<WriteSectionResult> {
    const v = needVault()
    const pdf = req.pdf
    const s: AskSection = { ...req.section, id: req.thread.id, file: isWeb(pdf) ? '' : pdf, figures: [...req.section.figures] }
    const viz = pendingViz.get(s.id)
    if (viz) s.viz = viz
    const paths = [note, s.id]
    if (req.figurePng instanceof Uint8Array && req.figurePng.length) {
      const fig = `${attachDirFor(pdf)}/${stemOf(s.id).replace(/^.*-(p\d+-\d+)$/, '$1')}-fig.png`
      await mkdir(dirname(v.abs(fig)), { recursive: true })
      await writeFile(v.abs(fig), req.figurePng)
      const caption = s.figures[0]?.caption
      s.figures = [{ path: fig, caption: caption || `第 ${s.page} 页的图` }]
      paths.push(fig)
    }
    for (const m of req.msgs) if (m.thread === s.id && m.image) paths.push(m.image)
    if (s.crop) paths.push(s.crop)
    // 笔记里用户自己没提交的字先单独提交，这次提交里只有 AI 记的这一段
    const pending = (await git.status(v.root)).filter((x) => x.path === note)
    if (pending.length) await git.commitPaths(v.root, [note], git.describeChanges(pending))
    // 收件箱这类文件夹可能还没有
    await mkdir(dirname(v.abs(note)), { recursive: true })
    for (let tries = 0; ; tries++) {
      const cur = await readText(note)
      const base = cur ?? ''
      // 已经挂上的可视化留着（这一轮 AI 收的那段不知道它）
      const old = parseReadingNote(base, note).find((x) => x.id === s.id)
      if (!s.viz && old?.viz) s.viz = old.viz
      let next = upsertSection(cur ?? (isWeb(pdf) ? newWebNote(req.thread.web) : newReadingNote(pdf)), s, note)
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
    const turns = req.msgs
      .filter((m) => m.thread === s.id && m.text.trim() && !m.error)
      .map((m: ReadingMsg) => ({ role: m.role, text: m.text, time: clockOf(new Date(m.time)), ...(m.image ? { image: m.image } : {}) }))
    const convoAbs = v.abs(s.id)
    await mkdir(dirname(convoAbs), { recursive: true })
    await writeFile(convoAbs, s.web ? webConversationMd(s, turns) : conversationMd(s.id, pdf, s.page, s.rect, turns))
    reserved.delete(s.id)
    pendingViz.delete(s.id)
    const doubts = isWeb(pdf) ? null : await writeDoubtsNote(v, dirOf(pdf))
    if (doubts) paths.push(doubts)
    const hash = await git.commitPaths(v.root, [...new Set(paths)], `笔记：${isWeb(pdf) ? (req.thread.web?.title ?? '网页') : stemOf(pdf)}${s.page > 0 ? ` 第 ${s.page} 页` : ''} · ${s.title}`)
    let commit: CommitInfo | null = null
    if (hash) commit = (await git.log(v.root, 1))[0] ?? null
    send('files:changed')
    return { note, commit }
  }

  /** 网页上问的、中间栏开着文档：完整对话写好，这一段的 md 交回界面插到光标处（界面存好后再一起提交） */
  async function writeWebToDoc(req: WriteSectionRequest, doc: string): Promise<WriteSectionResult> {
    const v = needVault()
    v.abs(doc)
    const s: AskSection = { ...req.section, id: req.thread.id, file: '', figures: [...req.section.figures] }
    const turns = req.msgs
      .filter((m) => m.thread === s.id && m.text.trim() && !m.error)
      .map((m: ReadingMsg) => ({ role: m.role, text: m.text, time: clockOf(new Date(m.time)), ...(m.image ? { image: m.image } : {}) }))
    const convoAbs = v.abs(s.id)
    await mkdir(dirname(convoAbs), { recursive: true })
    await writeFile(convoAbs, webConversationMd(s, turns))
    reserved.delete(s.id)
    const files = [s.id, ...(s.crop ? [s.crop] : []), ...req.msgs.flatMap((m) => (m.thread === s.id && m.image ? [m.image] : []))]
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

/** 网页、HTML 上问的完整对话：头上回到网页（或 HTML）的链接 */
function webConversationMd(s: AskSection, turns: { role: 'user' | 'ai'; text: string; time?: string; image?: string }[]): string {
  const w = s.web!
  const href = /^https?:/i.test(w.url) ? w.url : linkFrom(s.id, w.url)
  const out = [`# ${w.label} · ${s.title} · 完整对话`, '', `[回到 ${w.label}](${href})`]
  for (const t of turns) {
    out.push('', `### ${t.role === 'user' ? '我' : 'AI'}${t.time ? ` · ${t.time}` : ''}`, '')
    if (t.image) out.push(`![我框的](${linkFrom(s.id, t.image)})`, '')
    out.push(t.text.trim())
  }
  return out.join('\n') + '\n'
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
