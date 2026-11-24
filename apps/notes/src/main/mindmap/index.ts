/**
 * 拍手写导图的主线部分：摄像头权限、照片暂存（HEIC 转 JPEG）、AI 认照片、做成导图白板（照片和白板一次提交）、
 * 隔空投送（看「下载」文件夹里新来的照片）。界面在 renderer/mindmap/，接口见 shared/mindmap-api.ts。
 */
import { app, ipcMain, shell, systemPreferences, type BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import * as git from '@cn/git'
import type { MapNode } from '@cn/format'
import { INSTALL_HINT, findCli } from '@cn/ai-engines'
import { visionModel } from '../agent'
import { INBOX } from '../../shared/layout'
import {
  coursesOf,
  dayOf,
  mapTitle,
  mindmapNote,
  parseRecognition,
  photoCaption,
  photoName,
  recognizePrompt,
  RECOGNIZE_SYSTEM,
  type PlaceRequest,
  type Placed,
  type Recognition,
  type StagedPhoto,
} from '../../shared/mindmap'
import { ATTACHMENTS } from '../attachments'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import { FAKE_ANSWER, FAKE_NOT_MAP } from './fake'
import { forAi, stagePhoto, type Staged } from './photo'
import { askWithImage } from './vision'
import { atomicCopy } from '@cn/atomic'

const IMG = /\.(jpe?g|png|heic|heif|webp|gif)$/i

export function setupMindmap(d: { vault(): Vault | null; win(): BrowserWindow | null }) {
  const stageDir = join(app.getPath('temp'), `canvas-notes-photos-${process.pid}`)
  const staged = new Map<string, Staged & { name: string }>()
  const running = new Map<number, AbortController>()
  const needVault = () => {
    const v = d.vault()
    if (!v) throw new Error('还没有打开库')
    return v
  }

  async function stage(bytes: Uint8Array, name: string): Promise<StagedPhoto> {
    const s = await stagePhoto(stageDir, bytes)
    staged.set(s.id, { ...s, name: String(name || '照片').slice(0, 120) })
    return { id: s.id, bytes: new Uint8Array(await readFile(s.file)), mime: s.mime, name: staged.get(s.id)!.name }
  }

  ipcMain.handle('map:camera-status', () => (E2E ? 'granted' : systemPreferences.getMediaAccessStatus('camera')))
  // 第一次用摄像头：系统弹一次授权框（测试时不弹，用 Chromium 的假摄像头）
  ipcMain.handle('map:camera-ask', () => (E2E ? true : systemPreferences.askForMediaAccess('camera')))
  ipcMain.handle('map:camera-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'))

  ipcMain.handle('map:stage', (_e, bytes: unknown, name: unknown) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('照片数据不对')
    return stage(bytes, typeof name === 'string' ? name : '照片')
  })
  ipcMain.handle('map:pick', async () => {
    const { dialog } = await import('electron')
    const win = d.win()
    const opts = { title: '选一张导图照片', buttonLabel: '用这张', properties: ['openFile' as const], filters: [{ name: '照片', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    return stage(new Uint8Array(await readFile(p)), p.split('/').pop()!)
  })
  ipcMain.handle('map:discard', async (_e, id: unknown) => {
    const s = typeof id === 'string' ? staged.get(id) : undefined
    if (!s) return
    staged.delete(id as string)
    await rm(s.file, { force: true })
  })

  ipcMain.handle('map:recognize', async (_e, reqId: unknown, photoId: unknown, course: unknown): Promise<Recognition> => {
    if (typeof reqId !== 'number' || typeof photoId !== 'string') throw new Error('参数不对')
    const s = staged.get(photoId)
    if (!s) throw new Error('照片找不到了，重拍一张')
    const ac = new AbortController()
    running.set(reqId, ac)
    try {
      const v = needVault()
      const courses = coursesOf((await v.list()).map((n) => n.path))
      if (process.env.CN_AI_FAKE === '1') {
        await sleep(Number(process.env.CN_AI_FAKE_DELAY_MS) || 600, ac.signal)
        return parseRecognition(/not-map|风景/.test(s.name) ? FAKE_NOT_MAP : FAKE_ANSWER)
      }
      const exe = findCli('claude')
      if (!exe) throw new Error(`认导图要用 Claude Code（要能看图）。${INSTALL_HINT.claude}`)
      const image = await forAi(s.file, stageDir)
      const answer = await askWithImage({
        exe,
        cwd: v.root,
        system: RECOGNIZE_SYSTEM,
        prompt: recognizePrompt(courses, typeof course === 'string' ? course : undefined),
        image,
        // 设置 › AI「看图问」选的模型（CN_MAP_MODEL 给了就用它）
        ...(process.env.CN_MAP_MODEL ? {} : { model: visionModel() }),
        signal: ac.signal,
      })
      return parseRecognition(answer)
    } finally {
      running.delete(reqId)
    }
  })
  ipcMain.handle('map:stop', (_e, reqId: number) => running.get(reqId)?.abort())

  ipcMain.handle('map:place', async (_e, req: PlaceRequest) => {
    // 费曼「拍成导图」没有照片：from 是 feynman、给了名字
    const bare = req?.from === 'feynman' && req.photo === undefined && typeof req.title === 'string' && !!req.title.trim()
    if (!req || (!bare && typeof req.photo !== 'string') || !Array.isArray(req.roots) || !req.roots.length) throw new Error('参数不对')
    if (req.into !== undefined && (typeof req.into?.path !== 'string' || !/\.md$/i.test(req.into.path) || req.into.path.split('/').includes('..') || (req.into.as !== 'board' && req.into.as !== 'note'))) throw new Error('参数不对')
    const s = bare ? null : staged.get(req.photo!)
    if (!bare && !s) throw new Error('照片找不到了，重拍一张')
    const v = needVault()
    // 挂到哪一篇：那一篇得还在（拍的时候被删、被挪走了就说清楚，不悄悄进收件箱）
    if (req.into) await stat(v.abs(req.into.path)).catch(() => Promise.reject(new Error(`《${basename(req.into!.path, '.md')}》不在了，导图没放进去`)))
    const at = new Date(Number.isFinite(req.at) ? req.at : Date.now())
    // 照片进 附件/导图/，名字重了加 -2
    const folder = `${ATTACHMENTS}/导图`
    let photoPath = ''
    if (s) await mkdir(v.abs(folder), { recursive: true })
    for (let n = 1; s; n++) {
      const name = photoName(at, s.ext).replace(/\.(\w+)$/, n > 1 ? `-${n}.$1` : '.$1')
      try {
        await stat(v.abs(`${folder}/${name}`))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        photoPath = `${folder}/${name}`
        await atomicCopy(s.file, v.abs(photoPath))
        break
      }
    }
    const title = bare ? req.title!.trim().replace(/[/\\:]/g, '∶').slice(0, 80) : mapTitle(at)
    // 从白板、笔记拍的：放在那一篇所在的文件夹（同子白板、/白板 › 新建白板）；别处拍的进收件箱
    const into = req.into
    const dir = into ? (into.path.includes('/') ? into.path.slice(0, into.path.lastIndexOf('/')) : '') : INBOX
    const notePath = dir ? `${dir}/${title}.md` : `${title}.md`
    const text = mindmapNote({
      title,
      notePath,
      ...(photoPath ? { photoPath } : {}),
      caption: photoCaption(at, req.from),
      roots: req.roots.map(cleanNode),
      from: req.from,
      course: typeof req.course === 'string' && req.course.trim() ? req.course.trim() : undefined,
      lecture: Number.isInteger(req.lecture) && req.lecture! > 0 ? req.lecture : undefined,
      ai: Array.isArray(req.ai) ? req.ai.filter((k) => k === '课程' || k === '第几讲') : [],
      day: dayOf(at),
      ...(into ? { parent: { as: into.as, name: basename(into.path, '.md') } } : {}),
    })
    // 名字重了 vault 会加「 2」，同一个文件夹，照片的相对链接不变
    const path = await v.create(dir, title, text)
    // 挂到白板、笔记上的：界面插好链接后三样一起提交（board:commit），这里不提交
    if (!into) await git.commitPaths(v.root, photoPath ? [path, photoPath] : [path], `拍导图：${title.replace('∶', ':')} 进收件箱`)
    if (s) {
      staged.delete(req.photo!)
      await rm(s.file, { force: true })
    }
    d.win()?.webContents.send('files:changed')
    return { path, photo: photoPath } satisfies Placed
  })

  // ---------- 隔空投送：拍照窗口开着时，看「下载」文件夹里新来的照片 ----------
  let watcher: FSWatcher | null = null
  let since = 0
  const seen = new Set<string>()
  ipcMain.handle('map:airdrop', (_e, on: unknown) => {
    watcher?.close()
    watcher = null
    if (on !== true) return
    const dir = process.env.CN_AIRDROP_DIR || join(homedir(), 'Downloads')
    since = Date.now() - 1000
    seen.clear()
    try {
      watcher = watch(dir, (_ev, name) => {
        if (!name || !IMG.test(String(name)) || seen.has(String(name))) return
        void arrived(join(dir, String(name)), String(name))
      })
    } catch (e) {
      console.error('看不了下载文件夹', e)
    }
  })

  /** 新文件写完（大小不再变）再拿 */
  async function arrived(file: string, name: string) {
    let last = -1
    for (let i = 0; i < 40; i++) {
      const st = await stat(file).catch(() => null)
      if (!st) return
      if (st.birthtimeMs < since && st.mtimeMs < since) return
      if (st.size > 0 && st.size === last) break
      last = st.size
      await sleep(250)
    }
    if (seen.has(name)) return
    seen.add(name)
    try {
      const photo = await stage(new Uint8Array(await readFile(file)), name)
      d.win()?.webContents.send('map:airdropped', photo)
    } catch (e) {
      d.win()?.webContents.send('map:airdrop-error', `隔空投送来的「${name}」用不了：${(e as Error).message}`)
    }
  }

  app.on('will-quit', () => {
    watcher?.close()
    void rm(stageDir, { recursive: true, force: true })
  })
}

/** 界面传来的树只留认得的字段 */
function cleanNode(n: MapNode): MapNode {
  const out: MapNode = { text: String(n?.text ?? '').trim() || '（空）', children: Array.isArray(n?.children) ? n.children.slice(0, 200).map(cleanNode) : [] }
  if (Array.isArray(n.box) && n.box.length === 4 && n.box.every((x) => typeof x === 'number' && Number.isFinite(x))) out.box = n.box
  if (n.unsure === true) out.unsure = true
  if (Array.isArray(n.guesses)) out.guesses = n.guesses.filter((g) => typeof g === 'string').slice(0, 4)
  // 费曼「拍成导图」：讲错、AI 写的正确说法、留给自己填的空框
  for (const k of ['wrong', 'fix', 'blank'] as const) if (n[k] === true) out[k] = true
  return out
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(Object.assign(new Error('停下了'), { name: 'AbortError' }))
    })
  })
}

export const imageExt = (p: string) => extname(p).slice(1).toLowerCase()
