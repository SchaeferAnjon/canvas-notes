/**
 * 读 PDF 时右栏下格的 AI（方向 A：和「笔记」用竖条切换）。spec 1.3 发出去前的预览、1.5 AI 右栏。
 * 框好的那块在输入框里等着，预填「给我讲解一下」并全选（直接打字就换掉），回车就发；
 * 回答下面「还是不懂」「换个方式讲」，再下面一行后台记笔记的进度。
 */
import { when } from '../../shared/when'
import { Codicon } from '@cn/design'
import { onMessageMenu } from '../ctx/message-menu'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EngineId, EngineInfo } from '../../shared/agent'
import { askedUpTo, type ReadingMsg, withoutVizMark } from '../../shared/reading'
import { Markdown } from '../md-render'
import { AiError } from '../ai-error'
import { PastedThumbs, pastedUrl, usePastedImages } from '../paste-images'
import { EngineLogo } from '../engine-logo'
import { fmtTime } from '../../shared/video'
import * as R from './store'

/** 待问那块的小标签：PDF 第几页；网页、HTML；视频「接着问」是「00:06 · 视频名」 */
function pendingLabel(p: R.Pending): string {
  if (!p.web) return `第${p.page}页`
  if (p.web.t !== undefined) return `${fmtTime(p.web.t)} · ${p.web.title}`
  return /^https?:/i.test(p.web.url) ? '网页' : 'HTML'
}

/** 只贴了图、没打字就发时问的话 */
const PASTE_ONLY = '这张图讲的是什么'

const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const stamp = (t: number) => when(t, { time: true })

