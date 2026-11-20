/**
 * 中间栏打开库里的 HTML（做好的可视化、Claude Code 生成的网页，spec 1.11）：放在没有来源的沙箱 iframe 里跑，能拖能点，不联网、碰不到别的文件。
 * 工具栏：标题 + 「可视化 · 课程/线性代数 · 第 3 讲」+ 右端「在隔离环境里运行 · 不联网」、「框一块问」、「问这一屏」（⌘↵）。
 * 框一块问和 PDF 一样（spec 1.3）：点「框一块问」或按住 ⌘（焦点在软件里时）拖一个框，框下面黑色工具条，右栏 AI 输入框里放好截图。
 * 截图是窗口上画出来的那一块（主进程 capturePage），沙箱里的页面不用开口子。
 * dream：梦游分支上还没收下的那份（报告里「预览可视化」），只看不问。
 */
import { Codicon } from '@cn/design'
import { AiIcon } from '../engine-logo'
import { ActBtn, PageNote, TabActs } from '../shell/TabActs'
import type { Rect } from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import * as R from './store'
import type { Material } from '../../shared/materials'
import './reading.css'

const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const src = (p: string, host = 'vault') => `cn-file://${host}/` + p.split('/').map(encodeURIComponent).join('/')
const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function HtmlTab(props: { path: string; active: boolean; onAsk(): void; onNotice(t: string): void; dream?: boolean; by?: string }) {
  const { path } = props
  const [meta, setMeta] = useState<{ type?: string; lecture?: string; title?: string; by?: string }>({})
  const [seq, setSeq] = useState(0)
  const [more, setMore] = useState(false)
  /** 框选层开着（点了「框一块问」或按住 ⌘） */
  const [framing, setFraming] = useState(false)
  const [cmd, setCmd] = useState(false)
  const [drag, setDrag] = useState<Box | null>(null)
  const [boxed, setBoxed] = useState<Box | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const r = R.useReading(path)!
  const canAsk = !props.dream

  // 标题和属性从文件的 <title>、<meta name="类型"> 里读（主进程读字，不跑它的脚本）；字给 AI 看
  useEffect(() => {
    // 梦游分支上的那份：报告里那一条写着是哪家哪个模型做的（CN-54）
    if (props.dream) return setMeta({ type: `梦游做的可视化${props.by ? ` · ${props.by}` : ''} · 还没收下` })
    void R.load(path)
    void window.cnReading.htmlMeta(path).then(
      (m) => {
        setMeta({ type: m.props['类型'], lecture: m.props['第几讲'], title: m.title, ...(m.props['模型'] ? { by: m.props['模型'] } : {}) })
        const text = m.text
        R.update(path, () => ({ pages: 1, readN: 1, blocks: { 1: text ? [{ id: 'p1-b1', page: 1, kind: 'text', text, x: 0, y: 0, w: 1, h: 1 }] : [] } }))
      },
      () => setMeta({}),
    )
  }, [path, seq, props.dream, props.by])

  // 标签关了：排着的那一问不发、不记笔记（正在答的照常答完）
  useEffect(() => () => void (canAsk && R.closed(path)), [path, canAsk])

  // 发出去了：框收起来
  useEffect(() => {
    if (!r.pending) setBoxed(null)
  }, [r.pending])

  // 按住 ⌘：框选层打开（焦点在 iframe 里时软件收不到按键，用「框一块问」按钮）；esc 取消；⌘↵ 框着一块是改问法（同 PDF，CN-92 方向 A），没框问这一屏
  useEffect(() => {
    if (!props.active || !canAsk) return
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Meta') setCmd(true)
      else if (e.key === 'Escape' && (boxed || framing) && !(e.target as Element)?.closest?.('textarea')) cancel()
      else if (e.key === 'Enter' && e.metaKey && !e.isComposing) {
        e.preventDefault()
        if (boxed) void capAsk('rephrase')
        else void askScreen()
      }
    }
    const up = (e: KeyboardEvent) => e.key === 'Meta' && setCmd(false)
    const blur = () => setCmd(false)
    // 输入框里打了自己的问题再按 ⌘↵：带上这一屏问这句（ReadingAi 发来，带着输入框里的材料）
    const onAskPage = (e: Event) => {
      const d = (e as CustomEvent<{ src: string; text: string; mats?: Material[]; taken?: boolean }>).detail
      if (d.src !== path) return
      d.taken = true
      void askScreen(d.text, d.mats ?? [])
    }
    window.addEventListener(R.ASK_PAGE, onAskPage)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener(R.ASK_PAGE, onAskPage)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  })

  const frameRect = () => body.current?.getBoundingClientRect() ?? null

  function cancel() {
    setBoxed(null)
    setFraming(false)
    if (R.get(path).pending) R.unstage(path)
  }

  /** 截窗口上的一块（窗口坐标），放进右栏 AI 输入框；rect 是这一屏上的比例 */
  async function stageShot(x: number, y: number, w: number, h: number, rect?: Rect, direct = false) {
    props.onAsk()
    const png = await window.cnReading.capture(null, { x, y, w, h })
    const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }))
    R.stage(path, { page: 0, ...(rect ? { rect } : {}), url, png, web: { url: path, title: meta.title ?? stem(path) }, ...(direct ? { direct } : {}) })
  }

  function onDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const b = frameRect()!
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setBoxed(null)
    const x = e.clientX - b.left
    const y = e.clientY - b.top
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }
  function onMove(e: React.PointerEvent) {
    if (!drag) return
    const b = frameRect()!
    setDrag({ ...drag, x1: Math.min(Math.max(0, e.clientX - b.left), b.width), y1: Math.min(Math.max(0, e.clientY - b.top), b.height) })
  }
  async function onUp() {
    const d = drag
    setDrag(null)
    if (!d) return
    const b = frameRect()!
    const w = Math.abs(d.x1 - d.x0)
    const h = Math.abs(d.y1 - d.y0)
    if (w < 14 || h < 14) return
    setBoxed(d)
    setFraming(false)
    const x = Math.min(d.x0, d.x1)
    const y = Math.min(d.y0, d.y1)
    try {
      await stageShot(b.left + x, b.top + y, w, h, [x / b.width, y / b.height, w / b.width, h / b.height])
    } catch (err) {
      setBoxed(null)
      props.onNotice(errText(err))
    }
  }

  async function capAsk(kind: 'explain' | 'translate' | 'rephrase') {
    props.onAsk()
    const p = R.get(path).pending
    if (!p) return
    if (kind === 'rephrase') return R.stage(path, { ...p, blank: true })
    await R.send(path, kind === 'explain' ? '给我讲解一下' : '先把这块翻译成中文，再讲一讲')
  }

  /** 问这一屏：整个看得到的那屏当一个框，直接发出；mats：输入框里带的材料 */
  async function askScreen(text = '给我讲解一下这一屏', mats: Material[] = []) {
    const b = frameRect()
    if (!b || R.get(path).running !== null) return
    try {
      await stageShot(b.left, b.top, b.width, b.height, undefined, true)
      await R.send(path, text, [], mats.length ? { mats } : {})
    } catch (err) {
      props.onNotice(errText(err))
    }
  }

  const layer = canAsk && (framing || cmd || !!drag)
  const box = drag ?? boxed
  const bh = body.current?.clientHeight ?? 0
  return (
    <section className="pane htmlpane" hidden={!props.active} data-path={path}>
      <TabActs active={props.active}>
        <PageNote>
          {[meta.type ?? 'HTML', meta.lecture && `第${meta.lecture}讲`, meta.by].filter(Boolean).join(' · ')}
        </PageNote>
        <ActBtn icon="refresh" label="重新载入" onClick={() => setSeq((n) => n + 1)} />
        {canAsk && (
          <>
            <ActBtn icon="screen-full" label="框一块问" keys="按住 ⌘ 拖" on={framing} onClick={() => setFraming((v) => !v)} />
            <ActBtn icon="comment-discussion" ai="chat" label="问这一屏" keys="⌘↵" disabled={r.running !== null} onClick={() => void askScreen()} />
          </>
        )}
        <div className="pdfmore">
          <ActBtn icon="ellipsis" label="更多" aria-expanded={more} onClick={() => setMore((v) => !v)} />
          {more && (
            <div className="menu" role="menu" aria-label="更多" onMouseLeave={() => setMore(false)}>
              <div className="mnote">
                <Codicon name="lock" size={14} />
                在隔离环境里运行 · 不联网
              </div>
              <button role="menuitem" onClick={() => (void window.cnReading.reveal(path), setMore(false))}>
                <Codicon name="folder-opened" size={14} />
                在访达中显示
              </button>
            </div>
          )}
        </div>
      </TabActs>
      <div className="htmlbody" ref={body}>
        {props.active && <iframe key={seq} title={meta.title ?? stem(path)} src={src(path, props.dream ? 'dream' : 'vault')} sandbox="allow-scripts" data-testid="html-frame" />}
        <div className={'htmlframe' + (layer ? ' on' : '')} data-testid="html-frame-layer" onPointerDown={layer ? onDown : undefined} onPointerMove={onMove} onPointerUp={() => void onUp()}>
          {framing && !drag && <span className="hint">拖一个框问AI · esc 取消</span>}
          {box && (
            <div
              className={'fr ' + (drag ? 'drawing' : 'pending')}
              data-testid="html-box"
              style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
            />
          )}
          {boxed && !drag && (
            <div
              className="cap capbar"
              role="toolbar"
              aria-label="框好的这块"
              style={{ left: Math.min(boxed.x0, boxed.x1), top: Math.max(boxed.y0, boxed.y1) + 40 > bh ? Math.max(0, Math.min(boxed.y0, boxed.y1) - 40) : Math.max(boxed.y0, boxed.y1) + 8 }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button className="main" onClick={() => void capAsk('explain')}>
                <AiIcon job="chat" size={14} />
                讲解一下<kbd>↵</kbd>
              </button>
              <button onClick={() => void capAsk('translate')}>
                <Codicon name="whole-word" size={14} />
                翻译 + 讲一讲
              </button>
              <button onClick={() => void capAsk('rephrase')}>
                <Codicon name="edit" size={14} />
                改问法<kbd>⌘↵</kbd>
              </button>
              <span className="sepv" />
              <button aria-label="取消" data-tip="取消 esc" data-side="below" onClick={cancel}>
                <Codicon name="close" size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
