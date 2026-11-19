/**
 * 微信读书界面这半：主进程发来新划的一段，中间开着普通文档就插到光标处（引文 + 书名章节 + 回到微信读书的链接），提示「已加到《…》」；
 * 中间开的是书摘、首页、白板，或者设置里关了插入：不插光标处，等后台同步进书摘那一章后提示「已同步到《书名》· 章节」带「看一眼」（CN-118）。
 * 书摘开着（哪个标签都算）时，主进程把合并交给这里：在编辑器里插进那一章（和剪进文档同一条路），编辑器存盘，正在打的字不丢、不出冲突副本（CN-130）。
 * 提示在中间岛底部居中，整句不截；插不进去时说原因（没登录 · 去登录、没认出这本书）。
 * 设置 › 插件 里开关、登录（用的是右栏网页里的登录）、同步状态、上次同步的时间、「现在同步」。
 * 没有书架页、没有写想法的框（偏好「微信读书划线进左边文档」）：读书笔记就写在中间那篇里，书摘里的评价用引文下面的「写评价」。
 */
import { when } from '../../../shared/when'
import { Codicon, codiconEl } from '@cn/design'
import { textChanges } from '@cn/format'
import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useState } from 'react'
import { type BookInfo, type BookSync, isBookDigest, type Mark, mergeBook, normalizeWeread, quoteMd, syncedText, WEREAD, WEREAD_FOLDER, type WereadStatus } from '../../../shared/plugins/weread'
import { app } from '../../ctx/actions'
import { flashRange } from '../../insert-flash'
import { NoteDoc } from '../../note-doc'
import { Toggle } from '../../Settings'
import { centerNow } from '../../video/store'
import { entryTarget, errText, pluginInfo } from '../host'
import type { RendererPlugin } from '../types'
import './weread.css'

const ID = 'weread'

/** 右栏打开微信读书的书架（没登录时微信读书自己显示扫码页）：已经开着就切过去。网址是主进程给的（测试时是假网站） */
function openWeread() {
  const t = entryTarget(pluginInfo(ID)?.entry ?? WEREAD.entry!)
  app().openInWeb(t.url, t.reuse)
}

type ToastIcon = 'check' | 'info' | 'warning'
/**
 * 中间岛底部居中一条提示（小样 CN-118：深色、对勾、整句不截，窄了折行），几秒后自己收起，不抢焦点；
 * 带一个动作（看一眼、去登录）时能点，点了就收起
 */
function toast(text: string, opts: { icon?: ToastIcon; action?: { label: string; run(): void }; ms?: number } = {}) {
  const host = document.querySelector('main.center') ?? document.body
  let el = document.getElementById('wr-toast')
  if (!el || el.parentElement !== host) {
    el?.remove()
    el = document.createElement('div')
    el.id = 'wr-toast'
    el.className = 'wr-toast'
    el.setAttribute('role', 'status')
    host.appendChild(el)
  }
  el.classList.toggle('loose', host === document.body)
  el.replaceChildren(codiconEl(opts.icon ?? 'check', 14, 'wr-ic' + (opts.icon === 'warning' ? ' warn' : '')))
  const t = document.createElement('span')
  t.className = 't'
  t.textContent = text
  el.append(t)
  const a = opts.action
  if (a) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'a'
    b.textContent = a.label
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', () => {
      el!.classList.remove('on')
      a.run()
    })
    el.append(b)
  }
  el.classList.add('on')
  clearTimeout((el as HTMLElement & { _t?: number })._t)
  ;(el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el!.classList.remove('on'), opts.ms ?? (a ? 5000 : 3500))
}

/** 划了线却取不到：说原因 */
function onProblem(p: { kind: 'login' | 'book' | 'error'; message?: string }) {
  if (p.kind === 'login') toast('没登录微信读书', { icon: 'warning', action: { label: '去登录', run: openWeread }, ms: 8000 })
  else if (p.kind === 'book') toast('没认出这本书（网页改版了）', { icon: 'warning' })
  else toast(`没取到这条划线：${p.message ?? ''}`, { icon: 'warning' })
}

/**
 * 编辑器没焦点时改了字（后台插划线、合并书摘）：浏览器里留着的旧光标（还指着改之前的那个 DOM 节点）清掉。
 * 不清的话，焦点回到编辑器时（不是点进去的，比如切回来）CodeMirror 读到这个旧光标，光标跳到别处（CN-118 要光标不动）；
 * 清掉了它就按自己记着的光标放
 */
function dropStaleCaret(doc: NoteDoc) {
  const v = doc.view
  if (v.hasFocus) return
  const sel = v.dom.ownerDocument.getSelection()
  if (sel?.rangeCount && v.contentDOM.contains(sel.anchorNode)) sel.removeAllRanges()
}

