import { useEffect } from 'react'

/**
 * 栏里的小弹层（书签小卡、翻译菜单、⋯ 菜单）贴着按钮往左展开，栏窄时会伸出栏的左边，被岛的圆角裁掉
 * （用户 2026-11-16：书签管家小卡被右栏左边裁掉）。弹层一出现就量一下，伸出去多少往右挪多少；
 * 箭头（--arrow-right）跟着往回挪，还指着原来的按钮。
 */
export const POP_SEL = '.wpop, .menu, .shell-menu, .trm'
const MARGIN = 6

export function keepInside(panel: HTMLElement, pops: Iterable<HTMLElement>) {
  const p = panel.getBoundingClientRect()
  for (const el of pops) {
    el.style.translate = ''
    el.style.removeProperty('--arrow-dx')
    const r = el.getBoundingClientRect()
    if (!r.width) continue
    const dx = Math.min(p.right - MARGIN - r.right, Math.max(0, p.left + MARGIN - r.left))
    if (dx === 0) continue
    el.style.translate = `${dx}px 0`
    el.style.setProperty('--arrow-dx', `${dx}px`)
  }
}

export function useKeepPopsInside(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const panel = ref.current
    if (!panel) return
    let frame = 0
    const run = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => keepInside(panel, panel.querySelectorAll<HTMLElement>(POP_SEL)))
    }
    const mo = new MutationObserver((list) => {
      // 自己改的 style 不算
      if (list.some((m) => m.type === 'childList')) run()
    })
    mo.observe(panel, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [ref])
}
