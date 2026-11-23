/**
 * 设置 › 软件家族（2026-11-23 用户选方向 A「一张表看全」，task-59o3v）：样子是共用的 @cn/design/settings FamilyPage（画布今日一样），
 * 名单和怎么排是 @cn/family（familyView），这里接上画布笔记自己的说法、图标和去处：
 * 「在插件里设 ›」翻到插件页的书签管家闪一下；窗口重新拿到焦点时再问一次装了哪些（刚装好的软件自己出来）。
 */
import { familyView } from '@cn/family'
import { FamilyPage } from '@cn/design/settings'
import { useEffect, useMemo } from 'react'
import { NOTES_KNOWS } from '../../shared/family'
import { t as tNow } from '../../shared/i18n'
import { when } from '../../shared/when'
import { loadFamily, recheckFamily, setFamilyLink, useFamily } from '../family-store'
import { useLang, useT } from '../i18n'
import { FAMILY_ICONS } from '@cn/family/icons'
import type { SettingsProps } from '../Settings'

export function FamilySettingsPage(props: SettingsProps) {
  const t = useT()
  const lang = useLang()
  const s = useFamily()
  // 开着这一页时窗口拿到焦点（从浏览器下载、装好回来）：再问一次装了哪些
  useEffect(() => {
    void recheckFamily()
    const f = () => void recheckFamily()
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [])
  const view = useMemo(() => (s ? familyView({ host: 'canvas-notes', hostVersion: s.version, list: s.list, installed: s.installed, links: s.links, knows: NOTES_KNOWS, lang, vault: s.vault }) : null), [s, lang])
  const text = useMemo(
    () => ({
      linked: t('能和画布笔记接上的'),
      linkedNote: t('开关存在库里，两边看到的是同一个'),
      more: t('家族里还有'),
      moreNote: t('暂时不和画布笔记联动'),
      installed: (v: string | null) => (v ? tNow('已装 {version}', { version: v }) : tNow('已装')),
      open: t('打开', { ctx: '软件' }),
      download: t('下载', { ctx: '按钮' }),
      waiting: t('等你装好'),
      recheck: t('装好了，再看一下'),
      after: t('装了以后能开'),
      update: (name: string) => tNow('先更新{name}', { name }),
      novault: t('先打开一个库'),
      source: !s?.fetchOn
        ? t('名单只用软件里带的那份（隐私和联网里关了每天看一次）。家族软件都开源，不用注册账号。')
        : s.checkedAt
          ? t('名单每天从apps.us-cloud.uk看一次有没有新软件（上次 {when}），没网时用软件里带的那份。家族软件都开源，不用注册账号。', { when: when(s.checkedAt, { time: true }) })
          : t('名单每天从apps.us-cloud.uk看一次有没有新软件，没网时用软件里带的那份。家族软件都开源，不用注册账号。'),
      hub: t('去总站看看'),
      opened: (name: string) => tNow('打开了{name}', { name }),
      openFailed: (name: string) => tNow('没打开{name}：它不在原来的地方了，要用再下载一次', { name }),
      downloadOpened: (name: string, url: string) => tNow('在浏览器里打开了{name}的下载页：{url}', { name, url }),
      found: (name: string, version: string | null, linked: boolean) =>
        linked ? tNow('认出来了：{name} {version}已装，联动的开关能开了', { name, version: version ?? '' }) : tNow('认出来了：{name} {version}已装', { name, version: version ?? '' }),
      notYet: (name: string) => tNow('还没认出{name}：装进「应用程序」以后再点一下', { name }),
    }),
    [t, s?.fetchOn, s?.checkedAt],
  )
  if (!view) return null
  return (
    <FamilyPage
      view={view}
      icons={FAMILY_ICONS}
      text={text}
      onToggle={(id, on) => setFamilyLink(id, on).catch((e: unknown) => props.onNotice(String((e as Error).message ?? e)))}
      onOpen={async (id) => {
        const ok = await window.cnFamily.open(id)
        if (!ok) await loadFamily()
        return ok
      }}
      onDownload={(id) => void window.cnFamily.download(id).catch((e: unknown) => props.onNotice(String((e as Error).message ?? e)))}
      onRecheck={async (id) => (await recheckFamily()).installed[id] ?? null}
      onGo={(go) => props.onGoRow(go)}
      onHub={() => void window.cnFamily.hub().catch((e: unknown) => props.onNotice(String((e as Error).message ?? e)))}
    />
  )
}
