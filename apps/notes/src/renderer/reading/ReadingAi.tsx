/**
 * 读 PDF 时右栏下格的 AI（方向 A：和「笔记」用竖条切换）。spec 1.3 发出去前的预览、1.5 AI 右栏。
 * 框好的那块在输入框里等着，预填「给我讲解一下」并全选（直接打字就换掉），回车就发；
 * 回答下面「还是不懂」「换个方式讲」，再下面一行后台记笔记的进度。
 */
import { Codicon } from '@cn/design'
import { onMessageMenu } from '../ctx/message-menu'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EngineId, EngineInfo } from '../../shared/agent'
import { askedUpTo, type ReadingMsg, withoutVizMark } from '../../shared/reading'
import { Markdown } from '../md-render'
import { EngineLogo } from '../engine-logo'
import * as R from './store'

const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')
const pad = (n: number) => String(n).padStart(2, '0')
function stamp(t: number) {
  const d = new Date(t)
  const now = new Date()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}-${pad(d.getDate())} ${hm}`
}

export function ReadingAi(props: { pdf: string; hidden: boolean; onShowNote(id: string): void; onOpenHtml(path: string): void }) {
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
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? 'Claude Code'

  useEffect(() => {
    void window.cn.aiEngines().then((x) => {
      setEngines(x.engines)
      setEngine(x.current)
      R.setEngine(x.current)
    })
  }, [])

  // 框好一块：输入框预填「给我讲解一下」并全选，焦点进来好回车就发
  const pendingKey = r.pending ? `${r.pending.page}:${r.pending.rect?.join(',') ?? ''}:${r.pending.quote ?? ''}:${r.pending.blank ? 1 : 0}` : ''
  const selectNext = useRef(false)
  useEffect(() => {
    if (!r.pending) return
    selectNext.current = true
    setInput(r.pending.blank ? '' : '给我讲解一下')
  }, [pendingKey])
  // 等预填的字真的写进输入框以后再全选（不然写字会把光标挪到最后）
  useLayoutEffect(() => {
    if (!selectNext.current || !box.current) return
    selectNext.current = false
    box.current.focus()
    box.current.select()
  }, [input, pendingKey])

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

  function send() {
    const text = input.trim()
    if (!text || r.running !== null) return
    setInput('')
    void R.send(pdf, text)
  }

  function pick(e: EngineInfo) {
    if (!e.path) return
    setEngine(e.id)
    R.setEngine(e.id)
    setMenu(false)
    void window.cn.aiSetEngine(e.id)
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
          <button className="engbtn" aria-label="选 AI 引擎" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <EngineLogo id={engine} />
            {engineLabel}
            <Codicon name="chevron-down" size={12} />
          </button>
          {menu && (
            <div className="engmenu" role="menu" aria-label="AI 引擎">
              <div className="mh">用这台 Mac 上已经登录的</div>
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
        <span className="meta" data-testid="ai-undo-hint" data-tip="AI 的改动都是 Git 提交，随时可撤回" data-side="below">
          <span className="long">改动都是提交，可撤回</span>
          <span className="short">改动可撤回</span>
        </span>
        <span className="sp" />
        <button className="iconbtn" aria-label="新对话" title="新对话：AI 从头读这份 PDF，问过的和笔记都留着" onClick={() => void R.newChat(pdf)} disabled={running}>
          <Codicon name="add" size={14} />
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
            {stemOf(pdf)}.pdf · 第 {r.state.page} 页
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
              正在读全文 <span className="num">{r.readN}/{r.pages}</span>
            </span>
          ) : (
            <span className="chip">
              <Codicon name="check" size={12} className="ok" />
              读过全文 <span className="num">{r.pages}</span> 页
            </span>
          ))}
        <span className="chip">
          笔记 <span className="num">{sectionCount}</span> 段
        </span>
        {/* 问到哪：标签条右端只留页码（DESIGN.v3 1.4），问到第几页写在这里 */}
        {asked > 0 && (
          <span className="chip" data-testid="pdf-progress" title="问过的最大页码">
            问到第 <span className="num">{asked}</span> 页
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
                ? '在上面的网页里按住 ⌘ 拖一个框，回车就发。问过的 AI 在后台记进中间开着的文档，没开就进收件箱。'
                : /\.html?$/i.test(pdf)
                  ? '点「框一块问」在左边拖一个框，回车就发；⌘↵ 问这一屏。问过的 AI 在后台记进笔记，不用你整理。'
                  : '在左边 PDF 上拖一个框，回车就发；⌘↵ 问整页。问过的 AI 在后台记进笔记，不用你整理。'}
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
              sep={isNew ? `新对话 · ${stamp(r.state.newChatAt!)}` : startsThread ? `${Date.now() - m.time < 10 * 60_000 ? '现在' : stamp(m.time)}${m.page ? ` · 第 ${m.page} 页` : ''}` : null}
              flash={flashMsg === m.thread && startsThread}
              last={m === lastAi && !running}
              running={running && m.id === r.running}
              quote={startsThread ? r.state.threads.find((t) => t.id === m.thread)?.quote : undefined}
              onAgain={(t) => {
                setInput('')
                void R.send(pdf, t)
              }}
              onShowNote={() => props.onShowNote(m.thread)}
              onViz={() => void R.makeViz(pdf, m.id)}
              onOpenHtml={props.onOpenHtml}
            />
          )
        })}
      </div>
      <div className={'aiin reading-in' + (r.pending ? ' hot' : '')}>
        {r.pending && (
          <div className="atts">
            {r.pending.quote ? (
              <div className="attq">
                <span className="lb">{r.pending.web ? (/^https?:/i.test(r.pending.web.url) ? '网页' : 'HTML') : `第 ${r.pending.page} 页`}</span>
                <span className="q">「{r.pending.quote}」</span>
                <button className="rm" aria-label="不要这段了" onClick={() => R.unstage(pdf)}>
                  <Codicon name="close" size={10} />
                </button>
              </div>
            ) : (
              <div className="attc" data-testid="reading-att">
                {r.pending.url ? <img src={r.pending.url} alt={r.pending.page ? `第 ${r.pending.page} 页框的那块` : '框的那块'} /> : <span className="attwait" />}
                <span className="lb">{r.pending.web ? (/^https?:/i.test(r.pending.web.url) ? '网页' : 'HTML') : `第 ${r.pending.page} 页`}</span>
                <button className="rm" aria-label="不要这块了" onClick={() => R.unstage(pdf)}>
                  <Codicon name="close" size={10} />
                </button>
              </div>
            )}
          </div>
        )}
        <div className="crow">
          <textarea
            ref={box}
            rows={2}
            aria-label="问 AI"
            placeholder={`跟 ${engineLabel} 说，${R.isWebSrc(pdf) ? '在网页上按住 ⌘ 框一块' : '在左边框一块'}就能问`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) {
                e.preventDefault()
                send()
              } else if (e.key === 'Escape') {
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
            <button className="send" aria-label="发送" disabled={!input.trim()} onClick={send}>
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
          {p.quote && <div className="uq">「{p.quote}」</div>}
          <div className="um" onContextMenu={(e) => onMessageMenu(e, m.text)}>
            {m.text}
          </div>
        </div>
      ) : (
        <div className="am" data-testid="reading-msg" onContextMenu={(e) => m.text && onMessageMenu(e, withoutVizMark(m.text).text)}>
          {(m.text || m.error) && m.read && (
            <div className="read">
              <Codicon name="check" size={12} className="ok" />
              {m.read}
            </div>
          )}
          {!m.text && !m.error && <div className="thinking">正在想…</div>}
          {m.text && (
            <div className="txt md">
              <Markdown text={withoutVizMark(m.text).text} />
            </div>
          )}
          {m.error && <div className="err">{m.error}</div>}
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
                    第 {m.page} 页
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
