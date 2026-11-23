/**
 * 软件设置：userData/settings.json。外观、自动提交间隔、梦游，还有上次打开的库、速记提示这些零碎。
 * 首页的设置不在这里，在库里的 .canvas-notes/首页.json（跟着库走）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { type AppSettings, normalizeSettings, type SettingsPatch, type SkinInfo } from '../shared/appearance'
import { patchDream } from '../shared/dream-settings'
import { logDropped } from './crash-log'

export interface StoredSettings extends Partial<AppSettings> {
  lastVault?: string
  /** 速记小窗里要不要提示去开辅助功能权限 */
  quickHint?: boolean
  /** 检查更新上次查到「已是最新」的时间（毫秒） */
  updateCheckedAt?: number
  /** 每天备份一份（设置 › Git和同步）：按库的路径记上次备好的时间、文件、没备成的原因 */
  backups?: Record<string, { at?: number; file?: string; error?: string | null }>
}

export type { SettingsPatch }

export class SettingsFile {
  /** userSkins：导入的 VS Code 主题（设置里选的是删掉了的那套时回到默认） */
  constructor(
    private path: string,
    private userSkins: () => SkinInfo[] = () => [],
  ) {}

  /**
   * 坏了的（读不出 JSON、不是对象，task-pyb39）：以前这里一抛，开库、读设置全失败，界面一直空着（白屏）。
   * 现在原文件改名成 settings.json.broken 留着、记一行日志，按默认设置打开
   */
  read(): StoredSettings {
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw e
    }
    let v: unknown
    try {
      v = JSON.parse(text)
    } catch (e) {
      v = e
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Error)) return v as StoredSettings
    renameSync(this.path, this.path + '.broken')
    logDropped('settings', `settings.json ${v instanceof Error ? `读不出来：${v.message}` : '不是对象'}，原文件改名成 settings.json.broken，按默认设置打开`)
    return {}
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

  /** 改外观、间隔、归档天数或梦游：合并后再检查一遍，返回存下的样子 */
  setApp(p: SettingsPatch): AppSettings {
    const cur = this.app()
    const next = normalizeSettings(
      {
        ...cur,
        ...(p.autoCommitMinutes !== undefined ? { autoCommitMinutes: p.autoCommitMinutes } : {}),
        ...(p.archiveDays !== undefined ? { archiveDays: p.archiveDays } : {}),
        ...(p.autoUpdate !== undefined ? { autoUpdate: p.autoUpdate } : {}),
        ...(p.familyFetch !== undefined ? { familyFetch: p.familyFetch } : {}),
        appearance: { ...cur.appearance, ...(p.appearance ?? {}) },
        dream: p.dream ? patchDream(cur.dream, p.dream) : cur.dream,
        general: { ...cur.general, ...(p.general ?? {}) },
        editor: { ...cur.editor, ...(p.editor ?? {}) },
        files: { ...cur.files, ...(p.files ?? {}) },
        pdf: { ...cur.pdf, ...(p.pdf ?? {}) },
        web: { ...cur.web, ...(p.web ?? {}) },
        sync: { ...cur.sync, ...(p.sync ?? {}) },
        cite: { ...cur.cite, ...(p.cite ?? {}) },
      },
      this.userSkins(),
    )
    this.patch(next)
    return next
  }
}
