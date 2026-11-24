import { describe, expect, it } from 'vitest'
import type { Dock } from '../src/shared/dock'
import { layoutSig, liveMax, maxColumns, parseMax } from '../src/renderer/shell/max'

const dock: Dock = {
  v: 1,
  cols: [{ id: 'center' }, { id: 'c1', w: 420, groups: [{ id: 'g1', views: ['web', 'note'], active: 'web', f: 1 }] }, { id: 'c2', w: 360, groups: [{ id: 'g2', views: ['ai'], active: 'ai', f: 1 }] }],
  floats: [{ id: 'f1', views: ['outline'], active: 'outline', x: 10, y: 10, w: 380, h: 500 }],
  hidden: null,
} as Dock

describe('每一栏都能占满', () => {
  it('本机存的读回来：坏的、不认识的当没占满', () => {
    expect(parseMax(JSON.stringify({ kind: 'center', pane: 1 }))).toEqual({ kind: 'center', pane: 1 })
    expect(parseMax(JSON.stringify({ kind: 'group', id: 'g2' }))).toEqual({ kind: 'group', id: 'g2' })
    expect(parseMax(JSON.stringify({ kind: 'web' }))).toEqual({ kind: 'web' })
    expect(parseMax('null')).toBeNull()
    expect(parseMax('{坏')).toBeNull()
    expect(parseMax(JSON.stringify({ kind: 'left' }))).toBeNull()
  })

  it('对上布局：那一组没了不算；网页不在前面不算；没分屏时第二格算第一格；浮窗也行', () => {
    expect(liveMax({ kind: 'group', id: 'g2' }, dock, false)).toEqual({ kind: 'group', id: 'g2', float: false })
    expect(liveMax({ kind: 'group', id: 'gone' }, dock, false)).toBeNull()
    expect(liveMax({ kind: 'group', id: 'f1' }, dock, false)).toEqual({ kind: 'group', id: 'f1', float: true })
    expect(liveMax({ kind: 'web' }, dock, false)).toEqual({ kind: 'group', id: 'g1', float: false })
    const noteFront = { ...dock, cols: [dock.cols[0]!, { id: 'c1', w: 420, groups: [{ id: 'g1', views: ['web', 'note'], active: 'note', f: 1 }] }] } as Dock
    expect(liveMax({ kind: 'web' }, noteFront, false)).toBeNull()
    expect(liveMax({ kind: 'center', pane: 1 }, dock, false)).toEqual({ kind: 'center', pane: 0 })
    expect(liveMax({ kind: 'center', pane: 1 }, dock, true)).toEqual({ kind: 'center', pane: 1 })
  })

  it('盖住的列：左栏开着从左栏起，到最后一栏', () => {
    expect(maxColumns(dock, true)).toBe('2 / 8')
    expect(maxColumns(dock, false)).toBe('3 / 8')
  })

  it('布局的样子：占满那一组换前面的标签不算变，别的组换了、收了右栏算变', () => {
    const base = layoutSig(dock, 'g1')
    const g1Note = { ...dock, cols: [dock.cols[0]!, { id: 'c1', w: 420, groups: [{ id: 'g1', views: ['web', 'note'], active: 'note', f: 1 }] }, dock.cols[2]!] } as Dock
    expect(layoutSig(g1Note, 'g1')).toBe(base)
    expect(layoutSig(g1Note, 'g2')).not.toBe(layoutSig(dock, 'g2'))
    expect(layoutSig({ ...dock, cols: [dock.cols[0]!], hidden: { cols: [], floats: [] } } as Dock, 'g1')).not.toBe(base)
  })
})
