/**
 * 「存成命令」那张表（task-9womr，方向 C 第二版摆法 A「设置在右边」，小样 canvas-notes-commands/v2/proto-c2.html）。
 * - 从对话存（chat）：左边对照（改前 · N 轮之前 / 改后 · 现在 / 并排对照，并排用历史里的对比标签那一套），
 *   右边「看出的规矩」（打开就问 AI 比对，指一条左边亮出依据，点一下钉住）和「怎么用」五行（多了「选中小条」，task-26nz7），底下整宽「存之前看清它会改什么」；
 * - 从头写（new）、改自己的（edit）、复制自带的再改（copy）：同一张表没有左边对照，规矩一条条加；860 宽，影响卡六格排两列。
 * AI 对话、⌘K、/ 菜单用 commands/editor.ts 的 openCmdEditor 开它；App 挂一个 CmdEditorHost。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { uncollapseUnchanged } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type AiCmd, cleanName, descOf, impactOf, MAX_RULES, RULE_MAX, sameAsBuiltin, saveProblem, STORES, type TreeRow, type Where, WHERE, type Write, WRITES } from '../../shared/ai-cmds'
import type { DiffEntry, DiffResult } from '../../shared/diff'
import { anchorLines, type DistillCommit, type Distilled, type DistillInput, distillPrompt, parseDistill, scopeRule } from '../../shared/distill'
import { titleOf } from '../../shared/layout'
import { system } from '../ai-commands'
import { COLLAPSE, type DiffViews, TextDiff } from '../diff/DiffTab'
import { EngineLogo } from '../engine-logo'
import { isKey, keyFor, withKeys } from '../keys'
import { type CmdEditorInit, onCmdEditor } from './editor'
import { compact, evidence, foldRanges, type Place, placesOf, sameLines, setSpot, tidyDiff } from './evidence'
import { newCmdId, saveAiCmd } from './store'
import { rich, useLang, useT } from '../i18n'
import { list, t as tNow } from '../../shared/i18n'
import './save-cmd.css'
import { putOnBar } from '../sel-bar/run'
import { zoneOf } from '../../shared/sel-bar'
import { cmdConfig } from '../search/cmd-store'

type ChatInit = Extract<CmdEditorInit, { kind: 'chat' }>
type View = 'before' | 'after' | 'split'
type Prep = Awaited<ReturnType<typeof window.cn.aiCmdPrep>>

/** 一条规矩：before / after 是依据落在改前、现在的第几行；scope 是「只改这一篇」（依据在提交里） */
interface Rule {
  key: number
  t: string
  e?: string
  off?: boolean
  before: number[]
  after: number[]
  scope?: boolean
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const short = (h: string) => h.slice(0, 7)
const baseName = (p: string) => p.split('/').pop() ?? p
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
let ruleSeq = 0
const ruleOf = (r: { t: string; e?: string; off?: boolean }, more: Partial<Rule> = {}): Rule => ({ key: ++ruleSeq, t: r.t, ...(r.e ? { e: r.e } : {}), ...(r.off ? { off: true } : {}), before: [], after: [], ...more })

/** 比对过的就记着（同一段对话、同一个样子再开不用再问 AI；没比完就关上的不记） */
const distilled = new Map<string, Distilled>()

/** 对照区的编辑器多加的：亮出依据、空行收矮（一个不变的数组，换看法时编辑器才重画） */
const COMPARE_EXT = [...evidence, ...compact, ...tidyDiff]

/** 指着一条时那一种看法里有几处依据 */
// 不翻：键，画的地方 t(EV_TEXT[view], { n })
const EV_TEXT: Record<View, string> = { before: '改前 {n} 处依据', after: '改后 {n} 处依据', split: '并排里 {n} 处依据' }

/** 几句引起来：中文「a」「b」挨着，英文 “a”, “b” */
const quoted = (lang: 'zh' | 'en', xs: readonly string[]) => (lang === 'en' ? list(xs.map((x) => `“${x}”`), 'en') : xs.map((x) => `「${x}」`).join(''))

/** App 挂一个：AI 对话、⌘K、/ 菜单调 openCmdEditor 时开那张表；here 是开着的那一篇（从头写、改的时候拿它举例） */
export function CmdEditorHost(props: { onNotice(text: string): void; here: string | null }) {
  const [open, setOpen] = useState<{ init: CmdEditorInit; seq: number } | null>(null)
  useEffect(() => onCmdEditor((init) => setOpen((o) => ({ init, seq: (o?.seq ?? 0) + 1 }))), [])
  if (!open) return null
  return <CmdEditor key={open.seq} init={open.init} here={props.here} onNotice={props.onNotice} onClose={() => setOpen(null)} />
}

function CmdEditor(props: { init: CmdEditorInit; here: string | null; onNotice(text: string): void; onClose(): void }) {
  const t = useT()
  const lang = useLang()
  const { init } = props
  const chat: ChatInit | null = init.kind === 'chat' ? init : null
  /** 改的是哪一条（再改一次、⌘K 里改这条命令…）：存的时候还是这个编号 */
  const base: AiCmd | undefined = init.kind === 'edit' ? init.cmd : chat?.edit
  const copyOf = init.kind === 'copy' ? init.builtin : null

  // 复制自带的：默认名字「我的补双链」（英文 my-add-links：名字里不能有空白）
  const [name, setName] = useState(base?.name ?? (copyOf ? t('我的{name}', { name: t(copyOf.name) }) : ''))
  const nameTouched = useRef(!!base || !!copyOf)
  const [where, setWhere] = useState<Where[]>(() => [...(base?.where ?? copyOf?.copy.where ?? ['doc'])])
  const [write, setWrite] = useState<Write>(base?.write ?? copyOf?.copy.write ?? 'inplace')
  const [store, setStore] = useState<'vault' | 'local'>(base?.store ?? 'vault')
  /** 选中小条（task-26nz7）：不放 / 收进 ⋯ / 放上条；改的那条已经在表里的照它现在在哪 */
  const barAt = (() => {
    const z = base ? zoneOf(cmdConfig().bar, base.id) : null
    return z === 'on' || z === 'more' ? z : 'none'
  })()
  const [bar, setBar] = useState<'none' | 'more' | 'on'>(barAt)
  // 复制自带的：它的规矩照界面语言变成你自己的那几条
  const [rules, setRules] = useState<Rule[]>(() => (chat ? [] : (base?.rules.map((r) => ruleOf(r)) ?? copyOf?.rules.map((r) => ruleOf({ t: t(r) })) ?? [])))
  const [unused, setUnused] = useState<string[]>([])
  /** 对话存：先读改之前那一版、再问 AI 比对（loading），比完 ready；没成写为什么 */
  const [phase, setPhase] = useState<'loading' | 'ready' | { error: string }>(chat ? 'loading' : 'ready')
  const [tries, setTries] = useState(0)
  const [prep, setPrep] = useState<Prep | null>(null)
  const [view, setView] = useState<View>('split')
  const [hover, setHover] = useState<number | null>(null)
  const [pin, setPin] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [showText, setShowText] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // 开着时按键都留在这张表里（⌘K、⌘J 这些不交给后面）；关上时回到原来有焦点的地方
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null
    root.current?.focus({ preventScroll: true })
    return () => was?.focus?.({ preventScroll: true })
  }, [])

  // 对话存：读改之前那一版，问 AI 看出几条规矩（每条带依据）；名字没动过就用 AI 起的
  useEffect(() => {
    if (!chat) return
    let live = true
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setPhase('loading')
    void (async () => {
      const p = await window.cn.aiCmdPrep(chat.path, chat.firstHash)
      if (!live) return
      setPrep(p)
      const input: DistillInput = { path: chat.path, title: chat.title, before: p.before ?? '', after: p.after, asks: chat.asks, commits: chat.commits }
      const key = [chat.path, chat.firstHash, chat.commits.map((c) => c.hash).join(','), p.afterHash, p.dirty ? p.after.length : ''].join('\n')
      // 「再试一次」：不用记着的那份，重新问
      if (tries > 0) distilled.delete(key)
      let d = distilled.get(key)
      if (!d) {
        d = parseDistill(await window.cn.aiAsk(id, system(), distillPrompt(input), { pick: chat.pick }), input)
        distilled.set(key, d)
      }
      if (!live) return
      const anchor = (r: Distilled['rules'][number]) => ruleOf(r, { before: anchorLines(input.before, r.before), after: anchorLines(input.after, r.after), ...(r.scope ? { scope: true } : {}) })
      const fresh = d.rules.map(anchor)
      const scopeT = scopeRule({ path: chat.path, commits: chat.commits })?.t
      // 再改一次：照存好的那几条（字、勾没勾）；依据从这次比对里找字一样的（字改过的找依据那句一样的）
      setRules(
        base
          ? base.rules.map((r) => {
              const m = fresh.find((x) => x.t === r.t) ?? fresh.find((x) => !!r.e && x.e === r.e)
              return ruleOf({ t: r.t, e: r.e ?? m?.e, off: r.off }, { before: m?.before ?? [], after: m?.after ?? [], ...(m?.scope || r.t === scopeT ? { scope: true } : {}) })
            })
          : fresh,
      )
      setUnused(d.unused)
      if (!nameTouched.current) setName(d.name || tNow('整理成{title}的样子', { title: chat.title }))
      setPhase('ready')
    })().catch((e: unknown) => live && setPhase({ error: errText(e) }))
    return () => {
      live = false
      void window.cn.aiStop(id)
    }
    // 只在开的时候（和「再试一次」）问一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries])

  /** 举例的那一篇：对话里改的这一篇；从头写时用开着的那一篇，没有就写「这一篇」 */
  const ex = chat?.example ?? (init.kind !== 'chat' ? init.example : undefined) ?? (props.here ? { title: titleOf(props.here), folder: dirOf(props.here) } : { title: t('这一篇'), folder: t('它在的文件夹') })
  const clean = cleanName(name)
  const shown = clean || t('我的命令', { ctx: '名字' })
  const m = impactOf({ name: clean, where, write, store, example: ex.title, folder: ex.folder, who: init.who })
  const live = rules.filter((r) => !r.off && r.t.trim())
  const offN = rules.filter((r) => r.off).length
  const ready = phase === 'ready'
  /** 底栏左边那句：等比对的是灰字，存不了的是黄字 */
  const wait = chat && phase === 'loading' ? t('正在比对，比完再存') : null
  const problem = wait ?? (typeof phase === 'object' ? t('比对没成，存不了') : !chat && !rules.length ? t('先写一条规矩') : saveProblem({ rules, name: clean, where }))

  const active = chat && ready ? (hover ?? pin) : null
  const activeRule = active !== null ? (rules[active] ?? null) : null

  async function save() {
    if (problem || saving || editing !== null) return
    setSaving(true)
    setSaveErr(null)
    const from = chat ? { path: chat.path, title: chat.title, rounds: chat.rounds, place: chat.place.key } : base?.from
    const kept = rules.filter((r) => r.t.trim()).map((r) => ({ t: r.t.trim(), ...(r.e ? { e: r.e } : {}), ...(r.off ? { off: true } : {}) }))
    const cmd: AiCmd = {
      id: base?.id ?? newCmdId(),
      name: clean,
      rules: kept,
      where: WHERE.map(([k]) => k).filter((k) => where.includes(k)),
      write,
      store,
      desc: descOf(kept, from, write),
      ...(from ? { from } : {}),
    }
    try {
      await saveAiCmd(cmd)
      if (bar !== barAt) await putOnBar(cmd, bar === 'none' ? null : bar)
      props.onNotice(withKeys(t('存好了：/{name} · 在 / 菜单和 {k:search} 的「让AI做」里', { name: cmd.name })))
      props.onClose()
    } catch (e) {
      setSaveErr(errText(e))
      setSaving(false)
    }
  }

  function setRule(i: number, p: Partial<Rule>) {
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  }

  function onKey(e: KeyboardEvent) {
    // 这张表开着时，按键不交给软件别处（⌘K、⌘J、换标签这些）
    e.stopPropagation()
    if (e.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      // esc 一层层收：说明全文、钉住、弹窗（改字时 esc 只收改字，在输入框里自己接）
      if (showText) setShowText(false)
      else if (pin !== null) setPin(null)
      else props.onClose()
    } else if (isKey(e, 'submit')) {
      e.preventDefault()
      void save()
    }
  }
  const keyNow = useRef(onKey)
  keyNow.current = onKey
  // 点过的按钮拿掉了（不钉了、改字收起）焦点掉到窗口上：按键照样归这张表，焦点收回来
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target !== document.body) return
      root.current?.focus({ preventScroll: true })
      keyNow.current(e)
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [])

  const title = chat ? t('存成命令') : init.kind === 'new' ? t('加一条 AI 命令') : init.kind === 'edit' ? t('改这条命令') : t('复制「{name}」再改', { name: t(copyOf!.name) })
  const sub = chat
    ? t('照「{title}」{n} 轮之前和现在的样子，看出你要的是哪几条', { title: chat.title, n: chat.rounds })
    : init.kind === 'new'
      ? t('从头写一条，没有对话就没有左边对照，只填规矩')
      : init.kind === 'edit'
        ? t('改好了点存好，下次打 /{name} 就照新的做', { name: init.cmd.name })
        : t('自带的「{name}」不能改字：复制一份成你自己的，改哪条都行', { name: t(copyOf!.name) })

  const ruleList = (
    <Rules
      rules={rules}
      pin={chat ? pin : null}
      editing={editing}
      onHover={(i) => chat && setHover(i)}
      onPin={(i) => chat && setPin((p) => (p === i ? null : i))}
      onCheck={(i) => setRule(i, { off: !rules[i]!.off })}
      onEdit={(i) => {
        setEditing(i)
        // 改字的输入框拿掉以后焦点会掉到窗口上（esc、⌘↵ 就不归这张表了）：没落到表里别处时收回来
        if (i === null) requestAnimationFrame(() => root.current && !root.current.contains(document.activeElement) && root.current.focus({ preventScroll: true }))
      }}
      onText={(i, t) => setRule(i, { t })}
    />
  )

  return (
    <>
      <div className="sc-scrim" onMouseDown={props.onClose} />
      <div
        ref={root}
        // 根不叫 .sc：AI 步骤行里的命令、路径是 <code class="sc">（ai.css），撞了会把它们也变成 fixed 的一大块
        className={'scmd' + (chat ? '' : ' no-cmp')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => (e.stopPropagation(), onKey(e.nativeEvent))}
        onMouseDown={(e) => {
          const t = e.target as HTMLElement
          if (showText && !t.closest('.sc-pop') && !t.closest('[data-act="text"]')) setShowText(false)
        }}
      >
        <header className="sc-head">
          <span className="tt">{title}</span>
          <span className="st">{sub}</span>
          <span className="sp" />
          <button className="sc-ib" aria-label={t('关上')} title={t('关上 esc')} onClick={props.onClose}>
            <Codicon name="close" size={16} />
          </button>
        </header>
        {chat ? (
          <div className="sc-body">
            <section className="sc-cmp" aria-label={t('对照')}>
              {prep ? (
                <Compare prep={prep} chat={chat} view={view} onView={setView} rule={activeRule} pinned={pin !== null && active === pin} onUnpin={() => setPin(null)} />
              ) : (
                <div className="sc-cp">{typeof phase === 'object' ? <p className="sc-note">{t('读不出改之前的样子：{error}', { error: phase.error })}</p> : <p className="sc-note">{t('读取中…')}</p>}</div>
              )}
            </section>
            <section className="sc-rc">
              <div className="sc-sec">
                <b>{t('看出的规矩')}</b>
                <span className="c">{t('勾着的写进说明 · 指一条，左边亮出依据')}</span>
              </div>
              {phase === 'loading' ? (
                <div className="sc-wait">
                  <Codicon name="loading" size={14} className="spin" />
                  {t('正在比对「{title}」{n} 轮之前和现在的样子…', { title: chat.title, n: chat.rounds })}
                </div>
              ) : typeof phase === 'object' ? (
                <div className="sc-wait err">
                  <span>{t('比对没成：{error}', { error: phase.error })}</span>
                  <button className="btn btn-sm" onClick={() => setTries((n) => n + 1)}>
                    {t('再试一次')}
                  </button>
                </div>
              ) : (
                <>
                  {ruleList}
                  {/* AI 的回答里没有能用的规矩（只剩照提交算的「只改这一篇」）：说一句，能再问一次 */}
                  {!rules.some((r) => !r.scope) && (
                    <div className="sc-wait err">
                      <span>{t('这次没看出改前改后有什么规矩')}</span>
                      <button className="btn btn-sm" onClick={() => setTries((n) => n + 1)}>
                        {t('再试一次')}
                      </button>
                    </div>
                  )}
                </>
              )}
              {ready && unused.length > 0 && (
                <div className="sc-said" title={t('你说过、结果里看不出来的，没算进去：{list}', { list: quoted(lang, unused) })}>
                  <Codicon name="info" size={12} />
                  <span>{t('没算进去的话：{list}', { list: quoted(lang, unused) })}</span>
                </div>
              )}
              <HowForm name={name} where={where} write={write} store={store} onName={(v) => ((nameTouched.current = true), setName(v))} onWhere={setWhere} onWrite={setWrite} onStore={setStore} bar={bar} onBar={setBar} />
            </section>
          </div>
        ) : (
          <div className="sc-body">
            <section className="sc-lc">
              <div className="sc-sec">
                <b>{t('规矩')}</b>
                <span className="c">{t('勾着的写进说明')}</span>
              </div>
              {ruleList}
              <AddRule full={rules.length >= MAX_RULES} onAdd={(t) => setRules((rs) => [...rs, ruleOf({ t })])} />
            </section>
            <section className="sc-rc solo">
              <HowForm name={name} where={where} write={write} store={store} onName={setName} onWhere={setWhere} onWrite={setWrite} onStore={setStore} bar={bar} onBar={setBar} />
            </section>
          </div>
        )}
        <Impact m={m} example={ex.title} name={shown} engine={init.engine} ready={ready} />
        <footer className="sc-foot">
          {showText && (
            <div className="sc-pop" role="dialog" aria-label={t('说明全文')}>
              <div className="t">{t('存进去的说明（AI 每次照这几条做）')}</div>
              <ol>
                {live.map((r) => (
                  <li key={r.key}>{r.t.trim()}</li>
                ))}
              </ol>
              {(chat || offN > 0) && (
                <div className="s">
                  {[chat ? t('照「{title}」{n} 轮之前和现在的对比提炼。', { title: chat.title, n: chat.rounds }) : '', offN ? t('没勾的 {n} 条不写进去。', { n: offN }) : '']
                    .filter(Boolean)
                    .join(lang === 'en' ? ' ' : '')}
                </div>
              )}
            </div>
          )}
          <span className={'lt' + ((problem && !wait) || saveErr ? ' warn' : '')}>
            {((problem && !wait) || saveErr) && <Codicon name="warning" size={14} />}
            {saveErr ? t('没存上：{error}', { error: saveErr }) : (problem ?? t('勾着的 {n} 条会写成命令的说明', { n: live.length }))}
          </span>
          <button className="btn btn-sm btn-ghost" data-act="text" onClick={() => setShowText((v) => !v)}>
            <Codicon name={showText ? 'eye-closed' : 'eye'} size={14} />
            {showText ? t('收起说明') : t('看说明全文')}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={props.onClose}>
            {t('取消')}
          </button>
          <button className="btn btn-sm btn-primary" disabled={!!problem || saving} onClick={() => void save()}>
            <Codicon name="check" size={14} />
            {t('存好')}
            <span className="sc-kbd">{keyFor('submit')}</span>
          </button>
        </footer>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- 左边：对照

function Compare(p: { prep: Prep; chat: ChatInit; view: View; onView(v: View): void; rule: Rule | null; pinned: boolean; onUnpin(): void }) {
  const t = useT()
  const { prep, chat, view, rule } = p
  const before = prep.before ?? ''
  const after = prep.after
  const same = useMemo(() => sameLines(before, after), [before, after])
  const stat = useMemo(() => ({ add: after.split('\n').length - same.size, del: before.split('\n').length - same.size }), [before, after, same])
  // 并排：左边改之前、右边现在；「改前」「改后」各是一列，用合一的样子把另一边的删改藏起来（没改的一样折起）
  const f = useMemo<DiffEntry>(() => {
    const [b, a] = view === 'before' ? [after, before] : [before, after]
    return { path: chat.path, status: 'changed', kind: 'md', before: b, after: a, size: a.length, added: stat.add, removed: stat.del, summary: '', exists: true }
  }, [view, before, after, chat.path, stat])
  const res = useMemo<DiffResult>(
    () => ({ note: '', left: t('改之前 · {n} 轮之前 · {hash}', { n: chat.rounds, hash: short(prep.beforeHash) }), right: prep.dirty ? t('现在 · 还没提交') : t('现在 · {hash}', { hash: short(prep.afterHash) }), files: [] }),
    [chat.rounds, prep, t],
  )
  /** 两列抬头：提交号用等宽字（和工具条右边同一个号同一种字） */
  const cols = useMemo(
    () =>
      [
        <>{rich(t('改之前 · {n} 轮之前 · {hash}', { n: chat.rounds }), { hash: <span className="mono">{short(prep.beforeHash)}</span> })}</>,
        prep.dirty ? t('现在 · 还没提交') : <>{rich(t('现在 · {hash}'), { hash: <span className="mono">{short(prep.afterHash)}</span> })}</>,
      ] as const,
    [chat.rounds, prep, t],
  )
  const views = useRef<DiffViews | null>(null)
  const [gen, setGen] = useState(0)
  const onViews = useCallback((v: DiffViews | null) => {
    views.current = v
    if (v) setGen((g) => g + 1)
  }, [])
  const ev = rule && !rule.scope ? rule : null
  /** 这一种看法里的几处依据（并排里左右是同一行的算一处） */
  const places = useMemo<Place[]>(() => {
    if (!ev) return []
    if (view === 'split') return placesOf(ev.before, ev.after, same)
    return [...new Set(view === 'before' ? ev.before : ev.after)].map((n) => (view === 'before' ? { a: n } : { b: n }))
  }, [ev, view, same])
  const [step, setStep] = useState(0)

  // 指着一条：依据那几行亮、别的淡下去（每次换看法、编辑器重画了再给一次）
  useEffect(() => {
    const v = views.current
    if (!v) return
    const on = !!ev
    if ('a' in v) {
      v.a.dispatch({ effects: setSpot.of({ lines: ev?.before ?? [], on }) })
      v.b.dispatch({ effects: setSpot.of({ lines: ev?.after ?? [], on }) })
    } else v.one.dispatch({ effects: setSpot.of({ lines: (view === 'before' ? ev?.before : ev?.after) ?? [], on }) })
  }, [gen, ev, view])

  /** 几处依据从上到下：哪个编辑器、哪个位置 */
  const ordered = useCallback(() => {
    const v = views.current
    if (!v) return []
    const at = (pl: Place) => {
      const ed = 'a' in v ? (pl.b !== undefined ? v.b : v.a) : v.one
      const n = 'a' in v ? (pl.b ?? pl.a)! : (pl.a ?? pl.b)!
      const pos = ed.state.doc.line(Math.min(n, ed.state.doc.lines)).from
      return { ed, pos, top: ed.lineBlockAt(pos).top }
    }
    return places.map(at).sort((x, y) => x.top - y.top)
  }, [places])
  const scrollTo = useCallback(
    (i: number) => {
      const t = ordered()[i]
      if (t) t.ed.dispatch({ effects: EditorView.scrollIntoView(t.pos, { y: 'start', yMargin: 48 }) })
    },
    [ordered],
  )

  // 钉住一条：依据在折起来的地方自己展开（左右两边一起），滚到第一处
  useEffect(() => {
    const v = views.current
    if (!p.pinned || !ev || !v) return
    const hit = (ls: readonly number[], r: { first: number; last: number } | undefined) => !!r && ls.some((l) => l >= r.first && l <= r.last)
    if ('a' in v) {
      const ra = foldRanges(v.a.state, COLLAPSE.margin, COLLAPSE.minSize)
      const rb = foldRanges(v.b.state, COLLAPSE.margin, COLLAPSE.minSize)
      ra.forEach((r, i) => {
        if (!hit(ev.before, r) && !hit(ev.after, rb[i])) return
        v.a.dispatch({ effects: uncollapseUnchanged.of(r.from) })
        if (rb[i]) v.b.dispatch({ effects: uncollapseUnchanged.of(rb[i]!.from) })
      })
    } else {
      const ls = view === 'before' ? ev.before : ev.after
      for (const r of foldRanges(v.one.state, COLLAPSE.margin, COLLAPSE.minSize)) if (hit(ls, r)) v.one.dispatch({ effects: uncollapseUnchanged.of(r.from) })
    }
    setStep(0)
    requestAnimationFrame(() => scrollTo(0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen, p.pinned, ev?.key, view])

  const go = (d: 1 | -1) => {
    const n = places.length
    if (!n) return
    const i = (step + d + n) % n
    setStep(i)
    scrollTo(i)
  }

  let empty: string | null = null
  if (ev) {
    if (!ev.before.length && !ev.after.length) empty = t('这条指不出具体哪几行：依据只有右边那一句')
    else if (view === 'before' && !ev.before.length) empty = t('改前没有这一样：切到「改后」或「并排对照」看它多出来的地方')
    else if (view === 'after' && !ev.after.length) empty = t('改后没有这一样了：切到「改前」或「并排对照」看原来的样子')
  }
  const name = baseName(chat.path)
  const unpin = (
    <button className="sc-ib sm" aria-label={t('不钉了')} title={t('不钉了')} onClick={p.onUnpin}>
      <Codicon name="close" size={14} />
    </button>
  )

  return (
    <>
      <div className="sc-bar">
        <div className="seg" role="tablist" aria-label={t('对照的看法')}>
          {(
            [
              ['before', t('改前 · {n} 轮之前', { n: chat.rounds })],
              ['after', t('改后 · 现在')],
              ['split', t('并排对照')],
            ] as const
          ).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => p.onView(v)}>
              {v === 'split' && <Codicon name="split-horizontal" size={14} />}
              {label}
            </button>
          ))}
        </div>
        <span className="sc-meta">
          {ev ? (
            <span className="sc-evp">
              <Codicon name="eye" size={14} />
              {t(EV_TEXT[view], { n: places.length })}
              {p.pinned && (
                <>
                  <button className="sc-ib sm" aria-label={t('上一处')} title={t('上一处')} onClick={() => go(-1)}>
                    <Codicon name="arrow-up" size={14} />
                  </button>
                  <button className="sc-ib sm" aria-label={t('下一处')} title={t('下一处')} onClick={() => go(1)}>
                    <Codicon name="arrow-down" size={14} />
                  </button>
                  {unpin}
                </>
              )}
            </span>
          ) : rule ? (
            <span className="sc-evp">
              <Codicon name="git-commit" size={14} />
              <span>{t('依据在提交里')}</span>
              {p.pinned && unpin}
            </span>
          ) : (
            <>
              <span className="num">
                <span className="add">+{stat.add}</span> <span className="del">−{stat.del}</span>
              </span>
              <span>{rich(t('{n} 轮 · {range}', { n: chat.rounds }), { range: <span className="mono">{`${short(prep.beforeHash)} → ${prep.dirty ? t('现在') : short(prep.afterHash)}`}</span> })}</span>
            </>
          )}
        </span>
      </div>
      <div className={'sc-cp ' + (view === 'split' ? 'v-split' : 'v-one') + (ev ? ' spot' : '')}>
        {rule?.scope && (
          <div className="sc-commits">
            <div className="t">{t('这条看的是提交：{n} 轮都只改了「{name}」', { n: chat.commits.length, name })}</div>
            {chat.commits.map((c: DistillCommit) => {
              const fl = c.files.find((x) => x.path === chat.path) ?? c.files[0]
              return (
                <div className="c" key={c.hash}>
                  <span className="mono">{short(c.hash)}</span>
                  <span className="w" title={c.ask}>{t('{file} · 「{ask}」', { file: baseName(fl?.path ?? chat.path), ask: c.ask })}</span>
                  <span className="num">
                    <span className="a">+{fl?.added ?? 0}</span> <span className="d">−{fl?.removed ?? 0}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {empty && (
          <div className="sc-empty">
            <Codicon name="info" size={14} />
            {empty}
          </div>
        )}
        <TextDiff f={f} res={res} look="doc" layout={view === 'split' ? 'split' : 'unified'} ext={COMPARE_EXT} onViews={onViews} cols={cols} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- 右边：规矩

function Rules(p: {
  rules: Rule[]
  pin: number | null
  editing: number | null
  onHover(i: number | null): void
  onPin(i: number): void
  onCheck(i: number): void
  onEdit(i: number | null): void
  onText(i: number, t: string): void
}) {
  const t = useT()
  return (
    <div className="sc-rules" onMouseLeave={() => p.onHover(null)}>
      {p.rules.map((r, i) => (
        <div
          key={r.key}
          className={'sc-rule ' + (r.off ? 'off' : 'on') + (p.pin === i ? ' pin' : '')}
          onMouseEnter={() => p.onHover(i)}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, textarea')) return
            p.onPin(i)
          }}
        >
          <button className="sc-cb" role="checkbox" aria-checked={!r.off} aria-label={t('写进说明')} onClick={() => p.onCheck(i)}>
            {!r.off && <Codicon name="check" size={12} />}
          </button>
          <div className="tx">
            {p.editing === i ? <RuleEdit text={r.t} onDone={(v) => (v !== null && v.trim() && p.onText(i, v.trim().slice(0, RULE_MAX)), p.onEdit(null))} /> : <div className="rt">{r.t}</div>}
            {(r.e || r.off) && (
              <div className="re">
                {r.e ? t('依据：{text}', { text: r.e }) : ''}
                {r.off && <span className="cut">{r.e ? ` ${t('· 不写进去')}` : t('不写进去')}</span>}
              </div>
            )}
          </div>
          <button
            className={'sc-ib sm pen' + (p.editing === i ? ' on' : '')}
            aria-label={t('改字')}
            title={t('改字')}
            // 不让输入框先失去焦点（不然点笔收下以后又开一次）
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => p.onEdit(p.editing === i ? null : i)}
          >
            <Codicon name={p.editing === i ? 'check' : 'edit'} size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

/** 笔改字：回车收下，esc 不改；点别处、再点一下笔（这时是对勾）也收下 */
function RuleEdit(p: { text: string; onDone(t: string | null): void }) {
  const t = useT()
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const value = useRef(p.text)
  const onDone = useRef(p.onDone)
  onDone.current = p.onDone
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone.current(v)
  }
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(() => {
    const el = ref.current!
    fit()
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  // 点对勾收起时输入框直接拿掉了（不会先失去焦点）：拿掉时把打的字收下
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => finish(value.current), [])
  return (
    <textarea
      ref={ref}
      className="rt"
      aria-label={t('这条规矩')}
      rows={1}
      maxLength={RULE_MAX}
      defaultValue={p.text}
      spellCheck={false}
      onInput={(e) => ((value.current = e.currentTarget.value), fit())}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          finish(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(null)
        }
      }}
    />
  )
}

/** 从头写时：输入框回车加一条 */
function AddRule(p: { full: boolean; onAdd(t: string): void }) {
  const t = useT()
  const [text, setText] = useState('')
  return (
    <div className="sc-add">
      <Codicon name="add" size={14} />
      <input
        aria-label={t('加一条规矩')}
        placeholder={p.full ? t('最多 {n} 条', { n: MAX_RULES }) : t('写一条规矩，回车加上')}
        disabled={p.full}
        maxLength={RULE_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && !e.metaKey && text.trim()) {
            e.preventDefault()
            p.onAdd(text.trim())
            setText('')
          } else if (e.key === 'Escape' && text) {
            e.preventDefault()
            e.stopPropagation()
            setText('')
          }
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------- 怎么用：五行

function HowForm(p: {
  name: string
  where: Where[]
  write: Write
  store: 'vault' | 'local'
  onName(v: string): void
  onWhere(v: Where[]): void
  onWrite(v: Write): void
  onStore(v: 'vault' | 'local'): void
  bar: 'none' | 'more' | 'on'
  onBar(v: 'none' | 'more' | 'on'): void
}) {
  const t = useT()
  const dup = sameAsBuiltin(cleanName(p.name))
  return (
    <div className="sc-form" role="group" aria-label={t('怎么用')}>
      <div className="sc-sec">
        <b>{t('怎么用')}</b>
      </div>
      <div className="sc-frow">
        <label htmlFor="sc-name">{t('名字')}</label>
        <div className="ctl">
          <div className="sc-nm">
            <span>/</span>
            <input id="sc-name" value={p.name} placeholder={t('起个名字')} spellCheck={false} autoComplete="off" maxLength={60} onChange={(e) => p.onName(e.target.value)} />
          </div>
        </div>
      </div>
      {dup && (
        <div className="sc-wrow">
          <span />
          <div className="sc-warn">
            <Codicon name="warning" size={12} />
            {t('和自带的「{name}」重名，打 / 时两条都在', { name: cleanName(p.name) })}
          </div>
        </div>
      )}
      <div className="sc-frow">
        <label id="sc-l-where">{t('在哪能用')}</label>
        <div className="ctl" role="group" aria-labelledby="sc-l-where">
          {WHERE.map(([k, n, icon]) => {
            const on = p.where.includes(k)
            return (
              <button key={k} role="checkbox" aria-checked={on} className={'sc-chip' + (on ? ' on' : '')} onClick={() => p.onWhere(on ? p.where.filter((x) => x !== k) : [...p.where, k])}>
                <Codicon name={(on ? 'check' : icon) as CodiconName} size={14} />
                {t(n, { ctx: '在哪能用' })}
              </button>
            )
          })}
        </div>
      </div>
      <div className="sc-frow">
        <label id="sc-l-write">{t('写到哪')}</label>
        <div className="ctl">
          <div className="seg" role="radiogroup" aria-labelledby="sc-l-write">
            {WRITES.map(([k, n]) => (
              <button key={k} role="radio" aria-checked={p.write === k} onClick={() => p.onWrite(k)}>
                {t(n, { ctx: '写到哪' })}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="sc-frow">
        <label id="sc-l-bar">{t('选中小条')}</label>
        <div className="ctl">
          <div className="seg" role="radiogroup" aria-labelledby="sc-l-bar">
            {(
              [
                ['none', t('不放')],
                ['more', t('收进 ⋯')],
                ['on', t('放上条')],
              ] as const
            ).map(([k, n]) => (
              <button key={k} role="radio" aria-checked={p.bar === k} onClick={() => p.onBar(k)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="sc-frow">
        <label id="sc-l-store">{t('存在哪')}</label>
        <div className="ctl">
          <div className="seg" role="radiogroup" aria-labelledby="sc-l-store">
            {STORES.map(([k, n]) => (
              <button key={k} role="radio" aria-checked={p.store === k} onClick={() => p.onStore(k)}>
                {t(n)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 底下：存之前看清它会改什么

/** 文件夹那行从中间截：保住第一层和最后几个整词（Courses/…Learning），名字整个进悬停提示 */
function midPath(path: string, max = 17): string {
  const i = path.indexOf('/')
  if (path.length <= max || i < 0) return path
  const budget = max - i - 2
  const words = path.slice(path.lastIndexOf('/') + 1).split(' ')
  let tail = ''
  for (let k = words.length - 1; k >= 0; k--) {
    const next = words.slice(k).join(' ')
    if (next.length > budget) break
    tail = next
  }
  return budget > 0 ? `${path.slice(0, i)}/…${tail || path.slice(-budget)}` : path
}

/** 文件树的行；英文（short）把「改」「新」挪到列头，文件夹那行从中间截（设计复审：小标签把文件名挤成 Lecture …） */
function TreeRows(p: { rows: TreeRow[]; short?: boolean }) {
  const t = useT()
  return (
    <>
      {p.rows.map((r, i) => (
        <div key={i} className={'sc-tr' + (r.kind === 'file' ? ' in' : '') + (r.mark ? ' ' + r.mark : '')}>
          <Codicon name={r.kind === 'dir' ? 'folder' : 'file'} size={14} />
          <span className="n" title={p.short ? r.name : undefined}>
            {p.short && r.kind === 'dir' ? midPath(r.name) : r.name}
          </span>
          {r.mark && !p.short && <b>{r.mark === 'mod' ? t('改') : t('新')}</b>}
        </div>
      ))}
    </>
  )
}

/** 影响卡抬头后面那句：拿这一篇举例，再一句说用在别的笔记上就是那一篇 */
const exampleLine = (example: string, name: string) => tNow('拿「{example}」举例：下次在它上面打 /{name} 会这样；在别的笔记上打，就换成那一篇', { example, name })

function Impact(p: { m: ReturnType<typeof impactOf>; example: string; name: string; engine: CmdEditorInit['engine']; ready: boolean }) {
  const t = useT()
  const short = useLang() === 'en'
  const { m } = p
  const mark = m.after?.find((r) => r.mark)?.mark
  const facts: { k: string; l: string; v: React.ReactNode; text: string; warn?: boolean }[] = [
    m.appear
      ? { k: 'appear', l: t('在哪出现'), v: withKeys(m.appear), text: withKeys(m.appear) }
      : { k: 'appear', l: t('在哪出现'), v: [<Codicon key="i" name="warning" size={14} />, t('一处都没选：存了也调不出来')], text: '', warn: true },
    { k: 'touch', l: t('能碰的'), v: m.touch, text: m.touch },
    { k: 'preview', l: t('先给你看'), v: [m.locked && <Codicon key="i" name="lock" size={14} />, <span key="t">{m.preview}</span>], text: m.preview },
    { k: 'commit', l: t('提交'), v: m.commit, text: m.commit },
    { k: 'who', l: t('谁来做'), v: [<EngineLogo key="i" id={p.engine} size={14} />, <span key="t">{m.who}</span>], text: m.who },
    { k: 'store', l: t('存在哪'), v: m.store, text: m.store },
  ]
  // 改了上面哪一项，变了的那一格闪一下（--acc-soft 渐隐 .8s）；比对完以前的不算
  const els = useRef(new Map<string, HTMLElement>())
  const prev = useRef<Record<string, string> | null>(null)
  const tree = JSON.stringify([m.before, m.after, m.cap, m.note])
  useLayoutEffect(() => {
    const now: Record<string, string> = { tree, ...Object.fromEntries(facts.map((f) => [f.k, f.text])) }
    const was = prev.current
    prev.current = p.ready ? now : null
    if (!was) return
    for (const [k, v] of Object.entries(now)) {
      const el = els.current.get(k)
      if (v === was[k] || !el) continue
      el.classList.add('flash')
      setTimeout(() => el.classList.remove('flash'), 60)
    }
  })
  const keep = (k: string) => (el: HTMLElement | null) => void (el ? els.current.set(k, el) : els.current.delete(k))
  return (
    <div className="sc-band">
      <div className="sc-imp" role="group" aria-label={t('存之前看清它会改什么')}>
        <div className="ih">
          <b>
            <Codicon name="eye" size={14} />
            {t('存之前看清它会改什么')}
          </b>
          <span className="x" title={exampleLine(p.example, p.name)}>
            {short ? t('照「{example}」演示；用在别的笔记上就是那一篇', { example: p.example }) : exampleLine(p.example, p.name)}
          </span>
        </div>
        <div className="sc-ig">
          <div className="sc-tree" ref={keep('tree')}>
            {m.after ? (
              <>
                <div className="cols">
                  <div className="col">
                    <div className="h">{t('之前')}</div>
                    <TreeRows rows={m.before} short={short} />
                  </div>
                  <div className="ar">
                    <Codicon name="arrow-right" size={14} />
                  </div>
                  <div className="col">
                    <div className="h">
                      {t('之后')}
                      {short && mark && <b className={'mk ' + mark}>{mark === 'mod' ? t('改') : t('新')}</b>}
                    </div>
                    <TreeRows rows={m.after} short={short} />
                  </div>
                </div>
                <div className="cap">{m.cap}</div>
              </>
            ) : (
              <div className="none">
                <Codicon name="comment-discussion" size={16} />
                {m.cap}
              </div>
            )}
            {m.note && (
              <div className="note">
                <Codicon name="warning" size={12} />
                {m.note}
              </div>
            )}
          </div>
          <div className="sc-facts">
            {facts.map((f) => (
              <div key={f.k} className="sc-fact" data-fact={f.k} ref={keep(f.k)}>
                <div className="l">{f.l}</div>
                <div className={'v' + (f.warn ? ' warn' : '')}>{f.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
