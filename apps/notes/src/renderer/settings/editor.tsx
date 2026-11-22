/**
 * 设置 › 文档和白板（方向 A）：文字（正文字体、字号、行距、版心宽）、写的时候（新建笔记先用、拼写检查）、
 * 白板（右栏开着时缩小、点阵背景）、搜索（按意思找）。改字体、字号、行距、版心，中间开着的文档当场跟着变。
 */
import { DOC_FONTS, DOC_WIDTHS, type DocFont, type DocWidth, type EditorPrefs, FONT_SIZES, type LineHeight, LINE_HEIGHTS } from '../../shared/prefs'
import { withKeys } from '../keys'
import { fontInstalled } from '../editor-prefs'
import { Toggle, type SettingsProps } from '../Settings'
import { Group, hintFor, Row, Seg, Sel, useSaid } from './ui'

const fontName = (id: DocFont) => DOC_FONTS.find((f) => f.id === id)!.name

export function EditorPage(props: SettingsProps) {
  const said = useSaid()
  const e = props.settings.editor
  /** 改一项：存、底下说这次会怎样、能撤回 */
  function set<K extends keyof EditorPrefs>(k: K, v: EditorPrefs[K], hint: string) {
    const old = e[k]
    if (old === v) return
    void props.onChange({ editor: { [k]: v } })
    said.saved(hint, () => void props.onChange({ editor: { [k]: old } }))
  }
  const tog = (k: 'spell' | 'boardShrink' | 'boardDots' | 'semantic', label: string, hint?: (v: boolean) => string) => (
    <Toggle on={e[k]} label={label} onChange={(v) => set(k, v, hint?.(v) ?? hintFor(label, v))} />
  )
  return (
    <>
      <Group title="文字">
        <Row id="font">
          <Sel
            label="正文字体"
            value={e.font}
            options={DOC_FONTS.map((f) => {
              const ok = fontInstalled(f.id)
              return [f.id, ok ? f.name : `${f.name}（没装）`, !ok] as const
            })}
            onChange={(v) => set('font', v, `正文换成${fontName(v)}`)}
          />
        </Row>
        <Row id="size">
          <Sel label="字号" value={e.size} options={FONT_SIZES.map((n) => [n, String(n)] as const)} onChange={(v) => set('size', v, `打开着的文档马上换成 ${v}px`)} />
        </Row>
        <Row id="lineh">
          <Sel
            label="行距"
            value={e.lineHeight}
            options={(Object.keys(LINE_HEIGHTS) as LineHeight[]).map((k) => [k, LINE_HEIGHTS[k].name] as const)}
            onChange={(v) => set('lineHeight', v, `打开着的文档行距换成「${LINE_HEIGHTS[v].name}」`)}
          />
        </Row>
        <Row id="width">
          <Sel
            label="版心宽"
            value={e.width}
            options={(Object.keys(DOC_WIDTHS) as DocWidth[]).map((k) => [k, DOC_WIDTHS[k].name] as const)}
            onChange={(v) => set('width', v, `版心换成「${DOC_WIDTHS[v].name}」；单独开了宽版的照旧`)}
          />
        </Row>
      </Group>
      <Group title="写的时候">
        <Row id="newView">
          <Seg
            label="新建笔记先用"
            value={e.newView}
            options={[
              ['doc', '文档'],
              ['board', '白板'],
            ]}
            onChange={(v) => set('newView', v, withKeys(v === 'board' ? '{k:new-note} 以后先建一块白板' : '{k:new-note} 以后先建一篇文档'))}
          />
        </Row>
        <Row id="spell">{tog('spell', '拼写检查', (v) => (v ? '文档里英文拼错的词下面画红线' : '文档里不再查拼写'))}</Row>
      </Group>
      <Group title="白板">
        <Row id="boardShrink">{tog('boardShrink', '右栏开着时白板缩小', (v) => (v ? '右栏开着时白板缩到0.8' : '右栏开着时白板照原样大'))}</Row>
        <Row id="boardDots">{tog('boardDots', '点阵背景')}</Row>
      </Group>
      <Group title="搜索">
        <Row id="semantic">{tog('semantic', '按意思找', (v) => withKeys(v ? '本机小模型在后台建索引，{k:search} 里多一组「意思相近」' : '{k:search} 里不再按意思找，本机小模型不在后台建索引'))}</Row>
      </Group>
    </>
  )
}
