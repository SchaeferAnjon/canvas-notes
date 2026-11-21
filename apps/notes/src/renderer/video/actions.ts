/**
 * 视频条上的记下这一刻（⌥S）和两件事共用的：「记到哪」（这个视频记住，shared/video.ts 的 destForPick），
 * 文档插到光标处、白板进「时刻」列、收件箱由主进程写；插好、存好以后一次提交，底部提示能撤回。
 * 框一块问（⌥D）的问框在 ask-card.ts。
 */
import { useSyncExternalStore } from 'react'
import { type Dest, destForPick, type DestPick, timeParam, videoOf } from '../../shared/video'
import { hasOldLayout, isMindmap } from '@cn/format'
import { addMomentToBoard, addMomentToDocBoard } from './board'
import { prepareDest } from './dest'
import { centerNow, showSaved, videoHost, videoStateOf } from './store'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------------------------------------------------------------- 记到哪（这个视频记住）

/**
 * 「记到哪」选的（task-sta8n 方向 A：视频那一行和问框底下同一个菜单）：每个视频记住自己选的，记在本机；
 * 只存不是默认的（「开着的这篇」不存）
 */
const PICK_KEY = 'cn.videoDest'
let picks: Record<string, DestPick> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(v).filter(([, p]) => p === 'new' || p === 'inbox' || p === 'none')) as Record<string, DestPick>
  } catch {
    // 读不到：都当「开着的这篇」
    return {}
  }
})()
const pickSubs = new Set<() => void>()

export const destPickOf = (key: string): DestPick => picks[key] ?? 'open'

export function setDestPick(key: string, p: DestPick) {
  const { [key]: _old, ...rest } = picks
  picks = p === 'open' ? rest : { ...rest, [key]: p }
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(picks))
  } catch {
    // 存不下只是下次不记得
  }
  pickSubs.forEach((f) => f())
}

export function useDestPick(key: string): DestPick {
  useSyncExternalStore(
    (f) => {
      pickSubs.add(f)
      return () => pickSubs.delete(f)
    },
    () => picks,
  )
  return destPickOf(key)
}

/** 这个视频问 AI 记到哪；只问不记是 null */
export function askDestNow(v: { title: string; key: string }): Dest | null {
  const c = centerNow()
  if (!c) return null
  return destForPick(c.center, c.lastDoc, v.title, destPickOf(v.key))
}

/** 这个视频记下这一刻记到哪（记下这一刻没有「不记」：选了只问不记的按开着的这篇记） */
export function destNow(v: { title: string; key: string }): Dest | null {
  const c = centerNow()
  if (!c) return null
  const p = destPickOf(v.key)
  return destForPick(c.center, c.lastDoc, v.title, p === 'none' ? 'open' : p)
}

let busy = false

/** 插进文档 / 白板：返回改了的那篇 */
export function place(dest: Dest, key: string, block: string, card: string): string {
  const c = centerNow()
  const doc = c?.doc()
  if (!doc || doc.path !== dest.path) throw new Error(`《${dest.title}》没开着，记不进去`)
  if (doc.readOnly) throw new Error(`《${dest.title}》是只读的`)
  if (dest.kind === 'board') {
    // 以前写法的白板（导图、撤回了转写法的）进「时刻」列；2026-11-21 起的白板就是这篇文档：时刻紧跟在视频卡后面
    if (isMindmap(doc.text) || hasOldLayout(doc.text)) doc.setText(addMomentToBoard(doc.text, key, block, card).text)
    else doc.setText(addMomentToDocBoard(doc.text, key, block, card))
  } else {
    // 这个视频第一次进这篇：先插一行视频卡
    const first = !doc.text.includes(`video=${key}`)
    // 焦点留在视频上（空格照样暂停 / 播放，2026-11-17 用户定）：光标照样落到新空段落，只是不把焦点交回文档
    doc.insertAtCursor(first ? `${card}\n\n${block}` : block, { focus: false })
  }
  return doc.path
}