/** 刚插进中间文档的划线（按原文认）：同步完不再说「已同步到」 */
const insertedHere = new Set<string>()

/**
 * 新划的几段：中间开着普通文档（不是书摘、不是只读）、设置里开着插入：插到光标处（多段按顺序，一段一块引文）。
 * 别的情况不插：等同步进书摘后提示「已同步到《书名》· 章节」；同步也关着就说这一段只在微信读书里
 */
async function onHighlight(p: { book: BookInfo; url: string; marks: Mark[]; insert?: boolean; sync?: boolean }) {
  const c = centerNow()
  const doc = c?.doc()
  const kind = c?.center.kind
  const path = kind && kind !== 'none' ? (c!.center as { path: string }).path : ''
  const plain = !!doc && kind === 'doc' && doc.path === path && !doc.readOnly && !isBookDigest(doc.text)
  if (p.insert !== false && plain) {
    for (const m of p.marks) {
      doc.insertAtCursor(quoteMd(m, p.book, p.url), { focus: false })
      insertedHere.add(m.text)
    }
    dropStaleCaret(doc)
    await doc.save()
    void window.cn.logActivity('clip', doc.path)
    const title = path.split('/').pop()!.replace(/\.md$/, '')
    toast(p.marks.length === 1 ? `已加到《${title}》` : `已加到《${title}》· ${p.marks.length}段`)
    return
  }
  if (p.sync === false) toast(`没插进文档，「划线和想法同步进${WEREAD_FOLDER}」也关着：这一段只在微信读书里`, { icon: 'info' })
}

/** 第一段新划线在书摘里的位置（看一眼、闪一下） */
function quoteRange(text: string, quote: string): { from: number; to: number } | null {
  const first = `> ${quote.split(/\n+/)[0]!.trim()}`
  const at = text.indexOf(first)
  if (at < 0) return null
  const lines = quote.split(/\n+/).length
  let to = at
  for (let i = 0; i < lines; i++) {
    const nl = text.indexOf('\n', to + 1)
    to = nl < 0 ? text.length : nl
  }
  return { from: at, to }
}

/** 看一眼：书摘开在中间就滚到新的那一段、闪一下；没开就开它（新标签），开好了再滚过去 */
function peek(path: string, quote: string) {
  const show = (d: NoteDoc) => {
    const r = quoteRange(d.text, quote)
    if (!r) return
    d.view.dispatch({ effects: EditorView.scrollIntoView(r.from, { y: 'center' }) })
    flashRange(d.view, r)
  }
  const now = centerNow()?.doc()
  if (now && now.path === path) return show(now)
  app().openFile(path)
  const t0 = Date.now()
  const wait = () => {
    const d = centerNow()?.doc()
    if (d && d.path === path) requestAnimationFrame(() => show(d))
    else if (Date.now() - t0 < 4000) setTimeout(wait, 50)
  }
  wait()
}

/** 同步进书摘了：新划线没插进中间文档的，提示「已同步到《书名》· 章节」带「看一眼」（打开书、「现在同步」不提示） */
function onSynced(p: { path: string; title: string; added: { text: string; chapter: string }[]; why: string }) {
  if (p.why === 'open' || p.why === 'sync') return
  const rest = p.added.filter((m) => !insertedHere.delete(m.text))
  if (!rest.length) return
  toast(syncedText(p.title, rest), { action: { label: '看一眼', run: () => peek(p.path, rest[0]!.text) } })
}

/**
 * 主进程要合并书摘（CN-130）：这篇开着（哪个标签都算）就在编辑器里合——只插新的那几段、改开头的两个数，
 * 光标、正在打的字都不动，不进撤销；存好盘再回话。没开着回 handled: false，主进程自己写文件
 */
async function onMerge(p: { id: number; path: string; input: BookSync }) {
  const doc = [...NoteDoc.open].find((d) => d.path === p.path && !d.readOnly)
  const reply = (r: { handled: boolean; text?: string; written?: string[]; added?: Mark[] }) => window.cnPlugins.call(ID, 'merged', { id: p.id, ...r }).catch(() => undefined)
  if (!doc) return void reply({ handled: false })
  try {
    const before = doc.text
    const r = mergeBook(before, p.input)
    if (r.text !== before) {
      doc.view.dispatch({ changes: textChanges(before, r.text), annotations: Transaction.addToHistory.of(false), userEvent: 'input.sync' })
      dropStaleCaret(doc)
      const first = r.added[0] && quoteRange(r.text, r.added[0].text)
      if (first && centerNow()?.doc() === doc) flashRange(doc.view, first)
    }
    await doc.save()
    void reply({ handled: true, text: doc.text, written: r.written, added: r.added })
  } catch (e) {
    console.warn('[weread] 编辑器里合并书摘没成，交回主进程', e)
    void reply({ handled: false })
  }
}

