"use client"

import { eur } from "@alter-ego/kernel/currency"
import { quarterMonths, formatYearMonth } from "@alter-ego/kernel/dates"
import { Button } from "@alter-ego/ui/ui/button"
import { Input } from "@alter-ego/ui/ui/input"
import { Label } from "@alter-ego/ui/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@alter-ego/ui/ui/select"
import { format } from "date-fns"
import { Plus } from "lucide-react"
import { useEffect, useId, useState } from "react"

import { AssignmentMeter } from "@/components/crm/assignment-meter"
import { useAllocations } from "@/hooks/use-allocations"
import { useAssignments, useCreateAssignment, useDeleteAssignment, useUpdateAssignment } from "@/hooks/use-assignments"
import { useAuth } from "@/hooks/use-auth"
import { useClients } from "@/hooks/use-clients"
import { useCollaborators } from "@/hooks/use-collaborators"
import { useEngagements } from "@/hooks/use-engagements"
import { useTimecards } from "@/hooks/use-timecards"
import { countedIn, liveAssignments, onContract, planOver } from "@/lib/assignment-plan"
import { assignmentUsage } from "@/lib/assignments"
import { rateAt } from "@/lib/engagement-burndown"
import { contractUnit, engagementLabel, perDay, rateIn } from "@/lib/engagements"
import { planCells } from "@/lib/timecards"
import { createAssignmentSchema } from "@/types/schemas"

import type { Assignment, Collaborator, Engagement } from "@/types"

const mon = (m: string) => formatYearMonth(m, "MMM yyyy")
const n = (x: number) => Number(x.toFixed(2))

/** "4 days a month, 6 in Nov": the default and the overrides inside the run. */
function daysLine(a: Assignment): string {
  const overrides = Object.entries(a.monthDays)
    .filter(([m]) => m >= a.from && (!a.until || m <= a.until))
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([m, d]) => `${n(d)} in ${formatYearMonth(m, "MMM")}`)
  return [`${n(a.defaultDays)} days a month`, ...overrides].join(", ")
}

/**
 * The dialog's On Contracts section: this collaborator's assignments (a contract, a cost rate in its
 * unit, from and until, days a month), each with its usage, and the quarter's planned cost. Saved at
 * once, like the fee changes of Add Change are not: an assignment is its own record.
 */
