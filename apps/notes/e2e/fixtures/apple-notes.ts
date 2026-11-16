/**
 * 测试用的「备忘录数据文件夹」（group.com.apple.notes 的样子）：NoteStore.sqlite + Accounts/<账号>/Media/ 里的图片。
 * 表和列照真的备忘录数据库（ZICCLOUDSYNCINGOBJECT、ZICNOTEDATA、Z_PRIMARYKEY），笔记内容是 gzip 过的 protobuf。
 * 不碰用户真的备忘录。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { pbEncode, type PbField } from '../../src/main/import/protobuf'

/** 一段：字（可以分几截带粗体、删除线、链接）、图片、表格、标签 */
export type FakePara =
  | { text: string; style?: number; indent?: number; done?: boolean; quote?: boolean; parts?: { text: string; weight?: number; strike?: boolean; link?: string }[] }
  | { image: string; bytes: Uint8Array }
  | { table: string[][] }
  | { hashtag: string }
  | { linkTo: string }

export interface FakeNote {
  folder: string
  paras: FakePara[]
  created: Date
  modified: Date
  locked?: boolean
  /** 给别的笔记链过来用 */
  ident?: string
}

export interface FakeFolder {
  name: string
  parent?: string
  /** 1 是最近删除 */
  type?: number
}

const ACCOUNT = 'TEST-ACCOUNT-0001'
const ENT = { ICAccount: 1, ICFolder: 2, ICNote: 3, ICAttachment: 4, ICMedia: 5, ICInlineAttachment: 6 }
const core = (d: Date) => d.getTime() / 1000 - 978307200

