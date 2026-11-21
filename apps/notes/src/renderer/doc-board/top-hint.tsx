/**
 * 白板顶上居中那条提示（task-wn3x5，偏好「提示条要能消失」）。同一个位置只有一条，两种：
 * - 说明「按「##」摆成列 · 挪动了才写进文件」：每块白板只说一次。在前台停 6 秒（指着 × 时不算）、或在白板上第一次操作（按下鼠标、滚动、按键）就收起，右边 × 点掉；
 *   收过、点掉以后这块白板不再出。长文档说的是「这篇有N段 · 每节先摆4张，第7节起只留列头」，同一个规则。
 * - 「N张卡离开了自己那一节 · 文件里多了N行位置 · 摆回原样」：只在文件里真有位置行时出；「摆回原样」去掉位置行，条子跟着收起（底部提示能撤回）；
 *   × 先藏起这几张的，之后有别的卡（或列）挪离、或摆回去又挪出来，才再出来。出这条时说明算说过了。
 * 说过没有、藏起了哪几张都记在本机（localStorage，按笔记路径），不写进笔记文件（守住「打开再保存文件不变」）。
 * 出现有进场动画，收起时留着内容淡出再拿掉（--dur-slow；系统「减少动态效果」时为 0）。
 */
import { Codicon } from '@cn/design'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

const SEEN = 'cn.boardHint.seen:'
const HIDDEN = 'cn.boardHint.hidden:'
/** 说明不动它停多久 */
export const INTRO_MS = 6000

function loadSeen(path: string): boolean {
  try {
    return localStorage.getItem(SEEN + path) === '1'
  } catch {
    return false
  }
}
function saveSeen(path: string) {
  try {
    localStorage.setItem(SEEN + path, '1')
  } catch {
    // 记不住只是下次再说一次
  }
}
function loadHidden(path: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN + path) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
function saveHidden(path: string, ids: Set<string>) {
  try {
    if (ids.size) localStorage.setItem(HIDDEN + path, JSON.stringify([...ids]))
    else localStorage.removeItem(HIDDEN + path)
  } catch {
    // 同上
  }
}

/** 这一刻条子上写的东西（收起淡出时照旧显示它） */
type Shown = { kind: 'intro' | 'moved'; moved: number; placedCols: number; total: number; per: number; openCols: number }

