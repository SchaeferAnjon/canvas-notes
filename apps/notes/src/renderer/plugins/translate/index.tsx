/**
 * 双语翻译界面这半：地址栏里的开关 + 小箭头菜单（方向 A，menu.tsx）、⌘K 里的命令、设置里的一块（settings.tsx）。
 * 真正改网页的是 preload/plugins/translate.ts，这里只给它发命令；主进程那半在 main/plugins/translate/。
 */
import type { TrPageState } from '../../../shared/plugins/translate'
import { keyFor } from '../../keys'
import { pageStateOf, usePageState, webHost } from '../host'
import type { RendererPlugin, WebPage } from '../types'
import { TrControl, TrMenu } from './menu'
import { TranslateSettingsPane } from './settings'
import { ID, settingsNow, toggleTranslate } from './shared'
import './translate.css'

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
    menu: { label: '双语翻译', keys: 'translate' },
    Control: TrControl,
    // 画按钮的是 Control；这个只在别处要按钮样子时用
    useLook(page) {
      const on = !!usePageState<TrPageState>(page?.wcId, ID)?.on
      const k = keyFor('translate')
      return { label: '双语翻译', title: `${on ? '恢复原文' : '双语翻译'}${k ? ` ${k}` : ''}`, icon: 'whole-word', on }
    },
    click: toggleTranslate,
  },
  Popup: ({ page, onClose }) => <TrMenu page={page} onClose={onClose} />,
  commands(page: WebPage | null) {
    const st = page ? pageStateOf<TrPageState>(page.wcId, ID) : undefined
    const on = !!st?.on
    const run = () => toggleTranslate(webHost()?.page() ?? null)
    // PDF 上不给（网页翻译翻不了 PDF）
    if (st?.pdf) return []
    return [
      // 开翻译是交给翻译那家跑的：画它的标志；恢复原文、换语言、换样式不经 AI，照旧「ab」
      // ⌘K 没打字时在「网页」一组（DESIGN.v3 3.1）；键在命令表里（默认 ⌥A，设置 › 快捷键、⌘K 里能改）
      { id: 'translate', home: 'web', name: on ? '恢复原文' : '双语翻译', hint: on ? '右栏网页 · 拿掉译文' : '右栏网页', icon: 'whole-word', ...(on ? {} : { ai: 'translate' as const }), run },
      // 次一级的：⌘K 没打字时在「更多命令」里（task-xy89o）
      { id: 'translate-lang', home: 'more', name: '翻成…', hint: '双语翻译 · 换语言', icon: 'whole-word', run: openMenu },
      { id: 'translate-style', home: 'more', name: '译文样式…', hint: '双语翻译 · 淡色、下划线、荧光笔、模糊自测…', icon: 'whole-word', run: openMenu },
      ...(on && settingsNow().style === 'blur' && settingsNow().display === 'below'
        ? [{ id: 'translate-reveal', home: 'more', name: '模糊自测：全部显示', hint: '双语翻译 · 糊着的译文都显出来', icon: 'whole-word' as const, run: () => page && webHost()?.command(page.wcId, ID, 'revealAll') }]
        : []),
    ]
  },
  Settings: TranslateSettingsPane,
}
