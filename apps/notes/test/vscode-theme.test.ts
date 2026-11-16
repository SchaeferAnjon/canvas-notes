import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readZip, ThemeStore, themesFromFile } from '../src/main/themes'
import { normalizeSettings } from '../src/shared/appearance'
import { contrast, convertTheme, loadThemeChain, parseColor, parseJsonc, themeCss, themeId, themeInfo } from '../src/shared/vscode-theme'

const FIX = join(__dirname, 'fixtures/vscode-themes')
const load = (p: string) => readFileSync(join(FIX, p), 'utf8')
const fromFixture = (file: string) => convertTheme(loadThemeChain(file, load), { source: file })
const c = (v: string) => parseColor(v)!

describe('jsonc', () => {
  it('去掉注释和尾逗号，字符串里的 // 不动', () => {
    expect(parseJsonc('{\n // 注释\n "a": "vscode://x", /* 块 */ "b": [1, 2,],\n}')).toEqual({ a: 'vscode://x', b: [1, 2] })
    expect(parseJsonc('{"s": "引号\\"里 // 不是注释"}')).toEqual({ s: '引号"里 // 不是注释' })
  })
})

describe('颜色', () => {
  it('认 #rgb #rgba #rrggbb #rrggbbaa，别的不认', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('#00000080')![3]).toBeCloseTo(0.5, 2)
    expect(parseColor('red')).toBeNull()
    expect(parseColor(3)).toBeNull()
  })
})

