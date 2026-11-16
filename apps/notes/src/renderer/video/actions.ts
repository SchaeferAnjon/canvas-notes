/**
 * 视频条上的两件事：记下这一刻（⌥S）、框一块问（⌥D）。落点按「记到哪」的规矩（shared/video.ts 的 destFor），
 * 文档插到光标处、白板进「时刻」列、收件箱由主进程写；插好、存好以后一次提交，底部提示能撤回。
 */
import { destFor, type Dest, timeParam, videoOf } from '../../shared/video'
import type { AskResult } from '../../shared/video-api'
import { injectAi } from './ai-inject'
import { addMomentToBoard } from './board'
import { centerNow, showSaved, videoHost, videoStateOf } from './store'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 视频条「记到」临时改的：中间栏换了标签就回到默认 */
let override: { centerPath: string | null; inbox: boolean } | null = null

export function setDestInbox(inbox: boolean) {
  const c = centerNow()
  override = { centerPath: c && c.center.kind !== 'none' ? c.center.path : null, inbox }
}

/** 这个视频现在记到哪 */
export function destNow(videoTitle: string): Dest | null {
  const c = centerNow()
  if (!c) return null
  const centerPath = c.center.kind !== 'none' ? c.center.path : null
  if (override && override.centerPath !== centerPath) override = null
  const d = destFor(c.center, c.lastDoc, videoTitle)
  if (override?.inbox && d.kind !== 'inbox') return destFor({ kind: 'none' }, null, videoTitle)
  return d
}

let busy = false

/** 插进文档 / 白板：返回改了的那篇 */
function place(dest: Dest, key: string, block: string, card: string): string {
  const c = centerNow()
  const doc = c?.doc()
  if (!doc || doc.path !== dest.path) throw new Error(`《${dest.title}》没开着，记不进去`)
  if (doc.readOnly) throw new Error(`《${dest.title}》是只读的`)
  if (dest.kind === 'board') {
    const r = addMomentToBoard(doc.text, key, block, card)
    doc.setText(r.text)
  } else {
    // 这个视频第一次进这篇：先插一行视频卡
    const first = !doc.text.includes(`video=${key}`)
    doc.insertAtCursor(first ? `${card}\n\n${block}` : block)
  }
  return doc.path
}

export async function saveMoment(wcId: number) {
  const st = videoStateOf(wcId)
  const c = centerNow()
  const h = videoHost()
  if (!st || !c || !h || busy) return
  const dest = destNow(st.title)
  if (!dest) return
  busy = true
  h.cmd(wcId, 'flash')
  try {
    const r = await window.cnVideo.moment({ wcId, dest })
    let hash = r.commit ?? null
    if (dest.kind !== 'inbox') {
      const path = place(dest, r.key, r.moment, r.card)
      await c.doc()?.save()
      hash = await window.cnVideo.commit([path, ...r.files], `视频：记下 ${r.time}《${st.title.slice(0, 40)}》→ ${dest.title}`, { wcId, t: r.t, note: dest.title, text: lineText(r.moment), image: r.files[0] })
    }
    c.refresh()
    showSaved({ text: `记进了《${dest.title}》 · ${r.time} · 截了这一帧和前后 4 行`, hash, mark: { wcId, t: r.t } })
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

export function startAsk(wcId: number) {
  videoHost()?.cmd(wcId, 'box')
}

/** 框好了、问话框里回车：AI 浮窗里出这一问，答完自动记进笔记和「视频里的疑惑」 */
export function sendAsk(wcId: number, box: { x: number; y: number; w: number; h: number }, question: string) {
  const st = videoStateOf(wcId)
  const c = centerNow()
  const h = videoHost()
  if (!st || !c || !h) return
  const dest = destNow(st.title)
  if (!dest) return
  h.cmd(wcId, 'boxDone')
  c.openAi()
  const doc = c.doc()
  const noteText = doc && doc.path === dest.path ? doc.text : ''
  const run = (async () => {
    const r: AskResult = await window.cnVideo.ask({ wcId, dest, box, question, noteText })
    if (dest.kind !== 'inbox') {
      const card = videoCardFor(st, dest)
      const path = place(dest, st.key, r.block, card)
      await c.doc()?.save()
      await window.cnVideo.commit([path, ...r.files], `视频：问 AI ${fmt(r.t)}《${st.title.slice(0, 40)}》→ ${dest.title}`, { wcId, t: r.t, note: dest.title, asked: true, text: question })
    }
    c.refresh()
    return { text: r.answer, read: r.read, done: `已记进《${dest.title}》和「视频里的疑惑」` }
  })()
  injectAi({ question, read: '在看框住的那块和前后 30 秒的字幕…', run })
}

const fmt = (t: number) => {
  const s = Math.floor(t)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 问答块第一次进一篇时前面也放一行视频卡（主进程给的时刻 md 里没有卡，这里用不带封面的卡） */
function videoCardFor(st: { key: string; title: string; channel: string; duration: number; site: 'youtube' | 'bilibili'; id: string; p?: number }, dest: Dest): string {
  const url = st.site === 'youtube' ? `https://www.youtube.com/watch?v=${st.id}` : `https://www.bilibili.com/video/${st.id}${st.p && st.p > 1 ? `?p=${st.p}` : ''}`
  const meta = [st.channel, st.duration ? fmt(st.duration) : ''].filter(Boolean).join(' · ')
  return [...(dest.kind === 'board' ? [] : [`<!-- video video=${st.key} -->`]), `[${st.title.replace(/[[\]]/g, ' ')}](${url})`, meta || (st.site === 'youtube' ? 'YouTube' : 'B 站')].join('\n')
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
