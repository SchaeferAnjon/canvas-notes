/**
 * AI 判的那几组（补双链、拿不准、旧「相关：」复查、AI 认出的重复，task-h7oy8）在报告里多出来的几样：
 * 两边原话（软件逐字核对过）、判成哪一档和把握；拿不准、复查两组的按钮叫法；摘要里这晚判断的账（问了几次 AI、还剩几篇明晚接着、没提的有多少）。
 */
import { Codicon } from '@cn/design'
import type { DreamItem, DreamJudgeStats, DreamReport } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import { t } from '../../shared/i18n'

const LEVEL = () => ({ 'same-content': t('同一内容'), 'same-topic': t('同一主题'), tangential: t('只是沾边'), unrelated: t('无关'), unsure: t('拿不准') })

/** 收下 / 不要在这一组叫什么：复查是「去掉这行 / 留着」，别的都是「收下 / 不要」（task-eavzx：以前叫丢掉、收下这条） */
export function actNames(item: DreamItem): { take: string; drop: string } {
  if (item.group === 'recheck') return { take: t('去掉这行'), drop: t('留着') }
  return { take: t('收下'), drop: t('不要') }
}

/** 一组的标题旁写谁判的：AI 判的写模型，本机比的写「本地比对，没用AI」 */
export function groupBy(items: DreamItem[]): string | null {
  const full = items.find((i) => i.by)?.by
  // 组标题右边位置窄：只写模型和档（「Haiku · High」），哪一家写在摘要那段里
  const by = full && full.includes(' · ') ? full.split(' · ').slice(1).join(' · ') : full
  if (items.every((i) => i.group === 'link' || i.group === 'unsure' || i.group === 'recheck')) return by ? t('{by}判的', { by }) : null
  if (items.every((i) => i.group === 'dup')) return by ? t('本地比对 + {by}', { by }) : t('本地比对，没用AI')
  return null
}

/** 两边原话 + 判成哪一档、把握 */
export function Evidence(props: { item: DreamItem }) {
  const j = props.item.judged
  if (props.item.wiki && j) return <WikiEvidence item={props.item} />
  if (!j) return null
  const quote = (side: 'a' | 'b') => j[side].quote
  return (
    <div className="dev" data-testid="dream-evidence">
      {quote('a') && (
        <div className="q">
          <span className="w">{t('这篇')}</span>
          <span className="s">{`「${quote('a')}」`}</span>
        </div>
      )}
      {quote('b') && (
        <div className="q">
          <span className="w">{titleOf(j.b.path)}</span>
          <span className="s">{`「${quote('b')}」`}</span>
        </div>
      )}
      <div className="lv num">
        <Codicon name="pass" size={12} />
        {props.item.group === 'recheck'
          ? t('判成{level} · 把握 {c}', { level: LEVEL()[j.level], c: j.confidence.toFixed(2) })
          : quote('a') || quote('b')
            ? t('判成{level} · 把握 {c} · 原话软件逐字核对过', { level: LEVEL()[j.level], c: j.confidence.toFixed(2) })
            : t('判成{level} · 把握 {c}', { level: LEVEL()[j.level], c: j.confidence.toFixed(2) })}
      </div>
    </div>
  )
}

/**
 * Wiki 链接那一条的证据（设计复审：每处各说各的）：这篇的那一行只出一次，变成链接的几个字打底色；
 * 下面每处一行「字 → 《那篇》›「那一节」 · 一节」，第二行是这一处的理由；最后一行谁判的、核对过（把握在悬停里）
 */
