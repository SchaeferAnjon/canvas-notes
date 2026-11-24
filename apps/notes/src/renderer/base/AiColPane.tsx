/**
 * 右栏「AI 列」标签（数据库第三批 task-i921u「AI 生成一列」方向 B「右栏一页」，照 proto-ai-column.html#dir=b）：
 * - 还没建：「这一列放什么」表单（常用 5 个、放成什么照写的猜、列名、读什么、用哪家），「先跑前 3 条」；
 * - 建好了：这一列的要求收成一张小卡（「改要求」）、样例前 3 条整段摊开（每张能重跑、打开那篇）、全跑以后这一列一格一行（谁在写、谁排队、谁写好了），
 *   底下一条：先跑 几/3 · 停下 esc → 不要这一列 · 全跑剩下 N 条 → 在写 几/N · 停下 esc → 停在 几/N · 接着跑 → N 格都填好了 · 整列重跑。
 * 表里的格子同时跟着填（ai-cells.tsx）。打开这一页、看样例都不写文件；建列写块里这一列那几行（表格的 edit.src）。
 */
import { Codicon } from '@cn/design'
import {
  AI_OUTPUTS,
  AI_PRESETS,
  AI_SAMPLE,
  aiCellOf,
  type AiColDef,
  type AiColPick,
  aiColOf,
  aiNoteFolder,
  aiNoteSummary,
  type AiOutput,
  type AiReads,
  aiTwoWayName,
  guessColName,
  guessOutput,
  noteBody,
  setBaseOrder,
  setPropDef,
} from '@cn/format'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { EngineInfo } from '../../shared/agent'
import type { AiPick } from '@cn/ai-engines/shared'
import { AiPicker, engineFamily } from '@cn/ai-chat/ai-picker'
import { app } from '../ctx/actions'
import { EngineLogo } from '../engine-logo'
import { useT } from '../i18n'
import { composing } from '../ime'
import { nextPick, valueOf } from '../settings-ai'
import { aiOpenNow, aiRunOf, aiTableOf, type AiTable, runColumn, setAiOpen, stopColumn, subscribe, useAiCol, wireAiCol } from './ai-col'
import { AiValue, dropAiColumn, useColEngine } from './ai-cells'

const OUT_ICON: Record<AiOutput, string> = Object.fromEntries(AI_OUTPUTS.map((o) => [o.output, o.icon])) as Record<AiOutput, string>

/** 右栏标签上的名字：「AI 生成一列」/「AI 列「练习题」」 */
export function useAiColTitle(): string | null {
  const t = useT()
  // 只在名字变了时重画（App 用它，别跟着每一格的进度重画整个窗口）
  return useSyncExternalStore(subscribe, () => {
    const o = aiOpenNow()
    return o ? (o.col ? t('AI 列「{col}」', { col: o.col }) : t('AI 生成一列')) : null
  })
}

export function AiColPane(props: { onClose(): void }) {
  useAiCol()
  wireAiCol()
  const t = useT()
  const o = aiOpenNow()
  const tb = o ? aiTableOf(o.table) : null
  if (!o) return <div className="aipane aip-empty">{t('在数据库表头「+」里点「AI 生成一列」，在这里说要什么')}</div>
  if (!tb?.ctx) return <div className="aipane aip-empty">{t('先打开放这个数据库的那篇文档')}</div>
  const def = o.col ? aiColOf(tb.ctx, o.col) : null
  return (
    <div className="aicol">
      {!o.col || !def || o.editing ? <AiForm key={`${o.table}|${o.col ?? ''}|${o.editing}`} tb={tb} col={def ? o.col : null} def={def} index={o.index} onClose={props.onClose} /> : <AiColPage tb={tb} col={o.col} def={def} />}
    </div>
  )
}

// ---------------------------------------------------------------- 表单：说要什么

