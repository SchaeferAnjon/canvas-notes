/**
 * 读备忘录：直接读它的数据库 NoteStore.sqlite（~/Library/Group Containers/group.com.apple.notes/），只读。
 * 为什么不用 AppleScript：AppleScript 拿到的 HTML 里勾选清单分不出勾没勾、图片和附件大多拿不到；
 * 数据库里是原样的（勾选、图片、表格、扫描、手写的预览图都在），Obsidian Importer 也是这么读的。
 * 读之前把数据库连同 -wal、-shm 拷到临时目录（备忘录开着时也在写它），读完删掉。
 * 不依赖 Electron（node:sqlite），单元测试用测试造的数据库。
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync } from 'node:zlib'
import type { ImportFolder } from '../../shared/import'
import { decodeNoteData, firstLine, noteToMarkdown, readNote, type AppleNote, type Embed } from './apple-notes-md'
import { Pb } from './protobuf'
import { attRef, type ImportNote } from './write'

export const NOTES_DB = 'NoteStore.sqlite'
/** Core Data 的时间从 2001-01-01 算起 */
const CORE_EPOCH = 978307200

const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg)$/i

type Row = Record<string, unknown>

/** 和 ImportNote 一样，多一点给统计用的 */
export interface ReadNote extends ImportNote {
  /** 没导全的地方（种类 → 个数），汇总进结果 */
  lost: Record<string, number>
}

export class NoteStore {
  private db: DatabaseSync
  private tmp: string
  private ent: Record<string, number>
  private cols: Set<string>
  private accounts: string[]
  private titles = new Map<string, string>()

  /** dataDir：group.com.apple.notes 那个文件夹 */
  constructor(private readonly dataDir: string) {
    const src = join(dataDir, NOTES_DB)
    if (!existsSync(src)) throw new Error('这个文件夹里没有备忘录的数据库（NoteStore.sqlite）。要选的是「group.com.apple.notes」。')
    this.tmp = mkdtempSync(join(tmpdir(), 'cn-notes-'))
    for (const ext of ['', '-wal', '-shm']) if (existsSync(src + ext)) copyFileSync(src + ext, join(this.tmp, NOTES_DB + ext))
    // 只读打开会读不到 -wal 里还没并进去的笔记；拷出来的副本随便写
    this.db = new DatabaseSync(join(this.tmp, NOTES_DB))
    this.ent = Object.fromEntries((this.db.prepare('SELECT Z_ENT, Z_NAME FROM Z_PRIMARYKEY').all() as Row[]).map((r) => [r.Z_NAME as string, r.Z_ENT as number]))
    this.cols = new Set((this.db.prepare('PRAGMA table_info(ZICCLOUDSYNCINGOBJECT)').all() as Row[]).map((r) => String(r.name).toUpperCase()))
    this.accounts = (this.db.prepare('SELECT ZIDENTIFIER FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ?').all(this.ent.ICAccount ?? -1) as Row[]).map((r) => String(r.ZIDENTIFIER))
  }

  close() {
    this.db.close()
    rmSync(this.tmp, { recursive: true, force: true })
  }

  /** 各版本的列不一样（ZCREATIONDATE3、ZGENERATION1……），没有的当 NULL */
  private c(name: string, as = name): string {
    return this.cols.has(name) ? `${name} AS ${as}` : `NULL AS ${as}`
  }
  private alive(alias = ''): string {
    return this.cols.has('ZMARKEDFORDELETION') ? `AND (${alias}ZMARKEDFORDELETION IS NULL OR ${alias}ZMARKEDFORDELETION = 0)` : ''
  }

