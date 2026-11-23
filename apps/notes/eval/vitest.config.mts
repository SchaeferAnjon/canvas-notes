import { defineConfig } from 'vitest/config'

/** 评测只报数，不在 pnpm test 里跑：在仓库根目录 pnpm eval:dream */
export default defineConfig({
  test: { include: ['apps/notes/eval/**/*.eval.ts'] },
})
