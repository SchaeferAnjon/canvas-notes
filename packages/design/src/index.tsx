// 图标：全软件一律用 Codicons（VS Code 的图标库，2026-11-16 用户定 `图标用 Codicons`）
import { CODICONS, type CodiconName } from './codicons.gen'

export type { CodiconName }

/** Codicons：填色跟着字的颜色。名字在 scripts/codicons.mjs 的 USED 里，加了要重新生成 codicons.gen.ts */
export function Codicon({ name, size = 16, className, title }: { name: CodiconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={'ci' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox={CODICONS[name][0]}
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      dangerouslySetInnerHTML={{ __html: CODICONS[name][1] }}
    />
  )
}
