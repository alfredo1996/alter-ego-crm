import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "../utils"

// Redesign (Components.dc): 8px radius, no shadows, a ring clear of the fill; 36 / 40 / 44
// px sizes, and red only for an action that deletes.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        // A delete that sits among other actions: red type on a pale border, filled only on hover.
        "outline-destructive":
          "border border-danger/40 bg-background text-danger hover:bg-danger-soft",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // pointer-coarse: 44 px on a touch screen (a minimum, so a caller's h-7 grows and an
      // h-auto button is never squashed); a mouse keeps the compact sizes.
      size: {
        default: "h-10 px-4 py-2 pointer-coarse:min-h-11",
        // --button-sm-text: 13 px, 12 on a phone as before (the rows #205/#206 fitted wrap at
        // 13). A variable, so a caller's text-xs still wins at every width.
        sm: "h-9 px-3 text-(length:--button-sm-text) pointer-coarse:min-h-11",
        lg: "h-11 px-[18px]",
        icon: "h-9 w-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        // An icon-only action that is 44 px with a mouse too (header and row actions).
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
