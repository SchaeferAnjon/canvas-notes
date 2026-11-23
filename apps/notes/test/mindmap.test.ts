import { isMindmap, parseMindmap, prop, aiFilled, type MapNode } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { cameraKind, coursesOf, firstJson, fromRows, indentRows, mapTitle, mindmapNote, parentName, parseRecognition, photoCaption, photoName, toRows } from '../src/shared/mindmap'
import { dropAt, insertLine, LAYOUTS, layoutMindmap, type MapLayout, mindmapThumb, NODE_MAX_W, wireOf, wirePath, type Measure } from '../src/shared/mindmap-layout'

describe('认摄像头', () => {
  it('这台 M3 Max 上 Electron 列出来的名字', () => {
    expect(cameraKind('FaceTime HD Camera (467C:1317)')).toBe('mac')
    expect(cameraKind('Alex Camera')).toBe('iphone')
    expect(cameraKind('Alex Desk View Camera')).toBe('desk')
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
    expect(parentName(t)).toBeUndefined()
  })

  it('从白板、笔记拍的：放在那一篇的文件夹里，属性记上所属（面包屑靠它回去），照片链接按新位置算', () => {
    const base = { title: mapTitle(d), photoPath: '附件/导图/2026-11-15-2140.jpg', caption: photoCaption(d, 'iphone'), roots, from: 'iphone' as const, ai: [], day: '2026-11-15' }
    const sub = mindmapNote({ ...base, notePath: '课程/线性代数/导图 11-15 21∶40.md', parent: { as: 'board', name: '复习' } })
    expect(prop(sub, '所属白板')).toBe('[[复习]]')
    expect(parentName(sub)).toBe('复习')
    expect(sub).toContain('](../../附件/导图/2026-11-15-2140.jpg)')
    expect(isMindmap(sub)).toBe(true)
    const side = mindmapNote({ ...base, notePath: '导图 11-15 21∶40.md', parent: { as: 'note', name: '读书笔记' } })
    expect(prop(side, '所属笔记')).toBe('[[读书笔记]]')
    expect(parentName(side)).toBe('读书笔记')
    expect(side).toContain('](附件/导图/2026-11-15-2140.jpg)')
    expect(parentName('---\n所属白板: [[a|别名]]\n---\n')).toBe('a')
    expect(parentName('# 没有属性\n所属白板: "[[a]]"\n')).toBeUndefined()
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
  // 一个字 10 宽、一行 18 高；放不下就按行数折
  const measure: Measure = (t, _l, max) => ({ w: Math.min(t.length * 10, max), h: Math.ceil((t.length * 10) / max) * 18 })

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

  it('长的字到最宽 260 换行、节点变高；变高的节点和上下的不重叠，连线接在新的位置上（task-wuv05）', () => {
    const long = (n: number) => '字'.repeat(n)
    const big: MapNode[] = [
      {
        text: '中心',
        children: [
          { text: '短', children: [{ text: 'a', children: [] }] },
          // 父节点三行高、只有一个孩子：比孩子高，整棵往下挪
          { text: long(60), children: [{ text: 'b', children: [] }] },
          { text: '乙', children: [{ text: long(50), children: [] }, { text: 'c', children: [] }, { text: long(30), children: [] }] },
          { text: long(80), unsure: true, children: [] },
        ],
      },
    ]
    const L = layoutMindmap(big, measure, null)
    for (const n of L.nodes) expect(n.w).toBeLessThanOrEqual(NODE_MAX_W)
    const p = L.byKey['0.1']!
    expect(p.w).toBe(NODE_MAX_W)
    // 60 个字在 232 宽里排 3 行：3 × 18 + 上下 12
    expect(p.h).toBe(3 * 18 + 12)
    expect(L.byKey['0.3']!.w).toBe(NODE_MAX_W)
    expect(L.byKey['0.2.0']!.h).toBe(Math.ceil(500 / 252) * 18 + 6)
    // 同一列两两不重叠
    for (const a of L.nodes)
      for (const b of L.nodes) {
        if (a === b) continue
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(hit, `${a.key} 和 ${b.key} 重叠`).toBe(false)
      }
    // 父节点还是对着孩子（孩子跟着挪了）
    const kid = L.byKey['0.1.0']!
    expect(p.y + p.h / 2).toBeCloseTo(kid.y + kid.h / 2, 0)
    // 连线从变宽的节点右边出发
    expect(wirePath(p, kid).startsWith(`M${p.x + p.w} ${p.y + p.h / 2}`)).toBe(true)
  })
})

describe('导图排版：三种布局（task-wuv05 第一批，分派表）', () => {
  const measure: Measure = (t, _l, max) => ({ w: Math.min(t.length * 10, max), h: Math.ceil((t.length * 10) / max) * 18 })
  const leaf = (text: string): MapNode => ({ text, children: [] })
  const long = (n: number) => '字'.repeat(n)
  // 线性映射那张（设计稿里的），第一层四个，「核与像」下面一个长的
  const map: MapNode[] = [
    {
      text: '线性映射',
      children: [
        { text: '定义', children: [leaf('T(u+v)=T(u)+T(v)'), leaf('T(cv)=cT(v)'), leaf('先加再映射，和先映射再加，结果一样；数乘也一样')] },
        { text: '矩阵表示', children: [leaf('列 = 基向量的像'), leaf('复合 = 矩阵相乘')] },
        { text: '核与像', children: [leaf('ker T 映到 0'), leaf(long(40)), { text: '秩-零化度定理', children: [leaf('dim')] }] },
        { text: '例子', children: [leaf('旋转'), leaf('投影'), leaf('求导 d/dx')] },
      ],
    },
  ]
  const noOverlap = (L: MapLayout) => {
    for (const a of L.nodes)
      for (const b of L.nodes) {
        if (a === b) continue
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(hit, `${a.key} 和 ${b.key} 重叠`).toBe(false)
      }
    if (L.photo) for (const n of L.nodes) expect(n.x, `${n.key} 压着照片`).toBeGreaterThan(L.photo.x + L.photo.w)
    for (const n of L.nodes) expect(n.w).toBeLessThanOrEqual(NODE_MAX_W)
  }

  it('布局是一张分派表：五种都在，不认识的按向右排', () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual(['both', 'down', 'fish', 'right', 'time'])
    const r = layoutMindmap(map, measure, null, new Set(), { kind: 'right' })
    const odd = layoutMindmap(map, measure, null, new Set(), { kind: 'matrix' as never })
    expect(odd.nodes.map((n) => [n.key, n.x, n.y])).toEqual(r.nodes.map((n) => [n.key, n.x, n.y]))
    expect(r.kind).toBe('right')
    expect(r.nodes.every((n) => n.side === 'r' && !n.boxed)).toBe(true)
  })

  it('左右展开：第一层前一半在右边、后一半倒着在左边（顺时针读）；两边各自一列列对齐，不重叠；照片在最左边', () => {
    const L = layoutMindmap(map, measure, 0.75, new Set(), { kind: 'both' })
    const c = L.byKey['0']!
    const [def, mat, ker, ex] = ['0.0', '0.1', '0.2', '0.3'].map((k) => L.byKey[k]!)
    expect([def.side, mat.side, ker.side, ex.side]).toEqual(['r', 'r', 'l', 'l'])
    // 右边：定义在上、矩阵表示在下；左边：例子在上、核与像在下
    expect(def.y).toBeLessThan(mat.y)
    expect(ex.y).toBeLessThan(ker.y)
    expect(def.x).toBe(c.x + c.w + 56)
    expect(mat.x).toBe(def.x)
    expect(ker.x + ker.w).toBe(c.x - 56)
    expect(ex.x + ex.w).toBe(c.x - 56)
    // 左边往下一层：右边对齐成一列，在第一层左边 44 以外
    const kk = ['0.2.0', '0.2.1', '0.2.2', '0.3.0'].map((k) => L.byKey[k]!)
    for (const n of kk) {
      expect(n.side).toBe('l')
      expect(n.x + n.w).toBe(Math.min(ker.x, ex.x) - 44)
    }
    expect(L.byKey['0.2.2.0']!.x + L.byKey['0.2.2.0']!.w).toBeLessThanOrEqual(L.byKey['0.2.2']!.x - 44)
    noOverlap(L)
    // 照片在整张图最左边，中线对着中心
    expect(L.photo!.x).toBe(100)
    expect(Math.abs(L.photo!.y + L.photo!.h / 2 - (c.y + c.h / 2))).toBeLessThanOrEqual(1)
    // 左边的线从中心的左边连到孩子的右边（第二层接下划线的右端）
    expect(wireOf('both', c, ker).startsWith(`M${c.x} ${c.y + c.h / 2}`)).toBe(true)
    expect(wireOf('both', c, ker).endsWith(`${ker.x + ker.w} ${ker.y + ker.h / 2}`)).toBe(true)
    const k0 = L.byKey['0.2.0']!
    expect(wireOf('both', ker, k0).endsWith(`${k0.x + k0.w} ${k0.y + k0.h}`)).toBe(true)
    expect(wireOf('both', c, def)).toBe(wirePath(c, def))
    expect(L.wires).toHaveLength(16)
    // 下划线主题往下一层：线从下划线那一头出去（折叠圆点也在那儿）
    const p2 = L.byKey['0.2.2']!
    expect(wireOf('both', p2, L.byKey['0.2.2.0']!).startsWith(`M${p2.x} ${p2.y + p2.h} `)).toBe(true)
    const R = layoutMindmap(map, measure, null, new Set(), { kind: 'right' })
    const r2 = R.byKey['0.2.2']!
    expect(wireOf('right', r2, R.byKey['0.2.2.0']!).startsWith(`M${r2.x + r2.w} ${r2.y + r2.h} `)).toBe(true)
  })

  it('向下展开：中心在上，第一层横着一排，往下竖着列、往右缩 22；第二层以下是小框；不重叠，照片在左上', () => {
    const L = layoutMindmap(map, measure, 0.75, new Set(), { kind: 'down' })
    const c = L.byKey['0']!
    const first = ['0.0', '0.1', '0.2', '0.3'].map((k) => L.byKey[k]!)
    for (const n of first) {
      expect(n.y).toBe(c.y + c.h + 48)
      expect(n.boxed).toBe(false)
    }
    // 从左到右照顺序，中间隔 28 以上
    for (let i = 1; i < 4; i++) expect(first[i]!.x).toBeGreaterThanOrEqual(first[i - 1]!.x + first[i - 1]!.w + 28)
    // 第一层往下这一整排（连着各自下面的）对着中心
    const below = L.nodes.filter((n) => n.depth >= 1)
    const rowMid = (Math.min(...below.map((n) => n.x)) + Math.max(...below.map((n) => n.x + n.w))) / 2
    expect(Math.abs(rowMid - (c.x + c.w / 2))).toBeLessThanOrEqual(1)
    const d0 = L.byKey['0.0.0']!
    const d1 = L.byKey['0.0.1']!
    expect(d0.x).toBe(first[0]!.x + 22)
    expect(d0.y).toBe(first[0]!.y + first[0]!.h + 10)
    expect(d1.y).toBe(d0.y + d0.h + 8)
    expect(d0.boxed).toBe(true)
    expect(d0.side).toBe('d')
    expect(L.byKey['0.2.2.0']!.x).toBe(L.byKey['0.2.2']!.x + 22)
    noOverlap(L)
    expect(L.photo!.y).toBe(Math.min(...L.nodes.map((n) => n.y)))
    // 中心到第一层：竖下来、横过去、再竖下去；往下一层：左边一道竖线拐进去
    expect(wireOf('down', c, first[0]!)).toMatch(new RegExp(`^M${c.x + c.w / 2} ${c.y + c.h}V`))
    expect(wireOf('down', first[0]!, d0)).toBe(`M${first[0]!.x + 10} ${first[0]!.y + first[0]!.h}V${d0.y + d0.h / 2 - 5}Q${first[0]!.x + 10} ${d0.y + d0.h / 2} ${first[0]!.x + 15} ${d0.y + d0.h / 2}H${d0.x}`)
  })

  it('三种布局里长字都到最宽换行、变高的不压着别的', () => {
    const big: MapNode[] = [{ text: '中心', children: [{ text: long(60), children: [leaf('b')] }, { text: '乙', children: [leaf(long(50)), leaf('c'), leaf(long(30))] }, { text: long(80), unsure: true, children: [] }] }]
    for (const kind of ['right', 'both', 'down'] as const) noOverlap(layoutMindmap(big, measure, 0.75, new Set(), { kind }))
  })

  it('拖到哪：主题正中间是放进去，上下边是排到前后（向下的第一层是左右边），离得远是放回原处；自己那一枝不算', () => {
    const R = layoutMindmap(map, measure, null, new Set(), { kind: 'right' })
    const ker0 = R.byKey['0.2.0']!
    const mid = { x: ker0.x + ker0.w / 2, y: ker0.y + ker0.h / 2 }
    expect(dropAt(R, '0.2.2', mid)).toEqual({ into: '0.2.0' })
    expect(dropAt(R, '0.2.2', { x: mid.x, y: ker0.y + 2 })).toEqual({ beside: '0.2.0', after: false })
    expect(dropAt(R, '0.2.2', { x: mid.x, y: ker0.y + ker0.h - 2 })).toEqual({ beside: '0.2.0', after: true })
    // 上面空一点的地方：离得最近的那个前面
    expect(dropAt(R, '0.2.2', { x: mid.x, y: ker0.y - 6 })).toEqual({ beside: '0.2.0', after: false })
    expect(dropAt(R, '0.2.2', { x: -500, y: -500 })).toBeNull()
    // 中心只能放进去；拖着的自己不算
    const c = R.byKey['0']!
    expect(dropAt(R, '0.2.2', { x: c.x + 3, y: c.y + 3 })).toEqual({ into: '0' })
    const self = R.byKey['0.2']!
    expect(dropAt(R, '0.2', { x: self.x + self.w / 2, y: self.y + self.h / 2 })).not.toEqual({ into: '0.2' })
    const line = insertLine(R, '0.2.0', false)!
    expect(line).toEqual({ x: ker0.x, y: ker0.y - 4 - 1, w: Math.max(ker0.w, 80), h: 2, across: false })
    // 向下：第一层看左右
    const D = layoutMindmap(map, measure, null, new Set(), { kind: 'down' })
    const m = D.byKey['0.1']!
    expect(dropAt(D, '0.3', { x: m.x + 2, y: m.y + m.h / 2 })).toEqual({ beside: '0.1', after: false })
    expect(dropAt(D, '0.3', { x: m.x + m.w - 2, y: m.y + m.h / 2 })).toEqual({ beside: '0.1', after: true })
    expect(insertLine(D, '0.1', true)).toEqual({ x: m.x + m.w + 14 - 1, y: m.y, w: 2, h: m.h, across: true })
  })

  it('只看这一枝：这一枝当中心画（还是原来的路径），照片不放；收着的照样不排孩子', () => {
    const L = layoutMindmap(map, measure, 0.75, new Set(['0.2.2']), { kind: 'right', focus: [0, 2] })
    expect(L.photo).toBeNull()
    expect(L.nodes.map((n) => n.key).sort()).toEqual(['0.2', '0.2.0', '0.2.1', '0.2.2'])
    expect(L.byKey['0.2']!.level).toBe('c')
    expect(L.byKey['0.2']!.depth).toBe(0)
    expect(L.byKey['0.2.0']!.level).toBe('l1')
    // 这一枝的中心落在整张图里中心主题原来的地方（设计稿：不顶到左上角）
    const whole = layoutMindmap(map, measure, 0.75, new Set(['0.2.2']), { kind: 'right' }).byKey['0']!
    const f = L.byKey['0.2']!
    expect(Math.abs(f.x + f.w / 2 - (whole.x + whole.w / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(f.y + f.h / 2 - (whole.y + whole.h / 2))).toBeLessThanOrEqual(1)
    // 左右展开时左边一半往左长，放不下就往右让，不出画布
    const both = layoutMindmap(map, measure, null, new Set(), { kind: 'both', focus: [0] })
    expect(Math.min(...both.nodes.map((n) => n.x))).toBeGreaterThanOrEqual(100)
  })
  // ---------- 第二批（task-wuv05）：鱼骨、时间线、骨架、外框、概要、浮动主题、联系线、图和备注 ----------

  it('鱼骨：中心（鱼头）在最右，脊骨往左；第一层上下交替斜着出去，下面的一条条挂在斜骨上；不重叠，照片在最左边', () => {
    const L = layoutMindmap(map, measure, 0.75, new Set(), { kind: 'fish' })
    noOverlap(L)
    const c = L.byKey['0']!
    expect(Math.max(...L.nodes.map((n) => n.x + n.w))).toBe(c.x + c.w)
    // 脊骨：从鱼头的左边往左，对着鱼头的中线
    expect(L.lines).toHaveLength(1)
    const spine = L.lines[0]!
    expect(spine.y1).toBe(c.y + c.h / 2)
    expect(spine.x1).toBe(c.x)
    expect(spine.x2).toBeLessThan(Math.min(...L.nodes.filter((n) => n.key !== '0').map((n) => n.x)))
    // 第一层：第一个在脊骨上面、第二个在下面……斜骨从脊骨上出去
    const k = ['0.0', '0.1', '0.2', '0.3'].map((x) => L.byKey[x]!)
    expect(k[0]!.y + k[0]!.h).toBeLessThan(spine.y1)
    expect(k[1]!.y).toBeGreaterThan(spine.y1)
    expect(k[2]!.y + k[2]!.h).toBeLessThan(spine.y1)
    for (const b of k) expect(b.via![0]!.y).toBe(spine.y1)
    // 下面的：横线在字下面，一头接着斜骨
    const rib = L.byKey['0.0.0']!
    expect(rib.via).toHaveLength(2)
    expect(rib.via![0]!.y).toBe(rib.y + rib.h)
    expect(wireOf('fish', c, rib)).toMatch(/^M[\d.]+ [\d.]+L/)
    expect(L.photo!.x + L.photo!.w).toBeLessThan(Math.min(...L.nodes.map((n) => n.x)))
  })

  it('时间线：中心在最左，横线往右、末端有箭头；第一层在线上，下面的上下交替挂着；不重叠', () => {
    const L = layoutMindmap(map, measure, null, new Set(), { kind: 'time' })
    noOverlap(L)
    const c = L.byKey['0']!
    expect(Math.min(...L.nodes.map((n) => n.x))).toBe(c.x)
    const line = L.lines[0]!
    expect(line.arrow).toBe(true)
    const mid = c.y + c.h / 2
    expect(line.y1).toBe(mid)
    const k = ['0.0', '0.1', '0.2', '0.3'].map((x) => L.byKey[x]!)
    // 第一层排在线上，从左往右
    for (const b of k) expect(b.y + b.h / 2).toBe(mid)
    for (let i = 1; i < k.length; i++) expect(k[i]!.x).toBeGreaterThan(k[i - 1]!.x + k[i - 1]!.w)
    expect(wireOf('time', c, k[0]!)).toBe('')
    // 第一个的孩子往下挂，第二个的往上挂
    expect(L.byKey['0.0.0']!.y).toBeGreaterThan(mid)
    expect(L.byKey['0.1.0']!.y + L.byKey['0.1.0']!.h).toBeLessThan(mid)
    // 竖线拐个圆角进到这一行
    expect(wireOf('time', k[0]!, L.byKey['0.0.0']!)).toContain('Q')
    // 拖到第一层旁边插入线是竖的
    expect(insertLine(L, '0.1', true)!.across).toBe(true)
  })

  it('骨架：线条是第一层也画下划线（线接在下划线上），方框是第二层以下都套框', () => {
    const line = layoutMindmap(map, measure, null, new Set(), { skeleton: 'line' })
    expect(line.byKey['0.0']!.ul).toBe(true)
    expect(line.byKey['0']!.ul).toBe(false)
    const a = line.byKey['0']!
    const b = line.byKey['0.0']!
    expect(wirePath(a, b).endsWith(`${b.x} ${b.y + b.h}`)).toBe(true)
    const box = layoutMindmap(map, measure, null, new Set(), { skeleton: 'box' })
    expect(box.nodes.filter((n) => n.level === 'l2').every((n) => n.boxed)).toBe(true)
    expect(box.byKey['0.0']!.boxed).toBe(false)
    noOverlap(box)
  })

  it('外框：框住从它起的几个同级连同下面的，四周空 10；有名字时前面多让出地方；不压着别的', () => {
    const framed: MapNode[] = [{ ...map[0]!, children: map[0]!.children.map((k, i) => (i === 1 ? { ...k, frame: { n: 2, title: '都能写成矩阵' } } : k)) }]
    const plain = layoutMindmap(map, measure, null)
    const L = layoutMindmap(framed, measure, null)
    noOverlap(L)
    expect(L.frames).toHaveLength(1)
    const f = L.frames[0]!
    expect(f.title).toBe('都能写成矩阵')
    const covered = L.nodes.filter((n) => /^0\.[12](\.|$)/.test(n.key))
    for (const n of covered) {
      expect(n.x).toBeGreaterThanOrEqual(f.x + 10)
      expect(n.y).toBeGreaterThanOrEqual(f.y + 10)
      expect(n.x + n.w).toBeLessThanOrEqual(f.x + f.w - 10)
      expect(n.y + n.h).toBeLessThanOrEqual(f.y + f.h - 10)
    }
    // 别的不在框里
    for (const n of L.nodes.filter((n) => /^0\.[03](\.|$)/.test(n.key))) expect(n.y + n.h <= f.y || n.y >= f.y + f.h).toBe(true)
    // 「定义」那一组和框隔开了（前面让出名字的地方）
    const gap = (lay: MapLayout) => lay.byKey['0.1']!.y - (lay.byKey['0.0.2']!.y + lay.byKey['0.0.2']!.h)
    expect(gap(L)).toBeGreaterThan(gap(plain) + 20)
  })

  it('概要：括号在那几个的右边（左右展开的左边一半在左边），一句话跟在括号外面；向下、鱼骨、时间线里不画', () => {
    const summed: MapNode[] = [{ ...map[0]!, children: map[0]!.children.map((k, i) => (i === 0 ? { ...k, children: k.children.map((c, j) => (j === 0 ? { ...c, sum: { n: 2, text: '线性的两条' } } : c)) } : k)) }]
    const L = layoutMindmap(summed, measure, null)
    expect(L.sums).toHaveLength(1)
    const s = L.sums[0]!
    const a = L.byKey['0.0.0']!
    const b = L.byKey['0.0.1']!
    expect(s.x).toBeGreaterThan(Math.max(a.x + a.w, b.x + b.w) + 20)
    expect(s.y + s.h / 2).toBeCloseTo((a.y + b.y + b.h) / 2, 0)
    expect(s.text).toBe('线性的两条')
    expect(s.bracket).toMatch(/^M[\d.]+ [\d.]+Q/)
    for (const kind of ['down', 'fish', 'time'] as const) expect(layoutMindmap(summed, measure, null, new Set(), { kind }).sums).toHaveLength(0)
    // 左右展开：「例子」在左边，它下面的概要画在左边
    const left: MapNode[] = [{ ...map[0]!, children: map[0]!.children.map((k, i) => (i === 3 ? { ...k, children: k.children.map((c, j) => (j === 0 ? { ...c, sum: { n: 3 } } : c)) } : k)) }]
    const both = layoutMindmap(left, measure, null, new Set(), { kind: 'both' })
    const ls = both.sums[0]!
    expect(ls.side).toBe('l')
    expect(ls.text).toBe('概要')
    expect(ls.x + ls.w).toBeLessThan(Math.min(...['0.3.0', '0.3.1', '0.3.2'].map((k) => both.byKey[k]!.x)))
  })

  it('浮动主题：根的左上角在中心中点加 at 那里，自己往右长；只看这一枝时不画；换布局不挪（还是相对中心）', () => {
    const withFloat: MapNode[] = [...map, { text: '先记一笔', at: [470, -250], children: [leaf('后来想到的')] }]
    for (const kind of ['right', 'down', 'fish'] as const) {
      const L = layoutMindmap(withFloat, measure, null, new Set(), { kind })
      const c = L.byKey['0']!
      const f = L.byKey['1']!
      expect(f.floatRoot).toBe(true)
      expect(f.level).toBe('l1')
      expect(f.x - (c.x + c.w / 2)).toBe(470)
      expect(f.y - (c.y + c.h / 2)).toBe(-250)
      const k = L.byKey['1.0']!
      expect(k.float).toBe(true)
      expect(k.x).toBeGreaterThan(f.x + f.w)
      expect(L.wires).toContainEqual({ from: '1', to: '1.0' })
    }
    const focus = layoutMindmap(withFloat, measure, null, new Set(), { focus: [0, 1] })
    expect(focus.byKey['1']).toBeUndefined()
    // 浮动主题的根只能放进去，不能排到它前后
    const L = layoutMindmap(withFloat, measure, null)
    const f = L.byKey['1']!
    expect(dropAt(L, '0.0', { x: f.x + 2, y: f.y + 2 })).toEqual({ into: '1' })
  })

  it('联系线：两头从主题边上出去，往外鼓、不压着中间的主题；改弯度跟着变；画布算上鼓出去的', () => {
    const L = layoutMindmap(map, measure, null, new Set(), { rels: [{ a: '0.0.0', b: '0.3.2' }, { a: '0.0', b: '9.9' }] })
    expect(L.rels[1]).toBeNull()
    const g = L.rels[0]!
    expect(g.d).toMatch(/^M[\d.]+ [\d.]+C/)
    expect(g.ah).toMatch(/Z$/)
    // 往右鼓（离中心远的那边），鼓到中间那几个主题的右边外面
    const between = L.nodes.filter((n) => n.y > L.byKey['0.0.0']!.y && n.y < L.byKey['0.3.2']!.y)
    expect(g.mx).toBeGreaterThan(Math.max(...between.map((n) => n.x + n.w)))
    expect(L.w).toBeGreaterThanOrEqual(g.right)
    const bent = layoutMindmap(map, measure, null, new Set(), { rels: [{ a: '0.0.0', b: '0.3.2', bend: 40 }] }).rels[0]!
    expect(bent.mx).toBeGreaterThan(g.mx)
    // 左右展开时两头都在左边：往左鼓
    const both = layoutMindmap(map, measure, null, new Set(), { kind: 'both', rels: [{ a: '0.2', b: '0.3' }] })
    const lg = both.rels[0]!
    expect(lg.mx).toBeLessThan(Math.min(both.byKey['0.2']!.x, both.byKey['0.3']!.x))
  })

  it('有备注的主题多出小图标的宽，挂图的主题图在字上面、跟着变高；都不压着别的', () => {
    const rich: MapNode[] = [
      {
        ...map[0]!,
        children: map[0]!.children.map((k, i) =>
          i === 3 ? { ...k, children: [{ text: '旋转', img: { alt: '旋转', src: 'a.png' }, imgW: 88, children: [] }, { text: '投影', note: '往一个子空间上投', children: [] }, leaf('求导 d/dx')] } : k,
        ),
      },
    ]
    const plain = layoutMindmap(map, measure, null)
    const L = layoutMindmap(rich, measure, null, new Set(), { imgAspect: () => 0.5 })
    noOverlap(L)
    expect(L.byKey['0.3.0']!.img).toEqual({ w: 88, h: 44 })
    expect(L.byKey['0.3.0']!.h).toBe(plain.byKey['0.3.0']!.h + 44 + 10)
    expect(L.byKey['0.3.1']!.w).toBe(plain.byKey['0.3.1']!.w + 24)
    // 链接只按露出来的字量宽
    const linked = layoutMindmap([{ text: '详见 [[课程/线代/第3讲 矩阵乘法|第3讲]]', children: [] }], measure, null)
    expect(linked.byKey['0']!.w).toBe(layoutMindmap([{ text: '详见 第3讲', children: [] }], measure, null).byKey['0']!.w)
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
