/**
 * 设置 › 读PDF（方向 A）：打开时（新打开的 PDF 缩放、打开 PDF 时开着 AI）、笔记（后台写每一轮的标题和小结、送进 Anki 在哪）。
 */
import type { PdfPrefs } from '../../shared/prefs'
import { Toggle, type SettingsProps } from '../Settings'
import { Group, Lnk, Row, Sel, useSaid } from './ui'

export const PDF_ZOOMS: [PdfPrefs['zoom'], string][] = [
  ['width', '适合宽度'],
  ['page', '适合整页'],
  ['actual', '100%'],
]
export const pdfZoomName = (z: PdfPrefs['zoom']) => PDF_ZOOMS.find((x) => x[0] === z)![1]

export function PdfPage(props: SettingsProps) {
  const said = useSaid()
  const p = props.settings.pdf
  const set = <K extends keyof PdfPrefs>(k: K, v: PdfPrefs[K], hint: string) => {
    const old = p[k]
    if (old === v) return
    void props.onChange({ pdf: { [k]: v } })
    said.saved(hint, () => void props.onChange({ pdf: { [k]: old } }))
  }
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
        <Row id="anki" desc="在读过的PDF那个文件夹的「我的疑惑」里，右上「送进Anki」">
          <Lnk onClick={() => props.onGoPlace('pdf-note')}>去我的疑惑</Lnk>
        </Row>
      </Group>
    </>
  )
}
