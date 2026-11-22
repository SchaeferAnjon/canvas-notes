/** 界面和主进程之间说语言（预加载 preload/lang.ts 挂成 window.cnLang） */
import type { Lang, LangSetting } from './core'

export interface LangInfo {
  /** 这会儿界面用的 */
  lang: Lang
  /** 设置里选的 */
  setting: LangSetting
  /** 跟随系统会是哪种 */
  system: Lang
  /** 那种语言自己的写法（「跟随系统（简体中文）」括号里的） */
  systemName: string
  /** 英文界面里钟点用 12 小时制（跟系统） */
  hour12: boolean
  /** 开着的库的语言：写进文件的字跟它 */
  vault: Lang
  /** 测试开局用 CN_LANG 定的（设置里一改就不算） */
  forced: boolean
  /** 能不能切语言：没放出来（main/lang.ts 的 LANG_SWITCH）时设置里不出「语言」、软件一律中文 */
  available: boolean
}

export interface LangApi {
  info(): LangInfo
  set(setting: LangSetting): Promise<LangInfo>
  onChange(cb: (info: LangInfo) => void): () => void
}