  /** 文件夹（不含最近删除和智能文件夹），带每个的笔记数、上锁数、附件数 */
  folders(): ImportFolder[] {
    const rows = this.db
      .prepare(`SELECT Z_PK, ZTITLE2, ZPARENT, ZFOLDERTYPE, ZIDENTIFIER FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ? AND ZTITLE2 IS NOT NULL ${this.alive()}`)
      .all(this.ent.ICFolder ?? -1) as Row[]
    const notes = new Map(
      (
        this.db
          .prepare(`SELECT ZFOLDER AS f, COUNT(*) AS n, SUM(CASE WHEN ${this.cols.has('ZISPASSWORDPROTECTED') ? 'ZISPASSWORDPROTECTED' : 0} = 1 THEN 1 ELSE 0 END) AS locked FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ? AND ZTITLE1 IS NOT NULL ${this.alive()} GROUP BY ZFOLDER`)
          .all(this.ent.ICNote ?? -1) as Row[]
      ).map((r) => [Number(r.f), { n: Number(r.n), locked: Number(r.locked) }]),
    )
    const atts = new Map(
      (
        this.db
          .prepare(
            `SELECT n.ZFOLDER AS f, COUNT(*) AS n FROM ZICCLOUDSYNCINGOBJECT a JOIN ZICCLOUDSYNCINGOBJECT n ON n.Z_PK = a.ZNOTE
             WHERE a.Z_ENT = ? AND (a.ZTYPEUTI IS NULL OR a.ZTYPEUTI NOT LIKE 'com.apple.notes.inlinetextattachment%') GROUP BY n.ZFOLDER`,
          )
          .all(this.ent.ICAttachment ?? -1) as Row[]
      ).map((r) => [Number(r.f), Number(r.n)]),
    )
    const byPk = new Map(rows.map((r) => [Number(r.Z_PK), r]))
    const keep = rows.filter((r) => Number(r.ZFOLDERTYPE ?? 0) === 0)
    const pathOf = (r: Row): string[] => {
      const parent = r.ZPARENT == null ? undefined : byPk.get(Number(r.ZPARENT))
      return [...(parent && Number(parent.ZFOLDERTYPE ?? 0) === 0 ? pathOf(parent) : []), String(r.ZTITLE2)]
    }
    const out = keep.map((r) => {
      const p = pathOf(r)
      const c = notes.get(Number(r.Z_PK))
      return { id: String(r.Z_PK), name: String(r.ZTITLE2), path: p.join('/'), depth: p.length - 1, notes: c?.n ?? 0, locked: c?.locked ?? 0, already: 0, attachments: atts.get(Number(r.Z_PK)) ?? 0 }
    })
    // 父文件夹排在子文件夹前面，同层按名字
    return out.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
  }

  /** 选中文件夹里的笔记（上锁的不在里面，另外数） */
  noteRows(folderIds: string[]): Row[] {
    const ids = folderIds.map(Number).filter(Number.isInteger)
    if (!ids.length) return []
    return this.db
      .prepare(
        `SELECT n.Z_PK AS pk, n.ZTITLE1 AS title, n.ZFOLDER AS folder, n.ZIDENTIFIER AS ident,
           ${this.c('ZCREATIONDATE3', 'c3')}, ${this.c('ZCREATIONDATE2', 'c2')}, ${this.c('ZCREATIONDATE1', 'c1')}, ${this.c('ZMODIFICATIONDATE1', 'm1')},
           ${this.c('ZISPASSWORDPROTECTED', 'locked')}
         FROM ZICCLOUDSYNCINGOBJECT n
         WHERE n.Z_ENT = ? AND n.ZTITLE1 IS NOT NULL AND n.ZFOLDER IN (${ids.map(() => '?').join(',')}) ${this.alive('n.')}
         ORDER BY n.ZFOLDER, n.Z_PK`,
      )
      .all(this.ent.ICNote ?? -1, ...ids) as Row[]
  }

  private time(v: unknown): number | null {
    const t = Number(v)
    return v == null || !Number.isFinite(t) || t <= 0 ? null : Math.round((t + CORE_EPOCH) * 1000)
  }

  private data(pk: number): AppleNote | null {
    const r = this.db.prepare('SELECT ZDATA FROM ZICNOTEDATA WHERE ZNOTE = ?').get(pk) as Row | undefined
    return r?.ZDATA instanceof Uint8Array ? decodeNoteData(r.ZDATA) : null
  }

  /** 另一条笔记的标题（备忘录里的笔记链接 → [[标题]]） */
  private titleOfIdent(ident: string): string | null {
    const key = ident.toUpperCase()
    if (this.titles.has(key)) return this.titles.get(key)!
    const r = this.db.prepare('SELECT Z_PK, ZTITLE1 FROM ZICCLOUDSYNCINGOBJECT WHERE UPPER(ZIDENTIFIER) = ? AND Z_ENT = ?').get(key, this.ent.ICNote ?? -1) as Row | undefined
    if (!r) return null
    const note = this.data(Number(r.Z_PK))
    const t = (note && firstLine(note.text)) || String(r.ZTITLE1 ?? '')
    this.titles.set(key, t)
    return t
  }

  /** 附件文件在哪：账号文件夹里，或者老版本放在数据文件夹根上 */
  private file(rel: string): string | null {
    for (const base of [...this.accounts.map((a) => join(this.dataDir, 'Accounts', a)), this.dataDir]) {
      const p = join(base, rel)
      if (existsSync(p)) return p
    }
    return null
  }

  private row(ident: string): Row | undefined {
    return this.db.prepare('SELECT * FROM ZICCLOUDSYNCINGOBJECT WHERE ZIDENTIFIER = ?').get(ident) as Row | undefined
  }