export async function saveMoment(wcId: number) {
  const st = videoStateOf(wcId)
  const c = centerNow()
  const h = videoHost()
  if (!st || !c || !h || busy) return
  const want = destNow(st)
  if (!want) return
  busy = true
  h.cmd(wcId, 'flash')
  try {
    // 截帧和开好那篇文档一起做（截的是按下那一刻）；新建、改名都不换文件夹，图片的相对链接不变
    const [r, { dest, created, from }] = await Promise.all([window.cnVideo.moment({ wcId, dest: want.kind === 'new' ? { ...want, kind: 'doc' } : want }), prepareDest(want, st)])
    let hash = r.commit ?? null
    if (dest.kind !== 'inbox') {
      const path = place(dest, r.key, r.moment, r.card)
      await c.doc()?.save()
      hash = await window.cnVideo.commit([path, ...(from ? [from] : []), ...r.files], `视频：记下 ${r.time}《${st.title.slice(0, 40)}》→ ${dest.title}`, { wcId, t: r.t, note: dest.title, text: lineText(r.moment), image: r.files[0] })
    }
    c.refresh()
    showSaved({ text: created ? `新建了《${dest.title}》，记了${r.time}` : `记进了《${dest.title}》 · ${r.time} · 截了这一帧和前后4行`, hash, mark: { wcId, t: r.t } })
  } catch (e) {
    c.notice(errText(e))
  } finally {
    busy = false
  }
}

/** 时刻块里当前那一句（「N 个时刻」弹层里显示）：译文优先 */
function lineText(md: string): string {
  const m = /^> \*\*\d+:\d{2}(?::\d{2})? (.*)\*\*$/m.exec(md)
  if (!m) return ''
  const [o, t] = m[1]!.split(' / ')
  return (t || o || '').slice(0, 120)
}

/** 问答块插到占位那里（占位不在了就插光标处）：块下面空一段，光标停在空段落里写自己的话（CN-76） */
export function placeAsk(dest: Dest, key: string, block: string, card: string, at: number | null): string {
  const doc = centerNow()?.doc()
  if (!doc || doc.path !== dest.path) throw new Error(`《${dest.title}》没开着，记不进去`)
  const view = doc.view
  if (at !== null) view.dispatch({ selection: { anchor: Math.min(at, view.state.doc.length) } })
  const first = !doc.text.includes(`video=${key}`)
  // 焦点留在视频上（问出去以后焦点回到视频，空格照样播放暂停）：光标照样停在讲解块下面的空段落，只是不把焦点交回文档
  const r = doc.insertAtCursor(first ? `${card}\n\n${block}` : block, { focus: false })
  // 提示块下面：空一行、一个空段落（光标在这里），后面还有字就再空一行，没有就以换行结尾
  const tail = view.state.doc.sliceString(r.to)
  const nl = /^\n*/.exec(tail)![0].length
  const rest = tail.length > nl
  view.dispatch({ changes: { from: r.to, to: r.to + nl, insert: '\n\n' + (rest ? '\n\n' : '\n') }, selection: { anchor: r.to + 2 }, userEvent: 'input.clip' })
  return doc.path
}

const fmt = (t: number) => {
  const s = Math.floor(t)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 问答块第一次进一篇时前面也放一行视频卡（主进程给的时刻 md 里没有卡，这里用不带封面的卡） */
export function videoCardFor(st: { key: string; title: string; channel: string; duration: number; site: 'youtube' | 'bilibili'; id: string; p?: number }, dest: Dest): string {
  const url = st.site === 'youtube' ? `https://www.youtube.com/watch?v=${st.id}` : `https://www.bilibili.com/video/${st.id}${st.p && st.p > 1 ? `?p=${st.p}` : ''}`
  const meta = [st.channel, st.duration ? fmt(st.duration) : ''].filter(Boolean).join(' · ')
  return [...(dest.kind === 'board' ? [] : [`<!-- video video=${st.key} -->`]), `[${st.title.replace(/[[\]]/g, ' ')}](${url})`, meta || (st.site === 'youtube' ? 'YouTube' : 'B站')].join('\n')
}

/** 点了一个视频链接（文档里的时间、时刻块、视频卡）：右栏打开并跳到那一秒；不带时间的从上次看到的地方接着看 */
export async function openVideo(url: string, resume = false) {
  const ref = videoOf(url)
  const h = videoHost()
  if (!ref || !h) return false
  let t = timeParam(url)
  if (t === null && resume) {
    const pos = await window.cnVideo.lastPos(ref.key)
    if (pos > 3) t = pos
  }
  h.openAt(url, t)
  return true
}
