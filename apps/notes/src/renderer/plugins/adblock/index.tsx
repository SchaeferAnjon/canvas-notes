/**
 * 拦广告界面这半（CN-51）：「⋯」菜单里「在 <网站> 不拦广告」（再点一次是恢复拦），设置 › 插件 里规则的状态、「现在更新」、不拦的网站。
 * 主进程那半在 main/plugins/adblock/。
 */
import { dateText } from '../../../shared/when'
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { type AdblockStatus, allowed, normalizeAdblock, siteOf, toggleAllow } from '../../../shared/plugins/adblock'
import { errText, pluginInfo, setPluginSettings, usePlugins, webHost } from '../host'
import type { RendererPlugin, WebPage } from '../types'

const ID = 'adblock'

/** 「⋯ › 在 <网站> 不拦广告」：打了勾就是这个网站不拦；点了重新载入这一页 */
function AllowItem(props: { page: WebPage | null; onDone(): void; onNotice(t: string): void }) {
  usePlugins()
  const site = siteOf(props.page?.url)
  const allow = normalizeAdblock(pluginInfo(ID)?.settings).allow
  const on = !!site && allowed(allow, props.page?.url)
  const run = () => {
    if (!site) return
    props.onDone()
    // 名单里可能是上一级的网站（不拦 example.com 时开着 news.example.com）：拿掉的是盖住它的那一条
    const hit = allow.find((a) => site === a || site.endsWith('.' + a)) ?? site
    void setPluginSettings(ID, { allow: toggleAllow(allow, hit) }).then(
      () => {
        webHost()?.view()?.reload()
        props.onNotice(on ? `${hit}又拦广告了` : `${hit}不拦广告了：设置 › 插件 › 拦广告 里能改回来`)
      },
      (e) => props.onNotice(errText(e)),
    )
  }
  return (
    <button role="menuitemcheckbox" aria-checked={on} disabled={!site} onClick={run}>
      <Codicon name={on ? 'check' : 'shield'} size={14} />
      <span className="mlabel truncate">{site ? `在${site}不拦广告` : '在这个网站不拦广告'}</span>
    </button>
  )
}

const day = (ms: number) => dateText(ms)

function statusText(s: AdblockStatus): string {
  if (s.state === 'idle') return '还没取规则：第一次打开网站时去取'
  if (s.state === 'loading') return '正在取规则…'
  if (s.state === 'off') return '没有规则（测试实例不联网取）'
  if (s.state === 'error') return s.error ?? '规则没取到'
  return `EasyList + EasyPrivacy · ${s.rules >= 10_000 ? `${(s.rules / 10_000).toFixed(1)}万` : s.rules}条规则 · ${day(s.updated)}更新 · 这次打开拦了${s.blocked}个`
}

function AdblockSettingsPane({ info, onChange, onNotice }: { info: { settings: Record<string, unknown> }; onChange(p: Record<string, unknown>): void; onNotice(t: string): void }) {
  const set = normalizeAdblock(info.settings)
  const [st, setSt] = useState<AdblockStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.cnPlugins.call<AdblockStatus>(ID, 'status').then(setSt, (e) => onNotice(errText(e)))
    return window.cnPlugins.on(ID, 'status', (s) => setSt(s as AdblockStatus))
  }, [])
  return (
    <>
      <div className="pair ab-rules">
        <span className={'ab-st' + (st?.state === 'error' ? ' bad' : '')} aria-label="规则">
          {st ? statusText(st) : ''}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void window.cnPlugins
              .call<AdblockStatus>(ID, 'update')
              .then(setSt, (e) => onNotice(errText(e)))
              .finally(() => setBusy(false))
          }}
        >
          <Codicon name="refresh" size={13} className={busy ? 'spin' : ''} />
          现在更新
        </button>
      </div>
      <div className="ab-allow" role="list" aria-label="不拦的网站">
        <span className="ab-allow-h">不拦的网站</span>
        {set.allow.length ? (
          set.allow.map((h) => (
            <span key={h} className="ab-chip" role="listitem">
              {h}
              <button type="button" aria-label={`${h} 也拦`} title="这个网站也拦" onClick={() => onChange({ allow: set.allow.filter((a) => a !== h) })}>
                <Codicon name="close" size={12} />
              </button>
            </span>
          ))
        ) : (
          <span className="ab-none">没有。某个网站被拦坏了，在网页的「⋯」里点「在这个网站不拦广告」。</span>
        )}
      </div>
    </>
  )
}

export const adblock: RendererPlugin = {
  id: ID,
  icon: 'shield',
  PageMenu: AllowItem,
  Settings: AdblockSettingsPane,
}