  private mediaFile(mediaPk: unknown): { path: string; name: string } | null {
    if (mediaPk == null) return null
    const m = this.db.prepare(`SELECT ZIDENTIFIER, ZFILENAME, ${this.c('ZGENERATION1', 'gen')} FROM ZICCLOUDSYNCINGOBJECT WHERE Z_PK = ?`).get(Number(mediaPk)) as Row | undefined
    if (!m?.ZFILENAME) return null
    const name = String(m.ZFILENAME)
    const p = this.file(join('Media', String(m.ZIDENTIFIER), String(m.gen ?? ''), name)) ?? this.file(join('Media', String(m.ZIDENTIFIER), name))
    return p ? { path: p, name } : null
  }

  /** 一条笔记 → 要写进库的样子 */
  read(r: Row, folderPath: string, source: string): ReadNote {
    const note = this.data(Number(r.pk))
    if (!note) throw new Error(`「${r.title}」的内容读不出来`)
    const title = firstLine(note.text) || String(r.title ?? '') || '未命名'
    const attachments: { src: string; name: string }[] = []
    const lost: Record<string, number> = {}
    const miss = (what: string) => (lost[what] = (lost[what] ?? 0) + 1)
    const add = (path: string, name: string) => {
      // 库里的文件名用笔记标题（重了写盘时加序号），链接上的字用原来的文件名
      attachments.push({ src: path, name: title.slice(0, 50) + (extname(name) || extname(path)) })
      const ref = attRef(attachments.length - 1)
      return IMAGE.test(name) ? `![](${ref})` : `[${name.replace(/[[\]]/g, '')}](${ref})`
    }

    const embed: Embed = (id, uti) => {
      const a = this.row(id)
      if (uti === 'com.apple.notes.inlinetextattachment.hashtag' || uti === 'com.apple.notes.inlinetextattachment.mention') return { md: String(a?.ZALTTEXT ?? ''), block: false }
      if (uti === 'com.apple.notes.inlinetextattachment.link') {
        const to = /applenotes:note\/([-0-9a-fA-F]+)/.exec(String(a?.ZTOKENCONTENTIDENTIFIER ?? ''))?.[1]
        const t = to && this.titleOfIdent(to)
        return { md: t ? `[[${t}]]` : String(a?.ZALTTEXT ?? ''), block: false }
      }
      if (!a) return (miss('附件找不到'), { md: '', block: false })
      if (uti === 'public.url') return { md: `[${String(a.ZTITLE ?? a.ZURLSTRING ?? '链接').replace(/[[\]]/g, '')}](${String(a.ZURLSTRING ?? '').replace(/[()\s]/g, encodeURIComponent)})`, block: true }
      if (uti === 'com.apple.notes.table') {
        const md = a.ZMERGEABLEDATA1 instanceof Uint8Array ? tableMarkdown(a.ZMERGEABLEDATA1, embed) : ''
        if (!md) miss('表格没读出来')
        return { md, block: true }
      }
      if (uti === 'com.apple.notes.gallery') {
        // 扫描的文稿：每页一张图（裁好的预览图，没有就用原图）
        const pages = a.ZMERGEABLEDATA1 instanceof Uint8Array ? scanPages(a.ZMERGEABLEDATA1) : []
        const out: string[] = []
        for (const id of pages) {
          const p = this.row(id)
          const preview = p && this.file(join('Previews', `${p.ZIDENTIFIER}-1-${p.ZSIZEWIDTH}x${p.ZSIZEHEIGHT}-0.jpeg`))
          const media = p && this.mediaFile(p.ZMEDIA)
          if (preview) out.push(add(preview, '扫描.jpeg'))
          else if (media) out.push(add(media.path, media.name))
          else miss('扫描页不在这台 Mac 上')
        }
        return { md: out.join('\n'), block: true }
      }
      if (uti === 'com.apple.paper.doc.scan') {
        const p = this.file(join('FallbackPDFs', String(a.ZIDENTIFIER), String(a.ZFALLBACKPDFGENERATION ?? ''), 'FallbackPDF.pdf'))
        if (!p) return (miss('扫描页不在这台 Mac 上'), { md: '', block: false })
        return { md: add(p, '扫描.pdf'), block: true }
      }
      if (uti === 'com.apple.paper' || uti === 'com.apple.drawing' || uti === 'com.apple.drawing.2') {
        // 手写和画的图：只有它生成的那张预览图，笔画本身导不出来
        const p =
          this.file(join('FallbackImages', String(a.ZIDENTIFIER), String(a.ZFALLBACKIMAGEGENERATION ?? ''), 'FallbackImage.png')) ??
          this.file(join('FallbackImages', `${a.ZIDENTIFIER}.jpg`)) ??
          this.file(join('FallbackImages', `${a.ZIDENTIFIER}.png`))
        if (!p) return (miss('手写不在这台 Mac 上'), { md: '', block: false })
        miss('手写只导了图')
        return { md: add(p, p.endsWith('.jpg') ? '手写.jpg' : '手写.png'), block: true }
      }
      const f = this.mediaFile(a.ZMEDIA)
      if (!f) return (miss('附件不在这台 Mac 上（还在 iCloud 里）'), { md: '', block: false })
      return { md: add(f.path, f.name), block: true }
    }

    embed.noteTitle = (ident) => this.titleOfIdent(ident)
    const body = noteToMarkdown(note, embed, { omitTitle: true })
    const created = this.time(r.c3) ?? this.time(r.c2) ?? this.time(r.c1) ?? Date.now()
    return {
      folder: folderPath,
      title,
      text: body ? body + '\n' : '',
      props: [['来源', source], ...(folderPath ? [['原文件夹', folderPath] as [string, string]] : [])],
      created,
      updated: this.time(r.m1) ?? created,
      attachments,
      id: `apple-notes:${r.ident}`,
      lost,
    }
  }
}

