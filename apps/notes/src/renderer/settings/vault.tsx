/**
 * 设置 › 库（方向 A）：现在的库（名字、路径，「打开别的文件夹…」）、导入旧笔记、同步来源（设计页 61，点一家进它的子页）。
 * 多久没改算归档挪到了「文件和附件」。
 */
import { openImport } from '../importer/store'
import type { SettingsProps } from '../Settings'
import { useT } from '../i18n'
import { SourcePage, SourcesGroup } from './sources'
import { Group, Row } from './ui'

export function VaultPage(props: SettingsProps & { sub: string | null; onSub(s: string | null): void }) {
  const t = useT()
  if (props.sub) return <SourcePage {...props} id={props.sub} onBack={() => props.onSub(null)} />
  const path = props.vault.path.replace(/^\/Users\/[^/]+/, '~')
  return (
    <>
      <Group title={t('现在的库')}>
        <Row
          id="vaultNow"
          label={props.vault.name}
          desc={
            <>
              <span className="sa-path" title={props.vault.path}>
                {path}
              </span>
              <span className="sa-line">{t('一个普通文件夹，里面是md文件；换库前这个库没提交的改动先提交')}</span>
            </>
          }
        >
          <button type="button" className="sa-btn" onClick={props.onSwitchVault}>
            {t('打开别的文件夹…')}
          </button>
        </Row>
      </Group>
      <Group title={t('导入')}>
        <Row id="import">
          <button
            type="button"
            className="sa-btn"
            onClick={() => {
              props.onClose()
              openImport()
            }}
          >
            {t('导入旧笔记…')}
          </button>
        </Row>
      </Group>
      <SourcesGroup {...props} onSub={props.onSub} />
    </>
  )
}
