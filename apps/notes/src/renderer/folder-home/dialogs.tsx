/**
 * 方向 B 的两个大窗口：加组件（860 × 600，一个能滚的列表，按「这门课的 / 通用 / 按条件列出」分组，CN-103）
 * 和按条件列出（900 × 600，左边条件、右边真尺寸预览）。
 */
import { Codicon } from '@cn/design'
import { type ReactNode, useEffect, useState } from 'react'
import { type Cond, COND_OPS, COND_PRESETS, type CondProp, type FolderHome, type FolderKind, type FWidget, FWIDGETS } from '../../shared/folder-home'
import { widgetIcon } from './icons'
import { useT } from '../i18n'

/** 组件库的组（CN-103）：组名后面是几个、一条细线；「这门课的」只在课程页，「课程这一页的」只在「课程」这个分类的首页 */
// 不翻：键，画的地方翻
const GROUPS = [
  ['courses', '课程这一页的'], // 不翻
  ['course', '这门课的'], // 不翻
  ['common', '通用'], // 不翻
  ['cond', '按条件列出'], // 不翻
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
  const t = useT()
  const [q, setQ] = useState('')
  useEsc(props.onClose)
  const on = new Set(props.home.order.map((id) => props.home.widgets[id]!.type))
  const hit = (s: string) => !q || s.includes(q)
  const row = (key: string, icon: FWidget, name: string, desc: string, added: boolean, add: () => void, testid?: string) => (
    <div key={key} className="lw" data-testid={testid}>
      <span className="ic">
        <Codicon name={widgetIcon(icon)} size={16} />
      </span>
      <span className="tx">
        <b>{name}</b>
        <span>{desc}</span>
      </span>
      {added ? (
        <em>{t('已在页面上')}</em>
      ) : (
        <button className="add" aria-label={t('加上 {name}', { name })} onClick={add}>
          <Codicon name="add" size={12} />
          {t('加上')}
        </button>
      )}
    </div>
  )
  const groups = GROUPS.filter(([k]) => (k === 'course' ? props.kind === 'course' : k === 'courses' ? props.kind === 'courses' : true)).map(([k, title]) => {
    // 找：中文原名、界面语言的名字都认
    const rows = FWIDGETS.filter((w) => w.cat === k && (hit(w.name + w.desc) || hit(t(w.name)) || hit(t(w.desc)))).map((w) =>
      row(w.type, w.type, t(w.name), t(w.desc), on.has(w.type) && w.type !== 'list', () => props.onAdd(w.type), `lib-${w.type}`),
    )
    // 按条件列出的预设跟在「按条件列出」后面；不翻：找的时候中文原名也认
    if (k === 'cond') for (const c of COND_PRESETS) if (hit(c.name + '预设') || hit(t(c.name)) || hit(t('预设'))) rows.push(row('preset:' + c.name, 'list', t(c.name), t('预设'), false, () => props.onAdd('list', c)))
    return { k, title, rows }
  })
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  return (
    <div className="fh-scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="fh-win lib" role="dialog" aria-label={t('加组件')}>
        <div className="hd">
          <h3>{t('加组件')}</h3>
          <span className="sub">{t('给「{name}」首页', { name: props.title })}</span>
          <span className="sp" />
          <label className="find">
            <Codicon name="search" size={14} />
            <input aria-label={t('找组件')} placeholder={t('找组件')} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button className="iconbtn" aria-label={t('关闭')} onClick={props.onClose}>
            <Codicon name="close" size={16} />
          </button>
        </div>
        <div className="bd lib-list">
          {groups
            .filter((g) => g.rows.length)
            .map((g) => (
              <section key={g.k} className="lg" role="group" aria-label={t(g.title)}>
                <div className="gh">
                  <span className="num">{t('{name}{n}', { name: t(g.title), n: g.rows.length })}</span>
                  <span className="ln" />
                </div>
                <div className="rows">{g.rows}</div>
              </section>
            ))}
          {total === 0 && <p className="none">{t('没有叫「{q}」的组件', { q })}</p>}
        </div>
        <div className="ft">
          <span className="help">{t('加上的组件放在最后，闪一下；删掉组件不删任何文件。')}</span>
          <button className="btn" onClick={props.onClose}>
            {t('完成')}
          </button>
        </div>
      </div>
    </div>
  )
}

// 不翻：存进 .首页.json、拿来比的原值，画的地方翻
const VALUES: Partial<Record<CondProp, string[]>> = { 改过: ['今天', '这周', '这个月'], 草稿: ['是', '否'] }

