import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { INITIAL_PREFS, normalizePrefs, pickLabel, resolvePick } from '../src/shared/ai-features'
import { AgentStore } from '../src/main/agent/store'

const dir = mkdtempSync(join(tmpdir(), 'cn-aifeat-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('设置 › AI 每个功能用哪家（CN-44 方向 A）', () => {
  it('从没设过：都跟默认 Claude Code · Opus 5.5，小活是 Claude Code · Haiku', () => {
    const p = normalizePrefs(undefined)
    expect(p).toEqual(INITIAL_PREFS)
    expect(pickLabel(resolvePick(p, 'chat'))).toBe('Claude Code · Opus 5.5')
    expect(pickLabel(resolvePick(p, 'dream'))).toBe('Claude Code · Opus 5.5')
    expect(pickLabel(resolvePick(p, 'quick'))).toBe('Claude Code · Haiku')
  })
  it('单独指定的功能用自己的；看图问只有 Claude Code 能做，默认换成别家时它还是 Claude Code', () => {
    const p = normalizePrefs({ default: { engine: 'codex' }, features: { dream: { engine: 'claude', model: 'haiku' } } })
    expect(resolvePick(p, 'chat')).toEqual({ engine: 'codex' })
    expect(pickLabel(resolvePick(p, 'chat'))).toBe('Codex')
    expect(resolvePick(p, 'dream')).toEqual({ engine: 'claude', model: 'haiku' })
    expect(resolvePick(p, 'vision')).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
    // 明确设过 features 时没写的就是跟默认（小活也跟默认）
    expect(resolvePick(p, 'quick')).toEqual({ engine: 'codex' })
  })
  it('旧设置只有 engine：读成默认那家；存回去再读一样；不认识的丢掉', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ engine: 'opencode' }))
    const s = new AgentStore(dir)
    expect(s.engine()).toBe('opencode')
    expect(s.prefs().features.quick).toEqual({ engine: 'claude', model: 'haiku' })
    s.setPrefs({ default: { engine: 'claude', model: 'sonnet' }, features: { chat: { engine: 'gemini', model: 'x' }, vision: { engine: 'nope' } } as never })
    expect(s.prefs()).toEqual({ default: { engine: 'claude', model: 'sonnet' }, features: { chat: { engine: 'gemini' } } })
    expect(s.engine()).toBe('claude')
    s.setEngine('codex')
    expect(s.prefs().default).toEqual({ engine: 'codex' })
  })
  it('AI 面板头上换引擎只改「AI 对话」那一行：默认、梦游、小活不动；选回默认那家就是跟默认；已经在用的那家不变（Claude Code 的模型留着）', () => {
    const d = mkdtempSync(join(tmpdir(), 'cn-aichat-'))
    try {
      const s = new AgentStore(d)
      s.setChatEngine('gemini')
      expect(s.prefs().default).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
      expect(resolvePick(s.prefs(), 'chat')).toEqual({ engine: 'gemini' })
      expect(resolvePick(s.prefs(), 'dream')).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
      expect(resolvePick(s.prefs(), 'quick')).toEqual({ engine: 'claude', model: 'haiku' })
      s.setChatEngine('claude')
      expect(s.prefs().features.chat).toBeUndefined()
      expect(resolvePick(s.prefs(), 'chat')).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
      s.setPrefs({ ...s.prefs(), features: { ...s.prefs().features, chat: { engine: 'claude', model: 'sonnet' } } })
      s.setChatEngine('claude')
      expect(resolvePick(s.prefs(), 'chat')).toEqual({ engine: 'claude', model: 'sonnet' })
      s.setPrefs({ ...s.prefs(), default: { engine: 'codex' }, features: { quick: { engine: 'claude', model: 'haiku' } } })
      s.setChatEngine('claude')
      expect(s.prefs().default).toEqual({ engine: 'codex' })
      expect(resolvePick(s.prefs(), 'chat')).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
      expect(resolvePick(s.prefs(), 'dream')).toEqual({ engine: 'codex' })
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
