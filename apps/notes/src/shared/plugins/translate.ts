/** 双语翻译插件：说明、设置、认语言（主进程、界面、网页预加载都用，只放纯函数） */
import type { PluginManifest } from '../plugins'

export const TRANSLATE: PluginManifest = {
  id: 'translate',
  name: '双语翻译',
  description: '网页每段下面插一行译文，再按一次恢复原文；选中一段也能翻。用这台 Mac 上的 AI 命令行翻。',
  permissions: ['page', 'net'],
}

export type Display = 'below' | 'only'

export interface TranslateSettings {
  /** 翻成什么语言 */
  target: string
  /** 译文在下 / 只看译文 */
  display: Display
}

export const LANGS: { code: string; name: string }[] = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
]

export const DEFAULT_TRANSLATE: TranslateSettings = { target: 'zh-CN', display: 'below' }

export function normalizeTranslate(raw: unknown): TranslateSettings {
  const r = (raw ?? {}) as Partial<TranslateSettings>
  return {
    target: LANGS.some((l) => l.code === r.target) ? r.target! : DEFAULT_TRANSLATE.target,
    display: r.display === 'only' ? 'only' : 'below',
  }
}

export const langName = (code: string) => LANGS.find((l) => l.code === code)?.name ?? code

/** 主语言：zh-CN → zh */
export const primary = (code: string) => code.toLowerCase().split(/[-_]/)[0]!

/**
 * 认一段字是什么语言：按文字系统数（汉字、假名、谚文、西里尔、拉丁）；
 * 拉丁字母分不出英法德，就看网页 <html lang> 写的，没写当英文。认不出（没有字母）给 null。
 */
export function detectLang(text: string, htmlLang = ''): string | null {
  let han = 0
  let kana = 0
  let hangul = 0
  let cyr = 0
  let latin = 0
  for (const ch of text.slice(0, 4000)) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) han++
    else if (c >= 0x3040 && c <= 0x30ff) kana++
    else if (c >= 0xac00 && c <= 0xd7af) hangul++
    else if (c >= 0x0400 && c <= 0x04ff) cyr++
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) latin++
  }
  const total = han + kana + hangul + cyr + latin
  if (!total) return null
  const hl = htmlLang.toLowerCase()
  if (kana / total > 0.05) return 'ja'
  if (hangul / total > 0.2) return 'ko'
  // 汉字一个字顶好几个字母：占到两成就当中文
  if (han / total > 0.2) return /^zh-(tw|hk|mo|hant)/.test(hl) ? 'zh-TW' : 'zh-CN'
  if (cyr / total > 0.3) return 'ru'
  const p = primary(hl)
  return p && /^[a-z]{2,3}$/.test(p) && !['zh', 'ja', 'ko', 'ru'].includes(p) ? p : 'en'
}

/** 和目标是不是一种语言（简繁算一种） */
export const sameLang = (a: string | null, b: string) => !!a && primary(a) === primary(b)

/** 网页本身就是目标语言时换一个：中文网页翻成英文，别的翻成简体中文 */
export function effectiveTarget(target: string, pageLang: string | null): string {
  if (!sameLang(pageLang, target)) return target
  return primary(target) === 'zh' ? 'en' : 'zh-CN'
}
