/**
 * 自动化的引擎（task-i921u「当……就……」）：认出该跑的、一步步做、写盘、一次提交、记一行、撤回。
 * 写法和纯函数在 packages/format（automation.ts、automation-run.ts）；这里不碰 Electron（问 AI、给一行跑 AI、发通知、
 * 交给界面跑命令都由调的人给），单元测试直接跑（test/automation-engine.test.ts）。接 IPC、深链在 main/automation.ts。
 *
 * - 四种触发：新加一条（一篇新出现、停手 settleMs 不再变了才算，新建一条先起名再填金额，填完才跑）、某一列改了
 *   （比改之前、之后开头那一串，谁改的都算，自动化自己改的除外）、到了某一列的日子、定时。
 * - 不连锁：自动化写的每一篇记下写成的字（own），扫到一样的字不算改动；按钮写的不记，照样触发自动化（照 Notion）。
 * - 每跑一次：这几篇里用户没提交的字先单独提交，写盘，记录（.canvas-notes/自动化记录/2026-11.jsonl）加一行，和改动一起一次提交；
 *   只发了通知、没改文件的那一行不单独提交，跟下一次提交一起进。
 * - 错过的：记着这台 Mac 上次看到几点（state），打开时 (上次, 现在] 里该跑的每条只补最近一次（missed: skip 记一行跳过）；
 *   记录里同一条同一个钟点已经有了（另一台 Mac 跑过）就不跑。
 * - 出错：记录一行写原因，自动跑的那条写 on: false 停下（修好再打开，照 Notion），和这次一起提交。
 * - 撤回：那一次改的文件还是那次写成的样子就换回去（新建的删掉），一次提交，记录多一行「撤回了」。
 */
import * as git from '@cn/git'
import {
  allColumns,
  AUTO_LIB_PATH,
  AUTO_LOG_DIR,
  type AiColDef,
  aiCallout,
  type AutoLogEntry,
  type AutoRule,
  type AutoScope,
  type AutoStep,
  type AutoWhen,
  type AutoWhere,
  autoAsk,
  autoParse,
  baseBlocks,
  baseContext,
  type BaseCtx,
  type BaseDoc,
  baseWhere,
  checkRule,
  dateFireAt,
  fieldValues,
  fieldChanges,
  fillTemplate,
  filterFromYaml,
  type FileWrite,
  LIB_WHERE,
  logId,
  logLine,
  logPathOf,
  nextSlot,
  parseAutomations,
  parseBaseDoc,
  parseLibrary,
  parseLog,
  parseWhere,
  recordHolds,
  removeAutomation,
  removeLibRule,
  replaceBaseBlock,
  rowVars,
  type RowEvent,
  ruleLines,
  ruleSentence,
  ruleStats,
  setAutomation,
  setLibRule,
  setProp,
  slotsIn,
  stampText,
  stepLabel,
  timeVars,
  undoneIds,
  whenFits,
  whenLabel,
  writeCell,
} from '@cn/format'
import { newTaskLine, parseQuick } from '@cn/tasks'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AutoButtonInfo, AutoDone, AutoListing, AutoPrefs, AutoRef, AutoRuleInfo, AutoStarted, AutoTrial, AutoWriteResult } from '../shared/automation'
import type { AiRowRequest, AiRowResult } from './ai-column'
import { dueText } from '../shared/when'
import { addTodoText } from './todo-edit'
import type { Vault } from './vault'

/** 这一周的事（写这周的周记要的；main/ai-cmds.ts 的 weekInfo） */
export interface WeekFacts {
  week: string
  from: string
  to: string
  notes: { path: string; title: string; excerpt: string }[]
  books: { title: string; kind: 'book' | 'pdf'; items: string[] }[]
}

export interface EngineDeps {
  vault(): Vault | null
  now(): Date
  prefs(): AutoPrefs
  /** 这台 Mac 上次看到几点（库 → 2026-11-22T21:00:00）：补跑从这里算起 */
  lastSeen(root: string): string | null
  setLastSeen(root: string, t: string): void
  /** 问一次 AI（不给工具）；use 是规则里写的「家/模型/想多久」；交回字和「Claude Code · Opus 5.5」 */
  ask(system: string, prompt: string, signal: AbortSignal, use?: string): Promise<{ text: string; by: string }>
  /** 给一行跑一次 AI（ai-column.ts 的 runAiRow） */
  aiRow(v: Vault, req: AiRowRequest, tell: (path: string, text: string) => void): Promise<AiRowResult>
  /** 系统通知（测试模式只记下来） */
  notify(title: string, body: string): void
  /** 开着这篇的编辑器合进来 */
  tell(path: string, text: string): void
  /** 发给界面：auto:started / auto:done / auto:command / auto:changed、files:changed */
  emit(ch: string, payload?: unknown): void
  /** 这一周写了、剪了什么（写这周的周记） */
  weekFacts?(v: Vault, now: Date): Promise<WeekFacts>
  /** 这周梦游整理了什么（收下了的那几条；from 是这周一 0 点） */
  dreamItems?(from: number): Promise<string[]>
  /** 整理收件箱（梦游的归类那一步） */
  tidyInbox?(signal: AbortSignal): Promise<{ did: string; files: string[] }>
  /** 「新加一条」停手多久才算填完（毫秒，默认 4000） */
  settleMs?: number
  /**
   * 库里还没有自动化.md 时，软件自带的那几条（defaultLibRules）到点跑不跑（默认跑）。测试模式给 false：
   * 不因为跑测试时的钟点补跑周记、整理收件箱，测试要它们就自己写自动化.md 或在设置里打开
   */
  builtInClock?: boolean
}

/** 读到的一处规则 */
interface Place {
  where: AutoWhere
  /** 那篇文档（库里的是自动化.md） */
  doc: string
  /** 第几个 base 块（库里的是 -1） */
  block: number
  /** base 块的 YAML（库里的是空字） */
  src: string
  base: BaseDoc | null
  rules: AutoRule[]
}

interface RunCtx {
  where: AutoWhere
  place: Place | null
  rule: AutoRule
  name: string
  path: string | null
  why: string
  by: AutoLogEntry['by']
  slot?: string
  /** 按钮：写的不记成自动化写的（照样触发自动化） */
  button?: boolean
}

interface Job {
  run: number
  ctl: AbortController
  done: Promise<AutoDone>
}

const nameOf = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const isWritable = (p: string) => /\.md$/i.test(p) && !p.startsWith('/') && !p.split('/').includes('..')

/** 周记模板（库里没有「周记/模板.md」时）：照设计页，开头写这一周是哪几天、来自哪一条自动化 */
export const WEEK_TEMPLATE = '---\n这一周: {{周一}}—{{周日}}\n来自: 自动化「{{规则}}」\n---\n# {{年}}-W{{周}}\n\n## 这周最想记住的\n\n## 下周想做\n\n- [ ] \n' // 不翻：写进文件的模板
/** 周记里 AI 那一块的头一个词 */
export const WEEK_LABEL = 'AI 本周摘要' // 不翻：写进文件

export class AutoEngine {
  /** 每一处的规则（每次扫重读） */
  places: Place[] = []
  /** 盯着的文件夹 → 每一篇开头那一串（JSON） */
  private snap = new Map<string, Map<string, string>>()
  /** 新出现、还在填的：路径 → 最后一次变的时候 */
  private pending = new Map<string, number>()
  /** 自动化自己写成的字：扫到一样的不算改动 */
  private own = new Map<string, string>()
  private scanTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private jobs = new Map<number, Job>()
  private nextRun = 1
  private root: string | null = null
  constructor(private d: EngineDeps) {}

