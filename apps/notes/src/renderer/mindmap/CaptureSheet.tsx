/**
 * 拍一张导图（方向 B「先核对再放」）：一个窗口三步——① 拍 ② 核对 ③ 放上白板。
 * 照片也能拖进来、⌘V 粘贴、从照片选、隔空投送（看「下载」里新来的）。
 * 核对：左边照片框出每个认出的节点，右边大纲直接改，拿不准的标黄；「做成白板导图」后白板上一个个长出来。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { keyFor } from '../keys'
import { AiError } from '@cn/ai-chat/ai-error'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { CAMERA_LABEL, fromRows, indentRows, rowKey, toRows, type CameraKind, type PhotoFrom, type Row, type StagedPhoto } from '../../shared/mindmap'
import { closeCapture, markGrow, openCapture, useCaptureRequest, type CaptureRequest } from './capture-store'
import { useCamera } from './useCamera'
import './mindmap.css'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 挂在中间栏里：有人请打开（⌘K、菜单、工具板）就开窗口。onPlaced 的 hung：挂到了白板、笔记上（留在那一篇，不另开导图） */
export function CaptureHost(props: { notes: NoteFile[]; onPlaced(path: string, hung: boolean): void; onNotice(t: string): void }) {
  const req = useCaptureRequest()
  useEffect(() => window.cnMap.onOpen(() => openCapture()), [])
  if (!req) return null
  return <CaptureSheet key={req.seq} req={req} notes={props.notes} onPlaced={props.onPlaced} onNotice={props.onNotice} />
}

const CAM_ICON: Record<CameraKind, CodiconName> = { iphone: 'device-mobile', mac: 'vm', desk: 'lightbulb' }
const HINT: Record<CameraKind, string> = {
  iphone: '把iPhone横着举在导图正上方，四角都在框里。',
  mac: '把纸举到摄像头前，四角都在框里；字小的话离近一点。',
  desk: '用iPhone夹在屏幕上方，纸平放在键盘前面。',
}
const FROM_PILL: Record<Exclude<PhotoFrom, CameraKind>, string> = { file: '从照片选的', paste: '粘贴的照片', airdrop: '隔空投送来的', feynman: '费曼讲的' }

interface Photo {
  staged: StagedPhoto
  url: string
  from: PhotoFrom
  /** 高 / 宽 */
  aspect: number
  at: number
}

type Check =
  | { phase: 'reading' }
  | { phase: 'done' }
  | { phase: 'fail'; reason: 'not-map' | 'blurry'; message: string }
  | { phase: 'error'; message: string }

let reqSeq = 0

