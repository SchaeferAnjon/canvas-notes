/**
 * AI 浮窗的对话记录和选的引擎，存在软件设置目录（userData/ai/），不进库。
 * 每个库一份对话；每家引擎记着自己的会话号，下次接着聊。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineId, StoredMsg } from '../../shared/agent'

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

  engine(): EngineId {
    const e = this.read<{ engine?: string }>('settings.json', {}).engine
    return ENGINES.includes(e as EngineId) ? (e as EngineId) : 'claude'
  }

  setEngine(e: EngineId) {
    if (!ENGINES.includes(e)) throw new Error('没有这个引擎')
    this.write('settings.json', { ...this.read<object>('settings.json', {}), engine: e })
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
