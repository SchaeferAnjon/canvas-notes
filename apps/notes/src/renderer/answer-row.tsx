/**
 * 回答下面那一排在画布笔记这边（task-eavzx，款式页「62-回答按钮款式」第二版；组件本身在 @cn/design/answer-bar，画布今日、ParaRead 共用）：
 * - 左边功能按钮固定：拷贝（显示出来的字）· 插进文档 · ⋯（存进收件箱、宿主加的几样（插进主对话、在笔记里看、到 AI 对话里接着聊）、拷贝为 Markdown）；
 * - 右边快捷回复：命令库里的（自带的还是不懂、换个方式讲、做个可视化，自己加的），按这一处（AI 对话 / 读 PDF / 网页 / 视频）照表排；
 * - ⋯ 最下面「调整这一排…」开设置 › 选中小条 › 回答下面那排。
 * 「插进文档」只有一种做法：写成 AI 块，块头链回这段对话（answerBlock；按钮和右键同名那一项都走 insertAnswer）。
 * 以前叫 ans-acts.tsx（task-83vl3 第一版，task-r00en 加 ⋯，task-bppvn 拿掉「引用再问」）。
 */
import { AnswerBar, type AbAct, type AbMenuItem, type AbReply } from '@cn/design/answer-bar'
import '@cn/design/answer-bar.css'
import { aiBlock, calloutWords, chatLink } from '@cn/format'
import { useRef } from 'react'
import { app } from './ctx/actions'
import { copy } from './ctx/menu'
import { t } from '../shared/i18n'
import { titleOf } from '../shared/layout'
import { useT } from './i18n'
import { withoutEffort } from '../shared/ai-features'
import { fillReply, type ReplyPlace, type ReplyVar } from '../shared/replies'
import { openRepliesSettings, useReplies } from './replies/store'
import { AiIcon, ByLogo } from './engine-logo'

/**
 * 插进文档的那一块：AI 写进文档的一律是 `> [!ai]` 块（task-dtc34，和全能模式补包、/ 菜单写一段同一个 aiBlock）。
 * 块头「AI 回答 · Claude Code · Opus 5.5 · 回到 AI 对话」（回答头上的档不带，链接回到这段对话的这条回答），块里是回答原文
 */
export function answerBlock(p: { md: string; by?: string; key?: string; msg?: number }): string {
  return aiBlock(p.md.trim(), { label: calloutWords().answer, ...(p.by ? { by: withoutEffort(p.by) } : {}), ...(p.key && p.msg !== undefined ? { link: chatLink(p.key, p.msg) } : {}) })
}

/** 插进文档（回答下面那排的按钮、这条回答右键同名那一项）：中间那篇光标处（没点进过接在末尾），写成 AI 块；没开文档是 false */
export function insertAnswer(p: { md: string; by?: string; key?: string; msg?: number }): boolean {
  const d = app().doc()
  if (!d) return false
  d.insertAtCursor(answerBlock(p), { end: !d.cursorPlaced })
  app().notice(t('插进了《{name}》', { name: titleOf(d.path) }))
  return true
}

/** 这条回答原样存进收件箱（回答下面 ⋯ 和右键「存进收件箱」同一件事） */
export async function saveToInbox(md: string) {
  await window.cn.capture(md.trim())
  app().refresh()
  app().notice(t('存进了收件箱'), 'inbox')
}

/**
 * 「拷贝」拷的是显示出来的字（和右键「拷贝」一样）：这条回答里 .txt 那一块；旁支（挂在一条回答里面）是旁支最后那条回答的字，
 * 不往外找到主对话那条；拿不到时拷原文
 */
export function shownText(el: Element | null, md: string): string {
  const box = el?.closest('.side-inl, [data-msg]')
  const txt = box?.classList.contains('side-inl') ? [...box.querySelectorAll<HTMLElement>('.sa .sat')].pop() : box?.querySelector<HTMLElement>('.txt')
  return (txt?.innerText ?? '').trim() || md.trim()
}

/** 宿主交进来的：这一处是哪一处，点快捷回复怎么发 */
export interface ReplyHost {
  place: ReplyPlace
  /** 在这段对话里发一句（和自己打字发出去一样） */
  send?(text: string): void
  /** 在这条回答上开一条旁支问（「在哪答」选了开一条旁支的那几颗）；没有就照样在这段对话里发 */
  side?(text: string): void
  /** 做个可视化（只在 AI 觉得适合画图时给） */
  viz?(): void
  /** 那句里 {你问的那句}、{第几页}、{看得到的材料} 填什么 */
  vars?(): Partial<Record<ReplyVar, string>>
  /** 正在答：快捷回复先变淡 */
  busy?: boolean
}

