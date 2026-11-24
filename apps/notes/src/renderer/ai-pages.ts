/**
 * 「这段 → 那页」表的界面这一半（AI 对话绑页面方向 A，2026-11-24；格式和搬法见 shared/ai-chats.ts ConvPages）。
 * 主进程按库存；书桌开一个库时（App 的 Desk，换库会重建）读一份放在模块里（网页上点「引用」要马上知道进哪段，不能等），改的时候两边一起改。
 * 以前「留在这个对话」记在本机 localStorage cn.webStay（网页 → 那段）：第一次读到时搬进主进程那张表，搬成了删掉旧的。
 */
import { useSyncExternalStore } from 'react'
import { type ConvPages, readKey } from '../shared/ai-chats'

const subs = new Set<() => void>()
let pages: ConvPages = {}
let version = 0
const bump = () => {
  version++
  for (const s of [...subs]) s()
}

/** 以前「留在这个对话」那张表 */
const OLD = 'cn.webStay'

/** 一个网页去掉 #（同一页里跳来跳去、回到那一段的链接都算这一页）：它在表里的页 key 是 read:web:<网址> */
export const webPage = (url: string) => readKey(`web:${url.replace(/#.*$/, '')}`)

/** 读这个库的表（换库时重读），顺手搬以前的「留在这个对话」 */
export async function loadPages() {
  pages = await window.cn.aiPages()
  bump()
  let old: Record<string, { key?: unknown; label?: unknown }> | null = null
  try {
    old = JSON.parse(localStorage.getItem(OLD) ?? 'null') as typeof old
  } catch {
    old = null
  }
  if (!old || typeof old !== 'object') return
  // 网页 → 那段 倒成 那段 → 网页；几个网页留在同一段的，留后记的那一个（一段只挂一页）
  for (const [url, c] of Object.entries(old as Record<string, { key?: unknown; label?: unknown }>)) {
    if (typeof c?.key !== 'string' || typeof c.label !== 'string') continue
    await setPage(c.key, { page: webPage(url), label: c.label })
  }
  localStorage.removeItem(OLD)
}

export const pagesNow = () => pages

/** 这段挂到 page（搬家：一段只挂一页）；null 是回到挂在自己那一页 */
export async function setPage(convo: string, to: { page: string; label: string } | null) {
  const { [convo]: _, ...rest } = pages
  pages = to && to.page !== convo ? { ...rest, [convo]: { ...to, at: Date.now() } } : rest
  bump()
  await window.cn.aiSetPage(convo, to)
}

/** 挂在这一页上的几段（不算这页自己那段），新挂的在前 */
export const convosOn = (page: string) =>
  Object.entries(pages)
    .filter(([, v]) => v.page === page)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([key, v]) => ({ key, label: v.label }))

/** 表变了就重画 */
export const usePages = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => version,
  )
