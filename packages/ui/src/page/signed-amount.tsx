import { cn } from "../utils"

interface SignedAmountProps {
  /** Signed (plus is in, minus is out), or a magnitude with `kind`. */
  amount: number
  /** In or out; left out, the sign of `amount` says which. A transfer between your own accounts is neither. */
  kind?: "in" | "out" | "transfer"
  /** `eurCents` on the company side, `useCurrency` on the personal side. */
  format: (value: number) => string
  /** A transfer's other account, under the amount: "→ Reserve Account", or "←" when `amount` is above zero (it came from there). */
  counterpart?: string
  className?: string
}

/**
 * The one money convention (plan §0.5): "+€6,832.00" in green for money in, "−€480.00" in the
 * text colour for money out, and zero neither signed nor coloured. Green-700 for AA on white.
 * A transfer is muted and unsigned, with its counterpart; the arrow is drawn, the words are read.
 */
export function SignedAmount({ amount, kind = amount < 0 ? "out" : "in", format, counterpart, className }: SignedAmountProps) {
  if (kind === "transfer") {
    const from = amount > 0
    return (
      <span className={cn("inline-flex flex-col items-end gap-0.5 whitespace-nowrap text-muted-foreground tabular-nums", className)}>
        <span className="font-medium">{format(Math.abs(amount))}</span>
        {counterpart && (
          <>
            {" "}
            <span className="text-[12.5px]">
              <span aria-hidden>{from ? "← " : "→ "}</span>
              <span className="sr-only">{from ? "moved from" : "moved to"} </span>
              {counterpart}
            </span>
          </>
        )}
      </span>
    )
  }
  const tone = amount === 0 ? null : kind
  return (
    <span
      className={cn(
        "font-medium whitespace-nowrap tabular-nums",
        tone === "in" && "text-green-700 dark:text-green-400",
        className,
      )}
    >
      {tone === "in" ? "+" : tone === "out" ? "−" : ""}
      {format(Math.abs(amount))}
    </span>
  )
}
