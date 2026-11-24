/**
 * 设置 › AI（CN-44；2026-11-21 设置方向 A 的结构）：默认（一行，各家标志 + 名字 +「已装好 · 模型」+ 选择器）、各功能用哪个（一张细线表五行：
 * AI对话、梦游、看图问、翻译、小活，右边一列一个选择器；翻译说明后面「排顺序 ›」到 插件 › 双语翻译）、能动手到哪（全能模式，和 AI 输入框
 * 下面那颗是同一个开关；给AI的长期说明，每次对话都带上）、各家命令行（版本、能不能用、检查更新 / 更新，settings-engines.tsx）。
 * 选 AI 的地方（task-m55m7，偏好「选 AI 先选家再选模型」）用和 AI 输入框底下同一个选择器（ai-picker.tsx 的 box 样子）：
 * 先选家（同一家只列一次，「跟默认」「按顺序」还在最前面），再选这一家的模型（从命令行拉的），再选想多久。
 */
import { useEffect, useRef, useState } from 'react'
import { type EngineId, type EngineInfo, PARALLEL_DEFAULT, PARALLEL_MAX } from '../shared/agent'
import { type AiFeature, type AiPick, type AiPrefs, CLAUDE_DEFAULT, DEFAULT_EFFORT, findModel, pickLabel } from '@cn/ai-engines/shared'
import type { AiPrefsView } from '../shared/api'
import { ENGINES as TR_ENGINES, normalizeTranslate, type TranslateSettings, type TrEngineId } from '../shared/plugins/translate'
import { AiPicker, engineFamily, type Family, type PickerValue } from '@cn/ai-chat/ai-picker'
import { EngineRows } from './settings-engines'
import { SourceRows } from './settings-sources'
import { canSeeImages, isApi, isCli, isLocal } from '@cn/ai-engines/shared'
import { Toggle, type SettingsProps } from './Settings'
import { Group, hintFor, Lnk, Row, useSaid } from './settings/ui'
import { settingsItem } from '../shared/settings-index'
import { useT } from './i18n'
import { MobileAiGroup } from './mobile-ai/MobileAiGroup'
import { ipcOn } from './crash/ipc'

export const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 各功能那几行；名字用设置索引里那一行的（文字只写一处） */
const ROWS: { f: AiFeature | 'translate'; row: string }[] = [
  { f: 'chat', row: 'fChat' },
  { f: 'dream', row: 'fDream' },
  { f: 'vision', row: 'fVision' },
  { f: 'translate', row: 'fTrans' },
  { f: 'quick', row: 'fQuick' },
]

export const valueOf = (p: AiPick | null | undefined): PickerValue => (p ? { family: p.engine, model: p.model ?? '', ...(p.effort ? { effort: p.effort } : {}) } : { family: null })

/**
 * 选择器上点了一下以后的那一家那个模型那一档：换了家从这家的默认模型开始（Claude Code 是 Opus），换了模型时那一档这个模型不认就不带
 */
export function nextPick(cur: AiPick | null, engines: EngineInfo[], ch: { family?: string; model?: string; effort?: string | null }): AiPick {
  if (ch.family !== undefined) {
    if (cur?.engine === ch.family) return cur
    if (ch.family === 'claude') return { engine: 'claude', model: CLAUDE_DEFAULT }
    // API Key、本机模型没有「这家自己的默认模型」：换到它时用它列表里第一个（接上时推荐的排在第一）
    const first = engines.find((e) => e.id === ch.family)?.models[0]?.id
    return isApi(ch.family) || isLocal(ch.family) ? { engine: ch.family, ...(first ? { model: first } : {}) } : { engine: ch.family as EngineId }
  }
  const base = cur ?? { engine: 'claude' as EngineId, model: CLAUDE_DEFAULT }
  if (ch.model !== undefined) {
    const models = engines.find((e) => e.id === base.engine)?.models ?? []
    const keep = base.effort && findModel(models, ch.model)?.efforts.some((x) => x.id === base.effort)
    return { engine: base.engine, ...(ch.model ? { model: ch.model } : base.engine === 'claude' ? { model: CLAUDE_DEFAULT } : {}), ...(keep ? { effort: base.effort } : {}) }
  }
  const { effort: _old, ...rest } = base
  void _old
  return ch.effort ? { ...rest, effort: ch.effort } : rest
}

