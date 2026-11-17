/**
 * 软件设置：userData/settings.json。外观、自动提交间隔，还有上次打开的库、速记提示这些零碎。
 * 首页的设置不在这里，在库里的 .canvas-notes/首页.json（跟着库走）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { type AppSettings, normalizeSettings, type SkinInfo } from '../shared/appearance'

export interface StoredSettings extends Partial<AppSettings> {
  lastVault?: string
  /** 速记小窗里要不要提示去开辅助功能权限 */
  quickHint?: boolean
  /** 检查更新上次查到「已是最新」的时间（毫秒） */
  updateCheckedAt?: number
  /** PDF 精读增强：设置里填的 mineru-kit 路径（找 MinerU 时排第一） */
  mineruPath?: string
  /** PDF 精读增强：点过「不再提示」是 false */
  mineruHint?: boolean
}

export class SettingsFile {
  /** userSkins：导入的 VS Code 主题（设置里选的是删掉了的那套时回到默认） */
  constructor(
    private path: string,
    private userSkins: () => SkinInfo[] = () => [],
  ) {}

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
    return normalizeSettings(this.read(), this.userSkins())
  }

  /** 改外观、间隔或归档天数：合并后再检查一遍，返回存下的样子 */
  setApp(p: { appearance?: Partial<AppSettings['appearance']>; autoCommitMinutes?: number; archiveDays?: number; autoUpdate?: boolean }): AppSettings {
    const cur = this.app()
    const next = normalizeSettings(
      {
        ...cur,
        ...(p.autoCommitMinutes !== undefined ? { autoCommitMinutes: p.autoCommitMinutes } : {}),
        ...(p.archiveDays !== undefined ? { archiveDays: p.archiveDays } : {}),
        ...(p.autoUpdate !== undefined ? { autoUpdate: p.autoUpdate } : {}),
        appearance: { ...cur.appearance, ...(p.appearance ?? {}) },
      },
      this.userSkins(),
    )
    this.patch(next)
    return next
  }
}
