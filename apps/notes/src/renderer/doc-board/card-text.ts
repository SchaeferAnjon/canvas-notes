/**
 * 白板上改完一张卡存回去之前：最后几下回车留下的尾巴去掉（收件箱「白板里面回车有问题」）。
 * 卡里打完一项待办按回车、打完一句按回车再点别处，编辑器里多出的空的一项（`- [ ] `、`- `、`1. `）、空的 `> `、
 * 空行不进文件：以前原样写回去，待办卡多一个空勾（「0/3」），文档里那一段后面多出几个空行。
 * 只去最后面整行是空的那几行，中间的不动；字没改的卡不经过这里（打开再收起文件一个字节不变）。
 */
const EMPTY_TAIL = /^[ \t]*(?:(?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?|>(?:[ \t]*>)*)?[ \t]*$/

export function cardText(v: string): string {
  const lines = v.split('\n')
  while (lines.length && EMPTY_TAIL.test(lines[lines.length - 1]!)) lines.pop()
  return lines.join('\n')
}
