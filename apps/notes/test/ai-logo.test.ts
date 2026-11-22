import { describe, expect, it } from 'vitest'
import { type AiUses, commandJob, logoOf, usesOf } from '../src/shared/ai-logo'
import { normalizePrefs } from '../src/shared/ai-features'

const uses: AiUses = { chat: 'claude', dream: 'claude', vision: 'claude', quick: 'claude', translate: 'claude' }

describe('AI 图标画哪家的标志（偏好「AI 图标用引擎标志」）', () => {
  it('⌘K 和 AI 输入框里的命令：交给 AI 对话那家跑的、交给梦游那家跑的，不经 AI 的不算', () => {
    for (const name of ['整理收件箱', '整理当前白板', '总结这块白板', '写成文章', '翻译']) expect(commandJob(name)).toBe('chat')
    expect(commandJob('现在梦游')).toBe('dream')
    // 找重复是本机比对文字、剪藏这一页只是抽正文存进收件箱，都不经 AI 引擎
    expect(commandJob('找重复')).toBeNull()
    expect(commandJob('剪藏这一页')).toBeNull()
    expect(commandJob('新建笔记')).toBeNull()
    // 带不带斜杠都认
    expect(commandJob('/整理收件箱')).toBe('chat')
  })

  it('每件活画跑它的那一家；翻译跟「译 · 某家」走，没有能翻的就不画标志（照旧画「ab」）', () => {
    const u: AiUses = { chat: 'codex', dream: 'gemini', vision: 'claude', quick: 'opencode', translate: 'deepseek' }
    expect(logoOf('chat', u)).toBe('codex')
    expect(logoOf('dream', u)).toBe('gemini')
    expect(logoOf('vision', u)).toBe('claude')
    expect(logoOf('quick', u)).toBe('opencode')
    expect(logoOf('translate', u)).toBe('deepseek')
    expect(logoOf('translate', { ...u, translate: null })).toBeNull()
    expect(logoOf('chat', uses)).toBe('claude')
  })

  it('设置 › AI 默认换成 Codex：AI 对话、梦游跟着换；单独指定过的小活、只有 Claude Code 能做的看图问不变', () => {
    const p = normalizePrefs({ default: { engine: 'codex' }, features: { quick: { engine: 'claude', model: 'haiku' } } })
    expect(usesOf(p)).toEqual({ chat: 'codex', dream: 'codex', vision: 'claude', quick: 'claude', cards: 'codex' })
    // 小活选的那家这台 Mac 上没装：跟主进程一样退回默认那家
    expect(usesOf(p, (id) => id !== 'claude')).toEqual({ chat: 'codex', dream: 'codex', vision: 'claude', quick: 'codex', cards: 'codex' })
  })
})
