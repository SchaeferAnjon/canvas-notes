/**
 * 词条页建议的两颗按钮「不要 · 建词条页」：左栏小卡和中间条目头用同一个（梦游对照复审：以前中间只有「知道了」，和小卡对不上）。
 * 和别的条目同一套收不收（ChangeBar）：不要无边框在左，建词条页在右；中间那颗实心（solid），小卡里描边。
 * 建词条页：AI 起草、一次提交，底栏能撤销；不要：以后不再建议。
 */
import { Codicon } from '@cn/design'
import { ChangeBar } from '@cn/ai-chat/answer-bar'
import { useState } from 'react'
import type { DreamItem } from '../../shared/api'
import { t } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { actOn } from './nav'
import { errText } from './useDream'

export function EntryActs(props: { item: DreamItem; busy: boolean; solid?: boolean; className?: string; testId?: string }) {
  const { item } = props
  const [making, setMaking] = useState(false)
  const [err, setErr] = useState('')
  const make = async () => {
    setMaking(true)
    setErr('')
    try {
      const u = await window.cn.relatedEntry(item.entry!.name, item.files[0] ?? '')
      app().openFile(u.b)
      const n = new Set((u.linked ?? []).map((l) => l.path)).size
      const say = n
        ? t('建好了词条页《{name}》，{n}篇里提到它的字链过来了；拿不准的{k}处列在那几篇右栏「相关」的「像但还没连的」里，你来定', { name: titleOf(u.b), n, k: u.unsure?.length ?? 0 })
        : t('建好了词条页《{name}》：开头几句是 AI 起草的，下面嵌进库里讲它的段', { name: titleOf(u.b) })
      app().noticeUndo(say, () =>
        void window.cn.relatedUndo(u).then(
          () => app().notice(t('词条页撤销了，几篇原文回到建之前，一字不差')),
          (e: Error) => app().notice(errText(e)),
        ),
      )
      await actOn('take', item)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setMaking(false)
    }
  }
  return (
    <>
      <ChangeBar
        className={props.className}
        testId={props.testId}
        solid={props.solid}
        reject={{ label: t('不要'), disabled: props.busy || making, onClick: () => void actOn('drop', item) }}
        accept={{ label: making ? t('正在起草…') : t('建词条页'), icon: <Codicon name={making ? 'loading' : 'book'} size={14} className={making ? 'spin' : undefined} />, disabled: props.busy || making, onClick: () => void make() }}
      />
      {err && <p className="derr">{err}</p>}
    </>
  )
}