export function ReadingAi(props: { pdf: string; hidden: boolean; onShowNote(id: string): void; onOpenHtml(path: string): void; onNotice(text: string): void; onCollapse(): void }) {
  const { pdf } = props
  const r = R.useReading(pdf)!
  const asked = R.isWebSrc(pdf) || /\.html?$/i.test(pdf) ? 0 : askedUpTo(r.state.threads)
  const [engines, setEngines] = useState<EngineInfo[]>([])
  const [engine, setEngine] = useState<EngineId>('claude')
  const [menu, setMenu] = useState(false)
  const [input, setInput] = useState('')
  const [flashMsg, setFlashMsg] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const paste = usePastedImages(props.onNotice)
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? 'Claude Code'

  // 头上的引擎 = 设置 › AI 里「AI 对话」那一行；在设置里改了，开着的面板马上跟着换
  useEffect(() => {
    const load = () =>
      void window.cn.aiEngines().then((x) => {
        setEngines(x.engines)
        setEngine(x.current)
        R.setEngine(x.current, x.label)
      })
    load()
    return window.cn.onAiPrefsChanged(load)
  }, [])

  // 框好一块（还没点工具条上的按钮）：输入框预填「给我讲解一下」并全选，焦点进来好回车就发；
  // 输入框里已经有自己打的字就不动它，框的这块当附件挂上（光标放到最后）；
  // 改问法：输入框空着、光标在里面；马上就发的（工具条按钮、问这一页、⌘↵）不预填（CN-23）
  const pendingKey = r.pending ? `${r.pending.page}:${r.pending.rect?.join(',') ?? ''}:${r.pending.quote ?? ''}:${r.pending.blank ? 1 : 0}` : ''
  const selectNext = useRef(false)
  const prefilled = useRef('')
  const inputNow = useRef(input)
  inputNow.current = input
  useEffect(() => {
    if (!r.pending || r.pending.direct) return
    const own = inputNow.current.trim() && inputNow.current !== prefilled.current
    if (own) {
      prefilled.current = ''
      requestAnimationFrame(() => {
        const t = box.current
        if (!t) return
        t.focus()
        t.setSelectionRange(t.value.length, t.value.length)
      })
      return
    }
    selectNext.current = true
    prefilled.current = r.pending.blank ? '' : '给我讲解一下'
    setInput(prefilled.current)
  }, [pendingKey])
  // 不管从哪里发出去（回车、工具条、问这一页、⌘↵）：预填的字清掉；自己打的、还没发的字留着
  const sentSeen = useRef(r.sent)
  useEffect(() => {
    if (sentSeen.current === r.sent) return
    sentSeen.current = r.sent
    const pre = prefilled.current
    prefilled.current = ''
    setInput((v) => (v === pre ? '' : v))
  }, [r.sent])
  // 排着的那几问不发了（停下、不发了、换了一块）：它们的字和贴的图回到输入框，光标放到最后。
  // 输入框里已经有自己打的字就接在后面、空一行（第 3 轮：点停下把刚打的字换掉了）
  useEffect(() => {
    const back = r.restore
    if (!back) return
    const pre = prefilled.current
    prefilled.current = ''
    setInput((v) => (v.trim() && v !== pre ? `${v.replace(/\s+$/, '')}\n\n${back.text}` : back.text))
    paste.restore(back.pasted)
    requestAnimationFrame(() => {
      const t = box.current
      if (!t) return
      t.focus()
      t.setSelectionRange(t.value.length, t.value.length)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.restore?.seq])
  // 等预填的字真的写进输入框以后再全选（不然写字会把光标挪到最后）
  useLayoutEffect(() => {
    if (!selectNext.current || !box.current) return
    selectNext.current = false
    box.current.focus()
    box.current.select()
  }, [input, pendingKey])

  // ⌘J、圆钮打开的：光标进输入框，直接打字问
  useEffect(() => {
    if (!props.hidden && R.takeAiFocus()) box.current?.focus()
  }, [props.hidden])

  // 新消息、边生成边显示：滚到底
  const lastLen = r.state.msgs.length ? r.state.msgs[r.state.msgs.length - 1]!.text.length : 0
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [r.state.msgs.length, lastLen, props.hidden])

  // 从笔记点「完整对话」：滚到那次对话，外圈亮一下
  useEffect(() => {
    const c = r.convo
    if (!c || props.hidden) return
    const el = list.current?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(c.id)}"]`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setFlashMsg(c.id)
    const t = setTimeout(() => setFlashMsg(null), 2000)
    return () => clearTimeout(t)
  }, [r.convo?.seq, props.hidden])

  /** page：⌘↵ 在答的时候排上的，发出时带上这一页 */
  function send(page?: number) {
    // 只贴了图没打字：默认问这张图讲的是什么（CN-24）
    const text = input.trim() || (paste.list.length ? PASTE_ONLY : '')
    // 还在答上一问：和点浮条「讲解一下」一样排在后面，答完依次发（store.send 排队）
    if (!text) return
    setInput('')
    const pasted = paste.list.map((x) => x.name)
    paste.clear()
    void R.send(pdf, text, pasted, page ? { page } : {})
  }

  /** ⌘↵：输入框里有自己打的问题就发这句（框了一块带那块，没框带上这一页）；空着或只有预填的字，交给 PDF 标签「问这一页」 */
  function cmdEnter(e: React.KeyboardEvent) {
    const own = input.trim() && input !== prefilled.current
    if (!own || R.isWebSrc(pdf)) return
    e.preventDefault()
    e.stopPropagation()
    // 框了一块：带那块发（还在答就排在后面）
    if (r.pending) return send()
    // 还在答、没框：排在后面，发出时带上这一页（和不在答时的 ⌘↵ 一样，第 3 轮：排着发出去时没带这一页）
    if (r.running !== null) return send(r.state.page || 1)
    const text = input.trim()
    setInput('')
    window.dispatchEvent(new CustomEvent(R.ASK_PAGE, { detail: { src: pdf, text } }))
  }

  /** 头上的引擎菜单改的是「AI 对话」用哪家（= 设置 › AI 里那一行），不动默认、不影响梦游这些 */
  function pick(e: EngineInfo) {
    if (!e.path) return
    setEngine(e.id)
    R.setEngine(e.id)
    setMenu(false)
    // 换了家：模型名字从主进程再要一次（设置 › AI 里这家选的模型）
    void window.cn.aiSetEngine(e.id).then(() => window.cn.aiEngines().then((x) => R.setEngine(x.current, x.label)))
  }

  const running = r.running !== null
  const msgs = r.state.msgs
  const lastAi = [...msgs].reverse().find((m) => m.role === 'ai')
  const sectionCount = r.note.sections.length

  return (
    <aside className="right reading-ai ai" aria-label="边读边问 AI" hidden={props.hidden}>
      <div className="aih">
        <b>AI</b>
        <div className="aieng">
          <button className="engbtn" aria-label="选 AI 引擎" aria-haspopup="menu" aria-expanded={menu} data-tip={engineLabel} data-side="below" onClick={() => setMenu((v) => !v)}>
            <EngineLogo id={engine} />
            <span className="nm">{engineLabel}</span>
            <Codicon name="chevron-down" size={12} />
          </button>
          {menu && (
            <div className="engmenu" role="menu" aria-label="AI 引擎">
              <div className="mh">用这台Mac上已经登录的</div>
              {engines.map((e) => (
                <button key={e.id} role="menuitemradio" aria-checked={e.id === engine} disabled={!e.path} title={e.hint ?? e.path ?? ''} onClick={() => pick(e)}>
                  <span className="ck">{e.id === engine && <Codicon name="check" size={12} />}</span>
                  <EngineLogo id={e.id} />
                  <b>{e.label}</b>
                  <span>{e.path ? '' : '没装'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 头里放不下整句（右栏 340 宽、引擎胶囊带标志）就换成短的「改动可撤回」，悬停看全句 */}
        <span className="meta" data-testid="ai-undo-hint" data-tip="AI的改动都是Git提交，随时可撤回" data-side="below">
          <span className="long">改动都是提交，可撤回</span>
          <span className="short">改动可撤回</span>
        </span>
        <span className="sp" />
        <button className="iconbtn" aria-label="新对话" title="新对话：AI 从头读这份 PDF，问过的和笔记都留着" onClick={() => void R.newChat(pdf)} disabled={running}>
          <Codicon name="add" size={14} />
        </button>
        {/* AI 开着时右下角的圆钮藏起来，从这里收起（CN-22） */}
        <button className="ai-collapse" aria-label="收起 AI" data-tip="收起AI" data-key="⌘J" data-side="below" onClick={props.onCollapse}>
          <Codicon name="close" size={14} className="ic" />
          <span className="lb">收起</span> <kbd>⌘J</kbd>
        </button>
      </div>
      <div className="sees" data-testid="reading-sees">
        <span className="k">看得到</span>
        {R.isWebSrc(pdf) ? (
          <span className="chip">
            <i className="dot" />
            网页 · {[...r.state.threads].reverse().find((t) => t.web)?.web?.title ?? r.pending?.web?.title ?? pdf.slice(4)}
          </span>
        ) : /\.html?$/i.test(pdf) ? (
          <span className="chip">
            <i className="dot" />
            {stemOf(pdf)}.html
          </span>
        ) : (
          <span className="chip">
            <i className="dot" />
            {`${stemOf(pdf)}.pdf · 第${r.state.page}页`}
          </span>
        )}
        {!R.isWebSrc(pdf) && r.pending?.web && /^https?:/i.test(r.pending.web.url) && (
          <span className="chip">
            <i className="dot" />
            网页 · {r.pending.web.title}
          </span>
        )}
        {r.pages > 0 &&
          (r.readN < r.pages ? (
            <span className="chip">
              <Codicon name="loading" size={12} className="spin" />
              <span className="num">{`正在读全文${r.readN}/${r.pages}`}</span>
            </span>
          ) : (
            <span className="chip">
              <Codicon name="check" size={12} className="ok" />
              <span className="num">{`读过全文${r.pages}页`}</span>
            </span>
          ))}
        <span className="chip">
          <span className="num">{`笔记${sectionCount}段`}</span>
        </span>
        {/* 问到哪：标签条右端只留页码（DESIGN.v3 1.4），问到第几页写在这里 */}
        {asked > 0 && (
          <span className="chip" data-testid="pdf-progress" title="问过的最大页码">
            <span className="num">{`问到第${asked}页`}</span>
          </span>
        )}
      </div>
      <div
        className="msgs"
        ref={list}
        onClick={(e) => {
          const a = (e.target as Element).closest<HTMLElement>('a.pg[data-page]')
          if (a) R.jumpTo(pdf, Number(a.dataset.page))
        }}
      >
        {msgs.length === 0 && (
          <div className="ai-empty">
            <h2>框一块就能问</h2>
            <p>
              {R.isWebSrc(pdf)
                ? '在上面的网页里按住 ⌘ 拖一个框，回车就发。问过的AI在后台记进中间开着的文档，没开就进收件箱。'
                : /\.html?$/i.test(pdf)
                  ? '点「框一块问」在左边拖一个框，回车就发；⌘↵ 问这一屏。问过的AI在后台记进笔记，不用你整理。'
                  : '在左边PDF上拖一个框，回车就发；⌘↵ 问整页。问过的AI在后台记进笔记，不用你整理。'}
            </p>
          </div>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const startsThread = m.role === 'user' && (!prev || prev.thread !== m.thread || (prev.role === 'ai' && m.time - prev.time > 10 * 60_000))
          const isNew = r.state.newChatAt && m.time >= r.state.newChatAt && (!prev || prev.time < r.state.newChatAt)
          return (
            <Msg
              key={m.id}
              m={m}
              sep={isNew ? `新对话 · ${stamp(r.state.newChatAt!)}` : startsThread ? `${Date.now() - m.time < 10 * 60_000 ? '现在' : stamp(m.time)}${m.page ? ` · 第${m.page}页` : ''}` : null}
              flash={flashMsg === m.thread && startsThread}
              last={m === lastAi && !running}
              running={running && m.id === r.running}
              quote={startsThread ? r.state.threads.find((t) => t.id === m.thread)?.quote : undefined}
              onAgain={(t) => {
                setInput('')
                void R.send(pdf, t)
              }}
              onRephrase={(t) => {
                setInput(t)
                requestAnimationFrame(() => box.current?.focus())
              }}
              ask={m.role === 'ai' && prev?.role === 'user' ? prev.text : undefined}
              busy={running}
              engine={{ id: m.engine ?? engine, label: engines.find((e) => e.id === (m.engine ?? engine))?.label }}
              onShowNote={() => props.onShowNote(m.thread)}
              onViz={() => void R.makeViz(pdf, m.id)}
              onOpenHtml={props.onOpenHtml}
            />
          )
        })}
      </div>
      <div className={'aiin reading-in' + (r.pending || r.queued.length || paste.list.length || paste.dragging ? ' hot' : '')} {...paste.dropProps}>
        {(r.pending || paste.list.length > 0) && (
          <div className="atts">
            {!r.pending ? null : r.pending.quote ? (
              <div className={'attq' + (r.pending.web?.t !== undefined ? ' two' : '')}>
                {/* 视频「接着问」：那一帧也附给 AI，这里看得到 */}
                {r.pending.image && r.pending.web?.t !== undefined && <img className="frame" src={vaultImg(r.pending.image)} alt={`${fmtTime(r.pending.web.t)} 这一帧`} />}
                <span className="col">
                  <span className="lb">{pendingLabel(r.pending)}</span>
                  <span className="q">「{r.pending.quote}」</span>
                </span>
                <button className="rm" aria-label="不要这段了" onClick={() => R.unstage(pdf, true)}>
                  <Codicon name="close" size={10} />
                </button>
              </div>
            ) : r.pending ? (
              <div className="attc" data-testid="reading-att">
                {r.pending.url ? <img src={r.pending.url} alt={r.pending.page ? `第 ${r.pending.page} 页框的那块` : '框的那块'} /> : <span className="attwait" />}
                <span className="lb">{pendingLabel(r.pending)}</span>
                <button className="rm" aria-label="不要这块了" onClick={() => R.unstage(pdf, true)}>
                  <Codicon name="close" size={10} />
                </button>
              </div>
            ) : null}
            <PastedThumbs list={paste.list} onRemove={paste.remove} />
          </div>
        )}
        {/* 排着的几问自己占一整块（在附图下面、输入框上面），附图再多也不挤它（第 3 轮美学） */}
        {r.queued.length > 0 && (
          <span className="queue">
            {r.queued.map((q, i) => (
              <span key={i} className="queued" role="status" data-testid="reading-queued" title={q.text}>
                <Codicon name="history" size={12} />
                <span className="truncate">
                  {i === 0 ? '答完上一问自动发出' : '再接着发'}
                  {q.page ? `（带第${q.page}页）` : ''}：{q.text}
                </span>
                <button className="lnk" onClick={() => R.cancelQueued(pdf, i)}>
                  不发了
                </button>
              </span>
            ))}
          </span>
        )}
        <div className="crow">
          <textarea
            ref={box}
            rows={2}
            aria-label="问 AI"
            placeholder={r.pending?.web?.t !== undefined ? `接着问${fmtTime(r.pending.web.t)}这一帧…` : `跟${engineLabel}说，${R.isWebSrc(pdf) ? '在网页上按住 ⌘ 框一块' : '在左边框一块'}就能问`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={paste.onPaste}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
                e.preventDefault()
                send()
              } else if (e.key === 'Enter' && e.metaKey) cmdEnter(e)
              else if (e.key === 'Escape') {
                e.preventDefault()
                R.unstage(pdf)
                setInput('')
                box.current?.blur()
              }
            }}
          />
          {running ? (
            <button className="send" aria-label="停下" onClick={() => R.stop(pdf)}>
              <Codicon name="primitive-square" size={12} />
            </button>
          ) : (
            <button className="send" aria-label="发送" disabled={!input.trim() && !paste.list.length} onClick={() => send()}>
              <Codicon name="arrow-up" size={14} />
            </button>
          )}
        </div>
        <div className="chint">
          <span>↵ 发送</span>
          <span>⇧↵ 换行</span>
          {!R.isWebSrc(pdf) && <span>{/\.html?$/i.test(pdf) ? '⌘↵ 问这一屏' : '⌘↵ 问这一页'}</span>}
        </div>
      </div>
    </aside>
  )
}

function Msg(p: {
  m: ReadingMsg
  sep: string | null
  flash: boolean
  last: boolean
  running: boolean
  quote?: string
  onAgain(text: string): void
  onRephrase(text: string): void
  /** 这条回答问的是什么（出错时「再问一次」「换个问法」用） */
  ask?: string
  busy: boolean
  engine: { id: string; label?: string }
  onShowNote(): void
  onViz(): void
  onOpenHtml(path: string): void
}) {
  const { m } = p
  return (
    <>
      {p.sep && <div className="daysep">{p.sep}</div>}
      {m.role === 'user' ? (
        <div className={'um-wrap' + (p.flash ? ' flash' : '')} data-thread={p.sep ? m.thread : undefined}>
          {m.image && (
            <div className="att">
              <img src={vaultImg(m.image)} alt={m.page ? `第 ${m.page} 页框的那块` : '框的那块'} />
            </div>
          )}
          {m.pasted?.map((n) => (
            <div key={n} className="att">
              <img src={pastedUrl(n)} alt="粘贴的图" />
            </div>
          ))}
          {p.quote && <div className="uq">「{p.quote}」</div>}
          <div className="um" onContextMenu={(e) => onMessageMenu(e, m.text)}>
            {m.text}
          </div>
        </div>
      ) : (
        <div className="am" data-testid="reading-msg" onContextMenu={(e) => m.text && onMessageMenu(e, withoutVizMark(m.text).text)}>
          {/* 出错的那条不写「✓ 读了第几页」：没答出来，下面红字说为什么 */}
          {m.text && !m.error && m.read && (
            <div className="read">
              <Codicon name="check" size={12} className="ok" />
              <span className="rd">{m.read}</span>
              {m.by && <span className="by"> · {m.by}</span>}
            </div>
          )}
          {!m.text && !m.error && <div className="thinking">正在想…</div>}
          {m.text && (
            <div className="txt md">
              <Markdown text={withoutVizMark(m.text).text} />
            </div>
          )}
          {m.error && <AiError raw={m.error} engine={p.engine} {...(p.ask && !p.busy ? { onRetry: () => p.onAgain(p.ask!), onRephrase: () => p.onRephrase(p.ask!) } : {})} />}
          {p.last && m.text && !m.error && (
            <div className="acts">
              <button className="btn btn-xs" onClick={() => p.onAgain('还是不懂')}>
                <Codicon name="question" size={12} />
                还是不懂
              </button>
              <button className="btn btn-xs" onClick={() => p.onAgain('换个方式讲')}>
                <Codicon name="discard" size={12} />
                换个方式讲
              </button>
              {m.vizOk && !m.viz && (
                <button className="btn btn-xs" onClick={p.onViz}>
                  <Codicon name="preview" size={12} />
                  做个可视化
                </button>
              )}
            </div>
          )}
          {m.note === 'writing' && (
            <div className="noted">
              <Codicon name="loading" size={12} className="spin" />
              正在记进笔记…
            </div>
          )}
          {m.note === 'done' && (
            <div className="noted">
              <Codicon name="check" size={12} />
              {m.noteTo ? (
                `已记进${m.noteTo}`
              ) : (
                <>
                  {'已记进笔记 · '}
                  <button className="lnk" onClick={p.onShowNote}>
                    {`第${m.page ?? ''}页`}
                    <Codicon name="chevron-right" size={12} />
                  </button>
                </>
              )}
            </div>
          )}
          {m.note === 'error' && <div className="noted err">没记进笔记：{m.noteError}</div>}
          {m.vizOk && !m.viz && !(p.last && m.text && !m.error) && (
            <div className="acts">
              <button className="btn btn-xs" onClick={p.onViz}>
                <Codicon name="preview" size={12} />
                做个可视化
              </button>
            </div>
          )}
          {m.viz?.state === 'making' && (
            <div className="vizpill" role="status">
              <Codicon name="loading" size={14} className="spin" />
              后台在做可视化 · 好了会挂进笔记，可以接着问
            </div>
          )}
          {m.viz?.state === 'done' && (
            <div className="vizpill done">
              <Codicon name="preview" size={14} />
              <span className="truncate">可视化做好了：{m.viz.path.split('/').pop()}</span>
              <button className="btn btn-xs btn-primary" onClick={() => p.onOpenHtml((m.viz as { path: string }).path)}>
                打开
              </button>
            </div>
          )}
          {m.viz?.state === 'error' && (
            <div className="noted err">
              没做成可视化：{m.viz.error}
              <button className="lnk" onClick={p.onViz}>
                再试一次
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
