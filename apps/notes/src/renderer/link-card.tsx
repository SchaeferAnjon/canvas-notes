/**
 * 文档里的链接（DESIGN.v3 6.5，cmdk 方案 A，2026-11-21）：链接后面什么都不露，指着停 0.3 秒下面出一张链接卡
 * （照 Google Docs 的链接卡）：网站图标 + 链接的字、完整网址，下面「右栏打开 ⌘点 · 拷贝 · 改链接 · 去掉链接」。
 * 改链接、去掉链接只改那一段 [字](网址)，⌘Z 能撤回。右键菜单里的「改链接…」也用这里的小弹层（editLinkAt）。
 */
import { Codicon } from '@cn/design'
import { keyFor } from './keys'
import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { parseChatLink, resolveLink } from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import { app } from './ctx/actions'
import { openLinkHit } from './ctx/editor-menu'
import { copy } from './ctx/menu'
import { editorHost, Popover } from './editor-host'
import { type MdLink, mdLinkAt, prettyUrl } from './md-link'
import { Favicon } from './web/favicons'
import { t as tNow } from '../shared/i18n'
import { useT } from './i18n'

const isWeb = (url: string) => /^https?:/i.test(url)

/** 去掉链接：只留字（一次改动，⌘Z 撤回） */
export function unlink(view: EditorView, l: MdLink) {
  view.dispatch({ changes: { from: l.from, to: l.to, insert: l.text }, userEvent: 'input.unlink' })
  app().notice(tNow('「{text}」不再是链接 · {key} 撤回', { text: l.text, key: keyFor('undo') }))
}

/** 改链接：只换网址那几个字 */
function relink(view: EditorView, l: MdLink, url: string) {
  const u = url.trim()
  if (!u || u === l.url) return
  view.dispatch({ changes: { from: l.urlFrom, to: l.urlTo, insert: u.replace(/[()\s]/g, encodeURIComponent) }, userEvent: 'input.relink' })
  app().notice(tNow('链接改好了'))
}

let pop: Popover | null = null
let showing: { view: EditorView; link: MdLink; el: HTMLElement } | null = null
let hoverT: ReturnType<typeof setTimeout> | undefined
let leaveT: ReturnType<typeof setTimeout> | undefined
/** 卡里正在改网址：鼠标走开也不收 */
let editing = false

export function hideLinkCard() {
  clearTimeout(hoverT)
  clearTimeout(leaveT)
  editing = false
  showing = null
  pop?.hide()
}

function popover(): Popover {
  if (pop) return pop
  pop = new Popover('lk-card-host')
  pop.el.addEventListener('mouseenter', () => clearTimeout(leaveT))
  pop.el.addEventListener('mouseleave', () => {
    leaveT = setTimeout(() => !editing && hideLinkCard(), 220)
  })
  window.addEventListener('keydown', (e) => e.key === 'Escape' && pop?.open && !editing && hideLinkCard(), true)
  window.addEventListener('pointerdown', (e) => pop?.open && !pop.el.contains(e.target as Node) && hideLinkCard(), true)
  // 文档滚了：卡对不上链接了
  window.addEventListener('scroll', (e) => pop?.open && !editing && !pop.el.contains(e.target as Node) && hideLinkCard(), true)
  return pop
}

