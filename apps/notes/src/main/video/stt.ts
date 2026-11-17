/**
 * 生成字幕接到软件里（CN-69 / 81 方向 A）：菜单里点「生成字幕」或打开没字幕的视频时（开关打开了的话）跑一遍
 * 下载音频 → Soniox 听写 → 存成库里的 .canvas-notes/字幕/<站>-<视频号>.vtt（一次提交，跟着 Git 走）→
 * 成为「原文用哪条字幕」里的一条并选上，后面的翻译、双语、记下这一刻都走原来那套；翻完把这篇里没字幕的时刻块补上原文和译文（一次提交）。
 * 密钥：设置 › AI 填，照翻译插件的 Key 加密存（safeStorage，加密钥匙在钥匙串）；开发时用环境变量 SONIOX_API_KEY。
 * 测试实例（CN_E2E）的密钥只放内存，也不读环境变量里的真密钥，除非指了假的 Soniox（CN_SONIOX_BASE）或明说要真跑（CN_REAL_STT=1）。
 */
import { safeStorage, type Session } from 'electron'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { commitPaths } from '@cn/git'
import { cleanKey, KeyStore } from '../plugins/translate/keys'
import { E2E } from '../test-mode'
import type { Vault } from '../vault'
import { langName } from '../../shared/plugins/translate'
import { type Cue, fillMoments, type Track, type VideoRef, watchUrl } from '../../shared/video'
import type { SttState } from '../../shared/video-api'
import { dbg } from './log'
import { cuesToVtt, downloadAudio, findYtDlp, mainLanguage, parseVtt, SONIOX_MODEL, sonioxTranscribe, sttPath, tokensToCues } from './transcribe'

export interface SttHost {
  vault(): Vault | null
  ses: Session
  userData: string
  /** 视频的状态变了（菜单里的进度） */
  changed(key: string): void
  /** 字幕存好了：加进这个视频的轨道、选上、等它翻完；返回翻好的那些句子（补时刻块用） */
  ready(key: string, track: Track): Promise<Cue[] | null>
  /** 视频这边的提交排队做 */
  serial<T>(f: () => Promise<T>): Promise<T>
  notice(text: string): void
  /** 库里一篇被这边改了：开着它的编辑器换上新的 */
  noteChanged(path: string, text: string): void
}

let host: SttHost
let keys: KeyStore
const jobs = new Map<string, { state: SttState; ac: AbortController }>()

export function setupStt(h: SttHost) {
  host = h
  keys = E2E
    ? new KeyStore(null, null)
    : new KeyStore(join(h.userData, 'stt', 'keys.json'), {
        encrypt: (s) => {
          if (!safeStorage.isEncryptionAvailable()) throw new Error('这台 Mac 的钥匙串现在用不了，密钥没存')
          return safeStorage.encryptString(s)
        },
        decrypt: (b) => safeStorage.decryptString(b),
      })
}

/** 用哪个密钥：设置里填的；没填用环境变量 SONIOX_API_KEY（测试实例只在指了假服务或明说真跑时才用） */
function key(): string | undefined {
  const stored = keys.has('soniox') ? keys.get('soniox') : undefined
  if (stored) return stored
  if (E2E && !process.env.CN_SONIOX_BASE && process.env.CN_REAL_STT !== '1') return undefined
  return process.env.SONIOX_API_KEY || undefined
}

export const sttKeyStatus = () => ({ has: !!key(), tail: keys.tail('soniox') ?? null, fromEnv: !keys.has('soniox') && !!key() })
export function setSttKey(raw: unknown) {
  if (raw === null) keys.delete('soniox')
  else keys.set('soniox', cleanKey(raw))
  return sttKeyStatus()
}

export const sttState = (videoKey: string): SttState | null => jobs.get(videoKey)?.state ?? null

const sttTrack = (lang: string): Track => ({ lang, name: `${langName(lang)}（听写 · Soniox）`, auto: false, stt: true })

