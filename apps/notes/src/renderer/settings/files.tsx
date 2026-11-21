/**
 * 设置 › 文件和附件（方向 A）：新建（新笔记放哪）、附件（只看：附件/<笔记路径>/，「在访达里看」）、
 * 删除（删笔记前问一声、连同它的图一起删）、归档（多久没改算归档，以前在「库」页）。
 */
import { useState } from 'react'
import { withKeys } from '../keys'
import { TRASH_IMAGES_KEY } from '../../shared/attach'
import type { FilesPrefs } from '../../shared/prefs'
import { ARCHIVE_CHOICES, type ArchiveDays } from '../../shared/sidebar'
import { Toggle, type SettingsProps } from '../Settings'
import { loadTrashImages } from '../TrashDialog'
import { Group, Row, Sel, useSaid } from './ui'

const WHERE: [FilesPrefs['newWhere'], string][] = [
  ['picked', '收件箱（点过的文件夹优先）'],
  ['inbox', '总是收件箱'],
  ['beside', '正在看的那篇旁边'],
]
const ASK: [FilesPrefs['delAsk'], string][] = [
  ['images', '带图的才问'],
  ['always', '每次都问'],
  ['never', '不问'],
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
  const said = useSaid()
  const f = props.settings.files
  const [imgs, setImgs] = useState(loadTrashImages)
  const setF = <K extends keyof FilesPrefs>(k: K, v: FilesPrefs[K], hint: string) => {
    const old = f[k]
    if (old === v) return
    void props.onChange({ files: { [k]: v } })
    said.saved(hint, () => void props.onChange({ files: { [k]: old } }))
  }
  return (
    <>
      <Group title="新建">
        <Row id="newWhere">
          <Sel label="新笔记放哪" value={f.newWhere} options={WHERE} onChange={(v) => setF('newWhere', v, withKeys(`{k:new-note} 以后放进「${WHERE.find((w) => w[0] === v)![1]}」`))} />
        </Row>
      </Group>
      <Group title="附件">
        <Row id="attach">
          <button
            type="button"
            className="sa-btn"
            onClick={async () => {
              // 还没有「附件」文件夹（没贴过图）时在访达里显示库
              const all = await window.cnFiles.all()
              const has = all.some((x) => x.path === '附件')
              await window.cnMenu.reveal(has ? '附件' : '')
              said.say(has ? '在访达里显示了「附件」文件夹' : '库里还没有「附件」文件夹（还没贴过图）：在访达里显示了库')
            }}
          >
            在访达里看
          </button>
        </Row>
      </Group>
      <Group title="删除">
        <Row id="delAsk">
          <Sel label="删笔记前问一声" value={f.delAsk} options={ASK} onChange={(v) => setF('delAsk', v, `删笔记前：${ASK.find((a) => a[0] === v)![1]}`)} />
        </Row>
        <Row id="delImgs">
          <Toggle
            on={imgs}
            label="连同它的图一起删"
            onChange={(v) => {
              setTrashImages(v)
              setImgs(v)
              said.saved(v ? '删笔记时它自己的图默认一起移到废纸篓' : '删笔记时图默认留着', () => (setTrashImages(!v), setImgs(!v)))
            }}
          />
        </Row>
      </Group>
      <Group title="归档">
        <Row id="archive">
          <Sel
            label="多久没改算归档"
            value={props.settings.archiveDays}
            options={[0, ...ARCHIVE_CHOICES.filter((d) => d !== 0)].map((d) => [d as ArchiveDays, d === 0 ? '不自动归档' : `${d}天`] as const)}
            onChange={(v) => {
              const old = props.settings.archiveDays
              void props.onChange({ archiveDays: v })
              said.saved(v === 0 ? '不再自动归档；归档里的回到左栏' : `${v}天没改过的从左栏收进「归档」`, () => void props.onChange({ archiveDays: old }))
            }}
          />
        </Row>
      </Group>
    </>
  )
}
