/**
 * 看板（原型 kanbanHTML）：按状态（或别的单选 / 多选 / 勾选列）分列，每个选项一列，组头小圆点 + 名字 + 条数；
 * 卡片上是名字和下面一行（日期、进度、做完几题，cardColumns 定）；拖卡到别的列改那一篇的分组那一行（BaseLayout 写），
 * 落点那一列淡强调色底加一圈（@cn/calendar 的 .cal-over）；同一列里上下拖不记顺序。每列底「+ 新建」建一篇带上这一列的值，名字就地起。
 * 文档里窄了按列横滑、右边渐隐（fadeEdges）。
 */
import { Codicon } from '@cn/design'
import { cardColumns, colTypeOf, setProp } from '@cn/format'
import { useEffect, useMemo, useState } from 'react'
import { t, tv } from '../../shared/i18n'
import { groupWords } from './words'
import { nameNotice, safeName } from '../../shared/file-name'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { composing } from '../ime'
import { fadeEdges } from '../tex'
import { nameFromTitle } from '../title-follow'
import { baseWrote } from './BaseTable'
import { CardField, INLINE_COLUMN, PART, type LayoutPart, toneColor } from './BaseLayout'

export function BaseKanban(props: LayoutPart) {
  const { ctx, res } = props
  const prop = res.groupProp
  const cols = useMemo(() => cardColumns(ctx, props.view, prop), [ctx, props.view, prop])
  /** 刚在某一列「+ 新建」的那一篇：卡片上直接起名 */
  const [naming, setNaming] = useState<string | null>(null)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  useEffect(() => (scroller ? fadeEdges(scroller) : undefined), [scroller])

  if (!prop || !res.groups) return <div className="bl-empty">{t('这个数据库没有状态或选项列：加一列状态，看板就按它分列')}</div>

  // 空的「没填」那一组：有卡才露（同 Notion）
  const groups = res.groups.map((g, i) => ({ g, i })).filter(({ g }) => g.key !== '' || g.rows.length > 0)

  const add = async (value: string) => {
    const folder = ctx.doc.folder
    if (!folder) return
    const type = colTypeOf(ctx, prop)
    const text =
      value === ''
        ? ''
        : setProp('', prop, type === 'multi' ? `[${value}]` : value, {
            raw: type === 'multi',
          })
    const p = await window.cn.createNote(folder, tv('未命名'), text)
    setNaming(p)
    // 软件自己建的文件不来「外面改了」的通知：叫一声，这一块（和别处画着的同一个数据库）重读
    baseWrote(folder)
  }

  const rename = async (path: string, name: string) => {
    setNaming(null)
    const old = titleOf(path)
    if (!name || name === old) return
    try {
      const file = nameFromTitle(name)
      const to = await window.cn.renameNote(path, file, true)
      // 不翻：nameNotice 自己的量词，它说的话还没抽
      const said = nameNotice(name, titleOf(to), '条', safeName(file))
      if (said) app().notice(said)
      baseWrote(ctx.doc.folder)
    } catch (e) {
      app().notice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <div className="bl-kb" ref={setScroller} data-part={PART.kb}>
      {groups.map(({ g, i }) => {
        const rows = props.full ? g.rows : g.rows.slice(0, INLINE_COLUMN)
        return (
          <div key={g.key} className="bl-kcol" data-drop={`${props.id}k:${i}`} data-part={PART.col} aria-label={g.label}>
            <div className="bl-khead">
              <i className="bl-dot" style={{ background: toneColor(ctx, prop, g.key) }} />
              <span className="nm">{groupWords(g, prop ? colTypeOf(ctx, prop) : 'text')}</span>
              <span className="c">{g.rows.length}</span>
            </div>
            {rows.map((r) =>
              r.path === naming ? (
                <div key={r.path} className="bl-kcard naming">
                  <input
                    className="bl-name"
                    autoFocus
                    defaultValue={r.name}
                    aria-label={t('新的一条叫什么')}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (composing(e)) return
                      if (e.key === 'Enter') void rename(r.path, e.currentTarget.value.trim())
                      if (e.key === 'Escape') setNaming(null)
                    }}
                    onBlur={(e) => naming === r.path && void rename(r.path, e.currentTarget.value.trim())}
                  />
                </div>
              ) : (
                <div key={r.path} className="bl-kcard" data-drag={props.keyOf(r.path)} role="button" aria-label={r.name}>
                  <div className="n">{r.name}</div>
                  {cols.length > 0 && (
                    <div className="m">
                      {cols.map((c) => (
                        <CardField key={c} ctx={ctx} rec={r} col={c} />
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {g.rows.length > rows.length && (
              <div className="bl-more">
                {t('还有{n}张，整页打开看全部', {
                  n: g.rows.length - rows.length,
                })}
              </div>
            )}
            <button type="button" className="bl-knew" onClick={() => void add(g.key)}>
              <Codicon name="add" size={14} />
              {t('新建')}
            </button>
          </div>
        )
      })}
    </div>
  )
}
