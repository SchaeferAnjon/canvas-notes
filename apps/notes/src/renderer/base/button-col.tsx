/**
 * 按钮列（task-i921u「当……就……」，照 automations/proto.html 的 f15、f16）：properties 里 `type: button` 的一列，每一行一颗。
 * - 表格格子里、右栏打开一条时都能点：主进程跑这一行（auto.button），第一步是「先问一句」时先在按钮旁边问一句再跑；
 *   跑完底部一句「按钮「再记一笔」：新建了…」能撤回，有「在右栏打开它」那一步就在右栏开新建的那条。
 * - 加一列菜单最下面「动手」一组：「按钮」（点了在右栏写它做什么，存了才加这一列）；点按钮列的列头在右栏改它做什么。
 * 读写规则都在 auto-ipc.ts；这里只管点、问、说。
 */
import { Codicon } from '@cn/design'
import { type BaseCtx, stepLabel } from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../shared/i18n'
import { app } from '../ctx/actions'
import { FloatPop, anchorOf, type PopAnchor } from '../pop-place'
import { useDismiss } from '../use-dismiss'
import { aiTableOf } from './ai-col'
import { type AutoDone, buttonOf, onDone, pressButton, undoRun } from './auto-ipc'
import { openAuto } from './auto-state'
import { openRecord } from './record-open'

/** 跑完了的那几次：run → 等着的人 */
const waiting = new Map<number, (d: AutoDone) => void>()
/** 跑得比回话还快的（按钮只改一行）：先放着，等的人来了直接拿 */
const early = new Map<number, AutoDone>()
let wired = false
function wire() {
  if (wired) return
  wired = true
  onDone((d) => {
    const f = waiting.get(d.run)
    if (!f) {
      if (d.entry.by === 'button') early.set(d.run, d)
      return
    }
    waiting.delete(d.run)
    f(d)
  })
}
const doneOf = (run: number) =>
  new Promise<AutoDone>((res) => {
    const d = early.get(run)
    if (d) return (early.delete(run), res(d))
    waiting.set(run, res)
  })

/** 点一行的按钮：问一句（要问的话）、跑、底部说一句能撤回；新建的那条在右栏开 */
export async function press(o: { table: string; col: string; path: string; at: PopAnchor; ask(q: string, at: PopAnchor): Promise<boolean> }): Promise<void> {
  wire()
  const tb = aiTableOf(o.table)
  if (!tb?.where) return app().notice(t('先打开放这个数据库的那篇文档'))
  const where = tb.where
  let r = await pressButton({ where, col: o.col, path: o.path })
  if ('ask' in r) {
    if (!(await o.ask(r.ask, o.at))) return
    r = await pressButton({ where, col: o.col, path: o.path, confirmed: true })
  }
  if ('error' in r) return app().notice(t('按钮「{col}」没跑成：{why}', { col: o.col, why: r.error }))
  if (!('run' in r)) return
  const d = await doneOf(r.run)
  const e = d.entry
  if (!e.ok) return app().notice(t('按钮「{col}」停下了：{why}', { col: o.col, why: e.error ?? '' }))
  app().toast({ text: t('按钮「{col}」：{did}', { col: o.col, did: e.did.join('，') }), icon: 'play', undo: e.undoable ? () => void undoRun(e.id) : undefined })
  if (d.open) openRecord({ path: d.open, src: tb.src, view: tb.view, from: o.table })
}

/** 「先问一句」：贴着按钮的一个小框，「好」才往下做 */
export function useAsk(): { ask(q: string, at: PopAnchor): Promise<boolean>; node: React.ReactNode } {
  const [q, setQ] = useState<{ text: string; at: PopAnchor; done(ok: boolean): void } | null>(null)
  const ask = (text: string, at: PopAnchor) => new Promise<boolean>((done) => setQ({ text, at, done }))
  const end = (ok: boolean) => {
    q?.done(ok)
    setQ(null)
  }
  return { ask, node: q ? <AskPop text={q.text} at={q.at} onEnd={end} /> : null }
}

