/** 把设置里的外观套到窗口上：<html data-skin data-tone data-winbg>，跟着系统浅深和设置变化 */
import { useEffect, useState } from 'react'
import { activeSkin, type AppSettings, DEFAULT_SETTINGS } from '../shared/appearance'
import { WINBG_PHOTOS } from './covers'
import { applySkin } from './skin'

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

/** 窗口背景照片的地址：自带的两张或者自己选的（存在设置目录 backgrounds/ 里） */
export function winBgUrl(s: AppSettings): string | null {
  const a = s.appearance
  if (a.winBg === 'custom' && a.winBgFile) return `cn-file://app/backgrounds/${encodeURIComponent(a.winBgFile)}`
  if (a.winBg === 'aurora' || a.winBg === 'cave') return WINBG_PHOTOS[a.winBg]
  return null
}

/** 软件设置（外观、自动提交间隔），改了马上套上。只在主窗口的 Desk 里用一次，设置页从这里拿 */
export function useAppSettings(): [AppSettings, (p: Parameters<typeof window.cn.setSettings>[0]) => Promise<AppSettings>, boolean] {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [dark, setDark] = useState(() => media().matches)
  useEffect(() => {
    void window.cn.settings().then(setS)
    const m = media()
    const h = () => setDark(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  useEffect(() => applySkin(activeSkin(s.appearance, dark), winBgUrl(s)), [s, dark])
  const set = async (p: Parameters<typeof window.cn.setSettings>[0]) => {
    const next = await window.cn.setSettings(p)
    setS(next)
    return next
  }
  return [s, set, dark]
}
