/**
 * PDF 上划线、读到哪（ParaRead 联动，设计 20-pararead联动，2026-11-23 用户定）的主进程这一半：
 * - 划线写进 PDF 旁边那篇配对笔记（写法在 @cn/format 的 highlights.ts，ParaRead 调同一份）：一条一行进「第 N 页 · 划的线」，
 *   看不懂写成一段问题段；一次一个提交；
 * - 含义表（键、名字、颜色）在库里 .canvas-notes/划线颜色.json，改名时问一次「把已写的 N 处一起改」再换那几行的名字；
 * - 读到哪：库里 .canvas-notes/读到哪.json（两个软件读写同一份，谁晚谁为准），不单独提交（跟着自动提交走）；
 *   关 PDF 时配对笔记的属性「读到」「读了」跟上（笔记已经有了才写）；
 * - 文件夹首页的 ParaRead 组件要的数：这个文件夹里每份 PDF 读到哪、读了多久、还有几处看不懂、问到第几页。
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { atomicWrite } from '@cn/atomic'
import { dirname, join } from 'node:path'
import * as git from '@cn/git'
import {
  type AskSection,
  clockOf,
  CONFUSED,
  confusedQ,
  confusedTitle,
  highlightsOf,
  type HlKind,
  kindName,
  KINDS_FILE,
  kindsJson,
  newReadingNote,
  nextHlId,
  notePathFor,
  openConfused,
  parseKinds,
  parseReadAt,
  parseReadingNote,
  prop,
  putReadAt,
  type ReadAt,
  READ_AT_FILE,
  readAtJson,
  readAtLabel,
  type Rect,
  removeHighlight,
  removeSection,
  renameKindIn,
  upsertHighlight,
  upsertSection,
  withReadAtProps,
} from '@cn/format'
import { t } from '../../shared/i18n'
import type { FolderReads, HlAddRequest } from '../../shared/reading'
import type { Vault } from '../vault'

export interface HighlightDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
}

const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const SKIP = new Set(['.git', 'node_modules', '.trash', '.obsidian'])
/** 读到哪是画布笔记这边记的（ParaRead 记 pararead） */
const BY = 'canvas-notes'

