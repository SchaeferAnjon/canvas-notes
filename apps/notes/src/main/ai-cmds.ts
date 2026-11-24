/**
 * AI 命令（task-9womr）在主进程这一半：
 * - 「存成命令」要的改之前那一版（几轮之前的那次提交前面）、现在的提交号；
 * - 只在这台 Mac 上的命令（软件设置目录 ai/commands.json，不进库、不进历史）；
 * - 自带命令要的东西：这周改过的笔记（写这周的周记）、右栏正在看的视频和字幕（视频要点带时间、字幕整理成一篇）、右栏网页的字（在网页上用自己的命令）；
 * - 交给 AI 时附的库里的图（截图转成文字、自己的命令里「图里的内容写成文字」）。
 */
import { ipcMain, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as git from '@cn/git'
import { aiCmdJson, aiCmdOf } from '../shared/ai-cmds'
import { isoWeek, newHighlights, newQuestions, type WeekInfo, weekPath } from '../shared/cmd-run'
import { titleOf } from '../shared/layout'
import { underCat } from '../shared/categories'
import { WEREAD_FOLDER } from '../shared/plugins/weread'
import type { EngineImage } from '@cn/ai-engines'
import * as web from './agent/web'
import { videoCues } from './video'
import type { Vault } from './vault'
import { writeQueued } from '@cn/atomic'

/** 一次最多附几张图、每张多大 */
export const MAX_CMD_IMAGES = 8
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

/** 库里的图 → 交给引擎的图（PNG、JPEG 原样，别的格式画成 PNG）；不在库里、读不出的跳过 */
export async function vaultImages(vault: Vault, paths: unknown): Promise<EngineImage[]> {
  if (paths === undefined) return []
  if (!Array.isArray(paths) || paths.length > MAX_CMD_IMAGES || !paths.every((p) => typeof p === 'string')) throw new Error('图不对')
  const out: EngineImage[] = []
  for (const p of paths as string[]) {
    const abs = vault.abs(p)
    try {
      const raw = await readFile(abs)
      if (!raw.length || raw.length > MAX_IMAGE_BYTES) continue
      if (/\.jpe?g$/i.test(p)) out.push({ mime: 'image/jpeg', data: raw.toString('base64'), path: abs })
      else if (/\.png$/i.test(p)) out.push({ mime: 'image/png', data: raw.toString('base64'), path: abs })
      else {
        const img = nativeImage.createFromBuffer(raw)
        if (!img.isEmpty()) out.push({ mime: 'image/png', data: img.toPNG().toString('base64'), path: abs })
      }
    } catch (e) {
      // 图挪走、删了：少附一张，照样问
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  return out
}

/** 星期一零点（这周从哪天算起） */
function monday(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 正文开头一小段（去掉属性、标题、注释、图） */
function excerpt(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => l.trim() && !/^#/.test(l) && !/^!\[/.test(l.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

/**
 * 这一篇在 rev 那时候的样子（那时还没有它是空的）。先用 ls-tree 看那时有没有它，不认 git 的报错：
 * 报错跟着系统语言变（中文系统是「致命错误：路径…在磁盘上，但是不在…中」），只认英文的话这周才有的书摘一来就报错（真跑时撞上）
 */
async function textAt(root: string, rev: string, path: string): Promise<string> {
  if (!rev) return ''
  const there = (await git.git(root, ['ls-tree', '--name-only', rev, '--', path])).trim()
  return there ? await git.git(root, ['show', `${rev}:${path}`]) : ''
}

/**
 * 这周改过、新建的笔记和读过的书（写这周的周记）。书摘交这周新划的线和想法、读 PDF 的笔记交这周新问的问题（跟这周一开始那一版比，原话），
 * 以前只交一句「书摘这周有新的划线」「这周读的时候问过」，周记里只能写空话（task-iztii）；
 * 这周已经有周记就把它带上（再写一次时并进那一篇，task-f4kf7）
 */
export async function weekInfo(vault: Vault, now = new Date()): Promise<WeekInfo> {
  const from = monday(now)
  const to = new Date(from)
  to.setDate(to.getDate() + 6)
  const commits = await git.commitsSince(vault.root, from)
  // 这周一开始那一版：星期一零点之前的最后一次提交（库是这周才建的就没有）
  const base = commits.length ? (await git.git(vault.root, ['rev-list', '-1', `--before=${from.toISOString()}`, 'HEAD'])).trim() : ''
  const seen = new Set<string>()
  const notes: WeekInfo['notes'] = []
  const books: WeekInfo['books'] = []
  for (const c of commits)
    for (const f of c.files) {
      if (seen.has(f) || !/\.md$/i.test(f) || git.isInternalPath(f) || underCat(f, '周记') || !existsSync(vault.abs(f))) continue
      seen.add(f)
      const pdf = / 笔记\.md$/.test(f) && existsSync(vault.abs(f.replace(/ 笔记\.md$/, '.pdf')))
      if (f.startsWith(WEREAD_FOLDER + '/') || pdf) {
        const [was, cur] = await Promise.all([textAt(vault.root, base, f), readFile(vault.abs(f), 'utf8')])
        // 这周只是挪了顺序、改了属性（没有新划线、新问题）：不算这周读过
        const items = (pdf ? newQuestions(was, cur, f) : newHighlights(was, cur)).slice(0, 8)
        if (items.length) books.push(pdf ? { title: titleOf(f).replace(/ 笔记$/, '') + '.pdf', kind: 'pdf', items } : { title: titleOf(f), kind: 'book', items })
        continue
      }
      if (notes.length >= 40) continue
      const text = await readFile(vault.abs(f), 'utf8')
      notes.push({ path: f, title: titleOf(f), excerpt: excerpt(text) })
    }
  const week = isoWeek(now)
  const had = existsSync(vault.abs(weekPath(week))) ? (await vault.read(weekPath(week))).text : null
  return { week, from: day(from), to: day(to), notes, books: books.slice(0, 20), had }
}

/**
 * 这一篇以前「截图转成文字」那几次提交加进去的行（去掉引用记号和前后空白；task-t41et）：再跑时认出哪几张图下面已经写过字。
 * 撤回过的那几行已经不在这一篇里了，认的时候看的是图下面现在的字，不会认错
 */
export async function ocrLines(root: string, path: string): Promise<string[]> {
  // 库里还没有一次提交：没有转过的（先问有没有提交，不认 git 的报错，报错跟着系统语言变）
  if (!(await git.git(root, ['rev-list', '-n', '1', '--all'])).trim()) return []
  const out = await git.git(root, ['log', '--follow', '-n', '200', '--format=%x01%s', '-p', '--unified=0', '--no-color', '--', path])
  const seen = new Set<string>()
  for (const part of out.split('\x01')) {
    const nl = part.indexOf('\n')
    if (nl < 0 || !part.slice(0, nl).startsWith('AI：/截图转成文字')) continue
    for (const l of part.slice(nl + 1).split('\n')) {
      if (!l.startsWith('+') || l.startsWith('+++')) continue
      const b = l.slice(1).replace(/^(\s*>)+/, '').trim()
      if (b) seen.add(b)
    }
  }
  return [...seen]
}

/** 只在这台 Mac 上的那几条命令 */
async function readLocal(file: string): Promise<unknown[]> {
  try {
    const o = JSON.parse(await readFile(file, 'utf8')) as { own?: unknown }
    return Array.isArray(o.own) ? o.own : []
  } catch (e) {
    // 没有文件是还没存过；坏了当没有，不挡着 / 菜单
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return []
    throw e
  }
}

export function registerAiCmds(d: { vault(): Vault; userData: string }) {
  const localFile = join(d.userData, 'ai', 'commands.json')

  /**
   * 「存成命令」的对照：first 是这段对话里 AI 第一次改这一篇的那次提交，改之前就是它前面那一版；现在是磁盘上的这一篇（保存过的）。
   * 返回改之前的全文（那时还没有这一篇是 null）和两边的提交号
   */
  ipcMain.handle('aicmd:prep', async (_e, path: unknown, first: unknown) => {
    if (typeof path !== 'string' || !path || typeof first !== 'string' || !/^[0-9a-f]{4,40}$/.test(first)) throw new Error('参数不对')
    const v = d.vault()
    const root = v.root
    let before: string | null = null
    try {
      before = await git.git(root, ['show', `${first}^:${path}`])
    } catch (e) {
      // 那次提交前面还没有这一篇（AI 新建的）、改过名：照第一次提交里这一篇的样子比
      if (!(e instanceof git.GitError)) throw e
      before = await git.git(root, ['show', `${first}:${path}`]).catch(() => null)
    }
    const beforeHash = (await git.git(root, ['rev-parse', '--short=7', `${first}^`]).catch(() => '')).trim()
    const after = (await v.read(path)).text
    const afterHash = (await git.git(root, ['log', '-1', '--format=%h', '--', path]).catch(() => '')).trim()
    const dirty = (await git.status(root)).some((s) => s.path === path)
    return { before, beforeHash, after, afterHash, dirty }
  })

  ipcMain.handle('aicmd:local:get', async () => (await readLocal(localFile)).flatMap((x) => aiCmdOf(x, 'local') ?? []))
  ipcMain.handle('aicmd:local:set', async (_e, list: unknown) => {
    if (!Array.isArray(list)) throw new Error('参数不对')
    const own = list.flatMap((x) => {
      const c = aiCmdOf(x, 'local')
      return c ? [aiCmdJson(c)] : []
    })
    await mkdir(dirname(localFile), { recursive: true })
    await writeQueued(localFile, JSON.stringify({ version: 1, own }, null, 2) + '\n', { mkdir: true })
    return own.flatMap((x) => aiCmdOf(x, 'local') ?? [])
  })

  ipcMain.handle('aicmd:week', () => weekInfo(d.vault()))

  /** 截图转成文字：这一篇以前转字那几次加进去的行（认出哪几张图转过） */
  ipcMain.handle('aicmd:ocr-lines', async (_e, path: unknown) => {
    if (typeof path !== 'string' || !path) throw new Error('参数不对')
    return ocrLines(d.vault().root, path)
  })

  /** 右栏网页上正在看的视频：名字、网址、字幕（还没拿到字幕是 cues: []）；不是视频是 null */
  ipcMain.handle('aicmd:video', () => {
    const wc = web.webContents()
    return wc ? videoCues(wc.id) : null
  })

  /** 右栏网页的字（在网页上用自己的命令时拿它当「这一篇」） */
  ipcMain.handle('aicmd:page', async () => {
    const wc = web.webContents()
    return wc ? web.pageForClip(wc, true) : null
  })

}