let listening = false
function listen() {
  if (listening || !window.cnPlugins) return
  listening = true
  window.cnPlugins.on(ID, 'highlight', (p) => void onHighlight(p as Parameters<typeof onHighlight>[0]))
  window.cnPlugins.on(ID, 'synced', (p) => onSynced(p as Parameters<typeof onSynced>[0]))
  window.cnPlugins.on(ID, 'merge', (p) => void onMerge(p as Parameters<typeof onMerge>[0]))
  window.cnPlugins.on(ID, 'problem', (p) => onProblem(p as { kind: 'login' | 'book' | 'error'; message?: string }))
}
listen()

const time = (ms: number) => (ms ? when(ms, { time: true }) : '')

/** 已登录时第二行：同步到哪了 */
function syncText(s: WereadStatus): string {
  if (s.syncing) return '正在同步…'
  if (s.state === 'never' && !s.lastSync) return '还没同步过：在右栏打开一本书就会同步那一本，或者点「现在同步」'
  return `已同步${s.books ? `${s.books}本书、${s.marks}条划线` : ''} · 上次 ${time(s.lastSync)}`
}

function WereadSettingsPane({ info, onChange, onNotice }: { info: { settings: Record<string, unknown> }; onChange(p: Record<string, unknown>): void; onNotice(t: string): void }) {
  const set = normalizeWeread(info.settings)
  const [st, setSt] = useState<WereadStatus | null>(null)
  useEffect(() => {
    void window.cnPlugins.call<WereadStatus>(ID, 'status').then(setSt, (e) => onNotice(errText(e)))
    return window.cnPlugins.on(ID, 'status', (s) => setSt(s as WereadStatus))
  }, [])
  return (
    <>
      <div className="pair">
        <span>划线插进左边开着的文档</span>
        <Toggle on={set.insert} label="划线插进左边开着的文档" onChange={(v) => onChange({ insert: v })} />
      </div>
      <div className="pair">
        <span>划线和想法同步进「{WEREAD_FOLDER}」</span>
        <Toggle on={set.sync} label={`划线和想法同步进${WEREAD_FOLDER}`} onChange={(v) => onChange({ sync: v })} />
      </div>
      {st && <Account st={st} canSync={set.sync} onSync={() => void window.cnPlugins.call<WereadStatus>(ID, 'syncAll').then(setSt, (e) => onNotice(errText(e)))} />}
      <p className="note">
        {`在右栏打开一本书，用微信读书自带的「划线」，那一段马上进左边开着的文档。${st?.login.state === 'in' ? '不用另外登录。' : ''}只读微信读书，不往它那边写。`}
      </p>
    </>
  )
}

/**
 * 登录和同步那一块（CN-53）：插件用的就是右栏网页里的登录。
 * 已登录：头像、绿点「已登录：用的是右栏网页里登录的微信读书」、同步到哪了、「现在同步」；
 * 没登录 / 过期：「还没登录微信读书」和主按钮「在右栏打开登录」（B 的设置弹窗同时关掉）。红字只给真的出错。
 */
function Account({ st, canSync, onSync }: { st: WereadStatus; canSync: boolean; onSync(): void }) {
  const inn = st.login.state === 'in'
  return (
    <div className={'wr-acct' + (inn ? ' in' : '')} role="group" aria-label="微信读书登录">
      {inn && st.login.avatar ? <img className="wr-av" src={st.login.avatar} alt="" /> : <span className="wr-av">{inn ? (st.login.name?.slice(0, 1) ?? '') : <Codicon name="account" size={20} />}</span>}
      <div className="wr-who" aria-label="同步状态">
        {inn ? (
          <>
            <b>
              <i className="wr-dot" />
              {`已登录${st.login.name ? `（${st.login.name}）` : ''}：用的是右栏网页里登录的微信读书`}
            </b>
            <span className={st.state === 'error' ? 'bad' : ''}>{st.state === 'error' ? `上次没同步成：${st.error ?? ''}` : syncText(st)}</span>
          </>
        ) : (
          <>
            <b>{st.login.state === 'expired' ? '微信读书的登录过期了' : '还没登录微信读书'}</b>
            <span>插件用右栏网页里的登录；扫一次码就记住</span>
          </>
        )}
      </div>
      {inn ? (
        <button type="button" className="btn btn-sm" disabled={!canSync || st.syncing} onClick={onSync}>
          <Codicon name="refresh" size={13} className={st.syncing ? 'spin' : ''} />
          现在同步
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => {
            app().closeSettingsDialog()
            openWeread()
          }}
        >
          <Codicon name="book" size={13} />
          在右栏打开登录
        </button>
      )}
    </div>
  )
}

export const weread: RendererPlugin = {
  id: ID,
  icon: 'book',
  Settings: WereadSettingsPane,
}
