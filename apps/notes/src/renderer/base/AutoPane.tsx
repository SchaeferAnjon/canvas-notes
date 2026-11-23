/**
 * 右栏「自动化」标签（task-i921u「当……就……」方向 B「先说一句」，照 automations/proto.html#dir=b）：
 * - 规则：顶上「说一句」框（AI 填成当 / 如果 / 就三段，看过再存；也能「自己一格格选」），下面一条一张卡（一句话、方角开关、⋯、跑过几次）；
 * - 记录：每跑一次一行（哪一条、几点、因为什么、做了什么），改了文件的能撤回；
 * - 编辑一条：当（几样里任一样）/ Mac 关着时 / 如果（和筛选同一种写法）/ 就（一步步），试跑、看写法、存；按钮列做的事也在这里改（没有「当」）。
 * 一页对着一处规则：一个数据库（块头「自动化」开的），或者库里的（设置 › 自动化里「新建一条」「改」开的，只能定时）。
 * 打开、看记录、试跑、看写法都不写文件；开关、存、删交给主进程（auto-ipc.ts → window.cn.auto），只换那一条那几行、一次提交。
 * 「当」「就」的菜单、一句话说明都照 @cn/format 的 AUTO_WHENS / AUTO_STEPS / whenLabel / stepLabel。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { Toggle } from '@cn/design/settings'
import {
  allColumns,
  AUTO_LIB_PATH,
  AUTO_STEPS,
  AUTO_WHENS,
  type AutoAiMode,
  type BaseCond,
  type BaseCtx,
  colTypeOf,
  type ColumnInfo,
  FILTER_OPS,
  type FieldType,
  isGroup,
  isRaw,
  setBaseOrder,
  stepLabel,
  whenLabel,
} from '@cn/format'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { t } from '../../shared/i18n'
import { app } from '../ctx/actions'
import { EngineLogo, useChatEngine } from '../engine-logo'
import { composing } from '../ime'
import { anchorOf, FloatPop, type PopAnchor } from '../pop-place'
import { openSettingsAt } from '../settings/jump'
import { useDismiss } from '../use-dismiss'
import type { AiTable } from './ai-col'
import {
  type AutoLogRow,
  type AutoRule,
  type AutoStarted,
  type AutoStep,
  type AutoWhen,
  buttonYaml,
  fromSentence,
  onDone as onRunDone,
  onStarted,
  removeRule,
  ruleYaml,
  rulesOf,
  runRule,
  saveRule,
  setButtonSteps,
  toggleRule,
  trialRule,
  undoRun,
} from './auto-ipc'
import { type AutoEdit, type AutoOpen, autoOpenNow, autoTable, emptyRule, listOf, logOf, reload, setAuto, setDraft, useAuto, wireAuto } from './auto-state'
import { atText, hasAi, RuleSentence, WEEKDAYS, withVars } from './auto-text'
import { colText, fmt } from './words'

const dbName = (folder: string) => folder.split('/').pop() || folder
const ICON = (s: string) => s as CodiconName

/** 这一页对着的那一处 */
interface Scope {
  where: string
  lib: boolean
  tb: AiTable | null
  ctx: BaseCtx | null
  cols: ColumnInfo[]
  /** 那一处的规则和它在那一串里是第几条 */
  rules: { rule: AutoRule; index: number }[]
  place: string
}

function scopeOf(o: AutoOpen): Scope | null {
  if (o.lib) {
    const rules = (listOf('lib')?.rules ?? []).filter((x) => x.kind === 'library' && !x.builtIn).map((x) => ({ rule: x.rule, index: x.ref.index }))
    return { where: 'lib', lib: true, tb: null, ctx: null, cols: [], rules, place: t('库里') }
  }
  const tb = autoTable()
  if (!tb?.ctx || !tb.where) return null
  return { where: tb.where, lib: false, tb, ctx: tb.ctx, cols: allColumns(tb.ctx), rules: rulesOf(tb.src).map((rule, index) => ({ rule, index })), place: t('数据库「{name}」', { name: dbName(tb.folder ?? '') }) }
}

/** 右栏标签上的名字 */
export function useAutoTitle(): string | null {
  useAuto()
  return autoOpenNow() ? t('自动化') : null
}

export function AutoPane() {
  useAuto()
  wireAuto()
  const o = autoOpenNow()
  const sc = o ? scopeOf(o) : null
  const where = o?.lib ? 'lib' : (autoTable()?.where ?? null)
  useEffect(() => void reload(where), [where])
  if (!o) return <div className="au au-empty">{t('在数据库块头点「自动化」，在这里看规则、建规则')}</div>
  if (!sc) return <div className="au au-empty">{autoTable()?.ctx ? t('这个数据库还没存进文档：存好以后再建自动化') : t('先打开放这个数据库的那篇文档')}</div>
  if (o.pane === 'edit' && o.edit) return <AutoEditor key={o.edit.kind === 'rule' ? `r${o.edit.index}` : `b${o.edit.col}`} sc={sc} edit={o.edit} />
  return o.pane === 'log' ? <LogPage sc={sc} /> : <ListPage sc={sc} say={o.say} />
}

/** 记录里给人看的几行：撤回本身那一行不单列（原来那行划掉） */
const shownLog = (rows: AutoLogRow[] | null) => rows?.filter((r) => !r.undo) ?? null

/** 规则 N · 记录 N ……数据库「账目」 */
function Seg(props: { sc: Scope; pane: 'list' | 'log' }) {
  const log = shownLog(logOf(props.sc.where))
  return (
    <div className="au-seg" role="tablist" aria-label={t('自动化')}>
      <button type="button" role="tab" aria-selected={props.pane === 'list'} className={'s' + (props.pane === 'list' ? ' on' : '')} onClick={() => setAuto({ pane: 'list' })}>
        {t('规则')}
        <span className="n">{props.sc.rules.length}</span>
      </button>
      <button type="button" role="tab" aria-selected={props.pane === 'log'} className={'s' + (props.pane === 'log' ? ' on' : '')} onClick={() => setAuto({ pane: 'log' })}>
        {t('记录')}
        <span className="n">{log?.length ?? 0}</span>
      </button>
      <span className="sp" />
      <span className="t3 sm">{props.sc.place}</span>
    </div>
  )
}

// ---------------------------------------------------------------- 规则

