/** 书签管家界面这半：网页标签条右边的书签按钮（这一页收藏过就是实心），点开是弹窗；⌘F 里能开它 */
import { Bookmark } from 'lucide-react'
import { webHost } from '../host'
import type { RendererPlugin } from '../types'
import { BookmarkKeeper } from './BookmarkKeeper'
import { ID, useBookmarkRows } from './store'

export const bookmarks: RendererPlugin = {
  id: ID,
  icon: Bookmark,
  button: {
    useLook(page) {
      const rows = useBookmarkRows()
      const saved = !!page?.url && rows.some((b) => b.url === page.url)
      return { label: '书签管家', title: saved ? '书签管家 · 这一页已收藏' : '书签管家 · 收藏这一页、管书签', icon: Bookmark, filled: saved }
    },
  },
  Popup: BookmarkKeeper,
  commands: () => [
    {
      name: '书签管家',
      hint: '收藏这一页、搜和管书签',
      icon: Bookmark,
      run: () => {
        const h = webHost()
        h?.show()
        h?.openPopup(ID)
      },
    },
  ],
}