/** 别的设置页里的一行「用哪家 AI」（设置 › 读PDF「改写成卡用哪家AI」，task-tz7y3）：和这一页各功能那一列同一个选择器，跟默认或指定，改了提示条能撤回 */
export function AiFeaturePick(props: { feature: AiFeature; name: string; onNotice(t: string): void }) {
  const t = useT()
  const said = useSaid()
  const [v, setV] = useState<AiPrefsView | null>(null)
  useEffect(() => {
    const load = () => void window.cn.aiPrefs().then(setV, (e) => props.onNotice(errText(e)))
    load()
    return ipcOn(window.cn.onAiPrefsChanged, 'cn.onAiPrefsChanged')(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!v) return null
  const { prefs, engines } = v
  const labelOf = (p: AiPick) => pickLabel(p, engines.find((e) => e.id === p.engine)?.models ?? [])
  const own = prefs.features[props.feature] ?? null
  const set = (p: AiPick | null) => {
    const before = prefs
    const features = { ...prefs.features }
    if (p) features[props.feature] = p
    else delete features[props.feature]
    void window.cn.aiSetPrefs({ ...prefs, features }).then(
      (nv) => (setV(nv), said.saved(hintFor(props.name, p ? labelOf(p) : t('跟默认')), () => void window.cn.aiSetPrefs(before).then(setV))),
      (e) => props.onNotice(errText(e)),
    )
  }
  return (
    <AiPicker
      look="box"
      ids={{ family: `ai-pick-${props.feature}`, model: `ai-pick-${props.feature}-model`, effort: `ai-pick-${props.feature}-effort` }}
      familyMenu={t('{name}用哪一家', { name: props.name })}
      familyHead={t('{name}用哪一家', { name: props.name })}
      label={props.name}
      families={engines.map(engineFamily)}
      lead={{ label: t('跟默认'), sub: labelOf(prefs.default), logo: prefs.default.engine }}
      value={valueOf(own)}
      unsetEffort={{ label: t('默认档'), note: t('不指定，用它自己的') }}
      onFamily={(id) => set(id === null ? null : nextPick(own, engines, { family: id }))}
      onModel={(m) => set(nextPick(own, engines, { model: m }))}
      onEffort={(e) => set(nextPick(own, engines, { effort: e }))}
    />
  )
}

export function AiSettingsPage(props: SettingsProps) {
  const t = useT()
  const said = useSaid()
  const [v, setV] = useState<AiPrefsView | null>(null)
  const [tr, setTr] = useState<TranslateSettings | null>(null)
  const [omni, setOmni] = useState<boolean | null>(null)
  const [par, setPar] = useState<number | null>(null)
  useEffect(() => {
    const load = () => {
      void window.cn.aiPrefs().then(setV, (e) => props.onNotice(errText(e)))
      void window.cn.aiEngines().then((r) => setOmni(r.omni))
      void window.cn.aiParallel().then(setPar)
    }
    load()
    void window.cnPlugins.list().then((l) => {
      const tp = l.find((p) => p.id === 'translate')
      if (tp?.enabled) setTr(normalizeTranslate(tp.settings))
    })
    // AI 输入框下面那颗全能模式开关、引擎菜单换了、后台拉到模型、自查完、更新完：这里跟着
    return ipcOn(window.cn.onAiPrefsChanged, 'cn.onAiPrefsChanged')(load)
  }, [])
  if (!v) return null
  const { prefs, engines } = v
  const save = (p: AiPrefs) => window.cn.aiSetPrefs(p).then(setV, (e) => props.onNotice(errText(e)))
  const modelsOf = (id: EngineId) => engines.find((e) => e.id === id)?.models ?? []
  const labelOf = (p: AiPick) => pickLabel(p, modelsOf(p.engine))
  /** 改了一行：马上存，底下提示条说改成了什么、带「撤回」 */
  const commit = (next: AiPrefs, name: string, shown: string) => {
    const before = prefs
    void save(next).then(() => said.saved(hintFor(name, shown), () => void save(before)))
  }
  const setFeature = (f: AiFeature, name: string, p: AiPick | null) => {
    const features = { ...prefs.features }
    if (p) features[f] = p
    else delete features[f]
    commit({ ...prefs, features }, name, p ? labelOf(p) : t('跟默认'))
  }
  const def = prefs.default
  const defInfo = engines.find((e) => e.id === def.engine)
  const families = engines.map(engineFamily)
  const unset = { label: t('默认档'), note: t('不指定，用它自己的') }

  /** 一行的选择器：AI 对话、梦游、看图问、小活（看图问只有 Claude Code） */
  const featurePicker = (f: AiFeature, name: string) => {
    const own = prefs.features[f] ?? null
    // 看图问：Claude（Claude Code、Claude API）、GPT 能看图（task-587os）；不能看图的不列
    const onlyClaude = f === 'vision'
    const canFollow = !onlyClaude || canSeeImages(def.engine)
    // 看图问不跟默认（默认不是 Claude Code）时用 Claude Code 的默认模型
    const shown = own ?? (canFollow ? null : { engine: 'claude' as EngineId, model: CLAUDE_DEFAULT })
    const value = valueOf(shown)
    // AI 对话没选过档是 High（照它实际用的写），别的没选过是命令行自己的默认档
    if (f === 'chat' && shown && !shown.effort && (shown.engine === 'claude' || shown.engine === 'codex')) value.effort = DEFAULT_EFFORT
    return (
      <AiPicker
        look="box"
        ids={{ family: `ai-pick-${f}`, model: `ai-pick-${f}-model`, effort: `ai-pick-${f}-effort` }}
        familyMenu={t('{name}用哪一家', { name })}
        familyHead={t('{name}用哪一家', { name })}
        label={name}
        families={onlyClaude ? families.filter((x) => canSeeImages(x.id as EngineId)) : f === 'dream' ? families.filter((x) => !isLocal(x.id)) : families}
        lead={canFollow ? { label: t('跟默认'), sub: labelOf(def), logo: def.engine } : null}
        value={value}
        unsetEffort={f === 'chat' ? null : unset}
        onFamily={(id) => setFeature(f, name, id === null ? null : nextPick(shown, engines, { family: id }))}
        onModel={(m) => setFeature(f, name, nextPick(shown, engines, { model: m }))}
        onEffort={(e) => setFeature(f, name, nextPick(shown, engines, { effort: e }))}
      />
    )
  }

  const trName = (id: TrEngineId) => TR_ENGINES.find((e) => e.id === id)?.name ?? id
  const trLine = (s: TranslateSettings) => {
    const name = (id: TrEngineId) => (id === 'claude' ? 'Claude Code Haiku' : t(trName(id)))
    return s.engineMode === 'auto' ? s.engineOrder.slice(0, 3).map(name).join(' → ') + (s.engineOrder.length > 3 ? ' …' : '') : name(s.pick)
  }
  const setTrans = (patch: Partial<TranslateSettings>, shown: string) => {
    const before = tr
    return window.cnPlugins.setSettings('translate', patch).then(
      () => {
        setTr((s) => (s ? normalizeTranslate({ ...s, ...patch }) : s))
        said.saved(hintFor(t('翻译'), shown), () => {
          if (!before) return
          void window.cnPlugins.setSettings('translate', { engineMode: before.engineMode, pick: before.pick, pickModel: before.pickModel ?? '', pickEffort: before.pickEffort ?? '' }).then(() => setTr(before))
        })
      },
      (e) => props.onNotice(errText(e)),
    )
  }
  /** 翻译那一行：按顺序 / 只用某一家（命令行的能再选模型、想多久；Claude Code 没选模型是 Haiku，翻译要快） */
  const transPicker = (s: TranslateSettings) => {
    const fams: Family[] = TR_ENGINES.map((e) => {
      const info = engines.find((x) => x.id === e.id)
      const name = t(e.name)
      if (!info) return { id: e.id, label: t('只用{name}', { name }), name, logo: e.id, note: e.sub && t(e.sub), models: [] }
      return { ...engineFamily(info), id: e.id, label: t('只用{name}', { name }), name }
    })
    const picked = s.engineMode === 'pick' ? s.pick : null
    const value: PickerValue = picked ? { family: picked, model: s.pickModel ?? (picked === 'claude' ? 'haiku' : ''), ...(s.pickEffort ? { effort: s.pickEffort } : {}) } : { family: null }
    const cur = (): AiPick | null => (picked && picked !== 'deepseek' && picked !== 'zhipu' ? { engine: picked, ...(value.model ? { model: value.model } : {}), ...(s.pickEffort ? { effort: s.pickEffort } : {}) } : null)
    return (
      <AiPicker
        look="box"
        ids={{ family: 'ai-pick-translate', model: 'ai-pick-translate-model', effort: 'ai-pick-translate-effort' }}
        familyMenu={t('{name}用哪一家', { name: t('翻译') })}
        familyHead={t('{name}用哪一家', { name: t('翻译') })}
        label={t('翻译')}
        families={fams}
        lead={{ label: t('按顺序'), sub: trLine({ ...s, engineMode: 'auto' }), logo: s.engineOrder[0] ?? 'claude' }}
        value={value}
        unsetEffort={unset}
        onFamily={(id) => (id === null ? void setTrans({ engineMode: 'auto' }, t('按顺序')) : void setTrans({ engineMode: 'pick', pick: id as TrEngineId, pickModel: '', pickEffort: '' }, t('只用{name}', { name: t(trName(id as TrEngineId)) })))}
        onModel={(m) => {
          const p = nextPick(cur(), engines, { model: m })
          void setTrans({ pickModel: m, pickEffort: p.effort ?? '' }, labelOf(p))
        }}
        onEffort={(e) => {
          const p = nextPick(cur(), engines, { effort: e })
          void setTrans({ pickEffort: e ?? '' }, labelOf(p))
        }}
      />
    )
  }

  // 梦游那一行：Claude API 的 Haiku 判双链门槛 0.85（设计页第 5 节，写在说明里）
  const dreamPick = prefs.features.dream ?? def
  const dreamDesc = dreamPick.engine === 'anthropic' && /haiku/.test(dreamPick.model ?? '') ? t('整理收件箱、补双链、写周记；门槛0.85') : undefined
  return (
    <>
      {/* AI 从哪来（task-587os）：先是三组「各家命令行」「API Key」「本机模型」，再默认、各功能、能动手到哪 */}
      <EngineRows engines={engines.filter((e) => isCli(e.id))} onNotice={props.onNotice} />
      <SourceRows engines={engines} onNotice={props.onNotice} />
      <div className="sa-grph">{t('默认')}</div>
      {/* 左边只说这一行管什么（家和模型就在右边的选择器里，装没装、能不能用在下面「各家命令行」：design 复审，自查不过时不再写「已装好」） */}
      <div className="sa-engrow aipk-defrow" data-row="aiDefault" data-testid="ai-default" title={defInfo?.path ? labelOf(def) : t('{label}（这台Mac上没找到）', { label: labelOf(def) })}>
        <span className="aipk-def">
          <b>{t('默认用哪家AI')}</b>
          <small>{t('没单独选的功能都用它')}</small>
        </span>
        <span className="sp" />
        <AiPicker
          look="box"
          ids={{ family: 'ai-default-pick', model: 'ai-default-pick-model', effort: 'ai-default-pick-effort' }}
          familyMenu={t('默认用哪一家')}
          familyHead={t('默认用哪一家')}
          label={t('默认')}
          families={families}
          value={valueOf(def)}
          unsetEffort={{ label: t('默认档'), note: t('AI对话里是High') }}
          onFamily={(id) => id && commit({ ...prefs, default: nextPick(def, engines, { family: id }) }, t('默认'), labelOf(nextPick(def, engines, { family: id })))}
          onModel={(m) => commit({ ...prefs, default: nextPick(def, engines, { model: m }) }, t('默认'), labelOf(nextPick(def, engines, { model: m })))}
          onEffort={(e) => commit({ ...prefs, default: nextPick(def, engines, { effort: e }) }, t('默认'), labelOf(nextPick(def, engines, { effort: e })))}
        />
      </div>

      <div className="aipk-wide">
        <Group title={t('各功能用哪个')}>
          {ROWS.map((r) => {
            if (r.f === 'translate') {
              if (!tr) return null
              return (
                <Row
                  key={r.row}
                  id={r.row}
                  desc={
                    <>
                      {t('网页和视频字幕的双语翻译')}
                      <Lnk onClick={() => props.onGoRow('plTranslate')}>{t('排顺序')}</Lnk>
                    </>
                  }
                >
                  {transPicker(tr)}
                </Row>
              )
            }
            return (
              <Row key={r.row} id={r.row} {...(r.f === 'dream' && dreamDesc ? { desc: dreamDesc } : {})}>
                {featurePicker(r.f, t(settingsItem(r.row)!.label))}
              </Row>
            )
          })}
        </Group>
      </div>

      <Group title={t('能动手到哪')}>
        <Row id="omni">
          <Toggle
            on={omni ?? true}
            label={t('全能模式')}
            onChange={(on) => {
              setOmni(on)
              void window.cn.aiSetOmni(on).catch((e: unknown) => props.onNotice(errText(e)))
              said.saved(on ? t('AI输入框下面那颗开关也开了') : t('AI输入框下面那颗开关也关了：AI只在库里动手'), () => {
                setOmni(!on)
                void window.cn.aiSetOmni(!on)
              })
            }}
          />
        </Row>
        <Row id="parallel">
          <select
            aria-label={t('同时答几段对话')}
            value={par ?? PARALLEL_DEFAULT}
            onChange={(e) => {
              const n = Number(e.currentTarget.value)
              const was = par ?? PARALLEL_DEFAULT
              setPar(n)
              void window.cn.aiSetParallel(n).catch((err: unknown) => props.onNotice(errText(err)))
              said.saved(t('最多同时答{n}段对话，多的排队', { n }), () => {
                setPar(was)
                void window.cn.aiSetParallel(was)
              })
            }}
          >
            {Array.from({ length: PARALLEL_MAX }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {t('{n}段', { n })}
              </option>
            ))}
          </select>
        </Row>
        <PromptRow />
      </Group>

      <CiteGroup {...props} />

      <MobileAiGroup onNotice={props.onNotice} />
    </>
  )
}

/**
 * 回答里的链接（task-3e53q，已定 4：先做、能关）：AI 光写了笔记名没写成链接时软件按名字认（cite-names.tsx），和不认的名字放一组。
 * 不认的名字一行一个，离开框时存
 */
function CiteGroup(props: SettingsProps) {
  const t = useT()
  const said = useSaid()
  const c = props.settings.cite
  const [skip, setSkip] = useState(c.skip.join('\n'))
  const saved = useRef(c.skip.join('\n'))
  const save = () => {
    const now = skip
    if (now === saved.current) return
    const old = saved.current
    saved.current = now
    const list = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
    void props.onChange({ cite: { skip: list(now) } })
    said.saved(t('已存 · 这些名字不再认成链接'), () => {
      saved.current = old
      setSkip(old)
      void props.onChange({ cite: { skip: list(old) } })
    })
  }
  return (
    <Group title={t('回答里的链接')}>
      <Row id="citeNames">
        <Toggle
          on={c.names}
          label={t('回答里提到的笔记名自动认成链接')}
          onChange={(on) => {
            void props.onChange({ cite: { names: on } })
            said.saved(on ? t('回答里光写了笔记名的，软件也认成链接') : t('只认AI写成链接的和写了路径的'), () => void props.onChange({ cite: { names: !on } }))
          }}
        />
      </Row>
      <Row id="citeSkip" full dim={!c.names}>
        <textarea className="sa-fld" aria-label={t('这些名字不认')} placeholder={t('比如：周报')} value={skip} rows={3} onChange={(e) => setSkip(e.currentTarget.value)} onBlur={save} />
      </Row>
    </Group>
  )
}

/** 给AI的长期说明：整行宽的框，离开框（或关上设置）时存，AI 对话和读 PDF 每一问都带上 */
function PromptRow() {
  const t = useT()
  const said = useSaid()
  const [text, setText] = useState<string | null>(null)
  const saved = useRef('')
  const now = useRef('')
  useEffect(() => {
    void window.cn.aiPrompt().then((s) => {
      saved.current = s
      now.current = s
      setText(s)
    })
    // 打着字就关上设置：照样存
    return () => {
      if (now.current !== saved.current) void window.cn.aiSetPrompt(now.current)
    }
  }, [])
  const save = () => {
    if (now.current === saved.current) return
    saved.current = now.current
    void window.cn.aiSetPrompt(now.current).then(() => said.say(now.current.trim() ? t('已存 · 给AI的长期说明：下一问起都带上') : t('已存 · 给AI的长期说明空了，不再带')))
  }
  return (
    <Row id="prompt" full>
      <textarea
        className="sa-fld"
        aria-label={t('给AI的长期说明')}
        placeholder={t('比如：回答用中文，先说结论；讲课程内容时中英对照')}
        value={text ?? ''}
        disabled={text === null}
        onChange={(e) => {
          now.current = e.currentTarget.value
          setText(e.currentTarget.value)
        }}
        onBlur={save}
      />
    </Row>
  )
}
