import { type ArchiveDays, DEFAULT_ARCHIVE_DAYS, isArchiveDays } from './sidebar'

/**
 * 外观和软件设置（存在软件设置目录 userData/settings.json，首页的设置除外）。
 * 六套配色，按 design/v3/DESIGN.v3.md「4 主题」；这里只放纯函数，主进程和界面都用。
 */

export type SkinId = 'fam-light' | 'fam-dark' | 'white' | 'cream' | 'black' | 'deepsea'
export type Tone = 'light' | 'dark'
export type HomeStyle = 'a' | 'b'
/** 深海蓝的窗口背景：深海光渐变、两张照片、自己选的图 */
export type WinBg = 'glow' | 'aurora' | 'cave' | 'custom'

export interface SkinInfo {
  id: SkinId
  name: string
  tone: Tone
  /** 外观页卡片下面的一句话 */
  note: string
}

export const SKINS: SkinInfo[] = [
  { id: 'fam-light', name: '家族灰', tone: 'light', note: '两级冷灰，白卡轻阴影' },
  { id: 'white', name: '纯白', tone: 'light', note: '没有灰底，只靠细线分区' },
  { id: 'cream', name: '米白', tone: 'light', note: '暖纸色，文档是一张纸' },
  { id: 'fam-dark', name: '家族灰', tone: 'dark', note: '深灰两级，和浅色一套结构' },
  { id: 'black', name: '纯黑', tone: 'dark', note: '全黑底，没有投影只有细线' },
  { id: 'deepsea', name: '深海蓝', tone: 'dark', note: '渐变光加半透明玻璃面板' },
]

export const skinOf = (id: SkinId): SkinInfo => SKINS.find((s) => s.id === id)!
const isSkin = (v: unknown): v is SkinId => SKINS.some((s) => s.id === v)

export interface Appearance {
  /** 跟着系统换浅深：白天用 day，夜里用 night */
  followSystem: boolean
  day: SkinId
  night: SkinId
  /** 不跟系统时一直用这套 */
  skin: SkinId
  homeStyle: HomeStyle
  winBg: WinBg
  /** 自己选的窗口背景：拷进设置目录 backgrounds/ 后的文件名 */
  winBgFile: string | null
}

export interface AppSettings {
  appearance: Appearance
  /** 没提交的改动多久自动提交一次（分钟），0 = 不自动提交 */
  autoCommitMinutes: number
  /** 多少天没改过的笔记算归档（左栏不显示），0 = 不自动归档 */
  archiveDays: ArchiveDays
}

export const AUTO_COMMIT_CHOICES = [0, 5, 10, 30, 60] as const

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    followSystem: true,
    day: 'fam-light',
    night: 'fam-dark',
    skin: 'fam-light',
    homeStyle: 'a',
    winBg: 'glow',
    winBgFile: null,
  },
  autoCommitMinutes: 10,
  archiveDays: DEFAULT_ARCHIVE_DAYS,
}

/** 读出来的设置可能是旧版本或者被手改坏的：一项一项检查，不对的用默认值 */
export function normalizeSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const a = (r.appearance && typeof r.appearance === 'object' ? r.appearance : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS.appearance
  const day = isSkin(a.day) && skinOf(a.day).tone === 'light' ? a.day : d.day
  const night = isSkin(a.night) && skinOf(a.night).tone === 'dark' ? a.night : d.night
  const winBg = a.winBg === 'glow' || a.winBg === 'aurora' || a.winBg === 'cave' || a.winBg === 'custom' ? a.winBg : d.winBg
  const winBgFile = typeof a.winBgFile === 'string' && /^[^/\\]+$/.test(a.winBgFile) ? a.winBgFile : null
  const mins = Number(r.autoCommitMinutes)
  return {
    appearance: {
      followSystem: typeof a.followSystem === 'boolean' ? a.followSystem : d.followSystem,
      day,
      night,
      skin: isSkin(a.skin) ? a.skin : d.skin,
      homeStyle: a.homeStyle === 'b' ? 'b' : 'a',
      // 自己选的图没了就回到深海光
      winBg: winBg === 'custom' && !winBgFile ? 'glow' : winBg,
      winBgFile,
    },
    autoCommitMinutes: Number.isFinite(mins) && mins >= 0 && mins <= 24 * 60 ? Math.round(mins) : DEFAULT_SETTINGS.autoCommitMinutes,
    archiveDays: isArchiveDays(r.archiveDays) ? r.archiveDays : DEFAULT_SETTINGS.archiveDays,
  }
}

/** 现在该用哪套：跟系统时看系统是不是深色 */
export function activeSkin(a: Appearance, systemDark: boolean): SkinId {
  if (!a.followSystem) return a.skin
  return systemDark ? a.night : a.day
}

/**
 * 外观页点一张主题卡：跟系统时，浅色卡换掉白天那套、深色卡换掉夜里那套；
 * 不跟系统时直接用这套。
 */
export function pickSkin(a: Appearance, id: SkinId): Appearance {
  if (!a.followSystem) return { ...a, skin: id }
  return skinOf(id).tone === 'light' ? { ...a, day: id } : { ...a, night: id }
}

/** 关掉「跟着系统」时，留住现在看到的那套，界面不跳 */
export function setFollowSystem(a: Appearance, on: boolean, systemDark: boolean): Appearance {
  if (on === a.followSystem) return a
  if (on) return { ...a, followSystem: true }
  return { ...a, followSystem: false, skin: activeSkin(a, systemDark) }
}

/** 窗口刚建时的底色（和主题的 --win 一致，打开时不闪白） */
export const WIN_COLOR: Record<SkinId, string> = {
  'fam-light': '#fbfbfc',
  'fam-dark': '#0f0f11',
  white: '#ffffff',
  cream: '#fbf8f1',
  black: '#000000',
  deepsea: '#081430',
}

/** 自动提交间隔的说法 */
export function autoCommitLabel(min: number): string {
  if (min === 0) return '不自动提交'
  if (min < 60) return `每 ${min} 分钟`
  return min % 60 === 0 ? `每 ${min / 60} 小时` : `每 ${min} 分钟`
}