export function setupHighlights(deps: HighlightDeps) {
  const needVault = () => {
    const v = deps.vault()
    if (!v) throw new Error(t('还没有打开库'))
    return v
  }
  const send = (ch: string, ...args: unknown[]) => deps.win()?.webContents.send(ch, ...args)
  const needPdf = (p: unknown) => {
    if (typeof p !== 'string' || !/\.pdf$/i.test(p)) throw new Error(t('不是 PDF'))
    return p
  }
  async function readText(v: Vault, rel: string): Promise<string | null> {
    try {
      return (await v.read(rel)).text
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }
  async function readRaw(v: Vault, rel: string): Promise<string | null> {
    try {
      return await readFile(v.abs(rel), 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  // ---------- 含义表 ----------
  const kinds = async (v: Vault) => parseKinds(await readRaw(v, KINDS_FILE))
  ipcMain.handle('reading:hl:kinds', async () => kinds(needVault()))
  ipcMain.handle('reading:hl:kinds:save', async (_e, list: unknown) => {
    const v = needVault()
    if (!Array.isArray(list)) throw new Error(t('划线颜色不对'))
    const next = parseKinds(JSON.stringify({ kinds: list }))
    await mkdir(dirname(v.abs(KINDS_FILE)), { recursive: true })
    await atomicWrite(v.abs(KINDS_FILE), kindsJson(next))
    await git.commitPaths(v.root, [KINDS_FILE], `划线颜色：${next.map((k) => k.name).join('、')}`) // 不翻：提交说明
    send('files:changed')
    return next
  })

  /** 库里写着划线的笔记（找 cn:hl= 的 md） */
  async function markedNotes(v: Vault): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = []
    const walk = async (dir: string) => {
      for (const ent of await readdir(dir ? v.abs(dir) : v.root, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue
        const p = dir ? `${dir}/${ent.name}` : ent.name
        if (ent.isDirectory()) await walk(p)
        else if (ent.isFile() && /\.md$/i.test(ent.name)) {
          const raw = await readFile(v.abs(p), 'utf8')
          if (raw.includes('cn:hl=')) out.push({ path: p, text: (await v.read(p)).text })
        }
      }
    }
    await walk('')
    return out
  }
  /** 改名前问一次：这个键已经写了几条 */
  ipcMain.handle('reading:hl:count', async (_e, key: unknown) => {
    if (typeof key !== 'string') return 0
    const v = needVault()
    let n = 0
    for (const f of await markedNotes(v)) n += highlightsOf(f.text, f.path).filter((h) => h.key === key && h.key !== CONFUSED).length
    return n
  })
  /** 「把已写的 N 处一起改」：只换那几行「· 名字 ·」那一节，一次提交 */
  ipcMain.handle('reading:hl:rename', async (_e, key: unknown, name: unknown) => {
    if (typeof key !== 'string' || typeof name !== 'string' || !kindName(name)) throw new Error(t('名字不对'))
    const v = needVault()
    const paths: string[] = []
    let n = 0
    for (const f of await markedNotes(v)) {
      const r = renameKindIn(f.text, key, name, f.path)
      if (!r.n) continue
      const w = await v.write(f.path, r.text, f.text)
      if (!w.ok) continue
      send('note:changed', f.path, r.text)
      paths.push(f.path)
      n += r.n
    }
    if (paths.length) await git.commitPaths(v.root, paths, `划线改名：${kindName(name)}（${n} 处）`) // 不翻：提交说明
    send('files:changed')
    return n
  })

  // ---------- 划线 ----------
  /** 改一下这份 PDF 的配对笔记（没有就新建）：f 拿到现在的字，回新的字；笔记刚被改过就重读再来，三次不成报错 */
  async function editNote(pdf: string, f: (md: string, note: string) => string, message: string): Promise<string> {
    const v = needVault()
    const note = notePathFor(pdf)
    for (let tries = 0; ; tries++) {
      const cur = await readText(v, note)
      const base = cur ?? ''
      const next = f(cur ?? newReadingNote(pdf), note)
      if (next === base) return next
      if (cur === null) await mkdir(dirname(v.abs(note)), { recursive: true })
      const w = await v.write(note, next, base)
      if (w.ok) {
        send('note:changed', note, next)
        await git.commitPaths(v.root, [note], message)
        send('files:changed')
        return next
      }
      if (tries >= 2) throw new Error(t('笔记刚被改过，这条线没记上，再划一次'))
    }
  }

  const needRect = (r: unknown): Rect | undefined => (Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (r as Rect) : undefined)

  ipcMain.handle('reading:hl:add', async (_e, req: HlAddRequest) => {
    const pdf = needPdf(req?.pdf)
    const page = Math.floor(Number(req.page))
    if (!(page >= 1) || typeof req.text !== 'string' || !req.text.trim() || typeof req.key !== 'string') throw new Error(t('划线不对'))
    const v = needVault()
    const kind = (await kinds(v)).find((k) => k.key === req.key)
    if (!kind) throw new Error(t('没有这种颜色'))
    const rect = needRect(req.rect)
    let id = ''
    await editNote(
      pdf,
      (md, note) => {
        id = nextHlId(md, page)
        if (kind.key !== CONFUSED) return upsertHighlight(md, { id, key: kind.key, text: req.text, page, ...(rect ? { rect } : {}), file: pdf }, note, kind.name)
        if (typeof req.thread !== 'string' || !req.thread.startsWith('.canvas-notes/对话/')) throw new Error(t('划线不对'))
        // 看不懂：写成一段问题段（这一段的身份和框一块问的一样，问 AI 时接着它问）
        const s: AskSection = {
          id: req.thread,
          file: pdf,
          page,
          ...(rect ? { rect } : {}),
          title: confusedTitle(req.text, kind.name),
          time: clockOf(new Date()),
          figures: [],
          doubts: [],
          good: '',
          points: [],
          failed: [],
          rounds: 0,
          links: [],
          qas: [{ q: confusedQ({ id, text: req.text }, kind.name), a: '', sides: [] }],
          recap: '',
        }
        return upsertSection(md, s, note)
      },
      `笔记：${stemOf(pdf)} 第 ${page} 页划线 · ${kind.name}`, // 不翻：提交说明
    )
    return { id }
  })

  /** 换一种含义（看不懂的不能换；换成看不懂要先删再划） */
  ipcMain.handle('reading:hl:set', async (_e, pdfIn: unknown, id: unknown, key: unknown) => {
    const pdf = needPdf(pdfIn)
    if (typeof id !== 'string' || typeof key !== 'string' || key === CONFUSED) throw new Error(t('划线不对'))
    const v = needVault()
    const kind = (await kinds(v)).find((k) => k.key === key)
    if (!kind) throw new Error(t('没有这种颜色'))
    await editNote(
      pdf,
      (md, note) => {
        const h = highlightsOf(md, note).find((x) => x.id === id)
        if (!h || h.key === CONFUSED) throw new Error(t('笔记里找不到这条线了'))
        return upsertHighlight(md, { ...h, key: kind.key, file: h.file || pdf }, note, kind.name)
      },
      `笔记：${stemOf(pdf)} 划线换成 ${kind.name}`, // 不翻：提交说明
    )
  })

  /** 删一条：划的线只删那一行；看不懂的还没问过 AI 时整段删，问过的留着（回答在里面） */
  ipcMain.handle('reading:hl:remove', async (_e, pdfIn: unknown, id: unknown) => {
    const pdf = needPdf(pdfIn)
    if (typeof id !== 'string') throw new Error(t('划线不对'))
    await editNote(
      pdf,
      (md, note) => {
        const h = highlightsOf(md, note).find((x) => x.id === id)
        if (!h) return md
        if (h.key !== CONFUSED) return removeHighlight(md, id, note)
        if (h.asked) throw new Error(t('这处已经问过 AI，回答在笔记里；要删请在笔记里删那一段'))
        const sec = parseReadingNote(md, note).find((s) => s.id === h.thread)
        if (!sec) return md
        return removeSection(md, sec.id, note)
      },
      `笔记：${stemOf(pdf)} 删掉一条划线`, // 不翻：提交说明
    )
  })

  // ---------- 读到哪 ----------
  /** 读、改读到哪那份（另一个软件刚写过的那份也读进来再合，不盖掉） */
  async function readAtMap(v: Vault) {
    return parseReadAt(await readRaw(v, READ_AT_FILE))
  }
  let saving = Promise.resolve()
  ipcMain.handle('reading:readAt:get', async (_e, pdfIn: unknown): Promise<ReadAt | null> => {
    const pdf = needPdf(pdfIn)
    return (await readAtMap(needVault()))[pdf] ?? null
  })
  ipcMain.handle('reading:readAt:put', async (_e, pdfIn: unknown, o: unknown) => {
    const pdf = needPdf(pdfIn)
    const v = needVault()
    const p = (o && typeof o === 'object' ? o : {}) as { page?: unknown; pages?: unknown; addMs?: unknown }
    const page = typeof p.page === 'number' && p.page >= 1 ? p.page : undefined
    const pages = typeof p.pages === 'number' && p.pages >= 1 ? p.pages : undefined
    const addMs = typeof p.addMs === 'number' && p.addMs > 0 && p.addMs < 3600_000 ? p.addMs : undefined
    if (page === undefined && !addMs) return
    // 一个接一个写（翻得快时不互相盖掉）
    saving = saving.catch(() => undefined).then(async () => {
      const map = await readAtMap(v)
      const next = putReadAt(map, pdf, BY, { ...(page !== undefined ? { page, pct: pages ? Math.round((page / pages) * 1000) / 10 : undefined } : {}), ...(pages ? { pages } : {}), ...(addMs ? { addMs } : {}), now: Date.now() })
      if (next === map) return
      await mkdir(dirname(v.abs(READ_AT_FILE)), { recursive: true })
      await atomicWrite(v.abs(READ_AT_FILE), readAtJson(next))
      await keepOutOfGit(v.root)
    })
    await saving
  })
  /**
   * 关 PDF 时：配对笔记的属性「读到」「读了」跟上（笔记已经有了才写，不为这个新建一篇），变了就提交一次。
   * 换一台电脑读到哪靠这两个属性跟着 Git 走（读到哪.json 只在这台 Mac 上两个软件之间共用，不进 Git）
   */
  ipcMain.handle('reading:readAt:props', async (_e, pdfIn: unknown) => {
    const pdf = needPdf(pdfIn)
    const v = needVault()
    const r = (await readAtMap(v))[pdf]
    const note = notePathFor(pdf)
    const cur = await readText(v, note)
    if (!r || cur === null) return
    const next = withReadAtProps(cur, r)
    if (next === cur) return
    const w = await v.write(note, next, cur)
    if (w.ok) {
      send('note:changed', note, next)
      await git.commitPaths(v.root, [note], `笔记：${stemOf(pdf)} 读到 ${readAtLabel(r)}`) // 不翻：提交说明
      send('files:changed')
    }
  })

  // ---------- 文件夹首页的 ParaRead 组件 ----------
  ipcMain.handle('reading:pr:folder', async (_e, folder: unknown): Promise<FolderReads> => {
    if (typeof folder !== 'string') throw new Error(t('文件夹不对'))
    const v = needVault()
    const map = await readAtMap(v)
    const pdfs: string[] = []
    const walk = async (dir: string) => {
      let ents
      try {
        ents = await readdir(dir ? v.abs(dir) : v.root, { withFileTypes: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
        throw e
      }
      for (const ent of ents) {
        if (ent.name.startsWith('.') || SKIP.has(ent.name) || ent.name === '附件') continue // 不翻：磁盘上的附件文件夹名
        const p = dir ? `${dir}/${ent.name}` : ent.name
        if (ent.isDirectory()) await walk(p)
        else if (ent.isFile() && /\.pdf$/i.test(ent.name)) pdfs.push(p)
      }
    }
    await walk(folder)
    const items = await Promise.all(
      pdfs.map(async (pdf) => {
        const note = notePathFor(pdf)
        const text = await readText(v, note)
        // 笔记属性「读到」也认（别的设备、ParaRead 只写了属性时）
        const read = map[pdf]
        const asked = text ? prop(text, '进度') : undefined // 不翻：属性键
        return {
          pdf,
          note: text !== null,
          ...(read ? { read } : {}),
          ...(text && !read && prop(text, '读到') ? { readLabel: prop(text, '读到')! } : {}), // 不翻：属性键
          confused: text ? openConfused(highlightsOf(text, note)).length : 0,
          ...(asked ? { asked } : {}),
        }
      }),
    )
    return { root: v.root, items }
  })
}

/**
 * 读到哪.json 不进 Git（翻一页写一次，进了 Git 一天几百个改动）：写进这个库自己的 .git/info/exclude（不碰用户的 .gitignore）。
 * 两个软件在这台 Mac 上读写同一份；换一台电脑靠配对笔记的属性「读到」「读了」
 */
async function keepOutOfGit(root: string) {
  // .git 是文件（工作副本、子模块）时不管：那样的库少见，读到哪.json 照常写，只是会出现在未提交里
  try {
    if (!(await stat(join(root, '.git'))).isDirectory()) return
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
    throw e
  }
  const ex = join(root, '.git', 'info', 'exclude')
  const line = `/${READ_AT_FILE}`
  let cur = ''
  try {
    cur = await readFile(ex, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  if (cur.split('\n').includes(line)) return
  await mkdir(dirname(ex), { recursive: true })
  await atomicWrite(ex, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
}

export type { HlKind }
