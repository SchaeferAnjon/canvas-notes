import type { CnFeynmanApi } from '../../shared/feynman/api'

declare global {
  interface Window {
    /** 费曼学习（main/feynman.ts，接口见 shared/feynman/api.ts） */
    cnFeynman: CnFeynmanApi
  }
}
