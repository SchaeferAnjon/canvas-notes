/**
 * 书签首页的「稍后再看」：存在 <userData>/plugins/bookmarks/home.json，不进库。
 * 不放进书签文件夹：书签库按网址去重，收藏过的网页就放不进去了，地址栏的星星也会把稍后再看的当成已收藏。
 * 快捷书签和分组就是书签栏和它的子文件夹（见 shared/plugins/bookmark-home.ts），存在书签里。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { addLater, type Arrange, type LaterItem, normalizeLater } from '../../../shared/plugins/bookmark-home'

export interface HomeData {
  later: LaterItem[]
}

export class BookmarkHome {
  private data: HomeData

  constructor(private file: string) {
    let raw: Partial<HomeData> = {}
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<HomeData>
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    this.data = { later: normalizeLater(raw.later) }
  }

  get(): HomeData {
    return this.data
  }

  addLater(page: { url: unknown; title: unknown }, now = Date.now()): HomeData {
    if (typeof page.url !== 'string') throw new Error('稍后再看的参数不对')
    this.data = { later: addLater(this.data.later, { url: page.url, title: typeof page.title === 'string' ? page.title : '' }, now, randomUUID()) }
    return this.save()
  }

  setLaterDone(id: unknown, done: unknown): HomeData {
    if (typeof id !== 'string' || typeof done !== 'boolean') throw new Error('稍后再看的参数不对')
    this.data = { later: this.data.later.map((x) => (x.id !== id ? x : done ? { ...x, done: true } : { id: x.id, url: x.url, title: x.title, addedMs: x.addedMs })) }
    return this.save()
  }

  removeLater(id: unknown): HomeData {
    if (typeof id !== 'string') throw new Error('稍后再看的参数不对')
    this.data = { later: this.data.later.filter((x) => x.id !== id) }
    return this.save()
  }

  /** 先写临时文件再换名，写一半断电不会留下坏文件 */
  private save(): HomeData {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data))
    renameSync(this.file + '.tmp', this.file)
    return this.data
  }
}

/** 界面传来的挪书签参数：一项一项检查 */
export function parseArrange(raw: unknown): Arrange[] {
  if (!Array.isArray(raw) || raw.length > 2000) throw new Error('挪书签的参数不对')
  return raw.map((x) => {
    const c = (x ?? {}) as Record<string, unknown>
    if (typeof c.id !== 'string') throw new Error('挪书签的参数不对')
    if (c.folder !== undefined && (typeof c.folder !== 'string' || c.folder.length > 400)) throw new Error('挪书签的参数不对')
    if (c.order !== undefined && (typeof c.order !== 'number' || !Number.isFinite(c.order))) throw new Error('挪书签的参数不对')
    return { id: c.id, ...(c.folder !== undefined ? { folder: c.folder as string } : {}), ...(c.order !== undefined ? { order: c.order as number } : {}) }
  })
}
