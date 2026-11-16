import type { CnMenuApi } from '../../shared/ctx-menu'

declare global {
  interface Window {
    cnMenu: CnMenuApi
  }
}
