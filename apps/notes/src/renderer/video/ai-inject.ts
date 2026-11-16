/**
 * 框一块问：问题和回答出现在中间栏右下角的 AI 浮窗里（右栏 AI 还没并进来之前先接这里）。
 * 视频条把「这一问」交过来，浮窗记一条用户消息、一条 AI 消息，等回答好了填上，下面一行「已记进《…》和「视频里的疑惑」」。
 */
export interface Injected {
  question: string
  /** 回答出来之前那一行（「在看框住的那块…」） */
  read: string
  run: Promise<{ text: string; read?: string; done?: string }>
}

const subs = new Set<(i: Injected) => void>()

export function injectAi(i: Injected) {
  subs.forEach((f) => f(i))
}

export function onInjectAi(f: (i: Injected) => void): () => void {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
