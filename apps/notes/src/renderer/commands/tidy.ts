/**
 * 「AI整理」（task-5ryf9，白板、文档操作条上「问AI」旁边那一颗）：选中的几张卡、几段交给 AI 重新归类、排好、起标题（白板：分进几列、
 * 合并相近的、去重、补一句小结；文档：理顺顺序、加小标题、去重）。和白板上「总结这块白板」「整理」同一套：
 * 提示词和拼新全文在 ai-commands.ts，AI 只回编号（字一个不改），先给你看改前改后（env.propose，中间开对比标签），
 * 收下才写进去：AiPanel 的 applyChange，一次提交「AI：/整理这几张 · 白板名」，回答下面能撤回。
 */
import { titleOf } from '../../shared/layout'
import { cardPick } from '../ai-cards'
import { parseTidy, tidyBoardText, tidyDocText, tidyPrompt } from '../ai-commands'
import { t } from '../../shared/i18n'
import { failed, type RunEnv } from './run'

export async function runTidy(env: RunEnv, where: 'board' | 'doc') {
  const p = cardPick()
  if (!p || p.where !== where || p.path !== env.notePath)
    return env.patch({ pending: false, error: where === 'board' ? t('先在白板上框选几张，再点操作条上的「AI整理」') : t('先在文档里选几块，再点操作条上的「AI整理」') })
  const text = await env.noteText(p.path)
  if (text !== p.base) return env.patch({ pending: false, error: t('选好以后这篇又改过了：重新选一次再点「AI整理」') })
  const title = titleOf(p.path)
  const n = p.items.length
  const read = where === 'board' ? t('读了选中的{n}张', { n }) : t('读了选中的{n}块', { n })
  env.patch({ read })
  const answer = await env.ask(tidyPrompt(where, title, p.items.map((x) => x.text)))
  const plan = parseTidy(answer, n)
  // 不翻：/ 命令的名字（提交说明、对比标签上写它）
  const name = where === 'board' ? '整理这几张' : '整理这几段'
  if (!plan) return env.patch({ pending: false, read, ...failed(t('AI 这次没给出能用的整理办法，文件没动。'), answer) })
  const after = where === 'board' ? tidyBoardText(text, p.items.map((x) => x.key), plan, env.by) : tidyDocText(text, p.items, plan)
  if (after === text) return env.patch({ pending: false, read, text: t('看过了，这几样不用挪，文件没动。') })
  const groups = plan.groups.length
  const lead =
    where === 'board'
      ? t('分成了{g}组（{names}）{more}。', { g: groups, names: plan.groups.map((g) => g.title || '—').join('、'), more: plan.drop.length || plan.merge.length ? t('，去掉重复的{d}张、合成了{m}处', { d: plan.drop.length, m: plan.merge.length }) : '' })
      : t('理成了{g}节（{names}）{more}。', { g: groups, names: plan.groups.map((g) => g.title || '—').join('、'), more: plan.drop.length ? t('，去掉重复的{d}段', { d: plan.drop.length }) : '' })
  // 不翻：改动块那一列的种类（AiPanel 按「改」「新」认）
  env.propose({ name, title, files: [{ path: p.path, before: text, after }], message: `/${name} · ${title}`, kinds: { [p.path]: '改' }, lead })
  env.patch({ read })
}
