/**
 * 点了「新建笔记」到新标签的编辑器出来之间（盘慢时一两秒）：键盘先从原来那篇拿走，这中间打的字记下来交给新笔记
 * （第 5 轮：焦点还在原来那篇，紧接着打的标题进了日记）。按钮在这期间是「正在建」的样子。
 *
 * 用一个看不见的输入框接字：中文输入法的组字、退格、回车都照常进它，新笔记好了把它里面的字放进标题（第一行）和正文。
 *
 * 建的期间用户换到了别的标签（左栏点开另一篇）：release。之前打的字还归新笔记，之后打的归换到的那篇：
 * 那篇的编辑器拿到焦点时来取（takeStray，盘慢时它要读一会儿，这中间打的字先接着）。新笔记在后台开标签、不抢焦点（App.newNote）。
 * 第 6 轮：以前过几秒新标签弹出来抢走焦点，切走后打的字有时进了新笔记、有时哪儿都没有。
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

interface Holding {
  box: HTMLTextAreaElement
  /** 用户换了标签时框里已经有几个字：这之前的归新笔记，之后的归换到的那篇；没换是 null */
  cut: number | null
  /** 新笔记那份交了 */
  given: boolean
}

/** 正在接字的框（同时只有一个：建的时候「新建笔记」不再接第二次） */
let holding: Holding | null = null

function finish(h: Holding) {
  h.box.remove()
  if (holding === h) holding = null
}

export interface Hold {
  /** 新笔记建好了：打的字等它的编辑器来拿 */
  handTo(path: string): void
  /** 没建成：放回焦点，打的字不要了 */
  drop(): void
  /** 用户换到了别的标签：之后打的字归那一篇 */
  release(): void
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
  const h: Holding = { box, cut: null, given: false }
  holding = h
  /** 新笔记那份：换过标签只给换之前打的 */
  const take = () => {
    if (h.given) return ''
    h.given = true
    const v = h.cut === null ? box.value : box.value.slice(0, h.cut)
    // 换过标签：后面的字还等换到的那篇来拿，一会儿后再收
    if (h.cut === null) finish(h)
    else setTimeout(() => finish(h), 5000)
    return v
  }
  return {
    handTo(path) {
      handed.set(path, take)
      setBusy(false)
      // 编辑器一直没来拿（打开失败）：别让这个框一直占着焦点
      setTimeout(() => handed.get(path) === take && (handed.delete(path), take(), finish(h)), 5000)
    },
    drop() {
      finish(h)
      setBusy(false)
      if (h.cut === null) was?.focus?.()
    },
    release() {
      if (h.cut !== null) return
      h.cut = box.value.length
      // 点左栏时焦点到了按钮上：框接着接字，等换到的那篇编辑器好了来拿；它已经拿着焦点就不抢
      if (!(document.activeElement as HTMLElement | null)?.closest?.('.cm-editor')) box.focus()
      // 换到的不是笔记（首页、PDF）没人来拿：一会儿后放掉
      setTimeout(() => h.given && finish(h), 5000)
    },
  }
}

/** 新笔记的编辑器好了：拿走建的时候打的字（没有就是空的） */
export function takeTyping(path: string): string {
  const f = handed.get(path)
  handed.delete(path)
  return f ? f() : ''
}

/** 换到的那篇编辑器拿到焦点：拿走换过去以后打进框里的字（没有就是空的） */
export function takeStray(): string {
  const h = holding
  if (!h || h.cut === null) return ''
  const v = h.box.value.slice(h.cut)
  h.box.value = h.box.value.slice(0, h.cut)
  if (h.given) finish(h)
  return v
}
