import type { CnPluginsApi } from '../../shared/plugins'

declare global {
  interface Window {
    cnPlugins: CnPluginsApi
  }
}