export function TopHint(props: {
  path: string
  /** 摆出来的卡和列的位置编号（卡 u:编号、列 c:编号）：文件里真有的位置行 */
  placedIds: string[]
  moved: number
  placedCols: number
  total: number
  per: number
  openCols: number
  readOnly?: boolean
  /** 这块白板在前台（标签选中）：不在前台不计时 */
  active: boolean
  /** 展开着数据库卡：条子让开（不画），状态留着 */
  away: boolean
  /** 白板那一块：在上面第一次操作就收起说明 */
  area: RefObject<HTMLElement | null>
  onReset: () => void
}) {
  const { path, placedIds } = props
  const [seen, setSeen] = useState(() => loadSeen(path))
  const [hidden, setHidden] = useState(() => loadHidden(path))
  /** 指着 ×：说明先不计时（悬停提示 400ms 才出来，别刚出来条子就没了） */
  const [onX, setOnX] = useState(false)
  // 改名、换了一篇：按新路径重读
  const pathWas = useRef(path)
  useEffect(() => {
    if (pathWas.current === path) return
    pathWas.current = path
    setSeen(loadSeen(path))
    setHidden(loadHidden(path))
  }, [path])

  const ids = placedIds.join('\n')
  // 藏起的只留现在还摆着的：摆回去的那张以后再挪出来算新的挪动
  useEffect(() => {
    const now = new Set(placedIds)
    if ([...hidden].every((id) => now.has(id))) return
    const next = new Set([...hidden].filter((id) => now.has(id)))
    setHidden(next)
    saveHidden(path, next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  const movedOn = placedIds.some((id) => !hidden.has(id))
  const kind: Shown['kind'] | null = movedOn ? 'moved' : !seen ? 'intro' : null

  const markSeen = () => {
    setSeen(true)
    saveSeen(path)
  }
  // 有卡挪离时说的是真有的事：说明算说过了
  useEffect(() => {
    if (movedOn && !seen) markSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movedOn, seen])
  // 说明：在前台停 INTRO_MS 自己收起；白板上第一次操作就收起
  useEffect(() => {
    if (kind !== 'intro' || !props.active || props.away) return
    const t = onX ? undefined : setTimeout(markSeen, INTRO_MS)
    const el = props.area.current
    const op = () => markSeen()
    el?.addEventListener('pointerdown', op, true)
    el?.addEventListener('wheel', op, { capture: true, passive: true })
    el?.addEventListener('keydown', op, true)
    return () => {
      clearTimeout(t)
      el?.removeEventListener('pointerdown', op, true)
      el?.removeEventListener('wheel', op, true)
      el?.removeEventListener('keydown', op, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, props.active, props.away, path, onX])

  // 收起：留着最后的样子淡出，动画完了再拿掉
  const now: Shown | null = kind && { kind, moved: props.moved, placedCols: props.placedCols, total: props.total, per: props.per, openCols: props.openCols }
  const last = useRef<Shown | null>(null)
  const [, rerender] = useState(0)
  if (now) last.current = now
  const nowRef = useRef(now)
  nowRef.current = now
  const drop = () => {
    if (nowRef.current || !last.current) return
    last.current = null
    rerender((x) => x + 1)
  }
  const leaving = !now && !!last.current
  useEffect(() => {
    if (!leaving) return
    // 动画事件没来（窗口在后台、减少动态效果）也拿掉
    const t = setTimeout(drop, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving])
  // 展开数据库卡时条子不画：让开期间收起的不再补一段淡出
  useLayoutEffect(() => {
    if (props.away && !now) last.current = null
  })

  const s = now ?? last.current
  if (!s || props.away) return null
  const n = s.moved + s.placedCols
  return (
    <div
      key={s.kind}
      className={'db-hint' + (now ? '' : ' leaving')}
      role="status"
      data-kind={s.kind}
      onAnimationEnd={(e) => e.animationName === 'db-hint-out' && drop()}
    >
      <Codicon name="info" size={14} />
      {s.kind === 'moved' ? (
        <span className="tx">
          <b>{s.moved && s.placedCols ? `${s.moved}张卡、${s.placedCols}列` : s.moved ? `${s.moved}张卡` : `${s.placedCols}列`}</b>
          {`${s.moved && !s.placedCols ? '离开了自己那一节' : '不在原来的地方'} · 文件里多了${n}行位置`}
        </span>
      ) : s.total > 200 ? (
        <span className="tx">
          {`这篇有${s.total}段 · `}
          <b>{`每节先摆${s.per}张，第${s.openCols + 1}节起只留列头`}</b>
        </span>
      ) : (
        <span className="tx">
          {'按「##」摆成列 · '}
          <b>挪动了才写进文件</b>
        </span>
      )}
      {s.kind === 'moved' && !props.readOnly && (
        <button type="button" className="db-pill" onClick={props.onReset}>
          <Codicon name="discard" size={13} />
          摆回原样
        </button>
      )}
      <button
        type="button"
        className="db-hint-x"
        onPointerEnter={() => setOnX(true)}
        onPointerLeave={() => setOnX(false)}
        aria-label={s.kind === 'moved' ? '先藏起这条' : '收起这条说明'}
        data-tip={s.kind === 'moved' ? '先藏起，再有卡或列挪离自己那一节时出来' : '收起，这块白板以后不再出这条说明'}
        onClick={() => {
          if (s.kind === 'intro') return markSeen()
          const next = new Set(placedIds)
          setHidden(next)
          saveHidden(path, next)
        }}
      >
        <Codicon name="close" size={14} />
      </button>
    </div>
  )
}
