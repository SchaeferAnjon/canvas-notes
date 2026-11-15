import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const FAKE_PASSWORD = 'test-keychain-password'

/** 一个假的 Chrome 资料夹：Local State 加一个用户，Cookies 库里的值按 Chrome 的方式加密 */
export function makeFakeChrome(root: string, cookies: { host: string; name: string; value: string; expired?: boolean }[]) {
  mkdirSync(join(root, 'Default', 'Network'), { recursive: true })
  mkdirSync(join(root, 'Profile 1'), { recursive: true })
  writeFileSync(
    join(root, 'Local State'),
    JSON.stringify({ profile: { info_cache: { Default: { name: '工作', user_name: 'me@example.com' }, 'Profile 1': { name: '个人' } }, profiles_order: ['Default', 'Profile 1'] } }),
  )
  const key = pbkdf2Sync(FAKE_PASSWORD, 'saltysalt', 1003, 16, 'sha1')
  const db = new DatabaseSync(join(root, 'Default', 'Network', 'Cookies'))
  db.exec(`CREATE TABLE meta(key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24');
    CREATE TABLE cookies(host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER,
      is_secure INTEGER, is_httponly INTEGER, has_expires INTEGER, samesite INTEGER, top_frame_site_key TEXT)`)
  const ins = db.prepare('INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  for (const c of cookies) {
    const plain = Buffer.concat([createHash('sha256').update(c.host).digest(), Buffer.from(c.value)])
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const enc = Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()])
    const when = (c.expired ? Date.now() / 1000 - 3600 : Date.now() / 1000 + 86400 * 30) + 11644473600
    ins.run(c.host, c.name, '', enc, '/', Math.round(when * 1e6), 0, 1, 1, -1, '')
  }
  db.close()
}
