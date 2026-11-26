/**
 * 「存成快捷回复」（task-eavzx，款式页「62-回答按钮款式」第二版 r2-save）：你在对话里打过一句好用的，存成回答下面那排的一颗。
 * - 你发的那句下面悬停出「拷贝 · 存成快捷回复」（UserMsgActs，AI 对话和读 PDF 都有）；右键那句也有「存成快捷回复…」（ctx/message-menu.ts）；
 * - 两条路都派发 SAVE_REPLY_EVENT，SaveReplyHost（App 里挂一个）弹同一张填好的小卡：名字取前几个字、那句原样、在哪出现勾上当前这一处；
 *   取消 / 存好 ⌘↵；存好就排在这一排最后（也是一条命令），底栏给撤回。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { REPLY_PLACES, type ReplyPlace, SAY_MAX } from '../../shared/replies'
import { app } from '../ctx/actions'
import { copy } from '../ctx/menu'
import { askSaveReply, SAVE_REPLY_EVENT, type SaveReplyAsk } from '../ctx/message-menu'
import { useT } from '../i18n'
import { withKeys } from '../keys'
import { newReplyCmd, replyNameFor, replyNameMax, saveReply } from './store'
import './save-reply.css'

/** 你发的那句下面那一小排：拷贝 · 存成快捷回复（悬停那一句才露） */
export function UserMsgActs({ text, place }: { text: string; place: ReplyPlace }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const off = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(off)
  }, [copied])
  if (!text.trim()) return null
  return (
    <div className="um-acts" data-testid="um-acts">
      <button type="button" className="ua-btn" aria-label={copied ? t('已拷贝') : t('拷贝')} data-tip={copied ? t('已拷贝') : t('拷贝这一句')} onClick={() => (void copy(text.trim()), setCopied(true))}>
        <Codicon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      <button
        type="button"
        className="ua-btn"
        data-tip={t('存成回答下面那排的一颗：点一下就替你发这一句')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          askSaveReply({ text: text.trim(), place, x: r.right, y: r.bottom })
        }}
      >
        <Codicon name="bookmark" size={14} />
        {t('存成快捷回复')}
      </button>
    </div>
  )
}

/** 听「存成快捷回复」，弹那张小卡（App 里挂一个） */
export function SaveReplyHost() {
  const [ask, setAsk] = useState<(SaveReplyAsk & { seq: number }) | null>(null)
  useEffect(() => {
    const on = (e: Event) => setAsk({ ...(e as CustomEvent<SaveReplyAsk>).detail, seq: Date.now() })
    window.addEventListener(SAVE_REPLY_EVENT, on)
    return () => window.removeEventListener(SAVE_REPLY_EVENT, on)
  }, [])
  if (!ask) return null
  return createPortal(<SaveReplyCard key={ask.seq} ask={ask} onClose={() => setAsk(null)} />, document.body)
}

const W = 300

function SaveReplyCard({ ask, onClose }: { ask: SaveReplyAsk; onClose(): void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const nameIn = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(() => replyNameFor(ask.text))
  const [say, setSay] = useState(() => ask.text.slice(0, SAY_MAX))
  const [where, setWhere] = useState<ReplyPlace[]>([ask.place])
  const [style, setStyle] = useState<CSSProperties>({ left: -9999, top: -9999, width: W })
  const ok = !!name.trim() && !!say.trim() && where.length > 0

  // 贴着点的地方下面，右边对齐（你发的那句在右边）；下面放不下放上面
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const left = Math.max(8, Math.min(ask.x - W, innerWidth - W - 8))
    let top = ask.y + 6
    if (top + el.offsetHeight > innerHeight - 8) top = Math.max(8, ask.y - el.offsetHeight - 30)
    setStyle({ left, top, width: W })
    nameIn.current?.focus()
    nameIn.current?.select()
  }, [])

  useDismiss(true, [ref], () => onClose())

  async function save() {
    if (!ok) return
    const c = newReplyCmd({ name: name.trim().slice(0, replyNameMax()), say: say.trim(), where })
    onClose()
    const undo = await saveReply(c, 'on')
    app().toast({ text: t('「{name}」排在了这一排最后', { name: c.name }), icon: 'bookmark', undo: () => void undo() })
  }

  return (
    <div
      ref={ref}
      className="sr-card"
      style={style}
      role="dialog"
      aria-label={t('存成快捷回复')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.metaKey) {
          e.preventDefault()
          void save()
        }
      }}
    >
      <b className="sr-h">{t('存成快捷回复')}</b>
      <label className="sr-l">
        {t('名字（排上就写这几个字）')}
        <input ref={nameIn} className="sr-in" value={name} maxLength={replyNameMax()} onChange={(e) => setName(e.currentTarget.value)} />
      </label>
      <label className="sr-l">
        {t('点了替你发的那句')}
        <textarea className="sr-in" value={say} rows={2} onChange={(e) => setSay(e.currentTarget.value.slice(0, SAY_MAX))} />
      </label>
      <div className="sr-l">
        {t('在哪出现')}
        <div className="sr-chips" role="group" aria-label={t('在哪出现')}>
          {REPLY_PLACES.map(([p, n]) => {
            const on = where.includes(p)
            return (
              <button
                key={p}
                type="button"
                className={'sr-chip' + (on ? ' on' : '')}
                aria-pressed={on}
                onClick={() => setWhere(on ? where.filter((x) => x !== p) : REPLY_PLACES.map(([k]) => k).filter((k) => k === p || where.includes(k)))}
              >
                {on && <Codicon name="check" size={13} />}
                {t(n, { ctx: '在哪能用' })}
              </button>
            )
          })}
        </div>
      </div>
      <div className="sr-acts">
        <button type="button" className="sr-btn ghost" onClick={onClose}>
          {t('取消')}
        </button>
        <button type="button" className="sr-btn solid" disabled={!ok} onClick={() => void save()}>
          <Codicon name="check" size={14} />
          {withKeys(t('存好 {k:submit}'))}
        </button>
      </div>
      <div className="sr-foot">{t('存好就排在这一排最后；它也是一条命令，在 设置 › 回答下面那排 里改名、改词、排顺序、删')}</div>
    </div>
  )
}