function WikiEvidence(props: { item: DreamItem }) {
  const w = props.item.wiki!
  const line = props.item.judged!.a.quote
  // 这一行里几处字的位置（从左到右，不重叠）
  const marks: [number, number][] = []
  for (const l of w.links) {
    let from = 0
    for (;;) {
      const at = line.indexOf(l.words, from)
      if (at < 0) break
      if (!marks.some(([a, b]) => at < b && at + l.words.length > a)) {
        marks.push([at, at + l.words.length])
        break
      }
      from = at + 1
    }
  }
  marks.sort((a, b) => a[0] - b[0])
  const parts: React.ReactNode[] = []
  let at = 0
  marks.forEach(([a, b], i) => {
    parts.push(line.slice(at, a), <mark key={i}>{line.slice(a, b)}</mark>)
    at = b
  })
  parts.push(line.slice(at))
  const where = (lv: string) => (lv === 'note' ? t('整篇') : lv === 'heading' ? t('一节') : t('一段'))
  return (
    <div className="dev dwiki" data-testid="dream-evidence">
      <div className="q">
        <span className="w">{t('这篇')}</span>
        <span className="s">{parts}</span>
      </div>
      {w.links.map((l, i) => (
        <div key={i} className="wl" data-testid="dream-wiki-link">
          <div className="l1">
            <Codicon name="link" size={14} />
            <b>{l.words}</b>
            <span className="to">{l.level === 'heading' ? t('→《{name}》›「{h}」', { name: titleOf(l.path), h: l.anchor }) : t('→《{name}》', { name: titleOf(l.path) })}</span>
            <span className="lv">{where(l.level)}</span>
          </div>
          {l.why && <div className="r">{l.why}</div>}
        </div>
      ))}
      <div className="lv num" title={t('把握 {c}', { c: Math.min(...w.links.map((l) => l.confidence)).toFixed(2) })}>
        <Codicon name="pass" size={12} />
        {t('AI 判的，每处的字和原话软件逐字核对过')}
      </div>
    </div>
  )
}

/** 摘要里这晚 Wiki 化的账：「Wiki 链接：问了 6 次AI，链上 12 处、拿不准 3 处；建议 1 个词条页」 */
export function WikiLine(props: { s: NonNullable<DreamReport['wiki']> }) {
  const { s } = props
  // 问了 AI 却什么都没连出来时不占一行（判了几篇在补双链那一行里已经说了）
  if (!s.link && !s.unsure && !s.entries && !s.aliases && !s.voided) return null
  const parts = [
    t('Wiki 链接：问了{n}次AI，链上{link}处', { n: s.asked, link: s.link }),
    s.unsure ? t('拿不准{n}处', { n: s.unsure }) : '',
    s.voided ? t('{n}处对不上原文作废', { n: s.voided }) : '',
    s.entries ? t('建议{n}个词条页', { n: s.entries }) : '',
    s.aliases ? t('建议加{n}个别名', { n: s.aliases }) : '',
    s.left ? t('还剩{n}篇下次接着', { n: s.left }) : '',
  ].filter(Boolean)
  return (
    <span className="dnote djudge" data-testid="dream-wiki">
      {parts.join(t('，')) + t('。')}
    </span>
  )
}

/** 摘要里这晚判断的账：「Claude Code · Haiku 判了 20 篇、问了 20 次 AI；到了每晚 20 篇的上限，还剩 6 篇明晚接着」，没提的举一个例子 */
export function JudgeLine(props: { s: DreamJudgeStats }) {
  const { s } = props
  const head = t('补双链：{by}判了{n}篇、问了{asked}次AI', { by: s.by, n: s.notes, asked: s.asked })
  const cached = s.cached ? t('，{n}篇用的是以前判过的结果', { n: s.cached }) : ''
  const tail = s.left ? (s.capped ? t('；到了每晚{cap}篇的上限，还剩{left}篇明晚接着', { cap: s.cap, left: s.left }) : t('；还剩{left}篇下次接着', { left: s.left })) : ''
  return (
    <span className="dnote djudge" data-testid="dream-judge">
      {head + cached + tail + t('。')}
      {s.skipped > 0 && (
        <span className="sk">
          {s.skipExample
            ? t('判过没提的{n}对，比如「{a}」和「{b}」：{why}', { n: s.skipped, a: s.skipExample.a, b: s.skipExample.b, why: s.skipExample.why })
            : t('判过没提的{n}对', { n: s.skipped })}
        </span>
      )}
      {s.voided > 0 && <span className="sk">{t('{n}对AI抄的原话在原文里找不到，作废了', { n: s.voided })}</span>}
    </span>
  )
}
