/**
 * 各家 AI 自己的标志（偏好「Agent 用自己的图标」，DESIGN.v3 2.1）：右下角圆钮、A 底栏的 AI 入口、左栏「问AI」、引擎菜单、翻译设置都用它。
 * 偏好「AI 图标用引擎标志」（task-5svkm）：凡是交给 AI 引擎跑的（⌘K 命令、右键、块菜单、插入菜单、按钮），左边的图标也画跑它的那一家
 * （AiIcon；系统右键菜单用 logoPng 画成图），设置里换了引擎当场跟着换。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { codiconSvg } from '@cn/design/codicon-svg'
import { useEffect, useSyncExternalStore } from 'react'
import type { EngineId } from '../shared/agent'
import { engineOfLabel } from '../shared/ai-features'
import { type AiJob, type AiUses, logoOf } from '../shared/ai-logo'
import { onPlugins, pluginInfo } from './plugins/host'
import claudeSvg from './assets/engine-logos/claude.svg?raw'
import codexSvg from './assets/engine-logos/codex.svg?raw'
import deepseekSvg from './assets/engine-logos/deepseek.svg?raw'
import geminiPng from './assets/engine-logos/gemini.png'
import zhipuSvg from './assets/engine-logos/zhipu.svg?raw'

export type LogoEngine = 'claude' | 'codex' | 'gemini' | 'opencode' | 'deepseek' | 'zhipu'

const SVG: Partial<Record<LogoEngine, string>> = { claude: claudeSvg, codex: codexSvg, deepseek: deepseekSvg, zhipu: zhipuSvg }

/** OpenCode 没有现成的标志，用终端图标 */
export function EngineLogo({ id, size = 14, className }: { id: LogoEngine; size?: number; className?: string }) {
  const svg = SVG[id]
  const cls = 'eng-logo' + (className ? ' ' + className : '')
  if (svg) return <span className={cls} data-engine={id} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  if (id === 'gemini') return <img className={cls} data-engine={id} src={geminiPng} width={size} height={size} alt="" />
  return (
    <span className={cls} data-engine={id} style={{ width: size, height: size, display: 'inline-grid' }} aria-hidden="true">
      <Codicon name="terminal" size={size} />
    </span>
  )
}

/** 不用 React 的地方（文档里的提示块图标）：同一个标志的一个元素 */
export function engineLogoEl(id: LogoEngine, size: number): HTMLElement {
  if (id === 'gemini') {
    const img = document.createElement('img')
    img.className = 'eng-logo'
    img.dataset.engine = id
    img.src = geminiPng
    img.width = img.height = size
    img.alt = ''
    return img
  }
  const s = document.createElement('span')
  s.className = 'eng-logo'
  s.dataset.engine = id
  s.style.width = s.style.height = `${size}px`
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = SVG[id] ?? codiconSvg('terminal', { size })
  return s
}

/** 「Claude Code · Opus 5.5」前面那一家的标志 12（AI 回答头上那一行，偏好「Agent 用自己的图标」）；认不出是哪家不画 */
export function ByLogo({ by }: { by: string }) {
  const id = engineOfLabel(by)
  return id ? <EngineLogo id={id} size={12} className="by-logo" /> : null
}

// ---------------------------------------------------------------- 各功能现在用哪家

// 「AI 对话」现在用哪家（设置 › AI 那一行；引擎菜单、设置里一改，主进程广播 ai:prefs:changed，用到的地方当场跟着换，CN-127）
let chatEngine: { id: EngineId; label: string } = { id: 'claude', label: 'Claude Code' }
// 各功能实际用的那家（ai:prefs 的 uses）和翻译现在用的那家（双语翻译插件的 engines；插件关着、没有能翻的是 null）
let uses: AiUses = { chat: 'claude', dream: 'claude', vision: 'claude', quick: 'claude', cards: 'claude', translate: null }
const subs = new Set<() => void>()
const emit = () => subs.forEach((s) => s())
let started = false

function load() {
  void window.cn.aiEngines().then((r) => {
    const label = r.engines.find((e) => e.id === r.current)?.label ?? chatEngine.label
    if (r.current === chatEngine.id && label === chatEngine.label) return
    chatEngine = { id: r.current, label }
    emit()
  })
  void window.cn.aiPrefs().then((v) => {
    if (FEATS.every((f) => v.uses[f] === uses[f])) return
    uses = { ...uses, ...v.uses }
    emit()
  })
}
const FEATS = ['chat', 'dream', 'vision', 'quick', 'cards'] as const

