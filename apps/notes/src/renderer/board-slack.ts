/**
 * 白板四周多出的空白（像 Milanote、Figma）：内容四边各能再拖出半屏多，任何一张卡都能拖到画面正中。
 * 白板的平移就是 .board-wrap 自己的滚动（两指滑、按住空格拖、中键拖都是改 scrollLeft / scrollTop），
 * 以前滚动区域刚好包住内容，左边、上边滚到 0 就停：往右拖（想把右边那列拉到中间）拖不动。
 * 现在滚动区域四周各垫一圈 pad（画面宽、高的一半再多 SLACK_EXTRA），打开时滚到 pad 处（内容还在原来那个位置）；
 * 画面变大变小 pad 跟着变，滚动位置同时补上差的那一截，内容不跳。
 * 用它的白板：算滚动位置的地方（缩放换算、适合窗口）都按「pad + 原来的值」写。
 */
import { type RefObject, useLayoutEffect, useRef, useState } from 'react'

/** 半屏之外再多一点：卡的中心能到画面正中还有余 */
const SLACK_EXTRA = 80

export interface Slack {
  x: number
  y: number
}

export function useBoardSlack(wrap: RefObject<HTMLElement | null>): Slack {
  const [pad, setPad] = useState<Slack>({ x: 0, y: 0 })
  /** 滚动位置已经按哪一个 pad 补过 */
  const applied = useRef<Slack>({ x: 0, y: 0 })
  useLayoutEffect(() => {
    const w = wrap.current
    if (!w) return
    const measure = () => {
      if (!w.clientWidth || !w.clientHeight) return
      const next = { x: Math.ceil(w.clientWidth / 2) + SLACK_EXTRA, y: Math.ceil(w.clientHeight / 2) + SLACK_EXTRA }
      setPad((p) => (p.x === next.x && p.y === next.y ? p : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(w)
    return () => ro.disconnect()
  }, [wrap])
  // pad 变了（第一次量到、画面变了大小）：滚动位置补上差的那一截，内容留在原地
  useLayoutEffect(() => {
    const w = wrap.current
    const a = applied.current
    if (!w || (a.x === pad.x && a.y === pad.y)) return
    w.scrollLeft += pad.x - a.x
    w.scrollTop += pad.y - a.y
    applied.current = pad
  }, [pad, wrap])
  return pad
}
