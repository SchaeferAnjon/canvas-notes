/**
 * ⌘K「加一条自己的命令…」（DESIGN.v3 3.2）：面板原地变成表单。做什么（打开一处 / 打开网址 / 让AI做一件事）、打开哪里或网址、名字、放进哪组、别名。
 * 「让AI做一件事」不在这里填（task-9womr）：选它就关上 ⌘K，开「存成命令」那张表从头写规矩（commands/SaveCmd.tsx），存成 kind: ai。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OwnCommand } from '../../shared/commands'
import { AiIcon } from '../engine-logo'
import { recentFiles, useVaultFiles } from '../files/store'
import { useT } from '../i18n'
import { catName } from '../../shared/categories'

export interface FormValue {
  kind: 'open' | 'url'
  name: string
  target: string
  group: string
  alias: string
}

const KINDS = [
  { id: 'open', icon: 'folder-opened' },
  { id: 'url', icon: 'globe' },
] as const

const lastPart = (p: string) => p.split('/').pop() ?? p

export function CmdForm(props: { edit: OwnCommand | null; group: string; alias: string; groups: { id: string; name: string }[]; onDone(v: FormValue): void; onBack(): void; onAi(): void }) {
  const t = useT()
  const e = props.edit
  const [v, setV] = useState<FormValue>({ kind: e?.kind === 'url' ? 'url' : 'open', name: e?.name ?? '', target: e?.target ?? '', group: props.group, alias: props.alias })
  const [err, setErr] = useState('')
  const files = useVaultFiles().files
  const box = useRef<HTMLDivElement>(null)
  // 建议：最近开过的文件所在的文件夹，再是最外层的文件夹；最多 4 个
  const sugg = useMemo(() => {
    // 不翻：附件是磁盘上的文件夹名
    const dirs = new Set(files.filter((f) => f.kind === 'dir' && f.path !== '附件' && !f.path.startsWith('附件/')).map((f) => f.path))
    const out: string[] = []
    for (const p of recentFiles()) {
      const d = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
      if (d && dirs.has(d) && !out.includes(d)) out.push(d)
    }
    for (const d of [...dirs].filter((d) => !d.includes('/')).sort((a, b) => a.localeCompare(b, 'zh'))) if (!out.includes(d)) out.push(d)
    return out.slice(0, 4)
  }, [files])
  useEffect(() => box.current?.querySelector<HTMLInputElement>('input[name=target]')?.focus(), [v.kind])

  const set = (p: Partial<FormValue>) => (setV((x) => ({ ...x, ...p })), setErr(''))
  function done() {
    const target = v.target.trim()
    if (!target) return setErr(v.kind === 'open' ? t('先填打开哪里') : t('先填网址'))
    if (v.kind === 'open') {
      const path = target.replace(/^\/+|\/+$/g, '')
      if (!files.some((f) => f.path === path && f.kind !== 'img' && f.kind !== 'att')) return setErr(t('库里没有「{path}」', { path }))
    }
    if (!v.name.trim()) return setErr(t('起个名字'))
    props.onDone({ ...v, target: v.kind === 'open' ? target.replace(/^\/+|\/+$/g, '') : /^[a-z]+:\/\//i.test(target) ? target : `https://${target}` })
  }

  return (
    <div
      ref={box}
      className="pal-form"
      role="form"
      aria-label={e ? t('改这条命令') : t('加一条自己的命令')}
      onKeyDown={(ev) => {
        if (ev.nativeEvent.isComposing) return
        if (ev.key === 'Escape') (ev.preventDefault(), ev.stopPropagation(), props.onBack())
        else if (ev.key === 'Enter' && ev.metaKey) (ev.preventDefault(), ev.stopPropagation(), done())
      }}
    >
      <div className="fh">
        <button className="b" aria-label={t('回到列表')} title={t('回到列表')} onClick={props.onBack}>
          <Codicon name="arrow-left" size={16} />
        </button>
        {e ? t('改这条命令') : t('加一条自己的命令')}
      </div>
      <div className="f-row">
        <label>{t('做什么')}</label>
        <div className="kinds" role="radiogroup" aria-label={t('做什么')}>
          {KINDS.map((k) => (
            <button key={k.id} role="radio" aria-checked={v.kind === k.id} className={'kind' + (v.kind === k.id ? ' on' : '')} onClick={() => set({ kind: k.id })}>
              <b>
                <Codicon name={k.icon} size={14} />
                {k.id === 'open' ? t('打开一处') : t('打开网址')}
              </b>
              <span>{k.id === 'open' ? t('文件夹、笔记、PDF') : t('在右栏网页里开')}</span>
            </button>
          ))}
          {/* 新加时才有：AI 图标是跑它的那一家的标志（偏好「AI 图标用引擎标志」） */}
          {!e && (
            <button role="radio" aria-checked={false} className="kind" onClick={props.onAi}>
              <b>
                <AiIcon job="chat" size={14} />
                {t('让AI做一件事')}
              </b>
              <span>{t('写几条规矩，AI 照着做')}</span>
            </button>
          )}
        </div>
      </div>
      <div className="f-row">
        <label htmlFor="pal-f-target">{v.kind === 'open' ? t('打开哪里') : t('网址')}</label>
        <div>
          {/* 不翻：收件箱是磁盘上的文件夹名 */}
          <input id="pal-f-target" name="target" placeholder={v.kind === 'open' ? sugg[0] ?? catName('收件箱') : 'https://'} value={v.target} onChange={(x) => set({ target: x.target.value })} />
          {v.kind === 'open' && sugg.length > 0 && (
            <div className="sugg" role="group" aria-label={t('建议')}>
              {sugg.map((s) => (
                <button key={s} onClick={() => set({ target: s, ...(v.name.trim() ? {} : { name: t('打开 {name}', { name: lastPart(s) }) }) })}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="f-row">
        <label htmlFor="pal-f-name">{t('名字')}</label>
        <div>
          {/* 不翻：收件箱是磁盘上的文件夹名 */}
          <input id="pal-f-name" placeholder={v.kind === 'open' ? t('打开 {name}', { name: lastPart(sugg[0] ?? catName('收件箱')) }) : t('打开课程网站')} value={v.name} onChange={(x) => set({ name: x.target.value })} />
          {err && (
            <div className="f-err" role="alert">
              {err}
            </div>
          )}
        </div>
      </div>
      <div className="f-row">
        <label htmlFor="pal-f-group">{t('放进哪组')}</label>
        <select id="pal-f-group" value={v.group} onChange={(x) => set({ group: x.target.value })}>
          {props.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="f-row">
        <label htmlFor="pal-f-alias">{t('别名')}</label>
        <input id="pal-f-alias" placeholder={t('可以不填；打全它这一条排第一')} value={v.alias} onChange={(x) => set({ alias: x.target.value })} />
      </div>
      <div className="foot">
        <span className="note">{t('存在库里，换台Mac也在')}</span>
        <button className="btn btn-sm btn-ghost" onClick={props.onBack}>
          {t('取消')}
        </button>
        <button className="btn btn-sm btn-primary" onClick={done}>
          {e ? t('存好') : t('加上')}
        </button>
      </div>
    </div>
  )
}
