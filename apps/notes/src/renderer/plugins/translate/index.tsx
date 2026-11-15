/**
 * 双语翻译界面这半：网页标签条右边的按钮（⌥A）、⌘F 里的「双语翻译这个网页」、设置里选翻成什么和怎么显示。
 * 真正改网页的是 preload/plugins/translate.ts，这里只给它发 toggle。
 */
import { Icon } from '@cn/design'
import { Languages, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Display, LANGS, langName, normalizeTranslate } from '../../../shared/plugins/translate'
import { errText, pageStateOf, usePageState, webHost } from '../host'
import type { RendererPlugin, WebPage } from '../types'

const ID = 'translate'

/** 网页报上来的：开没开、翻成什么、翻好几段、还在翻几段 */
interface TrState {
  on: boolean
  target: string
  done: number
  busy: number
}

function toggle(page: WebPage | null) {
  const h = webHost()
  if (!h) return
  if (!page?.url) {
    h.show()
    h.notice('先在右栏打开一个网页，再开双语翻译')
    return
  }
  h.show()
  h.command(page.wcId, ID, 'toggle')
}

const editable = (el: Element | null) => !!el && ((el as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

export const translate: RendererPlugin = {
  id: ID,
  icon: Languages,
  button: {
    slot: 'address',
    menu: { label: '双语翻译', keys: '⌥A' },
    useLook(page) {
      const st = usePageState<TrState>(page?.wcId, ID)
      // 焦点在软件界面（不是网页、不在输入框里）时 ⌥A 也开关当前网页；网页里的 ⌥A 由网页预加载自己接
      useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code !== 'KeyA') return
          const h = webHost()
          if (!h?.visible() || editable(document.activeElement)) return
          e.preventDefault()
          toggle(h.page())
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      const on = !!st?.on
      return {
        label: '双语翻译',
        title: on ? `双语对照中（翻成${langName(st!.target)}${st!.busy ? `，还在翻 ${st!.busy} 段` : ''}）· 再按一次恢复原文 ⌥A` : '双语翻译：每段下面加译文 ⌥A',
        icon: Languages,
        on,
      }
    },
    click: toggle,
  },
  commands(page) {
    const on = !!page && !!pageStateOf<TrState>(page.wcId, ID)?.on
    return [
      {
        name: on ? '恢复原文' : '双语翻译这个网页',
        hint: on ? '双语翻译 · 拿掉译文' : '双语翻译 · 每段下面加译文',
        icon: Languages,
        keys: '⌥A',
        run: () => toggle(webHost()?.page() ?? null),
      },
    ]
  },
  Settings({ info, onChange, onNotice }) {
    const s = normalizeTranslate(info.settings)
    const [engine, setEngine] = useState('')
    const [cached, setCached] = useState<number | null>(null)
    useEffect(() => {
      void window.cnPlugins.call<string>(ID, 'engine').then(setEngine, () => undefined)
      void window.cnPlugins.call<{ cached: number }>(ID, 'stats').then((r) => setCached(r.cached), () => undefined)
    }, [info.enabled])
    const modes: { id: Display; name: string }[] = [
      { id: 'below', name: '译文在下' },
      { id: 'only', name: '只看译文' },
    ]
    return (
      <>
        <div className="pair">
          <span>翻成</span>
          <select aria-label="翻成" value={s.target} onChange={(e) => onChange({ target: e.target.value })}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="note plug-inline">网页本身就是这种语言时，中文翻成英文，别的翻成简体中文</span>
        </div>
        <div className="pair">
          <span>显示</span>
          <div className="seg" role="radiogroup" aria-label="译文怎么显示">
            {modes.map((m) => (
              <button key={m.id} role="radio" aria-checked={s.display === m.id} className={s.display === m.id ? 'on' : ''} onClick={() => onChange({ display: m.id })}>
                {m.name}
              </button>
            ))}
          </div>
        </div>
        <div className="pair plain">
          <span className="note">
            用 {engine || '本机的 AI 命令行'} 翻，一批段落问一次；翻过的段记在本机，同一段不再问
            {cached !== null && `（已记 ${cached} 段）`}
          </span>
          {!!cached && (
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await window.cnPlugins.call(ID, 'clearCache')
                  setCached(0)
                  onNotice('翻译缓存清空了')
                } catch (e) {
                  onNotice(errText(e))
                }
              }}
            >
              <Icon of={Trash2} size={13} />
              清空
            </button>
          )}
        </div>
      </>
    )
  },
}
