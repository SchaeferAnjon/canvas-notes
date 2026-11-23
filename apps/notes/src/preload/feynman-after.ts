import { ipcRenderer } from 'electron'
import type { CnAfterApi } from '../shared/feynman/after-api'

export const afterApi: CnAfterApi = {
  mapPlan: (job, text, notePath, roundId) => ipcRenderer.invoke('feynman:map-plan', job, text, notePath, roundId),
  stopMapPlan: (job) => ipcRenderer.invoke('feynman:map-plan:stop', job),
}