/** 「比如」：照这个数据库的列说的几句（不预置规则，只是框里的例子） */
function examples(sc: Scope): string[] {
  if (sc.lib) return [t('每周日晚上 9 点提醒我整理这周的笔记'), t('每天早上 9 点提醒我看今天的待办'), t('每月最后一天把这个月写了什么写成摘要')]
  const ctx = sc.ctx!
  const out: string[] = []
  const sel = sc.cols.find((c) => c.type === 'select' || c.type === 'status')
  const opt = sel ? ctx.recs.map((r) => r.props[sel.id]).find((v) => v && v.trim()) : undefined
  if (sel && opt) out.push(t('{col}改成{opt}，就提醒我下周一处理', { col: sel.label, opt }))
  const num = sc.cols.find((c) => c.type === 'number')
  out.push(num ? t('{col}超过 500 就通知我', { col: num.label }) : t('新加一条就通知我'))
  out.push(t('每周日晚上 9 点提醒我看一眼{db}', { db: dbName(sc.tb?.folder ?? '') }))
  out.push(t('每月最后一天把这个月的写成摘要'))
  return out
}

function ListPage(props: { sc: Scope; say: string }) {
  const { sc } = props
  const box = useRef<HTMLTextAreaElement>(null)
  const chat = useChatEngine()
  const go = () => {
    const said = props.say.trim()
    if (!said) return box.current?.focus()
    startSay(sc.where, said)
  }
  return (
    <div className="au" /* 不翻：data-part 给 e2e 和样式认 */ data-part="自动化列表">
      <Seg sc={sc} pane="list" />
      <div className="au-body">
        <div className="au-say" /* 不翻：data-part 给 e2e 和样式认 */ data-part="说一句">
          <div className="h">
            <EngineLogo id={chat.id} size={13} />
            {t('说一句，AI 填成下面的规则')}
            <span className="sp" />
            <span className="t3">{t('你看过再存')}</span>
          </div>
          <textarea
            ref={box}
            aria-label={t('说一句')}
            placeholder={t('当……的时候，就……')}
            value={props.say}
            onChange={(e) => setAuto({ say: e.currentTarget.value })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (composing(e)) return
              if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), go())
            }}
          />
          <div className="exs">
            <span className="t3">{t('比如')}</span>
            {examples(sc).map((s) => (
              <button key={s} type="button" className="pill" onClick={() => (setAuto({ say: s }), box.current?.focus())}>
                {s}
              </button>
            ))}
          </div>
          <div className="row">
            <span className="t3 sm">{t('回车填表 · 也能')}</span>
            <button type="button" className="au-addl" onClick={() => setAuto({ pane: 'edit', edit: { kind: 'rule', index: null, draft: emptyRule(), said: null, filling: false, problems: [] } })}>
              {t('自己一格格选')}
            </button>
            <span className="sp" />
            <button type="button" className="btn-au solid" onClick={go}>
              {t('填成规则 ↵')}
            </button>
          </div>
        </div>
        {sc.rules.map(({ rule, index }) => (
          <RuleCard key={`${index}-${rule.name}`} sc={sc} rule={rule} index={index} />
        ))}
      </div>
      <div className="au-foot">
        <Codicon name="info" size={14} />
        <span>{sc.lib ? t('库里的规则写在 {file}，只能定时。', { file: AUTO_LIB_PATH }) : t('规则写在这个数据库的 base 块里（「改写法」最后一段）。自动化做的改动不会再触发别的自动化。')}</span>
        <button type="button" className="au-link" onClick={() => openSettingsAt('autoAll')}>
          {t('设置里看全部 ›')}
        </button>
      </div>
    </div>
  )
}

/** 说一句 → AI 填：右栏换成编辑这一条，三段上走一道光，填好了看一眼再存 */
function startSay(where: string, said: string) {
  setAuto({ pane: 'edit', edit: { kind: 'rule', index: null, draft: emptyRule(), said, filling: true, problems: [] } })
  void fromSentence(said, where).then((r) => {
    const o = autoOpenNow()
    if (!o?.edit || o.edit.kind !== 'rule' || o.edit.said !== said) return
    if (!r.ok) {
      setDraft((e) => ({ ...e, filling: false }) as AutoEdit)
      app().notice(t('没填出来：{why}', { why: r.error }))
      return
    }
    setDraft(() => ({ kind: 'rule', index: null, draft: r.rule, said, filling: false, problems: r.problems }))
  })
}

/** 写规则文件以后：出错说一句；存进去了但有问题的也说一句 */
export function written(r: { ok: true; problems: string[] } | { ok: false; error: string }, said: string, undo?: () => void): boolean {
  if (!r.ok) {
    app().notice(t('没写进去：{why}', { why: r.error }))
    return false
  }
  app().toast({ text: r.problems.length ? t('{said} · 还有问题：{p}', { said, p: r.problems.join('；') }) : said, icon: 'symbol-event', undo })
  return true
}

