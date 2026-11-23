/**
 * 数据库 AI 列在表格里的几处（第三批 task-i921u「AI 生成一列」）：格子、列头、列菜单里 AI 列那一段、删列前问一句、加一列菜单最下面那一项。
 * 格子：AI 写的开头是引擎标志，你改过的是灰点；练习题那种是「📄 3 道」加第一题；在写的标志一闪一闪、一道光走过去；
 * 指着出两颗小按钮（重跑这一格、在右栏打开 / 手改）；那一讲的正文改过了（和 AI 读的时候不一样）格子上一个小点「原文改过」，点一下重跑。
 * 别的格子的画法归 BaseTable / cols.tsx（第 5 块），这里只画 AI 列的。
 */
import { Codicon } from '@cn/design'
import { aiCellOf, type AiColDef, aiColOf, aiDropColumn, aiHandEdit, aiNotePath, baseYaml, type BaseCtx, type BaseRec, dropBaseColumn, type FileWrite, listOf, setPropDef, undoWrites } from '@cn/format'
import { useEffect, useState } from 'react'
import { type AiPick, pickLabel } from '../../shared/ai-features'
import { t, tv } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { EngineLogo, type LogoEngine, useChatEngine } from '../engine-logo'
import { composing } from '../ime'
import { FloatPop, type PopAnchor } from '../pop-place'
import { aiOpenNow, aiRunOf, aiTableOf, closeAiCol, openAiCol, runColumn, sourceChanged, useAiCol, wireAiCol } from './ai-col'
import { writeBase } from './cols'
import { openRecord } from './record-open'
import './ai-col.css'

/** 这一列用的哪家（单独选了的，没选跟 AI 对话） */
export function useColEngine(def: AiColDef | null): { id: LogoEngine; label: string } {
  const chat = useChatEngine()
  if (!def?.ai) return chat
  const p = { engine: def.ai.engine, ...(def.ai.model ? { model: def.ai.model } : {}), ...(def.ai.effort ? { effort: def.ai.effort } : {}) } as AiPick
  return { id: def.ai.engine as LogoEngine, label: pickLabel(p) }
}

/** 格子里的值（样例卡、右栏一行也用）：单选一个色块、多选几个、数字、文字；练习题那种是「📄 3 道」加第一题 */
export function AiValue(props: { ctx: BaseCtx; rec: BaseRec; col: string }) {
  const v = aiCellOf(props.ctx, props.rec, props.col)
  if (v.note)
    return (
      <>
        <button
          type="button"
          className="aic-note"
          aria-label={t('打开《{name}》', { name: v.note.name })}
          onClick={(e) => {
            e.stopPropagation()
            if (v.note!.path) openRecord({ path: v.note!.path, src: aiNoteSrc(props.ctx, props.col) }, { push: true })
          }}
        >
          <Codicon name="file" size={12} />
          {v.note.count > 1 ? t('{n} 道', { n: v.note.count }) : t('1 篇')}
        </button>
        <span className="tx t2">{v.note.first}</span>
      </>
    )
  const d = aiColOf(props.ctx, props.col)
  if (d?.output === 'select') return <span className="base-sel plain">{v.text}</span>
  if (d?.output === 'multi')
    return (
      <>
        {v.items.map((x) => (
          <span key={x} className="base-sel plain">
            {x}
          </span>
        ))}
      </>
    )
  return <span className={'tx' + (d?.output === 'number' ? ' num' : '')}>{v.text}</span>
}

