/** 旁支里空着回车问的那句 */
export const ASK_THIS = '讲讲这句'

/**
 * 旁支的名字（task-4edsc 原型 nameOf）：改过的；没改过用问的第一句（16 字，末尾的问号、句号去掉；空着问的「讲讲这句」不算），
 * 再没有用那一句的头 8 个字；还没问过是「新旁支」
 */
export function sideName(s: { name?: string; quote: string; msgs: readonly { role: string; text?: string }[] }): string {
  if (s.name?.trim()) return s.name.trim()
  const first = s.msgs
    .find((m) => m.role === 'user')
    ?.text?.replace(/\s+/g, ' ')
    .trim()
    .replace(/[？?。！!，,、；;：:.]+$/, '')
  if (!first) return '新旁支'
  if (first !== ASK_THIS) return first.length > 16 ? first.slice(0, 16) + '…' : first
  const q = s.quote.replace(/\s+/g, ' ').trim()
  return q.length > 8 ? q.slice(0, 8) + '…' : q
}

/** 旁支问了几问 */
export const sideAsks = (s: { msgs: readonly { role: string }[] }) => s.msgs.filter((m) => m.role === 'user').length
