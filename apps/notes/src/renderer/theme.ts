/** 把设置里的外观套到窗口上：<html data-skin data-tone data-tabmark data-winbg>，跟着系统浅深和设置变化 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { activeSkin, type AppSettings, type SkinInfo, skinOf } from '../shared/appearance'
import { themeCss, themeInfo, type ThemeFile } from '../shared/vscode-theme'
import { WINBG_PHOTOS } from './covers'
import { appSettings, publishSettings, usePrefs } from './settings-store'
import { applySkin, installThemeCss } from './skin'
import { applyWall } from '@cn/design/wall'

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
  if (a.winBg === 'wall') return '主题渐变'
  return '纯色（首页是标题栏的颜色）'
}

/** 首页样式 B 勾了「整页背景用窗口背景那张图」时首页用的图：{ url } 是那张图，url 为 null 是纯色，wall 是主题渐变；没勾（或首页是 A）是 null */
export function homeWinBg(s: AppSettings): { url: string | null; wall: boolean } | null {
  return s.appearance.homeStyle === 'b' && s.appearance.homeWinBg ? { url: winBgUrl(s), wall: s.appearance.winBg === 'wall' } : null
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

const imported = (id: string) => id.startsWith('vsc-')

/**
 * 启动时设置一读回来就套上外观，书桌、欢迎页的第一帧就是存下的主题（ui-b A10：以前 index.html 写死薄荷，
 * 书桌挂上、导入主题列表读回来才换，深色主题启动时先白一下；欢迎页一直是薄荷）。用的是导入的主题时先读它
 */
export async function applyLookAtStart(s: AppSettings): Promise<void> {
  const a = s.appearance
  const id = activeSkin(a, media().matches)
  if (imported(id) && userThemes === null) await reloadUserThemes()
  applySkin(skinOf(id, userSkinInfos(userThemes)), a.frame, winBgUrl(s), a.glassLevel, a.winBg === 'wall')
  applyWall({ mix: a.wallMix, move: a.wallMove, speed: a.wallSpeed }, { e2e: window.cnCrash?.e2e })
}

/** 软件设置（外观、自动提交间隔），改了马上套上。只在主窗口的 Desk 里用一次，设置页从这里拿 */
export function useAppSettings(): [AppSettings, (p: Parameters<typeof window.cn.setSettings>[0]) => Promise<AppSettings>, boolean] {
  // App 打开库前已经读过一次（settings-store）：第一帧就是存下的样子，不先闪一下默认的
  const [s, setS] = useState<AppSettings>(appSettings)
  const [dark, setDark] = useState(() => media().matches)
  const user = useUserThemes()
  useEffect(() => publishSettings(s), [s])
  // 别处直接存了设置再 publishSettings（白板消失笔的浮层、费曼的模式、每篇的看法）：这里跟上，设置窗口看到的是新的
  const pub = usePrefs((x) => x)
  useEffect(() => {
    if (pub !== s) setS(pub)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub])
  useEffect(() => {
    void window.cn.settings().then(setS)
    const m = media()
    const h = () => setDark(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  useEffect(() => {
    // 导入的主题读到之前先不套（不然选的是导入主题时会先闪一下薄荷）；自带的十套马上套
    if (user === null && imported(activeSkin(s.appearance, dark))) return
    const a = s.appearance
    applySkin(skinOf(activeSkin(a, dark), userSkinInfos(user)), a.frame, winBgUrl(s), a.glassLevel, a.winBg === 'wall')
    applyWall({ mix: a.wallMix, move: a.wallMove, speed: a.wallSpeed }, { e2e: window.cnCrash?.e2e })
  }, [s, dark, user])
  const set = async (p: Parameters<typeof window.cn.setSettings>[0]) => {
    const next = await window.cn.setSettings(p)
    setS(next)
    return next
  }
  return [s, set, dark]
}
