import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsFile } from '../src/main/settings'
import { GLASS_DEFAULT, GLASS_MAX, GLASS_MIN } from '@cn/design/glass'
import { activeSkin, autoCommitLabel, DEFAULT_SETTINGS, normalizeSettings, panelsGlass, pickSkin, setFollowSystem, skinOf, SKINS } from '../src/shared/appearance'

describe('外观设置', () => {
  it('十套主题：五浅五深，没有家族灰、纯白纯黑、米白、深海蓝', () => {
    expect(SKINS.map((s) => s.id)).toEqual(['mint', 'sky', 'sakura', 'lilac', 'stone', 'pine', 'petrol', 'cocoa', 'ink', 'graphite'])
    expect(SKINS.filter((s) => s.tone === 'light').map((s) => s.id)).toEqual(['mint', 'sky', 'sakura', 'lilac', 'stone'])
  })

  it('每套结构也不一样：当前标签的四种标记都用上了', () => {
    expect(new Set(SKINS.map((s) => s.tab))).toEqual(new Set(['top', 'bottom', 'fill', 'none']))
  })

  it('旧主题换成最近的新主题：纯白、纯黑 → 石白、石墨（Dispatch 的白和黑），米白 → 樱花，深海蓝 → 深湖', () => {
    expect(normalizeSettings({ appearance: { day: 'white', night: 'black', skin: 'cream' } }).appearance).toMatchObject({ day: 'stone', night: 'graphite', skin: 'sakura' })
    expect(normalizeSettings({ appearance: { night: 'deepsea', skin: 'deepsea' } }).appearance).toMatchObject({ night: 'petrol', skin: 'petrol' })
    // 旧版的深海光渐变换成默认的极光照片
    expect(normalizeSettings({ appearance: { winBg: 'glow' } }).appearance.winBg).toBe('aurora')
    expect(normalizeSettings({ appearance: { winBg: 'none' } }).appearance.winBg).toBe('none')
  })

  it('空的、坏的设置都回到默认值', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('乱写')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ appearance: { skin: 'pink', homeStyle: 'c', followSystem: 'yes' }, autoCommitMinutes: -3 })).toEqual(DEFAULT_SETTINGS)
  })

  it('界面风格：默认 B 浮岛书桌，只认 a、b', () => {
    expect(DEFAULT_SETTINGS.appearance.frame).toBe('b')
    expect(normalizeSettings({ appearance: { frame: 'a' } }).appearance.frame).toBe('a')
    expect(normalizeSettings({ appearance: { frame: 'c' } }).appearance.frame).toBe('b')
    expect(normalizeSettings({ appearance: {} }).appearance.frame).toBe('b')
  })

  it('默认白天薄荷、夜里松林；旧的家族灰换成薄荷 / 松林', () => {
    expect(DEFAULT_SETTINGS.appearance).toMatchObject({ day: 'mint', night: 'pine', skin: 'mint' })
    expect(normalizeSettings({ appearance: { day: 'fam-light', night: 'fam-dark', skin: 'fam-dark' } }).appearance).toMatchObject({ day: 'mint', night: 'pine', skin: 'pine' })
  })

  it('白天只能是浅色主题，夜里只能是深色主题', () => {
    const s = normalizeSettings({ appearance: { day: 'ink', night: 'sky' } })
    expect(s.appearance.day).toBe('mint')
    expect(s.appearance.night).toBe('pine')
  })

  it('自己选的背景文件名不能带路径；没有文件时回到极光照片', () => {
    expect(normalizeSettings({ appearance: { winBg: 'custom', winBgFile: '../x.png' } }).appearance).toMatchObject({ winBg: 'aurora', winBgFile: null })
    expect(normalizeSettings({ appearance: { winBg: 'custom', winBgFile: 'a.jpg' } }).appearance).toMatchObject({ winBg: 'custom', winBgFile: 'a.jpg' })
  })

  it('面板透明度（task-jgely）：0 实、100 透、默认 50（用户认可的那版），读进来取整、收到两头，乱写回到默认', () => {
    expect(DEFAULT_SETTINGS.appearance.glassLevel).toBe(GLASS_DEFAULT)
    expect([GLASS_MIN, GLASS_DEFAULT, GLASS_MAX]).toEqual([0, 50, 100])
    const g = (v: unknown) => normalizeSettings({ appearance: { glassLevel: v } }).appearance.glassLevel
    expect(g(5)).toBe(5)
    expect(g(4.6)).toBe(5)
    expect(g(130)).toBe(GLASS_MAX)
    expect(g(-100)).toBe(GLASS_MIN)
    expect(g('8')).toBe(50)
    expect(g(Number.NaN)).toBe(50)
    expect(g(undefined)).toBe(50)
  })

  it('面板透明度：2026-11-24 前存的老键 glass（在默认上再透几个百分点，-16…12）照浅色主题同样的不透明度换成新数；新键在就不看老键', () => {
    const g = (a: Record<string, unknown>) => normalizeSettings({ appearance: a }).appearance
    expect(g({ glass: 0 }).glassLevel).toBe(50)
    expect(g({ glass: 12 }).glassLevel).toBe(88)
    expect(g({ glass: -16 }).glassLevel).toBe(10)
    expect(g({ glass: 8 }).glassLevel).toBe(75)
    expect(g({ glass: 40 }).glassLevel).toBe(88)
    expect(g({ glass: 'x' }).glassLevel).toBe(50)
    expect(g({ glass: 12, glassLevel: 20 }).glassLevel).toBe(20)
    expect(g({ glass: 12 })).not.toHaveProperty('glass')
  })

  it('面板这会儿透不透（设置里滑杆能不能拉）：B 浮岛书桌 + 有窗口背景才透', () => {
    expect(panelsGlass({ frame: 'b', winBg: 'aurora' })).toBe(true)
    expect(panelsGlass({ frame: 'b', winBg: 'custom' })).toBe(true)
    expect(panelsGlass({ frame: 'b', winBg: 'none' })).toBe(false)
    expect(panelsGlass({ frame: 'a', winBg: 'aurora' })).toBe(false)
  })

  it('跟系统：白天用 day、夜里用 night；不跟系统一直用 skin', () => {
    const a = { ...DEFAULT_SETTINGS.appearance, day: 'sakura', night: 'petrol', skin: 'stone' }
    expect(activeSkin(a, false)).toBe('sakura')
    expect(activeSkin(a, true)).toBe('petrol')
    expect(activeSkin({ ...a, followSystem: false }, true)).toBe('stone')
  })

  it('点主题卡：跟系统时按浅深换白天或夜里那套，不跟系统时直接换', () => {
    const a = DEFAULT_SETTINGS.appearance
    expect(pickSkin(a, skinOf('graphite'))).toMatchObject({ day: 'mint', night: 'graphite' })
    expect(pickSkin(a, skinOf('sky'))).toMatchObject({ day: 'sky', night: 'pine' })
    expect(pickSkin({ ...a, followSystem: false }, skinOf('cocoa'))).toMatchObject({ skin: 'cocoa', day: 'mint', night: 'pine' })
  })

  it('关掉跟系统时留住现在看到的那套', () => {
    const a = { ...DEFAULT_SETTINGS.appearance, night: 'ink' }
    expect(setFollowSystem(a, false, true)).toMatchObject({ followSystem: false, skin: 'ink' })
    expect(setFollowSystem(a, false, false)).toMatchObject({ followSystem: false, skin: 'mint' })
  })

  it('窗口背景五样：主题渐变、纯色、两张照片、自己选的；浓淡、动不动、快慢有默认值，乱写的回到默认', () => {
    expect(normalizeSettings({ appearance: { winBg: 'wall', wallMix: 'mid' } }).appearance.winBg).toBe('wall')
    expect(normalizeSettings({ appearance: { winBg: 'none', wallMix: 'mid' } }).appearance.winBg).toBe('none')
    expect(DEFAULT_SETTINGS.appearance).toMatchObject({ wallMix: 'mid', wallMove: true, wallSpeed: 'slow' })
    expect(normalizeSettings({ appearance: { wallMix: 'rich', wallMove: true, wallSpeed: 'fast' } }).appearance).toMatchObject({ wallMix: 'rich', wallMove: true, wallSpeed: 'fast' })
    expect(normalizeSettings({ appearance: { wallMix: '很浓', wallMove: 'yes', wallSpeed: 9 } }).appearance).toMatchObject({ wallMix: 'mid', wallMove: true, wallSpeed: 'slow' })
  })

  it('有主题渐变以前的设置：A 一律当纯色（A 以前不铺背景，打开还是原来的样子）；B 照旧；存过一次（有 wallMix）以后 A 也能配背景', () => {
    expect(normalizeSettings({ appearance: { frame: 'a', winBg: 'aurora' } }).appearance.winBg).toBe('none')
    expect(normalizeSettings({ appearance: { frame: 'a' } }).appearance.winBg).toBe('none')
    expect(normalizeSettings({ appearance: { frame: 'b', winBg: 'cave' } }).appearance.winBg).toBe('cave')
    expect(normalizeSettings({ appearance: { frame: 'b', winBg: 'none' } }).appearance.winBg).toBe('none')
    expect(normalizeSettings({ appearance: { frame: 'a', winBg: 'aurora', wallMix: 'soft' } }).appearance.winBg).toBe('aurora')
    expect(normalizeSettings({ appearance: { frame: 'a', winBg: 'wall', wallMix: 'mid' } }).appearance.winBg).toBe('wall')
  })

  it('自动提交间隔的说法', () => {
    expect(autoCommitLabel(0)).toBe('不自动提交')
    expect(autoCommitLabel(10)).toBe('每10分钟')
    expect(autoCommitLabel(60)).toBe('每1小时')
  })
})

