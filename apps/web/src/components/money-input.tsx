
import { Input } from "@alter-ego/ui/ui/input"
import { cn } from "@alter-ego/ui/utils"
import { forwardRef } from "react"

import type { ComponentProps } from "react"

/** A euro amount: the € inside the field, so a number is never read as a rate. */
export const MoneyInput = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(({ className, ...props }, ref) => (
  <div className="relative">
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
    >
      €
    </span>
    <Input
      ref={ref}
      type="number"
      step="0.01"
      inputMode="decimal"
      className={cn("pl-7 text-right tabular-nums", className)}
      {...props}
    />
  </div>
))
MoneyInput.displayName = "MoneyInput"
