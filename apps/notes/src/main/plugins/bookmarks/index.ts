/**
 * 书签管家主进程这半：和内置浏览器用同一份书签（<userData>/web/bookmarks.json），多了标签和备注；
 * 「上次访问」从浏览历史里查；「存进库」把选中的书签每个存成收件箱里的一篇，一次提交。
 * 界面那半在 renderer/plugins/bookmarks/。
 */
import * as git from '@cn/git'
import { BOOKMARKS, bookmarkNote, type BookmarkRow, normalizeNote, normalizeTags } from '../../../shared/plugins/bookmarks'
import { INBOX, mdUrl } from '../../../shared/layout'
import { logActivity } from '../../activity'
import { localStamp } from '../../vault'
import { webLibrary } from '../../web'
import type { MainPlugin } from '../host'

interface SaveArg {
  id?: unknown
  title?: unknown
  url?: unknown
  folder?: unknown
  tags?: unknown
  note?: unknown
}

export const bookmarksPlugin: MainPlugin<Record<string, never>> = {
  manifest: BOOKMARKS,
  normalizeSettings: () => ({}),
  setup(host) {
    const rows = (): BookmarkRow[] => {
      const { bookmarks, history } = webLibrary()
      const seen = history.lastVisits()
      return bookmarks.all().map((b) => ({ ...b, lastVisit: seen.get(b.url) ?? 0 }))
    }

    host.handle('list', () => rows())

    /** 有 id 改那一个；没有 id 按网址收藏（网址已经有了就改那一个） */
    host.handle('save', (_ctx, arg) => {
      const a = (arg ?? {}) as SaveArg
      if (typeof a.url !== 'string' || typeof a.title !== 'string') throw new Error('书签参数不对')
      const patch = {
        title: a.title.trim(),
        url: a.url,
        ...(typeof a.folder === 'string' ? { folder: a.folder } : {}),
        tags: normalizeTags(a.tags),
        note: normalizeNote(a.note),
      }
      const { bookmarks } = webLibrary()
      const id = typeof a.id === 'string' ? a.id : bookmarks.all().find((b) => b.url === a.url)?.id
      if (id) bookmarks.update(id, patch)
      else bookmarks.add(patch)
      return rows()
    })

    host.handle('remove', (_ctx, id) => {
      if (typeof id !== 'string') throw new Error('书签参数不对')
      webLibrary().bookmarks.remove(id)
      return rows()
    })

    host.handle('toVault', async (_ctx, ids) => {
      if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === 'string')) throw new Error('先选几个书签')
      const v = host.vault()
      const all = webLibrary().bookmarks.all()
      const picked = (ids as string[]).map((id) => all.find((b) => b.id === id)).filter((b) => !!b)
      if (!picked.length) throw new Error('选的书签已经不在了')
      const stamp = localStamp(new Date())
      const paths: string[] = []
      for (const b of picked) paths.push(await v.create(INBOX, b.title.slice(0, 60) || '书签', bookmarkNote(b, stamp, mdUrl)))
      const subject = picked.length === 1 ? `书签存进库：${picked[0]!.title.slice(0, 50)}` : `书签存进库：${picked.length} 个`
      const hash = await git.commitPaths(v.root, paths, subject)
      for (const path of paths) await logActivity(v.root, { t: Date.now(), kind: 'clip', path })
      host.filesChanged()
      return { paths, commit: hash }
    })
  },
}
