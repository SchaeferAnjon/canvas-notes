import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { solidPng } from '../e2e/fixtures/png'
import { ChromeFavicons, iconLinks, iconOk, NotedIcons } from '../src/main/web/favicon-source'

const gif = (w: number, h: number) => {
  const b = Buffer.alloc(32)
  b.write('GIF89a', 0, 'latin1')
  b.writeUInt16LE(w, 6)
  b.writeUInt16LE(h, 8)
  return b
}
const ico = (sizes: number[]) => {
  const b = Buffer.alloc(6 + sizes.length * 16 + 8)
  b.writeUInt16LE(1, 2)
  b.writeUInt16LE(sizes.length, 4)
  sizes.forEach((s, i) => ((b[6 + i * 16] = s % 256), (b[6 + i * 16 + 1] = s % 256)))
  return b
}
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0])

const tmp = mkdtempSync(join(tmpdir(), 'cn-favicon-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('网站小图标（CN-33）', () => {
  it('验图标：太小（1×1 透明图）、坏的、其实是网页的都不算；够大的 PNG、GIF、ICO、JPEG、SVG 算', () => {
    expect(iconOk(solidPng(32, 32, [0, 0, 0]), 'image/png')).toBe('image/png')
    expect(iconOk(solidPng(1, 1, [0, 0, 0]), 'image/png')).toBeNull()
    expect(iconOk(gif(16, 16), 'image/gif')).toBe('image/gif')
    expect(iconOk(gif(1, 1), 'image/gif')).toBeNull()
    expect(iconOk(ico([16, 32]), '')).toBe('image/x-icon')
    expect(iconOk(ico([0]), '')).toBe('image/x-icon')
    expect(iconOk(ico([8]), 'image/x-icon')).toBeNull()
    expect(iconOk(jpeg(48, 48), 'image/jpeg')).toBe('image/jpeg')
    expect(iconOk(jpeg(1, 1), 'image/jpeg')).toBeNull()
    expect(iconOk(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle r="8"/></svg>'), 'image/svg+xml')).toBe('image/svg+xml')
    // 登录页：标着 image/* 也不算
    expect(iconOk(Buffer.from('<!doctype html><title>请登录</title>'), 'image/x-icon')).toBeNull()
    expect(iconOk(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), 'image/png')).toBeNull()
    expect(iconOk(Buffer.alloc(0), 'image/png')).toBeNull()
  })

  it('网页里写的图标：icon、shortcut icon 在前，apple-touch-icon 在后，相对地址补全，mask-icon 不要', () => {
    const html = `<head><link rel="apple-touch-icon" href="/touch.png"><link rel="mask-icon" href="/m.svg"><link href='img/fav.png?v=2&amp;x=1' rel='shortcut icon'><link rel=icon href=/i.svg><link rel="stylesheet" href="/a.css"></head>`
    expect(iconLinks(html, 'https://school.example.edu/portal/index.html')).toEqual([
      'https://school.example.edu/portal/img/fav.png?v=2&x=1',
      'https://school.example.edu/i.svg',
      'https://school.example.edu/touch.png',
    ])
    expect(iconLinks('<p>没有</p>', 'https://a.b/')).toEqual([])
  })

  it('网页报过的图标记进 icons.json，重开（新的实例）还在', () => {
    const f = join(tmp, 'web', 'icons.json')
    const a = new NotedIcons(f)
    expect(a.set('mail.example.com', 'https://mail.example.com/fav.png')).toBe(true)
    expect(a.set('mail.example.com', 'https://mail.example.com/fav.png')).toBe(false)
    expect(new NotedIcons(f).get('mail.example.com')).toBe('https://mail.example.com/fav.png')
  })

  it('Chrome 的图标库：按网址查，查不到按网站查；挑画得出来的一张；没有就 null', async () => {
    const root = join(tmp, 'chrome')
    mkdirSync(join(root, 'Default'), { recursive: true })
    mkdirSync(join(root, 'Profile 1'), { recursive: true })
    const db = new DatabaseSync(join(root, 'Profile 1', 'Favicons'))
    db.exec(`CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url TEXT, icon_id INTEGER);
      CREATE TABLE favicon_bitmaps (id INTEGER PRIMARY KEY, icon_id INTEGER, last_updated INTEGER, image_data BLOB, width INTEGER, height INTEGER);`)
    db.prepare('INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)').run('https://lms.example.edu/course/1', 1)
    db.prepare('INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)').run('https://blank.example.com/', 2)
    db.prepare('INSERT INTO favicon_bitmaps (icon_id, image_data, width, height) VALUES (?, ?, ?, ?)').run(1, solidPng(32, 32, [200, 30, 30]), 32, 32)
    db.prepare('INSERT INTO favicon_bitmaps (icon_id, image_data, width, height) VALUES (?, ?, ?, ?)').run(2, solidPng(1, 1, [0, 0, 0]), 1, 1)
    db.close()
    const c = new ChromeFavicons(() => root)
    expect((await c.lookup('https://lms.example.edu/course/1'))?.type).toBe('image/png')
    // 同一个网站的别的页
    expect((await c.lookup('https://lms.example.edu/grades'))?.type).toBe('image/png')
    // 只有 1×1 的：不算
    expect(await c.lookup('https://blank.example.com/')).toBeNull()
    expect(await c.lookup('https://other.example.org/')).toBeNull()
    expect(await new ChromeFavicons(() => null).lookup('https://lms.example.edu/')).toBeNull()
    await c.dispose()
  })
})
