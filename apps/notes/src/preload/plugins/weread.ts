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

/** 注释气泡离网页左右边至少留这么多 */
const EDGE = 8
/** 箭头（16 宽）离气泡左右边至少这么多，不压到 16 的圆角上 */
const ARROW_KEEP = 24

/**
 * task-rbtrz：正文里点「注」，微信读书把注释气泡（.reader_footerNote_container，304 宽）的正中对着「注」摆，
 * 不管网页多宽。普通浏览器里正文两边有留白，放得下；我们的网页栏窄，靠左的「注」算出来左边是负的，气泡半截在栏外（用户：「这里有遮挡」）。
 * 气泡出了网页时横着挪回来（translate，微信读书自己写的 left、top 不动），左右各留 8；箭头跟着反方向挪，还对着那个「注」。
 * 放得下的时候不动。
 */
function keepFootnotesInside() {
  const style = document.createElement('style')
  style.textContent = '.reader_footerNote_container::after{left:var(--cn-fn-arrow,50%)!important}'
  const fit = (el: HTMLElement) => {
    if (!pluginEnabled(ID)) return
    const r = el.getBoundingClientRect()
    if (!r.width) return
    const moved = Number(el.dataset.cnDx || 0)
    const left = r.left - moved
    const vw = document.documentElement.clientWidth
    let dx = 0
    if (left < EDGE) dx = EDGE - left
    else if (left + r.width > vw - EDGE) dx = Math.max(EDGE - left, vw - EDGE - left - r.width)
    dx = Math.round(dx)
    if (dx === moved) return
    el.dataset.cnDx = String(dx)
    if (!dx) {
      el.style.removeProperty('translate')
      el.style.removeProperty('--cn-fn-arrow')
      return
    }
    el.style.translate = `${dx}px 0`
    el.style.setProperty('--cn-fn-arrow', `${Math.min(r.width - ARROW_KEEP, Math.max(ARROW_KEEP, r.width / 2 - dx))}px`)
  }
  // 气泡是点了「注」才挂上去的，下一拍才写 left、top（写一次 style）：挂上去时盯住它的 style
  const watchStyle = new MutationObserver((recs) => {
    for (const rec of recs) fit(rec.target as HTMLElement)
  })
  const added = new MutationObserver((recs) => {
    for (const rec of recs)
      for (const n of rec.addedNodes) {
        if (!(n instanceof HTMLElement)) continue
        const els = n.classList.contains('reader_footerNote_container') ? [n] : [...n.getElementsByClassName('reader_footerNote_container')]
        for (const el of els as HTMLElement[]) {
          watchStyle.observe(el, { attributes: true, attributeFilter: ['style'] })
          fit(el)
        }
      }
  })
  const start = () => {
    document.head.append(style)
    added.observe(document.body, { childList: true, subtree: true })
  }
  if (document.body) start()
  else addEventListener('DOMContentLoaded', start, { once: true })
  addEventListener('resize', () => document.querySelectorAll<HTMLElement>('.reader_footerNote_container').forEach(fit))
}

if (/^\/web\/reader\//.test(location.pathname)) {
  addEventListener('DOMContentLoaded', () => void report())
  addEventListener('load', () => void report())
  // 单页应用里翻章：网址变了再报一次
  setInterval(() => void report(), 2000)
  onPluginState(() => void report())
  // CN-120：阅读页里按 Tab，焦点跳到阅读区外面藏着的按钮（右边那排竖着的工具），浏览器为了让它露出来把阅读区（overflow: hidden，
  // 自己滚不动的）横着滚开，整页往左错开、每行开头的字被切掉。焦点不在输入框里时拦下 Tab；万一还是被滚开（网页自己挪焦点），横向滚动复位
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab' || !pluginEnabled(ID)) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
    },
    true,
  )
  document.addEventListener(
    'scroll',
    (e) => {
      if (!pluginEnabled(ID)) return
      const el = e.target === document ? document.scrollingElement : e.target
      if (!(el instanceof Element) || el.scrollLeft === 0) return
      const ox = getComputedStyle(el).overflowX
      const root = el === document.scrollingElement && getComputedStyle(document.body).overflowX
      if (ox === 'hidden' || ox === 'clip' || root === 'hidden' || root === 'clip') el.scrollLeft = 0
    },
    true,
  )
  keepFootnotesInside()
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
