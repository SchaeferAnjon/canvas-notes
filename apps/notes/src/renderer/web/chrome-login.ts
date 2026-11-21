/**
 * 导入 Chrome 的登录（网页「⋯ › 导入Chrome登录…」和设置 › 网页和视频「Chrome的登录」是同一件事）：
 * 导好了记下时间（这台 Mac 上，localStorage），设置里写「上次导入 · 11月18日」。
 */
import { useSyncExternalStore } from 'react'

const KEY = 'cn.chromeImportedAt'
const subs = new Set<() => void>()

function read(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

let at = read()

export async function importChromeLogin(profileId: string) {
  const r = await window.cn.importChrome(profileId)
  at = Date.now()
  try {
    localStorage.setItem(KEY, String(at))
  } catch {
    // 记不住只影响设置里那一句
  }
  for (const f of subs) f()
  return r
}

/** 上次导入的时间；没导入过是 null */
export const useChromeImportedAt = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => at,
  )

/** 导好以后底栏那一句 */
export const importedText = (r: { imported: number; expired: number }) => `导入了${r.imported}个登录信息${r.expired ? `，${r.expired}个已过期没导` : ''}。网页重新载入后就是登录状态。`
