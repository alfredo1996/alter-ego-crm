import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// text-meta is a font size (globals.css): unknown to tailwind-merge, it read as a
// colour, so cn("text-meta", "text-destructive") dropped the size.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["meta"] } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
