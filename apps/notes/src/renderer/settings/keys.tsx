/**
 * 设置 › 快捷键（方向 A，照 Obsidian）：顶上搜、只看已设的；命令表（shared/cmd-table.ts）里每一条一行，没有默认键的也在；
 * 点键位再按新的组合就换，撞了别的当场说撞了谁、能「两个对调」，改过的能回到默认、能清掉。
 * 键存在哪：命令的在库里 .canvas-notes/命令.json（cmd-store）；速记是全局键（settings.general.quickKey，主进程重新注册）；
 * 记下这一刻、框一块问是视频的 ⌥ 键（userData/video/state.json）。视频的播放进退是固定的，只列出来。
 */
import { Codicon } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { comboOf } from '../../shared/cmd-keys'
import { AREA_NAME, isRebindable, KEYMAP, type KeyArea, keyDef, keyProblemFor, type KeySection, SECTION_NAME } from '../../shared/cmd-table'
import { resetKey, setKey, swapKey } from '../../shared/commands'
import { availNow, checkKey, keysFor, useKeys, withKeys } from '../keys'
import { registryNow, updateCmds, useCmds } from '../search/cmd-store'
import { setVideoSettings, useVideoSettings } from '../video/store'
import type { SettingsProps } from '../Settings'
import { Group, Row, useSaid } from './ui'
import { Toggle } from '../Settings'

/** 一个键：从哪来（速记的全局键、命令表里的命令、视频的 ⌥ 键、固定的） */
export type KeySlot = { row: string; label: string; desc?: string; key: string | null; keys: string[]; section: KeySection } & (
  { kind: 'quick' } | { kind: 'cmd'; cmd: string; def: string | null; custom: boolean } | { kind: 'video'; video: 'moment' | 'ask' } | { kind: 'fixed'; cmd?: string }
)

/** 名字下面那一句：在哪儿能按（全局的不写），加上命令表里的说明 */
const descOf = (area: KeyArea, hint?: string) => [area === 'app' || area === 'system' ? '' : AREA_NAME[area], hint ?? ''].filter(Boolean).join(' · ')

/** 这一页、一般页（速记快捷键）共用：现在每个键是什么 */
export function useKeySlots(quickKey: string): KeySlot[] {
  const cfg = useCmds()
  useKeys()
  useVideoSettings()
  const slots: KeySlot[] = []
  for (const d of KEYMAP) {
    if (d.area === 'fixed') continue
    const keys = keysFor(d.id)
    const base = { label: d.name, key: keys[0] ?? null, keys, section: d.section, desc: descOf(d.area, d.hint) }
    if (d.store === 'quick') slots.push({ ...base, row: 'kQuick', kind: 'quick', key: quickKey, keys: [quickKey] })
    else if (d.store === 'video') slots.push({ ...base, row: d.id === 'video-moment' ? 'kSnap' : 'kBox', kind: 'video', video: d.id === 'video-moment' ? 'moment' : 'ask' })
    else if (!isRebindable(d)) slots.push({ ...base, row: `k-cmd-${d.id}`, kind: 'fixed', cmd: d.id })
    else slots.push({ ...base, row: `k-cmd-${d.id}`, kind: 'cmd', cmd: d.id, def: d.keys?.[0] ?? null, custom: cfg.keys[d.id] !== undefined })
  }
  // 命令表以外的：插件的（双语翻译的「翻成…」这些）、自己加的命令
  for (const c of registryNow()) {
    if (keyDef(c.id) || c.id.startsWith('folder:') || c.id === 'folders') continue
    const keys = keysFor(c.id)
    const base = { row: `k-cmd-${c.id}`, label: c.name, key: keys[0] ?? null, keys, section: (c.id.startsWith('own-') ? 'go' : 'web') as KeySection, desc: c.id.startsWith('own-') ? '自己加的命令' : '' }
    slots.push(c.fixedKeys ? { ...base, kind: 'fixed', cmd: c.id } : { ...base, kind: 'cmd', cmd: c.id, def: c.keys ?? null, custom: cfg.keys[c.id] !== undefined })
  }
  return slots
}

/** ⌥S → Alt+KeyS（视频的键）；不是 ⌥ 加字母、数字的给 null */
const videoKeyOf = (combo: string) => (/^⌥[A-Z0-9]$/.test(combo) ? `Alt+${/\d/.test(combo[1]!) ? 'Digit' : 'Key'}${combo[1]}` : null)

/** 这一格在命令表里是哪条 */
const idOf = (s: KeySlot): string => (s.kind === 'quick' ? 'quick-note' : s.kind === 'video' ? `video-${s.video}` : (s.cmd ?? s.row))

/** 这个键能不能放进这一格；不能的说为什么（速记现在的键不算撞） */
function problemFor(slot: KeySlot, combo: string): string | null {
  if (slot.kind === 'quick' && !/[⌘⌃]/.test(combo)) return '要带上 ⌘ 或 ⌃，不然打字时会按到'
  return keyProblemFor(idOf(slot), combo)
}

