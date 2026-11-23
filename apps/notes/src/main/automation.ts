/**
 * 自动化在主进程这一边（task-i921u「当……就……」）：把引擎（automation-engine.ts）接上 Electron——
 * IPC（契约 shared/automation.ts，window.cn.auto）、问 AI、给一行跑 AI、系统通知、梦游、周记、深链和命令行。
 *
 * 对外接口（设计说明在 docs/DEVELOPMENT.md「自动化」）：
 * - 规则就是库里的文件：外部软件、AI 写 base 块的 automations 或 .canvas-notes/自动化.md 就能加规则（引擎扫到就认）；
 * - 深链 canvas-notes://automation/run?name=<规则名>[&where=<数据库那篇的名字或路径>]，命令行 apps/notes/scripts/automation.mjs 发这个深链；
 * - 软件没开着时打开软件也带得进来（macOS 先起软件再交 open-url，库打开后再跑）。
 */
import { type AutoRule, LIB_WHERE, pickOf } from '@cn/format'
import { app, type BrowserWindow, ipcMain, Notification } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AutoButtonReq, AutoLogReq, AutoLogRow, AutoPrefs, AutoRef, AutoRunReq, AutoSaveReq, AutoSentenceReq, AutoSystemInfo, AutoTrialReq } from '../shared/automation'
import { ask } from './ai'
import { runAiRow } from './ai-column'
import { weekInfo } from './ai-cmds'
import { columnPick } from './agent'
import { writeFileAtomic } from './atomic'
import { AutoEngine } from './automation-engine'
import { E2E } from './test-mode'
import type { Vault } from './vault'

const DEFAULT_PREFS: AutoPrefs = { on: true, missed: 'once', notify: true }

/** 这台 Mac 上的：设置、每个库上次看到几点（设置目录 automation.json） */
interface Local {
  prefs: AutoPrefs
  seen: Record<string, string>
}

function loadLocal(file: string): Local {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<Local>
    const p = (j.prefs ?? {}) as Partial<AutoPrefs>
    return {
      prefs: { on: typeof p.on === 'boolean' ? p.on : DEFAULT_PREFS.on, missed: p.missed === 'skip' ? 'skip' : 'once', notify: typeof p.notify === 'boolean' ? p.notify : DEFAULT_PREFS.notify },
      seen: j.seen && typeof j.seen === 'object' ? (j.seen as Record<string, string>) : {},
    }
  } catch {
    // 没有、坏了：照默认（这一份只是这台 Mac 的设置和钟点，丢了最多少补跑一次）
    return { prefs: { ...DEFAULT_PREFS }, seen: {} }
  }
}

export interface AutomationDeps {
  vault(): Vault | null
  win(): BrowserWindow | null
  userData: string
  /** 梦游：开关（设置 › 梦游「自己梦游」）、现在梦游、只做归类、这周整理了什么 */
  dream: {
    on(): boolean
    setOn(on: boolean): void
    now(): Promise<unknown>
    tidyInbox(): Promise<{ moved: number; stay: number; notes: string[] }>
    weekItems(from: number): Promise<string[]>
  }
}

// ---------------------------------------------------------------- 检查界面交过来的