// ---------- 表格和扫描：CRDT 的 MergableDataProto（gzip 过） ----------
// MergableDataProto { 2: MergableDataObject { 3: Data { 3: Entry[], 4: 键名[], 5: 类型名[], 6: UUID[] } } }
// Entry { 6: Dictionary { 1: { 1: 键 ObjectID, 2: 值 ObjectID }[] }, 10: Note, 13: CustomMap { 1: 类型, 3: { 1: 键, 2: 值 ObjectID }[] }, 16: OrderedSet }
// ObjectID { 2: 无符号整数, 4: 字符串, 6: 第几个 Entry }

function mergeable(gz: Uint8Array) {
  const data = Pb.decode(gunzipSync(gz)).msg(2)?.msg(3)
  if (!data) return null
  return {
    entries: data.msgs(3),
    keys: data.allBytes(4).map((b) => Buffer.from(b).toString('utf8')),
    types: data.allBytes(5).map((b) => Buffer.from(b).toString('utf8')),
    uuids: data.allBytes(6).map((b) => Buffer.from(b).toString('hex')),
  }
}

/** 扫描文稿里每一页的附件 ID */
export function scanPages(gz: Uint8Array): string[] {
  const m = mergeable(gz)
  if (!m) return []
  return m.entries.flatMap((e) => {
    const id = e.msg(13)?.msgs(3)[0]?.msg(2)?.str(4)
    return id ? [id] : []
  })
}

/** 表格 → md 表格；认不出来返回 '' */
export function tableMarkdown(gz: Uint8Array, embed: Embed): string {
  const m = mergeable(gz)
  if (!m) return ''
  const { entries, keys, types, uuids } = m
  const target = (oid: Pb | undefined) => {
    const ref = entries[oid?.int(6) ?? -1]
    const i = ref?.msg(13)?.msgs(3)[0]?.msg(2)?.int(2)
    return i === undefined ? '' : (uuids[i] ?? '')
  }
  const locations = (e: Pb | undefined): [Map<string, number>, number] => {
    const ordering = e?.msg(16)?.msg(1)
    const order = (ordering?.msg(1)?.msgs(2) ?? []).map((a) => Buffer.from(a.bytes(2) ?? []).toString('hex'))
    const at = new Map<string, number>()
    for (const el of ordering?.msg(2)?.msgs(1) ?? []) at.set(target(el.msg(2)), order.indexOf(target(el.msg(1))))
    return [at, order.length]
  }
  const root = entries.find((e) => types[e.msg(13)?.int(1) ?? -1] === 'com.apple.notes.ICTable')
  if (!root) return ''
  let rows: [Map<string, number>, number] = [new Map(), 0]
  let cols: [Map<string, number>, number] = [new Map(), 0]
  let cells: Pb | undefined
  for (const me of root.msg(13)!.msgs(3)) {
    const obj = entries[me.msg(2)?.int(6) ?? -1]
    const key = keys[me.int(1) ?? -1]
    if (key === 'crRows') rows = locations(obj)
    else if (key === 'crColumns') cols = locations(obj)
    else if (key === 'cellColumns') cells = obj
  }
  if (!cells || !rows[1] || !cols[1]) return ''
  const grid = Array.from({ length: rows[1] }, () => Array<string>(cols[1]).fill(''))
  for (const col of cells.msg(6)?.msgs(1) ?? []) {
    const c = cols[0].get(target(col.msg(1)))
    const rowData = entries[col.msg(2)?.int(6) ?? -1]
    for (const row of rowData?.msg(6)?.msgs(1) ?? []) {
      const r = rows[0].get(target(row.msg(1)))
      const content = entries[row.msg(2)?.int(6) ?? -1]?.msg(10)
      if (r === undefined || c === undefined || r < 0 || c < 0 || !content) continue
      grid[r]![c] = noteToMarkdown(readNote(content), embed, { table: true })
    }
  }
  return grid.map((r, i) => `| ${r.join(' | ')} |` + (i === 0 ? `\n|${' --- |'.repeat(r.length)}` : '')).join('\n')
}
