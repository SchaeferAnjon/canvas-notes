/**
 * 微信读书在网页里的那半（隔离环境，网页脚本碰不到）：阅读页上告诉主进程在读哪本书（书的编号、书名、作者、这一章），
 * 用户松开鼠标、像是刚用微信读书自带的划线划了一段时，过一会儿让主进程去看有没有新的划线。
 * 不改微信读书的页面，不替它划线。主进程那半在 main/plugins/weread/。
 */
import { webFrame } from 'electron'
import { callPlugin, onPluginState, pluginEnabled } from './state'

const ID = 'weread'

interface Info {
  bookId: string
  title: string
  author: string
  chapter: string
}

/** 阅读页自己的数据（网页环境里的 __INITIAL_STATE__，几种写法都试一下） */
const read = (): Promise<Info | null> =>
  webFrame
    .executeJavaScript(
      `(() => { try {
        const s = window.__INITIAL_STATE__ || {}
        const r = s.reader || s.readerStore || {}
        const b = r.bookInfo || r.book || s.bookInfo || {}
        const c = r.currentChapter || r.chapter || {}
        const id = r.bookId || b.bookId || ''
        return id ? { bookId: String(id), title: String(b.title || document.title || ''), author: String(b.author || ''), chapter: String(c.title || '') } : null
      } catch (e) { return null } })()`,
    )
    .catch(() => null) as Promise<Info | null>

let last = ''
async function report() {
  if (!pluginEnabled(ID) || !/^\/web\/reader\//.test(location.pathname)) return
  const info = await read()
  if (!info) {
    // 阅读页上读不到书的编号：多半是微信读书改版了。记一条日志，也告诉主进程（划线时右下角说「没认出这本书」）
    if (last === location.href) return
    last = location.href
    console.warn('[canvas-notes] 微信读书：阅读页上读不到书的编号（__INITIAL_STATE__ 里没有 reader.bookId），网页可能改版了', location.pathname)
    await callPlugin(ID, 'page', {}).catch(() => undefined)
    return
  }
  const key = `${location.href}|${info.bookId}|${info.chapter}`
  if (key === last) return
  last = key
  await callPlugin(ID, 'page', info).catch((e: Error) => console.warn('[canvas-notes] 微信读书', e.message))
}

if (/^\/web\/reader\//.test(location.pathname)) {
  addEventListener('DOMContentLoaded', () => void report())
  addEventListener('load', () => void report())
  // 单页应用里翻章：网址变了再报一次
  setInterval(() => void report(), 2000)
  onPluginState(() => void report())
  let timer: ReturnType<typeof setTimeout> | undefined
  document.addEventListener(
    'mouseup',
    () => {
      if (!pluginEnabled(ID)) return
      clearTimeout(timer)
      // 划线菜单点完以后微信读书才存，等一会儿再看
      timer = setTimeout(() => void callPlugin(ID, 'check').catch(() => undefined), 1500)
    },
    true,
  )
}
