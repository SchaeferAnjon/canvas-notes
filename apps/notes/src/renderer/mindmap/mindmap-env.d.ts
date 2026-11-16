import type { CnMapApi } from '../../shared/mindmap-api'

declare global {
  interface Window {
    cnMap: CnMapApi
  }
}
