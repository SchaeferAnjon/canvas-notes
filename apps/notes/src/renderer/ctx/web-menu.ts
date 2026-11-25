/**
 * 右栏网页、中间栏宽网页里的右键（DESIGN.v3 9.2）。网页里的右键事件在主进程（webview 的 context-menu），
 * 转过来时带着点着什么（链接、图、选的字、输入框）；每个 <webview> 挂上时在这里登记自己，按 webContents id 找到它拼菜单。
 */
import { editItems, type CtxParams } from '../../shared/ctx-menu'
import { accelFor } from '../keys'
import { pluginInfo, pageStateOf } from '../plugins/host'
import { toggleTranslate } from '../plugins/translate/shared'
import { asClip, saveImages, webImgClipped } from '../web/image-drop'
import { shownComposer } from '@cn/ai-chat/composer'
import type { WebImgInfo } from '../../shared/web-img'
import { app } from './actions'
import { copy, fromShared, type MenuEntry, showMenu } from './menu'
import { translateAt } from './translate'
import { t } from '../../shared/i18n'
import { ipcOn } from '../crash/ipc'
import { imgCard } from '../web-notes/flow'

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

/** 右键点着的那张图的图注、小标题（网页预加载在弹菜单前报上来，cn:ctx-img） */
let ctxImg: (WebImgInfo & { at: number }) | null = null
export const noteCtxImg = (i: WebImgInfo) => void (ctxImg = { ...i, at: Date.now() })

/** 右键时选着的那段（网页预加载在弹菜单前报上来，cn:ctx-sel）：字、md、小标题，同小条上剪藏取的 */
type CtxSel = { text: string; md?: string; url: string; title: string; head?: string }
let ctxSel: (CtxSel & { wcId: number; at: number }) | null = null
export const noteCtxSel = (wcId: number, s: CtxSel) => void (ctxSel = { ...s, wcId, at: Date.now() })
/** 这一下右键报上来的那段（一秒以内、这个网页的）；没报上来（选区在网页的 iframe 里）是 null */
const ctxSelFor = (wcId: number) => (ctxSel && ctxSel.wcId === wcId && Date.now() - ctxSel.at < 1000 ? ctxSel : null)

/** 这张图的说明：刚报上来的是这张就用它，不然只有地址 */
function imgInfoFor(src: string, url: string, title: string): WebImgInfo {
  const c = ctxImg
  if (c && c.src === src && Date.now() - c.at < 10_000) return { src, alt: c.alt, caption: c.caption, ...(c.head ? { head: c.head } : {}), url: c.url, title: c.title }
  return { src, alt: '', caption: '', url, title }
}

/** 「问 AI 这张图」：附进右栏正开着的那个 AI 输入框（没开就打开 AI，等它出来） */
export async function askAiImage(img: WebImgInfo) {
  let c = shownComposer()
  if (!c) {
    app().runAi()
    for (let i = 0; i < 30 && !c; i++) {
      await new Promise((r) => setTimeout(r, 50))
      c = shownComposer()
    }
  }
  if (!c) throw new Error(t('右栏 AI 没打开'))
  await c.addWebImage(img)
}

/** 「剪进文档」：存进中间那篇的附件，插在光标处；说明是图注，来源回到那张图，网页上标「剪过」 */
async function clipImage(img: WebImgInfo, doc: { path: string; insertAtCursor(md: string): void }) {
  const r = await saveImages(doc.path, [asClip({ src: { kind: 'url', url: img.src }, alt: img.alt, web: img })], '\n\n')
  if (r.errors.length) throw new Error(r.errors[0])
  const md = r.md.join('\n\n')
  doc.insertAtCursor(md)
  if (/^https?:/i.test(img.url)) webImgClipped(doc.path, md, img.url)
  app().notice(t('图剪进了文档光标处'))
}
let listening = false

