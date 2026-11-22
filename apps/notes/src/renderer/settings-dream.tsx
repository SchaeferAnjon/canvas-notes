/**
 * 设置 › 梦游（2026-11-20 用户「梦游每样能开关」）：什么时候梦游、能做哪些事（每样一个开关，标清它会动什么）、
 * 能动哪些文件夹、改完怎么收、用哪家 AI（只写一行，点了去 AI 页那一行）。存在 settings.json 的 dream（shared/dream-settings.ts）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { withKeys } from './keys'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../shared/appearance'
import { ENGINE_LABEL } from '../shared/ai-features'
import type { EngineId } from '../shared/agent'
import { CATEGORIES } from '../shared/categories'
import { DUP_CHOICES, dreamDoes, type DreamPatch, type DreamStep, GAP_CHOICES, IDLE_CHOICES, LINK_CHOICES, linkFolders, VIZ_CHOICES } from '../shared/dream-settings'
import { FOLDER_COLORS } from '../shared/left'
import { AiIcon, EngineLogo } from './engine-logo'
import { dreamWhen, errText, useDream } from './dream/useDream'
import { Toggle } from './Settings'
import type { Params } from '../shared/i18n'
import { useT } from './i18n'

type T = (key: string, p?: Params) => string

/** 它会动什么：一眼看出是挪文件、改字、新建，还是只提醒 */
type Effect = 'move' | 'edit' | 'new' | 'remind'
const EFFECT_ICON: Record<Effect, CodiconName> = { move: 'arrow-right', edit: 'edit', new: 'new-file', remind: 'bell' }
const effectName = (t: T, e: Effect) => ({ move: t('挪动'), edit: t('改正文'), new: t('新建文件'), remind: t('只提醒') })[e]

interface StepRow {
  step: DreamStep
  name: string
  desc: string
  icon: CodiconName
  effects: Effect[]
  /** 一晚最多几处：哪个设置、选项、单位 */
  /** 一晚最多几处：哪个设置、选项、一档怎么写（3处、3个、3对）、下拉的名字 */
  max?: { key: 'linkMax' | 'vizMax' | 'dupMax'; choices: readonly number[]; fmt(n: number): string; label: string }
}

/** 八样（说的那一刻的界面语言） */
const steps = (t: T): StepRow[] => [
  { step: 'file', name: t('归类挪动收件箱里的笔记'), desc: t('挪进课程、项目、生活、写作、阅读、剪藏，这篇里图片、附件的相对链接跟着改；拿不准的留在收件箱'), icon: 'inbox', effects: ['move', 'edit'] },
  { step: 'rename', name: t('改名'), desc: t('收件箱里的临时名改成一看就懂的；开头的标题、别的笔记里指向它的 [[旧名]] 跟着换'), icon: 'whole-word', effects: ['move', 'edit'] },
  { step: 'link', name: t('补双链'), desc: t('两篇讲同一件事时，在这篇正文末尾加一行「相关：[[那篇]]」'), icon: 'link', effects: ['edit'], max: { key: 'linkMax', choices: LINK_CHOICES, fmt: (n) => t('{n}处', { n }), label: t('一晚最多补几处双链') } },
  { step: 'week', name: t('写本周小结'), desc: t('按这周的提交写一段，新建在「周记」里'), icon: 'calendar', effects: ['new'] },
  { step: 'viz', name: t('做HTML可视化'), desc: t('今天读PDF卡得最久的几处各做一个能拖能点的网页，放进课程文件夹、挂在笔记那一段的脚上'), icon: 'preview', effects: ['new', 'edit'], max: { key: 'vizMax', choices: VIZ_CHOICES, fmt: (n) => t('{n}个', { n, ctx: '可视化' }), label: t('一晚最多做几个可视化') } },
  { step: 'attach', name: t('老图挪进各篇的附件文件夹'), desc: t('「附件」根目录平铺的老图挪进引用它那篇自己的文件夹，改那篇里的图片链接'), icon: 'file-media', effects: ['move', 'edit'] },
  { step: 'dup', name: t('提醒可能重复'), desc: t('两篇大半一样时列出来，不删也不改'), icon: 'copy', effects: ['remind'], max: { key: 'dupMax', choices: DUP_CHOICES, fmt: (n) => t('{n}对', { n }), label: t('一晚最多列几对可能重复') } },
  { step: 'video', name: t('提醒同一个视频记散在多篇'), desc: t('同一个视频的时刻、问答记在两篇以上时提醒合成一篇，不改文件'), icon: 'device-camera-video', effects: ['remind'] },
]

/** 勾上一个文件夹，梦游在那里做什么（文件夹名照磁盘上的比） */
const doesIn = (t: T, name: string) =>
  // 不翻：和磁盘上的文件夹名比
  name === '收件箱' ? t('归类、改名、补双链') : name === '周记' ? t('写本周小结') : t('补双链')

