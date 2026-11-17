/**
 * 书签管家界面这半：新开的网页标签是 BookmarkKeeper 的新标签页（WebPanel 里开，主进程 web/bookmarkkeeper 提供）；地址栏的星星收藏这一页并开书签小卡；
 * 「⋯」菜单里「稍后再看」；⌘F 里能开整理全部书签。
 * 书签入口只有地址栏的星星一个，所以这个插件不在地址栏右边另放按钮。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { errText, webHost } from '../host'
import type { RendererPlugin, WebPage } from '../types'
import { BookmarkKeeper } from './BookmarkKeeper'
import { ID } from './store'

/** 「⋯」菜单里的「稍后再看」：放进 BookmarkKeeper 新标签页的「Saved for later」；已经在里面时是「移出稍后再看」 */
function LaterItem(props: { page: WebPage | null; onDone(): void; onNotice(t: string): void }) {
  const page = props.page?.url && /^https?:/.test(props.page.url) ? props.page : null
  const [has, setHas] = useState(false)
  useEffect(() => {
    if (page) void window.cnPlugins.call<boolean>(ID, 'laterHas', { url: page.url }).then(setHas, () => setHas(false))
  }, [page?.url])
  const run = () => {
    if (!page) return
    props.onDone()
    void window.cnPlugins.call<boolean>(ID, 'laterToggle', { url: page.url, title: page.title }).then(
      (added) => props.onNotice(added ? '存到稍后再看了：新网页标签的「稍后再看」里看得到' : '移出稍后再看了'),
      (e) => props.onNotice(errText(e)),
    )
  }
  return (
    <button role="menuitem" disabled={!page} onClick={run}>
      <Codicon name={has ? 'pass' : 'clockface'} size={14} />
      <span className="mlabel">{has ? '移出稍后再看' : '稍后再看'}</span>
    </button>
  )
}

export const bookmarks: RendererPlugin = {
  id: ID,
  icon: 'bookmark',
  Popup: BookmarkKeeper,
  PageMenu: LaterItem,
  commands: () => [
    {
      name: '书签管家',
      hint: '整理全部书签：搜、改、删、存进库',
      icon: 'bookmark',
      run: () => {
        const h = webHost()
        h?.show()
        h?.openPopup(ID)
      },
    },
  ],
}
