import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { permissionLabel } from '../../shared/extension-apis'
import type { ExtensionInfo } from '../../shared/web-api'
import { BuiltinPlugins } from '../plugins'
import { Toggle } from '../Settings'
import { errText } from '../WebPanel'
import { ActionIcon, activateAction, MAX_PINNED, togglePin, useActions, usePinned } from './ActionButtons'
import { ProfileMenu } from './ProfileMenu'

const VERDICT: Record<ExtensionInfo['verdict'], string> = {
  ok: '应该能用',
  partial: '部分功能可能用不了',
  unlikely: '多半用不了',
}

/** 插件管理：上面是软件内置的（开关、去设置），下面是 Chrome 插件（从 Chrome 导入、开关、移除、哪些可能用不了；有按钮的点一下开弹窗） */
export function ExtensionsPanel(props: { tabId: number; onNotice(t: string): void; onClose(): void; onReload(): void; onPluginSettings(): void }) {
  const [list, setList] = useState<ExtensionInfo[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const actions = useActions()
  const pins = usePinned()

  useEffect(() => {
    void window.cnWeb.extensions().then(setList)
  }, [])

  async function run(f: () => Promise<ExtensionInfo[]>) {
    try {
      setList(await f())
    } catch (e) {
      props.onNotice(errText(e))
    }
  }

  async function importFrom(id: string, name: string) {
    setPicking(false)
    setBusy(true)
    try {
      const r = await window.cnWeb.importExtensions(id)
      setList(await window.cnWeb.extensions())
      const bad = r.imported.filter((x) => x.verdict === 'unlikely').length
      props.onNotice(
        r.imported.length
          ? `从 Chrome「${name}」导入了 ${r.imported.length} 个插件${bad ? `，其中 ${bad} 个多半用不了（看插件面板里的说明）` : ''}${r.skipped.length ? `；${r.skipped.length} 个没导成` : ''}。网页重新载入后插件才进得去。`
          : `Chrome「${name}」没有装插件`,
      )
      props.onReload()
    } catch (e) {
      props.onNotice(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wpop wext" role="dialog" aria-label="插件">
      <div className="wlib-head">
        <b>插件</b>
      </div>
      <div className="wgroup">内置</div>
      <BuiltinPlugins onNotice={props.onNotice} onSettings={props.onPluginSettings} />
      <div className="wgroup">
        Chrome 插件
        <span className="sp" />
        <div className="imp">
          <button className="btn btn-sm" disabled={busy} onClick={() => setPicking((v) => !v)}>
            <Codicon name="desktop-download" size={12} className={busy ? 'spin' : ''} />
            {busy ? '正在导入' : '从 Chrome 导入'}
          </button>
          {picking && <ProfileMenu label="选 Chrome 用户" title="导入哪个 Chrome 用户装的插件？" onPick={(id, name) => void importFrom(id, name)} onNotice={props.onNotice} onClose={() => setPicking(false)} />}
        </div>
      </div>
      <p className="hint">从 Chrome 拷一份过来用，Chrome 那边不动。内置浏览器只有一部分 Chrome 插件接口，有的插件功能不全。</p>
      <div className="wlist" role="list" aria-label="插件列表">
        {list?.length === 0 && <p className="hint">还没有插件。</p>}
        {list?.map((x) => {
          const a = actions.find((y) => y.id === x.runtimeId)
          return (
            <div key={x.id} className="wrow wextrow" role="listitem" aria-label={x.name}>
              {a && x.enabled ? (
                <button className="iconbtn wact" aria-label={`打开 ${x.name}`} title={`打开 ${x.name}`} onClick={(e) => activateAction(a, e.currentTarget, props.tabId)}>
                  <ActionIcon a={a} />
                </button>
              ) : (
                <span className="wact-ph" />
              )}
              <div className="wmain">
                <b className="truncate" title={`${x.name} ${x.version}`}>
                  {x.name}
                </b>
                <span className={'verdict ' + x.verdict} data-testid="verdict">
                  {x.error ? `加载失败：${x.error}` : VERDICT[x.verdict]}
                  {!x.error && x.missing.length > 0 && `：缺${[...new Set(x.missing.map(permissionLabel))].join('、')}`}
                </span>
              </div>
              {a && x.enabled && (
                <button
                  className={'iconbtn wpin' + (pins.includes(a.id) ? ' on' : '')}
                  aria-label={pins.includes(a.id) ? `取消固定 ${x.name}` : `固定到地址栏 ${x.name}`}
                  aria-pressed={pins.includes(a.id)}
                  title={pins.includes(a.id) ? '取消固定（按钮从地址栏右边拿掉）' : `固定到地址栏右边（最多 ${MAX_PINNED} 个，多了换掉最早的）`}
                  onClick={() => togglePin(a.id)}
                >
                  <Codicon name="pin" size={13} />
                </button>
              )}
              <Toggle on={x.enabled} label={`启用 ${x.name}`} onChange={(v) => void run(() => window.cnWeb.setExtensionEnabled(x.id, v))} />
              <button className="iconbtn" aria-label={`移除 ${x.name}`} title="移除" onClick={() => void run(() => window.cnWeb.removeExtension(x.id))}>
                <Codicon name="trash" size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
