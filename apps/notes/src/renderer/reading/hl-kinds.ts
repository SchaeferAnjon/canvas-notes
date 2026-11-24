/**
 * 划线的含义表这会儿是什么（ParaRead 联动）：读 PDF 的 store 读到了放这里，文档里画 ==…== 的地方（live-preview）照它给颜色，
 * 不用为了一个颜色引整个读 PDF 的 store
 */
import { DEFAULT_KINDS, HL_DOT, type HlKind } from '@cn/format'

let now: HlKind[] = DEFAULT_KINDS
export const hlKindsNow = () => now
export const setHlKindsNow = (k: HlKind[]) => {
  now = k
}
/** 这个键的点的颜色；不认得的键（别处来的、删掉的含义）灰色 */
export const hlDot = (key: string) => HL_DOT[now.find((k) => k.key === key)?.color ?? 'gray']