/** 一个 <webview> 挂上了：登记它，右键时按 id 找到；返回取消登记 */
export function registerWebMenu(wcId: number, page: WebMenuPage, host: () => WebMenuHost): () => void {
  if (!listening) {
    listening = true
    ipcOn(window.cnMenu.onWebContext, 'cnMenu.onWebContext')(async (id, p) => {
      const r = pages.get(id)
      if (!r) return
      // 点在图上：图注是网页预加载另走一路报的，多半先到；没到等它一会儿（最多 150 毫秒）
      for (let i = 0; i < 15 && p.mediaType === 'image' && !(ctxImg && ctxImg.src === p.srcURL); i++) await new Promise((ok) => setTimeout(ok, 10))
      // 选着字：那段的 md、小标题也是另走一路报的，同样最多等 150 毫秒
      for (let i = 0; i < 15 && p.selectionText.trim() && !p.isEditable && !ctxSelFor(id); i++) await new Promise((ok) => setTimeout(ok, 10))
      void showMenu(webMenu(id, p, r.page, r.host()), id)
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
      { label: t('在新标签打开'), run: () => host.openTab(link) },
      host.openWide && { label: t('在中间栏打开'), run: () => host.openWide!(link, text || link) },
      { label: t('拷贝链接'), run: () => copy(link) },
      { label: t('剪进收件箱'), run: () => a.clip({ text: text ? `[${text}](${link})` : link, url: http ? url : link, title: http ? title : text || link }, 'inbox') },
      '-',
    )
  }
  const img = p.mediaType === 'image' && /^(https?:|data:image\/)/i.test(p.srcURL) ? p.srcURL : ''
  if (img) {
    const info = imgInfoFor(img, url, title)
    // 照选了字那一组的先后（DESIGN.v3 9.2）：拷贝、剪，AI 那一项（带引擎标志）自成一组
    out.push(
      { copyImageAt: { x: p.x, y: p.y } },
      { label: t('拷贝图片地址'), run: () => copy(img) },
      {
        label: t('存进附件'),
        run: async () => {
          const saved = await window.cnWeb.saveImage({ kind: 'url', url: img })
          a.refresh()
          a.notice(t('图存进了{path}', { path: saved.path }))
        },
      },
      doc && { label: t('剪进文档'), run: () => clipImage(info, doc) },
      // 剪成一张卡片进收件箱（这个网站选了文件夹进它），同选了字的「剪成卡片」
      http && { label: t('剪成卡片'), run: () => imgCard(info) },
      '-',
      { label: t('问 AI 这张图'), ai: 'chat', run: () => askAiImage(info) },
      '-',
    )
  }
  const sel = p.selectionText.trim()
  if (p.isEditable) out.push(...fromShared(editItems(p.editFlags, { word: p.misspelledWord, suggestions: p.dictionarySuggestions })), '-')
  // 在链接上右键时系统会顺手选中点着的那个词：这时只给链接的几项
  else if (sel && !link) {
    const clip = { text: sel, url: http ? url : '', title }
    // 剪成卡片、剪进文档：照网页报上来的那段写（同 ⌘S：带回到这一段的链接、公式代码写成 md、来源写那段上面的小标题）
    const live = ctxSelFor(wcId)
    const card = live ? { text: live.text, ...(live.md && live.md !== live.text ? { md: live.md } : {}), url: live.url, title: live.title, ...(live.head ? { head: live.head } : {}) } : clip
    out.push(
      { edit: 'copy' },
      '-',
      http && { label: t('剪成卡片'), run: () => a.clip(card, 'card') },
      http && doc && { label: t('剪进文档'), run: () => a.clip(card, 'doc') },
      // AI 那两项（带引擎标志）自成一组
      '-',
      { label: t('翻译'), ai: 'translate', run: () => translateAt(sel, { x: page.rect().left + p.x, y: page.rect().top + p.y }) },
      { label: t('问 AI'), ai: 'chat', run: () => a.askAi(sel, title ? t('网页《{title}》', { title }) : t('网页')) },
      '-',
    )
  }
  const trOn = http && !!pluginInfo(TRANSLATE)?.enabled
  const translating = !!pageStateOf<{ on?: boolean }>(wcId, TRANSLATE)?.on
  out.push(
    { label: t('后退'), enabled: page.canGoBack(), run: () => page.goBack() },
    { label: t('前进'), enabled: page.canGoForward(), run: () => page.goForward() },
    { label: t('重新载入'), run: () => page.reload() },
    '-',
    // 双语翻译（带引擎标志）自成一组
    trOn && { label: translating ? t('恢复原文') : t('双语翻译'), accel: accelFor('translate'), ...(translating ? {} : { ai: 'translate' as const }), run: () => toggleTranslate({ wcId, url, title }) },
    '-',
    http && { label: t('剪藏这一页'), run: () => host.clipPage() },
  )
  return out
}
