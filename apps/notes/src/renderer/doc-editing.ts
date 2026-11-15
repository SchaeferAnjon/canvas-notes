import type { Extension } from '@codemirror/state'
import { blockHandles } from './block-handles'
import { blocksField, type EditorHost, editorHost } from './editor-host'
import { mdWidgets } from './md-widgets'
import { slashMenu } from './slash-menu'
import './editor-blocks.css'

/** 文档模式的块编辑：块把手和菜单、/ 菜单、待办勾选、表格和图片（源文件模式不加） */
export function docEditing(host: EditorHost): Extension {
  return [editorHost.of(host), blocksField, mdWidgets, blockHandles, slashMenu]
}
