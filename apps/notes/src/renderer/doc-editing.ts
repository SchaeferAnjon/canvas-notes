import type { Extension } from '@codemirror/state'
import { atomicBlocks } from './atomic-blocks'
import { baseBlock } from './base/base-block'
import { blockGaps } from './block-gaps'
import { blockHandles } from './block-handles'
import { blockSource } from './block-source'
import { boardLink } from './board-link'
import { docKeys } from './doc-keys'
import { foldBlock } from './fold-block'
import { hiddenGuard } from './hidden-syntax'
import { highlightKeys } from './highlight'
import { blocksField, type EditorHost, editorHost } from './editor-host'
import { mdWidgets } from './md-widgets'
import { slashMenu } from './slash-menu'
import { tailLine } from './tail-line'
import { wysiwyg } from './wysiwyg'
import './editor-blocks.css'

/** 文档模式的块编辑：块把手和菜单、/ 菜单、待办勾选、表格和图片 */
export function docEditing(host: EditorHost): Extension {
  return [editorHost.of(host), blocksField, baseBlock, foldBlock, mdWidgets, boardLink, atomicBlocks, blockGaps, blockHandles, blockSource, slashMenu, tailLine, wysiwyg, docKeys, highlightKeys, hiddenGuard]
}

/**
 * 白板上一张卡（文档里的一段）在「改字」弹层里改：和文档一样排好、记号藏着，只改字。
 * 不要块把手、/ 菜单、改写法、文末那一行（这些是整篇文档的事，卡里只有这一段）
 */
export function cardEditing(host: EditorHost): Extension {
  return [editorHost.of(host), blocksField, baseBlock, foldBlock, mdWidgets, boardLink, atomicBlocks, blockGaps, wysiwyg, docKeys, highlightKeys, hiddenGuard]
}
