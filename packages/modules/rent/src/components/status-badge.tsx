import { eurShort } from "@alter-ego/kernel/currency"
import { StatusPill } from "@alter-ego/ui/page/status-pill"

import type { Cell } from "../rent"
import type { Tone } from "@alter-ego/ui/page/status-pill"

const TONE: Record<Cell["status"], Tone> = { paid: "success", partial: "warning", missing: "danger", "not-yet": "neutral", "due-later": "neutral", outside: "neutral" }

const money = (n: number) => eurShort(n).replace("-", "−")
export { money }

/** The state in words, never colour alone: Paid, €150 short, Missing, Not yet, or what is due later. */
export function statusWord(c: Cell): string {
  switch (c.status) {
    case "paid":
      return "Paid"
    case "partial":
      return `${money(c.due - c.paid)} short`
    case "missing":
      return "Missing"
    case "not-yet":
      return "Not yet"
    case "due-later":
      return `${money(c.due)} due later`
    case "outside":
      return ""
  }
}

/** The small lines under the word: what was paid of what, an agreed amount, an offset, Not invoiced. */
export function statusNotes(c: Cell): string[] {
  const notes: string[] = []
  if (c.status === "partial") notes.push(`${money(c.paid)} of ${money(c.due)}`)
  if (c.status === "not-yet" || c.status === "missing") notes.push(`${money(c.due)} due`)
  if (c.agreed) notes.push(`agreed ${money(c.agreed.amount)}`)
  if (c.offset > 0) notes.push(`incl. ${money(c.offset)} offset`)
  if (c.status === "paid" && !c.invoiced) notes.push("Not invoiced")
  return notes
}

export function StatusBadge({ cell }: { cell: Cell }) {
  return <StatusPill tone={TONE[cell.status]} className="whitespace-nowrap">{statusWord(cell)}</StatusPill>
}
