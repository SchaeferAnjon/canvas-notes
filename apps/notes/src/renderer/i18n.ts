/**
 * 界面这边的语言（task-zojmg）：照预加载给的设好（第一帧就对），主进程换了跟着换。
 * 组件里用 useT()：换语言时这个组件重画；不是组件的地方直接用 shared/i18n 的 t()（在画的那个组件订了就行）。
 * 换语言不重建整棵树：开着的标签、正在打的字都不动（设计稿第 1 节）。
 */
import { createElement, Fragment, type ReactNode, useSyncExternalStore } from 'react'
import { type Lang, onUiLang, type Params, setUiLang, setVaultLang, tIn, uiLang } from '../shared/i18n'
import type { LangApi, LangInfo } from '../shared/i18n/api'
import '../shared/i18n/file-words'

// 单元测试（node）里没有 window：当中文
const api = typeof window === 'undefined' ? undefined : (window as unknown as { cnLang?: LangApi }).cnLang
let info: LangInfo | null = api?.info() ?? null
const infoSubs = new Set<() => void>()

function apply(i: LangInfo) {
  info = i
  setVaultLang(i.vault)
  setUiLang(i.lang, { hour12: i.hour12 })
  document.documentElement.lang = i.lang === 'en' ? 'en' : 'zh-CN'
  for (const f of [...infoSubs]) f()
}
if (info) apply(info)
api?.onChange(apply)

export const langApi = (): LangApi | undefined => api

/** 这会儿的界面语言；换了这个组件重画 */
export const useLang = (): Lang => useSyncExternalStore(onUiLang, uiLang)

type T = (key: string, p?: Params) => string
const BOUND: Record<Lang, T> = { zh: (k, p) => tIn('zh', k, p), en: (k, p) => tIn('en', k, p) }

/** 组件里取字：const t = useT()；换语言时 t 换一个（放进 useMemo 的依赖里，算好的字跟着换） */
export const useT = (): T => BOUND[useLang()]

/**
 * 一句话里要放元素（加粗的数字、链接）：先照常 t() 取整句（元素那几个占位不给值，原样留着），再把 {名字} 换成元素。
 * 不拼句子：「比上周多{n}，{day}存得最多」整句一个模板，英文「Up {n} from last week · most saved on {day}」
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  return text
    .split(/(\{\w+\})/)
    .map((s, i) => {
      const name = /^\{(\w+)\}$/.exec(s)?.[1]
      return name && name in parts ? createElement(Fragment, { key: i }, parts[name]) : s
    })
    .filter((x) => x !== '')
}

/** 设置里那一行要的：设置里选的、跟随系统是哪种 */
export function useLangInfo(): LangInfo | null {
  return useSyncExternalStore(
    (f) => (infoSubs.add(f), () => void infoSubs.delete(f)),
    () => info,
  )
}
