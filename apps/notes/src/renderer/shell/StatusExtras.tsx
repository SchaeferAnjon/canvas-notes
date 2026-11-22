import { Codicon } from '@cn/design'
import { useState, useSyncExternalStore } from 'react'
import { engineMeta, STATE_TEXT } from '../../shared/plugins/translate'
import { when } from '../../shared/when'
import { pluginInfo, setPluginSettings, usePlugins, errText } from '../plugins/host'
import { EngineLogo, ID as TRANSLATE, openTranslateSettings, settingsNow, useEngines } from '../plugins/translate/shared'
import { MenuItem, Popover } from './Shell'
import { useT } from '../i18n'

/**
 * A 风格底栏右端多出来的两项（设计稿 design/frame「底栏」：译 · Claude Code ｜ 新版本 ｜ 本周 N 次提交 ｜ 通知铃 ｜ AI）。
 * B 的底栏只留几项，这两样不放（B 的翻译引擎在网页地址栏的翻译菜单和设置里换）。
 */

/** 「译 · Claude Code」：网页、视频字幕、右键翻译这段现在用哪个 AI；点开换（同 设置 › 插件 › 双语翻译 的「只用某家」）。翻译插件关着时没有这一项 */
export function TranslateItem() {
  const t = useT()
  usePlugins()
  const s = settingsNow()
  const [engines] = useEngines(false, [s.engineMode, s.pick, s.engineOrder.join()])
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [err, setErr] = useState<string | null>(null)
  if (!pluginInfo(TRANSLATE)?.enabled) return null
  const cur = engines?.current ?? null
  const name = cur ? engineMeta(cur).name : engines ? t('没有能翻的') : '…'
  return (
    <>
      <button className={'bi' + (el ? ' on' : '')} data-tip={t('翻译用哪个AI')} data-side="above" data-testid="translate-engine" aria-expanded={!!el} onClick={(e) => (setErr(null), setEl(el ? null : e.currentTarget))}>
        {/* 画翻译现在用的那一家（和后面写的名字同一家）；没有能翻的照旧「ab」 */}
        {cur ? <EngineLogo id={cur} size={14} /> : <Codicon name="whole-word" size={14} />}
        <span>{t('译 · {name}', { name })}</span>
      </button>
      {el && (
        <Popover anchor={el} label={t('翻译用哪个AI')} onClose={() => setEl(null)}>
          <div className="mh">{t('网页和视频翻译用')}</div>
          {engines?.list.map((e) => (
            <MenuItem
              key={e.id}
              icon={e.id === cur ? 'check' : undefined}
              label={
                <span className="tr-eng">
                  <EngineLogo id={e.id} size={14} />
                  {e.name}
                </span>
              }
              right={e.state === 'ok' ? undefined : t(STATE_TEXT[e.state])}
              disabled={e.state !== 'ok'}
              onClick={() => void setPluginSettings(TRANSLATE, { engineMode: 'pick', pick: e.id }).then(() => setEl(null), (x) => setErr(errText(x)))}
            />
          ))}
          {err && <div className="mwarn">{err}</div>}
          <div className="ms" />
          <MenuItem icon="settings-gear" label={t('翻译设置…')} onClick={() => (setEl(null), openTranslateSettings())} />
        </Popover>
      )}
    </>
  )
}

// ---------- 通知：这次打开以来底栏说过的话（提示条几秒就收，这里还能再看） ----------

interface Note {
  text: string
  at: number
}
let notes: Note[] = []
let seenAt = 0
let snap = { notes, unseen: false }
const subs = new Set<() => void>()
const emit = () => {
  snap = { notes, unseen: notes.some((n) => n.at > seenAt) }
  for (const f of subs) f()
}
/** 底栏的提示条说了一句：记下（最多 30 条，新的在前；同一句连着说只记一次） */
export function logNotice(text: string) {
  if (notes[0]?.text === text && Date.now() - notes[0].at < 2000) return
  notes = [{ text, at: Date.now() }, ...notes].slice(0, 30)
  emit()
}
const useNotes = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => snap,
  )

/** 通知铃：有没看过的提示时右上一个小点；点开列出这次打开以来的提示（时间 + 原话），「清除」清空 */
export function BellItem() {
  const t = useT()
  const { notes: list, unseen } = useNotes()
  const [el, setEl] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        className={'bi bell' + (el ? ' on' : '')}
        aria-label={t('通知')}
        data-tip={t('通知')}
        data-side="above-left"
        data-testid="bell"
        aria-expanded={!!el}
        onClick={(e) => {
          setEl(el ? null : e.currentTarget)
          seenAt = Date.now()
          emit()
        }}
      >
        <Codicon name="bell" size={14} />
        {unseen && <i className="bdot" data-testid="bell-dot" />}
      </button>
      {el && (
        <Popover anchor={el} label={t('通知')} className="notices" onClose={() => setEl(null)}>
          <div className="mh">{t('通知')}</div>
          {list.length ? (
            <div className="nlist">
              {list.map((n) => (
                <div key={n.at + n.text} className="nrow">
                  <span className="t">{n.text}</span>
                  <span className="when">{when(n.at, { time: true })}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="nempty">{t('没有新通知')}</p>
          )}
          {list.length > 0 && (
            <div className="btns">
              <button
                className="btn btn-sm"
                onClick={() => {
                  notes = []
                  emit()
                  setEl(null)
                }}
              >
                {t('清除')}
              </button>
            </div>
          )}
        </Popover>
      )}
    </>
  )
}
