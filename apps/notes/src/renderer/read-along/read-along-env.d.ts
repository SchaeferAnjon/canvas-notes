import type { CnReadApi } from '../../shared/read-along'

declare global {
  interface Window {
    cnRead: CnReadApi
  }
}
