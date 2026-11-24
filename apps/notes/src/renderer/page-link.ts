/**
 * 笔记里指 PDF 某一页的链接（[第 3 页](#page=3)、[第 4 页](第3讲.pdf#page=4&rect=…)）：打开那份 PDF（开着就切过去）翻到那页，
 * 有 rect 时那块闪一下。文档里 ⌘点、链接卡「打开」、右键「打开」、白板卡里点都走这里（task-j2vv8：以前把 # 后面当成文件名，开出空白的「#page=3」标签）。
 */
import { notePdfCandidates, pageLinkOf } from '@cn/format'
import { app } from './ctx/actions'
import { t } from '../shared/i18n'

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/**
 * note：链接所在笔记的路径；text、pos：笔记全文和链接在哪（光写 #page=N 的按它找是哪份 PDF）；label：链接的字（找不到时提示里说）。
 * 不是页码链接返回 false，交给别的打开办法
 */
export function openPageLink(note: string, href: string, text: string, pos: number, label: string): boolean {
  const a = pageLinkOf(note, href)
  if (!a) return false
  if (a.file) {
    app().openPdfAt(a.file, a.page, a.rect, a.text)
    return true
  }
  void window.cnFiles.all().then((files) => {
    const pdfs = files.filter((f) => f.kind === 'pdf').map((f) => f.path)
    const want = notePdfCandidates(note, text, pos)
    // 写的路径在库里没有（PDF 挪过）：按名字找
    const file = want.find((p) => pdfs.includes(p)) ?? want.map((p) => pdfs.find((q) => base(q) === base(p))).find(Boolean)
    if (file) app().openPdfAt(file, a.page, a.rect, a.text)
    else app().notice(t('不知道「{label}」是哪份 PDF 的：这篇没写来源，旁边也没有同名的 PDF', { label }))
  })
  return true
}
