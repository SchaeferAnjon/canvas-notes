import type { CnMcApi } from '../../shared/meetcaption'

declare global {
  interface Window {
    /** MeetCaption 联动（main/meetcaption.ts） */
    cnMc: CnMcApi
  }
}
