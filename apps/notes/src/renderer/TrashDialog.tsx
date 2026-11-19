/**
 * 删笔记时这篇的图怎么办（四件事第 1 条，小样 1a）：确认框里一行勾选「连同 N 张图一起移到废纸篓」，默认勾上、记住上次的；
 * 下面等宽字写附件文件夹，右边三张小缩略图；别的笔记也在用的不删（后台查全库，查完灰字说一句）。
 * 一篇、没有跟着它走的图时不弹这个框，直接删（底部能撤回）；文件树里选了好几个一起删时总弹一次（CN-105），标题写「这N个」。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { type AttachItem, TRASH_IMAGES_KEY } from '../shared/attach'
import { titleOf } from '../shared/layout'
import './trash.css'

export interface TrashAsk {
  /** 要删的（一篇时标题写《名字》，好几个时写「选中的N个」） */
  paths: string[]
  /** 这些图在哪几个文件夹（一个时写它，几个时写第一个「等N处」） */
  dirs: string[]
  /** 跟着要删的笔记走的图（自己附件文件夹里的、文中用到的 附件/ 别处的） */
  own: AttachItem[]
  /** 后台查全库：别的笔记也在用的几张（查完才有） */
  shared: Promise<number>
  done(withImages: boolean | null): void
}

export const loadTrashImages = () => {
  try {
    return localStorage.getItem(TRASH_IMAGES_KEY) !== '0'
  } catch {
    return true
  }
}

const imgUrl = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')

export function TrashDialog(props: { ask: TrashAsk }) {
  const { ask } = props
  const [on, setOn] = useState(loadTrashImages)
  const [shared, setShared] = useState<number | null>(null)
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let alive = true
    ask.shared.then((n) => alive && setShared(n), () => alive && setShared(0))
    ok.current?.focus()
    return () => {
      alive = false
    }
  }, [ask])
  const n = ask.own.length - (shared ?? 0)
  const title = ask.paths.length === 1 ? `把《${titleOf(ask.paths[0]!)}》移到废纸篓？` : `把选中的${ask.paths.length}个移到废纸篓？`
  const answer = (v: boolean | null) => {
    if (v !== null) {
      try {
        localStorage.setItem(TRASH_IMAGES_KEY, on ? '1' : '0')
      } catch {
        // 记不住勾选不影响这一次
      }
    }
    ask.done(v === null ? null : on && n > 0)
  }
  return (
    <div className="trash-scrim" onMouseDown={(e) => e.target === e.currentTarget && answer(null)}>
      <div
        className="trash-dlg"
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.preventDefault(), answer(null))
        }}
      >
        <h3>{title}</h3>
        <p className="sub">在废纸篓里能找回，Git里也留着这一版。</p>
        {ask.own.length > 0 && (
          <>
            <label className={'trash-imgs' + (n > 0 ? '' : ' none')}>
              <input type="checkbox" aria-label="连同图一起移到废纸篓" checked={on && n > 0} disabled={n <= 0} onChange={(e) => setOn(e.target.checked)} />
              <span className="tx">
                <span className="t1">{n > 0 ? `连同${n}张图一起移到废纸篓` : `${ask.paths.length === 1 ? '这篇' : '这些'}的图别的笔记都在用，一张不删`}</span>
                <span className="t2">{ask.dirs.length > 1 ? `${ask.dirs[0]}/ 等${ask.dirs.length}处` : `${ask.dirs[0]}/`}</span>
              </span>
              <span className="thumbs">
                {ask.own.slice(0, 3).map((i) => (
                  <img key={i.path} src={imgUrl(i.path)} alt="" />
                ))}
              </span>
            </label>
            <p className="note" data-testid="trash-note">
              {shared === null ? '正在查别的笔记有没有也在用这些图…' : shared > 0 ? `别的笔记也在用的${shared}张不会一起删。` : '别的笔记也在用的图不会一起删。'}
              勾不勾下次照这次。
            </p>
          </>
        )}
        <div className="act">
          <button className="btn btn-sm" onClick={() => answer(null)}>
            取消
          </button>
          <button className="btn btn-primary btn-sm" ref={ok} onClick={() => answer(true)}>
            <Codicon name="trash" size={14} />
            移到废纸篓
          </button>
        </div>
      </div>
    </div>
  )
}