function RuleCard(props: { sc: Scope; rule: AutoRule; index: number }) {
  const { sc, rule, index } = props
  const where = sc.where
  const ref = { where, index }
  const typeOf = (c: string) => (sc.ctx ? colTypeOf(sc.ctx, c) : 'text')
  const [menu, setMenu] = useState<PopAnchor | null>(null)
  const info = listOf(where)?.rules.find((x) => x.ref.index === index && x.rule.name === rule.name)
  const running = useRunning(where, rule.name)
  const timed = rule.when.some((w) => w.on === 'every' || w.on === 'date')
  const chat = useChatEngine()
  const edit = () => setAuto({ pane: 'edit', edit: { kind: 'rule', index, draft: structuredClone(rule), said: null, filling: false, problems: info?.problems ?? [] } })
  const where1 = sc.lib ? t('写进 {file} 那一行 on', { file: AUTO_LIB_PATH }) : t('写进 base 块那一行 on')
  const toggle = (on: boolean) => void toggleRule(ref, on).then((r) => written(r, on ? t('打开了「{name}」 · {where}', { name: rule.name, where: where1 }) : t('关掉了「{name}」 · {where}: false', { name: rule.name, where: where1 }), () => void toggleRule(ref, !on)))
  const run = async () => {
    setMenu(null)
    const r = await runRule(ref)
    if ('error' in r) app().notice(t('「{name}」没跑成：{why}', { name: rule.name, why: r.error }))
  }
  return (
    <div
      className={'au-card' + (rule.on ? '' : ' off') + (running ? ' running' : '')}
      /* 不翻：data-part 给 e2e 和样式认 */ data-part="一条自动化"
      data-name={rule.name}
      role="button"
      tabIndex={0}
      onClick={(e) => !(e.target as HTMLElement).closest('.ctl') && edit()}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && edit()}
    >
      <div className="nm">
        {hasAi(rule.do) ? <EngineLogo id={chat.id} size={13} /> : <Codicon name="symbol-event" size={14} />}
        <span>{rule.name}</span>
      </div>
      <div className="ctl">
        <button type="button" className="ib" aria-label={t('「{name}」的更多', { name: rule.name })} aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : anchorOf(e.currentTarget))}>
          <Codicon name="ellipsis" size={14} />
        </button>
        <Toggle on={rule.on} label={rule.name} onChange={toggle} />
      </div>
      <div className="sum">
        <RuleSentence rule={rule} typeOf={typeOf} />
      </div>
      {running ? (
        <div className="runline">
          <EngineLogo id={chat.id} size={12} className="aic-pulse" />
          <span>{running.reading ? t('在跑 · 读了 {n}条', { n: running.reading }) : t('在跑「{name}」', { name: rule.name })}</span>
          <span className="aic-shim" />
        </div>
      ) : (
        <div className="am">
          <Codicon name="history" size={12} />
          {info?.error ? <span className="e">{t('上次出错停下了：{why}', { why: info.error })}</span> : info?.runs ? t('跑过{n}次 · 上次{at}', { n: info.runs, at: atText(info.last!) }) : t('还没跑过')}
          {timed && rule.missed !== 'skip' && ` · ${t('Mac 关着错过的，下次打开补跑')}`}
        </div>
      )}
      {menu && (
        <Menu at={menu} label={rule.name} onClose={() => setMenu(null)}>
          <div className="mlab">{rule.name}</div>
          <MenuItem icon="play" onClick={() => void run()}>
            {t('现在跑一次')}
          </MenuItem>
          <MenuItem icon="copy" onClick={() => (setMenu(null), void saveRule(where, null, { ...structuredClone(rule), name: t('{name} 副本', { name: rule.name }) }).then((r) => written(r, t('复制了「{name}」', { name: rule.name }))))}>
            {t('复制一份')}
          </MenuItem>
          <MenuItem icon="history" onClick={() => (setMenu(null), setAuto({ pane: 'log' }))}>
            {t('看它的记录')}
          </MenuItem>
          <div className="sep" />
          <MenuItem icon="trash" onClick={() => (setMenu(null), void removeRule(ref).then((r) => written(r, sc.lib ? t('删掉了「{name}」', { name: rule.name }) : t('删掉了「{name}」 · 只拿掉 base 块里这一条那几行', { name: rule.name }), () => void saveRule(where, null, rule))))}>
            {t('删掉')}
          </MenuItem>
        </Menu>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 正在跑的（auto:started / auto:done）

const runningNow = new Map<number, AutoStarted>()
const runSubs = new Set<() => void>()
let runWired = false
function wireRuns() {
  if (runWired) return
  runWired = true
  onStarted((s) => (runningNow.set(s.run, s), runSubs.forEach((f) => f())))
  onRunDone((d) => (runningNow.delete(d.run), runSubs.forEach((f) => f())))
}
/** 这一条正在跑：卡片上「在读几条」 */
export function useRunning(where: string, name: string): AutoStarted | null {
  const [, bump] = useState(0)
  useEffect(() => {
    wireRuns()
    const f = () => bump((x) => x + 1)
    runSubs.add(f)
    return () => void runSubs.delete(f)
  }, [])
  return [...runningNow.values()].find((s) => s.where === where && s.rule === name) ?? null
}

// ---------------------------------------------------------------- 记录

function LogPage(props: { sc: Scope }) {
  const rows = shownLog(logOf(props.sc.where))
  return (
    <div className="au" /* 不翻：data-part 给 e2e 和样式认 */ data-part="自动化记录">
      <Seg sc={props.sc} pane="log" />
      <div className="au-body">
        <div className="note12">{t('每次跑一行：什么时候、哪一条、因为什么、做了什么。改了文件的那次是一次提交，点「撤回」退回那一次。')}</div>
        <div className="au-log">{rows === null ? <div className="t3 sm">{t('在读记录…')}</div> : rows.length ? rows.map((r) => <LogRow key={r.id} run={r} />) : <div className="t3 sm">{t('还没跑过')}</div>}</div>
      </div>
      <div className="au-foot">
        <Codicon name="history" size={14} />
        <span>
          {/* 不翻：库里的路径 */}
          {t('记录存在库里')} <code>.canvas-notes/自动化记录/</code>
          {t('，跟着 Git 走，手机上也看得到')}
        </span>
      </div>
    </div>
  )
}

export function LogRow(props: { run: AutoLogRow }) {
  const r = props.run
  const [busy, setBusy] = useState(false)
  const undo = async () => {
    setBusy(true)
    const res = await undoRun(r.id)
    setBusy(false)
    if (!res.ok) app().notice(t('撤不回：{why}', { why: res.error }))
    else app().notice(t('撤回了「{name}」那一次 · 撤回本身也是一次提交', { name: r.rule }), 'discard')
    void reload(r.where)
  }
  const note = r.by === 'missed' ? t('打开画布笔记时补跑的；错过几次也只补最近一次') : r.by === 'auto' && r.ok && !!r.path && r.files.includes(r.path) ? t('这一格是自动化写的：不会再触发别的自动化') : null
  return (
    <div className={'au-lrow' + (r.undone ? ' undone' : '') + (r.ok ? '' : ' err')} /* 不翻：data-part 给 e2e 和样式认 */ data-part="一行记录" data-name={r.rule} data-id={r.id}>
      <div className="t">
        <b>{r.rule}</b>
        <span>·</span>
        <span className="num">{atText(r.t)}</span>
      </div>
      <div className="w">
        <span className="k">{t('因为')}</span> {r.why}
        <br />
        <span className="k">{t('做了')}</span> {r.ok ? (r.skipped ? t('跳过了') : r.did.join('，')) : <span className="e">{r.error}</span>}
      </div>
      <div className="u">
        {r.undone ? (
          <span className="t3 sm">{t('撤回了')}</span>
        ) : r.undoable ? (
          <button type="button" className="btn-au ghost" disabled={busy} onClick={() => void undo()}>
            <Codicon name="discard" size={12} />
            {t('撤回')}
          </button>
        ) : r.ok && !r.skipped ? (
          <span className="t3 sm">{t('通知收不回')}</span>
        ) : null}
      </div>
      {note && (
        <div className="sub">
          <Codicon name="info" size={12} />
          {note}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 编辑一条

type WhenKind = (typeof AUTO_WHENS)[number]['on']
const kindOf = (w: AutoWhen): WhenKind => (w.on === 'changed' && w.to !== undefined ? 'set' : w.on)
const WHEN_ICON = Object.fromEntries(AUTO_WHENS.map((w) => [w.on, w.icon])) as Record<WhenKind, string>
type StepInfo = (typeof AUTO_STEPS)[number]
const stepInfo = (s: AutoStep): StepInfo | undefined => AUTO_STEPS.find((x) => x.kind === s.do && (!x.ai || (s.do === 'ai' && x.ai === s.ai)))
/** 库里的规则只能定时、不能改某一条（同 checkRule） */
const libOk = (x: StepInfo) => !(x.kind === 'set' || x.kind === 'newRow' || (x.kind === 'ai' && x.ai !== 'summary'))

/** 编辑时能选的列（名字列、算出来的不能当「改成」的目标，但能当触发） */
const editable = (cols: ColumnInfo[]) => cols.filter((c) => c.id !== 'file.name' && !c.computed && c.type !== 'button')

function newWhen(k: WhenKind, cols: ColumnInfo[]): AutoWhen {
  const first = editable(cols)[0]?.label ?? ''
  const sel = cols.find((c) => c.type === 'select' || c.type === 'status')?.label ?? first
  const date = cols.find((c) => c.type === 'date')?.label ?? first
  if (k === 'changed') return { on: 'changed', prop: first }
  if (k === 'set') return { on: 'changed', prop: sel, to: '' }
  if (k === 'date') return { on: 'date', prop: date, at: '9:00' }
  // 不翻：写进文件的、e2e 认的
  if (k === 'every') return { on: 'every', every: 'week', day: '日', at: '21:00' }
  return { on: 'added' }
}

function newStep(info: StepInfo, sc: Scope, when: AutoWhen[]): AutoStep {
  const first = editable(sc.cols)[0]?.label ?? ''
  const folder = sc.tb?.folder ?? ''
  // 不翻：写进文件的、e2e 认的
  const top = folder.split('/')[0] || folder || '收件箱'
  // 不翻：写进文件的默认文件夹、日子写法（引擎认中文的日子）
  switch (info.kind) {
    case 'set': {
      const prop = when.find((w): w is Extract<AutoWhen, { prop: string }> => 'prop' in w)?.prop ?? first
      return { do: 'set', values: { [prop]: '' } }
    }
    case 'newRow':
      return { do: 'newRow', copy: editable(sc.cols).map((c) => c.label), set: {} }
    case 'ai':
      // 不翻：写进文件的、e2e 认的
      return info.ai === 'cell' ? { do: 'ai', ai: 'cell', prop: first, prompt: '' } : info.ai === 'note' ? { do: 'ai', ai: 'note', prompt: '', folder: `${folder}/笔记` } : { do: 'ai', ai: 'summary', prompt: '', folder: sc.lib ? '收件箱' : `${folder}/摘要` }
    case 'todo':
      // 不翻：写进文件的、e2e 认的
      return { do: 'todo', text: '', file: `${top}/待办.md`, date: '明天 9:00' }
    case 'notify':
      return { do: 'notify', text: '' }
    case 'command':
      return { do: 'command', command: '' }
    case 'ask':
      return { do: 'ask', text: '' }
    case 'open':
      return { do: 'open' }
    case 'tidyInbox':
      return { do: 'tidyInbox' }
    default:
      return { do: 'newNote', folder: '', name: '' }
  }
}

/**
 * 照字数撑开的小输入框（看起来是一颗小块，点了就能改）。vars：没在改的时候 {{名字}} 画成小灰块（原型），点一下才露出原文改；
 * icon：前面一个小图标（文件、文件夹），框跟着字撑开
 */
function Chip(props: { value: string; label: string; placeholder?: string; vars?: boolean; icon?: CodiconName; onChange(v: string): void }) {
  const [editing, setEditing] = useState(false)
  const shown = props.value || props.placeholder || ''
  const wide = [...shown].reduce((n, ch) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.56), 0)
  if (props.vars && !editing && /\{\{[^}]+\}\}/.test(props.value))
    return (
      <span className="ch vars" role="button" tabIndex={0} aria-label={props.label} onClick={() => setEditing(true)} onFocus={() => setEditing(true)}>
        {withVars(props.value)}
      </span>
    )
  const input = (
    <input
      className={props.icon ? 'bare' : 'ch'}
      aria-label={props.label}
      value={props.value}
      placeholder={props.placeholder}
      autoFocus={editing}
      style={{ width: `calc(${Math.max(2, wide)}em + ${props.icon ? 2 : 14}px)` }}
      onBlur={() => setEditing(false)}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  )
  return props.icon ? (
    <span className="ch with-ic">
      <Codicon name={props.icon} size={12} />
      {input}
    </span>
  ) : (
    input
  )
}

/** 挑一列的小块 */
function ColChip(props: { value: string; cols: ColumnInfo[]; label: string; onChange(v: string): void }) {
  const has = props.cols.some((c) => c.label === props.value)
  return (
    <select className="ch sel" aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>
      {!has && <option value={props.value}>{props.value || t('选一列')}</option>}
      {props.cols.map((c) => (
        <option key={c.id} value={c.label}>
          {colText(c.id)}
        </option>
      ))}
    </select>
  )
}

type Trial = { kind: 'note'; text: string } | { kind: 'trial'; why: string; fits: boolean; steps: string[]; problems: string[] }

function AutoEditor(props: { sc: Scope; edit: AutoEdit }) {
  const { sc, edit } = props
  const { where, tb, ctx, cols } = sc
  const chat = useChatEngine()
  const isBtn = edit.kind === 'button'
  const rule: AutoRule = edit.kind === 'rule' ? edit.draft : { ...emptyRule(), name: edit.col, do: edit.draft }
  const filling = edit.kind === 'rule' && edit.filling
  const [yaml, setYaml] = useState(false)
  const [trial, setTrial] = useState<Trial | null>(null)
  const [busy, setBusy] = useState(false)
  const [pop, setPop] = useState<{ kind: 'when'; i: number; at: PopAnchor } | { kind: 'step'; at: PopAnchor } | { kind: 'missed'; at: PopAnchor } | null>(null)
  const typeOf = (c: string): FieldType => (ctx ? colTypeOf(ctx, cols.find((x) => x.label === c)?.id ?? c) : 'text')
  const sample = ctx ? ((tb?.order[0] ? ctx.recs.find((r) => r.path === tb.order[0]) : undefined) ?? ctx.recs[0]) : undefined

  const put = (f: (r: AutoRule) => AutoRule) => {
    setTrial(null)
    setDraft((e) => (e.kind === 'rule' ? { ...e, draft: f(e.draft) } : { ...e, draft: f({ ...emptyRule(), do: e.draft }).do }))
  }
  const putStep = (i: number, s: AutoStep) => put((r) => ({ ...r, do: r.do.map((x, k) => (k === i ? s : x)) }))
  const putWhen = (i: number, w: AutoWhen) => put((r) => ({ ...r, when: r.when.map((x, k) => (k === i ? w : x)) }))
  const items = rule.if?.items ?? []
  const conds = items.filter((x): x is BaseCond => !isGroup(x) && !isRaw(x))
  const rest = items.filter((x) => isGroup(x) || isRaw(x))
  const putConds = (cs: BaseCond[]) => put((r) => ({ ...r, if: cs.length || rest.length ? { conj: r.if?.conj ?? 'and', items: [...cs, ...rest] } : null }))
  const timed = rule.when.some((w) => w.on === 'every' || w.on === 'date')

  const back = () => setAuto({ pane: 'list', edit: null })
  const save = async () => {
    setBusy(true)
    try {
      if (edit.kind === 'button') {
        if (!tb) return
        const col = (edit.col || t('按钮', { ctx: '数据库' })).trim()
        const before = tb.src
        tb.edit((src) => {
          let out = setButtonSteps(src, col, edit.draft)
          if (edit.isNew) {
            const cur = tb.columns.length ? tb.columns : ['file.name']
            const at = Math.max(1, Math.min(edit.index, cur.length))
            out = setBaseOrder(out, [...cur.slice(0, at), col, ...cur.slice(at)], tb.view)
          }
          return out
        })
        app().toast({ text: edit.isNew ? t('加了按钮列「{col}」 · 写进 base 块 properties 那一段', { col }) : t('存好了按钮「{col}」 · 写进 base 块 properties 那一段', { col }), icon: 'play-circle', undo: () => tb.edit(() => before) })
      } else {
        const named = { ...rule, name: rule.name.trim() || t('没起名的自动化') }
        const r = await saveRule(where, edit.index, named)
        const index = r.ok ? r.ref.index : null
        const said = edit.index === null ? (sc.lib ? t('加了自动化「{name}」 · 写进 {file}', { name: named.name, file: AUTO_LIB_PATH }) : t('加了自动化「{name}」 · 写进 base 块的 automations', { name: named.name })) : sc.lib ? t('存好了「{name}」', { name: named.name }) : t('存好了「{name}」 · 只换了 base 块里这一条那几行', { name: named.name })
        if (!written(r, said, edit.index === null && index !== null ? () => void removeRule({ where, index }) : undefined)) return
      }
      setAuto({ pane: 'list', edit: null, say: '' })
    } finally {
      setBusy(false)
    }
  }
  const tryIt = async () => {
    if (!rule.when.length) return setTrial({ kind: 'note', text: t('还没选「当」：先选什么时候跑') })
    if (!rule.do.length) return setTrial({ kind: 'note', text: t('还没有「就」：加一步') })
    const r = await trialRule(where, rule, sample?.path)
    setTrial({ kind: 'trial', ...r })
  }

  const whenSec = !isBtn && (
    <div className="au-sec" /* 不翻：data-part 给 e2e 和样式认 */ data-part="当">
      <div className="lab">
        <Codicon name="symbol-event" size={14} />
        {t('当')}
        <span className="t3">{t('· 几样里任一样发生')}</span>
      </div>
      <div className="box">
        {rule.when.length ? (
          rule.when.map((w, i) => (
            <div className="trow" key={i}>
              {i > 0 && <span className="or">{t('或')}</span>}
              <button type="button" className="ch" aria-label={t('当：{what}', { what: whenLabel(w) })} onClick={(e) => setPop({ kind: 'when', i, at: anchorOf(e.currentTarget) })}>
                <Codicon name={ICON(WHEN_ICON[kindOf(w)])} size={12} />
                {w.on === 'changed' && w.to === '' ? (
                  <>
                    {whenLabel({ on: 'changed', prop: w.prop }).replace(/改了$/, '')}
                    {t('改成')}
                    <span className="t3">{t('选一个值')}</span>
                  </>
                ) : (
                  whenLabel(w)
                )}
                <Codicon name="chevron-down" size={12} />
              </button>
              <button type="button" className="ib x" aria-label={t('拿掉这一样')} onClick={() => put((r) => ({ ...r, when: r.when.filter((_, k) => k !== i) }))}>
                <Codicon name="close" size={12} />
              </button>
            </div>
          ))
        ) : (
          <div className="trow">
            <button type="button" className="ch unset" onClick={(e) => setPop({ kind: 'when', i: 0, at: anchorOf(e.currentTarget) })}>
              {t('选一个')}
              <Codicon name="chevron-down" size={12} />
            </button>
          </div>
        )}
        {rule.when.length > 0 && (
          <button type="button" className="au-addl" onClick={(e) => setPop({ kind: 'when', i: rule.when.length, at: anchorOf(e.currentTarget) })}>
            <Codicon name="add" size={12} />
            {t('或者…')}
          </button>
        )}
      </div>
      {timed && (
        <div className="offrow" /* 不翻：data-part 给 e2e 和样式认 */ data-part="Mac 关着时">
          <Codicon name="info" size={12} />
          {t('Mac 关着、画布笔记没开时：')}
          <button type="button" className="ch" onClick={(e) => setPop({ kind: 'missed', at: anchorOf(e.currentTarget) })}>
            {rule.missed === 'skip' ? t('跳过，记一行「错过了」') : t('下次打开补跑一次')}
            <Codicon name="chevron-down" size={12} />
          </button>
        </div>
      )}
    </div>
  )

  const ifSec = !isBtn && !sc.lib && (
    <div className="au-sec" /* 不翻：data-part 给 e2e 和样式认 */ data-part="如果">
      <div className="lab">
        <Codicon name="filter" size={14} />
        {t('如果')}
        <span className="t3">{t('· 可以不填，写法和筛选一样')}</span>
      </div>
      <div className="box">
        {conds.map((c, i) => {
          const col = cols.find((x) => x.id === c.prop || x.label === c.prop)
          const type: FieldType = col?.type ?? 'text'
          const ops = FILTER_OPS[type] ?? FILTER_OPS.text
          const op = ops.find((o) => o.op === c.op) ?? ops[0]!
          const set = (x: Partial<BaseCond>) => putConds(conds.map((y, k) => (k === i ? { ...y, ...x } : y)))
          return (
            <div className="trow" key={i}>
              {i > 0 && <span className="or">{rule.if?.conj === 'or' ? t('或') : t('且')}</span>}
              <select className="ch sel" aria-label={t('哪一列')} value={col?.id ?? c.prop} onChange={(e) => set({ prop: e.currentTarget.value })}>
                {cols
                  .filter((x) => x.type !== 'button')
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {colText(x.id)}
                    </option>
                  ))}
              </select>
              <select className="ch sel" aria-label={t('条件')} value={op.op} onChange={(e) => set({ op: e.currentTarget.value as BaseCond['op'] })}>
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>
                    {fmt(o.label)}
                  </option>
                ))}
              </select>
              {op.value && <Chip label={t('值')} value={c.value} placeholder={t('值')} onChange={(v) => set({ value: v })} />}
              <button type="button" className="ib x" aria-label={t('拿掉这一条条件')} onClick={() => putConds(conds.filter((_, k) => k !== i))}>
                <Codicon name="close" size={12} />
              </button>
            </div>
          )
        })}
        {rest.length > 0 && <div className="note12">{t('还有 {n} 条写法里的条件，这里不改：点上面「看写法」看', { n: rest.length })}</div>}
        <button
          type="button"
          className="au-addl"
          onClick={() => {
            const c = editable(cols)[0]
            const ops = FILTER_OPS[c?.type ?? 'text'] ?? FILTER_OPS.text
            putConds([...conds, { prop: c?.id ?? 'file.name', op: ops[0]!.op, value: '' }])
          }}
        >
          <Codicon name="add" size={12} />
          {t('加一条条件')}
        </button>
      </div>
    </div>
  )

  const loopCol = (s: AutoStep) => s.do === 'set' && rule.when.some((w) => w.on === 'changed' && Object.keys(s.values).includes(w.prop))
  const steps = (
    <div className="au-sec" /* 不翻：data-part 给 e2e 和样式认 */ data-part="就">
      <div className="lab">
        <Codicon name={isBtn ? 'play-circle' : 'run-all'} size={14} />
        {isBtn ? t('点一下就') : t('就')}
        <span className="t3">{t('· 从上到下一步步做')}</span>
      </div>
      <div className="box">
        {rule.do.map((s, i) => {
          const info = stepInfo(s)
          return (
            <div className="au-step" key={i} /* 不翻：data-part 给 e2e 和样式认 */ data-part="一步" data-kind={s.do}>
              <span className="no">{i + 1}</span>
              <span className="tt">
                {s.do === 'ai' ? <EngineLogo id={chat.id} size={14} /> : <Codicon name={ICON(info?.icon ?? 'question')} size={14} />}
                {info ? fmt(info.label) : stepLabel(s)}
              </span>
              <button type="button" className="ib" aria-label={t('拿掉第 {n} 步', { n: i + 1 })} onClick={() => put((r) => ({ ...r, do: r.do.filter((_, k) => k !== i) }))}>
                <Codicon name="close" size={12} />
              </button>
              <div className="pp">
                <StepParams s={s} cols={cols} engine={chat.label} onChange={(x) => putStep(i, x)} />
              </div>
              {loopCol(s) && <div className="warn">{t('这一步改的「{col}」正是触发它的那一列：自动化改的不会再触发自动化，不会转圈', { col: Object.keys((s as Extract<AutoStep, { do: 'set' }>).values)[0] ?? '' })}</div>}
            </div>
          )
        })}
        <button type="button" className="au-addl" onClick={(e) => setPop({ kind: 'step', at: anchorOf(e.currentTarget) })}>
          <Codicon name="add" size={12} />
          {t('加一步')}
        </button>
      </div>
    </div>
  )

  const stepChoices = AUTO_STEPS.filter((x) => (x.only === 'button' ? isBtn : x.only === 'library' ? sc.lib : sc.lib ? libOk(x) : true))
  const groups = [...new Set(stepChoices.map((x) => x.group))]
  const whenChoices = sc.lib ? AUTO_WHENS.filter((w) => w.on === 'every') : AUTO_WHENS
  const problems = edit.kind === 'rule' ? edit.problems : []

  return (
    <div className="au" /* 不翻：data-part 给 e2e 和样式认 */ data-part={isBtn ? '按钮做的事' : '编辑一条自动化'}>
      <div className="au-top">
        <button type="button" className="ib" aria-label={t('回到规则')} onClick={back}>
          <Codicon name="arrow-left" size={14} />
        </button>
        <input
          className="nmi"
          aria-label={isBtn ? t('按钮叫什么') : t('规则叫什么')}
          placeholder={t('给它起个名字')}
          value={edit.kind === 'rule' ? edit.draft.name : edit.col}
          readOnly={edit.kind === 'button' && !edit.isNew}
          onChange={(e) => {
            const v = e.currentTarget.value
            setDraft((x) => (x.kind === 'rule' ? { ...x, draft: { ...x.draft, name: v } } : { ...x, col: v }))
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button type="button" className={'ib' + (yaml ? ' on' : '')} aria-label={t('看写法')} aria-pressed={yaml} data-tip={t('看写法')} onClick={() => setYaml((x) => !x)}>
          <Codicon name="code" size={14} />
        </button>
      </div>
      <div className={'au-ed' + (filling ? ' filling' : '')}>
        {edit.kind === 'rule' && edit.said && (
          <div className="au-filled">
            <EngineLogo id={chat.id} size={13} className={filling ? 'aic-pulse' : undefined} />
            <span>{filling ? t('AI 在把「{said}」填成下面三段…', { said: edit.said }) : t('照「{said}」填好了：看一眼再存，没填对的直接改', { said: edit.said })}</span>
          </div>
        )}
        {isBtn && <div className="note12">{t('按钮是一列：每一行一颗，点了对那一行做下面这几步；右栏打开一条时也能点。按钮做的事能触发自动化（比如新建的那条照样会被别的自动化接着做）。')}</div>}
        {problems.length > 0 && !filling && (
          <div className="au-warn" /* 不翻：data-part 给 e2e 和样式认 */ data-part="规则的问题">
            <Codicon name="warning" size={12} />
            {problems.join('；')}
          </div>
        )}
        {whenSec}
        {ifSec}
        {steps}
        {trial && (
          <div className="au-trial" /* 不翻：data-part 给 e2e 和样式认 */ data-part="试跑">
            {trial.kind === 'note' ? (
              trial.text
            ) : (
              <>
                <b>{t('试跑')}</b>
                {trial.fits ? t('：{why}，会做：', { why: trial.why }) : t('：{why}。', { why: trial.why })}
                {trial.fits &&
                  trial.steps.map((l, i) => (
                    <span key={i}>
                      <br />
                      {i + 1}. {withVars(l)}
                    </span>
                  ))}
                {trial.problems.length > 0 && (
                  <>
                    <br />
                    <span className="e">{t('还有问题：{p}', { p: trial.problems.join('；') })}</span>
                  </>
                )}
                <br />
                <span className="t3">{t('只是给你看，什么都没写')}</span>
              </>
            )}
          </div>
        )}
        {yaml && (
          <>
            <pre className="au-yaml" /* 不翻：data-part 给 e2e 和样式认 */ data-part="这一条的写法">
              {edit.kind === 'button' ? buttonYaml(edit.col || t('按钮', { ctx: '数据库' }), edit.draft) : ruleYaml(rule)}
            </pre>
            <div className="note12">{isBtn ? t('按钮是 properties 里一列 type: button，do 和自动化的动作同一套写法') : sc.lib ? t('库里的规则写在 {file} 的 yaml 块里，和数据库里的同一种写法', { file: AUTO_LIB_PATH }) : t('这一段在 base 块最后的 automations 里；条件和筛选同一种写法')}</div>
          </>
        )}
      </div>
      <div className="au-edfoot">
        <span className="msg">{isBtn ? t('点了直接做，底部能撤回') : sample ? t('试跑拿「{name}」走一遍，只给你看', { name: sample.name }) : t('试跑只给你看，不写文件')}</span>
        <span className="sp" />
        {!isBtn && (
          <button type="button" className="btn-au" disabled={filling} onClick={() => void tryIt()}>
            <Codicon name="play" size={12} />
            {t('试跑')}
          </button>
        )}
        <button type="button" className="btn-au solid" disabled={busy || filling || (isBtn && !rule.do.length)} onClick={() => void save()}>
          {t('存')}
        </button>
      </div>
      {pop?.kind === 'when' && (
        <Menu at={pop.at} label={t('当什么时候')} wide onClose={() => setPop(null)}>
          <div className="mlab">{t('当什么时候')}</div>
          {whenChoices.map((w) => {
            const cur = rule.when[pop.i]
            return (
              <MenuItem
                key={w.on}
                icon={ICON(w.icon)}
                desc={fmt(w.desc)}
                on={!!cur && kindOf(cur) === w.on}
                onClick={() => {
                  const x = cur && kindOf(cur) === w.on ? cur : newWhen(w.on, cols)
                  put((r) => {
                    const next = [...r.when]
                    next[pop.i] = x
                    return { ...r, when: next }
                  })
                  // 要填的（哪一列、改成什么、几点）就在这个菜单下面填，填完点别处收起
                  if (x.on === 'added') setPop(null)
                }}
              >
                {fmt(w.label)}
              </MenuItem>
            )
          })}
          {rule.when[pop.i] && rule.when[pop.i]!.on !== 'added' && (
            <>
              <div className="sep" />
              <div className="mlab">{t('细节')}</div>
              <div className="au-wp" /* 不翻：data-part 给 e2e 和样式认 */ data-part="当的细节">
                <WhenParams w={rule.when[pop.i]!} cols={cols} onChange={(x) => putWhen(pop.i, x)} />
              </div>
            </>
          )}
        </Menu>
      )}
      {pop?.kind === 'step' && (
        <Menu at={pop.at} label={t('加一步')} wide onClose={() => setPop(null)}>
          {groups.map((g, gi) => (
            <div key={g} role="group" aria-label={fmt(g)}>
              {gi > 0 && <div className="sep" />}
              <div className="mlab">{fmt(g)}</div>
              {stepChoices
                .filter((x) => x.group === g)
                .map((x) => (
                  <MenuItem
                    key={x.kind + (x.ai ?? '')}
                    icon={x.kind === 'ai' ? undefined : ICON(x.icon)}
                    logo={x.kind === 'ai' ? <EngineLogo id={chat.id} size={14} /> : undefined}
                    onClick={() => (put((r) => ({ ...r, do: [...r.do, newStep(x, sc, r.when)] })), setPop(null))}
                  >
                    {fmt(x.label)}
                  </MenuItem>
                ))}
            </div>
          ))}
        </Menu>
      )}
      {pop?.kind === 'missed' && (
        <Menu at={pop.at} label={t('Mac 关着时错过了')} wide onClose={() => setPop(null)}>
          <div className="mlab">{t('Mac 关着时错过了')}</div>
          <MenuItem desc={t('错过几次也只补最近一次')} on={rule.missed !== 'skip'} onClick={() => (put((r) => ({ ...r, missed: 'once' })), setPop(null))}>
            {t('下次打开补跑一次')}
          </MenuItem>
          <MenuItem on={rule.missed === 'skip'} onClick={() => (put((r) => ({ ...r, missed: 'skip' })), setPop(null))}>
            {t('跳过，记一行「错过了」')}
          </MenuItem>
          <div className="hint2">{t('提醒类的一步（加待办带提醒）交给画布今日，Mac 关着也准时响')}</div>
        </Menu>
      )}
    </div>
  )
}

/** 「当」那一样要填的：哪一列、改成什么、提前几天、几点、每周几（在「当」的菜单下面） */
function WhenParams(props: { w: AutoWhen; cols: ColumnInfo[]; onChange(w: AutoWhen): void }) {
  const { w, cols } = props
  const trig = cols.filter((c) => c.id !== 'file.name' && c.type !== 'button')
  if (w.on === 'added') return null
  if (w.on === 'changed')
    return (
      <>
        <ColChip label={t('哪一列')} value={w.prop} cols={trig} onChange={(prop) => props.onChange({ ...w, prop })} />
        {w.to !== undefined && (
          <>
            <span className="t3">{t('改成')}</span>
            <Chip label={t('改成')} value={w.to} placeholder={t('什么')} onChange={(to) => props.onChange({ ...w, to })} />
          </>
        )}
      </>
    )
  if (w.on === 'date')
    return (
      <>
        <ColChip label={t('哪一列')} value={w.prop} cols={cols.filter((c) => c.type === 'date')} onChange={(prop) => props.onChange({ ...w, prop })} />
        <span className="t3">{t('提前')}</span>
        <Chip label={t('提前几天')} value={w.before ? String(w.before) : ''} placeholder="0" onChange={(v) => props.onChange({ ...w, before: Math.max(0, Number(v) || 0) || undefined })} />
        <span className="t3">{t('天')}</span>
        <Chip label={t('几点')} value={w.at ?? ''} placeholder="9:00" onChange={(at) => props.onChange({ ...w, at })} />
      </>
    )
  return (
    <>
      <select
        className="ch sel"
        aria-label={t('多久一次')}
        value={w.every}
        onChange={(e) => {
          const every = e.currentTarget.value as 'day' | 'week' | 'month'
          // 不翻：写进文件的、e2e 认的
          props.onChange({ ...w, every, day: every === 'week' ? '日' : every === 'month' ? 'last' : undefined })
        }}
      >
        <option value="day">{t('每天')}</option>
        <option value="week">{t('每周')}</option>
        <option value="month">{t('每月')}</option>
      </select>
      {w.every === 'week' && (
        // 不翻：写进文件的、e2e 认的
        <select className="ch sel" aria-label={t('周几')} value={w.day ?? '日'} onChange={(e) => props.onChange({ ...w, day: e.currentTarget.value })}>
          {WEEKDAYS.map((d) => (
            <option key={d} value={d}>
              {t('周{day}', { day: t(d, { ctx: '星期' }) })}
            </option>
          ))}
        </select>
      )}
      {w.every === 'month' && (
        <select className="ch sel" aria-label={t('几号')} value={w.day ?? 'last'} onChange={(e) => props.onChange({ ...w, day: e.currentTarget.value })}>
          <option value="last">{t('最后一天')}</option>
          {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => (
            <option key={d} value={d}>
              {t('{d}号', { d })}
            </option>
          ))}
        </select>
      )}
      <Chip label={t('几点')} value={w.at} onChange={(at) => props.onChange({ ...w, at })} />
    </>
  )
}

