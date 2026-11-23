/**
 * 什么都没选时点「费曼学习」：一个小框（设计页第 4 节 41 图的「一个知识点」那一格）——直接写一个词，或从这块白板上挑一样
 * （导图第一层的一支、一列、一张卡、一份 PDF）。先选了东西再点就直接开始，不出这个框。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { composing } from '../ime'
import { useDismiss } from '../use-dismiss'

export interface PickItem {
  key: string
  label: string
  icon: CodiconName
  start(): void
}

export function StartPop(props: { at: { x: number; y: number }; items: PickItem[]; onWord(word: string): void; onClose(): void }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [v, setV] = useState('')
  useDismiss(true, [box], props.onClose)
  useEffect(() => {
    box.current?.querySelector('input')?.focus()
  }, [])
  const go = () => {
    const w = v.trim()
    if (!w) return
    props.onClose()
    props.onWord(w)
  }
  const left = Math.min(props.at.x, window.innerWidth - 320)
  const top = Math.max(8, Math.min(props.at.y, window.innerHeight - 380))
  return createPortal(
    <div className="fy-pop" ref={box} role="dialog" aria-label={t('费曼学习 · 讲哪个点')} data-testid="fy-start" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="t">
        <Codicon name="mortar-board" size={14} />
        {t('费曼学习 · 讲哪个点')}
      </div>
      <div className="grs">
        <div className="gr one">
          <span className="gx">
            <b>{t('一个知识点 · 3到5分钟')}</b>
            <span>{t('先点导图的一支或框选几张卡，再点这里；也能直接写：')}</span>
            <input
              value={v}
              aria-label={t('直接写一个词')}
              placeholder={t('直接写一个词，比如：范数')}
              onChange={(e) => setV(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (composing(e)) return
                if (e.key === 'Enter') (e.preventDefault(), go())
                if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), props.onClose())
              }}
            />
            {props.items.length > 0 && (
              <>
                <span className="or">{t('或者从这块白板上挑：')}</span>
                <span className="from" data-testid="fy-start-items">
                  {props.items.map((it) => (
                    <button key={it.key} type="button" onClick={() => (props.onClose(), it.start())}>
                      <Codicon name={it.icon} size={13} />
                      <span>{it.label}</span>
                    </button>
                  ))}
                </span>
              </>
            )}
          </span>
        </div>
      </div>
      <div className="row">
        <span className="sp" style={{ flex: 1 }} />
        <button type="button" className="fy-btn solid" data-testid="fy-start-go" disabled={!v.trim()} onClick={go}>
          {t('开始讲')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