/** 一格（td 里面那一截）：在写 / 排队 / 停下了 / 没写出来，写好了的标志加值、指着出的两颗按钮、手改的输入框 */
export function AiCell(props: { ctx: BaseCtx; rec: BaseRec; col: string; folder: string | null; table: string }) {
  useAiCol()
  wireAiCol()
  const { ctx, rec, col } = props
  const def = aiColOf(ctx, col)!
  const eng = useColEngine(def)
  const [editing, setEditing] = useState(false)
  const run = aiRunOf(props.folder, col)
  const st = run?.cells[rec.path]
  const v = aiCellOf(ctx, rec, col)
  if (st?.state === 'running')
    return (
      <span className="aiv" data-state="running">
        <EngineLogo id={eng.id} size={12} className="aic-pulse" />
        <span className="aic-shim" />
        <span className="wait">{t('在写')}</span>
      </span>
    )
  if (st?.state === 'queued')
    return (
      <span className="aiv" data-state="queued">
        <span className="wait">{t('排队')}</span>
      </span>
    )
  if (editing) return <AiHandEdit {...props} def={def} onDone={() => setEditing(false)} />
  if (v.state === 'empty') {
    const why = st?.state === 'stopped' ? t('停下了，没写') : st?.state === 'error' ? t('没写出来') : run?.sampled && (!run.job || run.mode === 'sample') ? t('等全跑') : ''
    return (
      <span className="aiv" data-state={st?.state ?? 'empty'} title={st?.error}>
        <span className="wait">{why}</span>
        {st?.state === 'error' && <RerunButton {...props} />}
      </span>
    )
  }
  const changed = v.state === 'ai' && sourceChanged(props.folder, col, rec.path, rec.text)
  return (
    <>
      <span className="aiv" data-state={v.state} title={v.state === 'mine' ? t('你改过的；整列重跑不动它') : t('AI 写的：{by}', { by: eng.label })}>
        {v.state === 'mine' ? <span className="mine-dot" aria-label={t('你改过')} /> : <EngineLogo id={eng.id} size={12} />}
        {/* 原文改过的小点紧跟着标志（放在值后面会被长的值挤到右边、让指着出来的两颗按钮盖住） */}
        {changed && (
          <button
            type="button"
            className="aic-changed"
            aria-label={t('原文改过，点一下重跑')}
            data-tip={t('原文改过，点一下重跑')}
            onClick={(e) => {
              e.stopPropagation()
              void runColumn(props.table, col, 'one', { paths: [rec.path] })
            }}
          />
        )}
        <AiValue ctx={ctx} rec={rec} col={col} />
      </span>
      <span className="cbtns">
        <RerunButton {...props} />
        {def.output === 'note' ? (
          <button
            type="button"
            aria-label={t('打开这篇')}
            data-tip={t('打开这篇')}
            onClick={(e) => {
              e.stopPropagation()
              const p = v.note?.path ?? aiNotePath(def, rec.name, col)
              openRecord({ path: p, src: aiNoteSrc(ctx, col) }, { push: true })
            }}
          >
            <Codicon name="go-to-file" size={12} />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('手改')}
            data-tip={t('手改')}
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
          >
            <Codicon name="edit" size={12} />
          </button>
        )}
      </span>
    </>
  )
}

function RerunButton(props: { rec: BaseRec; col: string; table: string }) {
  return (
    <button
      type="button"
      aria-label={t('重跑这一格')}
      data-tip={t('重跑这一格')}
      onClick={(e) => {
        e.stopPropagation()
        void runColumn(props.table, props.col, 'one', { paths: [props.rec.path] })
      }}
    >
      <Codicon name="refresh" size={12} />
    </button>
  )
}

/** 手改：一个输入框（单选给现有选项挑，多选写「a, b」），回车写进去、esc 不改；写了就算你写的（AI 的标志去掉） */
function AiHandEdit(props: { ctx: BaseCtx; rec: BaseRec; col: string; folder: string | null; def: AiColDef; onDone(): void }) {
  const { ctx, rec, col, def } = props
  const v = aiCellOf(ctx, rec, col)
  const options = def.output === 'select' ? [...new Set(ctx.recs.map((r) => r.props[col] ?? '').filter(Boolean))] : []
  const id = `aic-opts-${col}`
  const save = (raw: string) => {
    props.onDone()
    const value = def.output === 'multi' ? listOf(raw) : raw.trim()
    if ((Array.isArray(value) ? value.join(', ') : value) === v.text) return
    const ws = aiHandEdit(ctx, rec.path, col, value)
    void writeBase(ws, t('改了「{name}」的{col} · 这一格算你写的，AI 的标志去掉了；整列重跑不动它', { name: rec.name, col }), tv('数据库：手改「{name}」的{col}', { name: rec.name, col }), [props.folder ?? ''])
  }
  return (
    <>
      <input
        className="base-in"
        autoFocus
        list={options.length ? id : undefined}
        type={def.output === 'number' ? 'number' : 'text'}
        defaultValue={v.text}
        aria-label={`${rec.name} · ${col}`}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (composing(e)) return
          if (e.key === 'Enter') save(e.currentTarget.value)
          if (e.key === 'Escape') props.onDone()
        }}
        onBlur={(e) => save(e.currentTarget.value)}
      />
      {options.length > 0 && (
        <datalist id={id}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  )
}

