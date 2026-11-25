/**
 * 清理没用到的附件的确认框（2026-11-25 用户「这里加一个一键清理没有用到的图片的按钮」）：列出要清的，每行缩略图、名字、在哪个文件夹、多大，
 * 默认都勾上、能一个个取消；底下写勾着的一共多大，按钮「移到废纸篓 N 个」。没有谁提到、但拿不准的另列一组「拿不准，不清」，写为什么，不能勾。
 * 样子同删笔记的确认框（trash.css：--pop、圆角 12），宽一点放列表。
 */
import { Codicon } from '@cn/design'
import { useEffect, useMemo, useRef, useState } from 'react'
import { sizeText, type UnsureWhy } from '../shared/attach'
import { fileName } from '../shared/files'
import './trash.css'
import { useT } from './i18n'

export interface CleanAsk {
  /** 清哪里（附件 / 附件/<某处>）：标题写「清理「某处」里没用到的附件」 */
  dir: string
  items: { path: string; bytes: number }[]
  unsure: { path: string; bytes: number; why: UnsureWhy }[]
  /** 勾着的那些；取消是 null */
  done(paths: string[] | null): void
}

const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const imgUrl = (p: string) => 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
const folderOf = (p: string) => p.slice(0, p.lastIndexOf('/'))

export function CleanDialog(props: { ask: CleanAsk }) {
  const { ask } = props
  const t = useT()
  const [off, setOff] = useState<Set<string>>(() => new Set())
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => ok.current?.focus(), [])
  const picked = ask.items.filter((i) => !off.has(i.path))
  const total = picked.reduce((s, i) => s + i.bytes, 0)
  const why = (w: UnsureWhy): string => {
    switch (w.k) {
      case 'hand':
        return t('iPad手写')
      case 'download':
        return t('网页里下载的')
      case 'cover':
        return t('首页封面')
      case 'frame':
        return t('像MeetCaption的关键画面')
      case 'recent':
        return t('刚加进来（1分钟内）')
      case 'ignored':
        return t('Git不管它，清了放不回来')
      case 'nogit':
        return t('库不是Git仓库，清了放不回来')
      case 'owner':
        return t('是《{name}》的截图', { name: fileName(w.name) })
      case 'stem':
        return t('文件夹和《{name}》同名', { name: fileName(w.name) })
    }
  }
  const title = ask.dir.includes('/') ? t('清理「{name}」里没用到的附件', { name: fileName(ask.dir) }) : t('清理没用到的附件')
  const toggle = (p: string) =>
    setOff((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const allOn = off.size === 0
  const sorted = useMemo(() => [...ask.items].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true })), [ask.items])
  return (
    <div className="trash-scrim" onMouseDown={(e) => e.target === e.currentTarget && ask.done(null)}>
      <div
        className="trash-dlg clean-dlg"
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.preventDefault(), ask.done(null))
        }}
      >
        <h3>{title}</h3>
        <p className="sub">{t('没有笔记、白板、数据库用到它们。')}</p>
        <div className="clean-head">
          <label className="clean-all">
            <input type="checkbox" checked={allOn} ref={(el) => {
                if (el) el.indeterminate = !allOn && picked.length > 0
              }} onChange={() => setOff(allOn ? new Set(ask.items.map((i) => i.path)) : new Set())} />
            <span>{t('全选')}</span>
          </label>
          <span className="clean-sum num" data-testid="clean-total">
            {t('已选{n}个 · {size}', { n: picked.length, size: sizeText(total) })}
          </span>
        </div>
        <ul className="clean-list" aria-label={t('要清理的附件')}>
          {sorted.map((i) => (
            <li key={i.path}>
              <label className={'clean-row' + (off.has(i.path) ? ' off' : '')} title={i.path}>
                <input type="checkbox" aria-label={fileName(i.path)} checked={!off.has(i.path)} onChange={() => toggle(i.path)} />
                {IMG.test(i.path) ? (
                  <img className="clean-thumb" src={imgUrl(i.path)} alt="" draggable={false} />
                ) : (
                  <span className="clean-thumb file">
                    <Codicon name="file" size={16} />
                  </span>
                )}
                <span className="clean-tx">
                  <span className="t1">{fileName(i.path)}</span>
                  <span className="t2">{folderOf(i.path)}/</span>
                </span>
                <span className="clean-size num">{sizeText(i.bytes)}</span>
              </label>
            </li>
          ))}
        </ul>
        {ask.unsure.length > 0 && (
          <>
            <p className="clean-unsure-h">{t('拿不准，不清（{n}个）', { n: ask.unsure.length })}</p>
            <ul className="clean-list unsure" aria-label={t('拿不准，不清')}>
              {ask.unsure.map((i) => (
                <li key={i.path} className="clean-row unsure" title={i.path}>
                  <span className="clean-q">
                    <Codicon name="question" size={14} />
                  </span>
                  <span className="clean-thumb file">
                    <Codicon name="file" size={16} />
                  </span>
                  <span className="clean-tx">
                    <span className="t1">{fileName(i.path)}</span>
                    <span className="t2">{folderOf(i.path)}/</span>
                  </span>
                  <span className="clean-why">{why(i.why)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="note">{t('移到废纸篓是一次提交，底栏能撤回，「最近删掉的」里也能放回原处。')}</p>
        <div className="act">
          <button className="btn btn-sm" onClick={() => ask.done(null)}>
            {t('取消')}
          </button>
          <button className="btn btn-primary btn-sm" ref={ok} disabled={!picked.length} onClick={() => ask.done(picked.map((i) => i.path))}>
            <Codicon name="trash" size={14} />
            {t('移到废纸篓{n}个', { n: picked.length })}
          </button>
        </div>
      </div>
    </div>
  )
}
