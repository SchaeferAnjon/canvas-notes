/**
 * 微信读书界面这半：主进程发来新划的一段，插进左边开着的文档光标处（引文 + 书名章节 + 回到微信读书的链接），
 * 右下角一行提示「已加到《…》」，插不进去时说原因（没登录 · 去登录、没认出这本书、左边没开文档）；
 * 设置 › 插件 里开关、登录（用的是右栏网页里的登录）、同步状态、上次同步的时间、「现在同步」。
 * 没有书架页、没有写想法的框（偏好「微信读书划线进左边文档」）：读书笔记就写在左边那篇里。
 */
import { when } from '../../../shared/when'
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { type BookInfo, type Mark, normalizeWeread, quoteMd, WEREAD, WEREAD_FOLDER, type WereadStatus } from '../../../shared/plugins/weread'
import { app } from '../../ctx/actions'
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

/** 右下角一行，3.5 秒后自己收起（不抢焦点）；带一个动作时（去登录）能点，多留一会儿 */
function toast(text: string, action?: { label: string; run(): void }) {
  let el = document.getElementById('wr-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'wr-toast'
    el.className = 'wr-toast'
    el.setAttribute('role', 'status')
    document.body.appendChild(el)
  }
  el.textContent = text
  el.classList.toggle('act', !!action)
  if (action) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = action.label
    b.addEventListener('click', () => {
      el!.classList.remove('on')
      action.run()
    })
    el.append(' · ', b)
  }
  el.classList.add('on')
  clearTimeout((el as HTMLElement & { _t?: number })._t)
  ;(el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el!.classList.remove('on'), action ? 8000 : 3500)
}

/** 划了线却插不进去：说原因 */
function onProblem(p: { kind: 'login' | 'book' | 'error'; message?: string }) {
  if (p.kind === 'login') toast('没登录微信读书', { label: '去登录', run: openWeread })
  else if (p.kind === 'book') toast('没认出这本书（网页改版了）')
  else toast(`没取到这条划线：${p.message ?? ''}`)
}

/** 新划的几段插进左边开着的文档（多段按顺序，一段一块引文） */
async function onHighlight(p: { book: BookInfo; url: string; marks: Mark[] }) {
  const c = centerNow()
  const doc = c?.doc()
  const kind = c?.center.kind
  const path = kind && kind !== 'none' ? (c!.center as { path: string }).path : ''
  if (!doc || kind !== 'doc' || doc.path !== path || doc.readOnly || path.startsWith(WEREAD_FOLDER + '/')) {
    toast(`左边没开文档：这一段在「${WEREAD_FOLDER}/${p.book.title}」里`)
    return
  }
  for (const m of p.marks) doc.insertAtCursor(quoteMd(m, p.book, p.url), { focus: false })
  await doc.save()
  void window.cn.logActivity('clip', doc.path)
  const title = path.split('/').pop()!.replace(/\.md$/, '')
  toast(p.marks.length === 1 ? `已加到《${title}》` : `已加到《${title}》· ${p.marks.length}段`)
}

let listening = false
function listen() {
  if (listening || !window.cnPlugins) return
  listening = true
  window.cnPlugins.on(ID, 'highlight', (p) => void onHighlight(p as { book: BookInfo; url: string; marks: Mark[] }))
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
        <Toggle on={set.sync} label="划线和想法同步进素材" onChange={(v) => onChange({ sync: v })} />
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
