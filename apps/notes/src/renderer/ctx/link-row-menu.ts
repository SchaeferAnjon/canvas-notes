/** 网页书签、浏览历史里一行的右键：打开、在新标签打开、在中间栏打开、拷贝链接，书签多一项删掉 */
import { app } from './actions'
import { copy, menuAt } from './menu'

export function linkRowMenu(e: React.MouseEvent, url: string, title: string, open: () => void, openTab: () => void, remove?: () => Promise<void>) {
  void menuAt(e, [
    { label: '打开', run: open },
    { label: '在新标签打开', run: openTab },
    { label: '在中间栏打开', run: () => app().openWide(url, title) },
    { label: '拷贝链接', run: () => copy(url) },
    remove ? '-' : null,
    remove ? { label: '删掉书签', run: remove } : null,
  ])
}
