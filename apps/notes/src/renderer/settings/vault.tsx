/**
 * 设置 › 库（方向 A）：现在的库（名字、路径，「打开别的文件夹…」）、导入旧笔记。多久没改算归档挪到了「文件和附件」。
 */
import { openImport } from '../importer/store'
import type { SettingsProps } from '../Settings'
import { Group, Row } from './ui'

export function VaultPage(props: SettingsProps) {
  const path = props.vault.path.replace(/^\/Users\/[^/]+/, '~')
  return (
    <>
      <Group title="现在的库">
        <Row
          id="vaultNow"
          label={props.vault.name}
          desc={
            <>
              <span className="sa-path" title={props.vault.path}>
                {path}
              </span>
              <span className="sa-line">一个普通文件夹，里面是md文件；换库前这个库没提交的改动先提交</span>
            </>
          }
        >
          <button type="button" className="sa-btn" onClick={props.onSwitchVault}>
            打开别的文件夹…
          </button>
        </Row>
      </Group>
      <Group title="导入">
        <Row id="import">
          <button
            type="button"
            className="sa-btn"
            onClick={() => {
              props.onClose()
              openImport()
            }}
          >
            导入旧笔记…
          </button>
        </Row>
      </Group>
    </>
  )
}
