/**
 * 「补进导图」的核对框（设计页 16-费曼学习 第 3 节图 33，偏好「先核对再放」）：贴着点的那颗按钮弹，先列出要改的几处
 * （AI 把你讲的话按那一支的结构对上去），「放进去」才改，「算了」什么都不动。App 里放一个 MergeHost。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { keyPath, nodeAt, parseMindmap } from '@cn/format'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { branchOf, type MergeLine, mergeLines, type MergePlan } from '../../shared/feynman/after'
import { findRounds } from '../../shared/feynman/doc'
import { AiIcon } from '../engine-logo'
import { rich, useT } from '../i18n'
import { applyMerge, closeMerge, type MergeRequest, noteText, useMergeRequest } from './after'
import './after.css'

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function MergeHost() {
  const req = useMergeRequest()
  return req ? <MergeCheck key={req.seq} req={req} /> : null
}

type State =
  | { phase: 'planning' }
  | { phase: 'ready'; plan: MergePlan; lines: MergeLine[]; branchText: string; topic: string; by: string }
  | { phase: 'error'; message: string }

let jobSeq = 0

function MergeCheck({ req }: { req: MergeRequest }) {
  const t = useT()
  const [st, setSt] = useState<State>({ phase: 'planning' })
  const [busy, setBusy] = useState(false)
  const [tries, setTries] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number | null } | null>(null)

  useEffect(() => {
    let stale = false
    const job = ++jobSeq
    setSt({ phase: 'planning' })
    void (async () => {
      try {
        const text = await noteText(req.notePath)
        const meta = findRounds(text).find((r) => r.meta.id === req.roundId)?.meta
        if (!meta) throw new Error(t('这一轮不在这篇里了'))
        const branch = branchOf(text, req.notePath, meta)
        if (branch === null) throw new Error(t('导图上找不到这一轮讲的那一支了'))
        const r = await window.cnAfter.mapPlan(job, text, req.notePath, req.roundId)
        if (stale) return
        const roots = parseMindmap(text).roots
        setSt({ phase: 'ready', plan: r.plan, lines: mergeLines(roots, r.plan), branchText: nodeAt(roots, keyPath(branch))?.text ?? '', topic: nodeAt(roots, keyPath(branch))?.text ?? meta.topic, by: r.by })
      } catch (e) {
        if (!stale) setSt({ phase: 'error', message: errText(e) })
      }
    })()
    return () => {
      stale = true
      void window.cnAfter.stopMapPlan(job)
    }
  }, [tries])

  // 放在那一列里（设计稿 33）：和列一样宽（左右各留 16）、左沿对齐，在按钮下面；下面放不下就翻到按钮上面。没有列贴着按钮，没有按钮在窗口正中
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const m = 12
    const c = req.column
    const width = c ? Math.max(300, Math.min(c.width - 32, innerWidth - 2 * m)) : null
    const w = width ?? el.offsetWidth
    const h = el.offsetHeight
    const a = req.anchor
    if (!a) return setPos({ left: Math.round((innerWidth - w) / 2), top: Math.round((innerHeight - h) / 3), width })
    const left = Math.min(Math.max(m, c ? c.left + 16 : a.right - w), innerWidth - w - m)
    const below = a.bottom + 8
    const top = below + h <= innerHeight - m ? below : Math.max(m, a.top - 8 - h)
    setPos({ left: Math.round(left), top: Math.round(top), width })
  }, [st.phase, req.anchor, req.column])

  const put = async () => {
    if (st.phase !== 'ready' || busy) return
    setBusy(true)
    try {
      await applyMerge(req.notePath, st.plan, st.branchText, req.say)
      closeMerge()
    } catch (e) {
      setSt({ phase: 'error', message: errText(e) })
      setBusy(false)
    }
  }
  const putRef = useRef(put)
  putRef.current = put

  // 点外面（网页里也算）、Esc、窗口失焦关（公共的 useDismiss；以前点进右栏网页关不掉）；回车是放进去
  useDismiss(true, [box], () => closeMerge())
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing && !e.metaKey && !e.shiftKey) (e.preventDefault(), void putRef.current())
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // 引号里的节点字、正确说法不拆行（常带公式）
  const q = (s: string) => <span className="q">{s}</span>
  const line = (l: MergeLine) => {
    switch (l.kind) {
      case 'add':
        return rich(t('加一个节点，用你的原话：「{text}」'), { text: q(l.text) })
      case 'add-wrong':
        return rich(t('加「{text}」标红，下面挂一句正确说法：「{fix}」'), { text: q(l.text), fix: q(l.fix) })
      case 'add-blank':
        return rich(t('加「{text}」，后面留一个虚线空框，你自己补一句'), { text: q(l.text) })
      case 'wrong':
        return rich(t('「{node}」标红，下面挂一句正确说法：「{fix}」'), { node: q(l.node), fix: q(l.fix) })
      case 'blank':
        return rich(t('「{node}」后面留一个虚线空框，你自己补一句'), { node: q(l.node) })
      case 'kept':
        return t('讲清的节点不动')
    }
  }
  const empty = st.phase === 'ready' && !st.plan.ops.length

  return (
    <div
      ref={box}
      className="fa-merge"
      role="dialog"
      aria-label={t('补进导图')}
      data-testid="feynman-merge"
      style={pos ? { left: pos.left, top: pos.top, ...(pos.width ? { width: pos.width } : {}) } : { visibility: 'hidden', left: 0, top: 0 }}
    >
      <div className="fa-hd">
        <Codicon name="type-hierarchy-sub" size={16} />
        <b>{st.phase === 'ready' ? t('补进导图「{name}」这一支，改这几处：', { name: st.topic }) : t('补进导图')}</b>
      </div>
      {st.phase === 'planning' && (
        <div className="fa-wait" role="status">
          <span className="fa-spin" />
          {t('正在把你讲的话对到这一支上…')}
        </div>
      )}
      {st.phase === 'error' && (
        <div className="fa-err" role="alert">
          {st.message}
        </div>
      )}
      {st.phase === 'ready' &&
        (empty ? (
          <p className="fa-empty">{t('你讲的和这一支对得上，没有要改的')}</p>
        ) : (
          <ul className="fa-lines">
            {st.lines.map((l, i) => (
              <li key={i} className={l.kind === 'kept' ? 'kept' : undefined}>
                {line(l)}
              </li>
            ))}
          </ul>
        ))}
      <div className="fa-ft">
        {st.phase === 'ready' && (
          <span className="fa-by">
            <AiIcon job="chat" size={12} />
            {t('{by} 列的', { by: st.by })}
          </span>
        )}
        <span className="sp" />
        {st.phase === 'error' && (
          <button className="btn btn-sm" onClick={() => setTries((n) => n + 1)}>
            {t('再试一次')}
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={closeMerge}>
          {t('算了')}
        </button>
        <button className="btn btn-sm btn-primary" disabled={st.phase !== 'ready' || empty || busy} onClick={() => void put()} data-testid="feynman-merge-put">
          {t('放进去')}
        </button>
      </div>
    </div>
  )
}
