import { ipcRenderer } from 'electron'
import type { CnTodoApi } from '../shared/todo'
import type { CnWhenApi } from '../shared/when-ai'

/** 待办三处（task-pd1d1）：实现在 main/todo.ts */
export const todoApi: CnTodoApi = {
  list: () => ipcRenderer.invoke('todo:list'),
  edit: (req) => ipcRenderer.invoke('todo:edit', req),
  add: (text, where, day, when) => ipcRenderer.invoke('todo:add', text, where, day ?? null, when ?? null),
  undo: (id) => ipcRenderer.invoke('todo:undo', id),
  migrate: (folder, force) => ipcRenderer.invoke('todo:migrate', folder, force === true),
  unmigrate: (id) => ipcRenderer.invoke('todo:unmigrate', id),
  todayInstalled: () => ipcRenderer.invoke('todo:todayInstalled'),
  openInToday: (req) => ipcRenderer.invoke('todo:openInToday', req),
  times: (items) => ipcRenderer.invoke('todo:times', items),
  openToday: () => ipcRenderer.invoke('todo:openToday'),
  aboutToday: () => ipcRenderer.invoke('todo:aboutToday'),
}

/** 待办写时间问 AI（task-pd289）：实现在 main/when-ai.ts */
export const whenApi: CnWhenApi = {
  ai: (text, now) => ipcRenderer.invoke('when:ai', text, now),
  engine: () => ipcRenderer.invoke('when:engine'),
}
