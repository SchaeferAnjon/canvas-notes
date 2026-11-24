/**
 * 文档里的选中小条（task-26nz7，方案「我替你定的小事」：文档里选字不弹条，会挡着打字）：
 * 选了字的右键菜单最上面一组列勾了「文档」的那几颗，键照样能按（选着字时）。
 * 点了：写进笔记的在选中那一块下面长出一块带框带标志的 AI 块（块头写那颗的名字，和 / 菜单「AI 写一段」同一种边收边写）；
 * 只在 AI 栏答的交给右栏 AI 对话问。
 */
import type { EditorView } from '@codemirror/view'
import { aiCalloutHead, blockIndexAt, findBlocks } from '@cn/format'
import { withoutEffort } from '@cn/ai-engines/shared'
import { t } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { fillPrompt } from '../../shared/sel-bar'
import { AiStreamWrite } from '../ai-write'
import { app } from '../ctx/actions'
import { cmdById, cmdOut, cmdPrompt } from './run'

// 不翻：给 AI 的提示词
const SYSTEM = '你是笔记软件里的助手。用户在自己的笔记里选中了一段字，照他的要求处理这段，直接给能放进笔记的内容，不要客套话，不要重复他的要求。'

/** 选中的那段上面最近的小标题 */
function headAbove(text: string, pos: number): string {
  const lines = text.slice(0, pos).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^#{1,6}\s+(.+)$/.exec(lines[i]!)
    if (m) return m[1]!.trim()
  }
  return ''
}

/** 交给 AI 的那句：照提示词填空；没写 {选中的字} 的把选中的那段接在最后 */
export function docPrompt(prompt: string, sel: string, title: string, head: string): string {
  const f = fillPrompt(prompt, { sel, title, url: '', head })
  return f.tail ? `${f.text}\n\n${t('选中的这段：')}\n${sel}` : f.text // 不翻：给 AI 的
}

/** 在文档里跑一颗（选着字时） */
export async function runDocCmd(view: EditorView, id: string, path: string) {
  const c = cmdById(id)
  if (!c) return
  const sel = view.state.selection.main
  const text = view.state.sliceDoc(sel.from, sel.to).trim()
  if (!text) return
  const doc = view.state.doc.toString()
  const prompt = docPrompt(cmdPrompt(c), text, titleOf(path), headAbove(doc, sel.from))
  if (cmdOut(c) === 'answer') return app().sendAi(prompt)
  // 选到了行尾的换行（连点三下选一整行）：算到最后一个字为止
  const raw = view.state.sliceDoc(sel.from, sel.to)
  const anchor = sel.from + raw.trimEnd().length
  const turn = Date.now()
  const by = withoutEffort((await window.cn.aiPrefs()).labels.chat)
  const w = new AiStreamWrite(
    view,
    turn,
    path,
    () => {
      // 插在选中那一块的下面（另起一段）
      const cur = view.state.doc.toString()
      const at = Math.min(anchor, cur.length)
      const blocks = findBlocks(cur)
      const bi = blockIndexAt(blocks, at)
      // 那一块最后一行的行尾（块的末尾可能算上了它后面的换行）
      const end = bi === -1 ? at : Math.max(blocks[bi]!.from, blocks[bi]!.to - 1)
      const pos = view.state.doc.lineAt(end).to
      return { pos, before: '\n\n', after: '' }
    },
    aiCalloutHead({ label: c.name, ...(by ? { by } : {}) }),
  )
  const off = window.cn.onAiEvent((eid, e) => {
    if (eid === turn && e.type === 'text') w.push(e.delta)
  })
  try {
    await w.done(await window.cn.aiAsk(turn, SYSTEM, prompt))
  } catch (e) {
    w.stop()
    app().notice(t('AI 没写完：{err}', { err: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
  } finally {
    off()
  }
}
