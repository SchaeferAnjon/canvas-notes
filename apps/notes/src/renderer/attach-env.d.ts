import type { CnAttachApi } from '../shared/attach'

declare global {
  interface Window {
    cnAttach: CnAttachApi
  }
}
