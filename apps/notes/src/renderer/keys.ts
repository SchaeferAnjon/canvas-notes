/**
 * 快捷键在界面这边（task-spsmf）：命令现在的键从这里取，界面上写着的键都用它（不写死）；按下去归谁也从这里查。
 *
 * - 写在界面上：React 里 useKey(id) / useKeys()，菜单这种点了才拼的 keyFor(id)、accelFor(id)，一句话里提到键写成 {k:id} 交给 withKeys。
 * - 按下去：全局的命令（命令表 area = app）App 登记一个跑法（setAppRunner），窗口上的按键、编辑器里的按键、网页有焦点时主进程转回来的
 *   按键都走 runAppKey；要看场合的（白板、PDF 上放大，选了字时引用）各自那块用 isKey(e, id) 认。
 * - 交给主进程：网页、视频有焦点时要转回来的键，菜单栏上每一项显示的键，网页里自己的脚本要认的键（双语翻译、剪藏和引用选中的一段）。
 */
import { createContext, useContext, useEffect, useRef } from 'react'
import { accelOf, comboOf, type KeyLike } from '../shared/cmd-keys'
import { clashOf, isRebindable, KEYMAP, keyDef, keyProblemFor } from '../shared/cmd-table'
import { type Avail, effectiveKeys } from '../shared/commands'
import { t } from '../shared/i18n'
import { keyLabel } from '../shared/video-api'
import { cmdConfig, onCmdsChange, registryNow as dynamicNow, useCmds } from './search/cmd-store'
import { appSettings, usePrefs } from './settings-store'
import { useVideoSettings, videoSettingsNow } from './video/store'

// ---------------------------------------------------------------- 现在的键

const VIDEO_SLOT: Record<string, 'moment' | 'ask'> = { 'video-moment': 'moment', 'video-ask': 'ask' }

/** 命令表里能改的（不变，算一次） */
const TABLE_AVAIL: Avail[] = KEYMAP.filter((d) => isRebindable(d) && !d.store).map((d) => ({ id: d.id, keys: d.keys?.[0], also: d.keys?.slice(1) }))
const TABLE_IDS = new Set(TABLE_AVAIL.map((a) => a.id))

/**
 * 算好的：默认的键（命令表 + App 交进来的插件的、自己加的）、全局命令的键 → 哪条命令。
 * 每按一个键都要查（文档里打字也是），设置、命令变了才重算
 */
let cache: { avail: Avail[]; app: Map<string, string> } | null = null
onCmdsChange(() => (cache = null))

/** 命令表里能改的、App 交进来的（插件的、自己加的）：默认的键 */
export function availNow(): Avail[] {
  cache ??= build()
  return cache.avail
}

function build(): NonNullable<typeof cache> {
  const avail = [...TABLE_AVAIL, ...dynamicNow().filter((c) => !TABLE_IDS.has(c.id)).map((c) => ({ id: c.id, keys: c.keys }))]
  cache = { avail, app: new Map() }
  // 全局命令的键：命令表里在「软件里」的在前（同一个键不会两条都在，命令表和设键时让过了）
  const app = new Map<string, string>()
  for (const d of KEYMAP) if (d.area === 'app' && isRebindable(d)) for (const k of keysFor(d.id)) if (!app.has(k)) app.set(k, d.id)
  // 自己的命令放上选中小条时可以用 ⌥ 加字母（task-26nz7）：那只在选着字时认（网页、PDF、HTML、文档各自接），不当全局键，打字时按不到
  for (const c of dynamicNow()) if (!keyDef(c.id) && !c.fixedKeys) for (const k of keysFor(c.id)) if (!app.has(k) && (/[⌘⌃]/.test(k) || !/^own-/.test(c.id))) app.set(k, c.id)
  cache.app = app
  return cache
}

/** 一条命令现在的几个键（第一个是写在提示上的） */
export function keysFor(id: string): string[] {
  const d = keyDef(id)
  if (d?.store === 'quick') return [appSettings().general.quickKey]
  if (d?.store === 'video') return [keyLabel(videoSettingsNow().keys[VIDEO_SLOT[id]!])]
  if (d && !isRebindable(d)) return [...(d.keys ?? [])]
  // 插件自己那块接的键（改不了）：照它交进来的
  const fixed = d ? undefined : dynamicNow().find((c) => c.id === id && c.fixedKeys)
  if (fixed) return fixed.keys ? [fixed.keys] : []
  return effectiveKeys(cmdConfig(), availNow(), id)
}

/** 写在提示上的那个键；没有键是 null */
export const keyFor = (id: string): string | null => keysFor(id)[0] ?? null

