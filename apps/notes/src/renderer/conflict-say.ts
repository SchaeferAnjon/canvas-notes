/**
 * 外面（同步盘、另一台机器、AI）改了正在改的这篇时底栏说的话。文档里打字、真白板改卡、文档白板改字弹层都用这两句
 * （第 5 轮：三处三种说法，「外部 / 外面」「另一版 / 外面那版」、「」/《》混着用）。笔记名一律用《》。
 */
import { titleOf } from '../shared/layout'

/** 改的不是同一处，合在一起了 */
export const sayMerged = (path: string) => `外面也改过《${titleOf(path)}》，已经合并进来，你正在写的字都在`

/** 改了同一处：留你的版本，外面那版存成冲突副本（copy 是副本路径；存不成给 error；还在存给 null） */
export function saySameSpot(path: string, others: boolean, copy: { path: string } | { error: string } | null): string {
  const head = `外面改了《${titleOf(path)}》的同一段：留了你的版本${others ? '，外面别处改的也合进来了' : ''}`
  if (!copy) return head
  return 'path' in copy ? `${head}，外面那版存成《${titleOf(copy.path)}》` : `${head}，外面那版没存成副本（${copy.error}）`
}

/** 真白板上正改着的卡被外面删了：卡连同打的字放回去，外面那版存成冲突副本（第 6 轮：以前框当场消失、字哪儿都没有） */
export function sayCardBack(copy: { path: string } | { error: string }): string {
  // 正看着的就是这块白板，不再写它的名字；底栏放得下（第 6 轮设计复审）
  const head = '外面删了你正在改的卡：已放回'
  return 'path' in copy ? `${head}，外面那版存成《${titleOf(copy.path)}》` : `${head}，外面那版没存成副本（${copy.error}）`
}
