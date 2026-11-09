"use client"

import { isoDate } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alter-ego/ui/ui/dialog"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { toast } from "@alter-ego/ui/use-toast"
import { cn } from "@alter-ego/ui/utils"
import { useState } from "react"

import { useUpdateCompanyAccount } from "@/hooks/use-company-accounts"
import { checkAgainst, checkDetail, dayLabel, round2, rowsSinceCheck, statementCheck, statementLabel } from "@/lib/cash-book"
import { eurCents } from "@/lib/invoices"


import type { CashRow, StatementCheck } from "@/lib/cash-book"
import type { CompanyAccount } from "@/types"

type Typed = { bank: string; day: string }

/** "matches" green, a difference amber, the rest muted: the one look of a check. */
export function checkTone(check: StatementCheck): string {
  if (check.status === "matches") return "text-green-700 dark:text-green-400"
  if (check.status === "not_checked") return "text-muted-foreground"
  return "text-amber-700 dark:text-amber-400"
}

/**
 * The monthly check: the balance on each bank statement against the book on
 * the same day, answered as you type ("Matches the bank", "Missing OUT of €x"),
 * with the rows since the last check when they differ. Save keeps it on the
 * account card, unless an account's last check is on a later day: an earlier
 * one is compared, never saved over it.
 */
export function CheckBalanceDialog({
  userId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  accounts,
  counted,
  day,
}: {
  userId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** No DialogTrigger: the caller says where focus goes back to. */
  onCloseAutoFocus?: (event: Event) => void
  accounts: CompanyAccount[]
  /** The rows that reach a balance (splitRows). */
  counted: CashRow[]
  /** "yyyy-MM-dd" each statement's day opens on; today when not given. Month End gives the month's last day. */
  day?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onCloseAutoFocus={onCloseAutoFocus}>
        {open && <CheckForm userId={userId} accounts={accounts} counted={counted} day={day} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CheckForm({
  userId,
  accounts,
  counted,
  day,
  onClose,
}: {
  userId: string | undefined
  accounts: CompanyAccount[]
  counted: CashRow[]
  day: string | undefined
  onClose: () => void
}) {
  const updateAccount = useUpdateCompanyAccount(userId)
  const [today] = useState(() => isoDate(new Date()))
  const [typed, setTyped] = useState<Record<string, Typed>>(() =>
    Object.fromEntries(accounts.map((a) => [a.id, { bank: "", day: day ?? today }])),
  )
  const [error, setError] = useState<string | null>(null)
  const set = (id: string, patch: Partial<Typed>) => setTyped((t) => ({ ...t, [id]: { ...t[id], ...patch } }))
  const parsed = (t: Typed) => (t.bank.trim() !== "" && Number.isFinite(Number(t.bank)) && t.day ? round2(Number(t.bank)) : null)
  // The account's last check is on a later day: this one is compared only.
  const newer = (a: CompanyAccount) => (a.statementDate && typed[a.id].day < isoDate(a.statementDate) ? isoDate(a.statementDate) : null)

  const save = async () => {
    const filled = accounts.filter((a) => parsed(typed[a.id]) !== null)
    if (filled.length === 0) return setError("Type at least one bank balance.")
    if (filled.some((a) => typed[a.id].day > today)) return setError("A statement can't be dated in the future.")
    try {
      await Promise.all(
        filled.filter((a) => !newer(a)).map((a) =>
          updateAccount.mutateAsync({
            id: a.id,
            input: { statementBalance: parsed(typed[a.id]), statementDate: new Date(`${typed[a.id].day}T00:00:00`) },
          }),
        ),
      )
    } catch {
      return
    }
    onClose()
    toast({
      title: filled
        .map((a) => {
          const answer = `${a.name}: ${statementLabel(checkAgainst(a, counted, parsed(typed[a.id])!, typed[a.id].day), eurCents)}`
          const kept = newer(a)
          return kept ? `${answer}, not saved: the ${dayLabel(kept)} check is newer.` : `${answer}.`
        })
        .join(" "),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Check Balance</DialogTitle>
        <DialogDescription>
          Type the balance on each bank statement. The app compares it with the Cash Book at the end of the same day.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {accounts.map((a) => {
          const t = typed[a.id]
          const bank = parsed(t)
          const check = bank === null ? null : checkAgainst(a, counted, bank, t.day)
          const last = statementCheck(a, counted)
          const kept = newer(a)
          const { rows, since } = check && check.status !== "matches" ? rowsSinceCheck(a, counted, t.day) : { rows: [], since: "" }
          const detail = check && checkDetail(check, eurCents)
          return (
            <section key={a.id} aria-label={a.name} className="space-y-3 rounded-md border p-4">
              <div>
                <h3 className="font-medium">{a.name}</h3>
                <p className={cn("text-xs", checkTone(last))}>Last check: {statementLabel(last, eurCents)}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`bank-${a.id}`}>Bank Balance</Label>
                  <Input
                    id={`bank-${a.id}`}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    value={t.bank}
                    onChange={(e) => {
                      setError(null)
                      set(a.id, { bank: e.target.value })
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`day-${a.id}`}>On</Label>
                  <Input
                    id={`day-${a.id}`}
                    type="date"
                    max={today}
                    value={t.day}
                    onChange={(e) => set(a.id, { day: e.target.value })}
                  />
                </div>
              </div>
              {/* Always mounted: a live region that arrives with its text is often not read. */}
              <div aria-live="polite" className="space-y-1 text-sm">
                {check && (
                  <>
                    <p className={cn("font-medium", checkTone(check))}>{statementLabel(check, eurCents)}</p>
                    <p className="text-muted-foreground">
                      Cash Book at the end of {dayLabel(check.day)}: {eurCents(check.book)} · Bank: {eurCents(check.bank)}
                    </p>
                    {detail && <p className="text-muted-foreground">{detail}</p>}
                    {kept && (
                      <p className="text-muted-foreground">
                        Earlier than the last check, on {dayLabel(kept)}: compared only. Save Check keeps that one.
                      </p>
                    )}
                  </>
                )}
              </div>
              {rows.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                    {rows.length} {rows.length === 1 ? "row" : "rows"} {since}
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                    {rows.map((r) => (
                      <li key={r.key} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {dayLabel(r.day)} · {r.description}
                        </span>
                        <span className="shrink-0 tabular-nums">{eurCents(r.delta)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )
        })}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={updateAccount.isPending} onClick={save}>
          Save Check
        </Button>
      </DialogFooter>
    </>
  )
}
