import type { DreamItem } from '../../shared/api'
import { NoteDoc } from '../note-doc'
import { dreamPaths } from './useDream'

/**
 * 收下、全部收下、撤回之前登记「这几秒里这些文件是软件自己改的」：开着的那篇跟过去时不说「在外面挪到了 / 改名成了」，
 * 改了字也不说「外部改动已经合并进来」。所有收下、撤回的路都走这一个（第 4 轮：全部收下那条路没登记）。
 * 单放一个文件：useDream.ts 要能不带编辑器（window）被单元测试引用
 */
export const expectDreamChange = (items: DreamItem[]) => NoteDoc.expectOwnChange(dreamPaths(items))
