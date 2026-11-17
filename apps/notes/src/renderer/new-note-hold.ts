/**
 * 点了「新建笔记」到新标签的编辑器出来之间（盘慢时一两秒）：键盘先从原来那篇拿走，这中间打的字记下来交给新笔记
 * （第 5 轮：焦点还在原来那篇，紧接着打的标题进了日记）。按钮在这期间是「正在建」的样子。
 *
 * 用一个看不见的输入框接字：中文输入法的组字、退格、回车都照常进它，新笔记好了把它里面的字放进标题（第一行）和正文。
 */
import { useSyncExternalStore } from 'react'

let busy = false
const subs = new Set<() => void>()
const setBusy = (v: boolean) => {
  busy = v
  subs.forEach((f) => f())
}

/** 新建笔记的按钮：正在建的时候 aria-busy */
export const useNewNoteBusy = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => busy,
  )

/** 新笔记路径 → 交出这期间打的字（交了就不再接） */
const handed = new Map<string, () => string>()

export interface Hold {
  /** 新笔记建好了：打的字等它的编辑器来拿 */
  handTo(path: string): void
  /** 没建成：放回焦点，打的字不要了 */
  drop(): void
}

export function holdTyping(): Hold {
  const was = document.activeElement as HTMLElement | null
  const box = document.createElement('textarea')
  box.setAttribute('aria-hidden', 'true')
  box.tabIndex = -1
  box.className = 'new-note-hold'
  Object.assign(box.style, { position: 'fixed', left: '-10000px', top: '0', width: '10px', height: '10px', opacity: '0' })
  document.body.appendChild(box)
  box.focus()
  setBusy(true)
  const take = () => {
    const v = box.value
    box.remove()
    return v
  }
  return {
    handTo(path) {
      handed.set(path, take)
      setBusy(false)
      // 编辑器一直没来拿（打开失败）：别让这个框一直占着焦点
      setTimeout(() => handed.get(path) === take && (handed.delete(path), take()), 5000)
    },
    drop() {
      take()
      setBusy(false)
      was?.focus?.()
    },
  }
}

/** 新笔记的编辑器好了：拿走建的时候打的字（没有就是空的） */
export function takeTyping(path: string): string {
  const f = handed.get(path)
  handed.delete(path)
  return f ? f() : ''
}
