import { Icon } from '@cn/design'
import { ChevronDown, ChevronsRight, Folder } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Bookmark } from '../../shared/web-api'
import { Favicon } from './favicons'

export const BAR = '书签栏'

type Entry = { kind: 'link'; key: string; b: Bookmark } | { kind: 'folder'; key: string; name: string }

/**
 * 书签栏：书签栏里的书签直接摆出来（网站小图标 + 名字，每个最宽 120），子文件夹和「其他书签」点开是菜单；
 * 摆不下的收进「»」菜单。⌘ 点在新标签打开
 */
export function BookmarksBar(props: { bookmarks: Bookmark[]; onOpen(url: string, newTab: boolean): void }) {
  const [open, setOpen] = useState<string | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  /** 前几个摆得下 */
  const [fit, setFit] = useState(Infinity)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !(e.target as HTMLElement).closest('.bmbar') && setOpen(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [props.bookmarks.length > 0])

  const top = props.bookmarks.filter((b) => b.folder === BAR)
  const folders = [...new Set(props.bookmarks.filter((b) => b.folder.startsWith(BAR + ' / ')).map((b) => b.folder.split(' / ')[1]!))]
  const others = props.bookmarks.filter((b) => b.folder !== BAR && !b.folder.startsWith(BAR + ' / '))
  const inFolder = (f: string) => props.bookmarks.filter((b) => b.folder === `${BAR} / ${f}` || b.folder.startsWith(`${BAR} / ${f} / `))
  const entries: Entry[] = [...top.map((b) => ({ kind: 'link' as const, key: b.id, b })), ...folders.map((f) => ({ kind: 'folder' as const, key: 'f:' + f, name: f }))]
  const sig = entries.map((e) => (e.kind === 'link' ? e.b.title : e.name)).join('\n') + '|' + others.length

  // 书签或宽度变了：先全摆出来量，再算摆得下几个（布局阶段做，不闪）
  useLayoutEffect(() => setFit(Infinity), [sig, width])
  useLayoutEffect(() => {
    const el = bar.current
    if (!el || fit !== Infinity) return
    const items = [...el.querySelectorAll<HTMLElement>(':scope > [data-bm]')]
    const end = el.querySelector<HTMLElement>(':scope > .bmf.end')
    // 留给「»」和「其他书签」的地方
    const room = el.clientWidth - 16 - (end?.offsetWidth ?? 0) - 32
    let used = 0
    let n = 0
    for (const it of items) {
      used += it.offsetWidth + 2
      if (used > room) break
      n++
    }
    setFit(n === items.length ? items.length : n)
  }, [fit, sig, width])

  if (!props.bookmarks.length) return null
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
  const shown = fit === Infinity ? entries : entries.slice(0, fit)
  const hidden = fit === Infinity ? [] : entries.slice(fit)
  return (
    <div className="bmbar" role="toolbar" aria-label="书签栏" ref={bar}>
      {shown.map((e) =>
        e.kind === 'link' ? (
          <button key={e.key} data-bm className="bm" title={`${e.b.title}\n${e.b.url}`} onClick={(ev) => go(e.b, ev)}>
            <Favicon url={e.b.url} size={14} />
            <span className="truncate">{e.b.title}</span>
          </button>
        ) : (
          <div key={e.key} data-bm className="bmf">
            <button className={'bm' + (open === e.name ? ' on' : '')} title={e.name} onClick={() => setOpen(open === e.name ? null : e.name)}>
              <Icon of={Folder} size={13} />
              <span className="truncate">{e.name}</span>
            </button>
            {menu(e.name, inFolder(e.name), `${BAR} / ${e.name}`)}
          </div>
        ),
      )}
      {hidden.length > 0 && (
        <div className="bmf">
          <button className={'bm bmmore' + (open === '»' ? ' on' : '')} aria-label="更多书签" title={`还有 ${hidden.length} 个摆不下`} onClick={() => setOpen(open === '»' ? null : '»')}>
            <Icon of={ChevronsRight} size={13} />
          </button>
          {open === '»' && (
            <div className="menu bmmenu right" role="menu" aria-label="更多书签">
              {hidden.flatMap((e) =>
                e.kind === 'link'
                  ? [
                      <button key={e.key} role="menuitem" title={e.b.url} onClick={(ev) => go(e.b, ev)}>
                        <b className="truncate">{e.b.title}</b>
                      </button>,
                    ]
                  : inFolder(e.name).map((b) => (
                      <button key={b.id} role="menuitem" title={b.url} onClick={(ev) => go(b, ev)}>
                        <b className="truncate">{b.title}</b>
                        <span className="truncate">{b.folder.slice(BAR.length + 3)}</span>
                      </button>
                    )),
              )}
            </div>
          )}
        </div>
      )}
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
