import type { CnWebApi } from '../../shared/web-api'

declare global {
  interface Window {
    cnWeb: CnWebApi
  }
}
