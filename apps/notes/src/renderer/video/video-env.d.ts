import type { CnVideoApi } from '../../shared/video-api'

declare global {
  interface Window {
    cnVideo: CnVideoApi
  }
}