/** 这个视频以前生成过字幕：库里那份 vtt 当成一条轨道 */
export async function savedSttTrack(ref: VideoRef): Promise<Track | null> {
  const v = host.vault()
  if (!v) return null
  const text = await readFile(v.abs(sttPath(ref)), 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  if (!text) return null
  return sttTrack(parseVtt(text).lang ?? 'und')
}

export async function readSttCues(ref: VideoRef): Promise<Cue[]> {
  const v = host.vault()
  if (!v) throw new Error('还没有打开库')
  return parseVtt(await readFile(v.abs(sttPath(ref)), 'utf8')).cues
}

export function stopStt(videoKey: string) {
  jobs.get(videoKey)?.ac.abort()
}

/** B 站要登录才给的视频：把右栏网页里 B 站的登录写成 yt-dlp 认的 cookies.txt（临时目录，用完就删） */
async function cookiesFor(ref: VideoRef, dir: string): Promise<string | undefined> {
  if (ref.site !== 'bilibili') return undefined
  const list = await host.ses.cookies.get({ domain: 'bilibili.com' })
  // 只在真登着 B 站时带：没登录的那几条 cookie 换不来什么，不往临时目录写。
  // （以前把 HTTP 567 算在 cookie 头上，实际是 B 站分到 EdgeOne 那家 CDN、请求不带 Range，见 downloadAudio）
  if (!list.some((c) => c.name === 'SESSDATA')) return undefined
  const nav = await host.ses
    .fetch('https://api.bilibili.com/x/web-interface/nav', { signal: AbortSignal.timeout(10_000) })
    .then((r) => r.json() as Promise<{ data?: { isLogin?: boolean } }>)
    .catch(() => null)
  if (!nav?.data?.isLogin) return undefined
  const lines = list.map((c) => [c.domain?.startsWith('.') ? c.domain : `.${c.domain}`, 'TRUE', c.path ?? '/', c.secure ? 'TRUE' : 'FALSE', Math.round(c.expirationDate ?? 0), c.name, c.value].join('\t'))
  const f = join(dir, 'cookies.txt')
  await writeFile(f, `# Netscape HTTP Cookie File\n${lines.join('\n')}\n`, { mode: 0o600 })
  // 排查用（CN_VIDEO_LOG）：只记几条，不记值
  dbg(`stt cookies.txt：B 站 ${list.length} 条`)
  return f
}

/** 生成字幕：一个视频同一时间只跑一个；出错留在状态里（菜单里写原因和「再试一次」） */
export async function startStt(ref: VideoRef, title: string, bundledYtDlp: string | null): Promise<void> {
  const cur = jobs.get(ref.key)
  if (cur && !cur.state.error) return
  const k = key()
  if (!k) throw new Error('先在设置 › AI 里填 Soniox 密钥')
  const bin = findYtDlp(bundledYtDlp)
  if (!bin) throw new Error('找不到下载音频的 yt-dlp：重新装一次软件')
  const job = { state: { stage: 'download' } as SttState, ac: new AbortController() }
  jobs.set(ref.key, job)
  const step = (stage: SttState['stage']) => {
    job.state = { stage }
    host.changed(ref.key)
  }
  host.changed(ref.key)
  const dir = await mkdtemp(join(tmpdir(), 'cn-stt-'))
  try {
    const cookies = await cookiesFor(ref, dir)
    const t0 = Date.now()
    dbg('stt 下载音频', watchUrl(ref), cookies ? '带登录' : '不带登录')
    const audio = await downloadAudio({ url: watchUrl(ref), dir, bin, cookies, signal: job.ac.signal })
    dbg('stt 音频下好了', (await stat(audio)).size, 'B', Date.now() - t0, 'ms')
    step('listen')
    const tokens = await sonioxTranscribe(audio, { key: k, base: process.env.CN_SONIOX_BASE || undefined, signal: job.ac.signal })
    await rm(dir, { recursive: true, force: true })
    const cues = tokensToCues(tokens)
    dbg('stt Soniox 听写完', tokens.length, '段 →', cues.length, '句', mainLanguage(tokens), Date.now() - t0, 'ms')
    if (!cues.length) throw new Error('Soniox 没听出话来：这个视频可能没有人声')
    const lang = mainLanguage(tokens) ?? 'und'
    const v = host.vault()
    if (!v) throw new Error('还没有打开库')
    // 库的读写接口只管 md；字幕文件是软件自己的，直接写（.canvas-notes/ 里，跟着 Git 走）
    const path = sttPath(ref)
    await mkdir(dirname(v.abs(path)), { recursive: true })
    await writeFile(v.abs(path), cuesToVtt(cues, { lang, source: `soniox ${SONIOX_MODEL}` }))
    await host.serial(() => commitPaths(v.root, [path], `视频：生成字幕《${title.slice(0, 40)}》（Soniox 听写）`))
    step('translate')
    dbg('stt 字幕存进库', path)
    const done = await host.ready(ref.key, sttTrack(lang))
    dbg('stt 加进轨道', done ? `翻好 ${done.filter((c) => c.tr).length}/${done.length} 句` : '视频已经不在右栏开着')
    if (done) await fillAll(ref, title, done)
    jobs.delete(ref.key)
    host.changed(ref.key)
  } catch (e) {
    dbg('stt 出错', (e as Error).name, (e as Error).message)
    await rm(dir, { recursive: true, force: true })
    if ((e as Error).name === 'AbortError') jobs.delete(ref.key)
    else job.state = { ...job.state, error: (e as Error).message }
    host.changed(ref.key)
  }
}

/** 库里记过这个视频、当时没字幕的时刻块：补上原文和译文，一次提交（历史里能撤回） */
async function fillAll(ref: VideoRef, title: string, cues: Cue[]) {
  const v = host.vault()
  if (!v) return
  const changed: string[] = []
  let n = 0
  for (const f of await v.list()) {
    const cur = await v.read(f.path)
    if (!cur.text.includes(`video=${ref.key}`)) continue
    const r = fillMoments(cur.text, ref.key, cues)
    if (!r.filled) continue
    if ((await v.write(f.path, r.text, cur.text)).ok) {
      changed.push(f.path)
      n += r.filled
      // 开着的这篇编辑器跟着换（软件自己写的，监听不报）
      host.noteChanged(f.path, r.text)
    }
  }
  if (!changed.length) return
  await host.serial(() => commitPaths(v.root, changed, `视频：字幕生成好了，补上 ${n} 处时刻的原文和译文《${title.slice(0, 40)}》`))
  host.notice(`字幕生成好了，补上了${n}处时刻的原文和译文`)
}
