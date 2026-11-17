import type { CnMineruApi } from '../../shared/mineru'
import type { CnReadingApi } from '../../shared/reading'

declare global {
  interface Window {
    cnReading: CnReadingApi
    cnMineru: CnMineruApi
  }
}
