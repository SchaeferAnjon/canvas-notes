/**
 * 画布笔记交给 @cn/ai-chat 的宿主（ParaRead 联动）：AI 对话框的界面在共用包里，这里接上画布笔记自己的东西，样子和行为照旧：
 * - 文案：画布笔记中英两种（换了界面语言再交一次，用到的组件跟着重画）；图标：Codicons，'ai' 画 AI 对话现在那一家的标志；快捷键照命令表；
 * - 输入框边上的流光（ai-glow 的 ComposerGlow）；回答正文用画布笔记的 Markdown（公式、能点开的引用、藏掉写成字的工具调用）；
 * - 引擎、全能开关、贴图、拷贝、出错认原因走 window.cn 和 shared/ai-errors。
 * main.tsx 在第一次画之前引它（编辑器部件各自 createRoot 的那几棵树也拿得到）。
 */
import { Codicon, codiconEl, type CodiconName } from '@cn/design'
import { setAiChatHost } from '@cn/ai-chat/context'
import type { ChatHost, SideAnswerRow, UiHost } from '@cn/ai-chat/host'
import type { EngineId } from '../shared/agent'
import { aiErrorView } from '../shared/ai-errors'
import { type Lang, onUiLang, t as tNow, tIn, uiLang } from '../shared/i18n'
import { withoutVizMark } from '../shared/reading'
import { hideToolMarkup } from '../shared/tool-markup'
import { ComposerGlow } from './ai-glow'
import { touchedOf } from './cite-names'
import { copy } from './ctx/menu'
import { AiIcon } from './engine-logo'
import { isKey, keyFor } from './keys'
import { Markdown } from './md-render'
import { imagesFrom, looksLikeImage, webDragLive } from './web/image-drop'
import { imgChipLabel } from '../shared/web-img'
import { app } from './ctx/actions'
import { fragmentUrl } from '../shared/web-link'
import { answerSelItems, answerSelSay } from '../shared/replies'
import type { AiCmd } from '../shared/ai-cmds'
import { useAiCmds } from './commands/store'
import { useCmds } from './search/cmd-store'
import { openRepliesSettings, sayOf } from './replies/store'
import { AnswerRow } from './answer-row'
import type { ReplyPlace } from '../shared/replies'
import { useT } from './i18n'
import { ipcOn } from './crash/ipc'

/** 去设置 › AI（App 听这个事件开设置；各处不用一层层传回调） */
export const openAiSettings = () => window.dispatchEvent(new CustomEvent('cn:open-settings', { detail: 'ai' }))

/** 粘贴、拖进来的图存在软件设置目录 pasted/ 里（main/pasted.ts） */
export const pastedUrl = (name: string) => `cn-file://app/pasted/${encodeURIComponent(name)}`

const uiOf = (lang: Lang): UiHost => ({
  t: (k, p) => tIn(lang, k, p),
  icon: (name, o = {}) =>
    name === 'ai' ? <AiIcon job="chat" size={o.size ?? 16} {...(o.className ? { className: o.className } : {})} /> : <Codicon name={name as CodiconName} {...(o.size ? { size: o.size } : {})} {...(o.className ? { className: o.className } : {})} />,
  iconEl: (name, size) => codiconEl(name as CodiconName, size),
  isKey: (e, id) => isKey(e as KeyboardEvent, id),
  keyLabel: (id) => keyFor(id),
  inputGlow: (running) => <ComposerGlow running={running} />,
})

