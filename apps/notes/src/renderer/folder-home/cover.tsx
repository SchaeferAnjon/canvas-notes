/**
 * 文件夹的横幅封面（方案 B-左栏与文件夹 v2「文件夹封面」方向 A）：自带的八张照片、八个低饱和色、从电脑选一张、去掉图片。
 * 没选图时用文件夹自己的颜色铺渐变（自己没设颜色用所在分类的，都没有是石板）。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { useRef } from 'react'
import { categoryOfPath } from '../../shared/categories'
import { coverGradient, type FolderCover } from '../../shared/folder-home'
import { COLOR_NAMES, type FolderColor, FOLDER_COLORS } from '../../shared/left'
import { COVERS, coverImage } from '../covers'
import { leftConfig } from '../files/left-store'
import { useT } from '../i18n'

/** 画廊里照片的先后（小样 IMGS_ALL 的顺序） */
const PHOTOS = ['aurora', 'ice-cave', 'icebergs', 'kirkjufell', 'black-beach', 'myvatn', 'vik', 'gullfoss'] as const
const COLORS = Object.keys(FOLDER_COLORS) as FolderColor[]

/** 这个文件夹自己的颜色：自己设的 → 所在分类的 → 石板 */
export function ownColor(folder: string): FolderColor {
  return leftConfig().looks[folder]?.color ?? categoryOfPath(folder)?.color ?? 'slate'
}

/** 横幅的 background-image */
export function folderCoverCss(c: FolderCover, folder: string): string {
  if (c.kind === 'color') return coverGradient(c.color)
  if (c.kind === 'none') return coverGradient(ownColor(folder))
  return coverImage(c)
}

/** 是一张图（能调整位置）；颜色、渐变不能调 */
export const coverIsImage = (c: FolderCover) => c.kind === 'file' || (c.kind === 'builtin' && COVERS.find((x) => x.id === c.id)?.kind === 'photo')

export function FolderCoverGallery(props: { cover: FolderCover; onPick(c: FolderCover): void; onNotice(t: string): void; onClose(): void }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  // 点外面（网页里也算）、Esc 收起（公共的 useDismiss）；里面能挑本机图片（系统对话框会让窗口失焦），失焦不算
  useDismiss(true, [box], () => props.onClose(), { keep: '[data-cover-pick]', blur: false, esc: 'late' })
  const c = props.cover
  return (
    <div className="gal fgal" ref={box} role="dialog" aria-label={t('换封面')}>
      <div className="ft-hd">
        <b>{t('换封面')}</b>
        <span className="r">{t('只改这个文件夹')}</span>
      </div>
      <div className="gh2">{t('图片', { ctx: '换封面' })}</div>
      <div className="fgrid">
        {PHOTOS.map((id) => {
          const name = t(COVERS.find((x) => x.id === id)!.name)
          const on = c.kind === 'builtin' && c.id === id
          return <button key={id} className={'th' + (on ? ' on' : '')} aria-pressed={on} aria-label={name} title={name} style={{ backgroundImage: coverImage({ kind: 'builtin', id }, true) }} onClick={() => props.onPick({ kind: 'builtin', id })} />
        })}
      </div>
      <div className="gh2">{t('颜色（没选图时用文件夹自己的颜色）')}</div>
      <div className="fgrid">
        {COLORS.map((color) => {
          const on = c.kind === 'color' && c.color === color
          return <button key={color} className={'th sw' + (on ? ' on' : '')} aria-pressed={on} aria-label={t(COLOR_NAMES[color])} title={t(COLOR_NAMES[color])} style={{ backgroundImage: coverGradient(color) }} onClick={() => props.onPick({ kind: 'color', color })} />
        })}
      </div>
      <div className="row">
        <button
          className="btn btn-sm"
          onClick={async () => {
            try {
              const p = await window.cn.pickCover()
              if (p) props.onPick({ kind: 'file', path: p })
            } catch (e) {
              props.onNotice(String((e as Error).message))
            }
          }}
        >
          <Codicon name="folder-opened" size={14} />
          {t('从电脑选一张…')}
        </button>
        <button className="btn btn-sm" onClick={() => props.onPick({ kind: 'none' })}>
          <Codicon name="trash" size={14} />
          {t('去掉图片')}
        </button>
      </div>
    </div>
  )
}