function CaptureSheet(props: { req: CaptureRequest; notes: NoteFile[]; onPlaced(path: string, hung: boolean): void; onNotice(t: string): void }) {
  const seed = props.req.seed
  const [step, setStep] = useState<'shoot' | 'check'>(seed ? 'check' : 'shoot')
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [flash, setFlash] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<Check>(seed ? { phase: 'done' } : { phase: 'reading' })
  const [rows, setRows] = useState<Row[]>(() => (seed ? toRows(seed.roots) : []))
  const [sel, setSel] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ course?: string; lecture?: number }>({})
  const cam = useCamera(step === 'shoot' && !photo && !seed)
  const reading = useRef<number | null>(null)
  const placed = useRef(false)
  const photoRef = useRef(photo)
  photoRef.current = photo

  const close = () => {
    if (reading.current !== null) void window.cnMap.stop(reading.current)
    closeCapture()
  }

  // 关掉窗口：没做成导图的照片丢掉；不再看「下载」
  useEffect(() => {
    if (seed) return
    void window.cnMap.watchAirdrop(true)
    const offA = window.cnMap.onAirdrop((p) => void usePhoto(p, 'airdrop', `收到隔空投送的照片「${p.name}」`))
    const offE = window.cnMap.onAirdropError(setNote)
    return () => {
      offA()
      offE()
      void window.cnMap.watchAirdrop(false)
      cam.stop()
      const p = photoRef.current
      if (p) {
        URL.revokeObjectURL(p.url)
        if (!placed.current) void window.cnMap.discard(p.staged.id)
      }
    }
  }, [])

  async function usePhoto(staged: StagedPhoto, from: PhotoFrom, msg?: string) {
    const url = URL.createObjectURL(new Blob([staged.bytes as BlobPart], { type: staged.mime }))
    const aspect = await new Promise<number>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.75)
      img.onerror = () => resolve(0.75)
      img.src = url
    })
    const old = photoRef.current
    if (old) {
      URL.revokeObjectURL(old.url)
      void window.cnMap.discard(old.staged.id)
    }
    setPhoto({ staged, url, from, aspect, at: Date.now() })
    setStep('shoot')
    setNote(msg ?? null)
  }

  async function stageBytes(bytes: Uint8Array, name: string, from: PhotoFrom) {
    setBusy(true)
    try {
      await usePhoto(await window.cnMap.stage(bytes, name), from)
    } catch (e) {
      setNote(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function snap() {
    if (cam.state.kind !== 'live' || busy) return
    setFlash((n) => n + 1)
    try {
      const bytes = await cam.snap()
      await stageBytes(bytes, `${CAMERA_LABEL[cam.want]}拍的.jpg`, cam.want)
    } catch (e) {
      setNote(errText(e))
    }
  }

  function reshoot() {
    const p = photoRef.current
    if (p) {
      URL.revokeObjectURL(p.url)
      void window.cnMap.discard(p.staged.id)
    }
    if (reading.current !== null) void window.cnMap.stop(reading.current)
    setPhoto(null)
    setNote(null)
    setStep('shoot')
  }

  async function recognize(p: Photo) {
    setStep('check')
    setCheck({ phase: 'reading' })
    setRows([])
    setSel(null)
    const id = ++reqSeq
    reading.current = id
    try {
      const r = await window.cnMap.recognize(id, p.staged.id, props.req.course)
      if (reading.current !== id) return
      if (!r.ok) return setCheck({ phase: 'fail', reason: r.reason, message: r.message })
      const rs = toRows(r.roots)
      setRows(rs)
      setMeta({ course: props.req.course ?? r.course, lecture: r.lecture })
      setCheck({ phase: 'done' })
      setSel(rs.find((x) => x.unsure)?.key ?? null)
    } catch (e) {
      if (reading.current !== id) return
      if ((e as Error).name === 'AbortError' || /停下了/.test(errText(e))) return setCheck({ phase: 'error', message: '停下了。再认一次，或者重拍。' })
      setCheck({ phase: 'error', message: errText(e) })
    } finally {
      if (reading.current === id) reading.current = null
    }
  }

  async function place() {
    const p = photoRef.current
    const roots = fromRows(rows)
    if ((!p && !seed) || !roots.length || busy) return
    setBusy(true)
    try {
      const course = props.req.course ?? meta.course
      const r = await window.cnMap.place(
        seed || !p
          ? { title: seed!.title, ...(props.req.into ? { into: props.req.into } : {}), from: 'feynman', roots, course, ai: [], at: Date.now() }
          : {
              photo: p.staged.id,
              ...(props.req.into ? { into: props.req.into } : {}),
              from: p.from,
              roots,
              course,
              lecture: meta.lecture,
              // 从课程首页进来的课程是用户自己选的，不算 AI 填的
              ai: [...(course && !props.req.course ? ['课程'] : []), ...(meta.lecture ? ['第几讲'] : [])],
              at: p.at,
            },
      )
      placed.current = true
      markGrow(r.path)
      // 挂到白板、笔记上：插好卡 / 缩略图块、三样一起提交（照片已经用掉了，出错也关窗口，底栏说清楚）
      try {
        await props.req.onPlaced?.(r)
      } catch (e) {
        props.onNotice(errText(e))
      }
      props.onPlaced(r.path, !!props.req.into)
      closeCapture()
    } catch (e) {
      setNote(errText(e))
      setBusy(false)
    }
  }

  // 空格拍、esc 关（认的时候 esc 是停下）；⌘V 粘贴照片
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t?.closest('input, textarea, [contenteditable="true"]')
      if (e.key === 'Escape') {
        e.preventDefault()
        if (step === 'check' && check.phase === 'reading' && reading.current !== null) void window.cnMap.stop(reading.current)
        else close()
      } else if (e.key === ' ' && !typing && step === 'shoot' && !photoRef.current) {
        e.preventDefault()
        void snap()
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/') || /\.hei[cf]$/i.test(x.name))
      if (!f) return
      e.preventDefault()
      void f.arrayBuffer().then((b) => stageBytes(new Uint8Array(b), f.name || '粘贴的照片', 'paste'))
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('paste', onPaste)
    }
  })

  const [dragOver, setDragOver] = useState(false)
  const dropHandlers = {
    onDragOver(e: React.DragEvent) {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    },
    onDragLeave(e: React.DragEvent) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
    },
    onDrop(e: React.DragEvent) {
      setDragOver(false)
      const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/') || /\.hei[cf]$/i.test(x.name))
      if (!f) return
      e.preventDefault()
      void f.arrayBuffer().then((b) => stageBytes(new Uint8Array(b), f.name, 'file'))
    },
  }

  const counts = { all: rows.filter((r) => r.text.trim()).length, unsure: rows.filter((r) => r.unsure).length }

  return (
    <div className="mm-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      {step === 'shoot' ? (
        <div className={'mm-sheet shoot' + (dragOver ? ' dragover' : '')} role="dialog" aria-label="拍一张导图" {...dropHandlers}>
          <Head title="拍一张导图" at={1} onClose={close} />
          <div className="mm-shoot">
            <div className="seg mm-cams" role="tablist" aria-label="用哪个摄像头">
              {(['iphone', 'mac', 'desk'] as CameraKind[]).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={cam.want === k && !photo}
                  className={(cam.want === k && !photo ? 'on' : '') + (k === 'desk' && cam.listed && !cam.has.desk ? ' off' : '')}
                  title={k === 'desk' && cam.listed && !cam.has.desk ? '这台 Mac 用不了桌上视角，点开看为什么' : undefined}
                  onClick={() => {
                    if (photo) reshoot()
                    cam.choose(k)
                  }}
                >
                  <Codicon name={CAM_ICON[k]} size={14} />
                  {CAMERA_LABEL[k]}
                </button>
              ))}
            </div>
            <div className="mm-vf" data-testid="viewfinder">
              {photo ? (
                <img src={photo.url} alt="拍好的照片" />
              ) : (
                <video ref={cam.video} muted playsInline hidden={cam.state.kind !== 'live'} />
              )}
              {!photo && cam.state.kind === 'live' && (
                <>
                  <span className="corner tl" />
                  <span className="corner tr" />
                  <span className="corner bl" />
                  <span className="corner br" />
                </>
              )}
              {(photo || cam.state.kind === 'live') && (
                <span className="live">
                  {photo ? (photo.from in FROM_PILL ? FROM_PILL[photo.from as keyof typeof FROM_PILL] : '拍好了') : (
                    <>
                      <i />
                      实时 · {CAMERA_LABEL[cam.want]}
                    </>
                  )}
                </span>
              )}
              {!photo && <CamNote kind={cam.want} state={cam.state} listed={cam.listed} onIphone={() => cam.choose('iphone')} />}
              <div key={flash} className={'flashw' + (flash ? ' go' : '')} />
              {dragOver && <div className="mm-dropzone">松手就用这张</div>}
            </div>
            <p className="mm-hint" role="status">
              {note ?? (photo ? '字看得清就用这张；糊了、反光就重拍。' : cam.state.kind === 'live' || cam.state.kind === 'loading' ? HINT[cam.want] : '')}
            </p>
          </div>
          <div className="mm-ft">
            <button
              className="btn btn-ghost mm-pick"
              onClick={async () => {
                try {
                  const p = await window.cnMap.pick()
                  if (p) await usePhoto(p, 'file')
                } catch (e) {
                  setNote(errText(e))
                }
              }}
            >
              <Codicon name="file-media" size={14} />
              从照片选…
            </button>
            <span className="help">{`也能拖进来、${keyFor('paste')} 粘贴、隔空投送`}</span>
            {photo ? (
              <>
                <button className="btn" onClick={reshoot}>
                  <Codicon name="discard" size={14} />
                  重拍
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={() => void recognize(photo)}>
                  <Codicon name="check" size={14} />
                  用这张
                </button>
              </>
            ) : (
              <button className="btn btn-primary" disabled={cam.state.kind !== 'live' || busy} onClick={() => void snap()}>
                <Codicon name="device-camera" size={14} />拍
                <span className="kbd-in">空格</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={'mm-sheet checking' + (seed ? ' seeded' : '')} role="dialog" aria-label={seed ? '核对要放的导图' : '核对认出来的'}>
          <Head title={seed ? '核对要放的导图' : '核对认出来的'} at={2} first={seed?.step1} onClose={close} />
          <div className="mm-check">
            {photo && <PhotoBoxes photo={photo} rows={rows} sel={sel} scanning={check.phase === 'reading'} onPick={setSel} />}
            <div className="mm-outline">
              {check.phase === 'reading' && (
                <div className="mm-reading" role="status">
                  <span className="pd" />
                  正在认这张导图 · 一般要10到30秒
                  <button className="btn btn-ghost btn-sm" onClick={() => reading.current !== null && void window.cnMap.stop(reading.current)}>
                    停下<span className="kbd-in">esc</span>
                  </button>
                </div>
              )}
              {(check.phase === 'fail' || check.phase === 'error') && (
                <div className="mm-fail" role="alert">
                  <b>{check.phase === 'fail' ? check.message : '没认成'}</b>
                  {check.phase === 'fail' ? (
                    <p>{check.reason === 'blurry' ? '重拍一张？离近一点、别反光。' : '换一张导图的照片再试，或者再认一次。'}</p>
                  ) : (
                    <AiError raw={check.message} engine={{ id: 'claude', label: 'Claude Code' }} />
                  )}
                  <div>
                    <button className="btn btn-sm" onClick={() => photo && void recognize(photo)}>
                      再认一次
                    </button>
                    <button className="btn btn-sm" onClick={reshoot}>
                      <Codicon name="discard" size={12} />
                      重拍
                    </button>
                  </div>
                </div>
              )}
              {check.phase === 'done' && <Outline rows={rows} sel={sel} photo={!!photo} onSel={setSel} onRows={setRows} />}
            </div>
          </div>
          <div className="mm-ft">
            <span className="help" role="status">
              {note ??
                (seed ? (
                  `${seed.said} · ${counts.all}个节点 · 放上白板后也能改`
                ) : check.phase === 'done' ? (
                  <>
                    {`认出${counts.all}个节点`}
                    {counts.unsure ? (
                      <>
                        ，<b className="yel">{`${counts.unsure}个拿不准`}</b>
                      </>
                    ) : (
                      '，都核对过了'
                    )}{' '}
                    · 放上白板后也能改
                  </>
                ) : check.phase === 'reading' ? (
                  '认好以前可以先看着照片想想有没有漏的'
                ) : (
                  ''
                ))}
            </span>
            {seed ? (
              <button className="btn" onClick={close}>
                算了
              </button>
            ) : (
              <button className="btn" onClick={reshoot}>
                <Codicon name="discard" size={14} />
                重拍
              </button>
            )}
            <button className="btn btn-primary" disabled={check.phase !== 'done' || !counts.all || busy} onClick={() => void place()}>
              <Codicon name="type-hierarchy" size={14} />
              做成白板导图
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Head(props: { title: string; at: 1 | 2; first?: string; onClose(): void }) {
  const step = (n: 1 | 2 | 3, label: string) => {
    const cls = n < props.at ? 'done' : n === props.at ? 'now' : ''
    return (
      <span className={cls} aria-current={n === props.at ? 'step' : undefined}>
        <i>{n < props.at ? <Codicon name="check" size={11} /> : n}</i>
        {label}
      </span>
    )
  }
  return (
    <div className="mm-hd">
      <h3>{props.title}</h3>
      <div className="mm-steps" aria-label="三步">
        {step(1, props.first ?? '拍')}·{step(2, '核对')}·{step(3, '放上白板')}
      </div>
      <span className="sp" />
      <button className="iconbtn" aria-label="关闭" onClick={props.onClose}>
        <Codicon name="close" size={16} />
      </button>
    </div>
  )
}

/** 取景框里的说明：iPhone 没连上、没给权限、这台 Mac 用不了桌上视角 */
function CamNote(props: { kind: CameraKind; state: ReturnType<typeof useCamera>['state']; listed: boolean; onIphone(): void }) {
  const { state, kind } = props
  if (state.kind === 'live') return null
  if (state.kind === 'denied')
    return (
      <div className="note">
        还没允许用摄像头
        <small>在系统设置的「隐私与安全性 › 摄像头」里打开Canvas Notes，再回来。</small>
        <button className="btn btn-sm" onClick={() => void window.cnMap.cameraSettings()}>
          去系统设置允许
        </button>
      </div>
    )
  if (state.kind === 'error')
    return (
      <div className="note">
        摄像头打不开
        <small>{state.message}</small>
      </div>
    )
  if (state.kind === 'loading' || !props.listed) return <div className="note">正在打开摄像头…</div>
  if (kind === 'iphone')
    return (
      <div className="note">
        iPhone没连上
        <small>
          解锁iPhone，和这台Mac登同一个Apple账户，
          <br />
          开蓝牙和Wi‑Fi
        </small>
      </div>
    )
  if (kind === 'desk')
    return (
      <div className="note" data-testid="desk-unsupported">
        这台Mac用不了桌上视角
        <small>Mac自带的摄像头没有桌上视角；iPhone连着时系统有桌上视角，但这个软件读不到那一路画面。把iPhone横着举在纸的正上方，用「iPhone」拍，效果一样。</small>
        <button className="btn btn-sm" onClick={props.onIphone}>
          <Codicon name="device-mobile" size={12} />
          用iPhone拍
        </button>
      </div>
    )
  return (
    <div className="note">
      没找到Mac摄像头
      <small>外接的摄像头插好再试一次。</small>
    </div>
  )
}

/** 左边的照片：每个认出的节点一个框，拿不准的黄框；点大纲里一行，这一块加粗、别处压暗 */
function PhotoBoxes(props: { photo: Photo; rows: Row[]; sel: string | null; scanning: boolean; onPick(k: string): void }) {
  const maxW = 470
  const maxH = 480
  let w = maxW
  let h = w * props.photo.aspect
  if (h > maxH) {
    h = maxH
    w = h / props.photo.aspect
  }
  return (
    <div className="mm-photo" style={{ width: w, height: h }} data-testid="check-photo">
      <img src={props.photo.url} alt="拍的导图" draggable={false} />
      {props.rows.map((r) =>
        r.box ? (
          <span
            key={r.key}
            className={'bx' + (r.unsure ? ' unsure' : '') + (props.sel === r.key ? ' on' : '')}
            style={{ left: r.box[0] * w - 3, top: r.box[1] * h - 3, width: r.box[2] * w + 6, height: r.box[3] * h + 6 }}
            title={r.text}
            onClick={() => props.onPick(r.key)}
          />
        ) : null,
      )}
      {props.scanning && <div className="scan" />}
    </div>
  )
}

/** 右边的大纲：直接改字；Tab / ⇧Tab 改层级；回车加一行同级；空着按退格删这行 */
function Outline(props: { rows: Row[]; sel: string | null; photo: boolean; onSel(k: string): void; onRows(r: Row[]): void }) {
  const { rows } = props
  const box = useRef<HTMLDivElement>(null)
  const focusKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!focusKey.current) return
    box.current?.querySelector<HTMLInputElement>(`input[data-key="${focusKey.current}"]`)?.focus()
    focusKey.current = null
  })
  // 一打开就落在第一个拿不准的那行
  useEffect(() => {
    if (props.sel) box.current?.querySelector<HTMLInputElement>(`input[data-key="${props.sel}"]`)?.focus()
  }, [])
  const set = (i: number, patch: Partial<Row>) => props.onRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="mm-rows" ref={box} aria-label="大纲">
      <p className="mm-tip">{props.photo ? '大纲：点一行，左边照片框出这一块；直接改字，Tab缩进' : '大纲：直接改字，Tab缩进；放上白板后讲错的标红，空框点开自己补一句'}</p>
      {rows.map((r, i) => {
        const level = r.depth === 0 ? 'c' : r.depth === 1 ? 'l1' : 'l2'
        return (
          <div key={r.key} className={`or ${level}${r.unsure ? ' unsure' : ''}${r.wrong || r.fix || r.blank ? ' marked' : ''}${props.sel === r.key ? ' sel' : ''}`} style={{ paddingLeft: 4 + r.depth * 18 }}>
            <span className="bul" />
            <input
              data-key={r.key}
              aria-label={`第 ${r.depth + 1} 层节点`}
              value={r.text}
              onFocus={() => props.onSel(r.key)}
              onChange={(e) => set(i, { text: e.target.value, unsure: undefined, guesses: undefined })}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Tab') {
                  e.preventDefault()
                  focusKey.current = r.key
                  props.onRows(indentRows(rows, i, e.shiftKey ? -1 : 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  const n: Row = { key: rowKey(), depth: Math.max(1, r.depth), text: '' }
                  // 加在这一行（连同它的子行）后面
                  let end = i + 1
                  while (end < rows.length && rows[end]!.depth > r.depth) end++
                  focusKey.current = n.key
                  props.onRows([...rows.slice(0, end), n, ...rows.slice(end)])
                } else if (e.key === 'Backspace' && r.text === '' && rows.length > 1) {
                  e.preventDefault()
                  focusKey.current = rows[i - 1]?.key ?? rows[i + 1]?.key ?? null
                  props.onRows(rows.filter((_, j) => j !== i))
                } else if (e.key === 'ArrowDown' && rows[i + 1]) {
                  e.preventDefault()
                  focusKey.current = rows[i + 1]!.key
                  props.onRows([...rows])
                } else if (e.key === 'ArrowUp' && rows[i - 1]) {
                  e.preventDefault()
                  focusKey.current = rows[i - 1]!.key
                  props.onRows([...rows])
                }
              }}
            />
            {r.unsure && <span className="tag-yel">拿不准</span>}
            {r.wrong && <span className="tag-red">讲错</span>}
            {r.fix && <span className="tag-red">正确说法</span>}
            {r.blank && <span className="tag-blank">后面留空框</span>}
          </div>
        )
      })}
    </div>
  )
}
