import type { CnAfterApi } from '../../shared/feynman/after-api'

declare global {
  interface Window {
    cnAfter: CnAfterApi
  }
}
