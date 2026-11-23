/** 右栏网页 → 中间栏：阅读视图的正文块，和在网页上框好的一块（网页预加载和界面都用） */

export interface ReaderBlock {
  /** formula：公式、代码、表格（不翻译）；figure：图 */
  kind: 'heading' | 'text' | 'formula' | 'figure'
  text: string
  /** 公式、图的图片网址 */
  src?: string
}

export interface ReaderPage {
  url: string
  title: string
  /** 域名（去掉 www.） */
  site: string
  blocks: ReaderBlock[]
}

/** 在网页上框好的一块：位置是网页视口里的 CSS 像素 */
export interface WebBox {
  rect: { x: number; y: number; w: number; h: number }
  /** 框里的字 */
  text: string
  url: string
  title: string
  /** 网页视口大小（算截图在 webview 里的位置） */
  vw: number
  vh: number
  /** 框住的那块上面最近的小标题（回到那一段的链接上写它，task-6cxtc） */
  head?: string
  /** 点工具条上那一颗时工具条在哪（问「记到哪篇」的弹层贴在它下面） */
  bar?: PageRect
}

/** 网页里一块地方（网页视口里的 CSS 像素） */
export interface PageRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 网页选字小条上点了什么（task-6cxtc 四处统一）：讲解一下、翻译 + 讲一讲、引用、剪藏；「⋯」里的翻译设置、剪到哪篇、拷贝。
 * 只看译文在网页里自己弹，不交过来
 */
export type SelAction = 'explain' | 'translate' | 'quote' | 'clip' | 'settings' | 'target' | 'copy' | SelBarAction

/**
 * 选中小条能自定义以后多的（task-26nz7）：cmd 自己加的那颗（WebSel.cmd 是哪条命令）；add「⋯ › 加一颗…」拿这段举例；barset「小条设置…」；
 * mute-site、mute-all：× 的小菜单「这个网站不弹」「哪里都不弹」
 */
export type SelBarAction = 'cmd' | 'add' | 'barset' | 'mute-site' | 'mute-all'
export const SEL_ACTIONS: readonly SelAction[] = ['explain', 'translate', 'quote', 'clip', 'settings', 'target', 'copy', 'cmd', 'add', 'barset', 'mute-site', 'mute-all']

/** 网页小条上的一颗（软件发给网页的，名字、右边那句已经照界面语言翻好） */
export interface WebBarBtn {
  id: string
  label: string
  /** codicon 的名字；ai 是 AI 对话那一家的标志，tr 是翻译那一家的 */
  icon: string
  key: string | null
  mine: boolean
  right?: string
}

/** 软件发给网页的小条（cn:bar）：条上竖线前、竖线后、⋯ 里，总开关、不弹的网站，刚存好的那颗，强调色，菜单里的字 */
export interface WebBarSpec {
  main: WebBarBtn[]
  tail: WebBarBtn[]
  more: WebBarBtn[]
  enabled: boolean
  offSites: { site: string; at: string }[]
  fresh: string | null
  acc: string
  text: Record<'more' | 'close' | 'trSettings' | 'target' | 'add' | 'addR' | 'settings' | 'section' | 'mute' | 'muteR' | 'all' | 'allR' | 'note' | 'noteLink' | 'bar' | 'menu' | 'xmenu', string>
}

/** 网页选字小条交给界面的：选中的字、它上面的小标题、网页的网址标题，小条在哪（「记到哪篇」贴着它问） */
export interface WebSel {
  action: SelAction
  /** 自己加的那颗：哪条命令 */
  cmd?: string
  text: string
  /** 选中的这段写成 md：公式写成 $…$、代码块带上（剪藏、引用、讲解写进笔记用；回到那一段、找段落仍用 text） */
  md?: string
  url: string
  title: string
  head?: string
  bar: PageRect
}

/** 网址的域名（去掉 www.）；不是网址就原样 */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
