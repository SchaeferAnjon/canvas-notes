/**
 * 设置 › 一般最上面一组「语言」（task-zojmg，英文版设计稿第 1 节）：一行「界面语言」，右边一个下拉（和别的行的下拉同宽、右边齐）。
 * 三项：跟随系统（括号里写现在系统是哪种）、简体中文、English；语言名用它自己的写法，不跟界面翻译。
 * 改了马上存、当场换（开着的标签、正在打的字不动）；底下提示条照老规矩带「撤回」，说一句系统自带的几处重开后换。
 */
import { LANG_NAMES, type LangSetting, t as tNow } from '../../shared/i18n'
import { langApi, useLangInfo, useT } from '../i18n'
import { Group, Row, Sel, useSaid } from './ui'

export function LangGroup() {
  const t = useT()
  const said = useSaid()
  const info = useLangInfo()
  const api = langApi()
  // 没放出来（main/lang.ts 的 LANG_SWITCH）：不出这一组
  if (!info || !api || !info.available) return null
  const options = [
    ['system', t('跟随系统（{name}）', { name: info.systemName })],
    ['zh', LANG_NAMES.zh],
    ['en', LANG_NAMES.en],
  ] as const
  const set = async (v: LangSetting) => {
    const old = info.setting
    const next = await api.set(v)
    // 换完再说：提示条已经是新的语言
    said.saved(tNow('界面换成{name}；系统自带的几处（编辑菜单、文件对话框）重开后换', { name: LANG_NAMES[next.lang] }), () => void api.set(old))
  }
  return (
    <Group title={t('语言')}>
      <Row id="lang">
        <Sel label={t('界面语言')} value={info.forced ? info.lang : info.setting} options={options} onChange={(v) => void set(v)} />
      </Row>
    </Group>
  )
}
