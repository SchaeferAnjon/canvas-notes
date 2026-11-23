/**
 * 数据库里数字、日期的输入框（task-cle3x）：浏览器自带的 <input type="number"> 拿 ↑ ↓ 和滚轮加减，
 * <input type="date"> 拿 ↑ ↓ 加减光标所在的那一段；按一下 ↓，2011 就成了 2010，回车写进文件。
 * 数字改用普通输入框（NUM_INPUT），是不是数自己认（numText）；日期留着浏览器的日历，只把 ↑ ↓ 拦下（stopStep）。
 * 不是数：框描红、底栏说一句（badNum），打下一个字框恢复（clearBad），改对写回或 esc 放弃时那一句收掉（dropBad）。
 */
import type { FormEvent, KeyboardEvent } from 'react'
import { t } from '../../shared/i18n'
import { app } from '../ctx/actions'

/** 数字的输入框：普通文字框，inputMode 叫出数字键盘；没有上下小箭头，↑ ↓ 和滚轮都不加减 */
export const NUM_INPUT = { type: 'text', inputMode: 'decimal' } as const

/** 中文输入法打出来的全角数字、小数点（中文标点下「.」打出来是「。」）、负号 */
const WIDE: Record<string, string> = { '．': '.', '。': '.', '－': '-' }
/** 和 packages/format 读数用的一样（base-rows 的 NUM）：写进去的数，计算行、排序都认得 */
const NUM = /^-?\d+(?:\.\d+)?$/

/** 打进来的字 → 写进文件的数：空着给 ''，不是数给 null */
export function numText(raw: string): string | null {
  const s = raw.trim().replace(/[０-９．。－]/g, (c) => WIDE[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (s === '') return ''
  return NUM.test(s) ? s : null
}

/** 日期框的 ↑ ↓：浏览器拿去加减年、月、日，这里拦下不让它改（← → 换段、直接打数字、点日历照常） */
export function stopStep(e: KeyboardEvent<HTMLInputElement>) {
  if (e.currentTarget.type === 'date' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) e.preventDefault()
}

let said: string | null = null

/** 不是数，不收：框描红，底栏说一句（打的字太长只带前 12 个） */
export function badNum(col: string, el: HTMLInputElement) {
  const typed = Array.from(el.value.trim())
  said = t('「{col}」只收数字，「{text}」没写进去', { col, text: typed.length > 12 ? typed.slice(0, 12).join('') + '…' : typed.join('') })
  el.setAttribute('aria-invalid', 'true')
  app().notice(said)
}

/** 打下一个字：框不再红 */
export const clearBad = (e: FormEvent<HTMLInputElement>) => e.currentTarget.removeAttribute('aria-invalid')

/** 改对写回了、esc 放弃了：底栏还挂着「没写进去」那一句就收掉 */
export function dropBad() {
  if (said) app().noticeDrop(said)
  said = null
}
