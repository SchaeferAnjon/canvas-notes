/**
 * 送进 Anki（spec 1.13）：居中对话框，正面（截图 + 问题）和背面（讲通的讲法 + 页码）两张预览并排，能一张张翻；
 * 「送 N 张」走 AnkiConnect，送过的不重复送。卡用和 Anki Learn 同一种「学习卡 · 问答」，牌组「知识」。
 */
import { Codicon } from '@cn/design'
import { cropCaption, questionOf } from '@cn/format'
import { useEffect, useState } from 'react'
import type { DoubtsView } from '../../shared/reading'

type Item = DoubtsView['items'][number]
const vaultImg = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '')

export function AnkiDialog(props: { view: DoubtsView; items: Item[]; onClose(): void; onSent(text: string): void }) {
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const it = props.items[i]
  const n = props.items.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
      else if (e.key === 'ArrowRight') setI((x) => Math.min(n - 1, x + 1))
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n])

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const r = await window.cnReading.ankiSend(
        props.view.folder,
        props.items.map((x) => x.id),
      )
      if (r.error) return setError(r.error)
      const failed = Object.keys(r.failed).length
      if (failed && !r.added.length && !r.duplicates.length) return setError(`一张也没送进去：${Object.values(r.failed)[0]}`)
      props.onSent(
        `已送进Anki · ${r.added.length}张卡片（牌组「${r.deck}」）` +
          (r.duplicates.length ? `，${r.duplicates.length}张Anki里已经有了` : '') +
          (failed ? `，${failed}张没送进去` : ''),
      )
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pal-back" onMouseDown={props.onClose}>
      <div className="ankidlg" role="dialog" aria-label="送进 Anki" onMouseDown={(e) => e.stopPropagation()}>
        <div className="adh">
          <b>送进Anki</b>
          <span className="sp" />
          <button className="iconbtn" aria-label="关闭" onClick={props.onClose}>
            <Codicon name="close" size={14} />
          </button>
        </div>
        <p className="adsub">
          {`牌组「知识」，标签「${props.view.course || '我的疑惑'}」· 这次送${n}张，送过的不重复送。每张卡背面带页码，点了回到PDF。卡的样子和Anki Learn做的一样。`}
        </p>
        {it && (
          <div className="adcards">
            <div className="adcard">
              <span className="adk">正面</span>
              <div className="adq">{questionOf(it.section)}</div>
              {it.section.crop && <img src={vaultImg(it.section.crop)} alt={cropCaption(it.section)} />}
            </div>
            <div className="adcard">
              <span className="adk">背面</span>
              <div className="ada">{it.section.good}</div>
              {it.section.points.length > 0 && (
                <ul>
                  {it.section.points.map((p, k) => (
                    <li key={k}>{p}</li>
                  ))}
                </ul>
              )}
              <div className="adsrc">
                {`第${it.section.page}页 · ${stem(it.pdf)}.pdf`}
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="aderr" role="alert">
            {error}
          </div>
        )}
        <div className="adf">
          <button className="iconbtn" aria-label="上一张" disabled={i === 0} onClick={() => setI(i - 1)}>
            <Codicon name="chevron-left" size={14} />
          </button>
          <span className="num">
            {`第${i + 1}张，共${n}张`}
          </span>
          <button className="iconbtn" aria-label="下一张" disabled={i >= n - 1} onClick={() => setI(i + 1)}>
            <Codicon name="chevron-right" size={14} />
          </button>
          <span className="sp" />
          <button className="btn btn-sm" onClick={props.onClose}>
            取消
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy || !n} onClick={() => void send()}>
            {busy ? '正在送…' : `送${n}张`}
          </button>
        </div>
      </div>
    </div>
  )
}
