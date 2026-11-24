import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsFile } from '../src/main/settings'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/appearance'
import { autoSyncLabel, DEFAULT_EDITOR, DEFAULT_GENERAL, DEFAULT_SYNC, normalizeEditor, normalizeGeneral, normalizeSync } from '../src/shared/prefs'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('设置里新放进来的几组', () => {
  it('默认值照盘点表：回到上次的样子、菜单栏图标开着，速记 ⌥⌘N；字号 15、行距标准、版心窄、先用文档；只在我点时同步', () => {
    expect(DEFAULT_SETTINGS.general).toEqual({ reopen: true, tray: true, quickKey: '⌥⌘N', quickSrc: true })
    expect(DEFAULT_SETTINGS.editor).toMatchObject({ font: 'system', size: 15, lineHeight: 'normal', width: 'narrow', newView: 'doc', spell: false, boardShrink: true, boardDots: true, semantic: true })
    expect(DEFAULT_SETTINGS.files).toEqual({ newWhere: 'picked', delAsk: 'images', showTodo: false, noteViews: {} })
    expect(DEFAULT_SETTINGS.pdf).toEqual({ zoom: 'width', openAi: false, ankiSides: true })
    expect(DEFAULT_SETTINGS.web).toEqual({ engine: 'google', newTab: 'bookmarks', downloads: 'downloads', keepRecent: true })
    expect(DEFAULT_SETTINGS.sync).toEqual({ autoMinutes: 0, pullOnOpen: false, pushOnQuit: false, backup: 'off', backupDir: null })
  })

  it('坏值一项一项回到默认，好的留着', () => {
    expect(normalizeEditor({ size: 40, font: 'comic', lineHeight: 'loose', spell: 'yes' })).toEqual({ ...DEFAULT_EDITOR, lineHeight: 'loose' })
    expect(normalizeGeneral({ quickKey: 'N', tray: false })).toEqual({ ...DEFAULT_GENERAL, tray: false })
    // 全局键要带 ⌘ 或 ⌃
    expect(normalizeGeneral({ quickKey: '⌥N' }).quickKey).toBe('⌥⌘N')
    expect(normalizeGeneral({ quickKey: '⌃⌥Space' }).quickKey).toBe('⌃⌥Space')
    expect(normalizeSync({ autoMinutes: 7 }).autoMinutes).toBe(0)
    // 选了「选文件夹」却没有文件夹：当没开；文件夹只认绝对路径
    expect(normalizeSync({ backup: 'folder' })).toEqual(DEFAULT_SYNC)
    expect(normalizeSync({ backup: 'folder', backupDir: 'rel/x' })).toEqual(DEFAULT_SYNC)
    expect(normalizeSync({ backup: 'folder', backupDir: '/Volumes/外接盘/备份' })).toMatchObject({ backup: 'folder', backupDir: '/Volumes/外接盘/备份' })
    expect(normalizeSettings({ editor: 'x', web: { engine: 'baidu' } })).toMatchObject({ editor: DEFAULT_EDITOR, web: { engine: 'baidu', newTab: 'bookmarks', downloads: 'downloads' } })
  })

  it('改一项只动那一项，存进 settings.json，重开还在', () => {
    const d = mkdtempSync(join(tmpdir(), 'cn-prefs-'))
    dirs.push(d)
    const f = new SettingsFile(join(d, 'settings.json'))
    f.setApp({ editor: { size: 18 }, sync: { autoMinutes: 30 } })
    const next = f.setApp({ editor: { lineHeight: 'tight' } })
    expect(next.editor).toMatchObject({ size: 18, lineHeight: 'tight', font: 'system' })
    expect(next.sync.autoMinutes).toBe(30)
    const disk = JSON.parse(readFileSync(join(d, 'settings.json'), 'utf8'))
    expect(disk.editor.size).toBe(18)
    expect(new SettingsFile(join(d, 'settings.json')).app().editor.lineHeight).toBe('tight')
  })

  it('自动同步的说法', () => {
    expect([0, 30, 60, 1440].map(autoSyncLabel)).toEqual(['只在我点时', '每30分钟', '每小时', '每天一次'])
  })
})
