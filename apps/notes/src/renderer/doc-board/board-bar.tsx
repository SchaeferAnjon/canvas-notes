/**
 * 白板选了两张起的那一条（task-5ryf9，设计稿 17-白板框选 方向 A，内容照方向 B 原型白板选中 5 张那条，加「AI整理」）：
 * 已选N张 · 对齐 ▾ · 放进列 ▾ · 问AI · AI整理 · 出卡 · 费曼讲这几张 ｜ 复制 · 删除 · ⋯（「费曼讲这几张」task-yvabi：这几张就是材料，直接开始）
 * 每一样都写成对文档那几段的改动（偏好「白板文档一份字」），一步一撤（⌘Z、底部提示的「撤回」）；动到两篇的（挪进新白板、移到别的笔记）两篇一次提交，撤回两篇一起回去。
 */
import { addSection, appendPlaced, type DocBoard, type DocUnit, freshId, mergeUnits, moveUnits, placeUnits, removeUnits, replaceUnits, splitDoc, unitKeys } from '@cn/format'
import { useState, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import type { NoteFile } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import { pickCards } from '../ai-cards'
import { app } from '../ctx/actions'
import { useT } from '../i18n'
import { keyFor } from '../keys'
import { NoteDoc } from '../note-doc'
import { anchorOf, type PopAnchor } from '../pop-place'
import { type BarItem, SelBar } from '../multi-select/SelBar'
import { type MenuRow, SelMenu } from '../multi-select/SelMenu'
import { InfoCard, NotePick } from '../multi-select/SelPopups'
import { type AlignKind, alignPlaced } from './board-select'

type Rect = { x: number; y: number; w: number; h: number }

export interface BoardBarCtx {
  notePath: string
  readOnly: boolean
  board: DocBoard
  keys: Map<DocUnit, string>
  byKey: Map<string, DocUnit>
  selected: Set<string>
  setSelected(s: Set<string>): void
  /** 量到的每张卡在白板上的位置（白板坐标） */
  rects: Record<string, Rect>
  colW: number
  cur: MutableRefObject<string>
  write(next: string, what: string, extra?: { undo?: () => void }): boolean
  /** 改了这篇、不进白板自己的 ⌘Z（两篇一次提交那种，撤回走提交） */
  apply(next: string): void
  toast(text: string, undo?: () => void): void
  pendingRename: MutableRefObject<{ name: string; filled?: boolean } | null>
  removeKeys(ks: Iterable<string>): void
  notes: NoteFile[]
  plane: RefObject<HTMLDivElement | null>
  wrap: RefObject<HTMLDivElement | null>
  /** 拖着卡、拖着框：条先藏起来 */
  hidden: boolean
  /** 改着字、看着全文、展开着数据库：不出这条 */
  off: boolean
  /** 菜单收起、做完一样以后焦点回到白板（接着按 ⌘A、⌘Z、⌫） */
  focus(): void
  /** 这块白板在前台（标签选中、白板看法）：不在前台不出这条 */
  active: boolean
  /** 「费曼讲这几张」：这几张交给费曼学习（DocBoardView 摆列、盖卡） */
  feynman(keys: Set<string>): void
  /** 「样式 ▾」：这几张的卡片样式浮层（白板装饰 decor/layer.tsx） */
  style?(keys: Set<string>, el: HTMLElement): void
}

/** 窄了按这个先后收进「⋯」（原型：复制 → 出卡 → 费曼 → 移到 → 对齐 → 放进列；AI整理排在对齐后面） */
const FOLD = ['copy', 'anki', 'feynman', 'style', 'align', 'tidy', 'col']

export function useBoardBar(c: BoardBarCtx): { node: ReactNode; act(k: string, el?: HTMLElement): void } {
  const t = useT()
  const [menu, setMenu] = useState<{ k: string; at: PopAnchor; folded: string[]; find?: string } | null>(null)
  const [info, setInfo] = useState<{ at: PopAnchor } | null>(null)
  const units = [...c.selected].map((k) => c.byKey.get(k)).filter((u): u is DocUnit => !!u)
  const n = units.length
  const placed = units.filter((u) => u.place)
  const order = [...units].sort((a, b) => a.from - b.from)
  const md = () => order.map((u) => c.cur.current.slice(u.from, u.to).trim()).join('\n\n')
  /** 按名字在现在的全文里找回选中的几张（连点几下时 props.text 可能还没跟上） */
  const fresh = (text: string) => {
    const now = new Map([...unitKeys(splitDoc(text))].map(([u, k]) => [k, u]))
    return [...c.selected].map((k) => now.get(k)).filter((u): u is DocUnit => !!u)
  }

  const items: BarItem[] = [
    { k: 'align', label: t('对齐'), icon: 'list-flat', menu: true, tip: t('对齐和等距：只挪空白处的卡，列里的卡照文档顺序') },
    { k: 'col', label: t('放进列'), icon: 'split-horizontal', menu: true, tip: t('放进一列、或者挪进一块新白板') },
    { k: 'ai', label: t('问AI'), ai: true, keep: true, tip: t('把这几张一起交给 AI：总结、出题、画导图'), keys: keyFor('ask-ai') },
    { k: 'tidy', label: t('AI整理'), ai: true, tip: t('AI 把这几张重新归类、排好、起标题：先给你看改前改后，收下才写') },
    { k: 'anki', label: t('出卡'), icon: 'symbol-event', tip: t('出卡：AI 先把这几张改成问答卡，一张张过，再送进 Anki') },
    { k: 'feynman', label: t('费曼讲这几张'), icon: 'mortar-board', tip: t('费曼学习：讲给 AI 学生听，讲的时候这几张先盖住') },
    ...(c.style ? [{ k: 'style', label: t('样式'), icon: 'paintcan' as const, menu: true as const, tip: t('卡片样式：纸面、磨砂玻璃、描边、彩头、横线纸，颜色跟主题的六色') }] : []),
    { k: 'copy', icon: 'copy', tip: t('拷贝'), keys: keyFor('copy'), sep: true },
    { k: 'delete', icon: 'trash', tip: t('删除'), keys: keyFor('delete'), red: true },
    { k: 'more', icon: 'ellipsis', tip: t('更多') },
  ]

  // ---------- 各样动作 ----------
  const align = (kind: AlignKind) => {
    const cards = placed.map((u) => {
      const key = c.keys.get(u)!
      const r = c.rects[key]
      return { key, unit: u, x: u.place!.x, y: u.place!.y, w: r?.w ?? c.colW, h: r?.h ?? 120 }
    })
    const next = alignPlaced(cards, kind, c.colW)
    const moves = cards.flatMap((x) => {
      const p = next.get(x.key)!
      return p.x === x.x && p.y === x.y ? [] : [{ unit: x.unit, x: p.x, y: p.y }]
    })
    const did: Record<AlignKind, string> = {
      left: t('左对齐了'),
      hc: t('水平居中了'),
      right: t('右对齐了'),
      top: t('顶对齐了'),
      vc: t('垂直居中了'),
      bottom: t('底对齐了'),
      dh: t('横着等距了'),
      dv: t('竖着等距了'),
      tidy: t('排整齐了'),
    }
    if (!moves.length) return c.toast(t('已经是这样摆的了，文件没动'))
    c.write(placeUnits(c.cur.current, moves), t('{did}：只改了这{n}张的位置行，正文一个字没动', { did: did[kind], n: cards.length }))
  }
  const intoNewColumn = () => {
    // 不翻：写进文件的列名（和工具板「列」一样）
    const name = '新的列'
    const t1 = addSection(c.cur.current, name, null, c.board.level)
    const col = splitDoc(t1).columns.at(-1)!
    c.pendingRename.current = { name, filled: true }
    c.write(moveUnits(t1, fresh(c.cur.current), col, null), t('放进了新的一列：文档末尾新起一节「## 新的列」，这{n}段挪了进去', { n }))
    c.setSelected(new Set())
  }
  const intoColumn = (ci: number) => {
    const col = splitDoc(c.cur.current).columns[ci]
    if (!col) return
    c.write(moveUnits(c.cur.current, fresh(c.cur.current), col, null), t('放进了「{name}」：这{n}段挪到那一节末尾，位置行去掉了', { name: col.title ?? t('开头'), n }))
    c.setSelected(new Set())
  }
  /** 两篇一次提交（挪进新白板、移到别的笔记）：底部提示的「撤回」两篇一起回去 */
  const commitTwo = async (other: string, msg: string, back: string) => {
    await NoteDoc.saveAll()
    const hash = await window.cn.boardCommit([c.notePath, other], msg)
    app().refresh()
    c.toast(msg, () => {
      if (!hash) return
      void NoteDoc.saveAll().then(() => window.cn.boardRevert(hash).then(() => (app().refresh(), c.toast(back))))
    })
  }
  const intoNewBoard = async () => {
    const list = fresh(c.cur.current)
    const body = [...list].sort((a, b) => a.from - b.from).map((u) => c.cur.current.slice(u.from, u.to).trim()).join('\n\n')
    const dir = c.notePath.includes('/') ? c.notePath.slice(0, c.notePath.lastIndexOf('/')) : ''
    // 不翻：写进文件的属性和名字
    const path = await window.cn.createNote(dir, '新的白板', `---\ntype: board\n所属白板: "[[${titleOf(c.notePath)}]]"\n---\n${body}\n`)
    const name = titleOf(path)
    c.apply(replaceUnits(c.cur.current, list, `[[${name}]]`))
    c.setSelected(new Set())
    try {
      await commitTwo(path, t('挪进了新白板《{name}》：新建了一篇放这{n}段，这里留一张子白板卡；两篇一次提交', { name, n: list.length }), t('撤回了：那几段回到了白板上，新白板也没了'))
    } catch (e) {
      c.toast(String((e as Error).message ?? e))
    }
  }
  const moveToNote = async (target: string) => {
    const list = fresh(c.cur.current)
    const body = [...list].sort((a, b) => a.from - b.from).map((u) => c.cur.current.slice(u.from, u.to).trim()).join('\n\n')
    try {
      const open = [...NoteDoc.open].find((d) => d.path === target && !d.readOnly)
      if (open) {
        const v = open.view
        const text = v.state.doc.toString()
        const end = text.replace(/\n+$/, '').length
        v.dispatch({ changes: { from: end, to: text.length, insert: (end ? '\n\n' : '') + body + '\n' }, userEvent: 'input.drop' })
      } else {
        const now = (await window.cn.readNote(target)).text
        const r = await window.cn.writeNote(target, now.replace(/\n+$/, '') + (now.trim() ? '\n\n' : '') + body + '\n', now)
        if (!r.ok) throw new Error(t('《{name}》刚被别处改过，这次没挪', { name: titleOf(target) }))
      }
      c.apply(removeUnits(c.cur.current, list))
      c.setSelected(new Set())
      await commitTwo(target, t('挪了{n}张到《{name}》：两篇一次提交，撤回两篇一起回去', { n: list.length, name: titleOf(target) }), t('撤回了：那几段回到了白板上'))
    } catch (e) {
      c.toast(String((e as Error).message ?? e))
    }
  }
  const dup = () => {
    let text = c.cur.current
    const ids: string[] = []
    for (const u of order) {
      const r = c.rects[c.keys.get(u)!]
      const x = (u.place?.x ?? r?.x ?? 0) + 24
      const y = (u.place?.y ?? r?.y ?? 0) + 24
      ids.push(freshId(text))
      text = appendPlaced(text, c.cur.current.slice(u.from, u.to), x, y)
    }
    if (c.write(text, t('复制了一份：文档末尾多了这{n}段，各带一行位置', { n }))) c.setSelected(new Set(ids))
  }
  const merge = () => {
    try {
      const r = mergeUnits(c.cur.current, fresh(c.cur.current))
      if (c.write(r.text, t('合成了一张：这{n}段挪到一起、字不改，前面一行记着「这{n}段是一张」', { n }))) c.setSelected(new Set([r.id]))
    } catch (e) {
      c.toast(String((e as Error).message ?? e))
    }
  }
  const copy = () => {
    const text = md()
    void navigator.clipboard.writeText(text).then(
      () => c.toast(t('拷贝了{n}张：贴进文档是这{n}段原文，贴进白板是{n}张卡', { n })),
      (e) => c.toast(String((e as Error).message ?? e)),
    )
  }
  /** 交给 AI 的这几张（问AI、AI整理） */
  const pick = () =>
    pickCards({
      path: c.notePath,
      where: 'board',
      base: c.cur.current,
      items: order.map((u) => ({ key: c.keys.get(u)!, from: u.from, to: u.to, text: c.cur.current.slice(u.from, u.to) })),
    })

  const act = (k: string, el?: HTMLElement, folded: string[] = []) => {
    if (k !== 'more' && k !== menu?.k) setMenu(null)
    setInfo(null)
    if (!n) return
    const at = el ? anchorOf(el) : null
    switch (k) {
      case 'align':
      case 'col':
      case 'more':
        if (menu?.k === k) return setMenu(null)
        if (at) setMenu({ k, at, folded })
        return
      case 'ai':
        pick()
        return app().runAi()
      case 'tidy':
        pick()
        // 不翻：/ 命令的名字（AiPanel 按名字认）
        return app().runAi('/整理这几张')
      case 'anki':
        if (at) setInfo({ at })
        return
      case 'feynman':
        return c.feynman(new Set(c.selected))
      case 'style':
        if (el) c.style?.(new Set(c.selected), el)
        return
      case 'copy':
        return copy()
      case 'delete':
        return c.removeKeys(c.selected)
      case 'dup':
        return dup()
      case 'merge':
        return merge()
      case 'all':
        return c.setSelected(new Set(c.keys.values()))
      case 'none':
        return c.setSelected(new Set())
    }
  }

  // ---------- 菜单的几行 ----------
  const rowsOf = (k: string, folded: string[]): MenuRow[] => {
    if (k === 'align') {
      const frees = placed.length
      const inCol = n - frees
      const off = frees < 2
      return [
        { head: t('只挪空白处的{n}张', { n: frees }) },
        ...(off ? [{ note: t('选中的都在列里：列里的卡照文档顺序一张接一张，不用对齐。') }] : inCol ? [{ note: t('列里的{n}张照文档顺序，不跟着挪。', { n: inCol }) }] : []),
        { v: 'left', label: t('左对齐'), glyph: 'left', off },
        { v: 'hc', label: t('水平居中'), glyph: 'hc', off },
        { v: 'right', label: t('右对齐'), glyph: 'right', off },
        'sep',
        { v: 'top', label: t('顶对齐'), glyph: 'top', off },
        { v: 'vc', label: t('垂直居中'), glyph: 'vc', off },
        { v: 'bottom', label: t('底对齐'), glyph: 'bottom', off },
        'sep',
        { v: 'dh', label: t('横着等距'), glyph: 'dh', off: frees < 3 },
        { v: 'dv', label: t('竖着等距'), glyph: 'dv', off: frees < 3 },
        { v: 'tidy', label: t('排整齐'), glyph: 'tidy', off },
      ]
    }
    if (k === 'col') {
      const cols = c.board.columns.map((col, ci) => ({ col, ci })).filter((x) => x.col.head && !x.col.ask && x.col.title)
      return [
        { v: 'new', label: t('放进新的一列'), icon: 'split-horizontal' },
        'sep',
        { head: t('放进已有的列') },
        ...cols.map((x) => ({ v: 'col:' + x.ci, label: t('放进「{name}」', { name: x.col.title! }), icon: 'arrow-right' as const })),
        'sep',
        { v: 'board', label: t('挪进一块新白板'), icon: 'layout' },
      ]
    }
    const lead: MenuRow[] = folded.flatMap((f) => {
      const it = items.find((x) => x.k === f)
      return it ? [{ v: 'fold:' + f, label: it.label ?? it.tip, ...(it.ai ? { ai: true as const } : it.icon ? { icon: it.icon } : {}), keys: it.keys }] : []
    })
    return [
      ...lead,
      ...(lead.length ? ['sep' as const] : []),
      { v: 'merge', label: t('合成一张'), icon: 'combine' },
      { v: 'dup', label: t('复制一份'), icon: 'copy', keys: keyFor('dup-block') },
      { v: 'moveto', label: t('移到别的笔记…'), icon: 'go-to-file' },
      'sep',
      { v: 'all', label: t('全选'), icon: 'check', keys: keyFor('select-all') },
      { v: 'none', label: t('取消选择'), icon: 'close', keys: 'esc' },
    ]
  }
  const pickMenu = (v: string) => {
    const m = menu
    setMenu(null)
    c.focus()
    if (!m) return
    if (v.startsWith('fold:')) return act(v.slice(5), undefined)
    if (m.k === 'align') return align(v as AlignKind)
    if (m.k === 'col') {
      if (v === 'new') return intoNewColumn()
      if (v === 'board') return void intoNewBoard()
      return intoColumn(Number(v.slice(4)))
    }
    if (v === 'moveto') return setMenu({ k: 'moveto', at: m.at, folded: [], find: '' })
    act(v)
  }

  const show = n >= 2 && !c.off && c.active
  const node = show ? (
    <>
      <SelBar
        count={t('已选{n}张', { n })}
        items={c.readOnly ? items.filter((it) => ['ai', 'copy', 'more'].includes(it.k)) : items}
        foldOrder={FOLD}
        label={t('选中的几张')}
        testid="db-selbar"
        hidden={c.hidden}
        open={menu?.k ?? (info ? 'anki' : null)}
        scrollers={[c.wrap.current]}
        measure={() => {
          const area = c.wrap.current?.parentElement
          if (!area || !c.wrap.current?.checkVisibility()) return null
          const rs = [...c.selected].flatMap((k) => {
            const el = c.plane.current?.querySelector<HTMLElement>(`.db-card[data-id="${CSS.escape(k)}"], .db-askgroup[data-id="${CSS.escape(k)}"]`)
            return el ? [el.getBoundingClientRect()] : []
          })
          const a = area.getBoundingClientRect()
          const sel = rs.length ? { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) } : null
          return { sel, area: { left: a.left, top: a.top, right: a.right, bottom: a.bottom } }
        }}
        onAct={(k, el, folded) => act(k, el, folded)}
      />
      {menu && menu.k !== 'moveto' && (
        <SelMenu
          at={menu.at}
          label={menu.k === 'align' ? t('对齐') : menu.k === 'col' ? t('放进列') : t('更多')}
          testid={'db-menu-' + menu.k}
          rows={rowsOf(menu.k, menu.folded)}
          onPick={pickMenu}
          onClose={() => (setMenu(null), c.focus())}
        />
      )}
      {menu?.k === 'moveto' && <NotePick at={menu.at} notes={c.notes} self={c.notePath} openPaths={new Set([...NoteDoc.open].map((d) => d.path))} onPick={(p) => (setMenu(null), c.focus(), void moveToNote(p))} onClose={() => (setMenu(null), c.focus())} />}
      {info && (
        <InfoCard at={info.at} title={t('出卡 · 这{n}张', { n })} onClose={() => (setInfo(null), c.focus())}>
          {t('开读 PDF 出卡用的同一个弹窗：AI 先把这{n}张改成问答卡（学习卡 · 问答），一张张过，再送进 Anki；牌组照这篇所在的文件夹。白板上的字不改。', { n })}
        </InfoCard>
      )}
    </>
  ) : null
  return { node, act: (k, el) => act(k, el) }
}

