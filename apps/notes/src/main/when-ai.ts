/**
 * 认时间交给 AI 的那一问（task-pd289）：待办这一行本地认不出、看着有时间词时，界面问 when:ai。
 * 用设置 › AI「小活」那一家（选的那家没装时退回默认那家，agent/index.ts 的 pickFor），Claude Code 一律用 Haiku（CN_FAST_MODEL 能换）；
 * 不给工具、不留会话记录，工作目录是软件设置目录里单独一格（库里的 CLAUDE.md 不掺进来）。超时 8 秒，只送这一行和今天几号几点。
 * 回答照 @cn/tasks 的 whenFromAi 验过才交回；没装、没登录、没网、超时、答得不对都交回 null（界面只用本地规则，不报错）。
 * CN_AI_FAKE=1：不调模型，照 shared/when-ai.ts 的假回答（CN_AI_FAKE_MS 假装想多久）；CN_FAKE_WHEN_LOG 给了就一问记一行（测试看送了什么、用的哪家哪个模型）。
 */
import { type When, WHEN_AI_SYSTEM, whenAiPrompt, whenFromAi } from '@cn/tasks'
import { app, ipcMain } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pickLabel } from '../shared/ai-features'
import { fakeWhenAnswer } from '../shared/when-ai'
import { engine, engineReady, FAST_MODEL, modelOpt, pickFor } from './agent'

const FAKE = () => process.env.CN_AI_FAKE === '1'
export const WHEN_TIMEOUT_MS = 8000

/** 这一问用哪家、哪个模型：小活那一家；Claude Code 换成 Haiku */
export function whenPick(): { engine: ReturnType<typeof pickFor>['engine']; model?: string; effort?: string } {
  const p = pickFor('quick')
  if (p.engine === 'claude') return { engine: 'claude', model: FAST_MODEL }
  const o = modelOpt('quick', p.engine)
  return { engine: p.engine, ...o }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(Object.assign(new Error('超时'), { name: 'AbortError' }))))
  })

export async function askWhen(text: string, now: string): Promise<When | null> {
  const line = text.replace(/[\r\n]+/g, ' ').trim().slice(0, 300)
  if (!line || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(now)) return null
  const pick = whenPick()
  if (process.env.CN_FAKE_WHEN_LOG) appendFileSync(process.env.CN_FAKE_WHEN_LOG, JSON.stringify({ text: line, now, engine: pick.engine, model: pick.model ?? null }) + '\n')
  const signal = AbortSignal.timeout(WHEN_TIMEOUT_MS)
  try {
    let answer: string
    if (FAKE()) {
      await sleep(Number(process.env.CN_AI_FAKE_MS ?? 300), signal)
      answer = fakeWhenAnswer(line, now)
    } else {
      if (!engineReady(pick.engine)) return null
      const cwd = join(app.getPath('userData'), 'ai-when')
      mkdirSync(cwd, { recursive: true })
      const r = await engine(pick.engine).run({ prompt: whenAiPrompt(line, now), system: WHEN_AI_SYSTEM, cwd, signal, onText: () => {}, ...(pick.model ? { model: pick.model } : {}), ...(pick.effort ? { effort: pick.effort } : {}) })
      answer = r.text
    }
    return whenFromAi(answer, line, now)
  } catch (e) {
    // 没网、没登录、超时：只用本地规则，不报错（记一行，查问题时看）
    console.warn('认时间问 AI 没成：', (e as Error).message ?? e)
    return null
  }
}

export function registerWhen() {
  ipcMain.handle('when:ai', (_e, text: unknown, now: unknown) => (typeof text === 'string' && typeof now === 'string' ? askWhen(text, now) : null))
  ipcMain.handle('when:engine', () => {
    const p = whenPick()
    if (!FAKE() && !engineReady(p.engine)) return null
    return { id: p.engine, label: pickLabel({ engine: p.engine, ...(p.model ? { model: p.model } : {}) }) }
  })
}
