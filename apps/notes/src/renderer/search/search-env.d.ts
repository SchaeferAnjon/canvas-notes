import type { CnCmdsApi } from '../../shared/commands'
import type { CnFilesApi } from '../../shared/files'
import type { CnSearchApi } from '../../shared/search'

declare global {
  interface Window {
    cnSearch: CnSearchApi
    cnFiles: CnFilesApi
    cnCmds: CnCmdsApi
  }
}
