/**
 * 白板上现在选中的那张卡（DocBoardView 选中一张时记下它的 key，task-9womr）：AI 命令「计划拆成待办」拆的就是它。
 * 只记一张（选了好几张时不算选中了一张）。
 */
const sel = new Map<string, string>()

export function setBoardSelection(path: string, keys: ReadonlySet<string>) {
  if (keys.size === 1) sel.set(path, [...keys][0]!)
  else sel.delete(path)
}

export const boardSelection = (path: string): string | null => sel.get(path) ?? null
