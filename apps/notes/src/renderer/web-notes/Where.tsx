/**
 * 「这个网页问的、剪的记到哪篇？」（task-6cxtc 设计稿「还没配对时」）：这个网页还没配对、也没选过记到哪篇时，第一次讲解一下、引用、剪藏，
 * 贴着网页的小条下面问一句：默认中间开着的那篇，也能选别的一篇或这次只问不记（剪藏是剪进收件箱）；「记到这篇」顺手把这个网站和它配成一对。
 * 剪完底栏「换一篇」、网页小条「⋯ › 剪到哪篇…」也用它。黑底弹层（同网页小条），↑↓ 换一项、回车定、esc 取消。
 * 剪藏的再多一项「放进一个文件夹…」（剪藏去处 2026-11-25，用户：「这里再加一个可以选目录」）：点了弹选文件夹（MovePicker，能新建），
 * 选了这一项写那个文件夹，和「这篇」「收件箱」一样随时能换；选定以后这个网站剪的每次一张卡片进那个文件夹。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { keyFor } from '../keys'
import { FloatPop, type PopAnchor } from '../pop-place'
import { onPageOutside } from '../web/page-outside'
import { titleOf } from '../../shared/layout'
import { t } from '../../shared/i18n'
import { MovePicker } from '../files/move-pick'
import { dirLabel } from './target'
import './web-notes.css'

export type Where = { kind: 'doc'; path: string } | { kind: 'none' } | { kind: 'inbox' } | { kind: 'dir'; path: string }

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
  /** 这个网站选过收件箱（剪到哪篇时先选着「剪成卡片，放进收件箱」） */
  inbox?: boolean
  /** 这个网站选过的文件夹（先选着「放进一个文件夹…」那一项，写着它）；没选是 null */
  dir?: string | null
  /** 「⋯ › 剪到哪篇…」：换的是这个网站以后的去处（选收件箱就是以后都进收件箱；不然只管这一次） */
  site?: boolean
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

type Pick = 'center' | 'other' | 'none' | 'dir'

export function WhereHost() {
  const r = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => req,
  )
  if (!r) return null
  return <WherePop key={r.seq} r={r} />
}

function WherePop({ r }: { r: NonNullable<typeof req> }) {
  const hasDir = r.dir !== undefined && r.dir !== null
  const first: Pick = hasDir ? 'dir' : r.inbox ? 'none' : r.current && r.current !== r.center ? 'other' : r.center ? 'center' : 'none'
  const [pick, setPick] = useState<Pick>(first)
  /** 选的文件夹（「放进一个文件夹…」那一项写它） */
  const [dir, setDir] = useState<string | null>(hasDir ? r.dir! : null)
  /** 选文件夹的弹层开着：贴着那一项 */
  const [dirAt, setDirAt] = useState<HTMLElement | null>(null)
  const dirBtn = useRef<HTMLButtonElement>(null)
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

  const clip = r.kind === 'clip'
  const picks: Pick[] = [...(r.center ? (['center'] as const) : []), 'other', 'none', ...(clip ? (['dir'] as const) : [])]
  const ok = pick === 'center' || (pick === 'other' && !!other) || pick === 'none' || (pick === 'dir' && dir !== null)
  const done = () => {
    if (pick === 'center' && r.center) return r.done({ kind: 'doc', path: r.center })
    if (pick === 'other' && other) return r.done({ kind: 'doc', path: other })
    if (pick === 'none') return r.done(clip ? { kind: 'inbox' } : { kind: 'none' })
    if (pick === 'dir' && dir !== null) return r.done({ kind: 'dir', path: dir })
  }

  // 弹出来时焦点进来（回车就是「记到这篇」）；点外面、esc 当取消
  useEffect(() => {
    ref.current?.focus()
    // 选文件夹的弹层挂在 body 上，点它不算点外面
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.movepick') && r.done(null)
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
    // 「放进一个文件夹…」：每次点都弹选文件夹（选过的也能换）；没选就关了，退回原来那项
    if (p === 'dir') {
      setFind(false)
      if (dir !== null) setPick('dir')
      // 贴着整个弹层（下面放不下就整个摆在弹层上面），不压着这几项
      setDirAt(ref.current)
      return
    }
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
    // 选文件夹的弹层（React 里是这个弹层的孩子，按键照样冒到这里）自己管键
    if ((e.target as Element).closest?.('.movepick')) return
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
  // 问的时候选「这次只问，不记」= 关掉 AI 栏的「记笔记」（2026-11-24）
  const note =
    pick === 'dir'
      ? t('以后这个网站剪的每段一张卡片，放进「{dir}」；要换，点地址栏的剪藏小牌，或再来这里选。', { dir: dirLabel(dir ?? '') })
      : pick !== 'none'
      ? '记好以后这个网站和这篇配成一对：以后在这里讲解、引用、剪藏的都记进这篇，不再问。'
      : r.kind === 'ask'
        ? t('AI 栏输入框下面的「记笔记」跟着关上：之后在网页上问的都不记，在那里能再打开')
        : r.site
          ? t('以后这个网站剪的都进收件箱，一段一张卡片；要换回一篇再来这里选。')
          : t('这次剪成一张卡片放进收件箱，下次剪还会问。')
  const noneLabel = r.kind === 'clip' ? '剪成卡片，放进收件箱' : '这次只问，不记'
  const goLabel = pick === 'dir' ? t('放进这个文件夹') : pick === 'none' ? (r.kind === 'clip' ? '剪进收件箱' : '只问这次') : '记到这篇'
  const radio = (p: Pick, label: string, right?: string) => (
    <button type="button" ref={p === 'dir' ? dirBtn : undefined} role="radio" aria-checked={pick === p} className={'wh-opt' + (pick === p ? ' on' : '')} onClick={() => choose(p)}>
      <i className="wh-dot" aria-hidden />
      <span className="wh-l">{label}</span>
      {right && <span className="wh-r">{right}</span>}
    </button>
  )
  return (
    <FloatPop at={r.at} gap={6} className={'wh-pop' + (dirAt ? ' hold' : '')} role="dialog" aria-label="记到哪篇" data-testid="where" onKeyDown={onKey}>
      <div className="wh-in" ref={ref} tabIndex={-1}>
        <div className="wh-t">{clip ? t('这个网页问的、剪的记到哪？') : '这个网页问的、剪的记到哪篇？'}</div>
        <div className="wh-opts" role="radiogroup" aria-label="记到哪篇">
          {r.center && radio('center', titleOf(r.center), '中间开着的')}
          {radio('other', other ? titleOf(other) : '选别的一篇…', other && pick !== 'dir' ? '选的' : undefined)}
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
          {clip && radio('dir', dir !== null ? dirLabel(dir) : t('放进一个文件夹…'), dir !== null ? t('选的文件夹') : undefined)}
        </div>
        <p className="wh-n">{note}</p>
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
      {dirAt && (
        <MovePicker
          paths={[]}
          head={t('这个网站剪的放进哪个文件夹…')}
          dirs={[]}
          anchor={dirAt}
          allowNew
          onPick={(f) => {
            setDir(f)
            setPick('dir')
            ref.current?.focus()
          }}
          onClose={() => {
            setDirAt(null)
            ref.current?.focus()
          }}
        />
      )}
    </FloatPop>
  )
}
