import * as React from "react"

import { cn } from "../utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // 16 px text at every width, and on touch even when a caller sets text-sm, on the input or
        // through a parent's [&_input] (iOS zooms into a smaller input on focus; hence the !); the focus ring is a darker border plus a soft 3 px
        // halo, and aria-invalid turns the border red.
        className={cn(
          "flex h-10 w-full pointer-coarse:min-h-11 rounded-[10px] border border-input bg-transparent px-3 py-1 text-base pointer-coarse:text-base! transition-[color,border-color,box-shadow] motion-reduce:transition-none file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-foreground/12 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/15 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
