import { describe, expect, it } from 'vitest'
import { pageOf, searchSettings, SETTINGS_ITEMS, SETTINGS_PAGES, SETTINGS_SECTIONS } from '../src/shared/settings-index'

describe('设置的分页和搜索（方向 A「分组侧栏」）', () => {
  it('侧栏 5 段 15 页，顺序照原型', () => {
    expect(SETTINGS_SECTIONS).toEqual(['常用', '写和读', 'AI', '库和同步', '其他'])
    expect(SETTINGS_PAGES.map((p) => `${p.sec}/${p.name}`)).toEqual([
      '常用/一般',
      '常用/外观',
      '常用/首页',
      '写和读/文档和白板',
      '写和读/文件和附件',
      '写和读/读PDF',
      '写和读/网页和视频',
      'AI/AI',
      'AI/梦游',
      '库和同步/库',
      '库和同步/Git和同步',
      '库和同步/隐私和联网',
      '其他/插件',
      '其他/快捷键',
      '其他/高级',
    ])
  })

  it('每页一句头，每一项都在某一页、id 不重', () => {
    for (const p of SETTINGS_PAGES) expect(p.desc.length).toBeGreaterThan(3)
    const ids = SETTINGS_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const i of SETTINGS_ITEMS) expect(SETTINGS_PAGES.some((p) => p.id === i.pg)).toBe(true)
    expect(pageOf('autoSync')).toBe('git')
    expect(pageOf('没有这一项')).toBeNull()
  })

  it('「谷歌」找得到「地址栏搜索用」（别的叫法也算），排第一', () => {
    expect(searchSettings('谷歌')[0]?.id).toBe('engine')
    expect(searchSettings('Google')[0]?.id).toBe('engine')
  })

  it('「字号」第一个是文档和白板的字号', () => {
    const r = searchSettings('字号')
    expect(r[0]?.id).toBe('size')
    expect(r[0]?.pg).toBe('editor')
  })

  it('「gitignore」找得到「不进Git的文件」，「备份」找得到「每天备份一份到」', () => {
    expect(searchSettings('gitignore')[0]?.id).toBe('ignore')
    expect(searchSettings('备份')[0]?.id).toBe('backup')
  })

  it('组名、页名也算：「同步」列出 Git和同步 页同步那一组；「隐私」列出隐私和联网那一页的', () => {
    const sync = searchSettings('同步').map((i) => i.id)
    expect(sync).toEqual(expect.arrayContaining(['remote', 'autoSync', 'pullOpen', 'pushQuit']))
    // 名字里有「同步」的排在只是组名叫「同步」的前面
    expect(sync.indexOf('autoSync')).toBeLessThan(sync.indexOf('conflict'))
    expect(searchSettings('隐私').every((i) => i.pg === 'privacy')).toBe(true)
  })

  it('几个词用空格隔开时每个词都要打中；大小写不管；没打中给空', () => {
    expect(searchSettings('pdf 缩放').map((i) => i.id)).toEqual(['pdfZoom'])
    expect(searchSettings('PDF').length).toBeGreaterThan(1)
    expect(searchSettings('xyz')).toEqual([])
    expect(searchSettings('   ')).toEqual([])
  })
})