describe('导入 VS Code 主题（spec 6.1）', () => {
  it('Dark+：顺着 include 合并；深色；没写的键按表往后找', () => {
    const t = fromFixture('dark_plus.json')
    expect(t.name).toBe('Dark+')
    expect(t.id).toBe('vsc-dark')
    expect(t.tone).toBe('dark')
    expect(t.vars.win).toBe('#1e1e1e')
    // 这一版 Dark+ 没写侧栏和底栏：侧栏是编辑区往字色混 4%（调浅），图标栏、标题栏、底栏跟着侧栏
    expect(t.vars.side).toBe('#252525')
    expect(t.vars.status).toBe(t.vars.side)
    // 强调色按 focusBorder → activityBarBadge.background 找到 VS Code 的蓝
    expect(t.vars.acc).toBe('#007acc')
    // 选中行是一块深蓝，字是浅的：看得清就用它
    expect(contrast(c(t.vars.t1!), c(t.vars.win!))).toBeGreaterThanOrEqual(7)
    // 标题、字符串这些语法色进了 --md-*
    expect(t.vars['md-heading']).toBe('#569cd6')
  })

  it('Light+：浅色；选中行是一大块蓝底白字，正文放上去看不清，换成正文色淡淡一层', () => {
    const t = fromFixture('light_plus.json')
    expect(t.tone).toBe('light')
    expect(t.vars.win).toBe('#ffffff')
    expect(t.vars.fill2).toMatch(/^rgba\(/)
    expect(contrast(c(t.vars.t1!), c(t.vars.win!))).toBeGreaterThanOrEqual(7)
    expect(contrast(c(t.vars.t2!), c(t.vars.win!))).toBeGreaterThanOrEqual(4.5)
    // 底栏的字在底栏上看得清
    expect(contrast(c(t.vars['status-t']!), c(t.vars.status!))).toBeGreaterThanOrEqual(4.5)
  })

  it('Monokai：文件里没写名字，用文件名「Monokai」；编辑区 #272822，侧栏 #1e1f1c，线用 panel.border', () => {
    const t = fromFixture('monokai-color-theme.json')
    expect(t.name).toBe('Monokai')
    expect(t.tone).toBe('dark')
    expect(t.vars.win).toBe('#272822')
    expect(t.vars.side).toBe('#1e1f1c')
    expect(t.vars.line).toBe('rgba(65, 67, 57, 1)')
    expect(t.vars.seam).toBe(t.vars.line)
  })

  it('panel.border 是一道亮色（Dracula 的紫）：细线不用它，换成正文色淡淡一条', () => {
    const t = convertTheme({ type: 'dark', colors: { 'editor.background': '#282a36', 'panel.border': '#bd93f9', 'sideBar.border': '#191a21' } }, { source: 'd.json' })
    expect(t.vars.line).toMatch(/^rgba\(/)
    expect(t.vars.line).not.toContain('189, 147, 249')
    expect(t.vars.seam).toBe('rgba(25, 26, 33, 1)')
  })

  it('Solarized Dark：没写 type 也按底色判成深色；半透明的 focusBorder 叠到底上当强调色', () => {
    const t = fromFixture('solarized-dark-color-theme.json')
    expect(t.tone).toBe('dark')
    expect(t.vars.win).toBe('#002b36')
    const acc = c(t.vars.acc!)
    expect(contrast(acc, c(t.vars.win!))).toBeGreaterThan(2.2)
    expect(t.vars.acc).not.toBe('#2aa198')
  })

  it('什么颜色都没写：浅色给 VS Code 的默认底，全部变量都有值', () => {
    const t = convertTheme({ type: 'light' }, { source: 'empty.json' })
    expect(t.name).toBe('Empty')
    expect(t.vars.win).toBe('#ffffff')
    for (const k of ['title', 'bar', 'side', 'tabbar', 'tab-on', 'status', 'status-t', 't1', 't2', 't3', 'line', 'line2', 'fill', 'fill2', 'pop', 'card', 'acc', 'acc-bg', 'acc-on', 'green', 'yellow', 'red', 'board', 'dotc', 'clip', 'glass', 'shadow', 'shadow-up']) {
      expect(t.vars[k], k).toBeTruthy()
    }
    expect(t.tab).toBe('fill')
  })

  it('当前标签：有 tab.activeBorderTop 用上沿，有 tab.activeBorder 用下沿；边线写成透明（Dispatch 那种）就不画分区线', () => {
    expect(convertTheme({ colors: { 'tab.activeBorderTop': '#ff0000' } }, { source: 'a.json' }).tab).toBe('top')
    expect(convertTheme({ colors: { 'tab.activeBorder': '#ff0000' } }, { source: 'a.json' }).tab).toBe('bottom')
    const t = convertTheme({ type: 'dark', colors: { 'editor.background': '#0c0a09', 'panel.border': '#00000000' } }, { source: 'd.json' })
    expect(t.vars.seam).toBe('transparent')
    expect(t.vars.line).toMatch(/^rgba\(/)
  })

  it('按钮是白底黑字（Dispatch Dark）：强调底上的字跟着按钮的字色', () => {
    const t = convertTheme({ type: 'dark', colors: { 'editor.background': '#0c0a09', 'button.background': '#fafaf9', 'button.foreground': '#252525' } }, { source: 'd.json' })
    expect(t.vars['acc-bg']).toBe('#fafaf9')
    expect(t.vars['acc-on']).toBe('#252525')
  })

  it('include 互相引用时报错，不死循环', () => {
    const files: Record<string, string> = { 'a.json': '{"include":"./b.json"}', 'b.json': '{"include":"./a.json"}' }
    expect(() => loadThemeChain('a.json', (p) => files[p]!)).toThrow(/互相 include/)
  })

  it('id：名字转成 vsc-字母数字，中文名用一段散列', () => {
    expect(themeId('One Dark Pro')).toBe('vsc-one-dark-pro')
    expect(themeId('樱花')).toMatch(/^vsc-[a-z0-9]+$/)
  })

  it('样式挂在 [data-skin] 上，带 color-scheme', () => {
    const t = fromFixture('monokai-color-theme.json')
    const css = themeCss(t)
    expect(css).toContain(`[data-skin='${t.id}'] {`)
    expect(css).toContain('color-scheme: dark;')
    expect(css).toContain('--win: #272822;')
  })
})

/** 造一个最小的 zip（deflate），测 vsix */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let off = 0
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text))
    const nm = Buffer.from(name)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(text.length, 22)
    lh.writeUInt16LE(nm.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(text.length, 24)
    ch.writeUInt16LE(nm.length, 28)
    ch.writeUInt32LE(off, 42)
    locals.push(lh, nm, data)
    centrals.push(ch, nm)
    off += 30 + nm.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}

describe('导入的文件和设置目录', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('vsix：读 package.json 里的 contributes.themes，一个扩展里的几套都导进来，名字用 label、浅深看 uiTheme', () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-theme-'))
    const vsix = join(dir, 'pair.vsix')
    writeFileSync(
      vsix,
      zip({
        'extension/package.json': JSON.stringify({ contributes: { themes: [{ label: 'Pair Dark', uiTheme: 'vs-dark', path: './themes/dark.json' }, { label: 'Pair Light', uiTheme: 'vs', path: './themes/light.json' }] } }),
        'extension/themes/base.json': '{ "colors": { "sideBar.background": "#123456" } }',
        'extension/themes/dark.json': '{ "include": "./base.json", "colors": { "editor.background": "#101010" } }',
        'extension/themes/light.json': '{ "colors": { "editor.background": "#fafafa" } }',
      }),
    )
    expect([...readZip(readFileSync(vsix)).keys()]).toContain('extension/package.json')
    const [d, l] = themesFromFile(vsix)
    expect(d).toMatchObject({ name: 'Pair Dark', tone: 'dark', id: 'vsc-pair-dark', source: 'pair.vsix' })
    expect(d!.vars.side).toBe('#123456')
    expect(l).toMatchObject({ name: 'Pair Light', tone: 'light' })
  })

  it('导入存进 themes/，再导一次同名的是替换；删掉后设置里选的那套回到默认', () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-theme-'))
    const store = new ThemeStore(join(dir, 'themes'))
    expect(store.list()).toEqual([])
    const src = join(dir, 'mono.json')
    writeFileSync(src, load('monokai-color-theme.json'))
    const [t] = store.import(src)
    store.import(src)
    expect(store.list().map((x) => x.id)).toEqual([t!.id])
    const user = store.list().map(themeInfo)
    expect(normalizeSettings({ appearance: { night: t!.id } }, user).appearance.night).toBe(t!.id)
    // 深色主题不能当白天那套
    expect(normalizeSettings({ appearance: { day: t!.id } }, user).appearance.day).toBe('mint')
    store.remove(t!.id)
    expect(store.list()).toEqual([])
    expect(normalizeSettings({ appearance: { night: t!.id } }, []).appearance.night).toBe('pine')
    expect(() => store.remove('../settings')).toThrow()
  })

  it('不是主题文件就报错', () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-theme-'))
    const src = join(dir, 'x.json')
    writeFileSync(src, '[1, 2]')
    expect(() => themesFromFile(src)).toThrow(/不是 VS Code 主题文件/)
  })
})
