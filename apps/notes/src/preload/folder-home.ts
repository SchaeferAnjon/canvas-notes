import { ipcRenderer } from 'electron'
import type { CnFolderApi } from '../shared/folder-home-api'

export const folderApi: CnFolderApi = {
  get: (folder) => ipcRenderer.invoke('folderHome:get', folder),
  set: (folder, home) => ipcRenderer.invoke('folderHome:set', folder, home),
  reset: (folder) => ipcRenderer.invoke('folderHome:reset', folder),
  setTemplate: (folder) => ipcRenderer.invoke('folderHome:setTemplate', folder),
  files: (folder, scope) => ipcRenderer.invoke('folderHome:files', folder, scope),
  list: () => ipcRenderer.invoke('folderHome:list'),
  create: (folder) => ipcRenderer.invoke('folderHome:create', folder),
  rename: (folder, name) => ipcRenderer.invoke('folderHome:rename', folder, name),
}
