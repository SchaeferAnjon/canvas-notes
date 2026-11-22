/**
 * 检查更新的界面：设置 ›「更新」页、底栏最右端「● 重启更新到 x」/「● 更新没装上」。
 * 设计规格见 DESIGN.md「底栏 Git」；状态由主线 src/main/updater.ts 推过来，这里只画。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import type { UpdateState } from '../shared/api'
import { BRAND } from '../shared/brand'
import { updateError, updateLine } from '../shared/update'
import appIcon from './assets/app-icon.png'
import { Toggle } from './Settings'
import { useT } from './i18n'

/** 主线推来的更新状态；一打开就先拿一次（设置秒开，不等网络） */
export function useUpdateState(): UpdateState | null {
  const [st, setSt] = useState<UpdateState | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.updateStatus().then((s) => live && setSt(s))
    const off = window.cn.onUpdateState(setSt)
    return () => {
      live = false
      off()
    }
  }, [])
  return st
}

/** 底栏要不要出一项：下好了，或者找到了新版却装不上 */
export function barKind(st: UpdateState | null): 'ready' | 'failed' | null {
  if (!st) return null
  if (st.phase === 'ready') return 'ready'
  if (st.phase === 'error' && updateError(st.error, st.version).blocking) return 'failed'
  return null
}

/** 底栏最右端那一项 */
export function UpdateBarItem(props: { st: UpdateState | null; onInstall(): Promise<void>; onOpenSettings(): void }) {
  const t = useT()
  const kind = barKind(props.st)
  const [busy, setBusy] = useState(false)
  if (!kind || !props.st) return null
  if (kind === 'failed')
    return (
      <>
        <i className="vsep" />
        <button className="bi upd" data-testid="update-bar" onClick={props.onOpenSettings} title={t('新版本没装上，点开看原因')}>
          <i className="udot err" />
          {t('更新没装上')}
        </button>
      </>
    )
  const v = props.st.version
  return (
    <>
      <i className="vsep" />
      <button
        className="bi upd"
        data-testid="update-bar"
        disabled={busy}
        title={t('新版本 {v} 已下好。点一下重启装上，打开的标签都会回来；不点也行，下次退出时自动装上。', { v })}
        onClick={() => {
          setBusy(true)
          void props.onInstall().finally(() => setBusy(false))
        }}
      >
        {busy ? <Codicon name="loading" size={12} className="spin" /> : <i className="udot" />}
        {busy ? (
          t('正在重启…')
        ) : (
          <span className="upd-t">
            {t('重启更新')}
            <span className="upd-v">{t('到{v}', { v })}</span>
          </span>
        )}
      </button>
    </>
  )
}

/** 设置 › 更新 */
export function UpdatePage(props: { autoUpdate: boolean; onAutoUpdate(v: boolean): void; onInstall(): Promise<void>; onOpenUrl(url: string): void }) {
  const t = useT()
  const st = useUpdateState()
  const [checking, setChecking] = useState(false)
  const [moveErr, setMoveErr] = useState('')
  if (!st) return null
  const off = st.phase === 'off'
  const err = st.phase === 'error' ? updateError(st.error, st.version) : null
  const busy = checking || st.phase === 'checking' || st.phase === 'downloading'
  const line = moveErr ? t('没挪成：{err}', { err: moveErr }) : updateLine(st, props.autoUpdate)

  async function check() {
    setChecking(true)
    try {
      await window.cn.checkUpdate()
    } finally {
      setChecking(false)
    }
  }
  async function move() {
    setMoveErr('')
    try {
      await window.cn.moveToApps()
    } catch (e) {
      setMoveErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <h4>
        {t('版本')}
        <span>{t('{app}从GitHub上的正式版更新', { app: BRAND.name })}</span>
      </h4>
      <div className="card-row upd-card" data-testid="update-card">
        <img className="upd-icon" src={appIcon} alt="" draggable={false} />
        <div className="tx">
          <b>
            {BRAND.name} <em className="num">{st.current}</em>
          </b>
          <span className={'upd-line' + (err || moveErr ? ' err' : '')} title={line} data-testid="update-line">
            {(err || moveErr) && <i className={'udot ' + (err?.soft ? 'soft' : 'err')} />}
            {line}
            {st.phase === 'ready' && (
              <>
                {' · '}
                <button className="upd-link" onClick={() => void window.cn.releaseUrl().then(props.onOpenUrl)}>
                  {t('看看改了什么')}
                </button>
              </>
            )}
          </span>
          {st.phase === 'downloading' && (
            <span className="upd-bar" aria-hidden>
              <i style={{ width: `${st.percent}%` }} />
            </span>
          )}
        </div>
        <div className="upd-acts">
          {err?.action === 'site' && (
            <button className="btn btn-sm" onClick={() => props.onOpenUrl(BRAND.site)}>
              <Codicon name="globe" size={14} />
              {t('去官网下载')}
            </button>
          )}
          {st.phase === 'ready' ? (
            <button className="btn btn-sm btn-primary" onClick={() => void props.onInstall()}>
              {t('重启更新')}
            </button>
          ) : (
            <button className="btn btn-sm" disabled={off || busy} onClick={() => void check()}>
              <Codicon name="refresh" size={14} className={st.phase === 'checking' || checking ? 'spin' : ''} />
              {st.phase === 'checking' || checking ? t('正在检查') : err ? t('再查一次') : t('检查更新')}
            </button>
          )}
        </div>
      </div>
      {!st.inApps && !off && (
        <div className="callout" data-testid="update-not-in-apps">
          <Codicon name="warning" size={16} className="warn" />
          <div className="tx">
            <b>{t('{app}不在「应用程序」文件夹里', { app: BRAND.name })}</b>
            <span>{t('从「下载」或安装盘里直接打开时，新版本可能装不上')}</span>
            <div className="upd-acts left">
              <button className="btn btn-sm" onClick={() => void move()}>
                {t('挪到「应用程序」并重开')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void window.cn.revealApp()}>
                <Codicon name="search" size={14} />
                {t('在Finder中显示')}
              </button>
            </div>
          </div>
        </div>
      )}
      <h4>
        {t('自动更新')}
        <span>{t('有新版本在后台下载，下好后提示你重启')}</span>
      </h4>
      <div className={'pair' + (off ? ' dim' : '')}>
        <Toggle on={props.autoUpdate && !off} label={t('自动检查并下载新版本')} onChange={(v) => !off && props.onAutoUpdate(v)} />
        <span>{t('自动检查并下载新版本')}</span>
      </div>
      <p className="note">
        {off
          ? t('开发版和自己打的包不查更新；正式版从官网或GitHub Release下载。')
          : t('启动30秒后查一次，之后每6小时查一次，只连GitHub。下好后底栏右边出现「重启更新」；不点也行，下次退出时自动装上。')}
      </p>
    </>
  )
}
