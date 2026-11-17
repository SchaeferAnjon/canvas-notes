/**
 * AI 浮窗的对话记录和选的引擎，存在软件设置目录（userData/ai/），不进库。
 * 每个库一份对话；每家引擎记着自己的会话号，下次接着聊。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineId, StoredMsg } from '../../shared/agent'
import { type AiPrefs, CLAUDE_DEFAULT, normalizePrefs, resolvePick } from '../../shared/ai-features'

const ENGINES: EngineId[] = ['claude', 'codex', 'gemini', 'opencode']

interface Chat {
  vault: string
  msgs: StoredMsg[]
  sessions: Partial<Record<EngineId, string>>
}

export class AgentStore {
  constructor(private dir: string) {}

  private read<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as T
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw e
    }
  }

  private write(name: string, value: unknown) {
    mkdirSync(this.dir, { recursive: true })
    const p = join(this.dir, name)
    // 先写临时文件再换名，写到一半退出也不会坏
    writeFileSync(p + '.tmp', JSON.stringify(value))
    renameSync(p + '.tmp', p)
  }

  /** 默认那家（设置 › AI 的「默认」） */
  engine(): EngineId {
    return this.prefs().default.engine
  }

  /** 设置 › AI：默认和每个功能用哪家哪个模型（旧的设置只有 engine 一项，读成默认） */
  prefs(): AiPrefs {
    const s = this.read<{ engine?: string; prefs?: unknown }>('settings.json', {})
    return normalizePrefs(s.prefs, ENGINES.includes(s.engine as EngineId) ? (s.engine as EngineId) : undefined)
  }

  setPrefs(p: AiPrefs) {
    const n = normalizePrefs(p)
    this.write('settings.json', { ...this.read<object>('settings.json', {}), engine: n.default.engine, prefs: n })
  }

  /** 换默认那家（Claude Code 用它的默认模型） */
  setEngine(e: EngineId) {
    if (!ENGINES.includes(e)) throw new Error('没有这个引擎')
    const p = this.prefs()
    this.setPrefs({ ...p, default: p.default.engine === e ? p.default : { engine: e } })
  }

  /**
   * 换「AI 对话」用哪家（AI 面板头上的引擎菜单）：只改这一行，默认和别的功能不动。
   * 选的就是默认那家：回到「跟默认」；已经在用这家：不变（Claude Code 选好的模型留着）
   */
  setChatEngine(e: EngineId) {
    if (!ENGINES.includes(e)) throw new Error('没有这个引擎')
    const p = this.prefs()
    if (resolvePick(p, 'chat').engine === e) return
    const features = { ...p.features }
    if (p.default.engine === e) delete features.chat
    else features.chat = e === 'claude' ? { engine: e, model: CLAUDE_DEFAULT } : { engine: e }
    this.setPrefs({ ...p, features })
  }

  private file(vault: string) {
    return `chat-${createHash('sha1').update(vault).digest('hex').slice(0, 12)}.json`
  }

  chat(vault: string): Chat {
    return this.read<Chat>(this.file(vault), { vault, msgs: [], sessions: {} })
  }

  saveMsgs(vault: string, msgs: StoredMsg[]) {
    // 最多留最近 200 条
    this.write(this.file(vault), { ...this.chat(vault), vault, msgs: msgs.slice(-200) })
  }

  setSession(vault: string, engine: EngineId, session: string | undefined) {
    const c = this.chat(vault)
    this.write(this.file(vault), { ...c, sessions: { ...c.sessions, [engine]: session } })
  }

  clear(vault: string) {
    this.write(this.file(vault), { vault, msgs: [], sessions: {} })
  }
}
