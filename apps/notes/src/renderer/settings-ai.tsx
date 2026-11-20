/**
 * 设置 › AI（CN-44 方向 A）：上面「默认」一行（哪家、哪个模型，「换」）；下面「各功能用哪个」五行：
 * AI 对话、梦游、看图问、翻译、小活，每行一个下拉「跟默认 / 指定某家某模型」；翻译那行是它自己的顺序，旁边「排顺序 ›」。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import type { EngineId, EngineInfo } from '../shared/agent'
import { type AiFeature, type AiPick, type AiPrefs, CLAUDE_MODELS, ENGINE_LABEL, pickLabel, samePick } from '../shared/ai-features'
import type { AiPrefsView } from '../shared/api'
import { ENGINES as TR_ENGINES, normalizeTranslate, type TranslateSettings, type TrEngineId } from '../shared/plugins/translate'
import { EngineLogo } from './engine-logo'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const ROWS: { f: AiFeature | 'translate'; name: string; desc: string; icon: CodiconName }[] = [
  { f: 'chat', name: 'AI对话', desc: '右栏AI那一格，读PDF时的边读边问也是它', icon: 'comment-discussion' },
  { f: 'dream', name: '梦游', desc: '夜里整理收件箱、写报告、做可视化', icon: 'wand' },
  { f: 'vision', name: '看图问', desc: '视频框一块问、拍导图识别（要能看图）', icon: 'device-camera' },
  { f: 'translate', name: '翻译', desc: '网页和视频字幕的双语翻译、右键翻译这段', icon: 'whole-word' },
  { f: 'quick', name: '小活', desc: '视频摘要、起名、插件里的快问', icon: 'note' },
]

/** 一家能选的：Claude Code 三个模型，别家用它自己的默认模型 */
function choices(engines: EngineInfo[], onlyClaude = false): { pick: AiPick; label: string; sub: string; off: boolean }[] {
  const out: { pick: AiPick; label: string; sub: string; off: boolean }[] = []
  for (const e of engines) {
    if (onlyClaude && e.id !== 'claude') continue
    if (e.id === 'claude') for (const m of CLAUDE_MODELS) out.push({ pick: { engine: 'claude', model: m.id }, label: ENGINE_LABEL.claude, sub: m.label, off: !e.path })
    else out.push({ pick: { engine: e.id }, label: ENGINE_LABEL[e.id], sub: '它自己的默认模型', off: !e.path })
  }
  return out
}

function modelOf(p: AiPick): string {
  return p.engine === 'claude' ? (CLAUDE_MODELS.find((m) => m.id === p.model)?.label ?? p.model ?? '') : '它自己的默认模型'
}