function AiForm(props: { tb: AiTable; col: string | null; def: AiColDef | null; index: number; onClose(): void }) {
  const t = useT()
  const { tb, def } = props
  const ctx = tb.ctx!
  const [prompt, setPrompt] = useState(def?.prompt ?? '')
  const [preset, setPreset] = useState<string | null>(null)
  const [out, setOut] = useState<AiOutput | null>(def?.output ?? null)
  const [name, setName] = useState(props.col ?? '')
  const [nameTouched, setNameTouched] = useState(false)
  const [reads, setReads] = useState<AiReads>(def?.reads ?? 'note')
  const [pick, setPick] = useState<AiColPick | null>(def?.ai ?? null)
  const [eng, setEng] = useState<{ engines: EngineInfo[]; label: string; chat: AiPick } | null>(null)
  useEffect(() => {
    const load = () => void window.cn.aiEngines().then((r) => setEng({ engines: r.engines, label: r.label, chat: r.chat }))
    load()
    return window.cn.onAiPrefsChanged(load)
  }, [])
  const output = out ?? guessOutput(prompt)
  const colName = (props.col ?? ((nameTouched && name.trim()) || guessColName(prompt))).replace(/:/g, '：')
  const N = ctx.recs.length
  const taken = (n: string) => n !== props.col && (!!ctx.doc.props[n] || Object.hasOwn(ctx.types, n))
  const fresh = (() => {
    let n = colName
    for (let k = 2; taken(n); k++) n = `${colName} ${k}`
    return n
  })()
  const folder = def?.folder ?? aiNoteFolder(tb.folder, fresh)
  const exampleName = ctx.recs[Math.min(2, N - 1)]?.name ?? ''
  const hint: Record<AiOutput, string> = {
    text: t('写进每一讲开头一行「{name}: …」；只放得下一段话，长的请选「新建一篇笔记」。', { name: fresh }),
    select: t('AI 从选项里挑一个；它觉得都不合适时可以新起一个。'),
    multi: t('AI 挑 1 到 3 个，写成一行 [a, b]；用过的选项优先。'),
    number: t('AI 只写一个数；写不出数的那一格空着，说明为什么。'),
    note: t('每一讲新建一篇《{example}》，放进 {folder}/，正文是带 AI 标志的 AI 块；这一格连过去，那篇开头写「{back}」。', { example: `${exampleName} ${fresh}`, folder, back: def?.twoWay ?? aiTwoWayName(tb.folder) }),
  }
  const newDef = (): AiColDef => ({
    type: 'ai',
    prompt: prompt.trim(),
    output,
    folder: output === 'note' ? folder : null,
    twoWay: output === 'note' ? (def?.twoWay ?? aiTwoWayName(tb.folder)) : null,
    reads,
    newRows: def?.newRows ?? 'auto',
    ai: pick,
  })
  const OUT_LABEL: Record<AiOutput, string> = { text: t('文字'), select: t('单选'), multi: t('多选'), number: t('数字'), note: t('新建一篇笔记，关联过来') }
  const PRESET_LABEL: Record<string, string> = { sum: t('摘要'), kw: t('关键词'), ex: t('练习题'), diff: t('难度'), en: t('翻译标题') }

  /** 先跑前 3 条：这一列写进块里（加在视图最后），马上跑当前视图的前 3 条 */
  const sample = () => {
    const d = newDef()
    if (!d.prompt) return
    const cols = parseOrder(tb)
    const at = Math.max(1, Math.min(props.index, cols.length))
    const next = (src: string) => setPropDef(setBaseOrder(src, [...cols.slice(0, at), fresh, ...cols.slice(at)], tb.view), fresh, d)
    const src = next(tb.src)
    tb.edit(next)
    setAiOpen({ col: fresh, editing: false })
    void runColumn(tb.id, fresh, 'sample', { src })
  }
  /** 改要求：只存要求（旧的格子先留着）、照新要求重跑（整列，你改过的不动） */
  const save = (rerun: boolean) => {
    const d = newDef()
    if (!d.prompt || !props.col) return
    const next = (src: string) => setPropDef(src, props.col!, d)
    const src = next(tb.src)
    tb.edit(next)
    setAiOpen({ editing: false })
    if (rerun) void runColumn(tb.id, props.col, 'all', { src })
    else app().notice(t('存了「{col}」的新要求：旧的格子先留着，点「整列重跑」才换', { col: props.col }))
  }
  const done = ctx.recs.filter((r) => props.col && aiCellOf(ctx, r, props.col).state !== 'empty').length

  return (
    <div className="aipane" /* 不翻：data-part 给 e2e 和样式认 */ data-part="右栏 AI 列">
      <div className="aif" /* 不翻：data-part 给 e2e 和样式认 */ data-part="说要什么">
        <div>
          <label className="l" htmlFor="aic-prompt">
            {t('这一列放什么')}
          </label>
          <textarea
            id="aic-prompt"
            autoFocus
            placeholder={t('比如：每一讲的练习题')}
            value={prompt}
            onChange={(e) => (setPrompt(e.currentTarget.value), setPreset(null))}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (composing(e)) return
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !props.col) sample()
            }}
          />
          <div className="exs">
            <span className="t3">{t('常用')}</span>
            {AI_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={'pill' + (preset === p.key ? ' on' : '')}
                onClick={() => {
                  setPreset(p.key)
                  setPrompt(p.prompt)
                  setOut(p.output)
                  if (!props.col) (setName(p.name), setNameTouched(true))
                }}
              >
                {PRESET_LABEL[p.key]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="l">
            {t('放成')}
            {out === null && prompt.trim() && <span className="t3 guess">{t('照你写的猜的，能改')}</span>}
          </div>
          <div className="outs" role="radiogroup" aria-label={t('放成')} /* 不翻：data-part 给 e2e 和样式认 */ data-part="放成什么">
            {AI_OUTPUTS.map((x) => (
              <button key={x.output} type="button" role="radio" aria-checked={output === x.output} className={'o' + (x.output === 'note' ? ' wide' : '') + (output === x.output ? ' on' : '')} onClick={() => setOut(x.output)}>
                <Codicon name={OUT_ICON[x.output] as 'file'} size={14} />
                {OUT_LABEL[x.output]}
              </button>
            ))}
          </div>
          <div className="hint">{hint[output]}</div>
        </div>
        <div className="frow2">
          <span className="k">{t('列名')}</span>
          {/* 没手动改过时照要求猜出来的名字直接是框里的值（原型）；清空了才露占位字 */}
          <input className="field" aria-label={t('列名')} value={props.col ?? (nameTouched ? name : prompt.trim() ? guessColName(prompt) : '')} placeholder={t('照要求起')} disabled={!!props.col} onChange={(e) => (setName(e.currentTarget.value), setNameTouched(true))} />
        </div>
        <div className="frow2">
          <span className="k">{t('读什么')}</span>
          <select className="field" aria-label={t('读什么')} value={reads} onChange={(e) => setReads(e.currentTarget.value as AiReads)}>
            <option value="note">{t('那一讲的笔记全文')}</option>
            <option value="attached">{t('笔记，加上它配着的 PDF、网页')}</option>
          </select>
        </div>
        <div className="frow2">
          <span className="k">{t('用哪家')}</span>
          {eng && (
            <AiPicker
              look="box"
              ids={{ family: 'aic-pick', model: 'aic-pick-model', effort: 'aic-pick-effort' }}
              familyMenu={t('这一列用哪一家')}
              familyHead={t('这一列用哪一家')}
              label={t('用哪家')}
              families={eng.engines.map(engineFamily)}
              lead={{ label: t('跟 AI 对话'), sub: eng.label, logo: eng.chat.engine }}
              value={valueOf(pick as AiPick | null)}
              unsetEffort={{ label: t('默认档'), note: t('不指定，用它自己的') }}
              onFamily={(id) => setPick(id === null ? null : nextPick(pick as AiPick | null, eng.engines, { family: id }))}
              onModel={(m) => setPick(nextPick(pick as AiPick | null, eng.engines, { model: m }))}
              onEffort={(e) => setPick(nextPick(pick as AiPick | null, eng.engines, { effort: e }))}
            />
          )}
        </div>
        {props.col ? (
          <div className="ffoot">
            <span className="t3">{t('改了要求，旧的 {n} 格先留着', { n: done })}</span>
            <span className="sp" />
            <button type="button" className="btn ghost" onClick={() => setAiOpen({ editing: false })}>
              {t('取消')}
            </button>
            <button type="button" className="btn" disabled={!prompt.trim()} onClick={() => save(false)}>
              {t('只存要求')}
            </button>
            <button type="button" className="btn solid" disabled={!prompt.trim()} onClick={() => save(true)}>
              <Codicon name="refresh" size={14} />
              {t('照新要求重跑')}
            </button>
          </div>
        ) : (
          <div className="ffoot">
            <span className="t3">{N > AI_SAMPLE ? t('先跑 {k} 条给你看，满意了再跑剩下 {n} 条', { k: AI_SAMPLE, n: N - AI_SAMPLE }) : t('先跑 {k} 条给你看', { k: Math.min(N, AI_SAMPLE) })}</span>
            <span className="sp" />
            <button type="button" className="btn solid" disabled={!prompt.trim() || !N} onClick={sample}>
              <Codicon name="play" size={14} />
              {t('先跑前 {k} 条', { k: AI_SAMPLE })}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 表格现在摆出来的列（建列时加在哪） */
const parseOrder = (tb: AiTable): string[] => (tb.columns.length ? tb.columns : ['file.name'])

// ---------------------------------------------------------------- 建好了：要求、样例、每一格、进度

function AiColPage(props: { tb: AiTable; col: string; def: AiColDef }) {
  const t = useT()
  const { tb, col, def } = props
  const ctx = tb.ctx!
  const eng = useColEngine(def)
  const run = aiRunOf(tb.folder, col)
  const order = useMemo(() => {
    const known = new Set(ctx.recs.map((r) => r.path))
    const o = tb.order.filter((p) => known.has(p))
    return o.length ? o : ctx.recs.map((r) => r.path)
  }, [ctx, tb.order.join('\n')])
  const recs = order.map((p) => ctx.recs.find((r) => r.path === p)!)
  const N = recs.length
  const filled = recs.filter((r) => aiCellOf(ctx, r, col).state !== 'empty').length
  const empty = N - filled
  const phase = run?.job ? (run.mode === 'sample' ? 'sampling' : 'running') : run?.stopped && empty ? 'stopped' : empty ? (run?.sampled || filled <= AI_SAMPLE ? 'sampled' : 'partial') : 'done'
  const stateOf = (p: string) => run?.cells[p]?.state
  const OUT_LABEL: Record<AiOutput, string> = { text: t('文字'), select: t('单选'), multi: t('多选'), number: t('数字'), note: t('新建一篇笔记，关联过来') }

  const card = (r: (typeof recs)[number]) => {
    const st = stateOf(r.path)
    const v = aiCellOf(ctx, r, col)
    let inner: React.ReactNode
    if (st === 'running')
      inner = (
        <div className="one">
          <EngineLogo id={eng.id} size={12} className="aic-pulse" />
          <span className="aic-shim" />
          <span className="wait">{t('在读《{name}》{n} 字', { name: r.name, n: noteBody(r.text).trim().length.toLocaleString() })}</span>
        </div>
      )
    else if (st === 'queued') inner = <div className="one wait">{t('排队')}</div>
    else if (v.state !== 'empty') {
      const items = v.note?.path ? aiNoteSummary(ctx.related.get(def.folder ?? '')?.find((x) => x.path === v.note!.path)?.text ?? '', col).items : []
      inner =
        def.output === 'note' ? (
          v.note?.count ? (
            <ol>
              {items.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          ) : (
            <div className="one">{items.join(' ')}</div>
          )
        ) : (
          <div className="one aiv">
            <AiValue ctx={ctx} rec={r} col={col} />
          </div>
        )
    } else inner = <div className="one wait">{st === 'stopped' ? t('停下了，没写') : st === 'error' ? t('没写出来：{why}', { why: run?.cells[r.path]?.error ?? '' }) : t('还没跑')}</div>
    return (
      <div key={r.path} className={'scard' + (st === 'running' ? ' run' : '')} /* 不翻：data-part 给 e2e 和样式认 */ data-part="样例" data-path={r.path}>
        <div className="h">
          {v.state === 'ai' && st !== 'running' && <EngineLogo id={eng.id} size={12} />}
          {v.state === 'mine' && st !== 'running' && <span className="mine-dot" />}
          <span className="nm">{r.name}</span>
          {v.state !== 'empty' && !run?.job && (
            <>
              <button type="button" className="ib" aria-label={t('重跑「{name}」这一格', { name: r.name })} data-tip={t('重跑这一格')} onClick={() => void runColumn(tb.id, col, 'one', { paths: [r.path] })}>
                <Codicon name="refresh" size={14} />
              </button>
              {v.note?.path && (
                <button type="button" className="ib" aria-label={t('打开《{name}》', { name: v.note.name })} data-tip={t('打开这篇')} onClick={() => app().openFile(v.note!.path!)}>
                  <Codicon name="go-to-file" size={14} />
                </button>
              )}
            </>
          )}
        </div>
        {inner}
      </div>
    )
  }

  const bar = (
    <span className="pbar">
      <i style={{ width: `${N ? (filled / N) * 100 : 0}%` }} />
    </span>
  )
  const stop = (
    <button type="button" className="btn" onClick={() => stopColumn(tb.folder, col)}>
      <Codicon name="debug-stop" size={14} />
      {t('停下')}
      <span className="k">esc</span>
    </button>
  )
  let foot: React.ReactNode
  if (phase === 'sampling')
    foot = (
      <>
        <EngineLogo id={eng.id} size={14} className="aic-pulse" />
        <span className="msg">{t('先跑前 {k} 条 · {n}/{k}', { k: Object.keys(run!.cells).length, n: Object.values(run!.cells).filter((c) => c.state === 'done').length })}</span>
        <span className="sp" />
        {stop}
        {bar}
      </>
    )
  else if (phase === 'running')
    foot = (
      <>
        <EngineLogo id={eng.id} size={14} className="aic-pulse" />
        <span className="msg">{t('在写 {n}/{all} · 一次 3 条', { n: filled, all: N })}</span>
        <span className="sp" />
        {stop}
        {bar}
      </>
    )
  else if (phase === 'sampled')
    foot = (
      <>
        <button type="button" className="btn ghost" onClick={() => void dropAiColumn(tb.id, col)}>
          {t('不要这一列')}
        </button>
        <span className="sp" />
        <button type="button" className="btn solid" onClick={() => void runColumn(tb.id, col, 'rest')}>
          <Codicon name="play" size={14} />
          {t('全跑剩下 {n} 条', { n: empty })}
        </button>
      </>
    )
  else if (phase === 'stopped' || phase === 'partial')
    foot = (
      <>
        <span className="msg">{phase === 'stopped' ? t('停在 {n}/{all}，写好的都存了', { n: filled, all: N }) : t('{n}/{all} 格填好了', { n: filled, all: N })}</span>
        <span className="sp" />
        <button type="button" className="btn solid" onClick={() => void runColumn(tb.id, col, 'rest')}>
          <Codicon name="play" size={14} />
          {t('接着跑剩下 {n} 条', { n: empty })}
        </button>
      </>
    )
  else
    foot = (
      <>
        <span className="msg">{def.newRows === 'auto' ? t('{n} 格都填好了 · 新加的一讲会自动填', { n: N }) : t('{n} 格都填好了 · 新加的一讲要点重跑才填', { n: N })}</span>
        <span className="sp" />
        <button type="button" className="btn" onClick={() => void runColumn(tb.id, col, 'all')}>
          <Codicon name="refresh" size={14} />
          {t('整列重跑')}
        </button>
      </>
    )

  const showRows = phase !== 'sampling' && phase !== 'sampled'
  return (
    <>
      <div className="aipane" /* 不翻：data-part 给 e2e 和样式认 */ data-part="右栏 AI 列">
        <div className="sumcard" /* 不翻：data-part 给 e2e 和样式认 */ data-part="这一列的要求">
          <span>{t('要什么')}</span>
          <span className="v">{def.prompt}</span>
          <span>{t('放成')}</span>
          <span className="v">
            {OUT_LABEL[def.output]}
            {def.output === 'note' && def.folder ? ` · ${def.folder}/` : ''}
          </span>
          <span>{t('读什么')}</span>
          <span className="v">{def.reads === 'note' ? t('那一讲的笔记全文') : t('笔记加它配着的 PDF、网页')}</span>
          <span>{t('用哪家')}</span>
          <span className="v">
            <EngineLogo id={eng.id} size={12} /> {eng.label}
          </span>
          <span className="ed">
            <button type="button" className="btn ghost" disabled={!!run?.job} onClick={() => setAiOpen({ editing: true })}>
              <Codicon name="edit" size={12} />
              {t('改要求')}
            </button>
          </span>
        </div>
        <div className="sect">
          {t('样例 · 前 {k} 条', { k: Math.min(AI_SAMPLE, N) })}
          <span className="sp" />
          {phase === 'sampled' && t('看着行就全跑')}
        </div>
        {recs.slice(0, AI_SAMPLE).map(card)}
        {showRows && (
          <>
            <div className="sect">
              {t('这一列的 {n} 格', { n: N })}
              <span className="sp" />
              {filled}/{N}
            </div>
            <div className="rowlist" /* 不翻：data-part 给 e2e 和样式认 */ data-part="这一列的每一格">
              {recs.map((r) => {
                const st = stateOf(r.path)
                const v = aiCellOf(ctx, r, col)
                return (
                  <div key={r.path} className="r" data-path={r.path} data-state={st ?? v.state}>
                    <span className="n">{r.name}</span>
                    <span className="v aiv">
                      {st === 'running' ? (
                        <>
                          <EngineLogo id={eng.id} size={12} className="aic-pulse" />
                          <span className="aic-shim" />
                        </>
                      ) : st === 'queued' ? (
                        <span className="wait">{t('排队')}</span>
                      ) : v.state !== 'empty' ? (
                        <>
                          {v.state === 'mine' ? <span className="mine-dot" /> : <EngineLogo id={eng.id} size={12} />}
                          <AiValue ctx={ctx} rec={r} col={col} />
                        </>
                      ) : (
                        <span className="wait" title={run?.cells[r.path]?.error}>
                          {st === 'stopped' ? t('停下了，没写') : st === 'error' ? t('没写出来') : t('还没跑')}
                        </span>
                      )}
                    </span>
                    {(v.state !== 'empty' || st === 'error') && !run?.job && (
                      <button type="button" className="ib" aria-label={t('重跑「{name}」这一格', { name: r.name })} data-tip={t('重跑这一格')} onClick={() => void runColumn(tb.id, col, 'one', { paths: [r.path] })}>
                        <Codicon name="refresh" size={14} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
      <div className="pfoot" /* 不翻：data-part 给 e2e 和样式认 */ data-part="AI 列进度条">
        {foot}
      </div>
    </>
  )
}

