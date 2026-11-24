/**
 * 同步来源共用的一块（设计页 61-同步来源第 5 节）：翻列表、认重复、下图、写盘、记拉到哪、对账。每一家的不同只在 adapter 里。
 * 写进库的一律经 Vault（和写笔记排同一个队）；图是二进制，直接写进 附件/<笔记路径>/图N.<真实格式>。
 * 不提交、不记自动化记录：交回改了哪些文件和一句「做了什么」，index.ts 交给自动化的记录一次提交（能撤回）。不碰 Electron，单元测试直接跑。
 *
 * 一次拉：
 * - 增量：从新到旧翻，翻到一整页都认得（库里有、删过、说过不拉）就停；
 * - 全量（每天第一次、第一次连上）：翻完整个列表，另外对账：那边改了（没人动过的换、动过的标）、删了（标）、库里删了（记下不再拉）；
 * - 新的落在设置里的文件夹最上层，梦游照用户的分法挪、连双链（同步来源不管归类）。
 */
import {
  attachmentDir,
  defaultSourceFolder,
  type FirstPlan,
  imageExt,
  indexVault,
  knownIds,
  type LocalCopy,
  newSyncState,
  parseSyncState,
  planFirst,
  planFull,
  planNew,
  type RemoteItem,
  setProp,
  type SyncState,
  syncStatePath,
  syncStateText,
  textPrint,
} from '@cn/format'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { atomicWrite, writeQueued } from '@cn/atomic'
import type { Vault } from '../vault'
import { SourceError, type SyncAdapter } from './adapter'

export interface RunnerDeps {
  vault(): Vault | null
  now(): Date
  /** 下一张图（30 秒没下完算了） */
  download(url: string, signal: AbortSignal): Promise<Uint8Array>
  /** 进度：在翻列表第几页、拉到第几篇 */
  progress?(p: { phase: 'list' | 'pull'; done: number; total: number | null }): void
}

export interface PullOpts {
  /** 第一次连上时勾了的（只拉这几篇，列表里别的库里没有的记进 skipped） */
  pick?: string[]
  /** 第一次连上：库里最新那篇建于几时（比它新的空录音算「跳过空录音」） */
  newest?: string
  /** 全量对账（不给时：每天第一次自己做） */
  full?: boolean
}

export interface PullResult {
  pulled: string[]
  images: number
  /** 下不来的图（留着原地址） */
  imageFailed: number
  replaced: number
  marked: number
  deleted: number
  skippedEmpty: number
  /** 改了的文件（相对库）：笔记、图、记录 */
  files: string[]
  /** 一步一句（自动化记录里那一行） */
  did: string[]
  /** 半路停下的原因（拉了几篇照样交回、照样提交） */
  error: SourceError | Error | null
}

