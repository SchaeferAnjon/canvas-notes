import type { Extension } from '@codemirror/state'
import { atomicBlocks } from './atomic-blocks'
import { baseBlock } from './base/base-block'
import { blockGaps } from './block-gaps'
import { blockHandles } from './block-handles'
import { blockSource } from './block-source'
import { boardLink } from './board-link'
import { docEmbeds } from './doc-embeds'
import { docKeys } from './doc-keys'
import { foldBlock } from './fold-block'
import { hiddenGuard } from './hidden-syntax'
import { highlightKeys } from './highlight'
import { blocksField, type EditorHost, editorHost } from './editor-host'
import { mdWidgets } from './md-widgets'
import { slashInCard, slashMenu } from './slash-menu'
import { tailLine } from './tail-line'
import { wysiwyg } from './wysiwyg'
import './editor-blocks.css'

/** 文档模式的块编辑：块把手和菜单、/ 菜单、待办勾选、表格和图片 */
export function docEditing(host: EditorHost): Extension {
  return [editorHost.of(host), blocksField, baseBlock, foldBlock, mdWidgets, boardLink, docEmbeds(() => host.path()), atomicBlocks, blockGaps, blockHandles, blockSource, slashMenu, tailLine, wysiwyg, docKeys, highlightKeys, hiddenGuard]
}

/**
 * 白板上一张卡（文档里的一段）就地改、在「看全文」里改：和文档一样排好、记号藏着。
 * 打 / 出和文档同一个插入菜单（偏好「白板卡别挂位置行」：空白卡片也能打 /；卡里的标题插 ####，slashInCard）；
 * 不要块把手、改写法、文末那一行（这些是整篇文档的事，卡里只有这一段）
 */
export function cardEditing(host: EditorHost): Extension {
  return [editorHost.of(host), slashInCard.of(true), blocksField, baseBlock, foldBlock, mdWidgets, boardLink, atomicBlocks, blockGaps, slashMenu, wysiwyg, docKeys, highlightKeys, hiddenGuard]
}
