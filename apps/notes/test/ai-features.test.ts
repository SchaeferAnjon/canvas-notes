import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CLAUDE_EFFORTS, convPick, effortOption, fitPick, INITIAL_PREFS, modelsOf, normalizePick, normalizePrefs, pickLabel, resolvePick } from '../src/shared/ai-features'
import type { EngineInfo } from '../src/shared/agent'
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
    // task-m55m7 起 Gemini 也留选的模型（从它的命令行拉的）
    expect(s.prefs()).toEqual({ default: { engine: 'claude', model: 'sonnet' }, features: { chat: { engine: 'gemini', model: 'x' } } })
    expect(s.engine()).toBe('claude')
    s.setEngine('codex')
    expect(s.prefs().default).toEqual({ engine: 'codex' })
  })
  it('CN-91 effort：旧设置没有 effort 读得回来；Claude Code 只留那五档，Codex 留它自己的模型和档；task-m55m7 起 Gemini、OpenCode 也留模型和档（写法不对的丢掉）', () => {
    expect(normalizePick({ engine: 'claude', model: 'sonnet' })).toEqual({ engine: 'claude', model: 'sonnet' })
    expect(normalizePick({ engine: 'claude', effort: 'xhigh' })).toEqual({ engine: 'claude', model: 'claude-opus-5-5', effort: 'xhigh' })
    expect(normalizePick({ engine: 'claude', effort: 'ultra' })).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
    expect(normalizePick({ engine: 'claude', effort: 'High; rm' })).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
    expect(normalizePick({ engine: 'codex', model: 'gpt-6.1-terra', effort: 'ultra' })).toEqual({ engine: 'codex', model: 'gpt-6.1-terra', effort: 'ultra' })
    expect(normalizePick({ engine: 'codex' })).toEqual({ engine: 'codex' })
    expect(normalizePick({ engine: 'gemini', model: 'x', effort: 'high' })).toEqual({ engine: 'gemini', model: 'x', effort: 'high' })
    expect(normalizePick({ engine: 'opencode', model: 'zai/glm-5', effort: 'max' })).toEqual({ engine: 'opencode', model: 'zai/glm-5', effort: 'max' })
    expect(normalizePick({ engine: 'opencode', model: 'rm -rf /', effort: 'High; x' })).toEqual({ engine: 'opencode' })
    expect(normalizePrefs({ default: { engine: 'claude', model: 'sonnet' }, features: { chat: { engine: 'claude', model: 'haiku', effort: 'low' } } }).features.chat).toEqual({ engine: 'claude', model: 'haiku', effort: 'low' })
  })

  it('CN-91 回答头上那行带 effort：「Claude Code · Opus 5.5 · High」；Codex 选了模型写模型名；Gemini 没有 effort 不写', () => {
    expect(pickLabel({ engine: 'claude', model: 'claude-opus-5-5', effort: 'high' })).toBe('Claude Code · Opus 5.5 · High')
    expect(pickLabel({ engine: 'claude', model: 'sonnet', effort: 'xhigh' })).toBe('Claude Code · Sonnet · Extra high')
    expect(pickLabel({ engine: 'codex', effort: 'high' })).toBe('Codex · High')
    expect(pickLabel({ engine: 'codex', model: 'gpt-6.1-terra', effort: 'ultra' }, [{ id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' }])).toBe('Codex · GPT-6.1 Terra · Ultra')
    expect(pickLabel({ engine: 'gemini', effort: 'high' })).toBe('Gemini')
    expect(pickLabel({ engine: 'codex' })).toBe('Codex')
  })

  it('CN-91 每家能选的模型和档：Claude Code 三个模型各五档（Low 最快、High 讲解默认、Max 最慢最贵）；Codex 第一项是它自己的默认模型、后面是 model/list 拿到的；Gemini、OpenCode 只有默认模型、没有档', () => {
    const claude = modelsOf('claude')
    expect(claude.map((m) => m.label)).toEqual(['Opus 5.5', 'Sonnet', 'Haiku'])
    expect(claude[0]!.efforts.map((e) => [e.label, e.note ?? ''])).toEqual([
      ['Low', '最快，小追问够用'],
      ['Medium', ''],
      ['High', '讲解默认'],
      ['Extra high', '想得更久'],
      ['Max', '最慢、最贵'],
    ])
    expect(CLAUDE_EFFORTS.map((e) => e.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(modelsOf('codex').map((m) => [m.id, m.label, m.efforts.map((e) => e.id).join(',')])).toEqual([['', 'Codex 默认模型', 'low,medium,high']])
    const listed = [
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', efforts: ['low', 'high', 'ultra'].map(effortOption), defaultEffort: 'low' },
      { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium'].map(effortOption), defaultEffort: 'medium' },
    ]
    const codex = modelsOf('codex', listed)
    expect(codex.map((m) => m.label)).toEqual(['Codex 默认模型', 'GPT-6.1 Terra', 'GPT-6-Luna'])
    expect(codex[0]).toMatchObject({ id: '', defaultEffort: 'low' })
    expect(codex[0]!.efforts.map((e) => e.label)).toEqual(['Low', 'High', 'Ultra'])
    expect(modelsOf('gemini')).toEqual([{ id: '', label: 'Gemini 默认模型', efforts: [] }])
    expect(modelsOf('opencode')).toEqual([{ id: '', label: 'OpenCode 默认模型', efforts: [] }])
  })

  it('CN-91 输入框底行换模型、effort 记成「AI 对话」那一行：默认、梦游、小活不动；和默认一模一样就回到跟默认', () => {
    const d = mkdtempSync(join(tmpdir(), 'cn-aipick-'))
    try {
      const s = new AgentStore(d)
      s.setChatPick({ engine: 'claude', model: 'sonnet', effort: 'max' })
      expect(s.prefs().features.chat).toEqual({ engine: 'claude', model: 'sonnet', effort: 'max' })
      expect(s.prefs().default).toEqual({ engine: 'claude', model: 'claude-opus-5-5' })
      expect(resolvePick(s.prefs(), 'quick')).toEqual({ engine: 'claude', model: 'haiku' })
      s.setChatPick({ engine: 'codex', model: 'gpt-6-luna', effort: 'medium' })
      expect(resolvePick(s.prefs(), 'chat')).toEqual({ engine: 'codex', model: 'gpt-6-luna', effort: 'medium' })
      s.setChatPick({ engine: 'claude', model: 'claude-opus-5-5' })
      expect(s.prefs().features.chat).toBeUndefined()
      expect(() => s.setChatPick({ engine: 'nope' } as never)).toThrow('AI 参数不对')
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
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

describe('输入框底行三颗：这个对话这一问用的（CN-91 方向 C）', () => {
  const codex = modelsOf('codex', [
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(effortOption), defaultEffort: 'low' },
    { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'].map(effortOption), defaultEffort: 'medium' },
  ])
  const info = (id: 'claude' | 'codex' | 'gemini', models = modelsOf(id)) => ({ id, label: id, path: `/fake/${id}`, where: '', models, efforts: models[0]!.efforts }) as EngineInfo
  const engines = [info('claude'), info('codex', codex), info('gemini')]

  it('fitPick：没给模型用这家的默认；这个模型不认的一档换成它自己的默认档；Gemini、OpenCode 留选的模型，这个模型有那一档才带', () => {
    expect(fitPick('claude', modelsOf('claude'), {})).toEqual({ engine: 'claude', model: 'claude-opus-5-5', effort: 'high' })
    expect(fitPick('claude', modelsOf('claude'), { model: 'sonnet', effort: 'low' })).toEqual({ engine: 'claude', model: 'sonnet', effort: 'low' })
    expect(fitPick('codex', codex, { model: 'gpt-6-luna', effort: 'ultra' })).toEqual({ engine: 'codex', model: 'gpt-6-luna', effort: 'medium' })
    // Codex 自己的默认模型：模型不写，effort 照它第一档那个模型的
    expect(fitPick('codex', codex, { model: '', effort: 'high' })).toEqual({ engine: 'codex', effort: 'high' })
    expect(fitPick('gemini', modelsOf('gemini'), { model: 'x', effort: 'high' })).toEqual({ engine: 'gemini', model: 'x' })
    expect(fitPick('gemini', modelsOf('gemini'), {})).toEqual({ engine: 'gemini' })
    const oc = modelsOf('opencode', [{ id: 'zai/glm-5', label: 'GLM-5', efforts: ['low', 'high'].map(effortOption), group: 'zai' }])
    expect(fitPick('opencode', oc, { model: 'zai/glm-5', effort: 'high' })).toEqual({ engine: 'opencode', model: 'zai/glm-5', effort: 'high' })
    expect(fitPick('opencode', oc, { model: 'zai/glm-5', effort: 'max' })).toEqual({ engine: 'opencode', model: 'zai/glm-5' })
    expect(fitPick('opencode', oc, { model: 'zai/glm-5' })).toEqual({ engine: 'opencode', model: 'zai/glm-5' })
  })

  it('convPick：哪家跟「AI 对话」那一行；这个对话选过这一家的模型、effort 用自己的，选的是别家的用那一行的', () => {
    const chat = { engine: 'claude' as const, model: 'claude-opus-5-5', effort: 'high' }
    expect(convPick(engines, chat, null)).toEqual(chat)
    expect(convPick(engines, chat, { engine: 'claude', model: 'haiku', effort: 'max' })).toEqual({ engine: 'claude', model: 'haiku', effort: 'max' })
    // 这个对话选的是 Claude Code 的，现在「AI 对话」换成了 Codex：用那一行的
    expect(convPick(engines, { engine: 'codex', model: 'gpt-6-luna', effort: 'medium' }, { engine: 'claude', model: 'haiku', effort: 'max' })).toEqual({ engine: 'codex', model: 'gpt-6-luna', effort: 'medium' })
    // 只选过 effort：模型跟那一行
    expect(convPick(engines, { engine: 'codex', model: 'gpt-6-luna', effort: 'medium' }, { engine: 'codex', effort: 'xhigh' })).toEqual({ engine: 'codex', model: 'gpt-6-luna', effort: 'xhigh' })
    expect(pickLabel(convPick(engines, chat, { engine: 'claude', model: 'sonnet', effort: 'low' }))).toBe('Claude Code · Sonnet · Low')
  })

  it('选的记在这个地方的对话里：文件改名跟过去，新对话清掉', () => {
    const d = mkdtempSync(join(tmpdir(), 'cn-aipick-'))
    try {
      const st = new AgentStore(d)
      st.setPick('/库', 'file:甲.md', { engine: 'claude', model: 'sonnet', effort: 'low' })
      expect(st.chat('/库', 'file:甲.md').pick).toEqual({ engine: 'claude', model: 'sonnet', effort: 'low' })
      st.move('/库', 'file:甲.md', 'file:乙.md', '乙')
      expect(st.chat('/库', 'file:乙.md').pick).toEqual({ engine: 'claude', model: 'sonnet', effort: 'low' })
      expect(st.chat('/库', 'file:甲.md').pick).toBeUndefined()
      st.clear('/库', 'file:乙.md')
      expect(st.chat('/库', 'file:乙.md').pick).toBeUndefined()
      st.setPick('/库', 'file:乙.md', { engine: 'codex', model: '' })
      expect(st.chat('/库', 'file:乙.md').pick).toEqual({ engine: 'codex', model: '' })
      st.setPick('/库', 'file:乙.md', null)
      expect(st.chat('/库', 'file:乙.md').pick).toBeUndefined()
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
