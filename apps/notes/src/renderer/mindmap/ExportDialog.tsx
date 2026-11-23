/**
 * 导出导图的弹窗（第二批 ④⑫，设计页「导出图片」那一屏）：左边预览（就是要导出的那一份），右边格式一排 PNG 图片 · SVG · PDF · OPML 大纲，
 * PNG 清晰度 1 / 2 / 3 倍，PDF 纸跟导图一样大 / A4 横放 / A4 竖放，底色跟现在一样 / 白底 / 透明，带不带原照片，选着一个主题（或只看这一枝）时能只导出这一枝。
 * 下次照这回的设置（偏好「设好就收起来」，记在这台 Mac 上）；导出不改这篇文件。勾选框是方的（偏好「方角开关」）。
 */
import { Codicon } from '@cn/design'
import { type MapNode, mapShown, mindmapOpml, nodeAt } from '@cn/format'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MapLayout } from '../../shared/mindmap-layout'
import { useT } from '../i18n'
import type { ExportFormat } from './export-store'
import { branchLabel, type ExportLook, mapSvg, svgToPng } from './map-export'

type Paper = 'map' | 'a4-land' | 'a4-port'
interface Saved {
  fmt: ExportFormat
  scale: 1 | 2 | 3
  paper: Paper
  bg: ExportLook['bg']
  photo: boolean
}
const KEY = 'cn.mapExport'
const DEFAULT: Saved = { fmt: 'png', scale: 2, paper: 'map', bg: 'now', photo: true }
function load(): Saved {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) }
  } catch {
    // 记的设置读不出来：照默认的
    return DEFAULT
  }
}

