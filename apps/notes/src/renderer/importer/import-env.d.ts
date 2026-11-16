import type { CnImportApi } from '../../shared/import'

declare global {
  interface Window {
    cnImport: CnImportApi
  }
}
