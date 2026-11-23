/**
 * 白板框选的几张、文档拖选的几块交给 AI（task-5ryf9，操作条的「问AI」「AI整理」）：记在这里。
 * AI 那一格「看得到」写「白板上选中的N张」「这篇里选中的N块」，每一轮把这几样的 md 原文交给 AI（AgentContext.cards）；
 * 「AI整理」那条命令（commands/tidy.ts）按 base 和每一样的范围找回它们。换了一篇就拿掉（和左栏多选「问AI」一样）。
 */
import { useSyncExternalStore } from 'react'

export interface CardPick {
  /** 哪一篇（白板也是一篇 md） */
  path: string
  where: 'board' | 'doc'
  /** 选中的每一样：白板上是卡的名字（unitKeys）、文档里是块的范围；text 是 md 原文 */
  items: { key: string; from: number; to: number; text: string }[]
  /** 选的时候这一篇的全文：AI 整理时这一篇又改过就不照旧的写 */
  base: string
}

let cur: CardPick | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function pickCards(p: CardPick) {
  cur = p.items.length ? p : null
  emit()
}

export function dropCards() {
  if (!cur) return
  cur = null
  emit()
}

/** 现在交给 AI 的那几样（不是组件的地方用） */
export const cardPick = (): CardPick | null => cur

export const useCardPick = (): CardPick | null =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => cur,
  )

/** 交给 AI 的那几样合成一段：一样一段，前面标号（AI 回答里按标号说是哪几样） */
export function pickText(p: CardPick): string {
  return p.items.map((it, i) => `[${i + 1}]\n${it.text.trim()}`).join('\n\n')
}
