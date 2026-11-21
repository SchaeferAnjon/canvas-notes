/**
 * 设置 › 网页和视频（方向 A）：网页（地址栏搜索用、新网页标签打开、Chrome的登录、Chrome插件在哪管）、
 * 下载（右栏网页里的下载放哪，第一批新加）、视频（没字幕的视频打开就生成、听写密钥（以前在 AI 页最下面）、字幕在视频条里改）。
 */
import { Codicon } from '@cn/design'
import { withKeys } from '../keys'
import { useEffect, useRef, useState } from 'react'
import type { ChromeProfileInfo } from '../../shared/web-api'
import { SEARCH_ENGINES, type SearchEngine, type WebPrefs } from '../../shared/prefs'
import { dateText } from '../../shared/when'
import { usePluginOn } from '../plugins'
import { Toggle, type SettingsProps } from '../Settings'
import { errText } from '../settings-ai'
import { setVideoSettings, useVideoSettings } from '../video/store'
import { importChromeLogin, importedText, useChromeImportedAt } from '../web/chrome-login'
import { Group, Lnk, Row, Sel, useSaid } from './ui'

const DOWNLOADS: [WebPrefs['downloads'], string][] = [
  ['downloads', '下载（~/Downloads）'],
  ['vault', '库里的「附件/下载」'],
  ['ask', '每次问'],
]

export function WebPage(props: SettingsProps) {
  const said = useSaid()
  const w = props.settings.web
  const keeper = usePluginOn('bookmarks')
  const video = useVideoSettings()
  const set = <K extends keyof WebPrefs>(k: K, v: WebPrefs[K], hint: string) => {
    const old = w[k]
    if (old === v) return
    void props.onChange({ web: { [k]: v } })
    said.saved(hint, () => void props.onChange({ web: { [k]: old } }))
  }
  const engines = Object.keys(SEARCH_ENGINES) as SearchEngine[]
  return (
    <>
      <Group title="网页">
        <Row id="engine">
          <Sel label="地址栏搜索用" value={w.engine} options={engines.map((e) => [e, SEARCH_ENGINES[e].name] as const)} onChange={(v) => set('engine', v, `地址栏里打的不是网址时，用${SEARCH_ENGINES[v].name}搜`)} />
        </Row>
        <Row id="newTab" desc={keeper ? undefined : withKeys('{k:web-new-tab} 和标签条的 + · 书签管家插件关着，现在是空白页')}>
          <Sel
            label="新网页标签打开"
            value={w.newTab}
            options={[
              ['bookmarks', keeper ? '书签管家' : '书签管家（插件关着）'],
              ['blank', '空白页'],
            ]}
            onChange={(v) => set('newTab', v, withKeys(v === 'blank' ? '{k:web-new-tab} 以后开一页空白' : '{k:web-new-tab} 以后开书签管家'))}
          />
        </Row>
        <ChromeRow />
        <Row id="ext">
          <Lnk onClick={() => props.onGoPlace('web-extensions')}>在网页「⋯ › 插件」里管</Lnk>
        </Row>
      </Group>
      <Group title="下载">
        <Row id="dlDir">
          <Sel label="下载放在" value={w.downloads} options={DOWNLOADS} onChange={(v) => set('downloads', v, v === 'ask' ? '每次下载先问放哪' : `右栏网页里的下载放进「${DOWNLOADS.find((d) => d[0] === v)![1]}」`)} />
        </Row>
      </Group>
      <Group title="视频">
        <Row id="autoSubs">
          <Toggle
            on={video.autoStt}
            label="没字幕的视频打开就生成"
            onChange={(v) => {
              void setVideoSettings({ autoStt: v })
              said.saved(v ? '以后打开没字幕的视频就自动生成字幕；视频条里那个开关也开了' : '没字幕的视频不再自动生成；点「生成字幕」才生成', () => void setVideoSettings({ autoStt: !v }))
            }}
          />
        </Row>
        <SttKeyRow />
        <Row id="subsShow">
          <Lnk onClick={() => props.onGoPlace('video-subs')}>在视频条里改</Lnk>
        </Row>
      </Group>
    </>
  )
}

