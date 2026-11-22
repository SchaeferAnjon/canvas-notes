/**
 * 设置 › 高级（方向 A）：这台 Mac 上的东西——软件设置目录（设置、对话截图、意思索引），「在访达里看」。
 * 原型里的日志、清缓存、重建索引、回到默认这次没做（软件不写日志；后三样不在第一批）。
 */
import { useEffect, useState } from 'react'
import type { SettingsProps } from '../Settings'
import { useT } from '../i18n'
import { Group, Row, useSaid } from './ui'

export function AdvancedPage(_props: SettingsProps) {
  const t = useT()
  const said = useSaid()
  const [dir, setDir] = useState('')
  useEffect(() => void window.cn.dataDir().then(setDir), [])
  return (
    <Group title={t('这台Mac上的东西')}>
      <Row
        id="cfgDir"
        desc={
          <>
            <span className="sa-path" title={dir}>
              {dir.replace(/^\/Users\/[^/]+/, '~')}
            </span>
            <span className="sa-line">{t('设置、对话截图、意思索引')}</span>
          </>
        }
      >
        <button
          type="button"
          className="sa-btn"
          onClick={() => {
            void window.cn.revealDataDir()
            said.say(t('在访达里打开了软件设置目录'))
          }}
        >
          {t('在访达里看')}
        </button>
      </Row>
    </Group>
  )
}
