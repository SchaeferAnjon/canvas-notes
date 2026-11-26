/**
 * 装饰抽屉（设计页 145 proto-3 图，iPad 笔盘「装饰」、Mac 左边工具板「装饰」点开的同一个）：便签 / 胶带 / 贴纸三页 + 收起；
 * 按住一样拖到白板上放（拖的过程在 layer.tsx）。贴纸页分学习 / 标签 / 心情三套，右上「从照片…」选一张图（透明的放成贴纸）。
 * 盖在白板底部正中，不占宽。
 */
import { type NoteColor, STICKER_PACKS, TAPE_PATTERNS } from '@cn/format'
import { useRef, useState } from 'react'
import { useT } from '../../i18n'
import { PACK_NAMES, PAPER_NAMES, PAPERS, STICKER_NAMES, TAPE_NAMES, tapeSVG } from './art'
import { stickerData } from './sticker-svg'

export type DrawerTab = 'note' | 'tape' | 'sticker'
export type DrawerItem = { kind: 'note'; v: NoteColor } | { kind: 'tape'; v: string } | { kind: 'sticker'; v: string }

export function DecorDrawer(props: { tab: DrawerTab; onTab(t: DrawerTab): void; onClose(): void; onGrab(e: React.MouseEvent, it: DrawerItem): void; onPhoto(f: File): void }) {
  const t = useT()
  const [pack, setPack] = useState<keyof typeof STICKER_PACKS>('study')
  const file = useRef<HTMLInputElement>(null)
  const tabs: [DrawerTab, string][] = [
    ['note', t('便签')],
    ['tape', t('胶带')],
    ['sticker', t('贴纸')],
  ]
  return (
    <div className="dc-drawer" role="dialog" aria-label={t('装饰')} data-testid="decor-drawer" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="dw-top">
        <div className="dc-seg big" role="tablist" aria-label={t('装饰')}>
          {tabs.map(([k, n]) => (
            <button key={k} type="button" role="tab" aria-selected={props.tab === k} className={props.tab === k ? 'on' : ''} data-tab={k} onClick={() => props.onTab(k)}>
              {n}
            </button>
          ))}
        </div>
        <button type="button" className="dw-x" onClick={props.onClose}>
          {t('收起')}
        </button>
      </div>
      {props.tab === 'note' && (
        <div className="dw-notes">
          {PAPERS.map((c, i) => (
            <div key={c} className="dw-item" data-kind="note" data-v={c} role="button" aria-label={t('便签 · {name}', { name: t(PAPER_NAMES[c]) })} onMouseDown={(e) => props.onGrab(e, { kind: 'note', v: c })}>
              <div className="dw-note dc-note" data-note={c} style={{ '--rot': `${[-3, 2, -1.5, 3, -2.5, 1.5][i]}deg` } as React.CSSProperties}>
                <div className="sn-sh" />
                <div className="sn">
                  <div className="sn-tex" />
                </div>
                <div className="sn-curl" />
              </div>
              <span>{t(PAPER_NAMES[c])}</span>
            </div>
          ))}
        </div>
      )}
      {props.tab === 'tape' && (
        <>
          <div className="dw-tapes">
            {TAPE_PATTERNS.map((p, i) => (
              <div key={p} className="dw-item" data-kind="tape" data-v={p} role="button" aria-label={t('胶带 · {name}', { name: t(TAPE_NAMES[p]) })} onMouseDown={(e) => props.onGrab(e, { kind: 'tape', v: p })}>
                <div className="dw-roll" dangerouslySetInnerHTML={{ __html: tapeSVG(p, 92, i + 1) }} />
                <span>{t(TAPE_NAMES[p])}</span>
              </div>
            ))}
          </div>
          <div className="dw-tip">{t('拖到卡片的角或边上会吸住；放在空白处就钉在白板上')}</div>
        </>
      )}
      {props.tab === 'sticker' && (
        <>
          <div className="dw-packs">
            {(Object.keys(STICKER_PACKS) as (keyof typeof STICKER_PACKS)[]).map((k) => (
              <button key={k} type="button" className={pack === k ? 'on' : ''} aria-pressed={pack === k} data-pack={k} onClick={() => setPack(k)}>
                {t(PACK_NAMES[k])}
              </button>
            ))}
            <span className="sp" />
            <button type="button" data-act="photo" data-tip={t('选一张图：透明的 PNG / WebP 放成贴纸，别的放成图片卡')} data-side="above" onClick={() => file.current?.click()}>
              {t('从照片…')}
            </button>
            <input
              ref={file}
              type="file"
              accept="image/png,image/webp,image/jpeg,image/gif"
              hidden
              data-testid="decor-photo-input"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0]
                e.currentTarget.value = ''
                if (f) props.onPhoto(f)
              }}
            />
          </div>
          <div className="dw-stk">
            {STICKER_PACKS[pack].map((k) => (
              <div key={k} className="dw-item" data-kind="sticker" data-v={k} role="button" aria-label={t(STICKER_NAMES[k] ?? k)} data-tip={t(STICKER_NAMES[k] ?? k)} data-side="above" onMouseDown={(e) => props.onGrab(e, { kind: 'sticker', v: k })}>
                <div className={'stk-i' + (pack === 'label' ? ' wide' : '')}>
                  <img src={stickerData(k)} alt="" draggable={false} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
