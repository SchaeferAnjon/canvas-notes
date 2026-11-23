/**
 * 设置 › 隐私和联网（方向 A 新的一页）：软件什么时候联网、联到哪，散在更新、插件、Git 几处的开关列在一起（关这里等于关那里），
 * 写明不收集使用数据。
 */
import { normalizeWeread } from '../../shared/plugins/weread'
import { errText, pluginInfo, setPluginEnabled, setPluginSettings, usePlugins } from '../plugins/host'
import { Toggle, type SettingsProps } from '../Settings'
import { useT } from '../i18n'
import { Group, Lnk, Row, useSaid } from './ui'

export function PrivacyPage(props: SettingsProps) {
  const t = useT()
  const said = useSaid()
  usePlugins()
  const ad = pluginInfo('adblock')
  const weread = pluginInfo('weread')
  const wereadSync = weread ? normalizeWeread(weread.settings).sync : false
  const fail = (e: unknown) => said.say(errText(e))
  return (
    <>
      <Group title={t('会联网的')}>
        <Row id="netList">
          <Toggle
            on={props.settings.autoUpdate}
            label={t('检查更新')}
            onChange={(v) => {
              void props.onChange({ autoUpdate: v })
              said.saved(v ? t('自动检查更新开了（一般页里是同一个开关）') : t('不再自己查更新（一般页里是同一个开关）'), () => void props.onChange({ autoUpdate: !v }))
            }}
          />
        </Row>
        <Row id="netFamily">
          <Toggle
            on={props.settings.familyFetch}
            label={t('每天看一次家族名单')}
            onChange={(v) => {
              void props.onChange({ familyFetch: v })
              said.saved(v ? t('每天看一次家族里有没有新软件') : t('不再去总站看家族名单，只用软件里带的那份'), () => void props.onChange({ familyFetch: !v }))
            }}
          />
        </Row>
        {ad && (
          <Row id="netAd">
            <Toggle
              on={ad.enabled}
              label={t('拦广告的规则')}
              onChange={(v) => {
                void setPluginEnabled('adblock', v).catch(fail)
                said.saved(v ? t('拦广告开了：去网站时取规则') : t('拦广告关了：不再取规则，网页不拦广告'), () => void setPluginEnabled('adblock', !v).catch(fail))
              }}
            />
          </Row>
        )}
        {weread && (
          <Row id="netWeread" dim={!weread.enabled} desc={weread.enabled ? undefined : t('微信读书插件关着；在插件页里打开')}>
            <Toggle
              on={weread.enabled && wereadSync}
              label={t('微信读书同步划线')}
              onChange={(v) => {
                if (!weread.enabled) return
                void setPluginSettings('weread', { sync: v }).catch(fail)
                said.saved(v ? t('看微信读书时把划线和想法同步进「阅读」') : t('不再把划线和想法同步进「阅读」'), () => void setPluginSettings('weread', { sync: !v }).catch(fail))
              }}
            />
          </Row>
        )}
        <Row id="netGit">
          <Lnk onClick={() => props.onGoRow('autoSync')}>{t('去Git和同步')}</Lnk>
        </Row>
        <Row id="netAi" info />
        <Row id="netWeb" info />
      </Group>
      <Group title={t('不会做的')}>
        <Row id="netNone" info />
      </Group>
      <p className="sa-note">{t('这里只是把各处的开关列在一起，关这里等于关那里。')}</p>
    </>
  )
}