function AskPop(props: { text: string; at: PopAnchor; onEnd(ok: boolean): void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, [ref], () => props.onEnd(false))
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => ok.current?.focus(), [])
  return (
    <FloatPop at={props.at} className="base-pop au-ask" role="alertdialog" aria-label={props.text}>
      <div ref={ref}>
        <p>{props.text}</p>
        <div className="row">
          <button type="button" className="btn-au ghost" onClick={() => props.onEnd(false)}>
            {t('取消')}
          </button>
          <button ref={ok} type="button" className="btn-au solid" onClick={() => props.onEnd(true)}>
            {t('好')}
          </button>
        </div>
      </div>
    </FloatPop>
  )
}

/** 表格里一格：一颗「▷ 再记一笔」 */
export function ButtonCell(props: { table: string; col: string; path: string; name: string }) {
  const [busy, setBusy] = useState(false)
  const { ask, node } = useAsk()
  return (
    <>
      <button
        type="button"
        className={'au-rbtn' + (busy ? ' run' : '')}
        aria-label={t('「{name}」这一行点「{col}」', { name: props.name, col: props.col })}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          setBusy(true)
          void press({ table: props.table, col: props.col, path: props.path, at: anchorOf(e.currentTarget), ask }).finally(() => setBusy(false))
        }}
      >
        <Codicon name="play" size={12} />
        {props.col}
      </button>
      {node}
    </>
  )
}

/** 按钮列的列头：点了在右栏改它做什么 */
export function editButton(table: string, col: string) {
  const tb = aiTableOf(table)
  if (!tb?.folder) return
  const def = buttonOf(tb.ctx, col)
  openAuto({ table, folder: tb.folder, edit: { kind: 'button', col, draft: structuredClone(def?.do ?? []), isNew: false, index: 0 } })
}

/** 按钮列的列菜单最上面一段：点一下做几步、改它做什么 */
export function ButtonColMenu(props: { ctx: BaseCtx; col: string; table: string; onClose(): void }) {
  const steps = buttonOf(props.ctx, props.col)?.do ?? []
  return (
    <div className="aic-menu" role="group" aria-label={t('按钮列')}>
      <div className="aic-mhead">
        <Codicon name="play-circle" size={12} />
        <span>{t('按钮 · 点一下做 {n} 步', { n: steps.length })}</span>
      </div>
      <div className="aic-mprompt">{steps.map((s) => stepLabel(s)).join(t('，再') + ' ') || t('还没写做什么')}</div>
      <button type="button" role="menuitem" onClick={() => (props.onClose(), editButton(props.table, props.col))}>
        <Codicon name="edit" size={14} />
        <span>{t('改它做什么…')}</span>
      </button>
      <div className="sep" />
    </div>
  )
}

/** 右栏打开一条时那一行：一颗按钮 +「按钮列在这里也能点」 */
export function PeekButton(props: { table: string | null; col: string; path: string; name: string }) {
  return (
    <span className="au-peekbtn">
      {props.table ? <ButtonCell table={props.table} col={props.col} path={props.path} name={props.name} /> : null}
      <span className="t3">{t('按钮列在这里也能点')}</span>
    </span>
  )
}

/**
 * 加一列菜单最下面一组：按钮（一行，灰字说它做什么），下面接着 AI 生成一列。
 * 原型这一组有个「动手」组名；白板卡、窄栏里菜单放不下，组名省掉，和上面隔一道线
 */
export function ButtonAddItem(props: { onPick(): void }) {
  return (
    <>
      <div className="sep" />
      <button type="button" role="menuitem" className="au-addbtn" onClick={props.onPick}>
        <Codicon name="play-circle" size={14} />
        <span>{t('按钮', { ctx: '数据库' })}</span>
        <small>{t('点一下跑一串动作')}</small>
      </button>
    </>
  )
}

/** 加一列菜单里点了「按钮」：右栏开「按钮做的事」，存了才加这一列（插在 index 那一列前面） */
export function newButton(table: string, index: number) {
  const tb = aiTableOf(table)
  if (!tb?.folder) return
  openAuto({ table, folder: tb.folder, edit: { kind: 'button', col: '', draft: [], isNew: true, index } })
}
