/**
 * MeetCaption 联动的主进程这半（画布笔记这一侧，设计 24-meetcaption联动「已定（2026-11-23）」）：
 * - 文件夹首页的 MeetCaption 组件要的数：这个文件夹对的是哪个项目、什么模式（库里 .canvas-notes/meetcaption.json，MeetCaption 连库时写），
 *   最近几节（文件夹里属性带 meetcaption: 的上课记录），正在上课 / 刚下课（MeetCaption 设置目录里的 canvas-notes-live.json）；
 * - 开始上课、打开那一场：走 MeetCaption 的深链 meetcaption://start、meetcaption://open（测试模式 test-mode 换掉了 shell，只记下来）；
 * - 上课记录要的：字幕全文（.canvas-notes/字幕/meetcaption/<场>.vtt）、关键画面（录音那一处的 画面-HH.MM.SS.jpg）、录音（「<库名>-录音」仓库挂在
 *   .canvas-notes/录音/，Git LFS；还是指针时就是「没下到这台 Mac 上」，下载留了接口 setAudioFetcher，这一步没做）；
 * - MeetCaption 跳过来：canvas-notes://open?file=<篇>&t=<秒>[&session=&back=]、canvas-notes://meetcaption?session=<场>&t=<秒>，打开那一篇、滚到那个时间点。
 * 测试模式：live 文件在 CN_MEETCAPTION_DIR 里，没给就当 MeetCaption 没在上课（不读这台 Mac 上真的设置目录）。
 */
