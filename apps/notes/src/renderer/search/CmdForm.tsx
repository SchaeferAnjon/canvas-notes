/**
 * ⌘K「加一条自己的命令…」（DESIGN.v3 3.2）：面板原地变成表单。做什么（打开一处 / 打开网址）、打开哪里或网址、名字、放进哪组、别名。
 * 「让AI做一件事」等「把对话存成自己的 AI 命令」那份方案选了再加（task-9womr）；存法已经留好（shared/commands.ts 的 kind: ai）。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OwnCommand } from '../../shared/commands'
import { recentFiles, useVaultFiles } from '../files/store'

export interface FormValue {
  kind: 'open' | 'url'
  name: string
  target: string
  group: string
  alias: string
}

const KINDS = [
  { id: 'open', icon: 'folder-opened', name: '打开一处', note: '文件夹、笔记、PDF' },
  { id: 'url', icon: 'globe', name: '打开网址', note: '在右栏网页里开' },
] as const

const lastPart = (p: string) => p.split('/').pop() ?? p

export function CmdForm(props: { edit: OwnCommand | null; group: string; alias: string; groups: { id: string; name: string }[]; onDone(v: FormValue): void; onBack(): void }) {
  const e = props.edit
  const [v, setV] = useState<FormValue>({ kind: e?.kind === 'url' ? 'url' : 'open', name: e?.name ?? '', target: e?.target ?? '', group: props.group, alias: props.alias })
  const [err, setErr] = useState('')
  const files = useVaultFiles().files
  const box = useRef<HTMLDivElement>(null)
  // 建议：最近开过的文件所在的文件夹，再是最外层的文件夹；最多 4 个
  const sugg = useMemo(() => {
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
    if (!target) return setErr(v.kind === 'open' ? '先填打开哪里' : '先填网址')
    if (v.kind === 'open') {
      const path = target.replace(/^\/+|\/+$/g, '')
      if (!files.some((f) => f.path === path && f.kind !== 'img' && f.kind !== 'att')) return setErr(`库里没有「${path}」`)
    }
    if (!v.name.trim()) return setErr('起个名字')
    props.onDone({ ...v, target: v.kind === 'open' ? target.replace(/^\/+|\/+$/g, '') : /^[a-z]+:\/\//i.test(target) ? target : `https://${target}` })
  }

  return (
    <div
      ref={box}
      className="pal-form"
      role="form"
      aria-label={e ? '改这条命令' : '加一条自己的命令'}
      onKeyDown={(ev) => {
        if (ev.nativeEvent.isComposing) return
        if (ev.key === 'Escape') (ev.preventDefault(), ev.stopPropagation(), props.onBack())
        else if (ev.key === 'Enter' && ev.metaKey) (ev.preventDefault(), ev.stopPropagation(), done())
      }}
    >
      <div className="fh">
        <button className="b" aria-label="回到列表" title="回到列表" onClick={props.onBack}>
          <Codicon name="arrow-left" size={16} />
        </button>
        {e ? '改这条命令' : '加一条自己的命令'}
      </div>
      <div className="f-row">
        <label>做什么</label>
        <div className="kinds" role="radiogroup" aria-label="做什么">
          {KINDS.map((k) => (
            <button key={k.id} role="radio" aria-checked={v.kind === k.id} className={'kind' + (v.kind === k.id ? ' on' : '')} onClick={() => set({ kind: k.id })}>
              <b>
                <Codicon name={k.icon} size={14} />
                {k.name}
              </b>
              <span>{k.note}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="f-row">
        <label htmlFor="pal-f-target">{v.kind === 'open' ? '打开哪里' : '网址'}</label>
        <div>
          <input id="pal-f-target" name="target" placeholder={v.kind === 'open' ? sugg[0] ?? '收件箱' : 'https://'} value={v.target} onChange={(x) => set({ target: x.target.value })} />
          {v.kind === 'open' && sugg.length > 0 && (
            <div className="sugg" role="group" aria-label="建议">
              {sugg.map((s) => (
                <button key={s} onClick={() => set({ target: s, ...(v.name.trim() ? {} : { name: `打开 ${lastPart(s)}` }) })}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="f-row">
        <label htmlFor="pal-f-name">名字</label>
        <div>
          <input id="pal-f-name" placeholder={v.kind === 'open' ? `打开 ${lastPart(sugg[0] ?? '收件箱')}` : '打开课程网站'} value={v.name} onChange={(x) => set({ name: x.target.value })} />
          {err && (
            <div className="f-err" role="alert">
              {err}
            </div>
          )}
        </div>
      </div>
      <div className="f-row">
        <label htmlFor="pal-f-group">放进哪组</label>
        <select id="pal-f-group" value={v.group} onChange={(x) => set({ group: x.target.value })}>
          {props.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="f-row">
        <label htmlFor="pal-f-alias">别名</label>
        <input id="pal-f-alias" placeholder="可以不填；打全它这一条排第一" value={v.alias} onChange={(x) => set({ alias: x.target.value })} />
      </div>
      <div className="foot">
        <span className="note">存在库里，换台Mac也在</span>
        <button className="btn btn-sm btn-ghost" onClick={props.onBack}>
          取消
        </button>
        <button className="btn btn-sm btn-primary" onClick={done}>
          {e ? '存好' : '加上'}
        </button>
      </div>
    </div>
  )
}
