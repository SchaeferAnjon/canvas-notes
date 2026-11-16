/**
 * 方向 B 的两个大窗口：加组件（860 × 600，左边分类、右边三列卡片）和按条件列出（900 × 600，左边条件、右边真尺寸预览）。
 */
import { Codicon } from '@cn/design'
import { type ReactNode, useEffect, useState } from 'react'
import { type Cond, COND_OPS, COND_PRESETS, type CondProp, type FolderHome, type FolderKind, type FWidget, FWIDGETS } from '../../shared/folder-home'
import { widgetIcon } from './icons'

const CATS = [
  ['course', '课程'],
  ['common', '通用'],
  ['cond', '按条件列出'],
  ['all', '全部'],
] as const

/** esc 关掉 */
function useEsc(close: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [close])
}

export function WidgetLibrary(props: { title: string; home: FolderHome; kind: FolderKind; onAdd(type: FWidget, cond?: Cond): void; onClose(): void }) {
  const [cat, setCat] = useState<(typeof CATS)[number][0]>(props.kind === 'course' ? 'course' : 'common')
  const [q, setQ] = useState('')
  useEsc(props.onClose)
  const on = new Set(props.home.order.map((id) => props.home.widgets[id]!.type))
  const items = FWIDGETS.filter((w) => (props.kind === 'course' || w.cat !== 'course') && (cat === 'all' || w.cat === cat) && (!q || (w.name + w.desc).includes(q)))
  const presets = cat === 'cond' || cat === 'all' ? COND_PRESETS.filter((c) => !q || c.name.includes(q)) : []
  return (
    <div className="fh-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="fh-win lib" role="dialog" aria-label="加组件">
        <div className="hd">
          <h3>加组件</h3>
          <span className="sub">给「{props.title}」首页</span>
          <span className="sp" />
          <label className="find">
            <Codicon name="search" size={14} />
            <input aria-label="找组件" placeholder="找组件" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button className="iconbtn" aria-label="关闭" onClick={props.onClose}>
            <Codicon name="close" size={16} />
          </button>
        </div>
        <div className="bd">
          <nav aria-label="分类">
            {CATS.filter(([k]) => props.kind === 'course' || k !== 'course').map(([k, n]) => (
              <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>
                {n}
              </button>
            ))}
          </nav>
          <div className="cards">
            {items.map((w) => (
              <div key={w.type} className="card" data-testid={`lib-${w.type}`}>
                <div className="pv">
                  <Codicon name={widgetIcon(w.type)} size={18} />
                </div>
                <div className="tx">
                  <b>{w.name}</b>
                  <span>{w.desc}</span>
                </div>
                <div className="ac">
                  {on.has(w.type) && w.type !== 'list' ? (
                    <em>已在页面上</em>
                  ) : (
                    <button className="btn btn-sm" onClick={() => props.onAdd(w.type)}>
                      <Codicon name="add" size={12} />
                      加上
                    </button>
                  )}
                </div>
              </div>
            ))}
            {presets.map((c) => (
              <div key={c.name} className="card">
                <div className="pv">
                  <Codicon name={widgetIcon('list')} size={18} />
                </div>
                <div className="tx">
                  <b>{c.name}</b>
                  <span>按条件列出的预设</span>
                </div>
                <div className="ac">
                  <button className="btn btn-sm" aria-label={`加上 ${c.name}`} onClick={() => props.onAdd('list', c)}>
                    <Codicon name="add" size={12} />
                    加上
                  </button>
                </div>
              </div>
            ))}
            {items.length + presets.length === 0 && <p className="none">没有叫「{q}」的组件</p>}
          </div>
        </div>
        <div className="ft">
          <span className="help">加上的组件放在最后，闪一下；删掉组件不删任何文件。</span>
          <button className="btn" onClick={props.onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

const VALUES: Partial<Record<CondProp, string[]>> = { 改过: ['今天', '这周', '这个月'], 草稿: ['是', '否'] }

export function CondEditor(props: { initial: Cond; found(c: Cond): number; preview(c: Cond): ReactNode; onCancel(): void; onSave(c: Cond): void }) {
  const [c, setC] = useState<Cond>(props.initial)
  useEsc(props.onCancel)
  const rule = (i: number, patch: Partial<Cond['rules'][number]>) => setC({ ...c, rules: c.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const seg = <T extends string>(val: T, opts: [T, ReactNode, string][], set: (v: T) => void, label: string, cls = '') => (
    <div className={'seg ' + cls} role="radiogroup" aria-label={label}>
      {opts.map(([k, n, name]) => (
        <button key={k} role="radio" aria-checked={val === k} aria-label={name} className={val === k ? 'on' : ''} onClick={() => set(k)}>
          {n}
        </button>
      ))}
    </div>
  )
  return (
    <div className="fh-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div className="fh-win cond" role="dialog" aria-label="按条件列出">
        <div className="hd">
          <h3>按条件列出</h3>
          <span className="sub">像 Notion 的数据库视图，只是一页看法，不改文件</span>
          <span className="sp" />
          <button className="iconbtn" aria-label="关闭" onClick={props.onCancel}>
            <Codicon name="close" size={16} />
          </button>
        </div>
        <div className="bd">
          <div className="form">
            <div className="cf-field">
              <label htmlFor="fh-cond-name">名字</label>
              <input id="fh-cond-name" className="wide" aria-label="名字" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            </div>
            <div className="cf-field">
              <label>从哪里找</label>
              {seg(c.scope, [['folder', '这个文件夹', '这个文件夹'], ['vault', '整个库', '整个库']], (v) => setC({ ...c, scope: v }), '从哪里找')}
            </div>
            <div className="cf-field">
              <label>
                条件
                {seg(c.all ? 'all' : 'any', [['all', '全部满足', '全部满足'], ['any', '满足任一', '满足任一']], (v) => setC({ ...c, all: v === 'all' }), '条件怎么算', 'sm')}
              </label>
              {c.rules.map((r, i) => (
                <div key={i} className="rule">
                  <select aria-label="属性" value={r.prop} onChange={(e) => rule(i, { prop: e.target.value as CondProp, op: COND_OPS[e.target.value as CondProp][0]!, value: VALUES[e.target.value as CondProp]?.[0] ?? '' })}>
                    {Object.keys(COND_OPS).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  <select aria-label="比较" className="op" value={r.op} onChange={(e) => rule(i, { op: e.target.value })}>
                    {COND_OPS[r.prop].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  {VALUES[r.prop] ? (
                    <select aria-label="值" className="val" value={r.value} onChange={(e) => rule(i, { value: e.target.value })}>
                      {VALUES[r.prop]!.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input aria-label="值" className="val" value={r.value} placeholder={r.prop === '类型' ? '笔记, 导图' : ''} onChange={(e) => rule(i, { value: e.target.value })} />
                  )}
                  <button className="iconbtn sm" aria-label="删掉这条" onClick={() => setC({ ...c, rules: c.rules.filter((_, j) => j !== i) })}>
                    <Codicon name="close" size={12} />
                  </button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm add" onClick={() => setC({ ...c, rules: [...c.rules, { prop: '类型', op: '是其中', value: '' }] })}>
                <Codicon name="add" size={12} />
                加条件
              </button>
            </div>
            <div className="cf-field">
              <label>排序</label>
              <div className="rule two">
                <select aria-label="按什么排" value={c.sort.prop} onChange={(e) => setC({ ...c, sort: { ...c.sort, prop: e.target.value as Cond['sort']['prop'] } })}>
                  <option>第几讲</option>
                  <option>改过</option>
                  <option>名字</option>
                </select>
                <select aria-label="方向" value={c.sort.dir} onChange={(e) => setC({ ...c, sort: { ...c.sort, dir: e.target.value as 'asc' | 'desc' } })}>
                  <option value="desc">{c.sort.prop === '改过' ? '新的在前' : '从大到小'}</option>
                  <option value="asc">{c.sort.prop === '改过' ? '旧的在前' : '从小到大'}</option>
                </select>
              </div>
            </div>
            <div className="cf-field">
              <label>显示成</label>
              <div className="row">
                {seg(
                  c.view,
                  [
                    ['list', <><Codicon name="list-unordered" size={12} />列表</>, '列表'],
                    ['cards', <><Codicon name="layout" size={12} />卡片墙</>, '卡片墙'],
                    ['table', <><Codicon name="table" size={12} />表格</>, '表格'],
                  ],
                  (v) => setC({ ...c, view: v }),
                  '显示成',
                )}
                <span className="k">最多</span>
                <input aria-label="最多几条" className="lim num" type="number" min={1} max={50} value={c.limit} onChange={(e) => setC({ ...c, limit: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
                <span className="k">条</span>
              </div>
            </div>
          </div>
          <div className="pvw">
            <div className="k" data-testid="cond-found">预览 · 找到 {props.found(c)} 个</div>
            {props.preview(c)}
          </div>
        </div>
        <div className="ft">
          <span className="help">条件存在这个文件夹的 .首页.json 里，跟着 Git 走。</span>
          <button className="btn" onClick={props.onCancel}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => props.onSave(c)}>
            放到首页
          </button>
        </div>
      </div>
    </div>
  )
}
