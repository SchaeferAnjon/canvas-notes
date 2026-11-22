import type { CnMobileAiApi } from '../../shared/mobile-ai'

declare global {
  interface Window {
    cnMobileAi: CnMobileAiApi
  }
}