/** 系统菜单（右键菜单、菜单栏）的写法：⇧⌘E → Shift+Command+E；没有键 undefined */
export function accelFor(id: string): string | undefined {
  const k = keyFor(id)
  return k && /^[⌃⌥⇧⌘]*([A-Z0-9]|F\d+|[,./;'[\]\\\-=`↵⌫⌦⇥↑↓←→↖↘⇞⇟]|Space)$/.test(k) ? accelOf(k) : undefined
}

/** 按下去的是不是这条命令的键（输入法正在拼字时不算） */
export function isKey(e: KeyLike & { isComposing?: boolean }, id: string): boolean {
  if (e.isComposing) return false
  const c = comboOf(e)
  return !!c && keysFor(id).includes(c)
}

/** 一句话里提到键：{k:new-note} 换成现在的键；这条没有键时换成它的名字（「新建笔记以后先建一块白板」，名字跟界面语言） */
export function withKeys(text: string): string {
  return text.replace(/\{k:([\w-]+)\}/g, (_m, id: string) => {
    const d = keyDef(id)
    return keyFor(id) ?? (d ? t(d.name) : id)
  })
}

/** 跟着键变：命令表的设置、速记的键、视频的键改了都重画 */
export function useKeys(): (id: string) => string | null {
  useCmds()
  usePrefs((s) => s.general.quickKey)
  useVideoSettings()
  return keyFor
}

export function useKey(id: string): string | null {
  return useKeys()(id)
}

// ---------------------------------------------------------------- 设键

/** 这个键能不能给这条命令（不能的说为什么）；能给但撞了别的，说撞了谁 */
export function checkKey(id: string, combo: string): { problem: string | null; clash: { id: string; name: string } | null } {
  const problem = keyProblemFor(id, combo)
  if (problem) return { problem, clash: null }
  const extra = dynamicNow().filter((c) => !keyDef(c.id))
  const clash = clashOf(id, combo, keysFor, extra)
  // 撞了谁：说它界面上的名字（命令表的跟界面语言；插件的、自己加的照交进来的）
  return { problem: null, clash: clash && { ...clash, name: nameOf(clash.id) } }
}

/** 一条命令界面上的名字：命令表的跟界面语言（命令表里是中文原句），插件、自己加的用交进来的（不翻） */
export function nameOf(id: string): string {
  const d = keyDef(id)
  return d ? t(d.name) : (dynamicNow().find((c) => c.id === id)?.name ?? id)
}

// ---------------------------------------------------------------- 按下去

/** App 登记的：全局命令怎么跑；返回 false 是这会儿不归它（场合不对），按键接着往下走 */
type Runner = (id: string) => boolean
let runner: Runner | null = null
export function setAppRunner(r: Runner | null) {
  runner = r
}

/**
 * 要看场合的全局命令（白板、PDF 上放大，选了字时引用，开着网页时地址栏……）：那一块开着时登记一个跑法，
 * 不归它时返回 false。按键、菜单栏、⌘K 跑这条命令时挨个问，先问 prio 大的、后登记的
 */
type Local = { run: () => boolean; prio: number; seq: number }
const locals = new Map<string, Set<Local>>()
let localSeq = 0

/**
 * 中间栏分成两格时（中间栏分屏）：不是当前格的那一格里的东西也看得见，但要看场合的按键（⌘E 换看法、放大缩小、找字……）
 * 只归当前格。两格各包一层，那一格不是当前格时给 false，里面登记的跑法先撤下
 */
export const PaneFocus = createContext(true)

export function useKeyHandler(id: string, run: (() => boolean) | null, prio = 0) {
  const ref = useRef(run)
  ref.current = run
  const focused = useContext(PaneFocus)
  const on = run !== null && focused
  useEffect(() => {
    if (!on) return
    const h: Local = { run: () => ref.current?.() ?? false, prio, seq: ++localSeq }
    const set = locals.get(id) ?? new Set()
    locals.set(id, set.add(h))
    return () => void set.delete(h)
  }, [id, on, prio])
}

/** 问一遍登记了这条命令的那几块；有一块接了返回 true */
export function runLocal(id: string): boolean {
  const hs = [...(locals.get(id) ?? [])].sort((a, b) => b.prio - a.prio || b.seq - a.seq)
  return hs.some((h) => h.run())
}

/** 这个组合键是哪条全局命令的（命令表里在「软件里」的、插件的、自己加的） */
export function appCommandFor(combo: string | null): string | null {
  if (!combo) return null
  cache ??= build()
  return cache.app.get(combo) ?? null
}

/**
 * 一次按键只跑一次（网页占满快捷键）：macOS 上菜单栏那一项的键总是注册着（Electron 的 registerAccelerator: false 只管 Windows、Linux），
 * 一下真按键可能从两条路到这里：窗口的 keydown（编辑器、白板、输入框；网页里按的由主进程转回来、照样按一下）和菜单栏那一项（app:key「cmd:fold-center」）。
 * 开关类的命令跑两次等于没按（0.5.3 里 ⌃⌘\ 按了没反应）。同一条命令一边从菜单栏、一边从按键来，不到 ONE_PRESS 毫秒的算同一下，只跑一次；
 * 同一条路来的每一下都跑（连按两下、按住不放、菜单栏连点），网页里按一下再到文档里按一下也是两下
 */
type Via = 'key' | 'web' | 'menu'
const ONE_PRESS = 400
let lastRun: { id: string; via: Via; at: number } | null = null
function again(id: string, via: Via): boolean {
  const now = Date.now()
  // 一对是菜单栏和按键（窗口里的或网页转回来的）；认出一对就用掉，下一下照常跑
  if (lastRun && lastRun.id === id && (lastRun.via === 'menu') !== (via === 'menu') && now - lastRun.at < ONE_PRESS) {
    lastRun = null
    return true
  }
  lastRun = { id, via, at: now }
  return false
}

/** 窗口、编辑器里按下一个键：是全局命令的就跑它（跑了返回 true，调用的那边拦住这个键） */
export function runAppKey(e: KeyLike & { isComposing?: boolean; defaultPrevented?: boolean; isTrusted?: boolean }): boolean {
  if (e.isComposing || e.defaultPrevented || !runner) return false
  // 打字（没按 ⌘ ⌃ ⌥、不是 F 键）不会是全局命令的键：不用查
  if (!(e.metaKey ?? e.meta) && !(e.ctrlKey ?? e.control) && !(e.altKey ?? e.alt) && !/^F\d/.test(e.code ?? '')) return false
  const id = appCommandFor(comboOf(e))
  if (!id) return false
  // 这一下按键菜单栏已经跑过它：拦住，不再跑（网页里按的是 replayAppKey 照样发的，不是真按键事件）
  if (again(id, e.isTrusted === false ? 'web' : 'key')) return true
  return runner(id)
}

/**
 * 窗口上接全局快捷键（App 布局阶段挂上，返回摘掉的函数）。0.5.4 起菜单栏只显示键、键由界面自己接（task-spsmf），
 * 窗口的 keydown 要等这一下冒上来；可编辑器里的小框（数据库格子、表格格子、列名、块里的文本框……）为了不让编辑器把键当成自己的，
 * 在 keydown 里 stopPropagation，⌘K、⌘[、⌘W 就到不了窗口（数据库格子里 ⌘K 打不开命令面板）。
 * 所以不只等冒泡：捕获阶段先看一眼，这一下是全局命令的 ⌘ / ⌃ 键，就记下谁拦了它；被拦住、拦的那边也没 preventDefault（没当成自己的键）时，
 * 在拦它的那个监听跑完后照样跑这条命令。⌥ 加字母不补（框里打 å ∑ 这些字），F 键也不补。冒到窗口的走原来那条路，同一下只跑一次
 */
export function listenAppKeys(): () => void {
  const done = new WeakSet<Event>()
  const run = (e: KeyboardEvent) => {
    if (done.has(e)) return
    done.add(e)
    if (runAppKey(e)) e.preventDefault()
  }
  const capture = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.isComposing || !appCommandFor(comboOf(e))) return
    for (const name of ['stopPropagation', 'stopImmediatePropagation'] as const) {
      const stop = e[name]
      // 微任务排在拦它的那个监听跑完以后（React 的是整个根的那一次分发以后）：那边要是 preventDefault 了，runAppKey 就不跑
      e[name] = function (this: KeyboardEvent) {
        stop.call(this)
        queueMicrotask(() => run(e))
      }
    }
  }
  window.addEventListener('keydown', capture, true)
  window.addEventListener('keydown', run)
  return () => {
    window.removeEventListener('keydown', capture, true)
    window.removeEventListener('keydown', run)
  }
}

