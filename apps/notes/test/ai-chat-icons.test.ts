import { ICON_NAMES } from '@cn/ai-chat/host'
import { hasCodicon } from '@cn/design'
import { expect, it } from 'vitest'

// @cn/ai-chat 的组件按名字要图标，画布笔记交 Codicons：表里每个名字都得在 scripts/codicons.mjs 的 USED 里（'ai' 画引擎标志，不是 Codicon）
it('共用对话框要的图标画布笔记都有', () => {
  expect(ICON_NAMES.filter((n) => n !== 'ai' && !hasCodicon(n))).toEqual([])
})
