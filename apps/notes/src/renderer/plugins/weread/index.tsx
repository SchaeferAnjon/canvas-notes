/**
 * 微信读书界面这半：主进程发来新划的一段，插进左边开着的文档光标处（引文 + 书名章节 + 回到微信读书的链接），
 * 右下角一行提示「已加到《…》」；设置 › 插件 里开关、同步状态、上次同步的时间、「现在同步」。
 * 没有书架页、没有写想法的框（偏好「微信读书划线进左边文档」）：读书笔记就写在左边那篇里。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { type BookInfo, type Mark, normalizeWeread, quoteMd, WEREAD_FOLDER, type WereadStatus } from '../../../shared/plugins/weread'
import { Toggle } from '../../Settings'
import { centerNow } from '../../video/store'
import { errText } from '../host'
import type { RendererPlugin } from '../types'
import './weread.css'

const ID = 'weread'

/** 右下角一行，3 秒后自己收起（不抢焦点） */
function toast(text: string) {
  let el = document.getElementById('wr-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'wr-toast'
    el.className = 'wr-toast'
    el.setAttribute('role', 'status')
    document.body.appendChild(el)
  }
  el.textContent = text
  el.classList.add('on')
  clearTimeout((el as HTMLElement & { _t?: number })._t)
  ;(el as HTMLElement & { _t?: number })._t = window.setTimeout(() => el!.classList.remove('on'), 3500)
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
  for (const m of p.marks) doc.insertAtCursor(quoteMd(m, p.book, p.url))
  await doc.save()
  void window.cn.logActivity('clip', doc.path)
  const title = path.split('/').pop()!.replace(/\.md$/, '')
  toast(p.marks.length === 1 ? `已加到《${title}》` : `已加到《${title}》· ${p.marks.length} 段`)
}

let listening = false
function listen() {
  if (listening || !window.cnPlugins) return
  listening = true
  window.cnPlugins.on(ID, 'highlight', (p) => void onHighlight(p as { book: BookInfo; url: string; marks: Mark[] }))
}
listen()

const time = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  const today = new Date().toDateString() === d.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return today ? `今天 ${hm}` : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`
}

function statusText(s: WereadStatus | null): string {
  if (!s) return ''
  if (s.syncing) return '正在同步…'
  if (s.state === 'login') return s.error ?? '没登录微信读书'
  if (s.state === 'error') return `上次没同步成：${s.error ?? ''}`
  if (s.state === 'never' && !s.lastSync) return '还没同步过：在右栏打开一本书就会同步那一本，或者点「现在同步」'
  return `已同步${s.books ? ` ${s.books} 本书、${s.marks} 条划线` : ''} · 上次 ${time(s.lastSync)}`
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
      <div className="pair wr-sync">
        <span className={'wr-st' + (st?.state === 'login' || st?.state === 'error' ? ' bad' : '')} aria-label="同步状态">
          {statusText(st)}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!set.sync || st?.syncing}
          onClick={() => void window.cnPlugins.call<WereadStatus>(ID, 'syncAll').then(setSt, (e) => onNotice(errText(e)))}
        >
          <Codicon name="refresh" size={13} className={st?.syncing ? 'spin' : ''} />
          现在同步
        </button>
      </div>
      <p className="note">只读微信读书，不往它那边写。一本书一篇，按章节排，想法跟在它那一段后面；用的是右栏网页里登录的微信读书。</p>
    </>
  )
}

export const weread: RendererPlugin = {
  id: ID,
  icon: 'book',
  Settings: WereadSettingsPane,
}
