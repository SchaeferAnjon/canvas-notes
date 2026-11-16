import { isMindmap, parseMindmap, prop, aiFilled, type MapNode } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { cameraKind, coursesOf, firstJson, fromRows, indentRows, mapTitle, mindmapNote, parseRecognition, photoCaption, photoName, toRows } from '../src/shared/mindmap'
import { layoutMindmap, mindmapThumb, wirePath } from '../src/shared/mindmap-layout'

describe('认摄像头', () => {
  it('这台 M3 Max 上 Electron 列出来的名字', () => {
    expect(cameraKind('FaceTime HD Camera (467C:1317)')).toBe('mac')
    expect(cameraKind('schaefer Camera')).toBe('iphone')
    expect(cameraKind('schaefer Desk View Camera')).toBe('desk')
    expect(cameraKind('张三的 iPhone 相机')).toBe('iphone')
    expect(cameraKind('fake_device_0')).toBe('mac')
    expect(cameraKind('Logitech USB Camera')).toBe('mac')
  })
})

describe('AI 认出来的', () => {
  const answer = `好的，下面是认出来的：
\`\`\`json
{"mindmap": true, "legible": true, "course": "线性代数", "lecture": 3,
 "root": {"text": "线性映射", "box": [0.4, 0.45, 0.2, 0.1], "unsure": false, "guesses": [],
   "children": [{"text": "核与像", "box": [60, 70, 10, 5], "children": [
     {"text": "秩-零化渡定理", "box": [0.6, 0.9, 0.6, 0.3], "unsure": true, "guesses": ["秩-零化度定理", "秩-零化度定理", ""]}]},
     {"text": "  ", "children": []}]}}
\`\`\``

  it('读成树：百分数的框换成比例、出界的框收进来、空节点丢掉、重复的猜测去掉', () => {
    const r = parseRecognition(answer)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.course).toBe('线性代数')
    expect(r.lecture).toBe(3)
    const root = r.roots[0]!
    expect(root.text).toBe('线性映射')
    expect(root.children.map((c) => c.text)).toEqual(['核与像'])
    expect(root.children[0]!.box).toEqual([0.6, 0.7, 0.1, 0.05])
    const k = root.children[0]!.children[0]!
    expect(k.unsure).toBe(true)
    expect(k.guesses).toEqual(['秩-零化度定理'])
    expect(k.box![0] + k.box![2]).toBeLessThanOrEqual(1)
    expect(k.box![1] + k.box![3]).toBeLessThanOrEqual(1.0000001)
  })

  it('不像导图、字太糊、没回 JSON', () => {
    expect(parseRecognition('{"mindmap": false}')).toMatchObject({ ok: false, reason: 'not-map' })
    expect(parseRecognition('{"mindmap": true, "legible": false}')).toMatchObject({ ok: false, reason: 'blurry' })
    expect(() => parseRecognition('认不出来')).toThrow(/没按要求/)
    expect(() => parseRecognition('{坏的')).toThrow()
  })

  it('JSON 里的花括号在字符串里也不乱', () => {
    expect(firstJson('前面 {"a": "}{", "b": {"c": 1}} 后面')).toBe('{"a": "}{", "b": {"c": 1}}')
  })
})

describe('新导图白板', () => {
  const d = new Date(2026, 10, 15, 21, 40)
  const roots: MapNode[] = [{ text: '线性映射', box: [0.4, 0.4, 0.2, 0.1], children: [{ text: '定义', children: [] }] }]

  it('名字、照片名、说明', () => {
    expect(mapTitle(d)).toBe('导图 11-15 21∶40')
    expect(photoName(d, 'jpg')).toBe('2026-11-15-2140.jpg')
    expect(photoCaption(d, 'iphone')).toBe('原照片 · 11 月 15 日 21:40 · iPhone')
    expect(photoCaption(d, 'airdrop')).toBe('原照片 · 11 月 15 日 21:40')
  })

  it('属性当场填好，AI 填的记下来，正文是照片加大纲', () => {
    const t = mindmapNote({
      title: mapTitle(d),
      notePath: '收件箱/导图 11-15 21∶40.md',
      photoPath: '附件/导图/2026-11-15-2140.jpg',
      caption: photoCaption(d, 'iphone'),
      roots,
      from: 'iphone',
      course: '线性代数',
      lecture: 3,
      ai: ['课程', '第几讲'],
      day: '2026-11-15',
    })
    expect(isMindmap(t)).toBe(true)
    expect(prop(t, '类型')).toBe('导图')
    expect(prop(t, '课程')).toBe('线性代数')
    expect(prop(t, '第几讲')).toBe('3')
    expect(prop(t, '来源')).toBe('iPhone 拍的')
    expect(aiFilled(t)).toEqual(['课程', '第几讲'])
    expect(t).toContain('![原照片 · 11 月 15 日 21:40 · iPhone](../附件/导图/2026-11-15-2140.jpg)\n\n- 线性映射 <!-- box=0.4,0.4,0.2,0.1 -->\n  - 定义\n')
    expect(parseMindmap(t).roots[0]!.text).toBe('线性映射')
  })

  it('课程列表', () => {
    expect(coursesOf(['课程/线性代数/a.md', '课程/概率论/x/b.md', '课程/c.md', '收件箱/d.md'])).toEqual(['概率论', '线性代数'])
  })
})

