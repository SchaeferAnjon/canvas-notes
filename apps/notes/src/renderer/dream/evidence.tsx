/**
 * AI 判的那几组（补双链、拿不准、旧「相关：」复查、AI 认出的重复，task-h7oy8）在报告里多出来的几样：
 * 两边原话（软件逐字核对过）、判成哪一档和把握；拿不准、复查两组的按钮叫法；摘要里这晚判断的账（问了几次 AI、还剩几篇明晚接着、没提的有多少）。
 */
import { Codicon } from '@cn/design'
import type { DreamItem, DreamJudgeStats } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import { t } from '../../shared/i18n'

const LEVEL = () => ({ 'same-content': t('同一内容'), 'same-topic': t('同一主题'), tangential: t('只是沾边'), unrelated: t('无关'), unsure: t('拿不准') })

/** 收下 / 丢掉在这一组叫什么：拿不准是「收下 / 不要」，复查是「去掉这行 / 留着」 */
export function actNames(item: DreamItem): { take: string; drop: string } {
  if (item.group === 'unsure') return { take: t('收下'), drop: t('不要') }
  if (item.group === 'recheck') return { take: t('去掉这行'), drop: t('留着') }
  return { take: t('收下'), drop: t('丢掉') }
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
