import { ipcRenderer, webUtils } from 'electron'
import type { CnFolderApi } from '../shared/folder-home-api'

export const folderApi: CnFolderApi = {
  get: (folder) => ipcRenderer.invoke('folderHome:get', folder),
  set: (folder, home) => ipcRenderer.invoke('folderHome:set', folder, home),
  reset: (folder) => ipcRenderer.invoke('folderHome:reset', folder),
  setTemplate: (folder) => ipcRenderer.invoke('folderHome:setTemplate', folder),
  files: (folder, scope) => ipcRenderer.invoke('folderHome:files', folder, scope),
  list: () => ipcRenderer.invoke('folderHome:list'),
  create: (folder) => ipcRenderer.invoke('folderHome:create', folder),
  rename: (folder, name) => ipcRenderer.invoke('folder:rename', folder, name),
  make: (parent, name) => ipcRenderer.invoke('folder:create', parent, name),
  trash: (folder, confirmed) => ipcRenderer.invoke('folder:trash', folder, confirmed === true),
  move: (folder, parent) => ipcRenderer.invoke('folder:move', folder, parent),
  moveItem: (path, folder) => ipcRenderer.invoke('folder:moveItem', path, folder),
  left: () => ipcRenderer.invoke('left:get'),
  descs: () => ipcRenderer.invoke('cat:descs'),
  setDesc: (name, text) => ipcRenderer.invoke('cat:setDesc', name, text),
  setLeft: (c) => ipcRenderer.invoke('left:set', c),
  pathOf: (file) => webUtils.getPathForFile(file),
  importPdfs: (folder, paths) => ipcRenderer.invoke('slides:import', folder, paths),
  unimportPdfs: (paths) => ipcRenderer.invoke('slides:unimport', paths),
  thumb: (path, mtimeMs) => ipcRenderer.invoke('slides:thumb', path, mtimeMs),
  putThumb: (path, mtimeMs, png) => ipcRenderer.invoke('slides:thumb:put', path, mtimeMs, png),
}
