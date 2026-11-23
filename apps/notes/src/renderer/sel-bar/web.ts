/**
 * 网页上的小条（task-26nz7）：照设置 › 选中小条算好发给每个开着的网页（cn:bar，preload/webview.ts 照它画）。
 * 表、自己的命令、键、刚存好的那颗、界面语言变了都重发。
 */
import { onUiLang, t } from '../../shared/i18n'
import type { WebBarBtn, WebBarSpec } from '../../shared/web-reader'
import { cmdConfig, onCmdsChange } from '../search/cmd-store'
import { onLocalAiCmds } from '../commands/store'
import { type BarBtn, barView, freshNow, mineNow, onFresh } from './store'

const webBtn = (b: BarBtn): WebBarBtn => ({ id: b.id, label: b.label, icon: b.icon, key: b.key, mine: b.mine, ...(b.right ? { right: b.right } : {}) })

/** 发给网页的那一份；acc 是主题强调色（刚存好的那颗描的圈） */
export function webBarSpec(acc: string): WebBarSpec {
  const bar = cmdConfig().bar
  const v = barView(bar, mineNow(), 'web')
  return {
    main: v.main.map(webBtn),
    tail: v.tail.map(webBtn),
    more: v.more.map(webBtn),
    enabled: bar.enabled,
    offSites: bar.offSites,
    fresh: freshNow(),
    acc,
    text: {
      more: t('更多'),
      close: t('收起（右键或按住：这个网站不弹…）'),
      trSettings: t('翻译设置…'),
      target: t('剪到哪篇…'),
      add: t('加一颗…'),
      addR: t('拿这段试'),
      settings: t('小条设置…'),
      section: t('剪整节'),
      mute: t('{site} 不弹'),
      muteR: t('记进名单'),
      all: t('哪里都不弹'),
      allR: t('总开关关掉'),
      note: t('点 × 只是这次收起。这两项在 {link} 改回来'),
      noteLink: t('设置 › 选中小条'),
      bar: t('选中的这段'),
      menu: t('这段还能做什么'),
      xmenu: t('不弹小条'),
    },
  }
}

/** 表、自己的命令、刚存好的那颗、界面语言变了：f 重发给每个网页 */
export function onWebBarChange(f: () => void): () => void {
  const offs = [onCmdsChange(f), onLocalAiCmds(f), onFresh(f), onUiLang(f)]
  return () => offs.forEach((o) => o())
}
