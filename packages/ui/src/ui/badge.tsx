import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "../utils"

// A soft, rounded-full pill that always carries a word (state is never shown by colour
// alone). The five tones are the redesign's; the shadcn names map onto them: default and
// secondary are neutral, destructive is danger, outline stays a bordered tag.
const NEUTRAL = "border-transparent bg-muted text-subtle-foreground"
const DANGER = "border-transparent bg-danger-soft text-danger-soft-foreground"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: NEUTRAL,
        secondary: NEUTRAL,
        destructive: DANGER,
        outline: "text-subtle-foreground",
        neutral: NEUTRAL,
        success: "border-transparent bg-success-soft text-success-soft-foreground",
        warning: "border-transparent bg-warning-soft text-warning-soft-foreground",
        info: "border-transparent bg-info-soft text-info-soft-foreground",
        danger: DANGER,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
