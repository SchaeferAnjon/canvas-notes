/**
 * 设置 › 一般（方向 A）：启动和窗口（打开时回到上次的样子、菜单栏图标）、速记（全局键、带上来源）、更新（以前的「更新」页并进来）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { BRAND } from '../../shared/brand'
import { updateError, updateLine } from '../../shared/update'
import type { GeneralPrefs } from '../../shared/prefs'
import { Toggle, type SettingsProps } from '../Settings'
import { useUpdateState } from '../update'
import { useKeyRecorder, useKeySlots } from './keys'
import { Group, hintFor, Row, useSaid } from './ui'

const HINT: Partial<Record<keyof GeneralPrefs, (v: boolean) => string>> = {
  reopen: (v) => (v ? '下次打开接着上次开着的标签和右栏的网页' : '下次打开从首页开始，右栏收着；库照样是上次那个'),
  tray: (v) => (v ? '菜单栏里又有那一叠卡片了' : '菜单栏图标拿掉了；速记还能按快捷键'),
  quickSrc: (v) => (v ? '速记时选中了字，记下是哪个软件、哪个网页' : '速记只记选中的字，不记从哪来'),
}

export function GeneralPage(props: SettingsProps) {
  const said = useSaid()
  const g = props.settings.general
  const set = (k: 'reopen' | 'tray' | 'quickSrc', v: boolean, label: string) => {
    const old = g[k]
    void props.onChange({ general: { [k]: v } })
    said.saved(HINT[k]?.(v) ?? hintFor(label, v), () => void props.onChange({ general: { [k]: old } }))
  }
  const slots = useKeySlots(g.quickKey)
  const keys = useKeyRecorder(props, slots)
  const quick = slots.find((s) => s.row === 'kQuick')!
  // 速记的键注册上了没有（被别的软件占了时只能从菜单栏打开）
  const [quickOk, setQuickOk] = useState(true)
  useEffect(() => {
    void window.cn.quickState().then((s) => setQuickOk(s.registered))
  }, [g.quickKey])
  return (
    <>
      <Group title="启动和窗口">
        <Row id="reopen">
          <Toggle on={g.reopen} label="打开时回到上次的样子" onChange={(v) => set('reopen', v, '打开时回到上次的样子')} />
        </Row>
        <Row id="tray">
          <Toggle on={g.tray} label="菜单栏图标" onChange={(v) => set('tray', v, '菜单栏图标')} />
        </Row>
      </Group>
      <Group title="速记">
        <Row
          id="quickKey"
          desc={
            quickOk ? undefined : (
              <>
                <i className="dot warn" />
                {`${g.quickKey} 被别的软件占了，现在只能从菜单栏打开速记；换一个键`}
              </>
            )
          }
          more={keys.more({ ...quick, row: 'kQuick' })}
        >
          {keys.button(quick)}
        </Row>
        <Row id="quickSrc">
          <Toggle on={g.quickSrc} label="选中文字时带上来源" onChange={(v) => set('quickSrc', v, '选中文字时带上来源')} />
        </Row>
      </Group>
      <UpdateGroup {...props} />
    </>
  )
}

/** 更新：自动检查、现在的版本和「现在检查」（下好了是「重启更新」） */
function UpdateGroup(props: SettingsProps) {
  const said = useSaid()
  const st = useUpdateState()
  const [checking, setChecking] = useState(false)
  const [moveErr, setMoveErr] = useState('')
  if (!st) return null
  const off = st.phase === 'off'
  const err = st.phase === 'error' ? updateError(st.error, st.version) : null
  const busy = checking || st.phase === 'checking' || st.phase === 'downloading'
  const line = moveErr ? `没挪成：${moveErr}` : updateLine(st, props.settings.autoUpdate)
  async function check() {
    setChecking(true)
    try {
      await window.cn.checkUpdate()
    } finally {
      setChecking(false)
    }
  }
  return (
    <Group title="更新">
      <Row id="autoUpdate" dim={off} desc={off ? '开发版和自己打的包不查更新；正式版从官网或GitHub Release下载' : undefined}>
        <Toggle
          on={props.settings.autoUpdate && !off}
          label="自动检查更新"
          onChange={(v) => {
            if (off) return
            void props.onChange({ autoUpdate: v })
            said.saved(v ? '打开30秒后查一次，之后每6小时' : '不再自己查；点「现在检查」查一次', () => void props.onChange({ autoUpdate: !v }))
          }}
        />
      </Row>
      <Row
        id="checkNow"
        label={
          <>
            现在是 <span className="num">{st.current}</span>
          </>
        }
        desc={
          <span data-testid="update-line" className={err || moveErr ? 'err' : undefined}>
            {(err || moveErr) && <i className="dot warn" />}
            {line}
            {st.phase === 'ready' && (
              <>
                {' · '}
                <button type="button" className="sa-lnk" onClick={() => void window.cn.releaseUrl().then(props.onOpenUrl)}>
                  看看改了什么
                </button>
              </>
            )}
            {st.phase === 'downloading' && (
              <span className="upd-bar" aria-hidden>
                <i style={{ width: `${st.percent}%` }} />
              </span>
            )}
          </span>
        }
      >
        {err?.action === 'site' && (
          <button type="button" className="sa-btn" onClick={() => props.onOpenUrl(BRAND.site)}>
            去官网下载
          </button>
        )}
        {st.phase === 'ready' ? (
          <button type="button" className="sa-btn primary" onClick={() => void props.onInstallUpdate()}>
            重启更新
          </button>
        ) : (
          <button type="button" className="sa-btn" disabled={off || busy} onClick={() => void check()}>
            {st.phase === 'checking' || checking ? '正在检查' : err ? '再查一次' : '现在检查'}
          </button>
        )}
      </Row>
      {!st.inApps && !off && (
        <Row
          id="notInApps"
          label={`${BRAND.name}不在「应用程序」文件夹里`}
          desc={
            <>
              <i className="dot warn" />
              从「下载」或安装盘里直接打开时，新版本可能装不上
            </>
          }
        >
          <button type="button" className="sa-btn ghost" onClick={() => void window.cn.revealApp()}>
            <Codicon name="search" size={14} />
            在Finder中显示
          </button>
          <button
            type="button"
            className="sa-btn"
            onClick={() => {
              setMoveErr('')
              void window.cn.moveToApps().catch((e: unknown) => setMoveErr(e instanceof Error ? e.message : String(e)))
            }}
          >
            挪到「应用程序」并重开
          </button>
        </Row>
      )}
    </Group>
  )
}