const day = (s: string | null) => (s ?? '').slice(0, 10)
const stampOf = (d: Date) => {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export class SourceRunner<Doc = unknown> {
  /** 第一次连上时翻过的整个列表（拉勾的那几篇时不再翻一遍） */
  private listed: { at: number; items: RemoteItem[] } | null = null
  /** 第一次连上时「新的」和「更早的」分在哪（更早的里最新那篇建于几时） */
  firstNewest = ''

  constructor(
    public a: SyncAdapter<Doc>,
    private d: RunnerDeps,
  ) {}

  private v(): Vault {
    const v = this.d.vault()
    if (!v) throw new Error('还没有打开库')
    return v
  }

  async readState(): Promise<SyncState | null> {
    const v = this.v()
    const text = await readFile(v.abs(syncStatePath(this.a.id)), 'utf8').catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    return parseSyncState(text, await this.folderGuess())
  }

  async writeState(s: SyncState): Promise<string> {
    const rel = syncStatePath(this.a.id)
    await writeQueued(this.v().abs(rel), syncStateText(s), { mkdir: true })
    return rel
  }

  /** 整个库里认出来的（只看属性） */
  async index(): Promise<Map<string, LocalCopy>> {
    const v = this.v()
    // 先过一遍盘（没变的不重读）：外面刚挪走、删掉、改过的照盘上的认
    await v.list()
    return indexVault(await v.texts(), this.a.idProp, this.a.idsProp)
  }

  /** 默认文件夹：库里来自这一家的都在哪（一篇都没有时照库语言的默认） */
  async folderGuess(idx?: Map<string, LocalCopy>): Promise<string> {
    const i = idx ?? (await this.index())
    return defaultSourceFolder([...new Set([...i.values()].map((c) => c.path))]) || this.a.defaultFolder()
  }

  /** 翻列表：stop 给了时翻到一整页都在里面就停（增量） */
  async list(signal: AbortSignal, stop?: ReadonlySet<string>): Promise<RemoteItem[]> {
    const out: RemoteItem[] = []
    let cursor: string | null = null
    for (let n = 1; n <= 500; n++) {
      const pg = await this.a.page(cursor, signal)
      out.push(...pg.items)
      this.d.progress?.({ phase: 'list', done: out.length, total: pg.total })
      if (!pg.next || !pg.items.length) break
      if (stop && pg.items.every((x) => stop.has(x.id))) break
      cursor = pg.next
    }
    return out
  }

  /** 第一次连上：翻完整个列表，分成库里已有、比库里最新那篇还新、更早的 */
  async firstPlan(signal: AbortSignal): Promise<FirstPlan> {
    const items = await this.list(signal)
    this.listed = { at: Date.now(), items }
    const plan = planFirst(items, await this.index(), this.d.now())
    this.firstNewest = plan.newer.length ? plan.older.reduce((a, x) => (x.created > a ? x.created : a), '') : ''
    return plan
  }

  /** 拉一次 */
  async pull(opts: PullOpts, signal: AbortSignal): Promise<PullResult> {
    const v = this.v()
    const now = this.d.now()
    let idx = await this.index()
    const st = (await this.readState()) ?? newSyncState(await this.folderGuess(idx))
    const r: PullResult = { pulled: [], images: 0, imageFailed: 0, replaced: 0, marked: 0, deleted: 0, skippedEmpty: 0, files: [], did: [], error: null }
    const files = new Set<string>()
    const full = opts.full || !!opts.pick || day(st.lastFull) !== day(stampOf(now))
    // 拉进来过、库里没了的（删了、撤回了）：记下，不再拉回来
    for (const id of Object.keys(st.notes)) {
      if (idx.has(id)) continue
      st.dropped.push(id)
      delete st.notes[id]
    }
    try {
      const fresh = opts.pick && this.listed && Date.now() - this.listed.at < 30 * 60_000 ? this.listed.items : null
      const remote = fresh ?? (await this.list(signal, full ? undefined : knownIds(st, idx)))
      if (opts.pick) {
        // 第一次连上：只拉勾了的；没勾的、库里没有的以后也不拉（设计页：更早的 37 篇默认不勾）
        const pick = new Set(opts.pick)
        const newest = opts.newest ?? ''
        for (const x of remote) {
          if (idx.has(x.id) || pick.has(x.id)) continue
          st.skipped.push(x.id)
          // 新的那一组里的空录音：记成「跳过空录音」（对话框里说过照设置不拉）
          if (x.empty && st.settings.skipEmpty && x.created > newest) r.skippedEmpty++
        }
      }
      const plan = planNew(remote, knownIds(st, idx), st.settings.skipEmpty)
      for (const e of plan.empty) st.skipped.push(e.id)
      r.skippedEmpty += plan.empty.length
      const total = plan.pull.length
      for (const item of plan.pull) {
        if (signal.aborted) throw new Error('停下了')
        this.d.progress?.({ phase: 'pull', done: r.pulled.length, total })
        const doc = await this.a.fetch(item.id, signal)
        const path = this.freePath(v, st.settings.folder, this.a.fileName(doc))
        const md = await this.write(v, doc, path, null, st, now, r, files, signal)
        st.notes[item.id] = { u: this.a.updated(doc), h: textPrint(md) }
        r.pulled.push(path)
      }
      this.d.progress?.({ phase: 'pull', done: r.pulled.length, total })
      if (full) {
        idx = await this.index()
        const fp = planFull(remote, idx, st, { deleted: this.a.deletedProp, newer: this.a.newerProp })
        for (const id of fp.dropped) {
          st.dropped.push(id)
          delete st.notes[id]
        }
        for (const x of fp.replace) {
          if (signal.aborted) throw new Error('停下了')
          const doc = await this.a.fetch(x.id, signal)
          const md = await this.write(v, doc, x.path, idx.get(x.id)!.text, st, now, r, files, signal)
          st.notes[x.id] = { u: this.a.updated(doc), h: textPrint(md) }
          r.replaced++
        }
        for (const x of fp.mark) await this.setProp(v, x.path, idx.get(x.id)!.text, this.a.newerProp, x.updated, files).then((ok) => ok && r.marked++)
        for (const x of fp.deleted) await this.setProp(v, x.path, idx.get(x.id)!.text, this.a.deletedProp, stampOf(now).slice(0, 10), files).then((ok) => ok && r.deleted++)
        st.lastFull = stampOf(now)
      }
    } catch (e) {
      r.error = e as Error
    }
    st.lastPull = stampOf(now)
    files.add(await this.writeState(st))
    r.files = [...files]
    // 不翻：写进库里自动化记录的一句（和自动化别的记录一样是中文）
    if (r.pulled.length) r.did.push(`拉了${r.pulled.length}篇` + (r.images ? ` · 下了${r.images}张图` : ''))
    if (r.replaced) r.did.push(`${r.replaced}篇${this.a.name}那边改了，换成新的`)
    if (r.marked) r.did.push(`${r.marked}篇标了「${this.a.name}里有新版」`)
    if (r.deleted) r.did.push(`${r.deleted}篇标了「${this.a.name}里删了」`)
    if (r.skippedEmpty) r.did.push(`跳过${r.skippedEmpty}篇空录音`)
    if (r.imageFailed) r.did.push(`${r.imageFailed}张图没下来，留着原地址`)
    if (!r.did.length && !r.error) r.did.push('没有新的')
    return r
  }

  /** 新的一篇放哪：标题当文件名，重了加「 (2)」 */
  private freePath(v: Vault, folder: string, name: string): string {
    for (let n = 1; ; n++) {
      const p = `${folder ? folder + '/' : ''}${name}${n > 1 ? ` (${n})` : ''}.md`
      if (!existsSync(v.abs(p)) && !existsSync(v.abs(attachmentDir(p)))) return p
    }
  }

  /** 下图、写成 md、写盘（before 是 null：新建；不然先比后写） */
  private async write(v: Vault, doc: Doc, path: string, before: string | null, st: SyncState, now: Date, r: PullResult, files: Set<string>, signal: AbortSignal): Promise<string> {
    const local = new Map<string, string>()
    if (st.settings.images) {
      let k = 0
      for (const url of this.a.images(doc, st.settings)) {
        k++
        try {
          const bytes = await this.d.download(url, signal)
          const rel = `${attachmentDir(path)}/图${k}.${imageExt(bytes)}`
          await mkdir(dirname(v.abs(rel)), { recursive: true })
          await atomicWrite(v.abs(rel), bytes)
          local.set(url, rel)
          files.add(rel)
          r.images++
        } catch (e) {
          if (signal.aborted) throw e
          r.imageFailed++
          console.warn(`[同步来源] 图没下来（${(e as Error).message}）`)
        }
      }
    }
    const md = this.a.render(doc, { path, images: local, settings: st.settings, now })
    const w = await v.write(path, md, before ?? '')
    if (!w.ok) throw new Error(`《${path.split('/').pop()!.replace(/\.md$/, '')}》刚被别处改过，没换`)
    files.add(path)
    return md
  }

  private async setProp(v: Vault, path: string, text: string, key: string, value: string, files: Set<string>): Promise<boolean> {
    const next = setProp(text, key, value)
    if (next === text) return false
    const w = await v.write(path, next, text)
    if (!w.ok) return false
    files.add(path)
    return true
  }
}
