/**
 * 书签和历史：存在软件设置目录（<userData>/web/），不进库。
 * 书签是一张平的表，文件夹用路径字符串表示（「书签栏 / 工作」），和 Chrome 导进来的一样。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeNote, normalizeTags } from '../../shared/plugins/bookmarks'
import type { Bookmark, HistoryEntry } from '../../shared/web-api'

export const BAR = '书签栏'
const MAX_HISTORY = 5000

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw e
  }
}

/** 先写临时文件再换名，写一半断电不会留下坏文件 */
function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value))
  renameSync(tmp, file)
}

const isWebUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length < 8192

export interface BookmarkInput {
  title: string
  url: string
  folder?: string
  tags?: string[]
  note?: string
}

/** 标签和备注只在有内容时写进去，没用过书签管家的书签文件和原来一样 */
function extras(b: { tags?: unknown; note?: unknown }): Pick<Bookmark, 'tags' | 'note'> {
  const tags = normalizeTags(b.tags)
  const note = normalizeNote(b.note)
  return { ...(tags.length ? { tags } : {}), ...(note ? { note } : {}) }
}

export class Bookmarks {
  private list: Bookmark[]

  /** onChange：书签变了就叫一声（界面上的书签栏、星星、书签管家跟着刷新） */
  constructor(
    private file: string,
    private onChange: () => void = () => {},
  ) {
    this.list = readJson<Bookmark[]>(file, []).filter((b) => isWebUrl(b?.url))
  }

  all(): Bookmark[] {
    return this.list
  }

  add(b: BookmarkInput, now = Date.now()): Bookmark[] {
    if (!isWebUrl(b.url)) throw new Error('只能收藏 http(s) 网页')
    if (this.list.some((x) => x.url === b.url)) return this.list
    const folder = (b.folder ?? BAR).trim() || BAR
    this.list = [...this.list, { id: randomUUID(), title: String(b.title || b.url).slice(0, 300), url: b.url, folder, addedMs: now, ...extras(b) }]
    this.save()
    return this.list
  }

  /** 改一个书签：给了哪项改哪项；标签、备注给空的就是删掉 */
  update(id: string, patch: Partial<BookmarkInput>): Bookmark[] {
    const i = this.list.findIndex((b) => b.id === id)
    if (i === -1) throw new Error('这个书签已经不在了')
    const cur = this.list[i]!
    if (patch.url !== undefined && !isWebUrl(patch.url)) throw new Error('只能收藏 http(s) 网页')
    if (patch.url !== undefined && patch.url !== cur.url && this.list.some((x) => x.url === patch.url)) throw new Error('这个网址已经有书签了')
    const { tags: _t, note: _n, ...base } = cur
    const next: Bookmark = {
      ...base,
      ...(patch.title !== undefined ? { title: String(patch.title || cur.url).slice(0, 300) } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.folder !== undefined ? { folder: patch.folder.trim() || BAR } : {}),
      ...extras({ tags: patch.tags ?? cur.tags, note: patch.note ?? cur.note }),
    }
    this.list = this.list.map((b, j) => (j === i ? next : b))
    this.save()
    return this.list
  }

  remove(id: string): Bookmark[] {
    this.list = this.list.filter((b) => b.id !== id)
    this.save()
    return this.list
  }

  /** 导入：网址已经有的跳过，返回新加了几个 */
  merge(items: { title: string; url: string; folder: string }[], now = Date.now()): number {
    const have = new Set(this.list.map((b) => b.url))
    const added: Bookmark[] = []
    for (const it of items) {
      if (!isWebUrl(it.url) || have.has(it.url)) continue
      have.add(it.url)
      added.push({ id: randomUUID(), title: it.title.slice(0, 300), url: it.url, folder: it.folder || BAR, addedMs: now })
    }
    if (added.length) {
      this.list = [...this.list, ...added]
      this.save()
    }
    return added.length
  }

  private save() {
    writeJson(this.file, this.list)
    this.onChange()
  }
}

export class History {
  private list: HistoryEntry[]
  private timer: NodeJS.Timeout | null = null

  constructor(private file: string) {
    this.list = readJson<HistoryEntry[]>(file, []).filter((h) => isWebUrl(h?.url))
  }

  /** 去过一次（同一网址合并成一条，次数加一，挪到最前） */
  visit(url: string, title: string, now = Date.now()) {
    if (!isWebUrl(url)) return
    const i = this.list.findIndex((h) => h.url === url)
    const prev = i === -1 ? null : this.list[i]!
    if (i !== -1) this.list.splice(i, 1)
    this.list.unshift({ url, title: title || prev?.title || '', visits: (prev?.visits ?? 0) + 1, lastVisit: now })
    if (this.list.length > MAX_HISTORY) this.list.length = MAX_HISTORY
    this.later()
  }

  /** 标题出来得比导航晚：只改标题，不算一次访问 */
  title(url: string, title: string) {
    const h = this.list.find((x) => x.url === url)
    if (!h || !title || h.title === title) return
    h.title = title
    this.later()
  }

  /** 每个网址上次访问的时间 */
  lastVisits(): Map<string, number> {
    return new Map(this.list.map((h) => [h.url, h.lastVisit]))
  }

  /** 每个词都要出现在标题或网址里；最近的排前面 */
  search(query: string, limit = 50): HistoryEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = words.length
      ? this.list.filter((h) => {
          const hay = (h.title + ' ' + safeDecode(h.url)).toLowerCase()
          return words.every((w) => hay.includes(w))
        })
      : this.list
    return hits.slice(0, Math.max(1, Math.min(limit, 500)))
  }

  merge(items: HistoryEntry[]): number {
    const have = new Map(this.list.map((h) => [h.url, h]))
    let added = 0
    for (const it of items) {
      if (!isWebUrl(it.url)) continue
      const cur = have.get(it.url)
      if (cur) {
        cur.visits = Math.max(cur.visits, it.visits)
        if (it.lastVisit > cur.lastVisit) cur.lastVisit = it.lastVisit
        if (!cur.title) cur.title = it.title
      } else {
        const e = { url: it.url, title: it.title, visits: it.visits, lastVisit: it.lastVisit }
        have.set(it.url, e)
        this.list.push(e)
        added++
      }
    }
    this.list.sort((a, b) => b.lastVisit - a.lastVisit)
    if (this.list.length > MAX_HISTORY) this.list.length = MAX_HISTORY
    this.flush()
    return added
  }

  private later() {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 1000)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    writeJson(this.file, this.list)
  }
}

function safeDecode(u: string): string {
  try {
    return decodeURI(u)
  } catch {
    return u
  }
}
