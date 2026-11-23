/**
 * 画廊（原型 galHTML）：三列（整页五列，窄了两列、一列），卡片上方是封面，下面名字和「● 学完 · 11月10日」。
 * 封面默认取这篇正文第一张图（coverOf），没图、图打不开就露前几行字（previewOf）；视图写了 image: none 不要封面。
 * 点卡片在右栏打开那一条（props.open → record-open 的 openRecord）。只看不写。
 */
import { type BaseRec, cardColumns, coverOf, previewOf } from '@cn/format'
import { useMemo, useState } from 'react'
import { t } from '../../shared/i18n'
import { embedImageSrc, imageSrc } from '../md-widgets'
import { CardField, INLINE_CARDS, PART, type LayoutPart } from './BaseLayout'

/** 封面图的地址：![[图.png]] 照库里的找法，![](…)、<img src> 相对这一篇 */
function coverSrc(rec: BaseRec): string | null {
  const addr = coverOf(rec.text)
  if (!addr) return null
  return rec.text.includes('![[' + addr) ? embedImageSrc(rec.path, addr) : imageSrc(rec.path, addr)
}

function Cover(props: { rec: BaseRec }) {
  const src = useMemo(() => coverSrc(props.rec), [props.rec.text])
  const [broken, setBroken] = useState<string | null>(null)
  if (src && broken !== src)
    return (
      <div className="bl-gcov img">
        <img src={src} alt="" draggable={false} onError={() => setBroken(src)} />
      </div>
    )
  return (
    <div className="bl-gcov">
      <div className="txt">{previewOf(props.rec.text)}</div>
    </div>
  )
}

export function BaseGallery(props: LayoutPart) {
  const { ctx, res } = props
  const cols = useMemo(() => cardColumns(ctx, props.view, null), [ctx, props.view])
  const cover = res.view.image !== 'none'
  const rows = props.full ? res.rows : res.rows.slice(0, INLINE_CARDS)
  return (
    <div className={'bl-gal' + (props.full ? ' full' : '')} data-part={PART.gal}>
      <div className="bl-galgrid">
        {rows.map((r) => (
          <button key={r.path} type="button" className="bl-gcard" aria-label={r.name} onClick={() => props.open(r.path)}>
            {cover && <Cover rec={r} />}
            <div className="bl-ginfo">
              <div className="n">{r.name}</div>
              {cols.length > 0 && (
                <div className="m">
                  {cols.map((c) => (
                    <CardField key={c} ctx={ctx} rec={r} col={c} plain />
                  ))}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
      {res.rows.length > rows.length && <div className="bl-more">{t('这里只列前{n}张，整页打开看全部', { n: rows.length })}</div>}
    </div>
  )
}
