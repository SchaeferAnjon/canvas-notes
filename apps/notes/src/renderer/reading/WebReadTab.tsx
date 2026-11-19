/**
 * 中间栏「<标题> · 阅读视图」：右栏网页用 Readability 抽出正文，对照读（spec 2.4）。
 * 工具栏右端「对照 / 只看译文」（⌥A 轮流）；双语工具条「英文 → 中文 · 域名」+「存成双语笔记」（进收件箱，带原网址）；
 * 头上「回到网页」胶囊在右栏打开原网页。
 */
import { Codicon } from '@cn/design'
import { PageNote, TabActs } from '../shell/TabActs'
import { useEffect, useMemo, useState } from 'react'
import type { BilingualSaveRequest } from '../../shared/reading'
import type { ReaderPage } from '../../shared/web-reader'
import { BiBar } from './bilingual/BiParts'
import { type FlowGroup, ReflowView, toTranslate } from './bilingual/ReflowView'
import { hashOf, langsLine, request, trOf, useBi } from './bilingual/store'
import { readerPage } from './web-bridge'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function WebReadTab(props: { url: string; title: string; active: boolean; onBackToWeb(url: string): void; onOpenNote(path: string): void; onNotice(t: string): void }) {
  const page: ReaderPage | null = readerPage(props.url)
  const key = `web:${props.url}`
  const [mode, setMode] = useState<'bi' | 'tr'>('bi')
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const bi = useBi(key)

  const groups: FlowGroup[] = useMemo(
    () =>
      page
        ? [
            {
              key: 'web',
              head: (
                <button type="button" className="pgc" onClick={() => props.onBackToWeb(page.url)}>
                  <Codicon name="globe" size={12} />
                  回到网页
                </button>
              ),
              blocks: page.blocks.map((b, i) => ({
                id: `w${i}`,
                kind: b.kind === 'heading' ? ('heading' as const) : b.kind === 'figure' ? ('image' as const) : ('text' as const),
                text: b.text,
                // 公式、代码、表格、图：不送去翻
                ...(b.kind === 'formula' || b.kind === 'figure' ? { fixed: b.kind } : {}),
                ...(b.src ? { crop: () => Promise.resolve(b.src!) } : {}),
              })),
            },
          ]
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page],
  )

  // ⌥A：对照 ↔ 只看译文
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code !== 'KeyA') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setMode((m) => (m === 'bi' ? 'tr' : 'bi'))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props.active])

  const want = page ? toTranslate(groups[0]!.blocks) : []
  const done = want.filter((b) => bi.tr[hashOf(b.text)]?.state === 'ok').length
  const busy = want.some((b) => bi.tr[hashOf(b.text)]?.state === 'wait')

  async function save() {
    if (!page || saving) return
    try {
      setSaving('在翻…')
      await request(key, want, null)
      for (let i = 0; i < 3000 && want.some((b) => trOf(key)[hashOf(b.text)]?.state === 'wait'); i++) await new Promise((r) => setTimeout(r, 100))
      setSaving('在写…')
      const tr = trOf(key)
      const res = await window.cnReading.saveBilingual({
        web: { url: page.url, title: page.title },
        langs: langsLine(want.slice(0, 40).map((b) => b.text).join(' ')),
        pages: [
          {
            blocks: page.blocks.flatMap((b): BilingualSaveRequest['pages'][number]['blocks'] =>
              b.kind === 'figure' || b.kind === 'formula'
                ? b.src
                  ? [{ kind: b.kind, url: b.src }]
                  : []
                : [{ kind: b.kind, text: b.text, tr: tr[hashOf(b.text)]?.text ?? null }],
            ),
          },
        ],
      })
      setSaved(res.path)
      props.onNotice(`已存成${res.path} · 带原网址`)
    } catch (e) {
      props.onNotice(errText(e))
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="pane pdfpane webread" hidden={!props.active} data-url={props.url}>
      <TabActs active={props.active}>
        <PageNote>
          阅读视图 · {page?.site ?? props.url}
        </PageNote>
        <div className="seg biseg" role="radiogroup" aria-label="对照 只看译文" data-tip="⌥A 轮流切换" data-side="below">
          {(
            [
              ['bi', '对照'],
              ['tr', '只看译文'],
            ] as const
          ).map(([m, name]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {name}
            </button>
          ))}
        </div>
      </TabActs>
      {page ? (
        <>
          <BiBar
            langs={`${langsLine(want.slice(0, 40).map((b) => b.text).join(' '))} · ${page.site}`}
            status={`${busy ? '正在翻 · ' : ''}译文${done}/${want.length}段`}
            busy={busy}
            saved={saved}
            saving={saving}
            onSave={() => void save()}
            onOpenSaved={props.onOpenNote}
          />
          <div className="pdfbody">
            <ReflowView srcKey={key} groups={groups} mode={mode} course={null} />
          </div>
        </>
      ) : (
        <div className="pdferr">
          这一页的正文没记下来（软件重开过）。
          <button type="button" className="btn btn-sm" onClick={() => props.onBackToWeb(props.url)}>
            <Codicon name="globe" size={14} />
            回到网页
          </button>
          再从翻译菜单里点一次「在中间栏左右对照读」。
        </div>
      )}
    </section>
  )
}