/** 一步里要填的：照原型一句话里夹几颗能改的小块 */
function StepParams(props: { s: AutoStep; cols: ColumnInfo[]; engine: string; onChange(s: AutoStep): void }) {
  const { s, cols } = props
  const ed = editable(cols)
  const ai = (mode: AutoAiMode) => s.do === 'ai' && s.ai === mode
  switch (s.do) {
    case 'set': {
      const [prop, value] = Object.entries(s.values)[0] ?? ['', '']
      return (
        <>
          <span>{t('把')}</span>
          <ColChip label={t('哪一列')} value={prop} cols={ed} onChange={(p) => props.onChange({ ...s, values: { [p]: value } })} />
          <span>{t('改成')}</span>
          <Chip label={t('改成')} value={value} placeholder={t('什么')} onChange={(v) => props.onChange({ ...s, values: { [prop]: v } })} />
        </>
      )
    }
    case 'newRow':
      return (
        <>
          <span>{t('照这一条抄')}</span>
          <Chip label={t('照这一条抄哪几列')} value={(s.copy ?? []).join('、')} placeholder={t('哪几列')} onChange={(v) => props.onChange({ ...s, copy: v.split(/[、,，]\s*/).filter(Boolean) })} />
          <Chip
            label={t('新的一条填什么')}
            value={Object.entries(s.set ?? {})
              .map(([k, v]) => `${k} = ${v === 'today()' ? t('今天') : v}`)
              .join('、')}
            placeholder={`${props.cols.find((c) => c.type === 'date')?.label ?? t('日期')} = ${t('今天')}`}
            onChange={(v) =>
              props.onChange({
                ...s,
                set: Object.fromEntries(
                  v
                    .split(/[、,，]\s*/)
                    .map((x) => x.split(/\s*=\s*/))
                    .filter((x) => x[0])
                    // 给人看的是「今天」，写进文件的是 today()（引擎认的写法）
                    .map(([k, val]) => [k!, (val ?? '').trim() === t('今天') ? 'today()' : (val ?? '')]),
                ),
              })
            }
          />
        </>
      )
    case 'ai':
      if (ai('cell'))
        return (
          <>
            <span>{t('写进')}</span>
            <ColChip label={t('写进哪一格')} value={s.prop ?? ''} cols={ed} onChange={(prop) => props.onChange({ ...s, prop })} />
            <span>{t('要求')}</span>
            <Chip label={t('要求')} value={s.prompt} placeholder={t('写什么')} onChange={(prompt) => props.onChange({ ...s, prompt })} />
            <span className="t3">{t('读：这一条的笔记 · 用 {engine}（跟 AI 对话）', { engine: props.engine })}</span>
          </>
        )
      if (ai('note'))
        return (
          <>
            <span>{t('给这一条新建一篇，放进')}</span>
            <Chip label={t('放进哪个文件夹')} value={s.folder ?? ''} onChange={(folder) => props.onChange({ ...s, folder })} />
            <span>{t('要求')}</span>
            <Chip label={t('要求')} value={s.prompt} placeholder={t('写什么')} onChange={(prompt) => props.onChange({ ...s, prompt })} />
            <span className="t3">{t('两边都写关联 · 用 {engine}', { engine: props.engine })}</span>
          </>
        )
      return (
        <>
          <span>{t('读')}</span>
          <Chip label={t('读哪几条')} value={s.rows ?? ''} placeholder={t('这一条')} onChange={(rows) => props.onChange({ ...s, rows })} />
          <span>{t('写')}</span>
          <Chip label={t('要求')} value={s.prompt} placeholder={t('写什么')} onChange={(prompt) => props.onChange({ ...s, prompt })} />
          <span>{t('新建一篇放进')}</span>
          <Chip label={t('放进哪个文件夹')} value={s.folder ?? ''} onChange={(folder) => props.onChange({ ...s, folder })} />
          <span className="t3">{t('关联回这个数据库 · 正文是带标志的 AI 块 · 用 {engine}', { engine: props.engine })}</span>
        </>
      )
    case 'todo':
      return (
        <>
          <Chip label={t('待办写什么')} vars value={s.text} placeholder={t('写什么')} onChange={(text) => props.onChange({ ...s, text })} />
          <span>{t('写进')}</span>
          <Chip label={t('写进哪一篇')} icon="file" value={s.file ?? ''} onChange={(file) => props.onChange({ ...s, file })} />
          <span>{t('日子')}</span>
          <Chip label={t('日子')} value={s.date ?? ''} placeholder={t('明天 9:00')} onChange={(date) => props.onChange({ ...s, date })} />
          {/\d:\d\d/.test(s.date ?? '') && <span className="t3">{t('提醒交给画布今日，Mac 关着也准时响')}</span>}
        </>
      )
    case 'notify':
      return (
        <>
          <Chip label={t('通知写什么')} vars value={s.text} placeholder={t('写什么')} onChange={(text) => props.onChange({ ...s, text })} />
          <span className="t3">{t('这台 Mac 的系统通知，也记进底栏的通知铃')}</span>
        </>
      )
    case 'command':
      return (
        <>
          <Chip label={t('哪一条命令')} value={s.command} placeholder={t('/命令')} onChange={(command) => props.onChange({ ...s, command })} />
          <span>{t('对')}</span>
          <span className="ch ro">{t('这一条的笔记')}</span>
          <span className="t3">{t('命令自己的「先给你看」照旧')}</span>
        </>
      )
    case 'ask':
      return (
        <>
          <span>{t('弹一句')}</span>
          <Chip label={t('问什么')} value={s.text} placeholder={t('真的要…吗？')} onChange={(text) => props.onChange({ ...s, text })} />
          <span>{t('点了「好」才往下做')}</span>
        </>
      )
    case 'open':
      return <span>{t('新建的那条在右栏打开，名字格等你改')}</span>
    default:
      return <span className="t3">{t('这一步在写法里改')}</span>
  }
}

// ---------------------------------------------------------------- 小菜单

function Menu(props: { at: PopAnchor; label: string; wide?: boolean; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, [ref], () => props.onClose())
  return (
    <FloatPop at={props.at} className={'base-pop au-pop' + (props.wide ? ' wide' : '')} role="menu" aria-label={props.label}>
      <div ref={ref}>{props.children}</div>
    </FloatPop>
  )
}

function MenuItem(props: { icon?: CodiconName; logo?: ReactNode; desc?: string; on?: boolean; children: ReactNode; onClick(): void }) {
  return (
    <button type="button" role="menuitem" className={'au-mi' + (props.on ? ' on' : '')} onClick={props.onClick}>
      {props.logo ?? (props.icon ? <Codicon name={props.icon} size={14} /> : null)}
      <span>{props.children}</span>
      {props.desc && <span className="desc">{props.desc}</span>}
      {props.on && <Codicon name="check" size={14} className="ok" />}
    </button>
  )
}