const chat: ChatHost = {
  aiEngines: () => window.cn.aiEngines(),
  onAiPrefsChanged: (cb) => ipcOn(window.cn.onAiPrefsChanged, 'cn.onAiPrefsChanged')(cb),
  aiSetEngine: (id) => window.cn.aiSetEngine(id as EngineId),
  aiSetOmni: (on) => window.cn.aiSetOmni(on),
  aiPickCli: (id) => window.cn.aiPickCli(id as EngineId),
  aiPaste: (bytes, mime) => window.cn.aiPaste(bytes, mime),
  aiPickImages: (room) => window.cn.aiPickImages(room),
  pastedUrl,
  // 模型偶尔把工具调用写成了字（task-ne7cw）：成段的不显示；可视化、配图那两行标记也不显示
  renderMarkdown: (text, o) => <Markdown text={hideToolMarkup(withoutVizMark(text).text, o.live)} math cites={{ conv: o.conv, touched: touchedOf(o.steps) }} />,
  plainAnswer: (text) => withoutVizMark(text).text,
  copy: (text) => copy(text),
  openAiSettings,
  aiErrorView,
  // 网页图拖进对话（task 网页图能拖进对话）：右栏网页拖来的图、右键「问 AI 这张图」
  webImage: {
    dragLive: webDragLive,
    looks: looksLikeImage,
    read: async (dt) => (await imagesFrom(dt)).flatMap((f) => (f.src.kind === 'url' ? [f.web ?? { src: f.src.url, alt: f.alt, caption: '', url: f.src.url, title: '' }] : [])),
    paste: async (img) => ({ name: await pasteWebImage(img.src), label: imgChipLabel(img) }),
  },
  // 旁支答完那排：同 AI 对话回答下面那排（拷贝 · 插进文档 · ⋯ ｜ 快捷回复），⋯ 里加插进主对话、在笔记里看
  sideAnswerRow: (o) => <SideRow {...o} />,
  // 回答里选中放自定义命令：小框里列自己的 AI 命令（同一份命令库，去掉勾的在 answerSel.off）
  selCmds: {
    use: () => {
      const { mine } = useAiCmds()
      const c = answerSelItems(useCmds().answerSel, mine)
      const one = (x: AiCmd) => ({ id: x.id, name: x.name, say: sayOf(x) })
      return { shown: c.shown.map(one), more: c.more.map(one) }
    },
    say: (c, o) => answerSelSay(c.say, o) || c.name,
    openSettings: () => openRepliesSettings({ view: 'list', at: 'sel' }),
  },
  // 网页上引的那段：回到右栏网页里那几句、亮一下（引用留在当前对话）
  openQuoteSource: (url, text) => app().openWebAt(fragmentUrl(url, text)),
  // @ 点名的那颗胶囊（输入框里、发出去的那条里）：打开那篇（PDF、HTML 照它们自己的开法）
  openMention: (m) => app().openFile(m.path),
}

function SideRow(o: SideAnswerRow) {
  const t = useT()
  return (
    <AnswerRow
      md={o.md}
      {...(o.link ? { chatKey: o.link.key, msg: o.link.msg } : {})}
      last
      keepLabels
      host={{ place: (o.place ?? 'chat') as ReplyPlace, busy: o.busy, send: o.send, vars: () => ({ question: o.question }) }}
      menu={[
        { id: 'put', icon: 'reply', label: t('插进主对话'), tip: t('这条回答作为一块引用放进主对话的输入框，不发'), onClick: o.onPut },
        ...(o.onNote ? [{ id: 'note', icon: 'note' as const, label: t('在笔记里看'), onClick: o.onNote }] : []),
      ]}
      testId="side-ans-acts"
    />
  )
}

setAiChatHost(uiOf(uiLang()), chat)
onUiLang(() => setAiChatHost(uiOf(uiLang())))

/** 画成 PNG（SVG 没有自己的大小时按 800 宽画；小于 1200 宽的 SVG 放大两倍画，AI 看得清） */
async function blobToPng(blob: Blob, svg: boolean): Promise<Uint8Array> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode().catch(() => {
      throw new Error(svg ? tNow('这张 SVG 图画不出来') : tNow('这张图读不出来'))
    })
    let w = img.naturalWidth || 800
    let h = img.naturalHeight || Math.round(w * 0.6)
    if (svg && w < 1200) {
      w *= 2
      h *= 2
    }
    const c = new OffscreenCanvas(w, h)
    const g = c.getContext('2d')!
    // SVG 多半是透明底：垫白底（AI、缩略图里黑字不会糊在深色上）
    if (svg) {
      g.fillStyle = '#fff'
      g.fillRect(0, 0, w, h)
    }
    g.drawImage(img, 0, 0, w, h)
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 网页上的一张图（拖进来的、右键「问 AI 这张图」的）存进 pasted/：主进程用网页那个会话取回来，
 * PNG、JPEG 原样，SVG、WebP、GIF 画成 PNG；返回 pasted/ 里的名字
 */
export async function pasteWebImage(src: string): Promise<string> {
  const { bytes, type } = await window.cnWeb.fetchImage(src)
  if (type === 'image/png' || type === 'image/jpeg') return window.cn.aiPaste(bytes, type)
  const png = await blobToPng(new Blob([new Uint8Array(bytes)], { type }), type === 'image/svg+xml')
  return window.cn.aiPaste(png, 'image/png')
}