  // ---------------------------------------------------------------- 开、关

  /** 打开一个库：读规则、记下每一篇现在的样子（不算新加）、补跑错过的、开始每 30 秒看一次钟 */
  async start(): Promise<void> {
    const v = this.d.vault()
    if (!v) return
    this.root = v.root
    this.snap.clear()
    this.pending.clear()
    await this.scan(true)
    await this.tick()
    this.tickTimer = setInterval(() => void this.tick().catch((e) => console.error('自动化看钟出错', e)), 30_000)
  }

  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.tickTimer = this.scanTimer = null
    for (const j of this.jobs.values()) j.ctl.abort()
  }

  /** 库里有东西变了（编辑器存了、外面改了、新文件）：停一会儿再扫 */
  changed() {
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      void this.scan(false).catch((e) => console.error('自动化扫改动出错', e))
    }, 300)
  }

  /** 排着的都跑完（测试用） */
  idle(): Promise<unknown> {
    return this.queue
  }

  // ---------------------------------------------------------------- 读规则

  private async libText(v: Vault): Promise<string | null> {
    try {
      return (await v.read(AUTO_LIB_PATH)).text
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  async loadPlaces(): Promise<Place[]> {
    const v = this.d.vault()
    if (!v) return []
    const out: Place[] = [{ where: LIB_WHERE, doc: AUTO_LIB_PATH, block: -1, src: '', base: null, rules: parseLibrary(await this.libText(v)) }]
    for (const [path, text] of await v.texts()) {
      if (!text.includes('```base')) continue
      for (const b of baseBlocks(text)) {
        const rules = parseAutomations(b.src)
        const base = parseBaseDoc(b.src)
        const hasButton = Object.values(base.props).some((p) => p.type === 'button')
        if (rules.length || hasButton) out.push({ where: baseWhere(path, b.index), doc: path, block: b.index, src: b.src, base, rules })
      }
    }
    this.places = out
    return out
  }

  /**
   * 指向一处（试跑、一句话填规则、存第一条）：读过的规则里有就用；数据库块里还没有规则、也没有按钮列（places 里没有它）时
   * 照 where 现读那一篇的那一块。库里的总在 places 里；读不到（那篇不在、没有第几块）是 null
   */
  async placeOf(where: AutoWhere): Promise<Place | null> {
    await this.loadPlaces()
    const have = this.place(where)
    if (have) return have
    const w = parseWhere(where)
    const v = this.d.vault()
    if (!w || !v || !existsSync(v.abs(w.doc))) return null
    const b = baseBlocks((await v.read(w.doc)).text)[w.block]
    return b ? { where, doc: w.doc, block: w.block, src: b.src, base: parseBaseDoc(b.src), rules: parseAutomations(b.src) } : null
  }

  private place(where: AutoWhere): Place | null {
    return this.places.find((p) => p.where === where) ?? null
  }

  /** 数据源里每一篇（从库的全文缓存） */
  private async records(folder: string | null): Promise<{ path: string; text: string }[]> {
    const v = this.d.vault()
    if (!v || folder === null) return []
    const out: { path: string; text: string }[] = []
    for (const [path, text] of await v.texts()) if (/\.md$/i.test(path) && (folder === '' || path.startsWith(folder + '/'))) out.push({ path, text })
    // 按路径排：库的全文缓存是读完一篇记一篇，先后跟着哪篇先读完走，不排的话给 AI 的选项、试跑拿哪一条每次不一样
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  private async ctxOf(p: Place): Promise<BaseCtx> {
    return baseContext(p.base!, await this.records(p.base!.folder), { today: this.d.now() })
  }

  // ---------------------------------------------------------------- 认出改动

  /** 扫一遍：规则重读；盯着的文件夹里每一篇和上次比，新加的停手够久才算，改了的马上算 */
  async scan(first: boolean): Promise<void> {
    const places = await this.loadPlaces()
    const on = this.d.prefs().on
    const watched = new Map<string, Place[]>()
    for (const p of places) {
      if (!p.base || p.base.folder === null) continue
      if (!p.rules.some((r) => r.on && r.when.some((w) => w.on === 'added' || w.on === 'changed'))) continue
      watched.set(p.base.folder, [...(watched.get(p.base.folder) ?? []), p])
    }
    const now = Date.now()
    const settle = this.d.settleMs ?? 4000
    const events: { folder: string; ev: RowEvent; text: string }[] = []
    for (const [folder] of watched) {
      const recs = await this.records(folder)
      const known = this.snap.get(folder)
      const next = new Map<string, string>()
      for (const r of recs) {
        const f = JSON.stringify(fieldValues(r.text))
        next.set(r.path, f)
        if (!known) continue
        const was = known.get(r.path)
        const mine = this.own.get(r.path)
        if (mine !== undefined) {
          if (mine === r.text) continue
          this.own.delete(r.path)
        }
        if (was === undefined) {
          // 新出现的：等它停手（还在起名、填金额）
          if (!this.pending.has(r.path) || this.pendingText.get(r.path) !== r.text) {
            this.pending.set(r.path, now)
            this.pendingText.set(r.path, r.text)
          }
          next.delete(r.path)
          if (now - this.pending.get(r.path)! >= settle) {
            this.pending.delete(r.path)
            this.pendingText.delete(r.path)
            next.set(r.path, f)
            events.push({ folder, ev: { kind: 'added', path: r.path }, text: r.text })
          }
          continue
        }
        if (was !== f) {
          const before = this.snapText.get(r.path) ?? ''
          events.push({ folder, ev: { kind: 'changed', path: r.path, changes: fieldChanges(before, r.text) }, text: r.text })
        }
      }
      // 还在等的那几篇不在 next 里：下次还当新的
      this.snap.set(folder, next)
      for (const r of recs) if (next.has(r.path)) this.snapText.set(r.path, r.text)
    }
    for (const f of [...this.snap.keys()]) if (!watched.has(f)) this.snap.delete(f)
    if (this.pending.size && !this.scanTimer) this.scanTimer = setTimeout(() => ((this.scanTimer = null), void this.scan(false)), Math.min(settle, 1000))
    if (first || !on) return
    for (const { folder, ev, text } of events) {
      for (const p of watched.get(folder) ?? []) {
        for (const rule of p.rules) {
          if (!rule.on) continue
          const why = rule.when.map((w) => whenFits(w, ev, nameOf(ev.path))).find((x) => x !== null)
          if (!why) continue
          if (!(await this.holds(p, rule, ev.path))) continue
          void text
          this.enqueue({ where: p.where, place: p, rule, name: rule.name, path: ev.path, why, by: 'auto' })
        }
      }
    }
  }
  private pendingText = new Map<string, string>()
  private snapText = new Map<string, string>()

  /** 这一条合不合「如果」 */
  private async holds(p: Place, rule: AutoRule, path: string): Promise<boolean> {
    if (!rule.if || !p.base) return true
    const ctx = await this.ctxOf(p)
    const rec = ctx.recs.find((r) => r.path === path)
    return !!rec && recordHolds(ctx, rec, rule.if)
  }

  // ---------------------------------------------------------------- 看钟：定时、到了日子、补跑

  async tick(): Promise<void> {
    const v = this.d.vault()
    if (!v) return
    const now = this.d.now()
    const last = this.d.lastSeen(v.root)
    this.d.setLastSeen(v.root, stampText(now))
    // 头一回在这台 Mac 上开这个库：从现在算起，不补以前的
    if (!last || !this.d.prefs().on) return
    const from = new Date(last)
    if (!(from.getTime() < now.getTime())) return
    if (!this.places.length) await this.loadPlaces()
    const log = await this.readLog()
    const ran = new Set(log.filter((e) => e.slot).map((e) => `${e.where}|${e.rule}|${e.slot}`))
    /** 晚了两分钟以上算错过（Mac 睡着、软件没开） */
    const late = (t: Date) => now.getTime() - t.getTime() > 120_000
    const noLib = this.d.builtInClock === false && (await this.libText(v)) === null
    for (const p of this.places) {
      if (noLib && p.where === LIB_WHERE) continue
      for (const rule of p.rules) {
        if (!rule.on) continue
        // 定时：(上次, 现在] 里每种只补最近一次
        let slot: Date | null = null
        let w: AutoWhen | null = null
        for (const x of rule.when) {
          if (x.on !== 'every') continue
          const s = slotsIn(x, from, now).pop()
          if (s && (!slot || s > slot)) (slot = s), (w = x)
        }
        if (slot && w) {
          const key = stampText(slot)
          if (!ran.has(`${p.where}|${rule.name}|${key}`)) {
            const missed = late(slot)
            const policy = rule.missed ?? this.d.prefs().missed
            if (missed && policy === 'skip') await this.skip(p.where, rule.name, `${whenLabel(w)}那次 Mac 关着，跳过了`, key)
            else this.enqueue({ where: p.where, place: p, rule, name: rule.name, path: null, why: missed ? `${whenLabel(w)}那次 Mac 关着，打开后补跑` : whenLabel(w), by: missed ? 'missed' : 'auto', slot: key })
          }
        }
        // 到了某一列的日子：每一条各算各的
        const dates = rule.when.filter((x): x is Extract<AutoWhen, { on: 'date' }> => x.on === 'date')
        if (!dates.length || !p.base) continue
        const ctx = await this.ctxOf(p)
        for (const rec of ctx.recs) {
          for (const x of dates) {
            const at = dateFireAt(x, rec.props[x.prop] ?? '')
            if (!at || !(at > from && at <= now)) continue
            const key = `${rec.path}|${stampText(at)}`
            if (ran.has(`${p.where}|${rule.name}|${key}`)) continue
            if (rule.if && !recordHolds(ctx, rec, rule.if)) continue
            const missed = late(at)
            if (missed && (rule.missed ?? this.d.prefs().missed) === 'skip') {
              await this.skip(p.where, rule.name, `「${rec.name}」${whenLabel(x)}那次 Mac 关着，跳过了`, key)
              continue
            }
            this.enqueue({ where: p.where, place: p, rule, name: rule.name, path: rec.path, why: `「${rec.name}」${whenLabel(x)}${missed ? '（Mac 关着错过了，打开后补跑）' : ''}`, by: missed ? 'missed' : 'auto', slot: key })
          }
        }
      }
    }
  }

  private async skip(where: AutoWhere, rule: string, why: string, slot: string) {
    await this.appendLog({ id: logId(this.d.now(), Math.random), t: stampText(this.d.now()), rule, where, by: 'missed', why, did: [], files: [], commit: null, ok: true, undoable: false, slot, skipped: true })
    this.d.emit('auto:changed')
  }

  // ---------------------------------------------------------------- 跑

  /** 排上一次（一次跑一条，提交一条一条来）；交回编号 */
  enqueue(c: RunCtx): number {
    const run = this.nextRun++
    const ctl = new AbortController()
    const done = (this.queue = this.queue.then(() => this.execute(run, c, ctl.signal)).catch((e) => {
      console.error('自动化跑的时候出错', e)
      return null as unknown as AutoDone
    })) as Promise<AutoDone>
    this.jobs.set(run, { run, ctl, done })
    void done.finally(() => this.jobs.delete(run))
    return run
  }

  /** 等某一次跑完（测试、命令行用） */
  wait(run: number): Promise<AutoDone> | null {
    return this.jobs.get(run)?.done ?? null
  }

  stopRun(run: number): boolean {
    const j = this.jobs.get(run)
    j?.ctl.abort()
    return !!j
  }

  private async execute(run: number, c: RunCtx, signal: AbortSignal): Promise<AutoDone> {
    const v = this.d.vault()!
    const now = this.d.now()
    const files = new Map<string, { before: string; after: string }>()
    const did: string[] = []
    let error: string | null = null
    let open: string | undefined
    let notified = false
    const reading = c.rule.do.find((s): s is Extract<AutoStep, { do: 'ai' }> => s.do === 'ai' && s.ai === 'summary')
    this.d.emit('auto:started', { run, where: c.where, rule: c.name, why: c.why, steps: c.rule.do.length, ...(reading && c.place?.base ? { reading: (await this.records(c.place.base.folder)).length } : {}) } satisfies AutoStarted)
    const dirty = new Map((await git.status(v.root).catch(() => [] as git.FileStatus[])).map((s) => [s.path, s]))
    const committedFirst = new Set<string>()
    /** 这一篇里用户没提交的字先单独提交：这一次的提交（和撤回）里只有自动化写的 */
    const precommit = async (path: string) => {
      if (!dirty.has(path) || committedFirst.has(path)) return
      committedFirst.add(path)
      await git.commitPaths(v.root, [path], git.describeChanges([dirty.get(path)!])).catch(() => null)
    }
    /** 写一篇：先提交用户没提交的字，先比后写，记下改前改后 */
    const put = async (path: string, after: string, before: string) => {
      if (!isWritable(path)) throw new Error(`写不了「${path}」`)
      await precommit(path)
      const r = await v.write(path, after, before)
      if (!r.ok) throw new Error(`《${nameOf(path)}》刚被别处改过，没写`)
      this.track(path, before, after, files, c.button)
    }
    const read = async (path: string): Promise<string | null> => {
      try {
        return (await v.read(path)).text
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    }
    const vars: Record<string, string> = { ...timeVars(now), 规则: c.name }
    if (c.path) {
      const t = await read(c.path)
      if (t !== null) Object.assign(vars, rowVars(c.path, t))
    }
    let created: string | null = null
    try {
      for (const st of c.rule.do) {
        if (signal.aborted) throw new Error('停下了')
        const res = await this.step(st, { run, c, v, vars, put, precommit, read, signal, now, created, files })
        if (res.created) {
          created = res.created
          vars['新建的那篇'] = nameOf(res.created)
        }
        if (res.open) open = res.open
        if (res.notified) notified = true
        if (res.did) did.push(res.did)
      }
    } catch (e) {
      error = String((e as Error).message ?? e).split('\n')[0]!.slice(0, 200)
    }
    if (c.button && c.rule.do.some((s) => s.do === 'open') && !open) open = created ?? c.path ?? undefined
    // 自动跑的出错了：这一条先停下（写 on: false），修好再打开
    let paused = false
    if (error && (c.by === 'auto' || c.by === 'missed') && c.place) {
      const i = c.place.rules.findIndex((r) => r.name === c.name)
      if (i !== -1) {
        try {
          await this.writeRules(c.place, (src) => (c.place!.block === -1 ? setLibRule(src, i, { ...c.place!.rules[i]!, on: false }) : setAutomation(src ?? '', i, { ...c.place!.rules[i]!, on: false })), files, put, read)
          paused = true
        } catch (e) {
          console.error('自动化停不下这一条', e)
        }
      }
    }
    const entry: AutoLogEntry = {
      id: logId(now, Math.random),
      t: stampText(now),
      rule: c.name,
      where: c.where,
      by: c.by,
      why: c.why,
      did,
      files: [...files.keys()],
      commit: null,
      ok: !error,
      ...(error ? { error } : {}),
      undoable: files.size > 0,
      ...(c.slot ? { slot: c.slot } : {}),
      ...(c.path ? { path: c.path } : {}),
    }
    const logPath = await this.appendLog(entry)
    if (files.size) {
      try {
        entry.commit = await git.commitPaths(v.root, [...files.keys(), logPath], `自动化「${c.name}」：${did.join('；') || error || '跑了一次'}`)
      } catch (e) {
        if (!(e instanceof git.GitError)) throw e
      }
      this.d.emit('files:changed')
    }
    if (this.d.prefs().notify && !notified && (files.size || error)) this.d.notify(c.name, error ? `出错了：${error}` : did.join('；'))
    const out: AutoDone = { run, entry, ...(open ? { open } : {}), ...(paused ? { paused } : {}) }
    this.d.emit('auto:done', out)
    this.d.emit('auto:changed')
    return out
  }

  /** 记下这次改了一篇：改前（这一次第一次写之前）、改后；自动化写的记成 own（不再触发别的） */
  private track(path: string, before: string, after: string, files: Map<string, { before: string; after: string }>, button?: boolean) {
    const had = files.get(path)
    files.set(path, { before: had?.before ?? before, after })
    if (!button) {
      this.own.set(path, after)
      // 盯着的文件夹里：直接记成新的样子（新建的也是，不当「新加一条」）
      for (const [folder, m] of this.snap) {
        if (folder === '' || path.startsWith(folder + '/')) {
          m.set(path, JSON.stringify(fieldValues(after)))
          this.snapText.set(path, after)
        }
      }
    }
    this.d.tell(path, after)
  }

  /** 改规则所在的那篇（库里的自动化.md、数据库那篇的 base 块） */
  private async writeRules(p: Place, edit: (src: string | null) => string, files: Map<string, { before: string; after: string }>, put: (path: string, after: string, before: string) => Promise<void>, read: (path: string) => Promise<string | null>) {
    const cur = await read(p.doc)
    if (p.block === -1) {
      const next = edit(cur)
      if (next !== (cur ?? '')) {
        if (cur === null) await mkdir(dirname(this.d.vault()!.abs(p.doc)), { recursive: true })
        await put(p.doc, next, cur ?? '')
      }
      return
    }
    if (cur === null) throw new Error(`《${nameOf(p.doc)}》不在了`)
    const b = baseBlocks(cur)[p.block]
    if (!b) throw new Error(`《${nameOf(p.doc)}》里找不到这个数据库`)
    const next = replaceBaseBlock(cur, p.block, edit(b.src))
    if (next !== cur) await put(p.doc, next, cur)
    void files
  }

  /** 做一步，交回一句做了什么 */
  private async step(
    st: AutoStep,
    o: {
      run: number
      c: RunCtx
      v: Vault
      vars: Record<string, string>
      put: (path: string, after: string, before: string) => Promise<void>
      precommit: (path: string) => Promise<void>
      read: (path: string) => Promise<string | null>
      signal: AbortSignal
      now: Date
      created: string | null
      files: Map<string, { before: string; after: string }>
    },
  ): Promise<{ did?: string; created?: string; open?: string; notified?: boolean }> {
    const { c, v, vars, put, read } = o
    const fill = (s: string) => fillTemplate(s, vars)
    const needRow = () => {
      if (!c.path || !c.place?.base) throw new Error(`「${stepLabel(st)}」要对数据库里的一条做`)
      return c.path
    }
    switch (st.do) {
      case 'set': {
        const path = needRow()
        const done: string[] = []
        for (const [col, raw] of Object.entries(st.values)) {
          const ctx = await this.ctxOf(c.place!)
          const value = this.valueOf(fill(raw), o.now)
          const ws = writeCell(ctx, path, col, value)
          for (const w of ws) await put(w.path, w.after, w.before)
          done.push(`把「${col}」改成「${value}」`)
        }
        return { did: `${done.join('，')}（《${nameOf(path)}》）` }
      }
      case 'newRow': {
        const folder = c.place?.base?.folder
        if (!c.place?.base || folder === null || folder === undefined) throw new Error('「新建一条」要在数据库里用')
        const src = c.path ? await read(c.path) : null
        const from = src ? fieldValues(src) : {}
        let text = ''
        for (const col of st.copy ?? []) if (col !== '名字' && from[col] !== undefined) text = setProp(text, col, from[col])
        for (const [col, raw] of Object.entries(st.set ?? {})) text = setProp(text, col, this.valueOf(fill(raw), o.now))
        const base = (st.name ? fill(st.name) : st.copy?.includes('名字') && c.path ? nameOf(c.path) : '新的一条').replace(/[\\/:]/g, ' ').trim() || '新的一条'
        const path = this.freePath(v, folder, base)
        await put(path, text || '\n', '')
        return { did: `新建了一条《${nameOf(path)}》`, created: path, open: path }
      }
      case 'ai':
        return this.aiStep(st, o)
      case 'todo': {
        const file = fill(st.file ?? (c.place?.base?.folder ? `${dirOf(c.place.doc)}/待办.md`.replace(/^\//, '') : '收件箱/待办.md'))
        if (!isWritable(file)) throw new Error(`待办放不进「${file}」`)
        const title = fill(st.text).trim()
        const today = stampText(o.now).slice(0, 10)
        const q = st.date ? parseQuick(`x ${st.date.replace(/^当天/, '今天')}`, today) : null
        const line = newTaskLine({ title, date: q?.date ?? null, time: q?.time ?? null, remind: q?.time ? '准时' : null })
        const cur = await read(file)
        const next = addTodoText(cur, nameOf(file), line).text
        await put(file, next, cur ?? '')
        return { did: `在「${file.replace(/\.md$/i, '')}」加了一条「${title}」${q?.date ? `（${dueText(q.date, q.time ?? null, o.now.getTime(), 'zh')} 提醒）` : ''}` }
      }
      case 'notify': {
        const text = fill(st.text)
        this.d.notify(c.name, text)
        return { did: `发了通知「${text}」`, notified: true }
      }
      case 'command': {
        if (st.command.replace(/^\//, '') === '写这周的周记') return this.weekStep(o)
        this.d.emit('auto:command', { run: o.run, command: st.command, path: o.created ?? c.path })
        return { did: `交给界面跑 ${st.command}` }
      }
      case 'newNote': {
        const folder = fill(st.folder).replace(/\/+$/, '')
        const name = fill(st.name).replace(/[\\/:]/g, ' ').trim()
        if (!name) throw new Error('「新建一篇」没写叫什么')
        const path = `${folder ? folder + '/' : ''}${name}.md`
        if (!isWritable(path)) throw new Error(`建不了「${path}」`)
        const had = await read(path)
        if (had !== null && (st.ifExists ?? 'keep') === 'keep') return { did: `《${name}》已经有了，没新建`, created: path }
        const target = had === null ? path : this.freePath(v, folder, name)
        const tpl = st.template ? await read(st.template) : null
        const body = tpl ?? (folder === '周记' ? WEEK_TEMPLATE : `# ${name}\n\n`)
        await mkdir(dirname(v.abs(target)), { recursive: true })
        await put(target, fill(body), '')
        return { did: `新建了《${nameOf(target)}》${tpl !== null ? `（照「${nameOf(st.template!)}」）` : ''}`, created: target, open: target }
      }
      case 'tidyInbox': {
        if (!this.d.tidyInbox) throw new Error('整理收件箱要开着画布笔记才能跑')
        const r = await this.d.tidyInbox(o.signal)
        for (const f of r.files) o.files.set(f, o.files.get(f) ?? { before: '', after: '' })
        return { did: r.did }
      }
      case 'ask':
        return {}
      case 'open':
        return { open: o.created ?? c.path ?? undefined }
      case 'unknown':
        throw new Error(`认不出这一步「${st.key}」，去改写法`)
    }
  }

  /** 写进格子的值：today() 是今天，today() + "7d" 往后数 */
  private valueOf(raw: string, now: Date): string {
    const t = raw.trim()
    const m = /^today\(\)\s*(?:([+-])\s*"(\d+)d")?$/.exec(t)
    if (!m) return t.replace(/^"(.*)"$/, '$1')
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (m[1] ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0))
    return stampText(d).slice(0, 10)
  }

  /** 文件夹里一个没被占的名字：名字、名字 2、名字 3 */
  private freePath(v: Vault, folder: string, name: string): string {
    const at = (n: number) => `${folder ? folder + '/' : ''}${name}${n > 1 ? ' ' + n : ''}.md`
    for (let n = 1; ; n++) if (!existsSync(v.abs(at(n)))) return at(n)
  }

  private async aiStep(st: Extract<AutoStep, { do: 'ai' }>, o: Parameters<AutoEngine['step']>[1]): Promise<{ did?: string; created?: string }> {
    const { c, v, put, read } = o
    if (st.ai === 'summary') {
      const p = c.place
      const recs = p?.base ? (await this.ctxOf(p)).recs : []
      const ctx = p?.base ? await this.ctxOf(p) : null
      const f = st.rows ? filterFromYaml(st.rows) : null
      const rows = ctx ? ctx.recs.filter((r) => !f || recordHolds(ctx, r, f)) : []
      void recs
      const name = fillTemplate(st.name ?? `{{年}}-{{月}} ${c.name}`, o.vars).replace(/[\\/:]/g, ' ').trim()
      const folder = fillTemplate(st.folder ?? (p ? dirOf(p.doc) : '收件箱'), o.vars).replace(/\/+$/, '')
      const table = rows.map((r) => `- ${r.name}：${Object.entries(fieldValues(r.text)).map(([k, x]) => `${k} ${x}`).join('，')}`).join('\n') // 不翻：给 AI 的话
      const prompt = `命令：自动化写摘要\n要求：${st.prompt || '把下面这几条写成一段摘要：总数、最多的几类、值得注意的'}\n数据库：${p ? nameOf(p.doc) : '库里'}（${rows.length} 条）\n\n${table || '（没有合条件的）'}` // 不翻：给 AI 的话
      const { text, by } = await this.d.ask('你替用户读数据库里的几条记录写一段摘要。用中文，平实、具体，数要和给的对得上，不编。只回摘要正文（Markdown，不要标题）。', prompt, o.signal, st.use) // 不翻：给 AI 的话
      if (o.signal.aborted) throw new Error('停下了')
      if (!text.trim()) throw new Error('AI 这次没写出来')
      const path = this.freePath(v, folder, name)
      const head = p ? `---\n数据库: "[[${nameOf(p.doc)}]]"\n来自: 自动化「${c.name}」\n---\n` : `---\n来自: 自动化「${c.name}」\n---\n` // 不翻：写进文件
      const body = `${head}# ${nameOf(path)}\n\n${aiCallout({ label: 'AI 摘要', by, seen: `读了 ${rows.length} 条`, text: text.trim() })}\n` // 不翻：写进文件
      await mkdir(dirname(v.abs(path)), { recursive: true })
      await put(path, body, '')
      return { did: `AI 读了 ${rows.length} 条，写了《${nameOf(path)}》`, created: path }
    }
    const path = c.path
    if (!path || !c.place?.base) throw new Error(`「${stepLabel(st)}」要对数据库里的一条做`)
    const col = st.prop
    if (!col) throw new Error(`「${stepLabel(st)}」没写写进哪一列`)
    const ctx = await this.ctxOf(c.place)
    const type = allColumns(ctx).find((x) => x.label === col)?.type
    const pick = st.use ? (() => {
      const [engine, model, effort] = st.use!.split('/').map((x) => x.trim())
      return engine ? { engine, ...(model ? { model } : {}), ...(effort ? { effort } : {}) } : null
    })() : null
    const def: AiColDef = {
      type: 'ai',
      prompt: st.prompt,
      output: st.ai === 'note' ? 'note' : type === 'select' || type === 'status' ? 'select' : type === 'multi' ? 'multi' : type === 'number' ? 'number' : 'text',
      folder: st.ai === 'note' ? (st.folder ?? `${c.place.base.folder ?? ''}/${col}`.replace(/^\//, '')) : null,
      twoWay: null,
      reads: 'note',
      newRows: 'manual',
      ai: pick,
    }
    await o.precommit(path)
    const res = await this.d.aiRow(v, { src: c.place.src, col, path, def, signal: o.signal }, () => {})
    if (!res.ok) throw new Error(res.error)
    for (const w of res.writes) this.track(w.path, w.before, w.after, o.files, c.button)
    void put
    void read
    const value = Array.isArray(res.value) ? res.value.join('、') : res.value
    return st.ai === 'note'
      ? { did: `AI 新建了《${nameOf(res.writes.find((w) => w.before === '')?.path ?? res.writes[res.writes.length - 1]!.path)}》，关联到「${col}」`, created: res.writes.find((w) => w.before === '')?.path }
      : { did: `AI 写了「${col}」：${value}（《${nameOf(path)}》）` }
  }

  /** 写这周的周记：AI 读这周改过的笔记、做完的待办，写进那篇周记的「AI 本周摘要」块（已经有了只补新的事） */
  private async weekStep(o: Parameters<AutoEngine['step']>[1]): Promise<{ did?: string }> {
    const { v, put, read } = o
    if (!this.d.weekFacts) throw new Error('写这周的周记要开着画布笔记才能跑')
    const path = o.created
    if (!path) throw new Error('「/写这周的周记」要跟在「新建一篇」后面')
    const cur = await read(path)
    if (cur === null) throw new Error(`《${nameOf(path)}》不在了`)
    const w = await this.d.weekFacts(v, o.now)
    const done = await this.doneTodos(w.from, w.to)
    const [y, m, d] = w.from.split('-').map(Number)
    const dreamed = this.d.dreamItems ? await this.d.dreamItems(new Date(y!, m! - 1, d!).getTime()) : []
    const block = weekBlock(cur)
    const prompt = weekAsk(w, done, dreamed, block?.text ?? null)
    const { text, by } = await this.d.ask('你替用户写这一周的周记摘要。用中文，平实、第一人称，只写给你的事，不编。', prompt, o.signal) // 不翻：给 AI 的话
    if (o.signal.aborted) throw new Error('停下了')
    const body = text.trim()
    if (!body || /^没有要加的/.test(body)) return { did: `AI 读了这周改过的 ${w.notes.length} 篇，没有要补的` }
    // 照设计页：「读了这周改过的14篇、做完的3条待办、梦游报告」
    const seen = `读了这周改过的${w.notes.length}篇${done.length ? `、做完的${done.length}条待办` : ''}${dreamed.length ? '、梦游报告' : ''}` // 不翻：写进文件
    const next = putWeekBlock(cur, body, by, seen)
    await put(path, next, cur)
    return { did: `AI 写了《${nameOf(path)}》的本周摘要（${seen}）` }
  }

  /** 这周做完的待办（✅ 日期在这一周里） */
  private async doneTodos(from: string, to: string): Promise<string[]> {
    const v = this.d.vault()
    if (!v) return []
    const out: string[] = []
    for (const [, text] of await v.texts()) {
      for (const m of text.matchAll(/^\s*[-*+] \[[xX]\] (.+?)\s*✅️?\s*(\d{4}-\d{2}-\d{2})/gm)) {
        if (m[2]! >= from && m[2]! <= to) out.push(m[1]!.replace(/\s*[📅⏰⏳🛫🔔🔁🆔⛔➕❌🏁⏫🔺🔼🔽⏬].*$/u, '').trim())
      }
    }
    return out.slice(0, 40)
  }

  // ---------------------------------------------------------------- 记录

  async readLog(): Promise<AutoLogEntry[]> {
    const v = this.d.vault()
    if (!v) return []
    const dir = v.abs(AUTO_LOG_DIR)
    let names: string[]
    try {
      names = (await readdir(dir)).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    const out: AutoLogEntry[] = []
    for (const n of names) out.push(...parseLog(await readFile(`${dir}/${n}`, 'utf8')))
    return out
  }

  /** 记录加一行，交回那个文件（相对库） */
  private async appendLog(e: AutoLogEntry): Promise<string> {
    const v = this.d.vault()!
    const rel = logPathOf(new Date(e.t))
    const abs = v.abs(rel)
    await mkdir(dirname(abs), { recursive: true })
    const cur = existsSync(abs) ? await readFile(abs, 'utf8') : ''
    await writeFile(abs, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + logLine(e) + '\n')
    return rel
  }

  /** 那一次的提交：记录里那一行是和改动一起提交的，找加了这一行的那次提交（记录里不另写提交号，免得记录文件提交完又变） */
  private async commitOf(e: AutoLogEntry): Promise<string | null> {
    if (e.commit) return e.commit
    const v = this.d.vault()!
    const out = await git.git(v.root, ['log', '--format=%H', `-S"id":"${e.id}"`, '--', logPathOf(new Date(e.t))]).catch(() => '')
    return out.trim().split('\n').filter(Boolean).pop() ?? null
  }

  // ---------------------------------------------------------------- 撤回

  async undo(id: string): Promise<{ ok: true; hash: string | null } | { ok: false; error: string }> {
    const v = this.d.vault()
    if (!v) return { ok: false, error: '还没有打开库' }
    // 排着、正在跑的先跑完（那一次的提交可能还没做完）
    await this.queue
    const log = await this.readLog()
    const e = log.find((x) => x.id === id && !x.undo)
    if (!e) return { ok: false, error: '找不到这一次' }
    if (undoneIds(log).has(id)) return { ok: false, error: '这一次已经撤回了' }
    if (!e.undoable) return { ok: false, error: '这一次只发了通知，收不回' }
    const commit = await this.commitOf(e)
    if (!commit) return { ok: false, error: '这一次没提交上，撤回不了' }
    const show = (rev: string, f: string) => git.git(v.root, ['show', `${rev}:${f}`]).then((t) => t, () => '')
    const plan: { path: string; before: string; after: string }[] = []
    for (const f of e.files) {
      const after = await show(commit, f)
      const before = await show(`${commit}^`, f)
      const cur = existsSync(v.abs(f)) ? (await v.read(f)).text : ''
      if (cur !== after.replace(/\r\n/g, '\n').replace(/^﻿/, '')) return { ok: false, error: `《${nameOf(f)}》后来又改过，撤回不了` }
      plan.push({ path: f, before, after: cur })
    }
    for (const w of plan) {
      if (w.before === '') {
        await rm(v.abs(w.path), { force: true })
      } else {
        const r = await v.write(w.path, w.before, w.after)
        if (!r.ok) return { ok: false, error: `《${nameOf(w.path)}》刚被别处改过，撤回不了` }
      }
      this.own.set(w.path, w.before)
      for (const [folder, m] of this.snap) if (folder === '' || w.path.startsWith(folder + '/')) (w.before === '' ? m.delete(w.path) : m.set(w.path, JSON.stringify(fieldValues(w.before))), this.snapText.set(w.path, w.before))
      this.d.tell(w.path, w.before)
    }
    const now = this.d.now()
    const logPath = await this.appendLog({ id: logId(now, Math.random), t: stampText(now), rule: e.rule, where: e.where, by: 'run', why: `撤回了 ${e.t.slice(5, 16).replace('T', ' ')} 那一次`, did: [`撤回：${e.did.join('；')}`], files: e.files, commit: null, ok: true, undoable: false, undo: id })
    let hash: string | null = null
    try {
      hash = await git.commitPaths(v.root, [...e.files, logPath], `撤回自动化「${e.rule}」`)
    } catch (err) {
      if (!(err instanceof git.GitError)) throw err
    }
    this.d.emit('files:changed')
    this.d.emit('auto:changed')
    return { ok: true, hash }
  }

  // ---------------------------------------------------------------- 列出、存、试跑、一句话

  async listing(prefs: AutoPrefs, only?: AutoWhere): Promise<Omit<AutoListing, 'system'>> {
    await this.loadPlaces()
    const log = await this.readLog()
    const now = this.d.now()
    const rules: AutoRuleInfo[] = []
    const buttons: AutoButtonInfo[] = []
    for (const p of this.places) {
      if (only && p.where !== only) continue
      const scope = await this.scopeOf(p)
      p.rules.forEach((rule, index) => {
        const st = ruleStats(log, p.where, rule.name)
        const nexts = rule.when.filter((w): w is Extract<AutoWhen, { on: 'every' }> => w.on === 'every').map((w) => nextSlot(w, now)).filter((d): d is Date => !!d)
        nexts.sort((a, b) => a.getTime() - b.getTime())
        const builtIn = p.block === -1 ? (rule.do.some((s) => s.do === 'newNote' && s.folder === '周记') ? 'week' : rule.do.some((s) => s.do === 'tidyInbox') ? 'inbox' : undefined) : undefined
        rules.push({
          ref: { where: p.where, index },
          kind: p.block === -1 ? 'library' : 'base',
          place: p.block === -1 ? '库里' : nameOf(p.doc),
          doc: p.doc,
          rule,
          sentence: ruleSentence(rule, (col) => scope.columns.find((x) => x.name === col)?.type ?? 'text'),
          yaml: ruleLines(rule, 0).join('\n'),
          problems: checkRule(rule, { ...scope, names: p.rules.filter((_, j) => j !== index).map((r) => r.name) }),
          runs: st.runs,
          last: st.last,
          error: st.error,
          next: nexts[0] ? stampText(nexts[0]) : null,
          ...(builtIn ? { builtIn } : {}),
        })
      })
      if (p.base) for (const [col, d] of Object.entries(p.base.props)) if (d.type === 'button') buttons.push({ where: p.where, doc: p.doc, place: nameOf(p.doc), col, steps: d.do })
    }
    return { prefs, rules, buttons }
  }

  /** 这一处的列（检查、给 AI 填规则） */
  async scopeOf(p: Place | AutoWhere, kind?: AutoScope['kind']): Promise<AutoScope> {
    const place = typeof p === 'string' ? await this.placeOf(p) : p
    if (!place || !place.base) return { kind: kind ?? 'library', columns: [] }
    const ctx = await this.ctxOf(place)
    const columns = allColumns(ctx)
      .filter((c) => c.id !== 'file.name' && c.type !== 'button')
      .map((c) => {
        // 选项（单选、状态、多选；文字列里不同的值不多时也当选项给 AI 看）
        const all = [...new Set(ctx.recs.flatMap((r) => r.lists[c.label] ?? (r.props[c.label] ? [r.props[c.label]!] : [])))]
        const opts = c.type === 'select' || c.type === 'status' || c.type === 'multi' || (c.type === 'text' && all.length <= 12) ? all : []
        return { name: c.label, type: c.type, ...(opts.length ? { options: opts } : {}) }
      })
    return { kind: kind ?? 'base', columns }
  }

  /** 存一条、开关、删：改那篇、一次提交 */
  async writeRule(where: AutoWhere, edit: { set?: { index: number | null; rule: AutoRule }; remove?: number }): Promise<AutoWriteResult> {
    const v = this.d.vault()
    if (!v) return { ok: false, error: '还没有打开库' }
    // 这个数据库还没有规则：placeOf 现读那一块
    const p = await this.placeOf(where)
    if (!p) return { ok: false, error: where === LIB_WHERE ? '找不到这一处' : '找不到这个数据库' }
    const files = new Map<string, { before: string; after: string }>()
    const lib = p.block === -1
    let index = edit.set?.index ?? edit.remove ?? 0
    if (edit.set && (edit.set.index === null || edit.set.index >= p.rules.length)) index = p.rules.length
    const fn = (src: string | null): string => {
      if (edit.remove !== undefined) return lib ? removeLibRule(src, edit.remove) : removeAutomation(src ?? '', edit.remove)
      const s = edit.set!
      return lib ? setLibRule(src, s.index, s.rule) : setAutomation(src ?? '', s.index, s.rule)
    }
    const read = async (path: string) => (existsSync(v.abs(path)) ? (await v.read(path)).text : null)
    const put = async (path: string, after: string, before: string) => {
      const r = await v.write(path, after, before)
      if (!r.ok) throw new Error(`《${nameOf(path)}》刚被别处改过，再试一次`)
      files.set(path, { before, after })
      this.d.tell(path, after)
    }
    try {
      const pending = (await git.status(v.root)).filter((s) => s.path === p!.doc)
      if (pending.length) await git.commitPaths(v.root, [p.doc], git.describeChanges(pending))
      await this.writeRules(p, fn, files, put, read)
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
    let hash: string | null = null
    if (files.size) {
      const what: string = edit.remove !== undefined ? `删了「${p.rules[edit.remove]?.name ?? ''}」` : edit.set!.index === null ? `加了「${edit.set!.rule.name}」` : `改了「${edit.set!.rule.name}」` // 不翻：提交说明
      try {
        hash = await git.commitPaths(v.root, [...files.keys()], `自动化：${what}`)
      } catch (e) {
        if (!(e instanceof git.GitError)) throw e
      }
    }
    await this.scan(false)
    this.d.emit('auto:changed')
    this.d.emit('files:changed')
    const problems = edit.set ? checkRule(edit.set.rule, await this.scopeOf(p.where, lib ? 'library' : 'base')) : []
    return { ok: true, ref: { where, index }, hash, problems }
  }

  /** 现在跑一次 */
  async runNow(ref: AutoRef, path: string | undefined, by: AutoLogEntry['by'] = 'run'): Promise<{ run: number } | { error: string }> {
    await this.loadPlaces()
    const p = this.place(ref.where)
    const rule = p?.rules[ref.index]
    if (!p || !rule) return { error: '找不到这一条规则' }
    let row = path ?? null
    if (!row && p.base && rule.when.some((w) => w.on !== 'every')) {
      const ctx = await this.ctxOf(p)
      row = ctx.recs.find((r) => !rule.if || recordHolds(ctx, r, rule.if))?.path ?? null
      if (!row && rule.do.some((s) => s.do !== 'notify' && !(s.do === 'ai' && s.ai === 'summary'))) return { error: '数据库里没有合条件的一条' }
    }
    const why = by === 'link' ? '深链、命令行叫它跑的' : '你点了「现在跑一次」' // 不翻：写进记录
    return { run: this.enqueue({ where: p.where, place: p, rule, name: rule.name, path: row, why: row ? `${why}（《${nameOf(row)}》）` : why, by }) }
  }

  /** 按名字跑（深链、命令行）：where 不给时按名字在所有地方找，重名的要给 where */
  async runByName(name: string, where?: string): Promise<{ run: number } | { error: string }> {
    await this.loadPlaces()
    const hits = this.places.flatMap((p) => p.rules.map((r, index) => ({ p, r, index }))).filter((x) => x.r.name === name && (!where || x.p.where === where || x.p.doc === where || nameOf(x.p.doc) === where))
    if (!hits.length) return { error: `没有叫「${name}」的规则` }
    if (hits.length > 1) return { error: `有 ${hits.length} 条叫「${name}」，加上 where 说是哪个数据库的` }
    return this.runNow({ where: hits[0]!.p.where, index: hits[0]!.index }, undefined, 'link')
  }

  /** 点一行的按钮 */
  async button(where: AutoWhere, col: string, path: string, confirmed: boolean): Promise<{ run: number } | { ask: string } | { error: string }> {
    await this.loadPlaces()
    let p = this.place(where)
    if (!p) return { error: '找不到这个数据库' }
    const d = p.base?.props[col]
    if (!d || d.type !== 'button') return { error: `「${col}」不是按钮列` }
    const ask = d.do.find((s): s is Extract<AutoStep, { do: 'ask' }> => s.do === 'ask')
    if (ask && !confirmed) return { ask: ask.text || `要跑「${col}」吗？` }
    p = { ...p }
    const rule: AutoRule = { name: col, on: true, when: [], if: null, missed: null, do: d.do }
    return { run: this.enqueue({ where, place: p, rule, name: col, path, why: `你点了《${nameOf(path)}》的「${col}」`, by: 'button', button: true }) }
  }

  /** 试跑：拿一条走一遍，说清会做什么，不写文件 */
  async trial(where: AutoWhere, rule: AutoRule, path?: string): Promise<AutoTrial> {
    const p = await this.placeOf(where)
    const lib = where === LIB_WHERE
    const scope = p ? await this.scopeOf(p, lib ? 'library' : 'base') : { kind: lib ? ('library' as const) : ('base' as const), columns: [] }
    const problems = checkRule(rule, scope)
    const now = this.d.now()
    const vars: Record<string, string> = { ...timeVars(now), 规则: rule.name, 新建的那篇: '新建的那篇' }
    let row: string | null = null
    let fits = true
    let why = rule.when.map(whenLabel).join('，或 ')
    if (p?.base) {
      const ctx = await this.ctxOf(p)
      const rec = path ? ctx.recs.find((r) => r.path === path) : (ctx.recs.find((r) => !rule.if || recordHolds(ctx, r, rule.if)) ?? ctx.recs[0])
      if (rec) {
        row = rec.path
        Object.assign(vars, rowVars(rec.path, rec.text))
        fits = !rule.if || recordHolds(ctx, rec, rule.if)
        why = `拿《${rec.name}》试：${fits ? '合条件' : '不合「如果」，到时候不会跑'}`
      }
    }
    const steps = rule.do.map((st) => {
      const f = (s: string) => fillTemplate(s, vars)
      switch (st.do) {
        case 'todo': {
          const q = st.date ? parseQuick(`x ${st.date.replace(/^当天/, '今天')}`, stampText(now).slice(0, 10)) : null
          return `在「${(st.file ?? '待办.md').replace(/\.md$/i, '')}」加一条「${f(st.text)}」${q?.date ? `（${dueText(q.date, q.time ?? null, now.getTime(), 'zh')} 提醒）` : ''}`
        }
        case 'notify':
          return `发通知「${f(st.text)}」`
        case 'set':
          return Object.entries(st.values).map(([k, x]) => `把「${k}」改成「${this.valueOf(f(x), now)}」`).join('，')
        case 'newNote':
          return `新建《${f(st.name)}》（放在「${f(st.folder)}」${st.ifExists === 'keep' || !st.ifExists ? '，已经有了就不新建' : ''}）`
        case 'ai':
          return `${stepLabel(st)}：问 AI「${st.prompt || '写摘要'}」（试跑不问）`
        default:
          return stepLabel(st)
      }
    })
    return { path: row, why, fits, steps, problems }
  }

  /** 一句话 → 规则 */
  async fromSentence(sentence: string, where: AutoWhere, signal: AbortSignal): Promise<{ ok: true; rule: AutoRule; yaml: string; sentence: string; problems: string[]; by: string } | { ok: false; error: string }> {
    if (!sentence.trim()) return { ok: false, error: '先说一句「当……就……」' }
    const p = await this.placeOf(where)
    const lib = where === LIB_WHERE
    const scope: AutoScope = p ? await this.scopeOf(p, lib ? 'library' : 'base') : { kind: lib ? 'library' : 'base', columns: [] }
    const q = autoAsk(sentence, scope, stampText(this.d.now()).slice(0, 10))
    let answer: { text: string; by: string }
    try {
      answer = await this.d.ask(q.system, q.prompt, signal)
    } catch (e) {
      return { ok: false, error: signal.aborted ? '停下了' : String((e as Error).message ?? e).split('\n')[0]!.slice(0, 160) }
    }
    const r = autoParse(answer.text, scope)
    if ('error' in r) return { ok: false, error: r.error }
    const names = (p?.rules ?? []).map((x) => x.name)
    const rule = names.includes(r.rule.name) ? { ...r.rule, name: uniqueName(names, r.rule.name) } : r.rule
    return { ok: true, rule, yaml: ruleLines(rule, 0).join('\n'), sentence: ruleSentence(rule, (col) => scope.columns.find((x) => x.name === col)?.type ?? 'text'), problems: r.problems, by: answer.by }
  }
}

const uniqueName = (taken: string[], base: string) => {
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`
}

// ---------------------------------------------------------------- 周记里的「AI 本周摘要」块

/** 周记 AI 那一块的三节（设计页 w5）；「这周最想记住的」「下周想做」照模板留给用户写 */
export const WEEK_SECTIONS = ['这周写了、剪了什么', '做完的待办', '梦游整理了什么'] // 不翻：写进文件、给 AI 的话

/**
 * 问 AI 的话：头一行「命令：写这周的周记」（假 AI 认这个），笔记一行「- [[名字]]（路径）：开头」；
 * had 是那一块已经写着的（再跑一次时只写新的事）
 */
export function weekAsk(w: WeekFacts, done: string[], dreamed: string[], had: string | null): string {
  const books = w.books.map((b) => `- 《${b.title}》：${b.items.slice(0, 6).join('；')}`).join('\n')
  return `命令：写这周的周记
这周：${w.week}（${w.from} 到 ${w.to}）

照下面的事写这一周的摘要，分三节，每节一行小标题写成 **${WEEK_SECTIONS[0]}**、**${WEEK_SECTIONS[1]}**、**${WEEK_SECTIONS[2]}**，下面几条「- 」列表；某一节下面没有事就整节不写。
只写下面有的事，不编；提到笔记写成 [[笔记名]]。不写「这周最想记住的」「下周想做」，那两节留给我自己写。
${had ? '这一块里已经写了（在 <had> 里）：只写里面还没有的新事，照同样的小标题；都写到了就只回一句「没有要加的」。\n' : ''}
这周改过、新建的笔记（${w.notes.length} 篇）：
${w.notes.map((n) => `- [[${n.title}]]（${n.path}）：${n.excerpt.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n') || '（没有）'}
${books ? `\n这周读的、剪的：\n${books}\n` : ''}
这周做完的待办（${done.length} 条）：
${done.map((x) => `- ${x}`).join('\n') || '（没有）'}

这周梦游整理了什么（${dreamed.length} 处）：
${dreamed.map((x) => `- ${x}`).join('\n') || '（没有）'}${had ? `\n\n<had>\n${had.trimEnd()}\n</had>` : ''}` // 不翻：给 AI 的话
}

/** 周记里那一块：从哪行到哪行、里面的字 */
export function weekBlock(text: string): { from: number; to: number; text: string } | null {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => /^>\s*\[!ai\][+-]?\s*AI 本周摘要/.test(l))
  if (i === -1) return null
  let j = i + 1
  while (j < lines.length && /^>/.test(lines[j]!)) j++
  return { from: i, to: j, text: lines.slice(i + 1, j).map((l) => l.replace(/^>\s?/, '')).join('\n') }
}

/** 写进那一块：没有就插在开头的属性、标题后面（第一个 ## 前面）；已经有了只把新的几行接在块末尾，你写的字不动 */
export function putWeekBlock(text: string, body: string, by: string, seen: string): string {
  const had = weekBlock(text)
  const lines = text.split('\n')
  if (had) {
    const old = new Set(had.text.split('\n').map((l) => l.trim()).filter(Boolean))
    const add = body.split('\n').filter((l) => l.trim() && !old.has(l.trim()))
    if (!add.length) return text
    lines.splice(had.to, 0, '>', ...add.map((l) => `> ${l}`))
    return lines.join('\n')
  }
  const block = aiCallout({ label: WEEK_LABEL, by, seen, text: body }).split('\n')
  let at = lines.findIndex((l) => /^##\s/.test(l))
  if (at === -1) at = lines.length
  const insert = [...block, '']
  if (at > 0 && lines[at - 1]!.trim() !== '') insert.unshift('')
  lines.splice(at, 0, ...insert)
  return lines.join('\n')
}

export type { FileWrite }
