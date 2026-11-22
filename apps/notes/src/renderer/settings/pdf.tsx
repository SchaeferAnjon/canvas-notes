/**
 * 设置 › 读PDF（方向 A）：打开时（新打开的 PDF 缩放、打开 PDF 时开着 AI）、笔记（后台写每一轮的标题和小结）、
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
import { Group, Lnk, Row, Sel, useSaid } from './ui'

export const PDF_ZOOMS: [PdfPrefs['zoom'], string][] = [
  ['width', '适合宽度'],
  ['page', '适合整页'],
  ['actual', '100%'],
]
export const pdfZoomName = (z: PdfPrefs['zoom']) => PDF_ZOOMS.find((x) => x[0] === z)![1]

/** 「Anki」那一行右边：连上了写版本，没开给「打开Anki」，没装给「怎么装」 */
function AnkiState(p: { st: AnkiStatus | null; onOpen(): void; onHow(): void }) {
  const { st } = p
  if (!st) return null
  return (
    <span className="sa-anki" data-testid="anki-state">
      <i className={'dot' + (st.connected ? ' g' : ' y')} />
      {st.connected ? `连上了 · ${st.app?.version ? `Anki ${st.app.version} · ` : ''}AnkiConnect` : st.app ? '没开着 · ' : '没装 · '}
      {!st.connected && (st.app ? <Lnk onClick={p.onOpen}>打开Anki</Lnk> : <Lnk onClick={p.onHow}>怎么装</Lnk>)}
    </span>
  )
}

export function PdfPage(props: SettingsProps) {
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
      <Group title="打开时">
        <Row id="pdfZoom">
          <Sel label="新打开的PDF缩放" value={p.zoom} options={PDF_ZOOMS} onChange={(v) => set('zoom', v, `下次新打开的PDF用「${pdfZoomName(v)}」；看过的照旧`)} />
        </Row>
        <Row id="pdfAi">
          <Toggle on={p.openAi} label="打开PDF时开着AI" onChange={(v) => set('openAi', v, v ? '以后打开PDF时右栏的AI一起打开' : '打开PDF时不开AI；框一块、点「问AI」才开')} />
        </Row>
      </Group>
      <Group title="笔记">
        <Row id="pdfRecap" desc="用读PDF那一家AI（Claude Code 时用 Haiku）；关了不再问AI，标题和小结截问和答的开头">
          <Toggle on={p.recap} label="后台写每一轮的标题和小结" onChange={(v) => set('recap', v, v ? '读PDF的笔记里每一轮后台写标题和小结' : '不再后台问AI：标题和小结截问和答的开头')} />
        </Row>
      </Group>
      <Group title="送进Anki">
        <Row id="anki">
          <AnkiState st={st} onOpen={openAnki} onHow={() => setHow(true)} />
        </Row>
        <Row
          id="ankiDeck"
          desc={
            <>
              按文件夹分牌组；直接放在课里的用PDF的名字，别处的进「知识」
              <br />
              例：<span className="sa-nw">课程/ecp/Week 2/补充材料</span> → <span className="sa-nw">课程::ecp::Week 2::补充材料</span>
            </>
          }
        >
          <span className="sa-val">跟着文件夹</span>
        </Row>
        <Row id="ankiSides">
          <Toggle on={p.ankiSides} label="旁支里问的也送" onChange={(v) => set('ankiSides', v, v ? '旁支里问的也出卡；卡背面「原文」是被问的那一句' : '出卡不算旁支里问的')} />
        </Row>
        <Row id="ankiEngine">
          <AiFeaturePick feature="cards" name="改写成卡" onNotice={props.onNotice} />
        </Row>
        <Row id="ankiOff" more={how && st ? <HowTo st={st} onOpen={openAnki} /> : undefined}>
          <button className="btn btn-sm" onClick={() => setHow((h) => !h)}>
            怎么装
          </button>
        </Row>
        <Row id="ankiAll" desc={all ? `${all.items.length}问 · ${all.items.filter((x) => x.sent).length}问已在Anki` : ' '}>
          <button
            className="btn btn-sm"
            disabled={!unsent}
            onClick={() => {
              app().closeSettingsDialog()
              openCards({ kind: 'vault' })
            }}
          >
            <AiIcon job="cards" size={14} />
            {`出卡 · ${unsent}问`}
          </button>
        </Row>
      </Group>
    </>
  )
}