import { type Installed } from '@cn/family'
import { durationMinutes, isMcMode, lineAtTime, MC_MODE_SOURCE, type McMode, mcOpenUrl, mcRecordingDir, mcStartUrl, parseCanvasNotesMc, parseVtt, prop, readMcRecord, frameClock } from '@cn/format'
import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, unwatchFile, watchFile } from 'node:fs'
import { atomicWrite } from '@cn/atomic'
import { mkdir, open, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { McFolder, McJumpMsg, McLive, McProject, McRecordData, McRow } from '../shared/meetcaption'
import { t } from '../shared/i18n'
import { E2E } from './test-mode'
import type { Vault } from './vault'

const MAP_FILE = '.canvas-notes/meetcaption.json'
const PLACED_FILE = '.canvas-notes/meetcaption-placed.json'
const LIVE_NAME = 'canvas-notes-live.json'
/** 录音一节最多读多大（两个半小时 Opus 24 kbps 约 27 MB；留足） */
const MAX_AUDIO = 400 * 1024 * 1024
const LFS_HEAD = 'version https://git-lfs.github.com/spec/v1'

/** 下录音（Git LFS 按需下这一节）：这一步还没做，留接口；做好的人调 setAudioFetcher 换掉 */
let fetchAudio: (root: string, rel: string) => Promise<void> = async () => {
  throw new Error(t('这一节的录音还没下到这台 Mac 上（按需下载录音还没做）；字幕在，先跳到那一句'))
}
export const setAudioFetcher = (f: typeof fetchAudio) => (fetchAudio = f)

const liveFile = (): string | null => {
  if (E2E) return process.env.CN_MEETCAPTION_DIR ? join(process.env.CN_MEETCAPTION_DIR, LIVE_NAME) : null
  // MeetCaption 的设置目录跟它的软件名「会议字幕」
  return join(app.getPath('appData'), '会议字幕', LIVE_NAME)
}

function readJson(abs: string): unknown {
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch {
    return null
  }
}

function readLive(): McLive | null {
  const f = liveFile()
  const raw = f ? (readJson(f) as Record<string, unknown> | null) : null
  if (!raw || typeof raw.session !== 'string' || typeof raw.startedAt !== 'number') return null
  return {
    session: raw.session,
    startedAt: raw.startedAt,
    ...(typeof raw.project === 'string' ? { project: raw.project } : {}),
    ...(isMcMode(raw.mode) ? { mode: raw.mode } : {}),
    ...(typeof raw.file === 'string' ? { file: raw.file } : {}),
    ...(typeof raw.endedAt === 'number' ? { endedAt: raw.endedAt } : {}),
    ...(typeof raw.todos === 'number' ? { todos: raw.todos } : {}),
    ...(typeof raw.dated === 'number' ? { dated: raw.dated } : {}),
  }
}

function projects(root: string): McProject[] {
  const raw = readJson(join(root, MAP_FILE)) as { projects?: unknown } | null
  if (!raw || !Array.isArray(raw.projects)) return []
  return raw.projects.flatMap((p: Record<string, unknown>): McProject[] => {
    if (!p || typeof p.id !== 'string' || typeof p.folder !== 'string') return []
    const schedule = Array.isArray(p.schedule)
      ? p.schedule.filter((s: Record<string, unknown>) => s && Number.isInteger(s.weekday) && typeof s.time === 'string' && /^\d{1,2}:\d{2}$/.test(s.time as string)).map((s: Record<string, unknown>) => ({ weekday: s.weekday as number, time: s.time as string }))
      : []
    return [{ id: p.id, folder: p.folder.replace(/\/+$/, ''), mode: isMcMode(p.mode) ? p.mode : 'class', ...(typeof p.name === 'string' ? { name: p.name } : {}), ...(typeof p.calendar === 'string' ? { calendar: p.calendar } : {}), schedule }]
  })
}

const title = (path: string, text: string) => /^# (.+)$/m.exec(text)?.[1]?.trim() ?? path.split('/').pop()!.replace(/\.md$/i, '')

function rowOf(path: string, text: string): McRow | null {
  const r = readMcRecord(text)
  if (!r) return null
  return {
    path,
    title: title(path, text).replace(/^\d{4}-\d{2}-\d{2}\s*/, ''),
    date: r.date ?? /^\d{4}-\d{2}-\d{2}/.exec(r.sessions[0]!)?.[0] ?? '',
    sessions: r.sessions,
    minutes: durationMinutes(r.duration),
    mode: r.mode ?? null,
    open: (text.match(/^\s*[-*] \[ \] /gm) ?? []).length,
    hasAudio: r.recordings.some(Boolean),
  }
}

export function registerMeetCaption(o: { vault: () => Vault | null; win: () => BrowserWindow | null; installed: () => Promise<Installed> }) {
  const need = () => {
    const v = o.vault()
    if (!v) throw new Error(t('还没有打开库'))
    return v
  }
  const inVault = (rel: unknown, under?: string): string => {
    if (typeof rel !== 'string' || !rel || rel.split('/').includes('..') || rel.startsWith('/')) throw new Error(t('路径不对'))
    if (under && !rel.startsWith(under)) throw new Error(t('路径不对'))
    return rel
  }
  const say = (url: string) => shell.openExternal(url, { activate: true })
  const isInstalled = async () => !!(await o.installed()).meetcaption

  // 正在上课的状态文件：有组件在看时盯着它（MeetCaption 开始、下课时写）
  let watching: string | null = null
  const watchLive = () => {
    const f = liveFile()
    if (!f || watching === f) return
    if (watching) unwatchFile(watching)
    watching = f
    watchFile(f, { interval: 1500 }, () => o.win()?.webContents.send('mc:changed'))
  }
  app.on('will-quit', () => watching && unwatchFile(watching))

  ipcMain.handle('mc:folder', async (_e, folder: unknown): Promise<McFolder> => {
    const v = need()
    const f = typeof folder === 'string' ? folder.replace(/\/+$/, '') : ''
    watchLive()
    const project = projects(v.root).find((p) => p.folder === f) ?? null
    const rows: McRow[] = []
    for (const [path, text] of await v.texts()) {
      if (f && !path.startsWith(f + '/')) continue
      if (!text.includes('meetcaption:')) continue
      const r = rowOf(path, text)
      if (r) rows.push(r)
    }
    rows.sort((a, b) => b.sessions[0]!.localeCompare(a.sessions[0]!) || a.path.localeCompare(b.path))
    const live = readLive()
    return { project, records: rows, live, installed: await isInstalled() }
  })

  ipcMain.handle('mc:start', async (_e, opt: unknown) => {
    const p = (opt ?? {}) as { project?: unknown; mode?: unknown; back?: unknown }
    if (typeof p.project !== 'string' || !p.project || !isMcMode(p.mode)) throw new Error(t('开始上课的参数不对'))
    if (!(await isInstalled())) throw new Error(t('这台Mac上没装MeetCaption'))
    const mode: McMode = p.mode
    await say(mcStartUrl({ project: p.project, mode, source: MC_MODE_SOURCE[mode], ...(typeof p.back === 'string' ? { back: p.back } : {}) }))
  })

  ipcMain.handle('mc:open', async (_e, session: unknown, at: unknown) => {
    if (typeof session !== 'string' || !session) throw new Error(t('哪一场不对'))
    if (!(await isInstalled())) throw new Error(t('这台Mac上没装MeetCaption'))
    await say(mcOpenUrl({ session, ...(typeof at === 'number' && at >= 0 ? { t: at } : {}) }))
  })

  /** 连库时 MeetCaption 对上的文件夹：第一次打开它的首页时放一张组件（放过记下来，删了不再放） */
  ipcMain.handle('mc:autoPlace', async (_e, folder: unknown): Promise<boolean> => {
    const v = need()
    if (typeof folder !== 'string') return false
    if (!projects(v.root).some((p) => p.folder === folder.replace(/\/+$/, ''))) return false
    const file = join(v.root, PLACED_FILE)
    const raw = readJson(file) as { placed?: unknown } | null
    const placed = Array.isArray(raw?.placed) ? (raw.placed as unknown[]).filter((x): x is string => typeof x === 'string') : []
    if (placed.includes(folder)) return false
    await mkdir(dirname(file), { recursive: true })
    await atomicWrite(file, JSON.stringify({ placed: [...placed, folder] }, null, 2) + '\n')
    return true
  })

  ipcMain.handle('mc:record', async (_e, path: unknown): Promise<McRecordData> => {
    const v = need()
    const rel = inVault(path)
    const text = await readFile(v.abs(rel), 'utf8')
    const r = readMcRecord(text)
    if (!r) throw new Error(t('这一篇不是MeetCaption的上课记录'))
    const subtitles = await Promise.all(
      r.subtitles.map(async (s) => {
        if (!s) return []
        try {
          return parseVtt(await readFile(v.abs(inVault(s, '.canvas-notes/')), 'utf8'))
        } catch {
          return []
        }
      }),
    )
    const audio = await Promise.all(r.recordings.map(async (a) => (a ? audioState(v, a) : ('missing' as const))))
    const dir = mcRecordingDir(rel)
    let frames: { path: string; clock: number }[] = []
    try {
      frames = (await readdir(v.abs(dir)))
        .map((n) => ({ path: `${dir}/${n}`, clock: frameClock(n) }))
        .filter((x): x is { path: string; clock: number } => x.clock !== null)
        .sort((a, b) => a.clock - b.clock)
    } catch {
      frames = []
    }
    return { sessions: r.sessions, recordings: r.recordings, audio, subtitles, frames, mode: r.mode ?? null, course: prop(text, '课程') ?? null }
  })

  ipcMain.handle('mc:audio', async (_e, rel: unknown) => {
    const v = need()
    const p = inVault(rel, '.canvas-notes/录音/')
    const st = await stat(v.abs(p))
    if (st.size > MAX_AUDIO) throw new Error(t('这一节的录音太大，打不开'))
    if ((await audioState(v, p)) !== 'ready') throw new Error(t('这一节的录音还没下到这台 Mac 上'))
    return new Uint8Array(await readFile(v.abs(p)))
  })

  /** 按需下这一节的录音（还没做，见 setAudioFetcher） */
  ipcMain.handle('mc:fetchAudio', async (_e, rel: unknown) => {
    const v = need()
    await fetchAudio(v.root, inVault(rel, '.canvas-notes/录音/'))
    return audioState(v, rel as string)
  })

  // ---------- MeetCaption 跳过来 ----------
  let pending: McJumpMsg | null = null
  const send = (j: McJumpMsg) => {
    const w = o.win()
    if (!w) return void (pending = j)
    w.webContents.send('mc:jump', j)
    if (!E2E) w.show()
  }
  ipcMain.handle('mc:takePending', () => {
    const j = pending
    pending = null
    return j
  })
  /** 只知道哪一场：找写着这一场的那一篇，落在哪一行 */
  ipcMain.handle('mc:find', async (_e, session: unknown, at: unknown): Promise<{ file: string; line: number | null } | null> => {
    const v = need()
    if (typeof session !== 'string') return null
    for (const [path, text] of await v.texts()) {
      if (!text.includes(session)) continue
      const r = readMcRecord(text)
      if (r?.sessions.includes(session)) return { file: path, line: lineAtTime(r, session, typeof at === 'number' ? at : 0) }
    }
    return null
  })
  const fromUrl = (url: string) => {
    const j = parseCanvasNotesMc(url)
    // 普通的 canvas-notes://open（画布今日、Anki、ParaRead）归 reading/index.ts 管；带了时间或场的才是 MeetCaption 来的
    if (!j || (j.t === undefined && !j.session)) return
    const v = o.vault()
    if (j.vault && v && j.vault !== v.root) return send({ ...j, other: true })
    send(j)
  }
  app.on('open-url', (_e, url) => fromUrl(url))
  // 测试用：不经系统交一条深链进来（和 open-url 走同一处）
  if (E2E) (globalThis as unknown as { cnMcOpenUrl?: (u: string) => void }).cnMcOpenUrl = fromUrl
}

async function audioState(v: Vault, rel: string): Promise<'ready' | 'pointer' | 'missing'> {
  const abs = v.abs(rel)
  if (!existsSync(abs)) return 'missing'
  const h = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(LFS_HEAD.length)
    await h.read(buf, 0, buf.length, 0)
    return buf.toString('utf8') === LFS_HEAD ? 'pointer' : 'ready'
  } finally {
    await h.close()
  }
}