export function CondEditor(props: { initial: Cond; found(c: Cond): number; preview(c: Cond): ReactNode; onCancel(): void; onSave(c: Cond): void }) {
  const t = useT()
  // 名字框里和组件头上一样：还是默认名字（中文原句，存在 .首页.json 里）时显示翻过的；改过的名字 t 找不到，原样
  const [c, setC] = useState<Cond>(() => ({ ...props.initial, name: t(props.initial.name) }))
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
      <div className="fh-win cond" role="dialog" aria-label={t('按条件列出')}>
        <div className="hd">
          <h3>{t('按条件列出')}</h3>
          <span className="sub">{t('像Notion的数据库视图，只是一页看法，不改文件')}</span>
          <span className="sp" />
          <button className="iconbtn" aria-label={t('关闭')} onClick={props.onCancel}>
            <Codicon name="close" size={16} />
          </button>
        </div>
        <div className="bd">
          <div className="form">
            <div className="cf-field">
              <label htmlFor="fh-cond-name">{t('名字')}</label>
              <input id="fh-cond-name" className="wide" aria-label={t('名字')} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            </div>
            <div className="cf-field">
              <label>{t('从哪里找')}</label>
              {seg(c.scope, [['folder', t('这个文件夹'), t('这个文件夹')], ['vault', t('整个库'), t('整个库')]], (v) => setC({ ...c, scope: v }), t('从哪里找'))}
            </div>
            <div className="cf-field">
              <label>
                {t('条件', { ctx: '按条件列出' })}
                {seg(c.all ? 'all' : 'any', [['all', t('全部满足'), t('全部满足')], ['any', t('满足任一'), t('满足任一')]], (v) => setC({ ...c, all: v === 'all' }), t('条件怎么算'), 'sm')}
              </label>
              {c.rules.map((r, i) => (
                <div key={i} className="rule">
                  <select aria-label={t('属性')} value={r.prop} onChange={(e) => rule(i, { prop: e.target.value as CondProp, op: COND_OPS[e.target.value as CondProp][0]!, value: VALUES[e.target.value as CondProp]?.[0] ?? '' })}>
                    {/* 选项的值是存进文件、拿来比的原值，显示的字翻 */}
                    {Object.keys(COND_OPS).map((p) => (
                      <option key={p} value={p}>
                        {t(p)}
                      </option>
                    ))}
                  </select>
                  <select aria-label={t('比较')} className="op" value={r.op} onChange={(e) => rule(i, { op: e.target.value })}>
                    {COND_OPS[r.prop].map((o) => (
                      <option key={o} value={o}>
                        {t(o, { ctx: '条件' })}
                      </option>
                    ))}
                  </select>
                  {VALUES[r.prop] ? (
                    <select aria-label={t('值')} className="val" value={r.value} onChange={(e) => rule(i, { value: e.target.value })}>
                      {VALUES[r.prop]!.map((o) => (
                        <option key={o} value={o}>
                          {t(o)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    // 不翻：属性键和例子里的属性值照文件里的写
                    <input aria-label={t('值')} className="val" value={r.value} placeholder={r.prop === '类型' ? '笔记, 导图' : ''} onChange={(e) => rule(i, { value: e.target.value })} />
                  )}
                  <button className="iconbtn sm" aria-label={t('删掉这条')} onClick={() => setC({ ...c, rules: c.rules.filter((_, j) => j !== i) })}>
                    <Codicon name="close" size={12} />
                  </button>
                </div>
              ))}
              {/* 不翻：新加一条的属性键、比较是存进文件的原值 */}
              <button className="btn btn-ghost btn-sm add" onClick={() => setC({ ...c, rules: [...c.rules, { prop: '类型', op: '是其中', value: '' }] })}>
                <Codicon name="add" size={12} />
                {t('加条件')}
              </button>
            </div>
            <div className="cf-field">
              <label>{t('排序')}</label>
              <div className="rule two">
                <select aria-label={t('按什么排')} value={c.sort.prop} onChange={(e) => setC({ ...c, sort: { ...c.sort, prop: e.target.value as Cond['sort']['prop'] } })}>
                  {/* 不翻：value 是存进文件的原值 */}
                  <option value="第几讲">{t('第几讲')}</option>
                  {/* 不翻：value 是存进文件的原值 */}
                  <option value="改过">{t('改过')}</option>
                  {/* 不翻：value 是存进文件的原值 */}
                  <option value="名字">{t('名字')}</option>
                </select>
                <select aria-label={t('方向')} value={c.sort.dir} onChange={(e) => setC({ ...c, sort: { ...c.sort, dir: e.target.value as 'asc' | 'desc' } })}>
                  {/* 不翻：比的是存进文件的「改过」 */}
                  <option value="desc">{c.sort.prop === '改过' ? t('新的在前') : t('从大到小')}</option>
                  {/* 不翻：比的是存进文件的「改过」 */}
                  <option value="asc">{c.sort.prop === '改过' ? t('旧的在前') : t('从小到大')}</option>
                </select>
              </div>
            </div>
            <div className="cf-field">
              <label>{t('显示成')}</label>
              <div className="row">
                {seg(
                  c.view,
                  [
                    ['list', <><Codicon name="list-unordered" size={12} />{t('列表')}</>, t('列表')],
                    ['cards', <><Codicon name="layout" size={12} />{t('卡片墙')}</>, t('卡片墙')],
                    ['table', <><Codicon name="table" size={12} />{t('表格')}</>, t('表格')],
                  ],
                  (v) => setC({ ...c, view: v }),
                  t('显示成'),
                )}
                <span className="k">{t('最多', { ctx: '最多几条' })}</span>
                <input aria-label={t('最多几条')} className="lim num" type="number" min={1} max={50} value={c.limit} onChange={(e) => setC({ ...c, limit: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
                <span className="k">{t('条', { ctx: '最多几条' })}</span>
              </div>
            </div>
          </div>
          <div className="pvw">
            <div className="k" data-testid="cond-found">{t('预览 · 找到{n}个', { n: props.found(c) })}</div>
            {props.preview(c)}
          </div>
        </div>
        <div className="ft">
          {/* 不翻：.首页.json 是磁盘上的文件名 */}
          <span className="help">{t('条件存在这个文件夹的 {file}里，跟着Git走。', { file: '.首页.json' })}</span>
          <button className="btn" onClick={props.onCancel}>
            {t('取消')}
          </button>
          <button className="btn btn-primary" onClick={() => props.onSave(c.name === t(props.initial.name) ? { ...c, name: props.initial.name } : c)}>
            {t('放到首页')}
          </button>
        </div>
      </div>
    </div>
  )
}
