/** 把设置里的外观套到窗口上：<html data-skin data-tone data-tabmark data-winbg>，跟着系统浅深和设置变化 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { activeSkin, type AppSettings, DEFAULT_SETTINGS, type SkinInfo, skinOf } from '../shared/appearance'
import { themeCss, themeInfo, type ThemeFile } from '../shared/vscode-theme'
import { WINBG_PHOTOS } from './covers'
import { applySkin, installThemeCss } from './skin'

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

/** 窗口背景照片的地址：自带的两张或者自己选的（存在设置目录 backgrounds/ 里）；「不用图」是 null */
export function winBgUrl(s: AppSettings): string | null {
  const a = s.appearance
  if (a.winBg === 'custom' && a.winBgFile) return `cn-file://app/backgrounds/${encodeURIComponent(a.winBgFile)}`
  if (a.winBg === 'aurora' || a.winBg === 'cave') return WINBG_PHOTOS[a.winBg]
  return null
}

/** 窗口背景那张图叫什么（设置里「现在：…」） */
export function winBgName(s: AppSettings): string {
  const a = s.appearance
  if (a.winBg === 'custom' && a.winBgFile) return '从电脑选的那张'
  if (a.winBg === 'aurora') return '极光照片'
  if (a.winBg === 'cave') return '冰洞照片'
  return '不用图（首页是标题栏的纯色）'
}

/** 首页样式 B 勾了「整页背景用窗口背景那张图」时首页用的图：{ url } 是那张图，url 为 null 是纯色；没勾（或首页是 A）是 null */
export function homeWinBg(s: AppSettings): { url: string | null } | null {
  return s.appearance.homeStyle === 'b' && s.appearance.homeWinBg ? { url: winBgUrl(s) } : null
}

// ---------- 导入的 VS Code 主题：整个窗口一份，外观页导入、删掉后重读 ----------
let userThemes: ThemeFile[] | null = null
const subs = new Set<() => void>()
export async function reloadUserThemes() {
  userThemes = await window.cn.themes()
  installThemeCss(userThemes.map(themeCss).join('\n'))
  subs.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  subs.add(f)
  if (userThemes === null) void reloadUserThemes()
  return () => subs.delete(f)
}
/** 导入的主题；还没读到时是 null */
export const useUserThemes = (): ThemeFile[] | null => useSyncExternalStore(subscribe, () => userThemes)
export const userSkinInfos = (list: ThemeFile[] | null): SkinInfo[] => (list ?? []).map(themeInfo)

/** 软件设置（外观、自动提交间隔），改了马上套上。只在主窗口的 Desk 里用一次，设置页从这里拿 */
export function useAppSettings(): [AppSettings, (p: Parameters<typeof window.cn.setSettings>[0]) => Promise<AppSettings>, boolean] {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [dark, setDark] = useState(() => media().matches)
  const user = useUserThemes()
  useEffect(() => {
    void window.cn.settings().then(setS)
    const m = media()
    const h = () => setDark(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  useEffect(() => {
    // 导入的主题读到之前先不套（不然选的是导入主题时会先闪一下薄荷）
    if (user === null) return
    applySkin(skinOf(activeSkin(s.appearance, dark), userSkinInfos(user)), s.appearance.frame, winBgUrl(s))
  }, [s, dark, user])
  const set = async (p: Parameters<typeof window.cn.setSettings>[0]) => {
    const next = await window.cn.setSettings(p)
    setS(next)
    return next
  }
  return [s, set, dark]
}