/** Chrome的登录：「再导入一次」；好几个 Chrome 用户时先选一个 */
function ChromeRow() {
  const said = useSaid()
  const at = useChromeImportedAt()
  const [profiles, setProfiles] = useState<ChromeProfileInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!profiles) return
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setProfiles(null)
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [profiles])
  async function run(id: string) {
    setProfiles(null)
    setBusy(true)
    try {
      said.say(importedText(await importChromeLogin(id)))
    } catch (e) {
      said.say(errText(e))
    } finally {
      setBusy(false)
    }
  }
  async function start() {
    try {
      const l = await window.cnWeb.chromeProfiles()
      if (!l.length) said.say('这台Mac上没找到Chrome的用户资料')
      else if (l.length === 1) await run(l[0]!.id)
      else setProfiles(l)
    } catch (e) {
      said.say(errText(e))
    }
  }
  return (
    <Row id="chrome" desc={at ? `上次导入 · ${dateText(at)}；macOS会问一次钥匙串` : '还没导入过；macOS会问一次钥匙串'}>
      <div className="sa-popwrap" ref={box}>
        <button type="button" className="sa-btn" disabled={busy} onClick={() => void start()}>
          {busy && <Codicon name="loading" size={14} className="spin" />}
          {busy ? '正在导入' : at ? '再导入一次' : '导入'}
        </button>
        {profiles && (
          <div className="sa-pop" role="menu" aria-label="选 Chrome 用户">
            <div className="mh">导入哪个 Chrome 用户的登录？</div>
            {profiles.map((p) => (
              <button key={p.id} type="button" role="menuitem" onClick={() => void run(p.id)}>
                <b>{p.name}</b>
                {p.account && <span>{p.account}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Row>
  )
}

/** 听写（Soniox）密钥：没字幕的视频「生成字幕」时用（CN-69）。加密存在这台 Mac 上，界面只看得到最后 4 位 */
function SttKeyRow() {
  const said = useSaid()
  const [st, setSt] = useState<{ has: boolean; tail: string | null; fromEnv: boolean } | null>(null)
  const [val, setVal] = useState('')
  useEffect(() => void window.cnVideo.sttKey().then(setSt), [])
  const save = async (key: string | null) => {
    try {
      setSt(await window.cnVideo.setSttKey(key))
      setVal('')
      said.say(key ? '已存 · Soniox密钥' : 'Soniox密钥删掉了')
    } catch (err) {
      said.say(errText(err))
    }
  }
  return (
    <Row
      id="soniox"
      full
      desc={
        <>
          没字幕的视频「生成字幕」时用 ·{' '}
          <span data-testid="stt-key-state">{st?.tail ? `已填 ••••${st.tail}，加密存在这台Mac上` : st?.fromEnv ? '用的是环境变量SONIOX_API_KEY' : '还没填：到soniox.com注册后在控制台拿一个API Key'}</span>
        </>
      }
    >
      <form
        className="sa-inline"
        onSubmit={(e) => {
          e.preventDefault()
          if (val.trim()) void save(val)
        }}
      >
        <input className="sa-fld" type="password" aria-label="Soniox 密钥" placeholder={st?.tail ? `已填 ••••${st.tail}` : '粘贴Soniox的API Key'} value={val} onChange={(e) => setVal(e.target.value)} />
        <button type="submit" className="sa-btn" disabled={!val.trim()}>
          <Codicon name="save" size={14} />
          保存
        </button>
        {st?.tail && (
          <button type="button" className="sa-btn ghost" onClick={() => void save(null)}>
            删掉
          </button>
        )}
      </form>
    </Row>
  )
}