describe('导图排版', () => {
  const tree: MapNode[] = [
    {
      text: '中心',
      children: [
        { text: '甲', children: [{ text: 'a1', children: [] }, { text: 'a2', children: [] }] },
        { text: '乙', unsure: true, children: [{ text: 'b1', children: [] }] },
      ],
    },
  ]
  const measure = (t: string) => t.length * 10

  it('照片在左，中心在照片右边 70；每层一列；父节点对着孩子的中间', () => {
    const L = layoutMindmap(tree, measure, 0.75)
    expect(L.photo).toEqual({ x: 100, y: expect.any(Number), w: 300, h: 259 })
    const c = L.byKey['0']!
    expect(c.x).toBe(470)
    expect(L.byKey['0.0']!.x).toBe(470 + c.w + 56)
    expect(L.byKey['0.1']!.x).toBe(L.byKey['0.0']!.x)
    expect(L.byKey['0.0.0']!.x).toBe(L.byKey['0.0']!.x + Math.max(L.byKey['0.0']!.w, L.byKey['0.1']!.w) + 44)
    // 叶子一行 34，组之间多 16
    expect(L.byKey['0.0.1']!.y - L.byKey['0.0.0']!.y).toBe(34)
    expect(L.byKey['0.1.0']!.y - L.byKey['0.0.1']!.y).toBe(34 + 16)
    const a = L.byKey['0.0']!
    expect(a.y + a.h / 2).toBeCloseTo((L.byKey['0.0.0']!.y + L.byKey['0.0.1']!.y) / 2 + 13, 0)
    // 拿不准的多留出「?」的宽
    expect(L.byKey['0.1']!.w).toBe(10 + 28 + 22)
    // 照片的中线对着中心（取整差不到 1px）
    expect(Math.abs(L.photo!.y + L.photo!.h / 2 - (c.y + c.h / 2))).toBeLessThanOrEqual(1)
    expect(L.wires).toHaveLength(5)
    expect(L.w).toBeGreaterThan(L.byKey['0.0.0']!.x)
  })

  it('照片比树高时整棵树往下挪，照片不出画布', () => {
    const L = layoutMindmap([{ text: '只有中心', children: [] }], measure, 1.4)
    expect(L.photo!.y).toBe(70)
    expect(L.photo!.y + L.photo!.h / 2).toBeCloseTo(L.byKey['0']!.y + 21, 0)
  })

  it('收起来的节点不排孩子', () => {
    const L = layoutMindmap(tree, measure, null, new Set(['0.0']))
    expect(L.byKey['0.0.0']).toBeUndefined()
    expect(L.byKey['0']!.x).toBe(100)
  })

  it('连线从父的右边到子的左边，第二层接下划线', () => {
    const L = layoutMindmap(tree, measure, null)
    const p = wirePath(L.byKey['0.0']!, L.byKey['0.0.0']!)
    const b = L.byKey['0.0.0']!
    expect(p.endsWith(`${b.x} ${b.y + b.h}`)).toBe(true)
  })
})

describe('核对窗口的大纲', () => {
  const tree: MapNode[] = [{ text: '中心', children: [{ text: '甲', children: [{ text: 'a', children: [] }] }, { text: '乙', unsure: true, guesses: ['乙'], children: [] }] }]

  it('树和行来回不变', () => {
    const rows = toRows(tree)
    expect(rows.map((r) => [r.depth, r.text])).toEqual([[0, '中心'], [1, '甲'], [2, 'a'], [1, '乙']])
    expect(fromRows(rows)).toEqual(tree)
  })

  it('缩进连子行一起走，最多比上一行深一层；空行丢掉；跳级收回', () => {
    const rows = toRows(tree)
    const r1 = indentRows(rows, 3, 1)
    expect(r1.map((r) => r.depth)).toEqual([0, 1, 2, 2])
    expect(indentRows(r1, 3, 1).map((r) => r.depth)).toEqual([0, 1, 2, 3])
    expect(indentRows(rows, 1, -1).map((r) => r.depth)).toEqual([0, 0, 1, 1])
    expect(indentRows(rows, 0, 1)).toBe(rows)
    const odd = [{ key: 'a', depth: 0, text: '根' }, { key: 'b', depth: 3, text: '深' }, { key: 'c', depth: 1, text: '  ' }]
    expect(fromRows(odd)).toEqual([{ text: '根', children: [{ text: '深', children: [] }] }])
  })
})

describe('首页「最近的白板」里导图的缩略图', () => {
  it('节点数和节点位置；有照片时左边一块照片', () => {
    const md = '---\ntype: board\n白板样式: 导图\n---\n# 导图\n\n![原照片](../附件/a.jpg)\n\n- 线性映射\n  - 定义\n    - 加法\n  - 核与像\n'
    const roots = parseMindmap(md).roots
    const t = mindmapThumb(roots, true)
    expect(t.nodes).toBe(4)
    expect(t.thumb.filter((r) => r.k === 'm')).toHaveLength(4)
    expect(t.thumb[0]!.k).toBe('i')
    // 节点都在照片右边
    const m = t.thumb.filter((r) => r.k === 'm')
    expect(Math.min(...m.map((r) => r.x))).toBeGreaterThan(t.thumb[0]!.x + t.thumb[0]!.w)
    expect(mindmapThumb(roots, false).thumb.every((r) => r.k === 'm')).toBe(true)
  })
})
