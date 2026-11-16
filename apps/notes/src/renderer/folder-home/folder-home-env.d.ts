import type { CnFolderApi } from '../../shared/folder-home-api'

declare global {
  interface Window {
    cnFolder: CnFolderApi
  }
}
