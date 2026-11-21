/**
 * 从用的地方跳到设置（方向 A 的 A3）：PDF「⋯」、网页「⋯」、底栏「同步」、文件树「排序」、文档「⋯」菜单最下面那一项，
 * 点了打开设置、翻到那页、那一行闪 1.6 秒（App 听 cn:open-settings）。
 * 反过来，设置里「去那里」的几处（网页「⋯ › 插件」、视频条的字幕菜单）由 App 发下面两个事件，开着的那一格接住（preventDefault）。
 */
export const openSettingsAt = (row: string) => window.dispatchEvent(new CustomEvent('cn:open-settings', { detail: { row } }))

/** 右栏网页打开「⋯ › 插件」那一块 */
export const WEB_EXTENSIONS_EVENT = 'cn:web-extensions'
/** 视频条打开字幕菜单 */
export const VIDEO_SUBS_EVENT = 'cn:video-subs'
