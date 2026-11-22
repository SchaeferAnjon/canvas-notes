import { ipcRenderer } from 'electron'
import type { CnTodoApi } from '../shared/todo'

/** 待办三处（task-pd1d1）：实现在 main/todo.ts */
export const todoApi: CnTodoApi = {
  list: () => ipcRenderer.invoke('todo:list'),
  edit: (req) => ipcRenderer.invoke('todo:edit', req),
  add: (text, where) => ipcRenderer.invoke('todo:add', text, where),
  undo: (id) => ipcRenderer.invoke('todo:undo', id),
  migrate: (folder, force) => ipcRenderer.invoke('todo:migrate', folder, force === true),
  unmigrate: (id) => ipcRenderer.invoke('todo:unmigrate', id),
  todayInstalled: () => ipcRenderer.invoke('todo:todayInstalled'),
  openInToday: (req) => ipcRenderer.invoke('todo:openInToday', req),
}
