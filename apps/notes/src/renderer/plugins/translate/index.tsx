/**
 * 双语翻译界面这半：地址栏里的开关 + 小箭头菜单（方向 A，menu.tsx）、⌘K 里的命令、设置里的一块（settings.tsx）。
 * 真正改网页的是 preload/plugins/translate.ts，这里只给它发命令；主进程那半在 main/plugins/translate/。
 */
import type { TrPageState } from '../../../shared/plugins/translate'
import { onActiveFile, pageStateOf, usePageState, webHost } from '../host'
import type { RendererPlugin, WebPage } from '../types'
import { TrControl, TrMenu } from './menu'
import { TranslateSettingsPane } from './settings'
import { ID, settingsNow, toggleTranslate } from './shared'
import './translate.css'

// 中间栏换了文件：告诉主进程（照那门课的术语表翻）
onActiveFile((p) => void window.cnPlugins?.call(ID, 'context', p).catch(() => undefined))

/** 「翻成…」「译文样式…」：打开同一个菜单（里面就是语言、样式列表） */
function openMenu() {
  const h = webHost()
  const page = h?.page()
  if (!h || !page?.url) {
    h?.show()
    h?.notice('先在右栏打开一个网页')
    return
  }
  h.show()
  h.openPopup(ID)
}

export const translate: RendererPlugin = {
  id: ID,
  icon: 'whole-word',
  button: {
    slot: 'address',
    menu: { label: '双语翻译', keys: '⌥A' },
    Control: TrControl,
    // 画按钮的是 Control；这个只在别处要按钮样子时用
    useLook(page) {
      const on = !!usePageState<TrPageState>(page?.wcId, ID)?.on
      return { label: '双语翻译', title: on ? '恢复原文 ⌥A' : '双语翻译 ⌥A', icon: 'whole-word', on }
    },
    click: toggleTranslate,
  },
  Popup: ({ page, onClose }) => <TrMenu page={page} onClose={onClose} />,
  commands(page: WebPage | null) {
    const st = page ? pageStateOf<TrPageState>(page.wcId, ID) : undefined
    const on = !!st?.on
    const run = () => toggleTranslate(webHost()?.page() ?? null)
    return [
      { name: on ? '恢复原文' : '双语翻译这个网页', hint: on ? '双语翻译 · 拿掉译文' : '双语翻译 · 每段下面加译文', icon: 'whole-word', keys: '⌥A', run },
      { name: '翻成…', hint: '双语翻译 · 换语言', icon: 'whole-word', run: openMenu },
      { name: '译文样式…', hint: '双语翻译 · 淡色、下划线、荧光笔、模糊自测…', icon: 'whole-word', run: openMenu },
      ...(on && settingsNow().style === 'blur' && settingsNow().display === 'below'
        ? [{ name: '模糊自测：全部显示', hint: '双语翻译 · 糊着的译文都显出来', icon: 'whole-word' as const, run: () => page && webHost()?.command(page.wcId, ID, 'revealAll') }]
        : []),
    ]
  },
  Settings: TranslateSettingsPane,
}
