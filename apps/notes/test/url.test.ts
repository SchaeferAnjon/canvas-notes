import { describe, expect, it } from 'vitest'
import { isSearchUrl, looksLikeUrl, toUrl } from '../src/renderer/url'

describe('地址栏和 ⌘K 里打的字 → 网址', () => {
  it('像网址就补 https，不像就去搜；搜出来的认得出是搜索', () => {
    expect(toUrl('weread.qq.com/web/shelf')).toBe('https://weread.qq.com/web/shelf')
    expect(isSearchUrl(toUrl('weread.qq.com'))).toBe(false)
    expect(toUrl('小布什')).toBe('https://www.google.com/search?q=%E5%B0%8F%E5%B8%83%E4%BB%80')
    expect(isSearchUrl(toUrl('小布什'))).toBe(true)
    expect(isSearchUrl(toUrl('localhost:5173'))).toBe(false)
  })

  it('纯数字带点的（3.14、2.0、版本号）不是网址：拿去搜，不当 IP 去连（第 5 轮：3.14 去连了 3.0.0.14）', () => {
    for (const s of ['3.14', '3.1415926', '1.5', '2.0', '10.0.19041.1', '192.168.1.1']) {
      expect(looksLikeUrl(s), s).toBe(false)
      // 192.168.1.1 是局域网地址：⌘K 里不当网址（回车开正文里有它的笔记），地址栏里直接开（见下一条）
      if (s !== '192.168.1.1') expect(isSearchUrl(toUrl(s)), s).toBe(true)
    }
    for (const s of ['example.com', 'github.com/foo', 'readme.md', 'Node.js', 'v0.4.0.app', '192.168.1.1:8080', '192.168.1.1/admin', 'localhost:5173', 'http://3.14']) expect(looksLikeUrl(s), s).toBe(true)
    expect(toUrl('3.14')).toBe('https://www.google.com/search?q=3.14')
  })

  it('局域网、本机地址（路由器、NAS）直接用 http 打开，不拿去 Google 搜（用户定：隐私）', () => {
    for (const [s, u] of [
      ['192.168.1.1', 'http://192.168.1.1'],
      ['192.168.1.1/admin', 'http://192.168.1.1/admin'],
      ['192.168.1.1:8080', 'http://192.168.1.1:8080'],
      ['10.0.0.5:5000', 'http://10.0.0.5:5000'],
      ['10.1.2.3', 'http://10.1.2.3'],
      ['172.16.0.1', 'http://172.16.0.1'],
      ['172.31.255.254/x', 'http://172.31.255.254/x'],
      ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
      ['localhost', 'http://localhost'],
      ['localhost:5173/a', 'http://localhost:5173/a'],
      ['nas.local', 'http://nas.local'],
      ['NAS.local:5000/photo', 'http://NAS.local:5000/photo'],
    ] as const)
      expect(toUrl(s), s).toBe(u)
    // 不是局域网的照旧：公网 IP 不带端口路径的仍拿去搜（3.14 这种），172.32 不在私有段
    expect(isSearchUrl(toUrl('8.8.8.8')), '8.8.8.8').toBe(true)
    expect(toUrl('172.32.0.1:80')).toBe('https://172.32.0.1:80')
    expect(toUrl('example.local.com')).toBe('https://example.local.com')
    expect(isSearchUrl(toUrl('3.14'))).toBe(true)
  })
})
