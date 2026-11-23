/**
 * 设置 › 文件和附件（方向 A）：新建（新笔记放哪）、左栏（「用预设的分类」开关、收件箱一直在、放在左边的文件夹几个，task-wniqx；
 * 存在库里的 .canvas-notes/左栏.json，跟着 Git 走）、附件（只看：附件/<笔记路径>/，「在访达里看」）、
 * 删除（删笔记前问一声、连同它的图一起删）、归档（多久没改算归档，以前在「库」页）。
 */
import { useState } from 'react'
import { withKeys } from '../keys'
import { TRASH_IMAGES_KEY } from '../../shared/attach'
import type { FilesPrefs } from '../../shared/prefs'
import { ARCHIVE_CHOICES, type ArchiveDays } from '../../shared/sidebar'
import { Toggle, type SettingsProps } from '../Settings'
import { loadTrashImages } from '../TrashDialog'
import { updateLeft, useLeft } from '../files/left-store'
import { ownLeft, presetsOn, setPresets } from '../../shared/left'
import { useT } from '../i18n'
import { Group, Row, Sel, useSaid } from './ui'

// 不翻：键，画的地方翻
const WHERE: [FilesPrefs['newWhere'], string][] = [
  ['picked', '收件箱（点过的文件夹优先）'], // 不翻
  ['inbox', '总是收件箱'], // 不翻
  ['beside', '正在看的那篇旁边'], // 不翻
]
// 不翻：键，画的地方翻
const ASK: [FilesPrefs['delAsk'], string][] = [
  ['images', '带图的才问'], // 不翻
  ['always', '每次都问'], // 不翻
  ['never', '不问'], // 不翻
]

/** 删笔记的弹框里「连同 N 张图一起移到废纸篓」默认勾不勾（和弹框里那个勾是同一个，记在这台 Mac 上） */
function setTrashImages(on: boolean) {
  try {
    localStorage.setItem(TRASH_IMAGES_KEY, on ? '1' : '0')
  } catch {
    // 记不住只影响下次弹框的默认
  }
}

export function FilesPage(props: SettingsProps) {
  const t = useT()
  const said = useSaid()
  const f = props.settings.files
  const [imgs, setImgs] = useState(loadTrashImages)
  const left = useLeft()
  const presets = presetsOn(left)
  const setF = <K extends keyof FilesPrefs>(k: K, v: FilesPrefs[K], hint: string) => {
    const old = f[k]
    if (old === v) return
    void props.onChange({ files: { [k]: v } })
    said.saved(hint, () => void props.onChange({ files: { [k]: old } }))
  }
  return (
    <>
      <Group title={t('新建')}>
        <Row id="newWhere">
          <Sel label={t('新笔记放哪')} value={f.newWhere} options={WHERE.map(([w, n]) => [w, t(n)] as const)} onChange={(v) => setF('newWhere', v, withKeys(t('{k:new-note} 以后放进「{name}」', { name: t(WHERE.find((w) => w[0] === v)![1]) })))} />
        </Row>
      </Group>
      <Group title={t('左栏')}>
        <Row
          id="leftPresets"
          desc={
            <>
              <span className="sa-blk">{t('课程、阅读、剪藏、周记、写作、项目、生活：图标栏一格一个，树里分两组。')}</span>
              <span className="sa-blk">{t('关掉以后这些文件夹和里面的笔记都不动，只是当普通文件夹显示')}</span>
            </>
          }
        >
          <Toggle
            on={presets}
            label={t('用预设的分类')}
            onChange={(v) => {
              void updateLeft((c) => setPresets(c, v))
              said.saved(v ? t('预设分类打开了：图标栏和树里又按分类摆') : t('预设分类关掉了：文件夹和笔记都没动，只是当普通文件夹显示'), () => void updateLeft((c) => setPresets(c, !v)))
            }}
          />
        </Row>
        <Row id="leftInbox">
          <span className="sa-val">{t('一直在')}</span>
        </Row>
        <Row id="leftOwn">
          <span className="sa-val num">{t('{n}个', { n: ownLeft(left).length })}</span>
        </Row>
      </Group>
      <Group title={t('附件')}>
        <Row id="attach">
          <button
            type="button"
            className="sa-btn"
            onClick={async () => {
              // 还没有「附件」文件夹（没贴过图）时在访达里显示库
              const all = await window.cnFiles.all()
              const has = all.some((x) => x.path === '附件') // 不翻：磁盘上的附件文件夹名
              await window.cnMenu.reveal(has ? '附件' : '') // 不翻：磁盘上的附件文件夹名
              said.say(has ? t('在访达里显示了「附件」文件夹') : t('库里还没有「附件」文件夹（还没贴过图）：在访达里显示了库'))
            }}
          >
            {t('在访达里看')}
          </button>
        </Row>
      </Group>
      <Group title={t('待办')}>
        <Row id="showTodo">
          <Toggle on={f.showTodo} label={t('文件树里显示待办')} onChange={(v) => setF('showTodo', v, v ? t('文件树里显示待办了：收件箱、写作这些文件夹下面多一篇「待办」') : t('文件树里不再显示待办：在左边「待办」格里'))} />
        </Row>
      </Group>
      <Group title={t('删除')}>
        <Row id="delAsk">
          <Sel label={t('删笔记前问一声')} value={f.delAsk} options={ASK.map(([a, n]) => [a, t(n)] as const)} onChange={(v) => setF('delAsk', v, t('删笔记前：{name}', { name: t(ASK.find((a) => a[0] === v)![1]) }))} />
        </Row>
        <Row id="delImgs">
          <Toggle
            on={imgs}
            label={t('连同它的图一起删')}
            onChange={(v) => {
              setTrashImages(v)
              setImgs(v)
              said.saved(v ? t('删笔记时它自己的图默认一起移到废纸篓') : t('删笔记时图默认留着'), () => (setTrashImages(!v), setImgs(!v)))
            }}
          />
        </Row>
      </Group>
      <Group title={t('归档')}>
        <Row id="archive">
          <Sel
            label={t('多久没改算归档')}
            value={props.settings.archiveDays}
            options={[0, ...ARCHIVE_CHOICES.filter((d) => d !== 0)].map((d) => [d as ArchiveDays, d === 0 ? t('不自动归档') : t('{n}天', { n: d })] as const)}
            onChange={(v) => {
              const old = props.settings.archiveDays
              void props.onChange({ archiveDays: v })
              said.saved(v === 0 ? t('不再自动归档；归档里的回到左栏') : t('{n}天没改过的从左栏收进「归档」', { n: v }), () => void props.onChange({ archiveDays: old }))
            }}
          />
        </Row>
      </Group>
    </>
  )
}
