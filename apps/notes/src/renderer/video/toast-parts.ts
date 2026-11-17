/**
 * 「记进了《未命名 3》 · 00:01 · 截了这一帧和前后 4 行」拆成几段（CN-85）：状态词和时间永远完整，先缩文档名（中间省略），
 * 附带说明在窄于 520 时不显示；再窄就换成两行，「撤回」始终在右边
 */
export function toastParts(text: string): { verb: string; doc: string; rest: string[] } | null {
  const m = /^(.*?)《(.+)》((?: · [^·]+)*)$/.exec(text)
  if (!m) return null
  return { verb: m[1]!, doc: m[2]!, rest: m[3]!.split(' · ').slice(1).map((x) => x.trim()) }
}