let trSeq = 0
function loadTranslate() {
  const seq = ++trSeq
  const set = (id: AiUses['translate']) => {
    if (seq !== trSeq || id === uses.translate) return
    uses = { ...uses, translate: id }
    emit()
  }
  if (!pluginInfo('translate')?.enabled) return set(null)
  window.cnPlugins.call<{ current: AiUses['translate'] }>('translate', 'engines', { refresh: false }).then(
    (i) => set(i.current),
    (e) => console.error('翻译引擎读不到', e),
  )
}

function start() {
  if (started) return
  started = true
  load()
  loadTranslate()
  window.cn.onAiPrefsChanged(load)
  // 翻译的设置（只用哪家、顺序）存在插件设置里：插件表一变就再问一次
  onPlugins(loadTranslate)
}

function useStore<T>(get: () => T): T {
  useEffect(start, [])
  return useSyncExternalStore((cb) => {
    subs.add(cb)
    return () => subs.delete(cb)
  }, get)
}

/** 「AI 对话」现在用的那家：右下角圆钮、A 底栏那一项、左栏「问AI」画它的标志 */
export const useChatEngine = (): { id: EngineId; label: string } => useStore(() => chatEngine)

/** 这件 AI 活现在画哪家的标志（null：翻译没有能用的那家） */
export const useAiLogo = (job: AiJob): LogoEngine | null => useStore(() => logoOf(job, uses))

/** 不在 React 里（系统右键菜单拼项时）：这件活现在画哪家 */
export function aiLogoNow(job: AiJob): LogoEngine | null {
  start()
  return logoOf(job, uses)
}

/**
 * AI 那一项左边的图标：跑它的那一家的标志，大小和这一处别的图标一样（size）；
 * 翻译没有能用的那家时画 fallback（翻译的「ab」）
 */
export function AiIcon({ job, size, className, fallback = 'whole-word' }: { job: AiJob; size: number; className?: string; fallback?: CodiconName }) {
  const id = useAiLogo(job)
  // ai-ic：标志本身画小一圈（格子不变），和旁边 Codicons 看起来一样大（designer 复审：画满一格的标志比 Codicons 重近一倍）
  return id ? <EngineLogo id={id} size={size} className={'ai-ic' + (className ? ' ' + className : '')} /> : <Codicon name={fallback} size={size} className={className} />
}

// ---------------------------------------------------------------- 系统右键菜单里的标志

/** 系统菜单项的图：32 像素的 PNG（主进程按 2 倍图用，菜单里是 16 点）；单色的标志做成模板图，系统按菜单的字色画（深色菜单里是白的） */
export interface MenuIcon {
  png: string
  template: boolean
}

const MONO: LogoEngine[] = ['codex', 'opencode']
const pngs = new Map<LogoEngine, Promise<MenuIcon>>()

/** 把标志画成菜单用的 PNG（每家画一次记着） */
export function logoPng(id: LogoEngine): Promise<MenuIcon> {
  let p = pngs.get(id)
  if (!p) {
    p = new Promise<MenuIcon>((resolve, reject) => {
      const px = 32
      const svg = SVG[id] ?? (id === 'opencode' ? codiconSvg('terminal', { size: px }) : null)
      const img = new Image(px, px)
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = c.height = px
        // 同 AiIcon：32 的画布里画 28，和菜单里别的图一样重
        c.getContext('2d')!.drawImage(img, 2, 2, px - 4, px - 4)
        resolve({ png: c.toDataURL('image/png'), template: MONO.includes(id) })
      }
      img.onerror = () => reject(new Error(`${id} 的标志画不出来`))
      // 单色的（currentColor）画成黑的：做模板图时系统只看透明度
      img.src = svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/currentColor/g, '#000').replace(/<svg([^>]*)>/, (_m, a: string) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, '')} width="${px}" height="${px}">`)) : geminiPng
    })
    pngs.set(id, p)
    p.catch(() => pngs.delete(id))
  }
  return p
}
