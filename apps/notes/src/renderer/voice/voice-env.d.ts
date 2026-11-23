import type { CnVoiceApi } from '../../shared/voice-api'

declare global {
  interface Window {
    cnVoice: CnVoiceApi
  }
}
