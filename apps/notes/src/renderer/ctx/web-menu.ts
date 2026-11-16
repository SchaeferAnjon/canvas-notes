/**
 * 右栏网页、中间栏宽网页里的右键（DESIGN.v3 9.2）。网页里的右键事件在主进程（webview 的 context-menu），
 * 转过来时带着点着什么（链接、图、选的字、输入框）；每个 <webview> 挂上时在这里登记自己，按 webContents id 找到它拼菜单。
 */
import { editItems, type CtxParams } from '../../shared/ctx-menu'
import { pluginInfo, pageStateOf } from '../plugins/host'
import { toggleTranslate } from '../plugins/translate/shared'
import { saveImages } from '../web/image-drop'
import { app } from './actions'
import { copy, fromShared, type MenuEntry, showMenu } from './menu'
import { translateAt } from './translate'

/** 网页所在的地方（右栏还是中间栏）各自怎么做的几件事 */
export interface WebMenuHost {
  /** 链接「在新标签打开」 */
  openTab(url: string): void
  /** 链接「在中间栏打开」；中间栏自己就不给 */
  openWide?(url: string, title: string): void
  clipPage(): void
}

/** 网页本身（webview 元素）的几样 */
export interface WebMenuPage {
  url(): string
  title(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  /** 网页在界面上的位置（译文弹层摆在右键的地方） */
  rect(): DOMRect
}

const pages = new Map<number, { page: WebMenuPage; host: () => WebMenuHost }>()
let listening = false

/** 一个 <webview> 挂上了：登记它，右键时按 id 找到；返回取消登记 */
export function registerWebMenu(wcId: number, page: WebMenuPage, host: () => WebMenuHost): () => void {
  if (!listening) {
    listening = true
    window.cnMenu.onWebContext((id, p) => {
      const r = pages.get(id)
      if (r) void showMenu(webMenu(id, p, r.page, r.host()), id)
    })
  }
  pages.set(wcId, { page, host })
  return () => void pages.delete(wcId)
}

const TRANSLATE = 'translate'

export function webMenu(wcId: number, p: CtxParams, page: WebMenuPage, host: WebMenuHost): MenuEntry[] {
  const a = app()
  const url = page.url()
  const title = page.title() || url
  const http = /^https?:/i.test(url)
  const doc = a.doc()
  const out: MenuEntry[] = []
  const link = /^https?:/i.test(p.linkURL) ? p.linkURL : ''
  if (link) {
    const text = p.linkText.trim()
    out.push(
      { label: '在新标签打开', run: () => host.openTab(link) },
      host.openWide && { label: '在中间栏打开', run: () => host.openWide!(link, text || link) },
      { label: '拷贝链接', run: () => copy(link) },
      { label: '剪进收件箱', run: () => a.clip({ text: text ? `[${text}](${link})` : link, url: http ? url : link, title: http ? title : text || link }, 'inbox') },
      '-',
    )
  }
  const img = p.mediaType === 'image' && /^(https?:|data:image\/)/i.test(p.srcURL) ? p.srcURL : ''
  if (img) {
    const source = http ? { title, url } : undefined
    out.push(
      { copyImageAt: { x: p.x, y: p.y } },
      { label: '拷贝图片地址', run: () => copy(img) },
      {
        label: '存进附件',
        run: async () => {
          const saved = await window.cnWeb.saveImage({ kind: 'url', url: img })
          a.refresh()
          a.notice(`图存进了 ${saved.path}`)
        },
      },
      doc && {
        label: '插进文档',
        run: async () => {
          const r = await saveImages(doc.path, [{ src: { kind: 'url', url: img }, alt: '', ...(source ? { source } : {}) }], '\n\n')
          if (r.errors.length) throw new Error(r.errors[0])
          doc.insertAtCursor(r.md.join('\n\n'))
          a.notice('图插进了文档光标处')
        },
      },
      '-',
    )
  }
  const sel = p.selectionText.trim()
  if (p.isEditable) out.push(...fromShared(editItems(p.editFlags, { word: p.misspelledWord, suggestions: p.dictionarySuggestions })), '-')
  // 在链接上右键时系统会顺手选中点着的那个词：这时只给链接的几项
  else if (sel && !link) {
    const clip = { text: sel, url: http ? url : '', title }
    out.push(
      { edit: 'copy' },
      '-',
      http && { label: '剪成卡片', run: () => a.clip(clip, 'inbox') },
      http && doc && { label: '剪进文档', run: () => a.clip(clip, 'doc') },
      { label: '翻译', run: () => translateAt(sel, { x: page.rect().left + p.x, y: page.rect().top + p.y }) },
      { label: '问 AI', run: () => a.askAi(sel) },
      '-',
    )
  }
  const trOn = http && !!pluginInfo(TRANSLATE)?.enabled
  const translating = !!pageStateOf<{ on?: boolean }>(wcId, TRANSLATE)?.on
  out.push(
    { label: '后退', enabled: page.canGoBack(), run: () => page.goBack() },
    { label: '前进', enabled: page.canGoForward(), run: () => page.goForward() },
    { label: '重新载入', run: () => page.reload() },
    '-',
    trOn && { label: translating ? '恢复原文' : '双语翻译', accel: 'Alt+A', run: () => toggleTranslate({ wcId, url, title }) },
    http && { label: '整页剪藏', run: () => host.clipPage() },
  )
  return out
}
