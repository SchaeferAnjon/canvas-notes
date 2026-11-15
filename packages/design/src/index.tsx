import type { LucideIcon, LucideProps } from 'lucide-react'

/** Lucide 图标，按 DESIGN.md：默认 16px、线宽 1.75。 */
export function Icon({ of: Of, size = 16, strokeWidth = 1.75, ...rest }: { of: LucideIcon } & LucideProps) {
  return <Of size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />
}
