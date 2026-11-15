import { Icon } from '@cn/design'
import { ArrowLeft, ArrowRight, ArrowRightToLine, Globe, RotateCw, Scissors } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Clip } from '../../shared/api'
import { decodeUrl, toUrl } from '../url'
import { errText } from '../WebPanel'
import { type NavState, WebView, type WebviewEl } from './WebView'

/** 中间栏里的宽网页标签：一个网页单独开成一个标签读 */
export function WebTab(props: {
  url: string
  active: boolean
  onUrl(url: string, title: string): void
  onClip(c: Clip): void
  onNotice(t: string): void
  /** 放回右栏 */
  onToRight(url: string): void
  onClose(): void
}) {
  const view = useRef<WebviewEl | null>(null)
  const [wc, setWc] = useState<number | null>(null)
  const [nav, setNav] = useState<NavState | null>(null)
  const [title, setTitle] = useState('')
  const [address, setAddress] = useState(decodeUrl(props.url))
  const addr = useRef<HTMLInputElement>(null)
  const cb = useRef(props)
  cb.current = props

  useEffect(() => {
    if (props.active && wc !== null) void window.cnWeb.setActiveTab(wc)
  }, [props.active, wc])

  // 网页焦点时的 ⌘W、⌘L（⌘T 由右栏开新网页）
  useEffect(() => {
    if (wc === null) return
    return window.cnWeb.onKey((k, id) => {
      if (id !== wc) return
      if (k === 'w') cb.current.onClose()
      else if (k === 'l') addr.current?.focus()
    })
  }, [wc])

  async function clipPage() {
    try {
      const path = await window.cn.clipCurrentPage()
      props.onNotice(`整页存进收件箱了：${path.split('/').pop()?.replace(/\.md$/, '')}`)
    } catch (e) {
      props.onNotice(errText(e))
    }
  }

  const cur = nav?.url && /^https?:/.test(nav.url) ? nav.url : props.url

  return (
    <section className="pane wpane" hidden={!props.active}>
      <div className="tool">
        <button className="iconbtn" aria-label="后退" disabled={!nav?.back} onClick={() => view.current?.goBack()}>
          <Icon of={ArrowLeft} size={14} />
        </button>
        <button className="iconbtn" aria-label="前进" disabled={!nav?.forward} onClick={() => view.current?.goForward()}>
          <Icon of={ArrowRight} size={14} />
        </button>
        <button className="iconbtn" aria-label="重新载入" onClick={() => view.current?.reload()}>
          <Icon of={RotateCw} size={14} className={nav?.loading ? 'spin' : ''} />
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
          <Icon of={Globe} size={13} />
          <input ref={addr} aria-label="网址" value={address} onChange={(e) => setAddress(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </form>
        <button className="iconbtn" aria-label="整页剪藏" title="整页剪进收件箱" onClick={() => void clipPage()}>
          <Icon of={Scissors} size={14} />
        </button>
        <button className="wtool wwide" title="放回右栏：网页回到右栏，边看边记" onClick={() => props.onToRight(cur)}>
          <Icon of={ArrowRightToLine} size={14} />
          放回右栏
        </button>
      </div>
      <div className="wbody">
        <WebView
          initialUrl={props.url}
          visible
          clipMode={{ mode: 'inbox' }}
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
          onClip={props.onClip}
        />
      </div>
    </section>
  )
}