export function AnswerRow(p: {
  md: string
  by?: string
  /** 链回对话用（插进文档那块的块头） */
  chatKey?: string
  msg?: number
  /** 最新那条：一直露着 */
  last: boolean
  host?: ReplyHost
  /** ⋯ 里宿主加的几样（在笔记里看……） */
  menu?: AbMenuItem[]
  /** ⋯ 最前面：记进《…》/ 从《…》拿掉（只管这一条，AI 对话记笔记开关）；「存进收件箱」照旧在最后一组 */
  noteItem?: AbMenuItem | null
  /** 不给快捷回复（命令结果、出错那条） */
  noReplies?: boolean
  /** 挤了先把快捷回复收进 ⋯、功能按钮照样带字（旁支、视频问框） */
  keepLabels?: boolean
  testId?: string
}) {
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  const place = p.host?.place ?? 'chat'
  const view = useReplies(place)
  const doc = app().doc()
  const by = p.by
  const logo = by ? <ByLogo by={by} /> : <AiIcon job="chat" size={12} />

  const acts: AbAct[] = [
    {
      id: 'copy',
      icon: 'copy',
      label: t('拷贝'),
      tip: t('拷贝这条回答'),
      flash: { icon: 'check', label: t('已拷贝') },
      onClick: () => void copy(shownText(root.current, p.md)),
    },
    {
      id: 'insert',
      icon: 'insert',
      label: t('插进文档'),
      disabled: !doc,
      tip: !doc
        ? t('中间开着一篇文档才能插')
        : doc.cursorPlaced
          ? t('插到《{name}》光标处\n写成 AI 块，块头链回这段对话', { name: titleOf(doc.path) })
          : t('插到《{name}》末尾\n写成 AI 块，块头链回这段对话', { name: titleOf(doc.path) }),
      onClick: () => void insertAnswer({ md: p.md, ...(by ? { by } : {}), ...(p.chatKey ? { key: p.chatKey } : {}), ...(p.msg !== undefined ? { msg: p.msg } : {}) }),
    },
  ]
  // ⋯ 里：记进《…》/ 从《…》拿掉（只管这一条）· 宿主加的几样（在笔记里看、插进主对话…）· 拷贝为 Markdown ｜ 放不下的快捷回复 ｜ 调整这一排… ｜ 存进收件箱
  // （用户 r100「这放到收件箱 我感觉没什么用」：挪到最后一组）
  const head: AbMenuItem[] = p.noteItem ? [p.noteItem] : []
  const menu: AbMenuItem[] = [...(p.menu ?? []), { id: 'copy-md', icon: 'markdown', label: t('拷贝为 Markdown'), onClick: () => void copy(p.md.trim()) }]
  const tail: AbMenuItem[] = [{ id: 'inbox', icon: 'inbox', label: t('存进收件箱'), tip: t('这条回答原样存成收件箱里的一篇，之后再分'), onClick: () => void saveToInbox(p.md) }]

  const h = p.host
  const reply = (it: (typeof view.on)[number]): AbReply[] => {
    if (!h) return []
    if (it.viz) return h.viz ? [{ id: it.id, label: it.label, icon: it.icon === 'ai' ? 'logo' : it.icon, onClick: h.viz }] : []
    const go = it.out === 'side' && h.side ? h.side : h.send
    if (!go) return []
    return [
      {
        id: it.id,
        label: it.label,
        icon: it.icon === 'ai' ? 'logo' : it.icon,
        disabled: !!h.busy,
        ...(it.mine ? { tip: it.say.length > 80 ? it.say.slice(0, 80) + '…' : it.say } : {}),
        onClick: () => go(fillReply(it.say, { answer: p.md, ...(h.vars?.() ?? {}) }) || it.label),
      },
    ]
  }
  const on = p.noReplies ? [] : view.on.flatMap(reply)
  const more = p.noReplies ? [] : view.more.flatMap(reply)

  return (
    <div ref={root} className="ans-row">
      <AnswerBar
        acts={acts}
        menu={menu}
        replies={on}
        moreReplies={more}
        adjust={{ id: 'adjust', icon: 'settings-gear', label: t('调整这一排…'), onClick: () => openRepliesSettings({ view: 'list', place }) }}
        head={head}
        tail={tail}
        logo={logo}
        text={{ more: t('这条回答还能做什么'), moreTip: t('更多'), moreReplies: t('快捷回复（这一排放不下的）') }}
        on={p.last}
        {...(p.keepLabels ? { keepLabels: true } : {})}
        className="ans-acts"
        testId={p.testId ?? 'ai-ans-acts'}
      />
    </div>
  )
}