/** 列头：那一家的标志 + 列名；在跑时后面「3/8」（滚走了也看得到） */
export function AiHead(props: { ctx: BaseCtx; col: string; folder: string | null; name: string }) {
  useAiCol()
  wireAiCol()
  const def = aiColOf(props.ctx, props.col)
  const eng = useColEngine(def)
  const run = aiRunOf(props.folder, props.col)
  const filled = props.ctx.recs.filter((r) => aiCellOf(props.ctx, r, props.col).state !== 'empty').length
  return (
    <>
      <EngineLogo id={eng.id} size={14} />
      <span>{props.name}</span>
      {run?.job && (
        <span className="aic-prog">
          {filled}/{props.ctx.recs.length}
        </span>
      )}
    </>
  )
}

/** 列菜单最上面 AI 列那一段：哪家、要求，改要求、只跑空着和没跑完的、整列重跑、新加的一讲自动填 */
export function AiColMenu(props: { ctx: BaseCtx; col: string; table: string; folder: string | null; onClose(): void; onSrc(next: (src: string) => string): void }) {
  const { ctx, col } = props
  const def = aiColOf(ctx, col)!
  const eng = useColEngine(def)
  const empty = ctx.recs.filter((r) => aiCellOf(ctx, r, col).state === 'empty').length
  const mine = ctx.recs.filter((r) => aiCellOf(ctx, r, col).state === 'mine').length
  const go = (mode: 'empty' | 'all') => {
    props.onClose()
    openAiCol({ table: props.table, col })
    void runColumn(props.table, col, mode)
  }
  return (
    <div className="aic-menu" role="group" aria-label={t('AI 列')}>
      <div className="aic-mhead">
        <EngineLogo id={eng.id} size={12} />
        <span>{t('AI 列 · {by}', { by: eng.label })}</span>
      </div>
      <div className="aic-mprompt">「{def.prompt}」</div>
      <button type="button" role="menuitem" onClick={() => (props.onClose(), openAiCol({ table: props.table, col, editing: true }))}>
        <Codicon name="edit" size={14} />
        <span>{t('改要求…')}</span>
      </button>
      <button type="button" role="menuitem" disabled={!empty} onClick={() => go('empty')}>
        <Codicon name="play" size={14} />
        <span>{t('只跑空着和没跑完的')}</span>
        <span className="k">{empty ? t('{n} 格', { n: empty }) : t('没有空着的')}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => go('all')}>
        <Codicon name="refresh" size={14} />
        <span>{t('整列重跑')}</span>
        {mine > 0 && <span className="k">{t('你改过的 {n} 格不动', { n: mine })}</span>}
      </button>
      <label className="base-swrow aic-auto">
        <Codicon name="sync" size={14} />
        <span>{t('新加的一讲自动填')}</span>
        <button
          type="button"
          className={'sw-toggle' + (def.newRows === 'auto' ? ' on' : '')}
          role="switch"
          aria-checked={def.newRows === 'auto'}
          aria-label={t('新加的一讲自动填')}
          onClick={() => props.onSrc((src) => setPropDef(src, col, { ...def, newRows: def.newRows === 'auto' ? 'manual' : 'auto' }))}
        />
      </label>
      <div className="sep" />
    </div>
  )
}

/**
 * 删掉这一列（连 AI 建的笔记）：每一条开头这一列那两行、AI 建的那几篇一起删，块里这一列拿掉；一次提交、底部能撤回（块也回来）。
 * 不问：右栏样例时的「不要这一列」；列菜单的「删除这一列」先用 AiDrop 问一句
 */
