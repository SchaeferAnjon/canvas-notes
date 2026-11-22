/**
 * 「这个网页问的、剪的记到哪篇？」（task-6cxtc 设计稿「还没配对时」）：这个网页还没配对、也没选过记到哪篇时，第一次讲解一下、引用、剪藏，
 * 贴着网页的小条下面问一句：默认中间开着的那篇，也能选别的一篇或这次只问不记（剪藏是剪进收件箱）；「记到这篇」顺手把这个网站和它配成一对。
 * 剪完底栏「换一篇」、网页小条「⋯ › 剪到哪篇…」也用它。黑底弹层（同网页小条），↑↓ 换一项、回车定、esc 取消。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { keyFor } from '../keys'
import { FloatPop, type PopAnchor } from '../pop-place'
import { onPageOutside } from '../web/page-outside'
import { titleOf } from '../../shared/layout'
import './web-notes.css'

export type Where = { kind: 'doc'; path: string } | { kind: 'none' } | { kind: 'inbox' }

export interface WhereAsk {
  /** ask：讲解、引用问的；clip：剪藏（第三项是剪进收件箱） */
  kind: 'ask' | 'clip'
  /** 贴着它下面问（窗口坐标） */
  at: PopAnchor
  /** 中间开着的那篇（文档看法、能写）；没有是 null */
  center: string | null
  /** 能选的几篇（库里的 md） */
  notes: readonly string[]
  /** 现在记进的那篇（换一篇时先选着它） */
  current?: string | null
}

let req: (WhereAsk & { seq: number; done(w: Where | null): void }) | null = null
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((s) => s())

/** 问一句记到哪篇；取消是 null。已经在问了：上一个当取消 */
export function askWhere(o: WhereAsk): Promise<Where | null> {
  req?.done(null)
  return new Promise((resolve) => {
    const mine = ++seq
    req = {
      ...o,
      seq: mine,
      done: (w) => {
        if (req?.seq === mine) req = null
        emit()
        resolve(w)
      },
    }
    emit()
  })
}

type Pick = 'center' | 'other' | 'none'

export function WhereHost() {
  const r = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => req,
  )
  if (!r) return null
  return <WherePop key={r.seq} r={r} />
}

function WherePop({ r }: { r: NonNullable<typeof req> }) {
  const first: Pick = r.current && r.current !== r.center ? 'other' : r.center ? 'center' : 'none'
  const [pick, setPick] = useState<Pick>(first)
  const [other, setOther] = useState<string | null>(r.current && r.current !== r.center ? r.current : null)
  const [find, setFind] = useState(first === 'other' && !other)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return r.notes.filter((p) => p !== r.center && (!t || titleOf(p).toLowerCase().includes(t) || p.toLowerCase().includes(t))).slice(0, 6)
  }, [q, r.notes, r.center])

  const picks: Pick[] = [...(r.center ? (['center'] as const) : []), 'other', 'none']
  const ok = pick === 'center' || (pick === 'other' && !!other) || pick === 'none'
  const done = () => {
    if (pick === 'center' && r.center) return r.done({ kind: 'doc', path: r.center })
    if (pick === 'other' && other) return r.done({ kind: 'doc', path: other })
    if (pick === 'none') return r.done(r.kind === 'clip' ? { kind: 'inbox' } : { kind: 'none' })
  }

  // 弹出来时焦点进来（回车就是「记到这篇」）；点外面、esc 当取消
  useEffect(() => {
    ref.current?.focus()
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && r.done(null)
    window.addEventListener('pointerdown', down, true)
    // 网页里按下鼠标、按 esc（焦点在网页里时窗口收不到，网页预加载报过来）
    const off = onPageOutside(() => r.done(null))
    return () => {
      window.removeEventListener('pointerdown', down, true)
      off()
    }
  }, [])
  useEffect(() => {
    if (find) findRef.current?.focus()
  }, [find])

  const choose = (p: Pick) => {
    setPick(p)
    if (p === 'other') {
      setFind(true)
      setHi(0)
    } else setFind(false)
  }
  const pickNote = (p: string) => {
    setOther(p)
    setPick('other')
    setFind(false)
    ref.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (find && other) return setFind(false)
      return r.done(null)
    }
    if (find) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setHi((h) => Math.max(0, Math.min(list.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1))))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (list[hi]) pickNote(list[hi]!)
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = picks.indexOf(pick)
      choose(picks[(i + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length]!)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (ok) done()
    }
  }

  const enter = keyFor('enter')
  const noneLabel = r.kind === 'clip' ? '剪成卡片，放进收件箱' : '这次只问，不记'
  const goLabel = pick === 'none' ? (r.kind === 'clip' ? '剪进收件箱' : '只问这次') : '记到这篇'
  const radio = (p: Pick, label: string, right?: string) => (
    <button type="button" role="radio" aria-checked={pick === p} className={'wh-opt' + (pick === p ? ' on' : '')} onClick={() => choose(p)}>
      <i className="wh-dot" aria-hidden />
      <span className="wh-l">{label}</span>
      {right && <span className="wh-r">{right}</span>}
    </button>
  )
  return (
    <FloatPop at={r.at} gap={6} className="wh-pop" role="dialog" aria-label="记到哪篇" data-testid="where" onKeyDown={onKey}>
      <div className="wh-in" ref={ref} tabIndex={-1}>
        <div className="wh-t">这个网页问的、剪的记到哪篇？</div>
        <div className="wh-opts" role="radiogroup" aria-label="记到哪篇">
          {r.center && radio('center', titleOf(r.center), '中间开着的')}
          {radio('other', other ? titleOf(other) : '选别的一篇…', other ? '选的' : undefined)}
          {find && (
            <div className="wh-find">
              <input ref={findRef} aria-label="找一篇" placeholder="打名字找一篇" value={q} onChange={(e) => (setQ(e.target.value), setHi(0))} />
              <div className="wh-list" role="listbox" aria-label="找到的">
                {list.map((p, i) => (
                  <button type="button" key={p} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''} onMouseEnter={() => setHi(i)} onClick={() => pickNote(p)}>
                    <span className="wh-l">{titleOf(p)}</span>
                    <span className="wh-r">{p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''}</span>
                  </button>
                ))}
                {!list.length && <div className="wh-empty">{q.trim() ? `没有名字里带「${q.trim()}」的笔记` : '库里还没有笔记'}</div>}
              </div>
            </div>
          )}
          {radio('none', noneLabel)}
        </div>
        <p className="wh-n">记好以后这个网站和这篇配成一对：以后在这里讲解、引用、剪藏的都记进这篇，不再问。</p>
        <div className="wh-b">
          <button type="button" className="wh-x" onClick={() => r.done(null)}>
            取消
          </button>
          <button type="button" className="wh-go" disabled={!ok} onClick={done}>
            {goLabel}
            {enter && <kbd>{enter}</kbd>}
          </button>
        </div>
      </div>
    </FloatPop>
  )
}
