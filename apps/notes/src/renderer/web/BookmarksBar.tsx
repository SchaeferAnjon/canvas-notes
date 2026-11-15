import { Icon } from '@cn/design'
import { ChevronDown, Folder, Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Bookmark } from '../../shared/web-api'

export const BAR = '书签栏'

/** 书签栏：书签栏里的书签直接摆出来，子文件夹和「其他书签」点开是菜单。⌘ 点在新标签打开 */
export function BookmarksBar(props: { bookmarks: Bookmark[]; onOpen(url: string, newTab: boolean): void }) {
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !(e.target as HTMLElement).closest('.bmbar') && setOpen(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  if (!props.bookmarks.length) return null
  const top = props.bookmarks.filter((b) => b.folder === BAR)
  const folders = [...new Set(props.bookmarks.filter((b) => b.folder.startsWith(BAR + ' / ')).map((b) => b.folder.split(' / ')[1]!))]
  const others = props.bookmarks.filter((b) => b.folder !== BAR && !b.folder.startsWith(BAR + ' / '))
  const inFolder = (f: string) => props.bookmarks.filter((b) => b.folder === `${BAR} / ${f}` || b.folder.startsWith(`${BAR} / ${f} / `))
  const go = (b: Bookmark, e: React.MouseEvent) => {
    setOpen(null)
    props.onOpen(b.url, e.metaKey)
  }
  const menu = (key: string, items: Bookmark[], base: string) =>
    open === key && (
      <div className="menu bmmenu" role="menu" aria-label={key}>
        {items.map((b) => (
          <button key={b.id} role="menuitem" title={b.url} onClick={(e) => go(b, e)}>
            <b className="truncate">{b.title}</b>
            {b.folder !== base && <span className="truncate">{b.folder.slice(base.length + 3)}</span>}
          </button>
        ))}
      </div>
    )
  return (
    <div className="bmbar" role="toolbar" aria-label="书签栏">
      {top.map((b) => (
        <button key={b.id} className="bm" title={b.url} onClick={(e) => go(b, e)}>
          <Icon of={Globe} size={12} />
          <span className="truncate">{b.title}</span>
        </button>
      ))}
      {folders.map((f) => (
        <div key={f} className="bmf">
          <button className={'bm' + (open === f ? ' on' : '')} onClick={() => setOpen(open === f ? null : f)}>
            <Icon of={Folder} size={12} />
            <span className="truncate">{f}</span>
          </button>
          {menu(f, inFolder(f), `${BAR} / ${f}`)}
        </div>
      ))}
      {others.length > 0 && (
        <div className="bmf end">
          <button className={'bm' + (open === '其他书签' ? ' on' : '')} onClick={() => setOpen(open === '其他书签' ? null : '其他书签')}>
            其他书签
            <Icon of={ChevronDown} size={12} />
          </button>
          {open === '其他书签' && (
            <div className="menu bmmenu right" role="menu" aria-label="其他书签">
              {others.map((b) => (
                <button key={b.id} role="menuitem" title={b.url} onClick={(e) => go(b, e)}>
                  <b className="truncate">{b.title}</b>
                  <span className="truncate">{b.folder}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
