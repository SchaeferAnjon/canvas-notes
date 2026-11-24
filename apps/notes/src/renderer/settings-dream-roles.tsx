/**
 * 设置 › 梦游「这个库怎么分」（task-h7oy8，shared/vault-roles.ts）：库最外层每个文件夹一行（名字、角色下拉、为什么），
 * 「重新认一遍」照现在的文件夹再猜一遍（还没存），「确认」写进库里的 .canvas-notes/梦游.md、一次提交；梦游以后照它整理。
 */
import { Codicon } from '@cn/design'
import { useEffect, useState } from 'react'
import { ROLES, ROLES_FILE, type Role, type RoleRow, type RolesView } from '../shared/vault-roles'
import { useT } from './i18n'
import { dateText } from '../shared/when'

type T = ReturnType<typeof useT>

/** 角色的名字（界面语言）和一句它在梦游里意味着什么 */
export const roleLabel = (t: T, r: Role): string =>
  ({
    inbox: t('收件箱', { ctx: '文件夹角色' }),
    clip: t('剪藏', { ctx: '文件夹角色' }),
    reading: t('阅读', { ctx: '文件夹角色' }),
    course: t('课程', { ctx: '文件夹角色' }),
    journal: t('日记', { ctx: '文件夹角色' }),
    weekly: t('周记', { ctx: '文件夹角色' }),
    project: t('项目', { ctx: '文件夹角色' }),
    area: t('领域', { ctx: '文件夹角色' }),
    resource: t('资料', { ctx: '文件夹角色' }),
    archive: t('归档', { ctx: '文件夹角色' }),
    writing: t('写作', { ctx: '文件夹角色' }),
    life: t('生活', { ctx: '文件夹角色' }),
    chrono: t('按时间', { ctx: '文件夹角色' }),
    meta: t('模板', { ctx: '文件夹角色' }),
    attach: t('附件', { ctx: '文件夹角色' }),
    unsure: t('不确定', { ctx: '文件夹角色' }),
  })[r]

/** 下拉里每个角色后面的一句：梦游在那里做什么 */
const roleDoes = (t: T, r: Role): string =>
  r === 'inbox'
    ? t('归类的来源')
    : r === 'archive' || r === 'meta' || r === 'attach'
      ? t('不碰')
      : r === 'unsure'
        ? t('不往里放')
        : t('能放进去')

export function useRoles() {
  const [view, setView] = useState<RolesView | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.dreamRoles().then((v) => live && setView(v), () => undefined)
    return () => {
      live = false
    }
  }, [])
  return [view, setView] as const
}

export function RolesSection(props: { view: RolesView | null; onView(v: RolesView): void; onNotice(t: string): void }) {
  const t = useT()
  const { view } = props
  /** 改过、还没确认的那一份（null 是照 view） */
  const [draft, setDraft] = useState<RoleRow[] | null>(null)
  const [busy, setBusy] = useState<'infer' | 'save' | null>(null)
  const rows = draft ?? view?.rows ?? []
  const dirty = draft !== null

  async function again() {
    setBusy('infer')
    try {
      const v = await window.cn.dreamRoles(true)
      setDraft(v.rows)
      props.onNotice(t('照现在的文件夹重新认了一遍，点「确认」才存'))
    } catch (e) {
      props.onNotice((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  async function confirm() {
    setBusy('save')
    try {
      const v = await window.cn.dreamRolesSave(rows.map(({ folder, role, why }) => ({ folder, role, why, sure: 'high' })))
      setDraft(null)
      props.onView(v)
      props.onNotice(t('已存 · 梦游以后照这张表整理'))
    } catch (e) {
      props.onNotice((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const pick = (folder: string, role: Role) => setDraft(rows.map((r) => (r.folder === folder ? { ...r, role, why: r.role === role ? r.why : t('你改的') } : r)))

  const status = !view
    ? t('正在看这个库……')
    : dirty
      ? t('改了还没存，点「确认」写进库里')
      : view.confirmed
        ? t('确认过：{date} · 存在库里的 {file}', { date: dateText(new Date(`${view.confirmed}T12:00:00`).getTime()), file: ROLES_FILE })
        : view.guessed.length
          ? t('还没确认：{n}个文件夹是梦游猜的，梦游先照猜的整理', { n: view.guessed.length })
          : t('都是画布笔记自带的分类，不用确认')

  return (
    <>
      <div className="dset-rolebar" data-testid="dream-roles-status">
        <span className="st">
          {/* 还没确认、改了还没存是黄点，确认过是绿点（照「远程地址」存前存后） */}
          <i className={'dot' + (dirty || (view && !view.confirmed && view.guessed.length) ? ' warn' : view?.confirmed ? ' ok' : '')} />
          <span>{status}</span>
        </span>
        <button className="btn btn-sm btn-ghost" disabled={!!busy || !view} onClick={() => void again()}>
          {busy === 'infer' ? <Codicon name="loading" size={14} className="spin" /> : <Codicon name="refresh" size={14} />}
          {t('重新认一遍')}
        </button>
        {/* 确认过又没改：只留「重新认一遍」（主按钮存前是确认，存后不占位置） */}
        {(dirty || !view?.confirmed) && (
          <button className="btn btn-sm btn-primary" disabled={!!busy || !rows.length} onClick={() => void confirm()}>
            {busy === 'save' ? <Codicon name="loading" size={14} className="spin" /> : <Codicon name="check" size={14} />}
            {t('确认')}
          </button>
        )}
      </div>
      <div className="dset-roles" role="list" aria-label={t('这个库怎么分')} data-row="dRoles">
        {!rows.length && view && <div className="empty">{t('库里还没有文件夹')}</div>}
        {rows.map((r) => {
          const sub = r.folder.includes('/')
          const unsure = !dirty && !view?.confirmed && view?.guessed.includes(r.folder) && r.sure === 'low'
          return (
            <div key={r.folder} className={'dset-role' + (sub ? ' sub' : '')} role="listitem" data-folder={r.folder}>
              <span className="tx">
                <span className="nm">
                  <Codicon name="folder" size={14} />
                  <span className="path">
                    {sub && <span className="par">{r.folder.slice(0, r.folder.lastIndexOf('/') + 1)}</span>}
                    <b>{sub ? r.folder.slice(r.folder.lastIndexOf('/') + 1) : r.folder}</b>
                  </span>
                  {unsure && <em className="low">{t('没把握')}</em>}
                </span>
                <span className="why" title={r.why}>
                  {r.why}
                </span>
              </span>
              <select aria-label={t('「{folder}」的角色', { folder: r.folder })} value={r.role} onChange={(e) => pick(r.folder, e.currentTarget.value as Role)}>
                {ROLES.map((x) => (
                  <option key={x} value={x}>
                    {`${roleLabel(t, x)} · ${roleDoes(t, x)}`}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </>
  )
}
