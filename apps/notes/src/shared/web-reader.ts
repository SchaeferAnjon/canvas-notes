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
}

/** 网址的域名（去掉 www.）；不是网址就原样 */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
