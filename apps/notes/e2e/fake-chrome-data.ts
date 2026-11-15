import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** 假 Chrome 用户里的书签（Bookmarks 文件，格式和 Chrome 一样） */
export function writeBookmarks(profileDir: string, bar: unknown[], other: unknown[] = []) {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    join(profileDir, 'Bookmarks'),
    JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: bar }, other: { type: 'folder', name: 'Other bookmarks', children: other } }, version: 1 }),
  )
}

export const url = (name: string, u: string) => ({ type: 'url', name, url: u })
export const folder = (name: string, children: unknown[]) => ({ type: 'folder', name, children })

/** 假 Chrome 用户里的历史（History 库的 urls 表） */
export function writeHistory(profileDir: string, rows: { url: string; title: string; visits: number; at: Date }[]) {
  mkdirSync(profileDir, { recursive: true })
  const db = new DatabaseSync(join(profileDir, 'History'))
  db.exec('CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)')
  const ins = db.prepare('INSERT INTO urls(url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?,?,?,?,?,0)')
  for (const r of rows) ins.run(r.url, r.title, r.visits, 0, BigInt(Math.round((r.at.getTime() / 1000 + 11644473600) * 1e6)))
  db.close()
}

/** 插件 id 和 Chrome 一样从公钥算：SHA-256 前 16 字节，每半字节换成 a-p */
function keyAndId(): { key: string; id: string } {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const der = publicKey.export({ type: 'spki', format: 'der' })
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32)
  return { key: der.toString('base64'), id: [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('') }
}

/**
 * 装一个假插件到假 Chrome 用户的 Extensions/<id>/<版本>/：manifest（带 key，id 固定）加上给的文件。
 * 返回插件 id。
 */
export function installExtension(profileDir: string, manifest: Record<string, unknown>, files: Record<string, string | Buffer>, version = '1.0.0'): string {
  const { key, id } = keyAndId()
  const dir = join(profileDir, 'Extensions', id, `${version}_0`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, version, key, ...manifest }, null, 2))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return id
}