function Card(props: { view: EditorView; link: MdLink; edit?: boolean }) {
  const { view, link } = props
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [edit, setEdit] = useState(!!props.edit)
  const input = useRef<HTMLInputElement>(null)
  const path = view.state.facet(editorHost).path()
  const local = !isWeb(link.url) && !/^[a-z][a-z0-9+.-]*:/i.test(link.url) ? resolveLink(path, link.url) : null
  // AI 回答插进文档时带的「回到 AI 对话」（task-83vl3）：卡上写是哪段对话里的回答，「回到对话」
  const chat = parseChatLink(link.url)
  const canEdit = !view.state.readOnly
  useEffect(() => {
    editing = edit
    if (edit) {
      input.current?.focus()
      input.current?.select()
    }
  }, [edit])
  const done = (url: string | null) => {
    hideLinkCard()
    if (url !== null) relink(view, link, url)
    view.focus()
  }
  return (
    <div className="lk-card" role="dialog" aria-label={t('链接')}>
      <div className="top">
        {isWeb(link.url) ? <Favicon url={link.url} size={14} /> : <Codicon name={chat ? 'comment-discussion' : local ? 'file' : 'link'} size={14} />}
        <b>{link.text || link.url}</b>
      </div>
      <div className="u" title={link.url}>
        {edit ? (
          <input
            ref={input}
            aria-label={t('链接的网址')}
            defaultValue={link.url}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') (e.preventDefault(), done(e.currentTarget.value))
              if (e.key === 'Escape') (e.preventDefault(), done(null))
            }}
          />
        ) : chat ? (
          t('AI 对话里的一条回答')
        ) : (
          prettyUrl(link.url)
        )}
      </div>
      <div className="acts">
        {(isWeb(link.url) || local || chat) && (
          <button onClick={() => (hideLinkCard(), openLinkHit(path, link.url, link.text, false, view.state.doc.toString(), link.from))}>
            <Codicon name={chat ? 'comment-discussion' : local ? 'go-to-file' : 'layout-sidebar-right'} size={13} />
            {chat ? t('回到对话') : local ? t('打开') : t('右栏打开')} <span className="k">{keyFor('cmd-click')}</span>
          </button>
        )}
        <button onClick={() => void copy(link.url).then(() => setCopied(true))}>
          <Codicon name={copied ? 'check' : 'copy'} size={13} />
          {copied ? t('已拷贝') : t('拷贝')}
        </button>
        {canEdit && (
          <button onClick={() => setEdit(true)}>
            <Codicon name="edit" size={13} />
            {t('改链接')}
          </button>
        )}
        {canEdit && (
          <button onClick={() => (hideLinkCard(), unlink(view, link), view.focus())}>
            <Codicon name="close" size={13} />
            {t('去掉链接')}
          </button>
        )}
      </div>
    </div>
  )
}

function show(view: EditorView, link: MdLink, el: HTMLElement, edit = false) {
  const r = el.getBoundingClientRect()
  showing = { view, link, el }
  popover().show(<Card key={`${link.from}:${link.url}:${edit}`} view={view} link={link} edit={edit} />, { left: r.left, top: r.top, bottom: r.bottom })
}

/** 右键「改链接…」：在链接下面出卡、网址那一行直接是输入框 */
export function editLinkAt(view: EditorView, pos: number) {
  const link = mdLinkAt(view.state.doc, pos)
  if (!link) return
  const el = (view.domAtPos(Math.min(link.from + 1, view.state.doc.length)).node.parentElement?.closest('.cm-link') as HTMLElement | null) ?? null
  const coords = view.coordsAtPos(link.from + 1)
  if (el) return show(view, link, el, true)
  if (!coords) return
  const fake = { getBoundingClientRect: () => ({ left: coords.left, top: coords.top, bottom: coords.bottom }) } as unknown as HTMLElement
  show(view, link, fake, true)
}

/** 指着链接 0.3 秒出卡；离开链接和卡 0.22 秒收起 */
export const linkCard: Extension = [
  EditorView.domEventHandlers({
    mousemove(e, view) {
      const el = (e.target as Element | null)?.closest?.('.cm-link') as HTMLElement | null
      if (!el) {
        clearTimeout(hoverT)
        if (showing?.view === view && !editing && !leaveT) leaveT = setTimeout(() => ((leaveT = undefined), !editing && hideLinkCard()), 220)
        return false
      }
      clearTimeout(leaveT)
      leaveT = undefined
      if (showing?.el === el) return false
      clearTimeout(hoverT)
      hoverT = setTimeout(() => {
        if (!el.isConnected) return
        const link = mdLinkAt(view.state.doc, view.posAtDOM(el))
        if (link && !editing) show(view, link, el)
      }, 300)
      return false
    },
    mouseleave(_e, view) {
      clearTimeout(hoverT)
      if (showing?.view === view && !editing) leaveT = setTimeout(() => ((leaveT = undefined), !editing && hideLinkCard()), 220)
      return false
    },
  }),
  ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {}
      update(u: { docChanged: boolean }) {
        // 字改了，卡上记的位置不对了
        if (u.docChanged && showing?.view === this.view && !editing) hideLinkCard()
      }
      destroy() {
        if (showing?.view === this.view) hideLinkCard()
      }
    },
  ),
]