export function fakeNotesFolder(dir: string, folders: FakeFolder[], notes: FakeNote[]) {
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'NoteStore.sqlite'))
  db.exec(`
    CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER PRIMARY KEY, Z_NAME VARCHAR, Z_SUPER INTEGER, Z_MAX INTEGER);
    CREATE TABLE ZICNOTEDATA (Z_PK INTEGER PRIMARY KEY, ZNOTE INTEGER, ZDATA BLOB);
    CREATE TABLE ZICCLOUDSYNCINGOBJECT (
      Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZIDENTIFIER VARCHAR, ZNAME VARCHAR, ZTITLE1 VARCHAR, ZTITLE2 VARCHAR,
      ZFOLDER INTEGER, ZPARENT INTEGER, ZFOLDERTYPE INTEGER, ZOWNER INTEGER, ZNOTE INTEGER, ZMEDIA INTEGER, ZTYPEUTI VARCHAR,
      ZFILENAME VARCHAR, ZGENERATION1 VARCHAR, ZALTTEXT VARCHAR, ZTOKENCONTENTIDENTIFIER VARCHAR, ZMERGEABLEDATA1 BLOB,
      ZCREATIONDATE1 TIMESTAMP, ZCREATIONDATE3 TIMESTAMP, ZMODIFICATIONDATE1 TIMESTAMP, ZISPASSWORDPROTECTED INTEGER,
      ZMARKEDFORDELETION INTEGER, ZTITLE VARCHAR, ZURLSTRING VARCHAR, ZSIZEWIDTH INTEGER, ZSIZEHEIGHT INTEGER
    );`)
  for (const [name, ent] of Object.entries(ENT)) db.prepare('INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME) VALUES (?, ?)').run(ent, name)
  let pk = 1
  const obj = (o: Record<string, string | number | Uint8Array | null>) => {
    const id = pk++
    const keys = Object.keys(o)
    db.prepare(`INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).run(id, ...Object.values(o))
    return id
  }
  const account = obj({ Z_ENT: ENT.ICAccount, ZIDENTIFIER: ACCOUNT, ZNAME: 'iCloud' })
  const folderPk = new Map<string, number>()
  for (const f of folders) {
    folderPk.set(
      f.name,
      obj({ Z_ENT: ENT.ICFolder, ZIDENTIFIER: `FOLDER-${pk}`, ZTITLE2: f.name, ZPARENT: f.parent ? folderPk.get(f.parent)! : null, ZFOLDERTYPE: f.type ?? 0, ZOWNER: account }),
    )
  }
  let seq = 0
  const uid = (p: string) => `${p}-${String(++seq).padStart(6, '0')}`
  for (const n of notes) {
    const ident = n.ident ?? uid('NOTE')
    const firstText = n.paras.find((p): p is Extract<FakePara, { text: string }> => 'text' in p)?.text ?? ''
    const notePk = obj({
      Z_ENT: ENT.ICNote,
      ZIDENTIFIER: ident,
      ZTITLE1: firstText.slice(0, 40),
      ZFOLDER: folderPk.get(n.folder)!,
      ZCREATIONDATE3: core(n.created),
      ZMODIFICATIONDATE1: core(n.modified),
      ZISPASSWORDPROTECTED: n.locked ? 1 : 0,
    })
    let text = ''
    const runs: Uint8Array[] = []
    const run = (s: string, f: Record<number, PbField | undefined> = {}) => {
      text += s
      runs.push(pbEncode({ 1: s.length, ...f }))
    }
    const attach = (uti: string, extra: Record<string, string | number | Uint8Array | null>) => {
      const id = uid('ATT')
      obj({ Z_ENT: uti.includes('inlinetextattachment') ? ENT.ICInlineAttachment : ENT.ICAttachment, ZIDENTIFIER: id, ZTYPEUTI: uti, ZNOTE: notePk, ...extra })
      run('\uFFFC', { 12: pbEncode({ 1: id, 2: uti }) })
    }
    for (const p of n.paras) {
      if ('text' in p) {
        const style = p.style !== undefined || p.indent || p.quote ? pbEncode({ 1: p.style, 4: p.indent, 5: p.style === 103 ? pbEncode({ 1: new Uint8Array(16), 2: p.done ? 1 : 0 }) : undefined, 8: p.quote ? 1 : undefined }) : undefined
        for (const part of p.parts ?? [{ text: p.text }]) run(part.text, { 2: style, 5: part.weight, 7: part.strike ? 1 : undefined, 9: part.link })
        run('\n', { 2: style })
      } else if ('image' in p) {
        const mid = uid('MEDIA')
        const mediaPk = obj({ Z_ENT: ENT.ICMedia, ZIDENTIFIER: mid, ZFILENAME: p.image, ZGENERATION1: 'gen1' })
        const at = join(dir, 'Accounts', ACCOUNT, 'Media', mid, 'gen1')
        mkdirSync(at, { recursive: true })
        writeFileSync(join(at, p.image), p.bytes)
        attach('public.jpeg', { ZMEDIA: mediaPk })
        run('\n')
      } else if ('table' in p) {
        attach('com.apple.notes.table', { ZMERGEABLEDATA1: tableData(p.table) })
        run('\n')
      } else if ('hashtag' in p) {
        attach('com.apple.notes.inlinetextattachment.hashtag', { ZALTTEXT: p.hashtag })
        run('\n')
      } else {
        attach('com.apple.notes.inlinetextattachment.link', { ZTOKENCONTENTIDENTIFIER: `applenotes:note/${p.linkTo}?ownerIdentifier=x`, ZALTTEXT: '链接' })
        run('\n')
      }
    }
    const doc = pbEncode({ 2: pbEncode({ 2: 0, 3: pbEncode({ 2: text, 5: runs }) }) })
    db.prepare('INSERT INTO ZICNOTEDATA (ZNOTE, ZDATA) VALUES (?, ?)').run(notePk, gzipSync(doc))
  }
  db.close()
}

/** 备忘录表格的 CRDT（MergableDataProto）：行、列各一串 UUID，格子是一条小 Note */
function tableData(cells: string[][]): Uint8Array {
  const rows = cells.length
  const cols = cells[0]!.length
  const uuid = (k: number) => Uint8Array.from({ length: 16 }, (_, i) => (i === 15 ? k : 0xaa))
  const uuids = [...Array(rows + cols)].map((_, k) => uuid(k))
  const keys = ['crRows', 'crColumns', 'cellColumns', 'self']
  const types = ['com.apple.notes.ICTable', 'com.apple.CRDT.NSUUID', 'com.apple.CRDT.CRTree']
  const entries: Uint8Array[] = []
  const add = (e: Uint8Array) => entries.push(e) - 1
  const oid = (i: number) => pbEncode({ 6: i })
  // 每个 UUID 一个 Entry（customMap 第一项是 UUID 的序号）
  const uref = uuids.map((_, k) => add(pbEncode({ 13: pbEncode({ 1: 1, 3: [pbEncode({ 1: 3, 2: pbEncode({ 2: k }) })] }) })))
  const ordered = (ks: number[]) =>
    // OrderedSet { 1: ordering { 1: array { 1: Note, 2: 每个 UUID 的位置 }, 2: Dictionary（UUID → UUID） } }
    pbEncode({
      16: pbEncode({
        1: pbEncode({
          1: pbEncode({ 1: pbEncode({ 2: 'x' }), 2: ks.map((k, i) => pbEncode({ 1: i, 2: uuids[k]! })) }),
          2: pbEncode({ 1: ks.map((k) => pbEncode({ 1: oid(uref[k]!), 2: oid(uref[k]!) })) }),
        }),
      }),
    })
  const rowIdx = [...Array(rows)].map((_, r) => r)
  const colIdx = [...Array(cols)].map((_, c) => rows + c)
  const rowsE = add(ordered(rowIdx))
  const colsE = add(ordered(colIdx))
  const colEntries = colIdx.map((c, ci) => {
    const cellsOfCol = rowIdx.map((r) => {
      const t = cells[r]![ci]!
      return pbEncode({ 1: oid(uref[r]!), 2: oid(add(pbEncode({ 10: pbEncode({ 2: t, 5: [pbEncode({ 1: t.length })] }) }))) })
    })
    return pbEncode({ 1: oid(uref[c]!), 2: oid(add(pbEncode({ 6: pbEncode({ 1: cellsOfCol }) }))) })
  })
  const cellsE = add(pbEncode({ 6: pbEncode({ 1: colEntries }) }))
  add(pbEncode({ 13: pbEncode({ 1: 0, 3: [pbEncode({ 1: 0, 2: oid(rowsE) }), pbEncode({ 1: 1, 2: oid(colsE) }), pbEncode({ 1: 2, 2: oid(cellsE) })] }) }))
  const data = pbEncode({ 3: entries, 4: keys, 5: types, 6: uuids })
  return gzipSync(pbEncode({ 2: pbEncode({ 2: 1, 3: data }) }))
}
