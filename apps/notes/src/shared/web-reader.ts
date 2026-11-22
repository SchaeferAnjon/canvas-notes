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
export type SelAction = 'explain' | 'translate' | 'quote' | 'clip' | 'settings' | 'target' | 'copy'

/** 网页选字小条交给界面的：选中的字、它上面的小标题、网页的网址标题，小条在哪（「记到哪篇」贴着它问） */
export interface WebSel {
  action: SelAction
  text: string
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
