/**
 * 设置 › 网页和视频（方向 A）：网页（地址栏搜索用、新网页标签打开、Chrome的登录、Chrome插件在哪管）、
 * 下载（右栏网页里的下载放哪，第一批新加）、视频（没字幕的视频打开就生成、听写密钥（以前在 AI 页最下面）、字幕在视频条里改）。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
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
import { t as tNow } from '../../shared/i18n'
import { useT } from '../i18n'
import { Group, Lnk, Row, Sel, useSaid } from './ui'

/** 下载放哪的几样（说的那一刻的界面语言） */
const downloads = (): [WebPrefs['downloads'], string][] => [
  ['downloads', tNow('下载（~/Downloads）')],
  ['vault', tNow('库里的「附件/下载」')],
  ['ask', tNow('每次问')],
]

export function WebPage(props: SettingsProps) {
  const t = useT()
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
      <Group title={t('网页')}>
        <Row id="engine">
          <Sel label={t('地址栏搜索用')} value={w.engine} options={engines.map((e) => [e, t(SEARCH_ENGINES[e].name)] as const)} onChange={(v) => set('engine', v, t('地址栏里打的不是网址时，用{name}搜', { name: t(SEARCH_ENGINES[v].name) }))} />
        </Row>
        <Row id="newTab" desc={keeper ? undefined : withKeys(t('{k:web-new-tab} 和标签条的 + · 书签管家插件关着，现在是空白页'))}>
          <Sel
            label={t('新网页标签打开')}
            value={w.newTab}
            options={[
              ['bookmarks', keeper ? t('书签管家') : t('书签管家（插件关着）')],
              ['blank', t('空白页')],
            ]}
            onChange={(v) => set('newTab', v, withKeys(v === 'blank' ? t('{k:web-new-tab} 以后开一页空白') : t('{k:web-new-tab} 以后开书签管家')))}
          />
        </Row>
        <ChromeRow />
        <Row id="ext">
          <Lnk onClick={() => props.onGoPlace('web-extensions')}>{t('在网页「⋯ › 插件」里管')}</Lnk>
        </Row>
        <Row id="keepRecent">
          <Toggle on={w.keepRecent} label={t('记下看过的网页')} onChange={(v) => set('keepRecent', v, v ? t('右栏看过的网页记进左栏「最近」') : t('不再记看过的网页；「最近」里也不列'))} />
        </Row>
      </Group>
      <Group title={t('下载')}>
        <Row id="dlDir">
          <Sel label={t('下载放在')} value={w.downloads} options={downloads()} onChange={(v) => set('downloads', v, v === 'ask' ? t('每次下载先问放哪') : t('右栏网页里的下载放进「{place}」', { place: downloads().find((d) => d[0] === v)![1] }))} />
        </Row>
      </Group>
      <Group title={t('视频')}>
        <Row id="autoSubs">
          <Toggle
            on={video.autoStt}
            label={t('没字幕的视频打开就生成')}
            onChange={(v) => {
              void setVideoSettings({ autoStt: v })
              said.saved(v ? t('以后打开没字幕的视频就自动生成字幕；视频条里那个开关也开了') : t('没字幕的视频不再自动生成；点「生成字幕」才生成'), () => void setVideoSettings({ autoStt: !v }))
            }}
          />
        </Row>
        <SttKeyRow />
        <Row id="subsShow">
          <Lnk onClick={() => props.onGoPlace('video-subs')}>{t('在视频条里改')}</Lnk>
        </Row>
      </Group>
    </>
  )
}

/** Chrome的登录：「再导入一次」；好几个 Chrome 用户时先选一个 */
function ChromeRow() {
  const t = useT()
  const said = useSaid()
  const at = useChromeImportedAt()
  const [profiles, setProfiles] = useState<ChromeProfileInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(!!profiles, [box], () => setProfiles(null))
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
      if (!l.length) said.say(t('这台Mac上没找到Chrome的用户资料'))
      else if (l.length === 1) await run(l[0]!.id)
      else setProfiles(l)
    } catch (e) {
      said.say(errText(e))
    }
  }
  return (
    <Row id="chrome" desc={at ? t('上次导入 · {date}；macOS会问一次钥匙串', { date: dateText(at) }) : t('还没导入过；macOS会问一次钥匙串')}>
      <div className="sa-popwrap" ref={box}>
        <button type="button" className="sa-btn" disabled={busy} onClick={() => void start()}>
          {busy && <Codicon name="loading" size={14} className="spin" />}
          {busy ? t('正在导入') : at ? t('再导入一次') : t('导入', { ctx: 'Chrome的登录' })}
        </button>
        {profiles && (
          <div className="sa-pop" role="menu" aria-label={t('选 Chrome 用户')}>
            <div className="mh">{t('导入哪个 Chrome 用户的登录？')}</div>
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

/** 听写（Soniox）密钥：没字幕的视频「生成字幕」（CN-69）和费曼的语音输入（task-yvabi）都用它。加密存在这台 Mac 上，界面只看得到最后 4 位 */
function SttKeyRow() {
  const t = useT()
  const said = useSaid()
  const [st, setSt] = useState<{ has: boolean; tail: string | null; fromEnv: boolean } | null>(null)
  const [val, setVal] = useState('')
  useEffect(() => void window.cnVideo.sttKey().then(setSt), [])
  const save = async (key: string | null) => {
    try {
      setSt(await window.cnVideo.setSttKey(key))
      setVal('')
      said.say(key ? t('已存 · Soniox密钥') : t('Soniox密钥删掉了'))
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
          {t('生成字幕和费曼的语音输入都用它')} ·{' '}
          <span data-testid="stt-key-state">{st?.tail ? t('已填 ••••{tail}，加密存在这台Mac上', { tail: st.tail }) : st?.fromEnv ? t('用的是环境变量SONIOX_API_KEY') : t('还没填：到soniox.com注册后在控制台拿一个API Key')}</span>
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
        <input className="sa-fld" type="password" aria-label={t('Soniox 密钥')} placeholder={st?.tail ? t('已填 ••••{tail}', { tail: st.tail }) : t('粘贴Soniox的API Key')} value={val} onChange={(e) => setVal(e.target.value)} />
        <button type="submit" className="sa-btn" disabled={!val.trim()}>
          <Codicon name="save" size={14} />
          {t('保存')}
        </button>
        {st?.tail && (
          <button type="button" className="sa-btn ghost" onClick={() => void save(null)}>
            {t('删掉')}
          </button>
        )}
      </form>
    </Row>
  )
}
