"use client"

import { eurShort } from "@alter-ego/kernel/currency"
import { depositOf } from "@alter-ego/rent/rent"
import { SegmentedButtons } from "@alter-ego/ui/page/segmented-buttons"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { cn } from "@alter-ego/ui/utils"
import { format, parseISO } from "date-fns"
import { useEffect, useId, useRef } from "react"

import { useAuth } from "@/hooks/use-auth"
import { useLeases, useTenants } from "@/hooks/use-leases"
import { isModuleOn } from "@/modules"

import type { CompanyMovement, RentPart } from "@/types"

export interface RentLink {
  /** "" = none. */
  leaseId: string
  /** "YYYY-MM", or "". */
  month: string
  part: RentPart
}

export const NO_RENT_LINK: RentLink = { leaseId: "", month: "", part: "rent" }

const NONE = "none"
const monthsOf = (start: string, end: string) => {
  const out: string[] = []
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); m = format(new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 1), "yyyy-MM")) out.push(m)
  return out
}
const monthName = (m: string, pattern = "MMMM yyyy") => format(parseISO(`${m}-01`), pattern)

/**
 * Rent fields of a cash-book dialog: which lease the row is for, the month it covers, and (for a payment)
 * which part it pays. Shown only when the Rent module is on and the cost centre has leases. `date` is the
 * row's day: the month follows it until set by hand.
 */
export function RentLinkFields({
  project,
  mode,
  date,
  value,
  onChange,
  deposit,
}: {
  project: string
  mode: "payment" | "offset" | "deposit"
  date: string
  value: RentLink
  onChange: (next: RentLink) => void
  /** Deposit only: the cash book's other rows and this row's direction and amount, for the held-for-this-lease hint. */
  deposit?: { movements: CompanyMovement[]; direction: "in" | "out"; amount: number }
}) {
  const id = useId()
  const { user } = useAuth()
  const leases = useLeases(user?.id).data
  const tenants = useTenants(user?.id).data
  const lastFollowed = useRef<string | null>(null)

  const house = project.trim().toLowerCase()
  const mine = isModuleOn("rent") && house !== "" ? (leases ?? []).filter((l) => l.property.trim().toLowerCase() === house) : []
  const lease = mine.find((l) => l.id === value.leaseId)
  // A deposit is for a lease, not a month.
  const months = lease && mode !== "deposit" ? monthsOf(lease.startDate, lease.endDate) : []
  const followed = months.includes(date.slice(0, 7)) ? date.slice(0, 7) : (months[0] ?? "")

  // A new link follows the date's month until another is chosen; a row opened with a month keeps it.
  useEffect(() => {
    if (lease && (value.month === "" || value.month === lastFollowed.current) && value.month !== followed) onChange({ ...value, month: followed })
    lastFollowed.current = followed
  }, [lease?.id, followed, value.month]) // eslint-disable-line react-hooks/exhaustive-deps -- onChange and value are the parent's, fresh each render

  // Another cost centre than the lease's house: the link goes.
  useEffect(() => {
    if (leases && isModuleOn("rent") && value.leaseId && !lease) onChange(NO_RENT_LINK)
  }, [leases, lease, value.leaseId]) // eslint-disable-line react-hooks/exhaustive-deps -- onChange is the parent's, fresh each render

  if (mine.length === 0) return null

  const label = (l: (typeof mine)[number]) => {
    const t = tenants?.find((x) => x.id === l.tenantId)
    return `${t ? `${t.firstName} ${t.surname}` : "Unknown tenant"}${l.room ? ` · ${l.room}` : ""} · ${monthName(l.startDate.slice(0, 7), "MMM yyyy")} – ${monthName(l.endDate.slice(0, 7), "MMM yyyy")}`
  }

  // Held across the lease and the ones it renews, whichever is current: what giving back leaves.
  const held = lease && deposit ? depositOf(mine.reduce((latest, l) => (l.tenantId === lease.tenantId && l.room === lease.room && l.startDate > latest.startDate ? l : latest), lease), leases ?? [], deposit.movements)?.held : undefined
  const depositHint =
    held === undefined || !deposit
      ? lease
        ? "Nothing held for this lease yet. Link the deposit received to it first."
        : "Link it to the lease so the Rent page shows what is held."
      : `Held ${eurShort(held)} for this lease.${deposit.direction === "out" && deposit.amount > 0 ? ` Giving ${deposit.amount >= held ? "all of it" : "this"} back leaves ${eurShort(Math.max(0, Math.round((held - deposit.amount) * 100) / 100))}.` : ""}`

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-lg border p-3">
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {mode === "payment" ? "Rent" : mode === "deposit" ? "Deposit" : "Rent Offset"}
      </h3>
      {/* A deposit has no month: its Lease field takes the whole row. */}
      <div className={cn("grid gap-3", mode !== "deposit" && "sm:grid-cols-2")}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-lease`}>{mode === "deposit" ? "Lease" : "Lease (optional)"}</Label>
          <Select
            value={value.leaseId || NONE}
            onValueChange={(v) => {
              const next = mine.find((l) => l.id === v)
              onChange(next ? { ...value, leaseId: next.id, month: "" } : NO_RENT_LINK)
            }}
          >
            <SelectTrigger id={`${id}-lease`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mine.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {label(l)}
                </SelectItem>
              ))}
              <SelectItem value={NONE}>None</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {lease && mode !== "deposit" && (
          <div className="space-y-2">
            <Label htmlFor={`${id}-month`}>For Month</Label>
            <Select
              value={value.month}
              onValueChange={(month) => {
                onChange({ ...value, month })
              }}
            >
              <SelectTrigger id={`${id}-month`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthName(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {lease && mode === "payment" && (
        <div className="space-y-2">
          <span id={`${id}-part`} className="text-sm font-medium">
            Part
          </span>
          <div>
            <SegmentedButtons
              aria-labelledby={`${id}-part`}
              options={[
                { value: "rent", label: "Rent" },
                { value: "contribution", label: "Contribution" },
              ]}
              value={value.part}
              onChange={(part) => onChange({ ...value, part })}
            />
          </div>
        </div>
      )}
      <p className="text-meta text-muted-foreground">
        {mode === "deposit"
          ? depositHint
          : mode === "payment"
          ? `Shown because ${project.trim()} has leases. For one transfer with both parts, use Record Payment on the Rent page: it saves the two.`
          : `Shown beside that month's rent; record the full rent and contribution as received. It stays in ${project.trim()}'s costs. Leave the lease empty for a plain property cost.`}
      </p>
    </section>
  )
}
