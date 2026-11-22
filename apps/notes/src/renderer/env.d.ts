import type { CnApi } from '../shared/api'
import type { CnCrashApi } from '../shared/crash'

declare global {
  interface Window {
    cn: CnApi
    /** 出错兜底和日志（task-pyb39）；预加载没跑起来时没有 */
    cnCrash?: CnCrashApi
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string; webpreferences?: string }
    }
  }
}
