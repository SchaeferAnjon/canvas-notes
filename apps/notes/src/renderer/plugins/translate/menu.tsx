/**
 * 方向 A「按钮带菜单」：地址栏里的翻译按钮是一对，左边开关、右边小箭头开菜单。
 * 菜单里换翻成什么、对照 / 只看译文、七种样式，术语表和「整页剪藏带上译文」，底下是用谁翻和「翻译设置…」。
 * 改了就是新的默认值（和设置里同一份），菜单不关，网页上马上变；设好就收起来，下次点开关直接按上次的翻（偏好「设好就收起来」）。
 */
import { Codicon } from '@cn/design'
import { useKeyHandler, useKeys } from '../../keys'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  effectiveTarget,
  engineMeta,
  LANG_ZH,
  LANGS,
  langName,
  primary,
  sameLang,
  SHORT,
  STATE_TEXT,
  STYLES,
  type TrPageState,
  type TrStyle,
} from '../../../shared/plugins/translate'
import { Toggle } from '../../Settings'
import { errText, setPluginSettings, usePageState, usePlugins, webHost } from '../host'
import type { WebPage } from '../types'
import { type EnginesInfo, FailBox, ID, openTranslateSettings, settingsNow, toggleTranslate, useEngines } from './shared'
import { openWebRead } from '../../reading/web-bridge'

