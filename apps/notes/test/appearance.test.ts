import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsFile } from '../src/main/settings'
import { activeSkin, autoCommitLabel, DEFAULT_SETTINGS, normalizeSettings, pickSkin, setFollowSystem, SKINS } from '../src/shared/appearance'

describe('外观设置', () => {
  it('六套配色：三套浅、三套深', () => {
    expect(SKINS.map((s) => s.id).sort()).toEqual(['black', 'cream', 'deepsea', 'fam-dark', 'fam-light', 'white'])
    expect(SKINS.filter((s) => s.tone === 'light').map((s) => s.id)).toEqual(['fam-light', 'white', 'cream'])
  })

  it('空的、坏的设置都回到默认值', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('乱写')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ appearance: { skin: 'pink', homeStyle: 'c', followSystem: 'yes' }, autoCommitMinutes: -3 })).toEqual(DEFAULT_SETTINGS)
  })

  it('白天只能是浅色主题，夜里只能是深色主题', () => {
    const s = normalizeSettings({ appearance: { day: 'black', night: 'cream' } })
    expect(s.appearance.day).toBe('fam-light')
    expect(s.appearance.night).toBe('fam-dark')
  })

  it('自己选的背景文件名不能带路径；没有文件时回到深海光', () => {
    expect(normalizeSettings({ appearance: { winBg: 'custom', winBgFile: '../x.png' } }).appearance).toMatchObject({ winBg: 'glow', winBgFile: null })
    expect(normalizeSettings({ appearance: { winBg: 'custom', winBgFile: 'a.jpg' } }).appearance).toMatchObject({ winBg: 'custom', winBgFile: 'a.jpg' })
  })

  it('跟系统：白天用 day、夜里用 night；不跟系统一直用 skin', () => {
    const a = { ...DEFAULT_SETTINGS.appearance, day: 'cream' as const, night: 'deepsea' as const, skin: 'white' as const }
    expect(activeSkin(a, false)).toBe('cream')
    expect(activeSkin(a, true)).toBe('deepsea')
    expect(activeSkin({ ...a, followSystem: false }, true)).toBe('white')
  })

  it('点主题卡：跟系统时按浅深换白天或夜里那套，不跟系统时直接换', () => {
    const a = DEFAULT_SETTINGS.appearance
    expect(pickSkin(a, 'black')).toMatchObject({ day: 'fam-light', night: 'black' })
    expect(pickSkin(a, 'white')).toMatchObject({ day: 'white', night: 'fam-dark' })
    expect(pickSkin({ ...a, followSystem: false }, 'deepsea')).toMatchObject({ skin: 'deepsea', day: 'fam-light', night: 'fam-dark' })
  })

  it('关掉跟系统时留住现在看到的那套', () => {
    const a = { ...DEFAULT_SETTINGS.appearance, night: 'black' as const }
    expect(setFollowSystem(a, false, true)).toMatchObject({ followSystem: false, skin: 'black' })
    expect(setFollowSystem(a, false, false)).toMatchObject({ followSystem: false, skin: 'fam-light' })
  })

  it('自动提交间隔的说法', () => {
    expect(autoCommitLabel(0)).toBe('不自动提交')
    expect(autoCommitLabel(10)).toBe('每 10 分钟')
    expect(autoCommitLabel(60)).toBe('每 1 小时')
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
    expect(disk).toMatchObject({ lastVault: '/x/库', quickHint: false, autoCommitMinutes: 30, appearance: { homeStyle: 'b', day: 'fam-light' } })
    expect(f.setApp({ appearance: { skin: 'nope' as never } }).appearance.skin).toBe('fam-light')
  })

  it('没有设置文件时是默认值', () => {
    dir = mkdtempSync(join(tmpdir(), 'cn-settings-'))
    expect(new SettingsFile(join(dir, 'settings.json')).app()).toEqual(DEFAULT_SETTINGS)
  })
})