export function DreamSettingsPage(props: { settings: AppSettings; onChange(p: { dream: DreamPatch }): Promise<AppSettings>; onNotice(t: string): void; onOpenDream(): void; onAiRow(): void }) {
  const t = useT()
  const s = props.settings.dream
  const set = (dream: DreamPatch) => void props.onChange({ dream })
  const { report, running } = useDream()
  const [asked, setAsked] = useState(false)
  const [ai, setAi] = useState<{ engine: EngineId; label: string } | null>(null)
  useEffect(() => {
    void window.cn.aiPrefs().then((v) => setAi({ engine: (v.prefs.features.dream ?? v.prefs.default).engine, label: v.labels.dream }))
  }, [])

  const busy = running || asked
  async function dreamNow() {
    setAsked(true)
    try {
      await window.cn.dreamNow()
    } catch (e) {
      props.onNotice(errText(e))
    } finally {
      setAsked(false)
    }
  }

  const does = dreamDoes(s)
  /** 这一样现在为什么不做（文件夹没勾） */
  const blocked = (step: DreamStep): string | null => {
    // 不翻：和磁盘上的文件夹名比；提示里的文件夹名也照磁盘上的
    if ((step === 'file' || step === 'rename') && !s.folders.includes('收件箱')) return t('「{folder}」没勾，现在不做', { folder: '收件箱' })
    // 不翻：同上
    if (step === 'week' && !s.folders.includes('周记')) return t('「{folder}」没勾，现在不做', { folder: '周记' })
    if (step === 'link' && !linkFolders(s).length) return t('下面一个能补双链的文件夹都没勾，现在不做')
    return null
  }

  return (
    <div className="dset">
      <h4>
        {t('什么时候梦游')}
        <span>{t('改动先放在单独的分支上，看过再收')}</span>
      </h4>
      <div className="dset-now" data-testid="dream-set-now">
        <span className="ic">
          <Codicon name="wand" size={16} />
        </span>
        <span className="tx">
          {running ? (
            <>
              <b>{t('正在梦游')}</b>
              <span>{does ? t('{does}；跑完左栏「梦游报告」出新报告', { does }) : t('跑完左栏「梦游报告」出新报告')}</span>
            </>
          ) : report ? (
            <>
              <b>{t('上次梦游 · {when}', { when: dreamWhen(report) })}</b>
              <span>{report.items.length ? (report.autoTaken ? t('整理了{n}处，已直接收下', { n: report.items.length }) : t('整理了{n}处', { n: report.items.length })) : t('没什么要整理的')}</span>
            </>
          ) : (
            <>
              <b>{t('还没梦游过')}</b>
              <span>{s.auto ? t('Mac闲着超过{n}分钟时会自己梦游一次', { n: s.idleMinutes }) : t('自己梦游关着，点「现在梦游」才梦游')}</span>
            </>
          )}
        </span>
        {report && !running && (
          <button className="btn btn-sm btn-ghost" onClick={props.onOpenDream}>
            {t('看报告')}
          </button>
        )}
        <button className="btn btn-sm" disabled={busy} onClick={() => void dreamNow()}>
          {busy ? <Codicon name="loading" size={14} className="spin" /> : <AiIcon job="dream" size={14} />}
          {busy ? t('正在梦游') : t('现在梦游')}
        </button>
      </div>
      <div className="dset-list">
        <div className="row" data-row="dAuto">
          <span className="tx">
            <b>{t('自己梦游')}</b>
            <span>{withKeys(t('关了只在点「现在梦游」时梦游（左栏梦游报告、{k:search}、菜单栏里都有）'))}</span>
          </span>
          <Toggle on={s.auto} label={t('自己梦游')} onChange={(auto) => set({ auto })} />
        </div>
        <div className={'row' + (s.auto ? '' : ' dim')} data-row="dIdle">
          <span className="tx">
            <b>{t('没人动多久算闲')}</b>
            <span>{t('这台Mac没人碰键盘和鼠标这么久')}</span>
          </span>
          <select aria-label={t('没人动多久算闲')} disabled={!s.auto} value={s.idleMinutes} onChange={(e) => set({ idleMinutes: Number(e.target.value) })}>
            {IDLE_CHOICES.map((m) => (
              <option key={m} value={m}>{t('{n}分钟', { n: m })}</option>
            ))}
          </select>
        </div>
        <div className={'row' + (s.auto ? '' : ' dim')} data-row="dGap">
          <span className="tx">
            <b>{t('两次之间至少隔')}</b>
            <span>{t('从上次梦游完算起')}</span>
          </span>
          <select aria-label={t('两次之间至少隔')} disabled={!s.auto} value={s.gapHours} onChange={(e) => set({ gapHours: Number(e.target.value) })}>
            {GAP_CHOICES.map((h) => (
              <option key={h} value={h}>{t('{n}小时', { n: h })}</option>
            ))}
          </select>
        </div>
        <div className={'row' + (s.auto ? '' : ' dim')} data-row="dWait">
          <span className="tx">
            <b>{t('等上一份报告看完')}</b>
            <span>{t('上一份还有没收下、没丢掉的就不自己梦游')}</span>
          </span>
          <Toggle on={s.waitReport} label={t('等上一份报告看完')} onChange={(waitReport) => s.auto && set({ waitReport })} />
        </div>
      </div>

      <h4>
        {t('能做哪些事')}
        <span>{t('每样一个开关；关掉的那样不做，报告里也没有那一组')}</span>
      </h4>
      <div className="dset-steps" role="list" aria-label={t('梦游能做哪些事')} data-row="dSteps">
        {steps(t).map((r) => {
          const on = s.steps[r.step]
          const why = on ? blocked(r.step) : null
          return (
            <div key={r.step} className={'dset-step' + (on && !why ? '' : ' off')} role="listitem" data-step={r.step}>
              <Codicon name={r.icon} size={16} className="ic" />
              <span className="tx">
                <span className="hd">
                  <b>{r.name}</b>
                  {r.effects.map((e) => (
                    <em key={e} className={'eff ' + e}>
                      <Codicon name={EFFECT_ICON[e]} size={12} />
                      {effectName(t, e)}
                    </em>
                  ))}
                </span>
                <span className="ds">{r.desc}</span>
                {why && <span className="why">{why}</span>}
              </span>
              {r.max && (
                <label className="max">
                  {r.step === 'dup' ? t('最多') : t('一晚最多')}
                  <select aria-label={r.max.label} disabled={!on} value={s[r.max.key]} onChange={(e) => set({ [r.max!.key]: Number(e.target.value) })}>
                    {r.max.choices.map((n) => (
                      <option key={n} value={n}>{r.max!.fmt(n)}</option>
                    ))}
                  </select>
                </label>
              )}
              <Toggle on={on} label={r.name} onChange={(v) => set({ steps: { [r.step]: v } })} />
            </div>
          )
        })}
      </div>

      <p className="note" data-testid="dream-set-edits">
        {t('会动正文的只有标了「改正文」的几样，各动一处：归类挪动改挪走那篇里图片、附件的相对链接；改名换开头的标题和别的笔记里指向它的 [[旧名]]；补双链在那篇末尾加一行「相关：[[…]]」；做可视化在读PDF笔记那一段的脚上加一行链接；挪老图改引用它那几篇里的图片链接。别处的字一个不动。')}
      </p>

      <h4>
        {t('能动哪些文件夹')}
        <span>{t('梦游只在勾上的文件夹里改字、建文件')}</span>
      </h4>
      <div className="dset-folders" role="group" aria-label={t('梦游能动哪些文件夹')} data-row="dFolders">
        {CATEGORIES.map((c) => {
          const on = s.folders.includes(c.name)
          return (
            <label key={c.name} className={'dset-folder' + (on ? ' on' : '')}>
              <input type="checkbox" checked={on} aria-label={c.name} onChange={(e) => set({ folders: e.currentTarget.checked ? [...s.folders, c.name] : s.folders.filter((f) => f !== c.name) })} />
              <span className="fi" style={{ color: FOLDER_COLORS[c.color] }}>
                <Codicon name={c.icon as CodiconName} size={14} />
              </span>
              <b>{c.name}</b>
              <span className="truncate">{doesIn(t, c.name)}</span>
            </label>
          )
        })}
      </div>
      <p className="note">
        {t('课程、写作、项目、生活默认不勾：勾上后梦游会在那里的笔记末尾补双链。例外照旧由上面各自的开关管：可视化挂在课程里读PDF的笔记那一段的脚上；挪老图改引用它那几篇里的图片链接；改名时别处指向它的 [[旧名]] 跟着换；归类时从收件箱挪去哪个分类都行。')}
      </p>

      <h4>
        {t('改完怎么收')}
        <span>{t('两种都能撤回')}</span>
      </h4>
      <div className="dset-list" role="radiogroup" aria-label={t('改完怎么收')} data-row="dTake">
        {(
          [
            [false, t('先预览，收下才进库'), t('改动放在单独的分支上，在梦游报告里逐条收下或丢掉')],
            [true, t('改完直接收下'), t('梦游完一次提交进main，梦游报告顶上能一键撤回；可能重复这类提醒照样留着看')],
          ] as const
        ).map(([v, name, desc]) => (
          <button key={String(v)} className="row radio" role="radio" aria-checked={s.autoTake === v} onClick={() => set({ autoTake: v })}>
            <span className={'rd' + (s.autoTake === v ? ' on' : '')} />
            <span className="tx">
              <b>{name}</b>
              <span>{desc}</span>
            </span>
          </button>
        ))}
      </div>

      <h4>
        {t('用哪家AI')}
        <span>{t('在设置 › AI的「梦游」那一行换')}</span>
      </h4>
      <button className="dset-ai" data-testid="dream-set-ai" data-row="dAi" onClick={props.onAiRow}>
        {ai ? <EngineLogo id={ai.engine} size={16} /> : <Codicon name="wand" size={16} />}
        <b>{ai ? ENGINE_LABEL[ai.engine] : t('读取中')}</b>
        {ai && <span className="m truncate">{ai.label.split(' · ').slice(1).join(' · ') || t('它自己的默认模型')}</span>}
        <span className="sp" />
        <span className="go">
          {t('去AI页换')}
          <Codicon name="chevron-right" size={12} />
        </span>
      </button>
    </div>
  )
}