export function CollaboratorAssignments({ collaborator, onDirtyChange }: { collaborator: Collaborator; onDirtyChange?: (dirty: boolean) => void }) {
  const { user } = useAuth()
  const id = useId()
  const { data: assignments = [] } = useAssignments(user?.id)
  const { data: engagements = [] } = useEngagements(user?.id)
  const { data: clients = [] } = useClients(user?.id)
  const { data: timecards = [] } = useTimecards(user?.id)
  const { data: collaborators = [] } = useCollaborators(user?.id)
  const { data: allocations = [] } = useAllocations(user?.id)
  const create = useCreateAssignment(user?.id)
  const update = useUpdateAssignment(user?.id)
  const remove = useDeleteAssignment(user?.id)

  const today = format(new Date(), "yyyy-MM-dd")
  const thisMonth = today.slice(0, 7)
  const [form, setForm] = useState<{ editing: Assignment | null } | null>(null)
  const [engagementId, setEngagementId] = useState("")
  const [rate, setRate] = useState("")
  const [from, setFrom] = useState(thisMonth)
  const [until, setUntil] = useState("")
  const [days, setDays] = useState("")
  const [error, setError] = useState<string | null>(null)

  const mine = assignments.filter((a) => a.collaboratorId === collaborator.id)
  const byId = new Map(engagements.map((e) => [e.id, e]))
  const clientName = (e: Engagement) => clients.find((c) => c.id === e.clientId)?.name ?? ""
  const contractName = (e: Engagement) => `${clientName(e)} · ${engagementLabel(e)}`
  const open = (editing: Assignment | null) => {
    const e = editing ? byId.get(editing.engagementId) : undefined
    setForm({ editing })
    setEngagementId(editing?.engagementId ?? "")
    setRate(editing && e ? String(n(editing.dailyRate / perDay(contractUnit(e)))) : "")
    setFrom(editing?.from ?? thisMonth)
    setUntil(editing?.until ?? "")
    setDays(editing && e ? String(n(editing.defaultDays * perDay(contractUnit(e)))) : "")
    setError(null)
  }

  const picked = byId.get(engagementId)
  const unit = picked ? contractUnit(picked) : "day"
  const taken = new Set(mine.map((a) => a.engagementId))
  const choices = engagements.filter((e) => (e.isActive || (e.endMonth && e.endMonth >= thisMonth)) && (form?.editing ? e.id === engagementId : !taken.has(e.id)))
  const dailyRate = (Number(rate) || 0) * perDay(unit)
  const defaultDays = Number(days) / perDay(unit)
  const billed = picked ? rateAt(picked, from) : 0

  const save = () => {
    const input = { collaboratorId: collaborator.id, engagementId, dailyRate, from, until: until || null, defaultDays }
    const parsed = createAssignmentSchema.safeParse(input)
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    const done = { onSuccess: () => setForm(null) }
    if (form?.editing) update.mutate({ id: form.editing.id, input: { dailyRate, from, until: until || null, defaultDays } }, done)
    else create.mutate(input, done)
  }

  // The form is "dirty" once something is typed or picked: the dialog's Save must not drop it.
  const dirty =
    !!form &&
    (form.editing
      ? rate !== String(n(form.editing.dailyRate / perDay(unit))) || from !== form.editing.from || until !== (form.editing.until ?? "") || Number(days) !== n(form.editing.defaultDays * perDay(unit))
      : !!(engagementId || rate || days || until))
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  const now = new Date()
  const q = (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4
  const cells = planCells(engagements, allocations, thisMonth)
  const live = liveAssignments(assignments, collaborators)
  const plan = planOver(
    mine,
    cells,
    quarterMonths(now.getFullYear(), q),
    (a, m) => {
      const e = byId.get(a.engagementId)
      return e ? rateAt(e, m) : 0
    },
    live,
  )

  return (
    <fieldset className="space-y-3 rounded-lg border p-3.5">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-medium">On Contracts</legend>
        {!form && (
          <Button type="button" variant="ghost" size="sm" onClick={() => open(null)}>
            <Plus aria-hidden /> Assign to Contract
          </Button>
        )}
      </div>

      {mine.length === 0 && !form && <p className="text-meta text-muted-foreground">Not on any contract yet.</p>}

      {mine.map((a) => {
        const e = byId.get(a.engagementId)
        if (!e) return null
        const eUnit = contractUnit(e)
        return (
          <div key={a.id} className="space-y-1.5 rounded-md bg-muted px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium [overflow-wrap:anywhere]">{contractName(e)}</span>
              <span className="flex shrink-0 gap-1">
                <Button type="button" variant="ghost" size="sm" aria-label={`Edit the assignment on ${contractName(e)}`} onClick={() => open(a)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove the assignment on ${contractName(e)}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(a.id)}
                >
                  Remove
                </Button>
              </span>
            </div>
            <p className="text-meta tabular-nums text-subtle-foreground">
              {rateIn(a.dailyRate, contractUnit(e))} · {mon(a.from)} to {a.until ? mon(a.until) : "contract end"} · {daysLine(a)} · the client pays {rateIn(rateAt(e, thisMonth), contractUnit(e))}
            </p>
            <AssignmentMeter
              label={`${eUnit === "hour" ? "Hours" : "Days"} used on ${contractName(e)}`}
              usage={assignmentUsage(a, e, timecards, today, countedIn(a, onContract(live, e.id), cells, thisMonth))}
              unit={eUnit}
            />
          </div>
        )
      })}

      {form && (
        <div
          role="group"
          className="space-y-3 rounded-md border border-dashed p-3"
          aria-label={form.editing ? "Edit assignment" : "New assignment"}
          onKeyDown={(ev) => {
            // Enter in a field saves the assignment, not the collaborator form this sits in.
            if (ev.key === "Enter" && (ev.target as HTMLElement).tagName === "INPUT") {
              ev.preventDefault()
              save()
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${id}-contract`}>Contract</Label>
            <Select value={engagementId} onValueChange={setEngagementId} disabled={!!form.editing}>
              <SelectTrigger id={`${id}-contract`}>
                <SelectValue placeholder="Pick a contract" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {contractName(e)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${id}-rate`}>{unit === "hour" ? "An Hour" : "A Day"}</Label>
              <Input id={`${id}-rate`} type="number" inputMode="decimal" min="0" step="any" placeholder="280" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-days`}>{unit === "hour" ? "Hours a Month" : "Days a Month"}</Label>
              <Input id={`${id}-days`} type="number" inputMode="decimal" min="0" max={31 * perDay(unit)} step="any" placeholder="4" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-from`}>Assignment From</Label>
              <Input id={`${id}-from`} type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-until`}>Assignment Until</Label>
              <Input id={`${id}-until`} type="month" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          </div>
          {picked && dailyRate > 0 && (
            <p className="text-meta tabular-nums text-subtle-foreground" role="status">
              {clientName(picked)} bills {rateIn(billed, unit)}: {eur((billed - dailyRate) / perDay(unit))} {unit === "hour" ? "an hour" : "a day"} of margin on their days, {billed > 0 ? `${Math.round(((billed - dailyRate) / billed) * 100)}%` : "—"}.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setForm(null)}>Cancel Assignment</Button>
            <Button type="button" onClick={save} disabled={create.isPending || update.isPending}>{form.editing ? "Save Assignment" : "Add Assignment"}</Button>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <p className="text-sm text-subtle-foreground tabular-nums" aria-label="Variable cost preview">
          Q{q} {now.getFullYear()} planned <b className="text-foreground">{eur(plan.cost)}</b> ({n(plan.days)} days) · margin on their days{" "}
          <b className="text-foreground">{eur(plan.billed - plan.cost)}</b>
        </p>
      )}
    </fieldset>
  )
}
