import * as React from "react"

import { cn } from "../utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-[10px] border border-input bg-transparent px-3 py-2 text-base pointer-coarse:text-base! leading-relaxed transition-[color,border-color,box-shadow] motion-reduce:transition-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-foreground/12 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/15 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