/** 网页里按了 Esc、焦点不在网页的表单里（主进程看过才转来）：占满着就回原样（App） */
export const WEB_ESC = 'cn:web-esc'

/**
 * 网页、视频有焦点时主进程转回来的键（「combo:⌥⌘S」）：在窗口上照样按一下，全局命令和要看场合的那几块都收得到；
 * 菜单栏那一项（按键触发的「cmd:settings」、鼠标点的「pick:settings」）直接跑那条命令
 */
export function replayAppKey(k: string) {
  if (k === 'esc') return void window.dispatchEvent(new Event(WEB_ESC))
  if (k.startsWith('cmd:')) return void (again(k.slice(4), 'menu') || runner?.(k.slice(4)) || runLocal(k.slice(4)))
  // 菜单栏上用鼠标点的：不是按键，不和刚才那下按键算一对（按完 ⌘W 马上点「文件 › 关闭」也要关）
  if (k.startsWith('pick:')) return void (runner?.(k.slice(5)) || runLocal(k.slice(5)))
  if (!k.startsWith('combo:')) return
  const ev = keyEventOf(k.slice(6))
  // 发在 body 上（往上冒到 document、window）：监听里读 e.target.closest 的不会碰上 window
  if (ev) document.body.dispatchEvent(ev)
}

