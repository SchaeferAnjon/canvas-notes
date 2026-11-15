/**
 * 书签管家界面这半：新开的网页标签是书签首页；地址栏的星星（WebPanel 里）收藏这一页并开书签小卡；
 * 「⋯」菜单里「稍后再看」；⌘F 里能开整理全部书签。
 * 书签入口只有地址栏的星星一个，所以这个插件不在地址栏右边另放按钮。
 */
import { Icon } from '@cn/design'
import { Bookmark, CircleCheck, Clock } from 'lucide-react'
import { errText, webHost } from '../host'
import type { RendererPlugin, WebPage } from '../types'
import { BookmarkHome } from './BookmarkHome'
import { BookmarkKeeper } from './BookmarkKeeper'
import { homeCall, ID, useHome } from './store'

/** 「⋯」菜单里的「稍后再看」：已经在里面时是「移出稍后再看」 */
function LaterItem(props: { page: WebPage | null; onDone(): void; onNotice(t: string): void }) {
  const { later } = useHome()
  const page = props.page?.url && /^https?:/.test(props.page.url) ? props.page : null
  const has = page ? later.find((x) => x.url === page.url) : undefined
  const run = () => {
    if (!page) return
    props.onDone()
    void (has ? homeCall('removeLater', has.id) : homeCall('addLater', { url: page.url, title: page.title })).then(
      () => props.onNotice(has ? '移出稍后再看了' : '存到稍后再看了：新标签页里看得到'),
      (e) => props.onNotice(errText(e)),
    )
  }
  return (
    <button role="menuitem" disabled={!page} onClick={run}>
      <Icon of={has ? CircleCheck : Clock} size={14} />
      <span className="mlabel">{has ? '移出稍后再看' : '稍后再看'}</span>
    </button>
  )
}

export const bookmarks: RendererPlugin = {
  id: ID,
  icon: Bookmark,
  Popup: BookmarkKeeper,
  NewTab: BookmarkHome,
  PageMenu: LaterItem,
  commands: () => [
    {
      name: '书签管家',
      hint: '整理全部书签：搜、改、删、存进库',
      icon: Bookmark,
      run: () => {
        const h = webHost()
        h?.show()
        h?.openPopup(ID)
      },
    },
  ],
}
