/**
 * 每一栏都能占满（用户 2026-11-24：「每个框都能占满」，照 VS Code「最大化编辑组」）：中间那栏（分屏时是其中一格）、右边每一组、浮窗。
 * 占满的那一栏盖住左栏到最后一栏（.win 的格子里多占几列），别的栏原地不动、只是看不见（visibility），
 * 所以还原时各栏宽度、分屏比例、滚动位置都照旧，不用另记。
 */
import * as D from '../../shared/dock'

/** 记着的占满：web 是「网页所在那一组」（书桌、旧的网页占满记的是它，开网页前就能记） */
export type Max = { kind: 'center'; pane: 0 | 1 } | { kind: 'group'; id: string } | { kind: 'web' }
/** 画出来的占满：对上了现在的布局 */
export type LiveMax = { kind: 'center'; pane: 0 | 1 } | { kind: 'group'; id: string; float: boolean }

export function parseMax(raw: string | null): Max | null {
  if (!raw) return null
  try {
    const m = JSON.parse(raw) as Partial<{ kind: string; pane: number; id: string }> | null
    if (m?.kind === 'center') return { kind: 'center', pane: m.pane === 1 ? 1 : 0 }
    if (m?.kind === 'group' && typeof m.id === 'string') return { kind: 'group', id: m.id }
    if (m?.kind === 'web') return { kind: 'web' }
  } catch {
    // 本机存的坏了：不占满
  }
  return null
}

/** 记着的占满对上现在的布局：那一组没了（收起、拖进别的组）、网页没在前面，就是没占满 */
export function liveMax(m: Max | null, shown: D.Dock, split: boolean): LiveMax | null {
  if (!m) return null
  if (m.kind === 'center') return { kind: 'center', pane: split ? m.pane : 0 }
  const f = m.kind === 'web' ? D.findView(shown, 'web') : D.findGroup(shown, m.id)
  if (!f || (m.kind === 'web' && f.group.active !== 'web')) return null
  return { kind: 'group', id: f.group.id, float: f.float }
}

/** 占满时盖住 .win 的哪几列：左栏开着从左栏起，到最后一栏为止（B 里中间排最后时它右边那道缝不盖） */
export function maxColumns(shown: D.Dock, sideShown: boolean): string {
  return `${sideShown ? 2 : 3} / ${4 + 2 * (shown.cols.length - 1)}`
}

/** 布局的样子（不算占满那一组换前面的标签）：变了就不再占满（开了别的栏、拖了、收了右栏） */
export function layoutSig(d: D.Dock, maxId: string | null): string {
  const g = (x: D.Group | D.FloatWin) => `${x.id}:${x.views.join(',')}:${x.id === maxId ? '' : x.active}`
  return [d.hidden ? 'h' : '', d.cols.map((c) => (D.isCenter(c) ? 'C' : c.groups.map(g).join('/'))).join('|'), d.floats.map(g).join('|')].join('#')
}
