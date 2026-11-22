/**
 * 设置 › 文档和白板（方向 A）：文字（正文字体、字号、行距、版心宽）、写的时候（新建笔记先用、拼写检查）、
 * 白板（右栏开着时缩小、点阵背景）、搜索（按意思找）。改字体、字号、行距、版心，中间开着的文档当场跟着变。
 */
import { DOC_FONTS, DOC_WIDTHS, type DocFont, type DocWidth, type EditorPrefs, FONT_SIZES, type LineHeight, LINE_HEIGHTS } from '../../shared/prefs'
import { withKeys } from '../keys'
import { fontInstalled } from '../editor-prefs'
import { Toggle, type SettingsProps } from '../Settings'
import { useT } from '../i18n'
import { Group, hintFor, Row, Seg, Sel, useSaid } from './ui'

const fontName = (id: DocFont) => DOC_FONTS.find((f) => f.id === id)!.name

export function EditorPage(props: SettingsProps) {
  const t = useT()
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
      <Group title={t('文字')}>
        <Row id="font">
          <Sel
            label={t('正文字体')}
            value={e.font}
            options={DOC_FONTS.map((f) => {
              const ok = fontInstalled(f.id)
              return [f.id, ok ? t(f.name) : t('{name}（没装）', { name: t(f.name) }), !ok] as const
            })}
            onChange={(v) => set('font', v, t('正文换成{name}', { name: t(fontName(v)) }))}
          />
        </Row>
        <Row id="size">
          <Sel label={t('字号')} value={e.size} options={FONT_SIZES.map((n) => [n, String(n)] as const)} onChange={(v) => set('size', v, t('打开着的文档马上换成 {px}px', { px: v }))} />
        </Row>
        <Row id="lineh">
          <Sel
            label={t('行距')}
            value={e.lineHeight}
            options={(Object.keys(LINE_HEIGHTS) as LineHeight[]).map((k) => [k, t(LINE_HEIGHTS[k].name)] as const)}
            onChange={(v) => set('lineHeight', v, t('打开着的文档行距换成「{name}」', { name: t(LINE_HEIGHTS[v].name) }))}
          />
        </Row>
        <Row id="width">
          <Sel
            label={t('版心宽')}
            value={e.width}
            options={(Object.keys(DOC_WIDTHS) as DocWidth[]).map((k) => [k, t(DOC_WIDTHS[k].name)] as const)}
            onChange={(v) => set('width', v, t('版心换成「{name}」；单独开了宽版的照旧', { name: t(DOC_WIDTHS[v].name) }))}
          />
        </Row>
      </Group>
      <Group title={t('写的时候')}>
        <Row id="newView">
          <Seg
            label={t('新建笔记先用')}
            value={e.newView}
            options={[
              ['doc', t('文档')],
              ['board', t('白板')],
            ]}
            onChange={(v) => set('newView', v, withKeys(v === 'board' ? t('{k:new-note} 以后先建一块白板') : t('{k:new-note} 以后先建一篇文档')))}
          />
        </Row>
        <Row id="spell">{tog('spell', t('拼写检查'), (v) => (v ? t('文档里英文拼错的词下面画红线') : t('文档里不再查拼写')))}</Row>
      </Group>
      <Group title={t('白板')}>
        <Row id="boardShrink">{tog('boardShrink', t('右栏开着时白板缩小'), (v) => (v ? t('右栏开着时白板缩到0.8') : t('右栏开着时白板照原样大')))}</Row>
        <Row id="boardDots">{tog('boardDots', t('点阵背景'))}</Row>
      </Group>
      <Group title={t('搜索')}>
        <Row id="semantic">{tog('semantic', t('按意思找'), (v) => withKeys(v ? t('本机小模型在后台建索引，{k:search} 里多一组「意思相近」') : t('{k:search} 里不再按意思找，本机小模型不在后台建索引')))}</Row>
      </Group>
    </>
  )
}