/**
 * 键位按钮和撞键那一句：点了开始录（「按新的组合键…」），再按一个组合；esc 取消。
 * 一般页的「速记快捷键」也用它（和这一页的「速记」是同一个键）
 */
export function useKeyRecorder(props: Pick<SettingsProps, 'settings' | 'onChange'>, slots: KeySlot[]) {
  const said = useSaid()
  const [rec, setRec] = useState<string | null>(null)
  /** 撞键、不能给的那一句；pending 是刚按的键（键位上先写它，待定样子），take 换给这一条，swap 两个对调 */
  const [warn, setWarn] = useState<{ row: string; text: string; pending?: string; take?: () => void; swap?: () => void } | null>(null)
  const video = useVideoSettings()

  /** 把 combo 放进 slot（不管撞不撞） */
  async function put(slot: KeySlot, combo: string | null) {
    if (slot.kind === 'quick') {
      if (combo) await props.onChange({ general: { quickKey: combo } })
    } else if (slot.kind === 'cmd') await updateCmds((c) => setKey(c, availNow(), slot.cmd, combo))
    else if (slot.kind === 'video' && combo) await setVideoSettings({ keys: { ...video.keys, [slot.video]: videoKeyOf(combo)! } })
  }

  async function record(slot: KeySlot, combo: string) {
    setRec(null)
    const bad = problemFor(slot, combo)
    if (bad) return setWarn({ row: slot.row, text: bad })
    if (slot.keys.length === 1 && combo === slot.key) return setWarn(null)
    // 撞了谁：同一处能按、用着这个键的（编辑器里和 ⌘K 里不会同时按到，不算撞）
    const clash = checkKey(idOf(slot), combo).clash
    const other = clash ? slots.find((s) => idOf(s) === clash.id) : undefined
    if (!clash) {
      setWarn(null)
      await put(slot, combo)
      return said.say(`「${slot.label}」换成 ${combo}`)
    }
    const mine = slot.key
    // 换给这一条：那一条让出来（命令表里的命令才清得掉；速记、视频的键不能空着）
    const canTake = other?.kind === 'cmd'
    // 对调：那一格要放得下这一格原来的键（视频的键只认 ⌥ 加字母，固定的键不动）
    const canSwap = !!other && other.kind !== 'fixed' && !!mine && !problemFor(other, mine)
    if (!canSwap && !canTake) return setWarn({ row: slot.row, text: `${combo} 已经给了「${clash.name}」，换一个` })
    setWarn({
      row: slot.row,
      text: `${combo} 已经给了「${clash.name}」`,
      pending: combo,
      take: !canTake
        ? undefined
        : () => {
            setWarn(null)
            void (async () => {
              await put(slot, combo)
              // 这一格不是命令表里的（速记、视频）：放好以后那条命令再让出来
              if (slot.kind !== 'cmd' && other?.kind === 'cmd') await put(other, null)
              said.say(`「${slot.label}」换成 ${combo}，「${clash.name}」没有快捷键了`)
            })()
          },
      swap: !canSwap
        ? undefined
        : () => {
        setWarn(null)
        void (async () => {
          if (slot.kind === 'cmd' && other!.kind === 'cmd') await updateCmds((c) => swapKey(c, availNow(), slot.cmd, combo))
          else {
            // 先让出来再放：别处先拿到原来的键，这一格再拿新的
            await put(other!, mine)
            await put(slot, combo)
          }
          said.say(`对调了：「${slot.label}」${combo}，「${clash.name}」${mine}`)
        })()
      },
    })
  }

  // 撞键那一句开着时 esc 取消（不关设置）
  useEffect(() => {
    if (!warn?.pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      setWarn(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [warn])

  useEffect(() => {
    if (!rec) return
    const slot = slots.find((s) => s.row === rec)
    if (!slot) return
    const onKey = (e: KeyboardEvent) => {
      // 录键时这个键不交给软件别处（⌘J 不开 AI、esc 不关设置）
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return setRec(null)
      if (['Meta', 'Shift', 'Alt', 'Control', 'CapsLock'].includes(e.key)) return
      const combo = comboOf(e)
      if (combo) void record(slot, combo)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rec, slots])

  /** 一格的键位按钮（几个默认键的写在一起，⌘K ⌘F） */
  const button = (slot: KeySlot) =>
    slot.kind === 'fixed' ? (
      <span className="sa-keyb fixed" aria-label={`${slot.label}的快捷键 ${slot.keys.join(' ')}（固定）`} title="固定的键，不能改">
        {slot.keys.join(' ')}
      </span>
    ) : (
      <button
        type="button"
        className={'sa-keyb' + (rec === slot.row ? ' rec' : warn?.row === slot.row && warn.pending ? ' pend' : !slot.keys.length ? ' none' : '')}
        aria-label={`改 ${slot.label} 的快捷键`}
        onClick={() => {
          setWarn(null)
          setRec(rec === slot.row ? null : slot.row)
        }}
      >
        {rec === slot.row ? '按新的组合键…' : warn?.row === slot.row && warn.pending ? warn.pending : slot.keys.length ? slot.keys.join(' ') : '没有'}
      </button>
    )

  /** 撞键那一句（跟在说明下面） */
  const more = (slot: KeySlot) =>
    warn?.row === slot.row ? (
      <div className="sa-kwarn" role="alert">
        <Codicon name="warning" size={12} />
        <span>{warn.text}</span>
        {warn.swap && (
          <button type="button" className="sa-lnk" onClick={warn.swap}>
            两个对调
          </button>
        )}
      </div>
    ) : undefined

  /** 快捷键页：撞键那一句是这一行的第二行（顶替说明），「换给这一条 · 两个对调」 */
  const line = (slot: KeySlot) =>
    warn?.row === slot.row ? (
      <span className="sa-kclash" role="alert">
        {warn.text}
        {warn.take && (
          <button type="button" className="sa-lnk" onClick={warn.take}>
            换给这一条
          </button>
        )}
        {warn.take && warn.swap && <span className="sep">·</span>}
        {warn.swap && (
          <button type="button" className="sa-lnk" onClick={warn.swap}>
            两个对调
          </button>
        )}
      </span>
    ) : undefined

  return { button, more, line }
}

/** 段的先后：照命令表里的先后 */
const SECTIONS = [...new Set(KEYMAP.filter((d) => d.area !== 'fixed').map((d) => d.section))]

export function KeysPage(props: SettingsProps) {
  const said = useSaid()
  const slots = useKeySlots(props.settings.general.quickKey)
  const { button, line } = useKeyRecorder(props, slots)
  const [q, setQ] = useState('')
  const [onlySet, setOnlySet] = useState(false)
  const k = q.trim().toLowerCase()
  // 搜了、换了「只看已设的」：回到顶上（不然留在搜之前滚到的地方）；搜索那一行贴在顶上，滚下去时下面一道线
  const bar = useRef<HTMLDivElement>(null)
  // scrollTo 在这一版 Chromium 里交回一个 Promise：不能直接当 useEffect 的返回值（React 会当成收尾函数去调）
  useEffect(() => {
    bar.current?.closest('.set-body')?.scrollTo({ top: 0 })
  }, [k, onlySet])
  useEffect(() => {
    const el = bar.current
    const body = el?.closest('.set-body')
    if (!el || !body) return
    const on = () => el.classList.toggle('stuck', body.scrollTop > el.offsetTop - 4)
    body.addEventListener('scroll', on, { passive: true })
    return () => body.removeEventListener('scroll', on)
  }, [])
  const shown = (s: KeySlot) => (!onlySet || s.keys.length > 0) && (!k || s.label.toLowerCase().includes(k) || s.keys.some((x) => x.toLowerCase().includes(k)) || (s.desc ?? '').toLowerCase().includes(k))
  /** 清掉、回到默认（Obsidian 每条右边那两颗） */
  const tools = (s: KeySlot) =>
    s.kind === 'cmd' ? (
      <>
        {/* 两颗一直占着位置（不能用时看不见）：一列一列对齐，录完键别的不挪 */}
        <button type="button" className="sa-btn ghost sa-ic" hidden={!s.custom} aria-label={`${s.label} 回到默认`} title={s.def ? `回到默认 ${s.def}` : '回到默认：没有键'} onClick={() => void updateCmds((c) => resetKey(c, availNow(), s.cmd)).then(() => said.say(`「${s.label}」回到默认${s.def ? ` ${s.def}` : '：没有键'}`))}>
          <Codicon name="discard" size={14} />
        </button>
        <button type="button" className="sa-btn ghost sa-ic" hidden={!s.keys.length} aria-label={`清掉 ${s.label} 的快捷键`} title="清掉" onClick={() => void updateCmds((c) => setKey(c, availNow(), s.cmd, null)).then(() => said.say(`「${s.label}」的快捷键清掉了`))}>
          <Codicon name="close" size={14} />
        </button>
      </>
    ) : null
  const row = (s: KeySlot) => (
    <Row key={s.row} id={s.row} label={s.label} desc={line(s) ?? (s.desc || (s.kind === 'fixed' ? '固定的键' : ''))}>
      {tools(s)}
      {button(s)}
    </Row>
  )
  const groups = SECTIONS.map((sec) => ({ sec, rows: slots.filter((s) => s.section === sec && shown(s)) })).filter((g) => g.rows.length)
  return (
    <>
      <div className="sa-keytools" ref={bar}>
        <label className="sa-srch">
          <Codicon name="search" size={14} />
          <input value={q} placeholder="搜命令或键" aria-label="搜快捷键" onChange={(e) => setQ(e.currentTarget.value)} />
        </label>
        <label className="sa-only">
          <Toggle on={onlySet} label="只看已设的" onChange={setOnlySet} />
          只看已设的
        </label>
      </div>
      {groups.map((g) => (
        <Group key={g.sec} title={SECTION_NAME[g.sec]}>
          {g.rows.map(row)}
        </Group>
      ))}
      {!groups.length && <p className="sa-note">{`没有「${q.trim()}」`}</p>}
      <p className="sa-note">{withKeys('点键位再按新的组合，esc 取消；撞了别的能换给这一条或两个对调。命令和 {k:search} 里的是同一份。')}</p>
    </>
  )
}