const CODE_OF: Record<string, string> = { ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '-': 'Minus', '=': 'Equal', '`': 'Backquote', '↵': 'Enter', '⌫': 'Backspace', '⌦': 'Delete', '⇥': 'Tab', Space: 'Space', '↑': 'ArrowUp', '↓': 'ArrowDown', '←': 'ArrowLeft', '→': 'ArrowRight', '↖': 'Home', '↘': 'End', '⇞': 'PageUp', '⇟': 'PageDown' }

/** ⌥⌘S → 一个照样的 keydown（code 是按键的位置，comboOf 认它） */
function keyEventOf(combo: string): KeyboardEvent | null {
  const mods = /^[⌃⌥⇧⌘]*/.exec(combo)![0]
  const name = combo.slice(mods.length)
  const code = CODE_OF[name] ?? (/^[A-Z]$/.test(name) ? `Key${name}` : /^\d$/.test(name) ? `Digit${name}` : /^F\d+$/.test(name) ? name : null)
  if (!code) return null
  const key = code === 'Enter' ? 'Enter' : code === 'Backspace' ? 'Backspace' : /^[A-Z]$/.test(name) ? (mods.includes('⇧') ? name : name.toLowerCase()) : name
  return new KeyboardEvent('keydown', { key, code, metaKey: mods.includes('⌘'), altKey: mods.includes('⌥'), shiftKey: mods.includes('⇧'), ctrlKey: mods.includes('⌃'), bubbles: true, cancelable: true })
}

// ---------------------------------------------------------------- 交给主进程

/** 菜单栏上有快捷键的几项（main/index.ts 的菜单照这些 id 取键） */
export const MENU_CMDS = ['settings', 'new-note', 'new-board', 'capture', 'import', 'close', 'back', 'forward', 'home', 'goto', 'search', 'toggle-left', 'toggle-right', 'fold-center', 'split-center', 'left-files', 'left-recent', 'outline', 'related', 'open-web', 'history', 'ask-ai', 'toggle-view', 'zoom-in', 'zoom-out', 'zoom-reset', 'find-in-page'] as const

let sent = ''
export function syncKeys() {
  if (!window.cnCmds) return
  // 网页、视频有焦点时要转回来的：全局命令的键（网页里自己的脚本接的双语翻译、剪藏和引用选中的一段不转，不然网页里收不到）
  const page = new Set([...keysFor('translate'), ...keysFor('clip-selection'), ...keysFor('quote-selection')])
  const app = new Set<string>()
  for (const d of KEYMAP) if (d.area === 'app' && isRebindable(d) && !d.noForward) for (const k of keysFor(d.id)) if (!page.has(k)) app.add(k)
  // 放上选中小条的自己那几颗（task-26nz7）：网页里选着字时网页自己接（小条上那颗），不转回来
  const bar = cmdConfig().bar
  const onBar = new Set([...bar.on, ...bar.more])
  for (const c of dynamicNow()) if (!keyDef(c.id) && !c.fixedKeys && !onBar.has(c.id)) for (const k of keysFor(c.id)) if (!page.has(k)) app.add(k)
  const menu = Object.fromEntries(MENU_CMDS.map((id) => [id, keyFor(id)]))
  const pageKeys = { translate: keyFor('translate'), 'clip-selection': keyFor('clip-selection'), 'quote-selection': keyFor('quote-selection') }
  const msg = { forward: [...app].sort(), menu, page: pageKeys }
  const sig = JSON.stringify(msg)
  if (sig === sent) return
  sent = sig
  void window.cnCmds.keys(msg).catch((e) => console.error('快捷键交给主进程没成', e))
}

onCmdsChange(syncKeys)

// 端到端测试读现在的键（改过键以后照样按得对）；只读，不改东西
if (typeof window !== 'undefined') Object.assign(window, { cnKeys: { keyFor, keysFor } })
