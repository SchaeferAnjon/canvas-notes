import type { CnFilesApi } from '../../shared/files'
import type { CnSearchApi } from '../../shared/search'

declare global {
  interface Window {
    cnSearch: CnSearchApi
    cnFiles: CnFilesApi
  }
}
