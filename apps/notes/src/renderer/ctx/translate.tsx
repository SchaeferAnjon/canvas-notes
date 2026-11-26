/**
 * 右键「翻译这段」：用双语翻译同一套引擎、缓存；译文出在右键的地方，一个小弹层（弹层的样子同块菜单：--pop、圆角 12），
 * 带「拷贝」。点别处、按 Esc、点 × 收起。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { useRef } from 'react'
import { errorTitle } from '../../shared/plugins/translate'
import { Popover } from '../editor-host'
import { translateBlocks } from '../plugins/translate/api'
import { copy } from './menu'
import './ctx.css'

let pop: Popover | null = null
let seq = 0

function hide() {
  pop?.hide()
}

function Card(props: { text: string | null; error?: string; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, [ref], () => props.onClose())
  return (
    <div className="tr-pop" role="dialog" aria-label="译文" ref={ref}>
      <div className="tr-pop-hd">
        <Codicon name="whole-word" size={14} />
        <span>译文</span>
        <button className="iconbtn" aria-label="关上译文" onClick={props.onClose}>
          <Codicon name="close" size={14} />
        </button>
      </div>
      {props.text === null ? <p className={'tr-pop-text' + (props.error ? ' err' : ' wait')}>{props.error ?? '正在翻译…'}</p> : <p className="tr-pop-text">{props.text}</p>}
      {props.text !== null && (
        <div className="tr-pop-acts">
          <button className="btn btn-sm" onClick={() => void copy(props.text!).then(props.onClose)}>
            <Codicon name="copy" size={13} />
            拷贝
          </button>
        </div>
      )}
    </div>
  )
}

/** at：右键的地方（界面坐标） */
export async function translateAt(text: string, at: { x: number; y: number }): Promise<void> {
  const src = text.trim().slice(0, 4000)
  if (!src) return
  pop ??= new Popover('tr-pop-host')
  const mine = ++seq
  const anchor = { left: at.x, top: at.y, bottom: at.y }
  const show = (t: string | null, error?: string) => mine === seq && pop!.show(<Card text={t} error={error} onClose={hide} />, anchor)
  show(null)
  let out: string | null = null
  let err = ''
  await translateBlocks([{ id: 'ctx', text: src }], {}, (r) => {
    out = r.text
    if (r.error) err = errorTitle(r.error)
  }).done
  if (!pop.open) return
  const got = out as string | null
  if (got === null) show(null, err ? `没翻成：${err}` : '没翻成')
  else show(got)
}
