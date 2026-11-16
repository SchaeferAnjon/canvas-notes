/**
 * 导入旧笔记：一个窗口三步——① 选来源（备忘录 / Markdown 文件夹）② 选文件夹 ③ 导入（进度、结果、撤回、现在梦游）。
 * 导入在主进程后台跑：窗口关了也接着导，中间栏底下一条小进度；导完提示带「撤回」。
 * 导进来的先进收件箱，归类改名留给梦游（预览后再收下）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useState } from 'react'
import type { ImportFolder, ImportKind, ImportProgress, ImportResult, ImportScan } from '../../shared/import'
import { closeImport, openImport, useImportOpen } from './store'
import './import.css'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const mb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(b >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const unitOf = (k: ImportKind) => (k === 'notes' ? '条' : '篇')
const fromOf = (r: { source: string }, k: ImportKind) => (k === 'notes' ? '备忘录' : `「${r.source}」`)

/** 挂在中间栏里：窗口、窗口关着时底下的小进度和导完的提示 */
export function ImportHost(props: { onOpenInbox(): void; onDreamNow(): void; onNotice(t: string): void }) {
  const open = useImportOpen()
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [kind, setKind] = useState<ImportKind>('notes')
  /** 窗口关着时导完的那次（底下提示，点了「撤回」或过一会儿消失） */
  const [doneToast, setDoneToast] = useState<ImportResult | null>(null)

  useEffect(() => window.cnImport.onOpen(() => openImport()), [])
  useEffect(() => {
    void window.cnImport.current().then((p) => p && setProgress(p))
    return window.cnImport.onProgress(setProgress)
  }, [])
  const running = !!progress && (progress.phase === 'reading' || progress.phase === 'writing' || progress.phase === 'committing')
  useEffect(() => {
    if (!open && progress?.phase === 'done') setDoneToast(progress.result)
  }, [progress, open])
  useEffect(() => {
    if (!doneToast) return
    const t = setTimeout(() => setDoneToast(null), 12_000)
    return () => clearTimeout(t)
  }, [doneToast])

  async function undo(r: ImportResult) {
    try {
      const hash = await window.cnImport.undo(r.commit!)
      setProgress(null)
      setDoneToast(null)
      props.onNotice(`撤回了这次导入 · 新提交 ${hash.slice(0, 7)} · ${r.notes} ${r.source === '备忘录' ? '条' : '篇'}都拿走了`)
    } catch (e) {
      props.onNotice(errText(e))
    }
  }

  return (
    <>
      {open > 0 && (
        <ImportSheet
          key={open}
          progress={running || progress?.phase === 'done' || progress?.phase === 'failed' ? progress : null}
          kind={kind}
          onKind={setKind}
          onClose={() => {
            // 导完、出错、停下以后关窗口：下次打开从头选；还在导的接着在底下显示进度
            if (!running) setProgress(null)
            closeImport()
          }}
          onUndo={(r) => void undo(r).then(closeImport)}
          onOpenInbox={() => (closeImport(), props.onOpenInbox())}
          onDreamNow={() => (closeImport(), setProgress(null), props.onDreamNow())}
          onReset={() => setProgress(null)}
        />
      )}
      {!open && running && (
        <div className="imp-pill" role="status" data-testid="import-pill">
          <span className="pd" />
          <span>
            正在导入{kind === 'notes' ? '备忘录' : '旧笔记'} · <span className="num">{progress.done}</span> / <span className="num">{progress.total || '…'}</span>
          </span>
          <span className="bar" aria-hidden>
            <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 4}%` }} />
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => openImport()}>
            看看
          </button>
        </div>
      )}
      {!open && doneToast && (
        <div className="toast-cn with-act imp-done-toast" role="status" data-testid="import-toast">
          <Codicon name="check" size={14} className="ok" />
          <span>
            导入了 {doneToast.notes} {doneToast.source === '备忘录' ? '条' : '篇'}，在 {doneToast.dir}
          </span>
          {doneToast.commit && (
            <button className="btn btn-ghost btn-sm" onClick={() => void undo(doneToast)}>
              <Codicon name="discard" size={14} />
              撤回
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => (setDoneToast(null), openImport())}>
            看看
          </button>
        </div>
      )}
    </>
  )
}

function ImportSheet(props: {
  progress: ImportProgress | null
  kind: ImportKind
  onKind(k: ImportKind): void
  onClose(): void
  onUndo(r: ImportResult): void
  onOpenInbox(): void
  onDreamNow(): void
  onReset(): void
}) {
  const [scan, setScan] = useState<ImportScan | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const p = props.progress
  const step = p ? 3 : scan ? 2 : 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), props.onClose())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])

  async function pick(kind: ImportKind) {
    setError(null)
    setBusy(true)
    props.onKind(kind)
    try {
      const s = await window.cnImport.pick(kind)
      if (!s) return
      setScan(s)
      // 默认全选还有没导过的笔记的文件夹；只放附件的文件夹（assets）第一次导时也选上
      const fresh = s.folders.every((f) => !f.already)
      setPicked(new Set(s.folders.filter((f) => f.notes - f.locked - f.already > 0 || (kind === 'folder' && fresh && f.attachments > 0)).map((f) => f.id)))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (!scan) return
    setError(null)
    try {
      await window.cnImport.start(scan.kind, [...picked])
    } catch (e) {
      setError(errText(e))
    }
  }

  const title = step === 1 ? '导入旧笔记' : step === 2 ? `从${scan!.kind === 'notes' ? '备忘录' : `「${scan!.source}」`}导入` : p?.phase === 'done' ? '导好了' : '导入旧笔记'
  return (
    <div className="mm-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="mm-sheet imp-sheet" role="dialog" aria-label="导入旧笔记">
        <div className="mm-hd">
          <h3>{title}</h3>
          <Steps at={step} done={p?.phase === 'done'} />
          <span className="sp" />
          <button className="iconbtn" aria-label="关闭" title="关闭 esc" onClick={props.onClose}>
            <Codicon name="close" size={16} />
          </button>
        </div>
        {step === 1 && <Sources busy={busy} error={error} onPick={(k) => void pick(k)} />}
        {step === 2 && <Folders scan={scan!} picked={picked} onPicked={setPicked} error={error} onBack={() => (setScan(null), setError(null))} onStart={() => void start()} onClose={props.onClose} />}
        {step === 3 && p && <Running p={p} kind={props.kind} onClose={props.onClose} onUndo={props.onUndo} onOpenInbox={props.onOpenInbox} onDreamNow={props.onDreamNow} onAgain={() => (props.onReset(), setScan(null))} />}
      </div>
    </div>
  )
}

function Steps(props: { at: number; done: boolean }) {
  const step = (n: number, label: string) => {
    const done = n < props.at || (n === 3 && props.done)
    return (
      <span className={done ? 'done' : n === props.at ? 'now' : ''} aria-current={n === props.at ? 'step' : undefined}>
        <i>{done ? <Codicon name="check" size={11} /> : n}</i>
        {label}
      </span>
    )
  }
  return (
    <div className="mm-steps" aria-label="三步">
      {step(1, '选来源')}·{step(2, '选文件夹')}·{step(3, '导入')}
    </div>
  )
}

function Sources(props: { busy: boolean; error: string | null; onPick(k: ImportKind): void }) {
  return (
    <>
      <div className="imp-body">
        <p className="imp-lead">旧笔记先进收件箱，原来的文件夹记在「原文件夹」里；今晚梦游时 AI 分进课程、项目、生活、写作，起好名字，你点「预览」看过再收下。</p>
        <button className="imp-src" disabled={props.busy} onClick={() => props.onPick('notes')}>
          <span className="vi">
            <Codicon name="note" size={18} />
          </span>
          <span className="tx">
            <b>备忘录</b>
            <span>文件夹、图片、勾选清单（勾没勾都留着）、表格、创建和修改时间都带上</span>
          </span>
          <Codicon name="chevron-right" size={16} className="chev" />
        </button>
        <button className="imp-src" disabled={props.busy} onClick={() => props.onPick('folder')}>
          <span className="vi">
            <Codicon name="folder-opened" size={18} />
          </span>
          <span className="tx">
            <b>Markdown 文件夹</b>
            <span>旧的 Obsidian 库或别的放 md 的文件夹：图片附件一起拷，[[链接]] 照样能点</span>
          </span>
          <Codicon name="chevron-right" size={16} className="chev" />
        </button>
        <p className="imp-note">选备忘录时会弹出系统的选文件夹窗口，已经停在备忘录的数据文件夹「group.com.apple.notes」，直接点「允许读取」。只读，不改备忘录里的任何东西。</p>
        {props.error && (
          <p className="imp-err" role="alert">
            {props.error}
          </p>
        )}
      </div>
      <div className="mm-ft">
        <span className="help">导进 收件箱/导入/&lt;来源&gt;/ · 一次提交，能撤回</span>
      </div>
    </>
  )
}

/** 选中的这些文件夹：能导几条（去掉上锁的、导过的）、附件几个 */
function totals(folders: ImportFolder[], picked: Set<string>) {
  const sel = folders.filter((f) => picked.has(f.id))
  return {
    folders: sel.length,
    notes: sel.reduce((s, f) => s + f.notes - f.locked - f.already, 0),
    attachments: sel.reduce((s, f) => s + f.attachments, 0),
    locked: sel.reduce((s, f) => s + f.locked, 0),
    already: sel.reduce((s, f) => s + f.already, 0),
  }
}

function Folders(props: { scan: ImportScan; picked: Set<string>; onPicked(s: Set<string>): void; error: string | null; onBack(): void; onStart(): void; onClose(): void }) {
  const { scan, picked } = props
  const unit = unitOf(scan.kind)
  const t = useMemo(() => totals(scan.folders, picked), [scan, picked])
  const all = scan.folders.length > 0 && scan.folders.every((f) => picked.has(f.id))
  /** 点一个文件夹：它和它下面的子文件夹一起勾上或去掉 */
  const toggle = (f: ImportFolder) => {
    const next = new Set(picked)
    const on = !picked.has(f.id)
    for (const g of scan.folders) if (g.id === f.id || (f.path && g.path.startsWith(f.path + '/')) || (scan.kind === 'folder' && f.path === '' && g.depth === 0)) on ? next.add(g.id) : next.delete(g.id)
    props.onPicked(next)
  }
  return (
    <>
      <div className="imp-body">
        <div className="imp-from">
          <Codicon name={scan.kind === 'notes' ? 'note' : 'folder-opened'} size={14} />
          <span className="mono" title={scan.where}>
            {scan.where}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={props.onBack}>
            <Codicon name="arrow-left" size={12} />
            换一个
          </button>
        </div>
        <div className="imp-list" role="group" aria-label="要导入的文件夹">
          <label className="imp-row all">
            <input type="checkbox" checked={all} onChange={() => props.onPicked(all ? new Set() : new Set(scan.folders.map((f) => f.id)))} />
            <span className="nm">全部文件夹</span>
            <span className="ct num">{scan.folders.reduce((s, f) => s + f.notes, 0)} {unit}</span>
          </label>
          {scan.folders.map((f) => (
            <label key={f.id} className="imp-row" style={{ paddingLeft: 10 + f.depth * 18 }}>
              <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f)} aria-label={f.path || f.name} />
              <Codicon name="folder" size={14} className="fi" />
              <span className="nm">{f.name}</span>
              {f.locked > 0 && <span className="tag">{f.locked} {unit}上锁</span>}
              {f.already > 0 && <span className="tag">{f.already} {unit}导过</span>}
              {/* 只装子文件夹的那层不写「0 条」 */}
              <span className="ct num">
                {f.notes > 0 && `${f.notes} ${unit}`}
                {f.notes > 0 && f.attachments > 0 && ' · '}
                {f.attachments > 0 && <em>{f.attachments} 个附件</em>}
              </span>
            </label>
          ))}
        </div>
        {(t.locked > 0 || t.already > 0) && (
          <p className="imp-note">
            {t.locked > 0 && `上了锁的 ${t.locked} ${unit}读不了，会跳过（在备忘录里去掉锁再导一次就行）。`}
            {t.already > 0 && `以前导过的 ${t.already} ${unit}这次跳过，不会多出一份。`}
          </p>
        )}
        {props.error && (
          <p className="imp-err" role="alert">
            {props.error}
          </p>
        )}
      </div>
      <div className="mm-ft">
        <span className="help" data-testid="import-summary">
          选了 {t.folders} 个文件夹 · <b className="num">{t.notes}</b> {unit}
          {t.attachments > 0 && ` · ${t.attachments} 个图片和附件`}
        </span>
        <button className="btn" onClick={props.onClose}>
          取消
        </button>
        <button className="btn btn-primary" disabled={!t.notes} onClick={props.onStart}>
          <Codicon name="inbox" size={14} />
          导入 {t.notes} {unit}
        </button>
      </div>
    </>
  )
}

function Running(props: { p: ImportProgress; kind: ImportKind; onClose(): void; onUndo(r: ImportResult): void; onOpenInbox(): void; onDreamNow(): void; onAgain(): void }) {
  const { p } = props
  const unit = unitOf(props.kind)
  if (p.phase === 'done') {
    const r = p.result
    return (
      <>
        <div className="imp-body">
          <div className="imp-result" data-testid="import-result">
            <span className="okc">
              <Codicon name="check" size={16} />
            </span>
            <div>
              <b>
                从{fromOf(r, props.kind)}导入了 {r.notes} {unit}
              </b>
              <span>
                进了 <span className="mono">{r.dir}/</span>
                {r.attachments > 0 && ` · ${r.attachments} 个图片和附件（${mb(r.bytes)}）`}
                {r.commit && (
                  <>
                    {' '}
                    · 提交 <span className="mono">{r.commit.slice(0, 7)}</span>
                  </>
                )}
              </span>
            </div>
          </div>
          {(r.lost.length > 0 || r.skipped.already > 0) && (
            <ul className="imp-lost" aria-label="没导全的">
              {r.skipped.already > 0 && <li>以前导过的 {r.skipped.already} {unit}跳过了</li>}
              {r.lost.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <div className="imp-next">
            <Codicon name="wand" size={14} />
            <p>接下来：梦游会把它们分进课程、项目、生活、写作，起好名字，拿不准的留在收件箱。改好的在梦游报告里点「预览」看，不对就跟 AI 说哪里不对，满意了再收下。</p>
          </div>
        </div>
        <div className="mm-ft">
          {r.commit && (
            <button className="btn btn-ghost imp-undo" onClick={() => props.onUndo(r)}>
              <Codicon name="discard" size={14} />
              撤回这次导入
            </button>
          )}
          <span className="help" />
          <button className="btn" onClick={props.onOpenInbox}>
            <Codicon name="inbox" size={14} />
            打开收件箱
          </button>
          <button className="btn btn-primary" onClick={props.onDreamNow}>
            <Codicon name="wand" size={14} />
            现在就让梦游整理
          </button>
        </div>
      </>
    )
  }
  if (p.phase === 'failed' || p.phase === 'stopped') {
    return (
      <>
        <div className="imp-body">
          <p className="imp-err" role="alert">
            {p.phase === 'failed' ? `没导成：${p.error}。库里什么都没动。` : '停下了，库里什么都没动。'}
          </p>
        </div>
        <div className="mm-ft">
          <span className="help" />
          <button className="btn" onClick={props.onAgain}>
            重新选
          </button>
        </div>
      </>
    )
  }
  const pct = p.total ? (p.done / p.total) * 100 : 3
  const label = p.phase === 'reading' ? '在读' : p.phase === 'writing' ? '在写进库里' : '在提交'
  return (
    <>
      <div className="imp-body">
        <div className="imp-prog" role="status" data-testid="import-progress">
          <div className="line">
            <b>
              {label} · <span className="num">{p.done}</span> / <span className="num">{p.total || '…'}</span> {unit}
            </b>
            {'title' in p && p.title && <span className="cur">{p.title}</span>}
          </div>
          <span className="bar" aria-hidden>
            <i style={{ width: `${pct}%` }} />
          </span>
        </div>
        <p className="imp-note">可以关掉这个窗口接着干别的，导完底下会提示。导完之前停下，库里什么都不会多。</p>
      </div>
      <div className="mm-ft">
        <span className="help" />
        <button className="btn btn-ghost" onClick={() => void window.cnImport.stop()}>
          停下
        </button>
        <button className="btn" onClick={props.onClose}>
          在后台导
        </button>
      </div>
    </>
  )
}
