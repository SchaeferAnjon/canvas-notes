/**
 * 界面这边弹右键菜单：列出要哪几项（每项带点了做什么），交给主进程弹系统菜单，点了哪项就跑它的 run。
 *
 *   onContextMenu={(e) => menuAt(e, [{ label: '打开', run: open }, '-', { edit: 'copy' }])}
 *
 * false / null / undefined / 空字符串的项直接跳过，方便按情况拼；'-' 是分隔线（开头结尾、连着的会去掉）。
 */
import type { AiJob } from '../../shared/ai-logo'
import type { CtxIcon, CtxItem, EditCmd } from '../../shared/ctx-menu'
import { aiLogoNow, type LogoEngine, logoPng } from '../engine-logo'

export type MenuEntry =
  /** ai：交给 AI 引擎跑的这一项，左边画跑它的那一家的标志（偏好「AI 图标用引擎标志」） */
  /** tip：悬停说的一句（灰掉的项说为什么） */
  | { label: string; run(): unknown; enabled?: boolean; checked?: boolean; accel?: string; ai?: AiJob; tip?: string }
  | { label: string; submenu: MenuEntry[]; enabled?: boolean }
  | { edit: EditCmd; enabled?: boolean }
  | { spell: string }
  | { copyImageAt: { x: number; y: number } }
  | { type: 'separator' }
  | '-'
  | false
  | ''
  | null
  | undefined

let notice: (text: string) => void = (t) => console.error(t)
/** 菜单项跑出错时怎么告诉用户（App 挂上通知条） */
export function setMenuNotice(fn: (text: string) => void) {
  notice = fn
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 拆成发给主进程的项和 id → run；icons：AI 那几项的标志画成的图（showMenu 先画好） */
export function compile(entries: MenuEntry[], runs = new Map<string, () => unknown>(), prefix = '', icons = new Map<LogoEngine, CtxIcon>()): { items: CtxItem[]; runs: Map<string, () => unknown> } {
  const items: CtxItem[] = []
  entries.forEach((e, i) => {
    if (!e) return
    if (e === '-' || 'type' in e) return void items.push({ type: 'separator' })
    if ('edit' in e || 'spell' in e || 'copyImageAt' in e) return void items.push(e)
    const id = prefix + i
    if ('submenu' in e) {
      const sub = compile(e.submenu, runs, id + '.', icons).items
      if (sub.length) items.push({ id, label: e.label, submenu: sub, ...(e.enabled === false ? { enabled: false } : {}) })
      return
    }
    runs.set(id, e.run)
    const logo = e.ai ? aiLogoNow(e.ai) : null
    const icon = logo ? icons.get(logo) : undefined
    items.push({ id, label: e.label, ...(e.enabled === false ? { enabled: false } : {}), ...(e.checked !== undefined ? { checked: e.checked } : {}), ...(e.accel ? { accel: e.accel } : {}), ...(icon ? { icon } : {}), ...(e.tip ? { tip: e.tip } : {}) })
  })
  return { items, runs }
}

/** 弹菜单，等用户点完；target：编辑项对哪个网页做（右栏网页的 webContents id） */
export async function showMenu(entries: MenuEntry[], target?: number): Promise<void> {
  const { items, runs } = compile(entries, undefined, undefined, await menuIcons(entries))
  if (!items.some((it) => !('type' in it))) return
  const picked = await window.cnMenu.popup(items, target)
  const run = picked === null ? undefined : runs.get(picked)
  if (!run) return
  try {
    await run()
  } catch (e) {
    notice(errText(e))
  }
}

/** 菜单里 AI 那几项要的标志，画成图（每家画一次就记着，之后几乎不花时间）；画不出来就不放图 */
async function menuIcons(entries: MenuEntry[]): Promise<Map<LogoEngine, CtxIcon>> {
  const want = new Set<LogoEngine>()
  const walk = (list: MenuEntry[]) => {
    for (const e of list) {
      if (!e || typeof e !== 'object') continue
      if ('submenu' in e) walk(e.submenu)
      else if ('ai' in e && e.ai) {
        const id = aiLogoNow(e.ai)
        if (id) want.add(id)
      }
    }
  }
  walk(entries)
  const out = new Map<LogoEngine, CtxIcon>()
  await Promise.all(
    [...want].map((id) =>
      logoPng(id).then(
        (i) => void out.set(id, i),
        (err) => console.error(err),
      ),
    ),
  )
  return out
}

/** 右键事件里用：拦住系统默认（不然主进程又兜底弹一个）、不往外冒，再弹自己的 */
export function menuAt(e: { preventDefault(): void; stopPropagation(): void }, entries: MenuEntry[], target?: number): Promise<void> {
  e.preventDefault()
  e.stopPropagation()
  return showMenu(entries, target)
}

/** shared 里拼好的项（标准编辑菜单）放进界面这边的菜单；只有说明用的那几项（「没有拼写建议」）不做事 */
export const fromShared = (items: CtxItem[]): MenuEntry[] =>
  items.map((it) => ('id' in it ? { label: it.label, enabled: it.enabled, run: () => undefined } : it))

/** 拷贝一段字（走主进程的剪贴板） */
export const copy = (text: string) => window.cnMenu.copyText(text)
