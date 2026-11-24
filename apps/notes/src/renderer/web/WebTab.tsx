import { Codicon } from '@cn/design'
import { useKeyHandler } from '../keys'
import { useEffect, useRef, useState } from 'react'
import { decodeUrl, toUrl } from '../url'
import { errText } from '../WebPanel'
import { app } from '../ctx/actions'
import { type NavState, WebView, type WebviewEl } from './WebView'
import { ActBtn, TabActs } from '../shell/TabActs'
import { Popover } from '../shell/Shell'
import { WebFind } from '../find/WebFind'
import { noteWebWc, touchWeb } from './web-pages'
import { AiActLayer } from '../ai-act'

/** 中间栏里的宽网页标签：一个网页单独开成一个标签读 */
export function WebTab(props: {
  /** 这个标签的 id（AI 操纵哪个网页认它，web/web-pages.ts） */
  id: string
  url: string
  active: boolean
  /** 重开软件时恢复的标签：点开才载入，网页里的视频不自己播（task-0t4jq） */
  restored?: boolean
  onUrl(url: string, title: string): void
  onNotice(t: string): void
  onClose(): void
  /** 放回右栏（task-05p2w：这一页的「⋯」，同标签右键），回到原来那一组 */
  onPutBack(): void
}) {
  const view = useRef<WebviewEl | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const [wc, setWc] = useState<number | null>(null)
  const [nav, setNav] = useState<NavState | null>(null)
  const [title, setTitle] = useState('')
  const [address, setAddress] = useState(decodeUrl(props.url))
  const addr = useRef<HTMLInputElement>(null)
  const cb = useRef(props)
  cb.current = props
  /** 标签条右端「⋯」开着的那颗（这一页的菜单：放回右栏） */
  const [more, setMore] = useState<HTMLElement | null>(null)
  /** 显示过：之后一直载着（恢复的标签在后面时先不载入） */
  const [shown, setShown] = useState(props.active)
  if (props.active && !shown) setShown(true)

  useEffect(() => {
    if (props.active && wc !== null) void window.cnWeb.setActiveTab(wc)
  }, [props.active, wc])
  // AI 操纵哪个网页：这一页的 webContents；换到这个标签算用户切到了它
  useEffect(() => {
    noteWebWc(props.id, wc)
    return () => noteWebWc(props.id, null)
  }, [props.id, wc])
  useEffect(() => {
    if (props.active && wc !== null) touchWeb(props.id)
  }, [props.active, wc])

  // 中间开着的宽网页：地址栏、重新载入的键（命令表）先归它；关掉是「关掉」（关当前标签）
  useKeyHandler('web-address', props.active ? () => (addr.current?.focus(), addr.current?.select(), true) : null, 1)
  useKeyHandler('web-reload', props.active ? () => (view.current?.reload(), true) : null, 1)

  async function clipPage() {
    try {
      const { path } = await window.cn.clipCurrentPage()
      props.onNotice(`整页存进收件箱了：${path.split('/').pop()?.replace(/\.md$/, '')}`)
    } catch (e) {
      props.onNotice(errText(e))
    }
  }

  const cur = nav?.url && /^https?:/.test(nav.url) ? nav.url : props.url

  return (
    <section className="pane wpane" hidden={!props.active}>
      {/* 这一页的「⋯」（task-05p2w 方向 A）：放回右栏。在中间开成一页时标题栏右上角那颗不出，回去走这里或标签右键 */}
      <TabActs active={props.active}>
        <ActBtn icon="ellipsis" label="更多" aria-expanded={!!more} on={!!more} onClick={(e) => setMore(more ? null : e.currentTarget)} />
      </TabActs>
      {more && props.active && (
        <Popover anchor={more} label="这一页" className="pop12 wput-pop" align="end" onClose={() => setMore(null)}>
          <button className="mi" role="menuitem" onClick={() => (setMore(null), props.onPutBack())}>
            <Codicon name="layout-sidebar-right" size={14} />
            放回右栏
            <span className="r">回到原来那一组</span>
          </button>
        </Popover>
      )}
      <div className="tool">
        <button className="iconbtn" aria-label="后退" disabled={!nav?.back} onClick={() => view.current?.goBack()}>
          <Codicon name="arrow-left" size={14} />
        </button>
        <button className="iconbtn" aria-label="前进" disabled={!nav?.forward} onClick={() => view.current?.goForward()}>
          <Codicon name="arrow-right" size={14} />
        </button>
        <button className="iconbtn" aria-label="重新载入" onClick={() => view.current?.reload()}>
          <Codicon name="refresh" size={14} className={nav?.loading ? 'spin' : ''} />
        </button>
        <form
          className="addr"
          onSubmit={(e) => {
            e.preventDefault()
            if (!address.trim()) return
            const u = toUrl(address)
            setAddress(decodeUrl(u))
            void view.current?.loadURL(u).catch(() => undefined)
          }}
        >
          <Codicon name="globe" size={13} />
          <input ref={addr} aria-label="网址" value={address} onChange={(e) => setAddress(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </form>
        <button className="iconbtn" aria-label="剪藏这一页" title="剪藏这一页：整页进收件箱" onClick={() => void clipPage()}>
          <Codicon name="quote" size={14} />
        </button>
      </div>
      <div className="wbody" ref={body}>
        {/* AI 在这一页动手：网页外圈和顶上提示条（和右栏那一页一样） */}
        <AiActLayer area="web" path={props.id} host={body} />
        {/* 在这个网页里找（⇧⌘F） */}
        <WebFind view={() => view.current} host={() => body.current} on={props.active} owner={'webtab:' + props.url} tab={props.url} />
        {shown && (
          <WebView
            initialUrl={props.url}
            visible
            hold={props.restored}
            onRef={(el) => (view.current = el)}
            onAttach={setWc}
            onNav={(n) => {
              setNav(n)
              if (/^https?:/.test(n.url)) {
                setAddress(decodeUrl(n.url))
                props.onUrl(n.url, title)
              }
            }}
            onTitle={(t) => {
              setTitle(t)
              props.onUrl(cur, t)
            }}
            menuHost={{ openTab: (u) => app().openInWeb(u), clipPage: () => void clipPage() }}
          />
        )}
      </div>
    </section>
  )
}