const editable = (el: Element | null) => !!el && ((el as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

/** 每个网页上次看到的「请打开菜单」「这是 PDF」号：只对新的反应 */
const seenMenu = new Map<number, number>()
const seenPdf = new Map<number, number>()

/** 地址栏里的那一对：开关 + 小箭头 */
export function TrControl({ page, open, onPopup }: { page: WebPage | null; open: boolean; onPopup(id: string | null): void }) {
  /** 写在界面上的键照命令表（改了跟着变） */
  const K = useKeys()
  const st = usePageState<TrPageState>(page?.wcId, ID)
  usePlugins()
  const s = settingsNow()
  const on = !!st?.on
  const err = on && !!(st.blocked || st.failed)

  // 一开就发现没有能用的：直接打开菜单说原因；PDF（按 ⌥A 开的；地址栏里没有这一对）：说翻不了，去库里的 PDF 阅读器框一块问
  useEffect(() => {
    if (!page || !st) return
    if (st.menuSeq > (seenMenu.get(page.wcId) ?? 0)) {
      seenMenu.set(page.wcId, st.menuSeq)
      onPopup(ID)
    }
    if (st.pdfSeq > (seenPdf.get(page.wcId) ?? 0)) {
      seenPdf.set(page.wcId, st.pdfSeq)
      webHost()?.notice('这是PDF，网页里的双语翻译翻不了它。放进库里用PDF阅读器打开，框一块点「翻译 + 讲一讲」')
    }
  }, [page, st, onPopup])

  // 焦点在软件界面（不是网页、不在输入框里）时双语翻译的键（命令表，默认 ⌥A）也开关当前网页；网页里的由网页预加载自己接
  useKeyHandler('translate', () => {
    const h = webHost()
    if (!h?.visible() || editable(document.activeElement)) return false
    toggleTranslate(h.page())
    return true
  })

  // 网页里「加进术语表」之后：在中间栏打开那张表
  useEffect(() => window.cnPlugins.on(ID, 'openNote', (p) => webHost()?.openNote((p as { path: string }).path)), [])

  // 浏览器自己的 PDF 查看器：网页翻译翻不了，不给这一项（PDF 双语对照 2026-11-18 用户定删掉）
  if (st?.pdf) return null
  const short = SHORT[st?.target ?? s.target] ?? ''
  return (
    <span className={'trctl imp' + (err ? ' err' : on ? ' on' : '')}>
      {/* 地址栏里只留图标和小箭头：翻成什么设好就收进菜单（设好就收起来），开着时图标是强调色 */}
      <button type="button" className="trc-tg" aria-label="双语翻译" aria-pressed={on} title={on ? `恢复原文（在翻成${short}）${K('translate') ?? ''}` : `双语翻译${K('translate') ? ` ${K('translate')}` : ''}`} onClick={() => toggleTranslate(page)}>
        <Codicon name="whole-word" size={16} />
        {err && <span className="trc-lb">没翻成</span>}
        {err && <span className="trc-dot" />}
      </button>
      <button type="button" className="trc-dd" aria-label="翻译选项" aria-haspopup="dialog" aria-expanded={open} title="翻成、显示、样式" onClick={() => onPopup(open ? null : ID)}>
        <Codicon name="chevron-down" size={12} />
      </button>
    </span>
  )
}

/** 样式格子里的小预览：一行原文、一行用这个样式的译文 */
function StylePreview({ s }: { s: TrStyle }) {
  return (
    <span className="pv">
      <span className="o" style={s === 'fade' ? { opacity: 0.45 } : undefined}>
        Eigenvalue λ
      </span>
      <span className={'t s-' + s}>
        <span>特征值 λ</span>
      </span>
    </span>
  )
}

interface GlossaryInfo {
  course: string | null
  path: string | null
  exists: boolean
  count: number
}

/** 菜单本身（插件的弹窗）：贴在地址行下面，右边和地址栏右端对齐 */
export function TrMenu({ page, onClose }: { page: WebPage | null; onClose(): void }) {
  /** 写在界面上的键照命令表（改了跟着变） */
  const K = useKeys()
  const ref = useRef<HTMLDivElement>(null)
  usePlugins()
  const st = usePageState<TrPageState>(page?.wcId, ID)
  const s = settingsNow()
  const [engines] = useEngines(false, [s.engineMode, s.pick, s.engineOrder.join()])
  const [gl, setGl] = useState<GlossaryInfo | null>(null)
  const [writing, setWriting] = useState<number | null>(null)
  const notice = (t: string) => webHost()?.notice(t)

  useLayoutEffect(() => {
    const place = () => {
      const pop = ref.current?.parentElement
      const box = ref.current?.closest('.right.web')
      const addr = box?.querySelector('.rhead .addr')
      const row = box?.querySelector('.rhead')
      if (!pop || !box || !addr || !row) return
      const b = box.getBoundingClientRect()
      pop.style.top = `${row.getBoundingClientRect().bottom - b.top - 2}px`
      pop.style.right = `${Math.max(8, b.right - addr.getBoundingClientRect().right)}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [])

  useEffect(() => {
    void window.cnPlugins.call<GlossaryInfo>(ID, 'glossary').then(setGl, (e) => notice(errText(e)))
    return window.cnPlugins.on(ID, 'glossaryProgress', (p) => setWriting((p as { found: number }).found))
  }, [])

  const set = (patch: Record<string, unknown>) => void setPluginSettings(ID, patch).catch((e) => notice(errText(e)))
  const on = !!st?.on
  const failure = on ? (st.blocked ?? (st.failed && st.error ? st.error : undefined)) : undefined

  // 「这页是 English」；目标就是网页的语言时「网页本身是英文，这页改翻成简体中文」
  const pageLang = st?.pageLang ?? null
  const langNote = pageLang
    ? sameLang(pageLang, s.target)
      ? `网页本身是${LANG_ZH[primary(pageLang)] ?? langName(pageLang)}，这页改翻成${langName(effectiveTarget(s.target, pageLang))}`
      : `这页是${langName(pageLang)}`
    : ''

  async function draft() {
    setWriting(0)
    try {
      const r = await window.cnPlugins.call<{ path: string; count: number }>(ID, 'glossaryDraft', { wcId: page?.wcId })
      setGl({ course: gl?.course ?? null, path: r.path, exists: true, count: r.count })
      notice(`AI写好了术语表，${r.count}条，是一次提交，可撤回`)
      webHost()?.openNote(r.path)
    } catch (e) {
      notice(errText(e))
    } finally {
      setWriting(null)
    }
  }

  const used = (engines?.lastUsed && engines.list.find((e) => e.id === engines.lastUsed && e.state === 'ok')?.id) || engines?.current
  const foot = footText(engines, used ?? null)

  return (
    <div ref={ref} className="trm" role="dialog" aria-label="双语翻译">
      <div className="trm-hd">
        <b>双语翻译</b>
        {K('translate') && <span className="kc">{K('translate')}</span>}
        <span className="sp" />
        <Toggle on={on} label="双语翻译 开关" onChange={() => toggleTranslate(page)} />
      </div>
      {failure && (
        <div className="trm-sec">
          <FailBox error={failure} failed={st?.failed ?? 0} engines={engines} page={page} retryAt={st?.retryAt} onDone={onClose} onNotice={notice} />
        </div>
      )}
      <div className="trm-sec">
        <div className="trm-lab">
          翻成<span className="sp" />
          {langNote && <span>{langNote}</span>}
        </div>
        <div className="trm-langs" role="radiogroup" aria-label="翻成">
          {LANGS.map((l) => (
            <button key={l.code} type="button" role="radio" aria-checked={s.target === l.code} className={s.target === l.code ? 'on' : ''} onClick={() => set({ target: l.code })}>
              <span className="ck">{s.target === l.code && <Codicon name="check" size={12} />}</span>
              {l.name}
            </button>
          ))}
        </div>
      </div>
      <div className="trm-sec">
        <div className="trm-lab">显示</div>
        <div className="seg" role="radiogroup" aria-label="译文怎么显示">
          {(
            [
              ['below', '对照'],
              ['only', '只看译文'],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={s.display === id} className={s.display === id ? 'on' : ''} onClick={() => set({ display: id })}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="trm-sec">
        <div className="trm-lab">
          样式<span className="sp" />
          {s.display === 'only' ? <span>只看译文时没有样式</span> : s.style === 'blur' ? <span>点一段看译文</span> : null}
        </div>
        <div className="trm-styles" role="radiogroup" aria-label="译文样式">
          {STYLES.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={s.style === x.id}
              aria-label={x.name}
              className={'sty' + (s.style === x.id ? ' on' : '')}
              disabled={s.display === 'only'}
              onClick={() => set({ style: x.id })}
            >
              <StylePreview s={x.id} />
              <span className="nm">{x.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="trm-hr" />
      <button
        type="button"
        className="trm-row link"
        aria-label="在中间栏左右对照读"
        onClick={() => {
          const el = webHost()?.view()
          onClose()
          if (el) openWebRead(el).catch((e) => notice(errText(e)))
        }}
      >
        <Codicon name="book" size={14} />
        <span>在中间栏左右对照读</span>
        <span className="t3">阅读视图，原文跟译文</span>
      </button>
      <GlossaryRow gl={gl} writing={writing} onOpen={(p) => (webHost()?.openNote(p), onClose())} onDraft={() => void draft()} />
      <div className="trm-row">
        <span>整页剪藏带上译文</span>
        <span className="t3">{s.clipWithTranslation ? '原文下面跟译文' : '关着只存原文'}</span>
        <span className="sp" />
        <Toggle on={s.clipWithTranslation} label="整页剪藏带上译文" onChange={(v) => set({ clipWithTranslation: v })} />
      </div>
      <div className="trm-foot">
        <Codicon name={used && engineMeta(used).kind === 'api' ? 'key' : 'terminal'} size={12} />
        <span className="truncate">{foot}</span>
        <span className="sp" />
        <button
          type="button"
          className="tr-lnk"
          onClick={() => {
            onClose()
            openTranslateSettings()
          }}
        >
          翻译设置…
        </button>
      </div>
    </div>
  )
}

/** 底下那句：「用 Claude Code · Haiku 翻」；指定的坏了「指定用 Claude Code（没登录）」 */
function footText(engines: EnginesInfo | null, used: string | null): string {
  if (!engines) return ''
  const s = settingsNow()
  if (used) {
    const e = engines.list.find((x) => x.id === used)
    if (e) return `用${e.id === 'claude' ? 'Claude Code · Haiku' : e.kind === 'api' ? `${e.name} API` : e.name}翻`
  }
  if (s.engineMode === 'pick') {
    const p = engines.list.find((x) => x.id === s.pick)
    if (p) return `指定用${p.name}（${STATE_TEXT[p.state]}）`
  }
  return '没有能翻的'
}

function GlossaryRow({ gl, writing, onOpen, onDraft }: { gl: GlossaryInfo | null; writing: number | null; onOpen(path: string): void; onDraft(): void }) {
  const head = (
    <>
      <Codicon name="book" size={14} />
      <span>术语表</span>
    </>
  )
  if (writing !== null)
    return (
      <div className="trm-row" aria-label="术语表">
        {head}
        <span className="sp" />
        <Codicon name="loading" size={12} className="spin" />
        <span className="t3">{`AI在写${writing ? `，找到${writing}条` : ''}…`}</span>
      </div>
    )
  if (!gl?.course)
    return (
      <div className="trm-row" aria-label="术语表">
        {head}
        <span className="t3">中间栏开着课程里的文件时，照那门课的表翻</span>
      </div>
    )
  if (gl.exists && gl.path)
    return (
      <button type="button" className="trm-row link" aria-label="术语表" onClick={() => onOpen(gl.path!)}>
        {head}
        <span className="t3">
          {`${gl.course} · ${gl.count}条`}
        </span>
        <span className="sp" />
        <span className="tr-lnk">打开</span>
      </button>
    )
  return (
    <div className="trm-row" aria-label="术语表">
      {head}
      <span className="t3">{`${gl.course}还没有`}</span>
      <span className="sp" />
      <button type="button" className="tr-lnk" onClick={onDraft}>
        让AI起个头
      </button>
    </div>
  )
}