const isWhere = (w: unknown): w is string => typeof w === 'string' && (w === LIB_WHERE || /^[^/][^]*\.md#\d+$/i.test(w)) && !w.split('/').includes('..')
function needWhere(w: unknown): string {
  if (!isWhere(w)) throw new Error('自动化参数不对：where')
  return w
}
function needRef(r: unknown): AutoRef {
  const o = r as Partial<AutoRef> | null
  if (!o || !Number.isInteger(o.index) || (o.index as number) < 0) throw new Error('自动化参数不对：ref')
  return { where: needWhere(o.where), index: o.index as number }
}
const needPath = (p: unknown) => {
  if (typeof p !== 'string' || !/\.md$/i.test(p) || p.startsWith('/') || p.split('/').includes('..')) throw new Error('自动化参数不对：path')
  return p
}
/** 规则：大体样子对（名字、三段是列表）；细的由 checkRule 说 */
function needRule(r: unknown): AutoRule {
  const o = r as Partial<AutoRule> | null
  if (!o || typeof o.name !== 'string' || typeof o.on !== 'boolean' || !Array.isArray(o.when) || !Array.isArray(o.do) || (o.if !== null && typeof o.if !== 'object') || !(o.missed === null || o.missed === 'once' || o.missed === 'skip')) throw new Error('自动化参数不对：rule')
  return o as AutoRule
}

export function setupAutomation(d: AutomationDeps) {
  const file = join(d.userData, 'automation.json')
  const local = loadLocal(file)
  const saveLocal = () => void writeFileAtomic(file, JSON.stringify(local, null, 2)).catch((e) => console.error('存自动化设置失败', e))
  const send = (ch: string, payload?: unknown) => {
    const w = d.win()
    if (w && !w.isDestroyed()) w.webContents.send(ch, payload)
  }
  /** 测试模式不上用户的屏幕：系统通知只记下来（globalThis.cnScreen） */
  const notify = (title: string, body: string) => {
    if (E2E) {
      ;(globalThis as unknown as { cnScreen?: string[] }).cnScreen?.push(`系统通知：${title}：${body}`)
      return
    }
    if (Notification.isSupported()) new Notification({ title, body }).show()
  }

  const engine = new AutoEngine({
    vault: d.vault,
    now: () => (process.env.CN_AUTO_NOW ? new Date(process.env.CN_AUTO_NOW) : new Date()),
    prefs: () => local.prefs,
    lastSeen: (root) => local.seen[root] ?? null,
    setLastSeen: (root, t) => {
      local.seen[root] = t
      saveLocal()
    },
    async ask(system, prompt, signal, use) {
      const { pick, by } = columnPick(use ? pickOf(use) : null)
      const text = await ask(system, prompt, signal, () => {}, 'chat', { pick })
      return { text, by }
    },
    aiRow: (v, req, tell) => runAiRow(v, req, tell),
    notify,
    tell: (path, text) => {
      const w = d.win()
      if (w && !w.isDestroyed()) w.webContents.send('note:changed', path, text)
    },
    emit: (ch, payload) => (ch === 'files:changed' ? send('files:changed') : send(ch, payload)),
    weekFacts: (v, now) => weekInfo(v, now),
    dreamItems: (from) => d.dream.weekItems(from),
    async tidyInbox() {
      const r = await d.dream.tidyInbox()
      return { did: r.moved ? `梦游把收件箱里 ${r.moved} 篇归了类${r.stay ? `，${r.stay} 篇拿不准留着` : ''}（梦游报告里能撤回）` : `收件箱里没有要挪的${r.notes.length ? '：' + r.notes[0] : ''}`, files: [] }
    },
    settleMs: Number(process.env.CN_AUTO_SETTLE_MS) || 4000,
    builtInClock: !E2E,
  })

  // ---------------------------------------------------------------- IPC

  const dreamInfo = (): AutoSystemInfo => ({ id: 'dream', name: '梦游', on: d.dream.on(), desc: d.dream.on() ? '闲时自己整理库，改完给你看' : '关着：只在点「现在梦游」时梦游' })
  ipcMain.handle('auto:list', async (_e, where: unknown) => ({ ...(await engine.listing(local.prefs, where === undefined || where === null ? undefined : needWhere(where))), system: [dreamInfo()] }))
  ipcMain.handle('auto:save', async (_e, req: unknown) => {
    const r = req as Partial<AutoSaveReq> | null
    const index = r?.index === null ? null : Number.isInteger(r?.index) ? (r!.index as number) : NaN
    if (Number.isNaN(index)) throw new Error('自动化参数不对：index')
    return engine.writeRule(needWhere(r?.where), { set: { index, rule: needRule(r?.rule) } })
  })
  ipcMain.handle('auto:toggle', async (_e, ref: unknown, on: unknown) => {
    const f = needRef(ref)
    if (typeof on !== 'boolean') throw new Error('自动化参数不对：on')
    await engine.loadPlaces()
    const rule = engine.places.find((p) => p.where === f.where)?.rules[f.index]
    if (!rule) return { ok: false, error: '找不到这一条规则' }
    return engine.writeRule(f.where, { set: { index: f.index, rule: { ...rule, on } } })
  })
  ipcMain.handle('auto:remove', (_e, ref: unknown) => {
    const f = needRef(ref)
    return engine.writeRule(f.where, { remove: f.index })
  })
  ipcMain.handle('auto:run', (_e, req: unknown) => {
    const r = req as Partial<AutoRunReq> | null
    return engine.runNow(needRef(r?.ref), r?.path === undefined ? undefined : needPath(r.path))
  })
  ipcMain.handle('auto:button', (_e, req: unknown) => {
    const r = req as Partial<AutoButtonReq> | null
    if (typeof r?.col !== 'string' || !r.col) throw new Error('自动化参数不对：col')
    return engine.button(needWhere(r.where), r.col, needPath(r.path), r.confirmed === true)
  })
  ipcMain.handle('auto:stop', (_e, run: unknown) => (typeof run === 'number' ? engine.stopRun(run) : false))
  ipcMain.handle('auto:trial', (_e, req: unknown) => {
    const r = req as Partial<AutoTrialReq> | null
    return engine.trial(needWhere(r?.where), needRule(r?.rule), r?.path === undefined ? undefined : needPath(r.path))
  })
  ipcMain.handle('auto:log', async (_e, req: unknown): Promise<AutoLogRow[]> => {
    const r = (req ?? {}) as AutoLogReq
    const all = await engine.readLog()
    const undone = new Set(all.filter((x) => x.undo).map((x) => x.undo!))
    const limit = Number.isInteger(r.limit) && r.limit! > 0 ? Math.min(r.limit!, 500) : 100
    return all
      .filter((x) => (!r.where || x.where === r.where) && (!r.rule || x.rule === r.rule))
      .reverse()
      .slice(0, limit)
      .map((x) => ({ ...x, undone: undone.has(x.id) }))
  })
  ipcMain.handle('auto:undo', (_e, id: unknown) => {
    if (typeof id !== 'string' || !/^[\w-]{4,40}$/.test(id)) throw new Error('自动化参数不对：id')
    return engine.undo(id)
  })
  let sentence: AbortController | null = null
  ipcMain.handle('auto:fromSentence', async (_e, req: unknown) => {
    const r = req as Partial<AutoSentenceReq> | null
    if (typeof r?.sentence !== 'string' || r.sentence.length > 2000) throw new Error('自动化参数不对：sentence')
    sentence?.abort()
    const ctl = (sentence = new AbortController())
    try {
      return await engine.fromSentence(r.sentence, needWhere(r.where), AbortSignal.any([ctl.signal, AbortSignal.timeout(3 * 60_000)]))
    } finally {
      if (sentence === ctl) sentence = null
    }
  })
  ipcMain.handle('auto:prefs', (_e, patch: unknown) => {
    if (patch && typeof patch === 'object') {
      const p = patch as Partial<AutoPrefs>
      if (typeof p.on === 'boolean') local.prefs.on = p.on
      if (p.missed === 'once' || p.missed === 'skip') local.prefs.missed = p.missed
      if (typeof p.notify === 'boolean') local.prefs.notify = p.notify
      saveLocal()
      send('auto:changed')
    }
    return local.prefs
  })
  ipcMain.handle('auto:system', (_e, id: unknown, on: unknown) => {
    if (id !== 'dream') throw new Error('自动化参数不对：id')
    if (typeof on === 'boolean') d.dream.setOn(on)
    return dreamInfo()
  })
  ipcMain.handle('auto:systemRun', async (_e, id: unknown) => {
    if (id !== 'dream') throw new Error('自动化参数不对：id')
    await d.dream.now()
  })

  // ---------------------------------------------------------------- 深链、命令行

  /** 库还没打开时来的（软件刚被深链叫起来）：等库打开再跑 */
  let waiting: { name: string; where?: string }[] = []
  const runLink = async (name: string, where?: string) => {
    if (!d.vault()) {
      waiting.push({ name, ...(where ? { where } : {}) })
      return
    }
    const r = await engine.runByName(name, where)
    if ('error' in r) {
      console.error('深链跑自动化：', r.error)
      notify('自动化', r.error)
    }
  }
  const fromUrl = (raw: string) => {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return
    }
    if (u.protocol !== 'canvas-notes:' || u.hostname !== 'automation' || u.pathname.replace(/\/+$/, '') !== '/run') return
    const name = u.searchParams.get('name')?.trim()
    if (!name) return
    void runLink(name, u.searchParams.get('where')?.trim() || undefined)
  }
  app.on('open-url', (_e, url) => fromUrl(url))
  // 直接起软件时带上 --run-automation=<规则名>（[--automation-where=…]）
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
  const argName = arg('run-automation')
  if (argName) waiting.push({ name: argName, ...(arg('automation-where') ? { where: arg('automation-where')! } : {}) })

  return {
    engine,
    /** 打开了一个库（换库也是）：从头读规则、补跑错过的；排着的深链这时跑 */
    async open() {
      engine.stop()
      await engine.start()
      const w = waiting
      waiting = []
      for (const x of w) await runLink(x.name, x.where)
    },
    /** 库里有东西变了 */
    changed: () => engine.changed(),
    /** 周记那条开着：梦游不再另写本周小结（并进周记，用户定的 ⑥） */
    weekOn: () => engine.places.some((p) => p.where === LIB_WHERE && p.rules.some((r) => r.on && r.do.some((s) => s.do === 'newNote' && s.folder === '周记'))),
    /** 测试、深链用 */
    fromUrl,
    stop: () => engine.stop(),
  }
}
