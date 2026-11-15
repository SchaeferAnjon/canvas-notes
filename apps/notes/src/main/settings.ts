/**
 * 软件设置：userData/settings.json。外观、自动提交间隔，还有上次打开的库、速记提示这些零碎。
 * 首页的设置不在这里，在库里的 .canvas-notes/首页.json（跟着库走）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { type AppSettings, normalizeSettings } from '../shared/appearance'

export interface StoredSettings extends Partial<AppSettings> {
  lastVault?: string
  /** 速记小窗里要不要提示去开辅助功能权限 */
  quickHint?: boolean
}

export class SettingsFile {
  constructor(private path: string) {}

  read(): StoredSettings {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as StoredSettings
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw e
    }
  }

  write(s: StoredSettings) {
    mkdirSync(dirname(this.path), { recursive: true })
    // 先写临时文件再换名，写到一半退出也不会坏
    writeFileSync(this.path + '.tmp', JSON.stringify(s, null, 2))
    renameSync(this.path + '.tmp', this.path)
  }

  patch(p: Partial<StoredSettings>) {
    this.write({ ...this.read(), ...p })
  }

  app(): AppSettings {
    return normalizeSettings(this.read())
  }

  /** 改外观、间隔或归档天数：合并后再检查一遍，返回存下的样子 */
  setApp(p: { appearance?: Partial<AppSettings['appearance']>; autoCommitMinutes?: number; archiveDays?: number }): AppSettings {
    const cur = this.app()
    const next = normalizeSettings({
      ...cur,
      ...(p.autoCommitMinutes !== undefined ? { autoCommitMinutes: p.autoCommitMinutes } : {}),
      ...(p.archiveDays !== undefined ? { archiveDays: p.archiveDays } : {}),
      appearance: { ...cur.appearance, ...(p.appearance ?? {}) },
    })
    this.patch(next)
    return next
  }
}
