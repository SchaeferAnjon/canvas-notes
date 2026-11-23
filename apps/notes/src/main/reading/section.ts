/**
 * 一处的问答收成笔记里的一段（新格式，CN-93–96）：问题是发出去的原话、回答是 AI 的原文，旁支挂在被问那一问的回答后面；
 * 标题和小结是快的模型写的那两件小活，别的都不让 AI 改写。纯函数，单元测试直接跑（reading-section.test.ts）。
 */
import { type AskMat, type AskQa, type AskSection, type AskSide, type AskTurn, cleanQuestion, clockOf, demoteHeadings, withDerived } from '@cn/format'
import type { Material } from '../../shared/materials'
import { type ReadingMsg, type ReadingSide, type ReadingThread, withoutVizMark } from '../../shared/reading'

/** 回答原文写进笔记的样子：去掉可视化、配图那两行标记，标题降到 ### 以下（不把笔记的这一段切开） */
export const answerMd = (text: string) => demoteHeadings(withoutVizMark(text).text.trim())

/** 一问一答：用户那句后面跟着答出来的那条（出错、停下、没答完的不记） */
export function pairsOf(msgs: ReadingMsg[]): { user: ReadingMsg; ai: ReadingMsg }[] {
  const out: { user: ReadingMsg; ai: ReadingMsg }[] = []
  for (let i = 0; i < msgs.length - 1; i++) {
    const user = msgs[i]!
    const ai = msgs[i + 1]!
    if (user.role === 'user' && ai.role === 'ai' && ai.text.trim() && !ai.error) out.push({ user, ai })
  }
  return out
}

/** 材料（输入框里那一排）写进笔记：引用的字原样，图换成拷进库里的那张 */
function matsOf(mats: Material[] | undefined, matPath: (name: string) => string): AskMat[] | undefined {
  if (!mats?.length) return undefined
  // 拷不进库的图（pasted/ 里已经没有了）不写
  const out = mats.flatMap((m): AskMat[] => (m.kind === 'quote' ? [{ kind: 'quote', text: m.text, src: m.src }] : matPath(m.name) ? [{ kind: 'image', path: matPath(m.name), src: m.src }] : []))
  return out.length ? out : undefined
}

function turnOf(p: { user: ReadingMsg; ai: ReadingMsg }, matPath: (name: string) => string): AskTurn {
  const mats = matsOf(p.user.mats, matPath)
  return { q: cleanQuestion(p.user.text), a: answerMd(p.ai.text), ...(mats ? { mats } : {}) }
}

/**
 * 这一处的一段：msgs 是主对话（只取这一处的），sides 是旁支（只取这一处、问过的）；old 是笔记里原来那一段（双链、可视化、配的图留着）。
 * matPath：材料里的图（pasted/ 里的名字）拷进库里以后的路径
 */
export function buildSection(o: {
  pdf: string
  thread: ReadingThread
  msgs: ReadingMsg[]
  sides: ReadingSide[]
  title: string
  recap: string
  old?: AskSection | null
  web?: AskSection['web']
  matPath(name: string): string
}): AskSection {
  const th = o.thread
  const pairs = pairsOf(o.msgs.filter((m) => m.thread === th.id))
  const qas: (AskQa & { ai: number })[] = pairs.map((p) => ({ ...turnOf(p, o.matPath), sides: [], ai: p.ai.id }))
  for (const side of o.sides.filter((s) => s.thread === th.id)) {
    const turns = pairsOf(side.msgs).map((p) => turnOf(p, o.matPath))
    if (!turns.length || !qas.length) continue
    const at = qas.find((q) => q.ai === side.msg) ?? qas[qas.length - 1]!
    at.sides.push({ quote: side.quote, turns } satisfies AskSide)
  }
  const first = o.msgs.find((m) => m.thread === th.id && m.role === 'user')
  const s: AskSection = {
    id: th.id,
    file: o.web || o.pdf.startsWith('web:') ? '' : o.pdf,
    page: th.page,
    ...(o.web ? { web: o.web } : {}),
    ...(th.rect ? { rect: th.rect } : {}),
    title: o.title,
    time: clockOf(new Date(first?.time ?? th.createdAt)),
    // 补上的截图（task-yp8l7）只在笔记里、对话记录里没有：同一处再问时留着
    ...(th.crop ? { crop: th.crop } : o.old?.crop ? { crop: o.old.crop } : {}),
    ...(th.crop && th.cropW ? { cropW: Math.round(th.cropW) } : !th.crop && o.old?.crop && o.old.cropW ? { cropW: o.old.cropW } : {}),
    // 选字问（PDF 上选一段字问，不截图）：那段原文写成第一问上面的引用块（task-yp8l7）
    ...(!th.crop && !o.old?.crop && !th.web && th.quote?.trim() ? { quote: th.quote.trim() } : !th.crop && o.old?.quote ? { quote: o.old.quote } : {}),
    figures: o.old?.figures ?? [],
    doubts: [],
    good: '',
    points: [],
    failed: [],
    rounds: 0,
    links: o.old?.links ?? [],
    ...(o.old?.viz ? { viz: o.old.viz } : {}),
    qas: qas.map(({ ai, ...qa }) => (void ai, qa)),
    recap: o.recap,
  }
  return withDerived(s)
}

/** 给快的模型看的这一轮：主对话【他】【AI】，旁支另起一行写被问的那句；回答太长截断（max 字） */
export function roundText(msgs: ReadingMsg[], sides: ReadingSide[], max = 1200): string {
  const cut = (t: string) => (t.length > max ? t.slice(0, max) + '……' : t)
  const out: string[] = []
  const pairs = pairsOf(msgs)
  const ids = new Set(pairs.map((p) => p.ai.id))
  for (const p of pairs) {
    out.push(`【他】${p.user.text.trim()}\n【AI】${cut(answerMd(p.ai.text))}`) // 不翻：给 AI 的话
    // 找不到被问的那条回答的旁支（那条删了）挂在最后一问后面，和笔记里一样
    for (const s of sides.filter((x) => x.msg === p.ai.id || (p === pairs[pairs.length - 1] && !ids.has(x.msg)))) {
      const turns = pairsOf(s.msgs)
      if (!turns.length) continue
      // 不翻：给 AI 的话
      out.push(`【旁支】他在回答里选中「${s.quote}」另问：\n${turns.map((t) => `【他·旁支】${t.user.text.trim()}\n【AI·旁支】${cut(answerMd(t.ai.text))}`).join('\n')}`)
    }
  }
  return out.join('\n\n')
}
