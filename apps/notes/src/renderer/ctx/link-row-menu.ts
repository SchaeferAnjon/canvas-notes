/** 网页书签、浏览历史里一行的右键：打开、在新标签打开、在中间栏打开、拷贝链接，书签多一项删掉 */
import { app } from './actions'
import { copy, menuAt } from './menu'
import { t } from '../../shared/i18n'

export function linkRowMenu(e: React.MouseEvent, url: string, title: string, open: () => void, openTab: () => void, remove?: () => Promise<void>) {
  void menuAt(e, [
    { label: t('打开'), run: open },
    { label: t('在新标签打开'), run: openTab },
    { label: t('在中间栏打开'), run: () => app().openWide(url, title) },
    { label: t('拷贝链接'), run: () => copy(url) },
    remove ? '-' : null,
    remove ? { label: t('删掉书签'), run: remove } : null,
  ])
}
