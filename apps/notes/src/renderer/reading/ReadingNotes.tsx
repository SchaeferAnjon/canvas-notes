/**
 * 读 PDF 时右栏下格的「笔记」（方向 A：和 AI 用竖条切换）。spec 1.6 一段的结构、方向 A「笔记在哪看」。
 * 读的就是库里那篇「… 笔记.md」，按段显示；一段默认收成一行，只展开刚问的、跳到的和自己点开的。
 */
import { Codicon } from '@cn/design'
import { type AskSection, cropCaption, prop } from '@cn/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as R from './store'

const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const nameOf = (p: string) => p.split('/').pop() ?? p

export function ReadingNotes(props: {
  pdf: string
  hidden: boolean
  onOpenNote(path: string): void
  onOpenLink(target: string): void
  onShowConvo(id: string): void
  onOpenHtml(path: string): void
  onOpenWeb(url: string): void
  onOpenDoubts(folder: string): void
}) {
  const { pdf } = props
  const r = R.useReading(pdf)!
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [ring, setRing] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const sections = useMemo(() => [...r.note.sections].sort((a, b) => a.page - b.page), [r.note.sections])

  // 刚问的那段默认展开
  const newest = r.state.threads.length ? r.state.threads.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).id : null
  useEffect(() => {
    if (newest) setOpen((s) => (s.has(newest) ? s : new Set(s).add(newest)))
  }, [newest])

  // 看过了，竖条上的小点消失
  useEffect(() => {
    if (!props.hidden) R.seenNotes(pdf)
  }, [props.hidden, r.fresh])

  // 点了页边标记、「已记进笔记 ›」：滚到那一段并展开，外圈亮 2 秒
  useEffect(() => {
    const f = r.focus
    if (!f || props.hidden) return
    setOpen((s) => new Set(s).add(f.id))
    setRing(f.id)
    requestAnimationFrame(() => list.current?.querySelector(`[data-sec="${CSS.escape(f.id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    const t = setTimeout(() => setRing((x) => (x === f.id ? null : x)), 2000)
    return () => clearTimeout(t)
  }, [r.focus?.seq, props.hidden])

  // 刚记好的那段外圈亮 2 秒
  useEffect(() => {
    const id = r.justWritten
    // 笔记没在看时不亮（竖条「笔记」上的小点提醒）
    if (!id || props.hidden) return
    setRing(id)
    const t = setTimeout(() => setRing((x) => (x === id ? null : x)), 2000)
    return () => clearTimeout(t)
  }, [r.justWritten])

  const t = q.trim().toLowerCase()
  const shown = t ? sections.filter((s) => [s.title, s.good, ...s.doubts, ...s.points].join('\n').toLowerCase().includes(t)) : sections
  // 还没写进笔记的（AI 在后台写）先占一段
  const writingNew = r.writing.filter((id) => !sections.some((s) => s.id === id))
  const doubts = sections.reduce((n, s) => n + s.doubts.length, 0)
  const text = r.note.text
  const lec = prop(text, '第几讲')
  const progress = prop(text, '进度')
  const props2 = [prop(text, '类型'), prop(text, '课程'), lec && `第${lec}讲`].filter(Boolean) as string[]

  return (
    <aside className="right reading-notes" aria-label="笔记" hidden={props.hidden}>
      <div className="aih">
        <b>笔记</b>
        <span className="meta truncate">{nameOf(r.note.path)}</span>
        <span className="sp" />
        {text && (
          <button className="iconbtn" aria-label="在中间打开" title="在中间打开（当普通文档改）" onClick={() => props.onOpenNote(r.note.path)}>
            <Codicon name="link-external" size={14} />
          </button>
        )}
      </div>
      <div className="notes" ref={list}>
        {!text && !writingNew.length ? (
          <div className="nempty">
            <p>还没有笔记。</p>
            <p>在左边PDF上框一块问AI，问完它在后台记一段：你框的图、你卡在哪、讲通的讲法和要点。</p>
          </div>
        ) : (
          <>
            {props2.length > 0 && (
              <div className="props">
                {props2.map((x) => (
                  <span key={x} className="chip">
                    {x}
                  </span>
                ))}
                <span className="chip">来源 {nameOf(pdf)}</span>
                {progress && <span className="chip num">{`问到${progress}页`}</span>}
              </div>
            )}
            <div className="nsum">
              <span className="num">
                {`${sections.length}段 · 疑惑${doubts}条`}
              </span>
              <span className="sp" />
              <button className="lnk" onClick={() => props.onOpenDoubts(pdf.includes('/') ? pdf.slice(0, pdf.lastIndexOf('/')) : '')}>
                全部疑惑
                <Codicon name="chevron-right" size={12} />
              </button>
            </div>
            <label className="nfind">
              <Codicon name="search" size={14} />
              <input placeholder="在这份笔记里找" aria-label="在这份笔记里找" value={q} onChange={(e) => setQ(e.target.value)} />
              <span className="num">{t ? `${shown.length}段` : '只展开最近问的，其余收成一行'}</span>
            </label>
            {writingNew.map((id) => {
              const th = r.state.threads.find((x) => x.id === id)
              return (
                <section key={id} className="ns writing" data-sec={id}>
                  <div className="nsh">
                    <span className="pgc">
                      <Codicon name="book" size={12} />{`第${th?.page ?? ''}页`}
                    </span>
                    <h3>正在记…</h3>
                    <Codicon name="loading" size={14} className="spin" />
                  </div>
                  {th?.crop && (
                    <div className="figs">
                      <div className="fig">
                        <div className="im">
                          <img src={vaultImg(th.crop)} alt={cropCaption(th)} style={{ maxWidth: 220, maxHeight: 130 }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <p className="wnote">AI在后台写这一段，你可以接着问</p>
                </section>
              )
            })}
            {shown.map((s) => (
              <Section
                key={s.id}
                s={s}
                open={!!t || open.has(s.id)}
                ring={ring === s.id}
                writing={r.writing.includes(s.id)}
                onToggle={() =>
                  setOpen((x) => {
                    const n = new Set(x)
                    if (n.has(s.id)) n.delete(s.id)
                    else n.add(s.id)
                    return n
                  })
                }
                onJump={() => R.jumpTo(pdf, s.page, s.rect)}
                onJumpPage={(page) => R.jumpTo(pdf, page)}
                onConvo={() => props.onShowConvo(s.id)}
                onLink={props.onOpenLink}
                onOpenHtml={props.onOpenHtml}
                onOpenWeb={props.onOpenWeb}
              />
            ))}
            {t && !shown.length && <div className="nempty">这份笔记里没有「{q.trim()}」</div>}
          </>
        )}
      </div>
    </aside>
  )
}

function Section(p: {
  s: AskSection
  open: boolean
  ring: boolean
  writing: boolean
  onToggle(): void
  onJump(): void
  onJumpPage(page: number): void
  onConvo(): void
  onLink(target: string): void
  onOpenHtml(path: string): void
  onOpenWeb(url: string): void
}) {
  const { s } = p
  // 在网页上问的：地球 + 域名，点了回网页；在 HTML 上问的：代码文件 + 文件名，点了打开它
  const w = s.web
  const chip = w ? (
    <button
      className="pgc"
      title={/^https?:/i.test(w.url) ? `回到网页 ${w.url}` : `打开 ${w.url}`}
      onClick={(e) => (e.stopPropagation(), /^https?:/i.test(w.url) ? p.onOpenWeb(w.url) : p.onOpenHtml(w.url))}
    >
      <Codicon name={/^https?:/i.test(w.url) ? 'globe' : 'file-code'} size={12} />
      <span className="truncate">{w.label}</span>
    </button>
  ) : (
    <button className="pgc" title="翻到这一页，框过的那块闪一下" onClick={(e) => (e.stopPropagation(), p.onJump())}>
      <Codicon name="book" size={12} />{`第${s.page}页`}
    </button>
  )
  if (!p.open)
    return (
      <section className={'ns row1' + (p.ring ? ' flash' : '')} data-sec={s.id}>
        <div className="nsh" role="button" tabIndex={0} aria-expanded={false} onClick={p.onToggle} onKeyDown={(e) => e.key === 'Enter' && p.onToggle()}>
          <Codicon name="chevron-right" size={14} className="fold" />
          {chip}
          <h3 className="truncate">{s.title}</h3>
          <span className="tm num">
            {`${s.doubts.length}条疑惑${s.time ? ` · ${s.time}` : ''}`}
          </span>
        </div>
      </section>
    )
  return (
    <section className={'ns' + (p.ring ? ' flash' : '') + (p.writing ? ' writing' : '')} data-sec={s.id} data-testid="note-section">
      <div className="nsh">
        <button className="iconbtn fold" aria-label="收成一行" aria-expanded onClick={p.onToggle}>
          <Codicon name="chevron-down" size={14} />
        </button>
        {chip}
        <h3>{s.title}</h3>
        {p.writing ? <Codicon name="loading" size={14} className="spin" /> : <span className="tm num">{s.time}</span>}
      </div>
      {(s.crop || s.figures.length > 0) && (
        <div className="figs">
          {s.crop && (
            <div className="fig">
              <button className="im" title="点一下回到原处" onClick={p.onJump}>
                <img src={vaultImg(s.crop)} alt={cropCaption(s)} style={{ maxWidth: 220, maxHeight: 130 }} />
              </button>
              <div className="fc">{cropCaption(s)}</div>
            </div>
          )}
          {s.figures.map((f) => (
            <div key={f.path} className="fig">
              <button className="im" onClick={() => p.onJumpPage(s.page)}>
                <img src={vaultImg(f.path)} alt={f.caption} style={{ maxWidth: 130, maxHeight: 130 }} />
              </button>
              <div className="fc">{f.caption}</div>
            </div>
          ))}
        </div>
      )}
      {s.doubts.length > 0 && (
        <div className="doubt">
          <div className="lab2">
            <Codicon name="question" size={12} />
            我的疑惑
          </div>
          {s.doubts.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
        </div>
      )}
      {s.good && (
        <div className="good">
          <div className="lab2">
            <Codicon name="check" size={12} />
            讲通的讲法{s.goodVersion && <span className="ver">{`第${s.goodVersion}版`}</span>}
          </div>
          <p>{s.good}</p>
        </div>
      )}
      {s.points.length > 0 && (
        <ul className="pts">
          {s.points.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      {s.failed.length > 0 && (
        <div className="bad">
          {s.failed.map((f) => (
            <details key={f.version}>
              <summary>
                <Codicon name="chevron-right" size={12} />
                {`没讲通 · 第${f.version}版：${f.line}`}
              </summary>
              <div className="body2">{f.text}</div>
            </details>
          ))}
        </div>
      )}
      {s.viz && (
        <button className="vcard" data-testid="viz-card" onClick={() => p.onOpenHtml(s.viz!.path)}>
          <span className="th">
            <Codicon name="file-code" size={18} />
          </span>
          <span className="tx">
            <b className="truncate">{s.viz.title}</b>
            <span>可视化 · 能拖能点 · 点开在中间</span>
          </span>
        </button>
      )}
      <div className="nsf">
        <button className="lnk" onClick={p.onConvo}>
          <Codicon name="comment" size={12} />
          {`完整对话 · ${s.rounds}轮`}
        </button>
        {s.links.map((l) => (
          <button key={l} className="lnk wl" title="双链，跳到那篇" onClick={() => p.onLink(l.split('#')[0]!)}>
            [[{l}]]
          </button>
        ))}
      </div>
    </section>
  )
}
