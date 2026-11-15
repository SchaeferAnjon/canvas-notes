import type { CnApi } from '../shared/api'

declare global {
  interface Window {
    cn: CnApi
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string }
    }
  }
}