describe('设置文件', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('改外观只动外观，上次的库和别的零碎留着', () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-settings-'))
    const path = join(dir, 'settings.json')
    writeFileSync(path, JSON.stringify({ lastVault: '/x/库', quickHint: false }))
    const f = new SettingsFile(path)
    const s = f.setApp({ appearance: { homeStyle: 'b' }, autoCommitMinutes: 30 })
    expect(s.appearance.homeStyle).toBe('b')
    expect(s.autoCommitMinutes).toBe(30)
    const disk = JSON.parse(readFileSync(path, 'utf8'))
    expect(disk).toMatchObject({ lastVault: '/x/库', quickHint: false, autoCommitMinutes: 30, appearance: { homeStyle: 'b', day: 'mint' } })
    expect(f.setApp({ appearance: { skin: 'nope' as never } }).appearance.skin).toBe('mint')
  })

  it('以前设置文件里留着的旧字段（mineruPath、mineruHint）读到时不管它，照常读出设置、照常改', () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-settings-'))
    const path = join(dir, 'settings.json')
    writeFileSync(path, JSON.stringify({ lastVault: '/x/库', mineruPath: '/Users/x/.mineru-venv/bin/mineru-kit', mineruHint: false, autoCommitMinutes: 15 }))
    const f = new SettingsFile(path)
    expect(f.app().autoCommitMinutes).toBe(15)
    expect(f.read().lastVault).toBe('/x/库')
    expect(f.setApp({ autoCommitMinutes: 30 }).autoCommitMinutes).toBe(30)
  })

  it('没有设置文件时是默认值', () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-settings-'))
    expect(new SettingsFile(join(dir, 'settings.json')).app()).toEqual(DEFAULT_SETTINGS)
  })

  it('首页整页背景用窗口背景那张图（CN-52）：默认不用，只认 true，存在这台电脑的设置里', () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-settings-'))
    const f = new SettingsFile(join(dir, 'settings.json'))
    expect(f.app().appearance.homeWinBg).toBe(false)
    expect(f.setApp({ appearance: { homeStyle: 'b', homeWinBg: true } }).appearance).toMatchObject({ homeStyle: 'b', homeWinBg: true })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).appearance.homeWinBg).toBe(true)
    expect(f.setApp({ appearance: { homeWinBg: 'yes' as never } }).appearance.homeWinBg).toBe(false)
  })
})
