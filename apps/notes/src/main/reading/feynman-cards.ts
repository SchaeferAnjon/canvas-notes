/**
 * 出卡的另一种来源「费曼缺口」（③ feynman-after，task-yvabi；notes.md B4「出卡」、teaching.md 4.3）：
 * 一轮费曼判过以后的缺口，一条一张，用现有的出卡弹窗一张张过、送进 Anki；卡片类型（学习卡 · 问答）、牌组规矩（跟着目录来）不变。
 * - 问题：「范数：放大 α 倍会怎样？」（过了的那一轮另一张「用两三句讲清「范数」」）；答案是缺口的正确说法（不超过 40 字）；
 *   原文是你当时的原话；纸底出处「费曼 · 范数 · 公式 (2.3.10)」，「打开原文」回到这一轮所在的那篇。
 * - 默认勾不勾照这条缺口的「出卡」（讲错、含糊、没讲到、说错后改对、讲清 X 勾；追问后补上、了解即可不勾），不用再问 AI 改写。
 * - 牌组照这一轮所在那篇的目录：课程/<课>/ 下的进「课程::<课>::…」，别的文件夹里的跟着文件夹走，库最外层的进「知识」。
 */
import type { AskSection, CardText } from '@cn/format'
import { readFile } from 'node:fs/promises'
import { t } from '../../shared/i18n'
import { findRounds } from '../../shared/feynman/doc'
import { gapCardId } from '../../shared/feynman/after'
import { gapQuestion } from '../../shared/feynman/rules'
import type { FeynmanMeta, Gap } from '../../shared/feynman/types'
import type { CardItem } from '../../shared/reading'
import type { Vault } from '../vault'
import type { CardInput } from './anki'


/** 这一条缺口的卡：问题、答案、原文（你当时的原话） */
export function gapCard(meta: FeynmanMeta, g: Gap): CardText {
  return { q: gapQuestion(g, meta), a: g.right, more: '', quote: g.quote?.trim() ? `「${g.quote.trim()}」` : '' }
}

/** 纸底的出处：费曼 · 范数 · 公式 (2.3.10) */
export const gapSource = (meta: FeynmanMeta, g: Gap) => ['费曼', meta.topic, g.src?.trim() && g.src.trim() !== '材料里没有' ? g.src.trim() : ''].filter(Boolean).join(' · ') // 不翻：写进卡的字

export async function feynmanRound(v: Vault, note: string, round: string): Promise<FeynmanMeta> {
  let text: string
  try {
    text = await readFile(v.abs(note), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(t('《{name}》不在了', { name: note.split('/').pop()!.replace(/\.md$/i, '') }))
    throw e
  }
  const r = findRounds(text).find((x) => x.meta.id === round)
  if (!r) throw new Error(t('这一轮不在这篇里了'))
  if (!r.meta.gaps?.length) throw new Error(t('这一轮还没判，没有缺口'))
  return r.meta
}

/** 出卡弹窗里的一张张（sent、draft 由调用的地方照送过的记号、本机草稿补上） */
export function gapItems(meta: FeynmanMeta, note: string, course: string): (CardItem & { card: CardText; keep: boolean })[] {
  return (meta.gaps ?? []).map((g) => {
    const card = gapCard(meta, g)
    return {
      id: gapCardId(meta.id, g.point),
      pdf: note,
      ...(meta.lecture ? { lecture: meta.lecture } : {}),
      page: 0,
      title: meta.topic,
      question: card.q,
      lead: g.right,
      course,
      feynman: { kind: g.kind, source: gapSource(meta, g), ...(g.quote?.trim() ? { said: g.quote.trim() } : {}) },
      card,
      keep: g.card,
    }
  })
}

/** 送进 Anki 的那几张：出卡弹窗里过过的字为准 */
export function gapInputs(meta: FeynmanMeta, note: string, course: string, want: Map<string, CardText>): CardInput[] {
  const link = `canvas-notes://open?file=${encodeURIComponent(note)}`
  return (meta.gaps ?? []).flatMap((g) => {
    const id = gapCardId(meta.id, g.point)
    const card = want.get(id)
    if (!card) return []
    // 出卡的字段只用到这几样（问题、答案、补充、原文都从 card 来）
    const section = { id, file: note, page: 0, title: meta.topic, figures: [], doubts: [], good: g.right, points: [], failed: [], rounds: 0, links: [] } as unknown as AskSection
    return [{ id, pdf: note, course, section, question: card.q, card, source: gapSource(meta, g), link }]
  })
}