export function ExportDialog(props: {
  overlay: HTMLElement
  fmt?: ExportFormat
  roots: MapNode[]
  notePath: string
  palette: 'theme' | 'rainbow' | 'ink'
  photo: { src: string; caption: string } | null
  /** 选着的主题、或正在只看的那一枝（能只导出这一枝） */
  branch: string | null
  /** 只看这一枝时默认就只导出这一枝 */
  branchFirst: boolean
  /** 整张（null）或只这一枝的排版，和画出来的同一套 */
  layoutFor(branch: string | null): MapLayout
  relLabels(L: MapLayout): (string | undefined)[]
  host: HTMLElement
  onDone(path: string | null): void
  onClose(): void
}) {
  const t = useT()
  const [o, setO] = useState<Saved>(() => ({ ...load(), ...(props.fmt ? { fmt: props.fmt } : {}) }))
  const [branch, setBranch] = useState(props.branchFirst && !!props.branch)
  const [pv, setPv] = useState<{ svg: string; w: number; h: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const go = useRef<HTMLButtonElement>(null)
  const set = (x: Partial<Saved>) => setO((v) => ({ ...v, ...x }))
  const bg = o.fmt === 'pdf' && o.bg === 'clear' ? 'now' : o.bg
  const key = branch && props.branch ? props.branch : null
  const name = props.notePath.split('/').pop()!.replace(/\.md$/i, '') + (key ? ` · ${branchLabel(props.roots, key)}` : '')
  // 预览就是要导出的那一份
  useEffect(() => {
    if (o.fmt === 'opml') return setPv(null)
    let alive = true
    const L = props.layoutFor(key)
    void mapSvg({ L, roots: props.roots, notePath: props.notePath, palette: props.palette, look: { bg, photo: o.photo && !key }, photo: props.photo, relLabels: props.relLabels(L), host: props.host }).then((r) => alive && setPv(r))
    return () => {
      alive = false
    }
  }, [o.fmt, bg, o.photo, key])
  useEffect(() => go.current?.focus(), [])

  async function run() {
    setBusy(true)
    try {
      try {
        localStorage.setItem(KEY, JSON.stringify(o))
      } catch {
        // 记不住设置不影响这一次
      }
      let path: string | null
      if (o.fmt === 'opml') {
        const list = key ? [nodeAt(props.roots, key.split('.').map(Number))!] : props.roots
        path = await window.cnMap.exportFile('opml', name, mindmapOpml(name, list))
      } else {
        const L = props.layoutFor(key)
        const r = await mapSvg({ L, roots: props.roots, notePath: props.notePath, palette: props.palette, look: { bg, photo: o.photo && !key }, photo: props.photo, relLabels: props.relLabels(L), host: props.host })
        if (o.fmt === 'svg') path = await window.cnMap.exportFile('svg', name, r.svg)
        else if (o.fmt === 'png') path = await window.cnMap.exportFile('png', name, await svgToPng(r.svg, r.w, r.h, o.scale))
        else path = await window.cnMap.exportPdf(name, r.svg, o.paper === 'map' ? { w: r.w, h: r.h } : o.paper)
      }
      props.onDone(path)
    } finally {
      setBusy(false)
    }
  }

  const seg = <V extends string | number>(label: string, now: V, list: [V, string][], pick: (v: V) => void, testid: string) => (
    <div className="row">
      <span className="lb">{label}</span>
      <span className="seg" role="radiogroup" aria-label={label} data-testid={testid}>
        {list.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={v === now} className={v === now ? 'on' : ''} onClick={() => pick(v)}>
            {text}
          </button>
        ))}
      </span>
    </div>
  )
  const check = (on: boolean, label: string, toggle: (() => void) | null, why?: string) => (
    <div className="row">
      <span className="lb" />
      <button type="button" role="checkbox" aria-checked={on} className={'ck' + (on ? ' on' : '')} disabled={!toggle} data-tip={why} onClick={() => toggle?.()}>
        <i>{on && <Codicon name="check" size={12} />}</i>
        {label}
      </button>
    </div>
  )
  const branchText = props.branch ? branchLabel(props.roots, props.branch) : ''
  const pvScale = pv ? Math.min(312 / pv.w, 208 / pv.h, 1) : 1
  const note =
    o.fmt === 'opml'
      ? t('OPML 是大纲的通用格式：OmniOutliner、幕布、XMind 都能打开。外框、概要、联系线、图片、配色带不过去。')
      : o.fmt === 'svg'
        ? t('画成矢量图，放大不糊；字用系统字体，在别的电脑上打开字形可能略有不同。')
        : o.fmt === 'pdf'
          ? t('一页放下整张导图；字能选、能搜。')
          : pv
            ? t('{w} 像素宽 · 贴进微信、Keynote 都清楚。', { w: Math.round(pv.w * o.scale) })
            : ''
  return createPortal(
    <div className="mm-dlg-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        ref={box}
        className="mm-dlg"
        role="dialog"
        aria-label={t('导出导图')}
        data-testid="map-export"
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') (e.preventDefault(), props.onClose())
        }}
      >
        <div className="dh">
          <Codicon name="export" size={16} />
          {t('导出导图')}
          <button type="button" className="x" aria-label={t('关掉')} onClick={props.onClose}>
            <Codicon name="close" size={14} />
          </button>
        </div>
        <div className="db">
          <div className={'pv' + (bg === 'clear' && o.fmt === 'png' ? ' tr' : '')} data-testid="map-export-preview">
            {o.fmt === 'opml' ? (
              <OpmlPreview roots={key ? [nodeAt(props.roots, key.split('.').map(Number))!] : props.roots} />
            ) : pv ? (
              <img alt={t('预览')} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pv.svg)} style={{ width: pv.w * pvScale, height: pv.h * pvScale }} />
            ) : null}
          </div>
          <div>
            {seg(
              t('格式'),
              o.fmt,
              [
                ['png', t('PNG 图片')],
                ['svg', 'SVG'],
                ['pdf', 'PDF'],
                ['opml', t('OPML 大纲')],
              ],
              (fmt) => set({ fmt }),
              'map-export-fmt',
            )}
            {o.fmt === 'opml' ? (
              <div className="row">
                <span className="lb">{t('有什么')}</span>
                <span>{t('每个主题一行，备注跟着主题走')}</span>
              </div>
            ) : (
              <>
                {o.fmt === 'png' &&
                  seg(
                    t('清晰度'),
                    o.scale,
                    [
                      [1, t('1倍')],
                      [2, t('2倍')],
                      [3, t('3倍')],
                    ],
                    (scale) => set({ scale }),
                    'map-export-scale',
                  )}
                {o.fmt === 'pdf' &&
                  seg(
                    t('纸'),
                    o.paper,
                    [
                      ['map', t('跟导图一样大')],
                      ['a4-land', t('A4 横放')],
                      ['a4-port', t('A4 竖放')],
                    ],
                    (paper) => set({ paper }),
                    'map-export-paper',
                  )}
                {seg(
                  t('底色'),
                  bg,
                  o.fmt === 'pdf'
                    ? [
                        ['now', t('跟现在一样')],
                        ['white', t('白底（打印）')],
                      ]
                    : [
                        ['now', t('跟现在一样')],
                        ['white', t('白底')],
                        ['clear', t('透明')],
                      ],
                  (v) => set({ bg: v }),
                  'map-export-bg',
                )}
                {props.photo && check(o.photo && !key, t('带上原照片'), key ? null : () => set({ photo: !o.photo }), key ? t('只导出一枝时不带照片') : undefined)}
              </>
            )}
            {check(branch && !!props.branch, props.branch ? t('只导出「{name}」这一枝', { name: branchText }) : t('只导出选中的那一枝'), props.branch ? () => setBranch(!branch) : null, props.branch ? undefined : t('先在导图上选一个主题'))}
            <div className="note">{note}</div>
          </div>
        </div>
        <div className="df">
          <span className="t3">{t('下次照这回的设置；导出不改这篇文件')}</span>
          <button type="button" className="btn btn-sm" onClick={props.onClose}>
            {t('取消')}
          </button>
          <button type="button" ref={go} className="btn btn-primary btn-sm" disabled={busy} data-testid="map-export-go" onClick={() => void run()}>
            {t('导出到…')}
          </button>
        </div>
      </div>
    </div>,
    props.overlay,
  )
}

function OpmlPreview(props: { roots: MapNode[] }) {
  const rows: React.ReactNode[] = []
  const walk = (list: MapNode[], d: number) =>
    list.forEach((n, i) => {
      rows.push(
        <div key={`${d}.${rows.length}.${i}`} style={{ paddingLeft: d * 16 }}>
          {d ? '· ' : ''}
          {mapShown(n.text)}
          {n.note && <span className="nt"> — {n.note.split('\n')[0]!.slice(0, 18)}…</span>}
        </div>,
      )
      walk(n.children, d + 1)
    })
  walk(props.roots, 0)
  return <div className="opml">{rows}</div>
}
