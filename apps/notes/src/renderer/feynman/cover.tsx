/**
 * 白板外面跟着盖的：右栏配对的网页、这一轮材料的那份 PDF（别的网页、别的 PDF 照常）；右栏 AI 顶上一句「费曼 · X 讲着」。
 * 按住「看一眼」露出、松手又盖上（已定 4）；暂停、讲完了露出来（已定 5）。右栏 AI 照常能用、问什么都不记（已定 3）。
 */
import { Codicon } from '@cn/design'
import { useEffect } from 'react'
import { inBook } from '../../shared/read-along'
import { useT } from '../i18n'
import { HoldPeek } from './Column'
import * as S from './store'

function Cover({ id, testid }: { id: string; testid: string }) {
  const t = useT()
  return (
    <div className="fy-webcover" data-testid={testid}>
      <div className="in">
        <b>{t('讲完再看')}</b>
        {t('现在看会变成照着念。讲完、问完，这一页自己露出来，和你讲的对一对。')}
        <div>
          <HoldPeek id={id} />
        </div>
        <div className="s2">{t('松手又盖上；看一次记一次')}</div>
      </div>
    </div>
  )
}

/** 右栏网页：这一页是正在讲的那一轮配对的网页时盖住 */
export function WebCover({ url }: { url: string | null }) {
  S.useFeynman()
  const c = S.talkingNow()
  const on = !!url && !!c && !c.peeking && c.web.some((w) => inBook(w, url) || S.sameUrl(w, url))
  // 网页（<webview>）是单独的一层：自己也糊一下，盖层的模糊透不过去时照样看不清
  useEffect(() => {
    const el = document.querySelector('.right.web webview.on')
    el?.classList.toggle('fy-blur', on)
    return () => el?.classList.remove('fy-blur')
  }, [on, url])
  return on ? <Cover id={c!.id} testid="fy-webcover" /> : null
}

/** 中间的 PDF：是这一轮材料的那一份时盖住 */
export function PdfCover({ path }: { path: string }) {
  S.useFeynman()
  const c = S.talkingNow()
  const on = !!c && !c.peeking && c.pdf.includes(path)
  return on ? <Cover id={c!.id} testid="fy-pdfcover" /> : null
}

/** 右栏 AI 顶上一句：白板上有一轮讲着（这一轮讲完就不出了） */
export function AiNote() {
  const t = useT()
  S.useFeynman()
  const c = S.openRound()
  if (!c) return null
  return (
    <div className="fy-ainote" data-testid="fy-ainote">
      <Codicon name="mortar-board" size={14} />
      <span>{t('白板上「费曼 · {topic}」讲着。这里照常能问，问什么都不记。', { topic: c.topic })}</span>
    </div>
  )
}
