/**
 * 设置 › 读PDF（方向 A）：打开时（新打开的 PDF 缩放、打开 PDF 时开着 AI）、
 * 送进Anki（task-tz7y3，原型 proto.html#dir=b 的设置那一组）：连没连上、送进哪个牌组、旁支里问的也送、改写成卡用哪家 AI、Anki 没开没装时怎么办、整个库没送的出卡。
 */
import type { AnkiStatus } from '../../shared/reading'
import type { PdfPrefs } from '../../shared/prefs'
import { app } from '../ctx/actions'
import { AiIcon } from '../engine-logo'
import { useEffect, useState } from 'react'
import { HowTo } from '../reading/CardsDialog'
import { openCards, unsentOf, useCardsView } from '../reading/cards-store'
import { AiFeaturePick } from '../settings-ai'
import { Toggle, type SettingsProps } from '../Settings'
import { t as tNow } from '../../shared/i18n'
import { catName } from '../../shared/categories'
import { useT } from '../i18n'
import { Group, Lnk, Row, Sel, useSaid } from './ui'
import { HlKinds } from './hl-kinds'

/** 新打开的 PDF 缩放的几档：中文原句（PdfTab 还拼在中文句子里），设置页画的时候 t() */
// 不翻：键，画的地方翻
const PDF_ZOOMS: [PdfPrefs['zoom'], string][] = [
  ['width', '适合宽度'], // 不翻
  ['page', '适合整页'], // 不翻
  ['actual', '100%'],
]
export const pdfZoomName = (z: PdfPrefs['zoom']) => PDF_ZOOMS.find((x) => x[0] === z)![1]
const pdfZooms = (): [PdfPrefs['zoom'], string][] => PDF_ZOOMS.map(([v, n]) => [v, tNow(n)])

/** 「Anki」那一行右边：连上了写版本，没开给「打开Anki」，没装给「怎么装」 */
function AnkiState(p: { st: AnkiStatus | null; onOpen(): void; onHow(): void }) {
  const t = useT()
  const { st } = p
  if (!st) return null
  return (
    <span className="sa-anki" data-testid="anki-state">
      <i className={'dot' + (st.connected ? ' g' : ' y')} />
      {st.connected ? (st.app?.version ? t('连上了 · Anki {v} · AnkiConnect', { v: st.app.version }) : t('连上了 · AnkiConnect')) : st.app ? t('没开着') : t('没装')}
      {!st.connected && ' · '}
      {!st.connected && (st.app ? <Lnk onClick={p.onOpen}>{t('打开Anki')}</Lnk> : <Lnk onClick={p.onHow}>{t('怎么装')}</Lnk>)}
    </span>
  )
}

export function PdfPage(props: SettingsProps) {
  const t = useT()
  const said = useSaid()
  const p = props.settings.pdf
  const set = <K extends keyof PdfPrefs>(k: K, v: PdfPrefs[K], hint: string) => {
    const old = p[k]
    if (old === v) return
    void props.onChange({ pdf: { [k]: v } })
    said.saved(hint, () => void props.onChange({ pdf: { [k]: old } }))
  }
  const [st, setSt] = useState<AnkiStatus | null>(null)
  const [how, setHow] = useState(false)
  const load = () => void window.cnReading.ankiStatus().then(setSt, (e) => props.onNotice(String((e as Error).message ?? e)))
  useEffect(() => {
    load()
    // 开着「怎么装」、刚点了「打开Anki」：每 2 秒再看一次
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const all = useCardsView({ kind: 'vault' })
  const unsent = unsentOf(all, p.ankiSides).length
  const openAnki = () => void window.cnReading.openAnki().then((ok) => (ok ? load() : setHow(true)), (e) => props.onNotice(String((e as Error).message ?? e)))
  return (
    <>
      <Group title={t('打开时')}>
        <Row id="pdfZoom">
          <Sel label={t('新打开的PDF缩放')} value={p.zoom} options={pdfZooms()} onChange={(v) => set('zoom', v, t('下次新打开的PDF用「{name}」；看过的照旧', { name: t(pdfZoomName(v)) }))} />
        </Row>
        <Row id="pdfAi">
          <Toggle on={p.openAi} label={t('打开PDF时开着AI')} onChange={(v) => set('openAi', v, v ? t('以后打开PDF时右栏的AI一起打开') : t('打开PDF时不开AI；框一块、点「问AI」才开'))} />
        </Row>
      </Group>
      <Group title={t('划线颜色')}>
        <Row id="hlKinds" full>
          <HlKinds onNotice={props.onNotice} />
        </Row>
      </Group>
      <Group title={t('送进Anki')}>
        <Row id="anki">
          <AnkiState st={st} onOpen={openAnki} onHow={() => setHow(true)} />
        </Row>
        <Row
          id="ankiDeck"
          desc={
            <>
              {t('按文件夹分牌组；直接放在课里的用PDF的名字，库最外层的进「知识」')}
              <br />
              {t('例：')}
              {/* 不翻：例子是库里的文件夹名和 Anki 牌组名，照这个库磁盘上的（「补充材料」是例子里的一个子文件夹） */}
              <span className="sa-nw">{`${catName('课程')}/ecp/Week 2/补充材料`}</span> → <span className="sa-nw">{`${catName('课程')}::ecp::Week 2::补充材料`}</span>
            </>
          }
        >
          <span className="sa-val">{t('跟着文件夹')}</span>
        </Row>
        <Row id="ankiSides">
          <Toggle on={p.ankiSides} label={t('旁支里问的也送')} onChange={(v) => set('ankiSides', v, v ? t('旁支里问的也出卡；卡背面「原文」是被问的那一句') : t('出卡不算旁支里问的'))} />
        </Row>
        <Row id="ankiEngine">
          <AiFeaturePick feature="cards" name={t('改写成卡')} onNotice={props.onNotice} />
        </Row>
        <Row id="ankiOff" more={how && st ? <HowTo st={st} onOpen={openAnki} /> : undefined}>
          <button className="btn btn-sm" onClick={() => setHow((h) => !h)}>
            {t('怎么装')}
          </button>
        </Row>
        <Row id="ankiAll" desc={all ? t('{n}问 · {sent}问已在Anki', { n: all.items.length, sent: all.items.filter((x) => x.sent).length }) : ' '}>
          <button
            className="btn btn-sm"
            disabled={!unsent}
            onClick={() => {
              app().closeSettingsDialog()
              openCards({ kind: 'vault' })
            }}
          >
            <AiIcon job="cards" size={14} />
            {t('出卡 · {n}问', { n: unsent })}
          </button>
        </Row>
      </Group>
    </>
  )
}