export async function dropAiColumn(tableId: string, col: string): Promise<boolean> {
  const tb = aiTableOf(tableId)
  if (!tb?.ctx) return false
  const def = aiColOf(tb.ctx, col)
  if (!def) return false
  const notes = def.output === 'note' ? await window.cn.aiColNotes(tb.ctx.recs.map((r) => aiNotePath(def, r.name, col))) : {}
  const { writes } = aiDropColumn(tb.ctx, col, notes)
  const before = tb.src
  const after = dropBaseColumn(before, col)
  if (writes.length) {
    const r = await window.cn.baseWrite(writes, tv('数据库：删掉 AI 列「{col}」', { col }))
    window.dispatchEvent(new CustomEvent('cn-base-wrote', { detail: tb.folder }))
    if (!r.ok) {
      app().notice(t('《{name}》刚被别处改过，没改成，再试一次', { name: titleOf(r.path) }))
      return false
    }
  }
  tb.edit(() => after)
  if (aiOpenNow()?.col === col && aiOpenNow()?.table === tableId) closeAiCol()
  const n = Object.keys(notes).length
  app().noticeUndo(n ? t('删掉了「{col}」这一列和 AI 建的 {n} 篇笔记', { col, n }) : t('删掉了「{col}」这一列', { col }), () => void undoDrop(tableId, writes, before, after, col))
  return true
}

async function undoDrop(tableId: string, writes: FileWrite[], before: string, after: string, col: string) {
  const tb = aiTableOf(tableId)
  if (writes.length) {
    const r = await window.cn.baseWrite(undoWrites(writes), tv('撤回：数据库：删掉 AI 列「{col}」', { col }))
    if (tb) window.dispatchEvent(new CustomEvent('cn-base-wrote', { detail: tb.folder }))
    if (!r.ok) return app().notice(t('《{name}》刚被别处改过，没撤回', { name: titleOf(r.path) }))
  }
  tb?.edit((cur) => (cur === after ? before : cur))
  app().notice(t('撤回了：文件回到这次之前的样子'))
}

/** 列菜单「删除这一列」：AI 列先问一句（连 AI 建的几篇；那几篇里写过答案的单独列出来） */
export function AiDrop(props: { at: PopAnchor; ctx: BaseCtx; col: string; table: string; onClose(): void }) {
  const def = aiColOf(props.ctx, props.col)!
  const [written, setWritten] = useState<string[] | null>(def.output === 'note' ? null : [])
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (def.output !== 'note') return
    let live = true
    void window.cn.aiColNotes(props.ctx.recs.map((r) => aiNotePath(def, r.name, props.col))).then((notes) => {
      if (!live) return
      setCount(Object.keys(notes).length)
      setWritten(aiDropColumn(props.ctx, props.col, notes).written)
    })
    return () => void (live = false)
  }, [props.col])
  return (
    <FloatPop at={props.at} className="base-pop base-confirm" role="dialog" aria-label={t('删掉这一列')}>
      <b>{t('删掉「{col}」这一列？', { col: props.col })}</b>
      <p>{count ? t('每一条里的「{col}」和 AI 建的 {n} 篇笔记都会删掉，底部能撤回。', { col: props.col, n: count }) : t('每一条里的「{col}」都会删掉，底部能撤回。', { col: props.col })}</p>
      {!!written?.length && (
        <p className="aic-written">
          {t('这几篇里你写过字：{names}', { names: written.map((p) => `《${titleOf(p)}》`).join('、') })}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={props.onClose}>
          {t('取消')}
        </button>
        <button type="button" className="btn btn-sm btn-danger" disabled={written === null} onClick={() => (props.onClose(), void dropAiColumn(props.table, props.col))}>
          {t('删除')}
        </button>
      </div>
    </FloatPop>
  )
}

/** 加一列菜单最下面一组：「AI 生成一列」，图标是正在用的那家的标志，下面一句灰字说它做什么 */
export function AiAddItem(props: { onPick(): void; bare?: boolean }) {
  const chat = useChatEngine()
  return (
    <>
      {/* bare：跟在「动手」那一组「按钮」后面，不另起一道线 */}
      {!props.bare && <div className="sep" />}
      <button type="button" role="menuitem" className="aic-add" onClick={props.onPick}>
        <EngineLogo id={chat.id} size={14} />
        <span className="aic-add-t">
          <span>{t('AI 生成一列')}</span>
          <small>{t('说要什么，AI 逐条读笔记填进来')}</small>
        </span>
      </button>
    </>
  )
}

/** AI 新建的那几篇在右栏「记录」开时用的块：那个文件夹，只摆名字（那边没有自己的数据库块） */
function aiNoteSrc(ctx: BaseCtx, col: string): string {
  const def = aiColOf(ctx, col)
  return def?.folder ? baseYaml(def.folder, ['file.name']) : ''
}
