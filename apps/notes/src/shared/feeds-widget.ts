/**
 * 文件夹首页「画布订阅」组件读的那一份的写法（画布订阅写在它设置目录里的 widget.json；画布订阅那边是 apps/feeds/src/main/widget.ts，
 * 两边各认一份，改了两边一起改）。主进程 main/feeds-widget.ts 读，preload 暴露成 window.cnFeeds，界面 renderer/folder-home/FeedsWidget.tsx。
 */
export interface FeedsWidgetData {
  v: 1
  at: number
  groups: { id: string; name: string; unread: number; articles: { id: string; title: string; feed: string; publishedAt: number; read: boolean }[] }[]
}

export interface CnFeedsApi {
  /** 画布订阅写的那一份；没装、没打开过是 null */
  widget(): Promise<FeedsWidgetData | null>
  /** 在画布订阅里打开这一篇 */
  open(id: string): Promise<void>
  /** 打开画布订阅 */
  openApp(): Promise<void>
}