/** 一个下拉：按钮 + 菜单（菜单 280 宽、圆角 12、行 30 高，左边 12 宽放勾，同引擎菜单） */
function Drop(props: { label: string; button: React.ReactNode; items: { key: string; logo?: EngineId | TrEngineId; label: string; sub: string; on: boolean; off?: boolean; run(): void }[]; testid?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])
  return (
    <div className="aip-drop" ref={box}>
      <button className="aip-btn" aria-haspopup="menu" aria-expanded={open} aria-label={props.label} data-testid={props.testid} onClick={() => setOpen((o) => !o)}>
        {props.button}
        <Codicon name="chevron-down" size={12} />
      </button>
      {open && (
        <div className="aip-menu" role="menu" aria-label={props.label}>
          {props.items.map((it) => (
            <button
              key={it.key}
              role="menuitemradio"
              aria-checked={it.on}
              disabled={it.off}
              onClick={() => {
                setOpen(false)
                it.run()
              }}
            >
              <span className="ck">{it.on && <Codicon name="check" size={12} />}</span>
              {it.logo ? <EngineLogo id={it.logo} /> : <span className="nologo" />}
              <b>{it.label}</b>
              <span className="sub truncate">{it.off ? '没装' : it.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AiSettingsPage(props: { onNotice(t: string): void; onPlugins(): void }) {
  const [v, setV] = useState<AiPrefsView | null>(null)
  const [tr, setTr] = useState<TranslateSettings | null>(null)
  useEffect(() => {
    void window.cn.aiPrefs().then(setV, (e) => props.onNotice(errText(e)))
    void window.cnPlugins.list().then((l) => {
      const t = l.find((p) => p.id === 'translate')
      if (t?.enabled) setTr(normalizeTranslate(t.settings))
    })
  }, [])
  if (!v) return null
  const { prefs, engines } = v
  const save = (p: AiPrefs) => window.cn.aiSetPrefs(p).then(setV, (e) => props.onNotice(errText(e)))
  const setFeature = (f: AiFeature, p: AiPick | null) => {
    const features = { ...prefs.features }
    if (p) features[f] = p
    else delete features[f]
    void save({ ...prefs, features })
  }
  const def = prefs.default
  const defInfo = engines.find((e) => e.id === def.engine)
  const others = engines.filter((e) => e.id !== def.engine)
  const missing = others.filter((e) => !e.path).map((e) => ENGINE_LABEL[e.id])
  const ready = others.filter((e) => e.path).map((e) => ENGINE_LABEL[e.id])

  const pickItems = (f: AiFeature) => {
    const onlyClaude = f === 'vision'
    const own = prefs.features[f]
    const canFollow = !onlyClaude || def.engine === 'claude'
    return [
      ...(canFollow ? [{ key: 'follow', logo: def.engine, label: '跟默认', sub: pickLabel(def), on: !own, run: () => setFeature(f, null) }] : []),
      ...choices(engines, onlyClaude).map((c) => ({
        key: `${c.pick.engine}:${c.pick.model ?? ''}`,
        logo: c.pick.engine,
        label: c.label,
        sub: c.sub,
        off: c.off,
        on: !!own && samePick(own, c.pick),
        run: () => setFeature(f, c.pick),
      })),
    ]
  }

  const trLine = (t: TranslateSettings) => {
    const name = (id: TrEngineId) => (id === 'claude' ? 'Claude Code Haiku' : (TR_ENGINES.find((e) => e.id === id)?.name ?? id))
    return t.engineMode === 'auto' ? t.engineOrder.slice(0, 3).map(name).join(' → ') + (t.engineOrder.length > 3 ? ' …' : '') : name(t.pick)
  }
  const setTrans = (patch: Partial<TranslateSettings>) =>
    window.cnPlugins.setSettings('translate', patch).then(
      () => setTr((t) => (t ? { ...t, ...patch } : t)),
      (e) => props.onNotice(errText(e)),
    )

  return (
    <div className="aip">
      <h4>
        默认<span>用这台Mac上已经登录的命令行，不另存密钥</span>
      </h4>
      <div className="aip-def" data-testid="ai-default">
        <EngineLogo id={def.engine} size={16} />
        <b>{ENGINE_LABEL[def.engine]}</b>
        <span className="st">
          {defInfo?.path ? '已装好' : '没装'}
          {def.engine === 'claude' ? ` · 模型${modelOf(def)}` : ' · 用它自己的默认模型'}
        </span>
        <span className="sp" />
        <Drop
          label="默认用哪个"
          testid="ai-default-pick"
          button={<span className="lbl">换</span>}
          items={choices(engines).map((c) => ({ key: `${c.pick.engine}:${c.pick.model ?? ''}`, logo: c.pick.engine, label: c.label, sub: c.sub, off: c.off, on: samePick(def, c.pick), run: () => void save({ ...prefs, default: c.pick }) }))}
        />
      </div>
      <p className="note">
        {[missing.length ? `${missing.join('、')}没装` : '', ready.length ? `${ready.join('、')}已装好` : ''].filter(Boolean).join('；')}
      </p>
      <h4>
        各功能用哪个<span>默认跟着上面走；单独指定的写在这里</span>
      </h4>
      <div className="aip-rows" role="list" aria-label="各功能用哪个">
        {ROWS.map((r) => {
          if (r.f === 'translate') {
            if (!tr) return null
            return (
              <div key={r.f} className="aip-row" role="listitem" data-feature="translate">
                <Codicon name={r.icon} size={16} className="ic" />
                <span className="tx">
                  <b>{r.name}</b>
                  <span>{r.desc}</span>
                </span>
                <Drop
                  label="翻译用哪个"
                  testid="ai-pick-translate"
                  button={
                    <>
                      <EngineLogo id={tr.engineMode === 'auto' ? (tr.engineOrder[0] ?? 'claude') : tr.pick} />
                      <b>{tr.engineMode === 'auto' ? '按顺序' : '只用'}</b>
                      <span className="m truncate">{trLine(tr)}</span>
                    </>
                  }
                  items={[
                    { key: 'auto', logo: tr.engineOrder[0] ?? 'claude', label: '按顺序', sub: trLine({ ...tr, engineMode: 'auto' }), on: tr.engineMode === 'auto', run: () => void setTrans({ engineMode: 'auto' }) },
                    ...TR_ENGINES.map((e) => ({ key: e.id, logo: e.id, label: `只用${e.name}`, sub: e.sub, on: tr.engineMode === 'pick' && tr.pick === e.id, run: () => void setTrans({ engineMode: 'pick', pick: e.id }) })),
                  ]}
                />
                <button className="aip-link" onClick={props.onPlugins}>
                  排顺序
                  <Codicon name="chevron-right" size={12} />
                </button>
              </div>
            )
          }
          const f = r.f
          const own = prefs.features[f]
          const used = own ?? (f === 'vision' && def.engine !== 'claude' ? null : def)
          return (
            <div key={f} className="aip-row" role="listitem" data-feature={f}>
              <Codicon name={r.icon} size={16} className="ic" />
              <span className="tx">
                <b>{r.name}</b>
                <span>{r.desc}</span>
              </span>
              <Drop
                label={`${r.name}用哪个`}
                testid={`ai-pick-${f}`}
                button={
                  own || !used ? (
                    <>
                      <EngineLogo id={(own ?? { engine: 'claude' as const }).engine} />
                      <b>{ENGINE_LABEL[(own ?? { engine: 'claude' as const }).engine]}</b>
                      <span className="m">{v.labels[f].split(' · ')[1] ?? '默认模型'}</span>
                    </>
                  ) : (
                    <>
                      <EngineLogo id={used.engine} />
                      <b>跟默认</b>
                      <span className="m">{v.labels[f]}</span>
                    </>
                  )
                }
                items={pickItems(f)}
              />
              {f === 'vision' && <span className="aip-why">只有它能看图</span>}
            </div>
          )
        })}
      </div>
      <p className="note">AI改的每一处都是一次提交，AI那一格里能撤回。全能模式（AI输入框下面的开关，默认开）下它和在终端里一样，能读写这台Mac上的文件、跑命令、上网；关掉后只在库里用软件给它的工具：新建、改写、改名、挪动、删笔记。</p>
    </div>
  )
}
