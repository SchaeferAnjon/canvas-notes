import type { CnReadingApi } from '../../shared/reading'

declare global {
  interface Window {
    cnReading: CnReadingApi
  }
}
